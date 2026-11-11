"use strict";

// KIDSOTT_REELS_COMMENTS_READONLY_B2A
// Public display disabled by default.
// Admin queue is read-only. No comment writes.

const db = require("../config/db");
const MAX_ID = 18446744073709551615n;

function hostedOnly() {
  const host = String(process.env.DB_HOST || "").trim().toLowerCase();

  return host.endsWith(".aivencloud.com") &&
    String(process.env.DB_NAME || "").trim() === "kidsott_db_v2";
}

function parseId(value) {
  if (typeof value !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(value)) {
    return null;
  }

  try {
    return BigInt(value) <= MAX_ID ? value : null;
  } catch (_) {
    return null;
  }
}

function dbFailure(res, error) {
  console.error(
    "[REELS_COMMENTS_READONLY_B2A]",
    String(error?.code || "DATABASE_ERROR")
  );

  return res.status(503).json({
    success: false,
    message: "Comments service unavailable."
  });
}

function noHostedDb(res) {
  return res.status(503).json({
    success: false,
    message: "Hosted comments database unavailable."
  });
}

async function getPublicComments(req, res) {
  const id = parseId(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid Reel ID."
    });
  }

  if (!hostedOnly()) return noHostedDb(res);

  try {
    const [reels] = await db.query(
      `SELECT r.id,
              COALESCE(s.comments_enabled, 0) AS commentsEnabled
         FROM reels r
         LEFT JOIN reel_interaction_settings s
           ON s.reel_id = r.id
        WHERE r.id = ?
          AND r.status = 'published'
          AND r.is_active = 1
        LIMIT 1`,
      [id]
    );

    if (!reels.length) {
      return res.status(404).json({
        success: false,
        message: "Reel not found."
      });
    }

    const enabled =
      process.env.KIDSOTT_REELS_PUBLIC_COMMENTS_ENABLED === "true" &&
      Number(reels[0].commentsEnabled) === 1;

    if (!enabled) {
      return res.json({
        success: true,
        reelId: id,
        commentsEnabled: false,
        commentSubmissionEnabled: false,
        data: []
      });
    }

    const [rows] = await db.query(
      `SELECT c.id, c.user_id, c.comment_text, c.created_at,
              u.name AS author_name
         FROM reel_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.reel_id = ?
          AND c.status = 'approved'
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT 30`,
      [id]
    );

    // KIDSOTT_REELS_COMMENT_AUTHOR_NAME_V2: adult test allowlist, no private IDs in response.
    const approvedAuthorIds = new Set(
      String(process.env.KIDSOTT_REELS_COMMENT_ALLOWED_USER_IDS || "")
        .split(",").map(value => value.trim()).filter(Boolean)
    );
    return res.json({
      success: true,
      reelId: id,
      commentsEnabled: true,
      commentSubmissionEnabled: process.env.KIDSOTT_REELS_COMMENT_SUBMISSION_ENABLED === "true",
      data: rows.map(row => ({
        id: String(row.id),
        text: row.comment_text,
        createdAt: row.created_at,
        authorName: approvedAuthorIds.has(String(row.user_id)) &&
          typeof row.author_name === "string" && row.author_name.trim()
            ? row.author_name.trim().slice(0, 50)
            : "Community member"
      }))
    });
  } catch (error) {
    return dbFailure(res, error);
  }
}

// KIDSOTT_REELS_ADMIN_AUTHOR_NAME_32A: Admin-only author names from users.name.
async function getAdminComments(req, res) {
  if (!hostedOnly()) return noHostedDb(res);

  const statuses = new Set([
    "pending", "approved", "rejected", "hidden"
  ]);

  const status =
    req.query.status === undefined
      ? "pending"
      : req.query.status;

  const rawPage =
    req.query.page === undefined
      ? "1"
      : String(req.query.page);

  if (
    typeof status !== "string" ||
    !statuses.has(status) ||
    !/^[1-9][0-9]{0,3}$/.test(rawPage)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid moderation filter."
    });
  }

  const page = Number(rawPage);
  const limit = 25;

  try {
    const [rows] = await db.query(
      `SELECT
          c.id,
          c.reel_id,
          c.user_id,
          c.comment_text,
          c.status,
          c.created_at,
          c.updated_at,
          r.title AS reel_title,
           u.name AS author_name
       FROM reel_comments c
       JOIN reels r ON r.id = c.reel_id
        LEFT JOIN users u ON u.id = c.user_id
       WHERE c.status = ?
       ORDER BY c.created_at DESC, c.id DESC
       LIMIT ? OFFSET ?`,
      [status, limit, (page - 1) * limit]
    );

    const [[totalRow]] = await db.query(
      `SELECT COUNT(*) AS total
         FROM reel_comments
        WHERE status = ?`,
      [status]
    );

    return res.json({
      success: true,
      data: rows.map(row => ({
        id: String(row.id),
        reelId: String(row.reel_id),
        authorUserId: String(row.user_id),
         authorName: typeof row.author_name === "string"
           ? row.author_name.trim().slice(0, 100) : "",
        reelTitle: row.reel_title,
        text: row.comment_text,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      })),
      pagination: {
        page,
        limit,
        total: Number(totalRow.total)
      }
    });
  } catch (error) {
    return dbFailure(res, error);
  }
}

module.exports = {
  getPublicComments,
  getAdminComments
};


// KIDSOTT_REELS_COMMENTS_MODERATION_B2B
// Admin-only; writes disabled unless explicitly enabled.
// Uses the hosted database pool and an atomic audit transaction.

const UINT64_MAX_B2B = 18446744073709551615n;

function parseCommentIdB2B(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value)
  ) {
    return null;
  }

  try {
    return BigInt(value) <= UINT64_MAX_B2B ? value : null;
  } catch (_) {
    return null;
  }
}

async function moderateComment(req, res) {
  if (
    !req.user ||
    req.user.role !== "admin" ||
    !Number.isSafeInteger(req.user.id) ||
    req.user.id <= 0
  ) {
    return res.status(403).json({
      success: false,
      message: "Admin access required."
    });
  }

  if (
    process.env.KIDSOTT_REELS_COMMENT_MODERATION_WRITES_ENABLED !== "true"
  ) {
    return res.status(503).json({
      success: false,
      message: "Comment moderation writes are disabled."
    });
  }

  if (!hostedOnly()) return noHostedDb(res);

  const id = parseCommentIdB2B(req.params.id);

  if (!id) {
    return res.status(400).json({
      success: false,
      message: "Invalid comment ID."
    });
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !["approve", "reject", "hide", "reopen"].includes(body.action) ||
    (body.reason != null && typeof body.reason !== "string")
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid moderation request."
    });
  }

  const reason =
    typeof body.reason === "string"
      ? body.reason.trim()
      : "";

  if (
    reason.length > 255 ||
    (
      (body.action === "reject" || body.action === "hide") &&
      reason.length < 3
    )
  ) {
    return res.status(400).json({
      success: false,
      message: "Reject and Hide require a reason of 3 to 255 characters."
    });
  }

  const transitions = {
    pending: {
      approve: "approved",
      reject: "rejected"
    },
    approved: {
      hide: "hidden"
    },
    rejected: {
      reopen: "pending"
    },
    hidden: {
      reopen: "pending"
    }
  };

  let conn;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();

    const [rows] = await conn.query(
      `SELECT id, status
         FROM reel_comments
        WHERE id = ?
        FOR UPDATE`,
      [id]
    );

    if (rows.length === 0) {
      await conn.rollback();

      return res.status(404).json({
        success: false,
        message: "Comment not found."
      });
    }

    const previousStatus = String(rows[0].status);
    const nextStatus = transitions[previousStatus]?.[body.action];

    if (!nextStatus) {
      await conn.rollback();

      return res.status(409).json({
        success: false,
        message: "Invalid comment status transition."
      });
    }

    if (body.action === "reopen") {
      await conn.query(
        `UPDATE reel_comments
            SET status = 'pending',
                reviewed_by_user_id = NULL,
                reviewed_at = NULL,
                moderation_reason = NULL
          WHERE id = ?`,
        [id]
      );
    } else {
      await conn.query(
        `UPDATE reel_comments
            SET status = ?,
                reviewed_by_user_id = ?,
                reviewed_at = CURRENT_TIMESTAMP(3),
                moderation_reason = ?
          WHERE id = ?`,
        [
          nextStatus,
          String(req.user.id),
          reason || null,
          id
        ]
      );
    }

    await conn.query(
      `INSERT INTO reel_moderation_logs
        (
          comment_id,
          admin_user_id,
          action,
          previous_status,
          new_status,
          reason
        )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        String(req.user.id),
        body.action,
        previousStatus,
        nextStatus,
        reason || null
      ]
    );

    await conn.commit();

    return res.json({
      success: true,
      data: {
        commentId: id,
        action: body.action,
        previousStatus,
        status: nextStatus
      }
    });
  } catch (error) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (_) {}
    }

    return dbFailure(res, error);
  } finally {
    if (conn) conn.release();
  }
}

module.exports.moderateComment = moderateComment;

// KIDSOTT_REELS_MODERATED_SUBMISSION_FINAL_V1
// Existing user authentication, existing reel_comments table, pending-only writes.
// Intentionally OFF until the owner approves child-account comment eligibility.
async function submitComment(req, res) {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(400).json({success: false, message: "Invalid Reel ID."});
  }
  const userId = req.user && req.user.id;
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({success: false, message: "Sign in required."});
  }
  if (process.env.KIDSOTT_REELS_COMMENT_SUBMISSION_ENABLED !== "true") {
    return res.status(503).json({success: false, message: "Comment submissions are disabled."});
  }
  if (!hostedOnly()) return noHostedDb(res);
  // KIDSOTT_REELS_COMMENTS_APPROVED_ACCOUNTS_GUARD_V1
  // Until server-verified guardian/adult eligibility exists, only explicitly
  // approved account IDs can submit free-text comments. Missing list = DENY.
  const allowedCommentUserIds = new Set(
    String(process.env.KIDSOTT_REELS_COMMENT_ALLOWED_USER_IDS || "")
      .split(",")
      .map(value => value.trim())
      .filter(value => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)))
  );
  if (!allowedCommentUserIds.has(String(userId))) {
    return res.status(403).json({
      success: false,
      message: "Comment submission is restricted to approved accounts."
    });
  }

  const content = req.body && typeof req.body.text === "string" ? req.body.text.trim() : "";
  const chars = Array.from(content);
  if (chars.length < 2 || chars.length > 200 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(content) ||
      /(?:https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i.test(content) ||
      /(?:\+?\d[\d\s().-]{8,}\d)/.test(content)) {
    return res.status(400).json({success: false, message: "Enter 2-200 characters without links or personal contact details."});
  }
  try {
    const [reels] = await db.query(
      `SELECT r.id, COALESCE(s.comments_enabled, 0) AS commentsEnabled
         FROM reels r
         LEFT JOIN reel_interaction_settings s ON s.reel_id = r.id
        WHERE r.id = ? AND r.status = 'published' AND r.is_active = 1
        LIMIT 1`,
      [id]
    );
    if (!reels.length) return res.status(404).json({success: false, message: "Reel not found."});
    if (Number(reels[0].commentsEnabled) !== 1) {
      return res.status(403).json({success: false, message: "Comments are disabled for this Reel."});
    }
    const [[rate]] = await db.query(
      `SELECT COUNT(*) AS recent FROM reel_comments
         WHERE user_id = ? AND created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 MINUTE)`,
      [String(userId)]
    );
    if (Number(rate.recent) >= 2) {
      return res.status(429).json({success: false, message: "Please wait before commenting again."});
    }
    const [saved] = await db.query(
      "INSERT INTO reel_comments (reel_id, user_id, comment_text, status) VALUES (?, ?, ?, 'pending')",
      [id, String(userId), content]
    );
    return res.status(201).json({
      success: true,
      reelId: id,
      commentId: String(saved.insertId),
      status: "pending",
      message: "Submitted for moderation."
    });
  } catch (error) {
    return dbFailure(res, error);
  }
}
module.exports.submitComment = submitComment;
