"use strict";

// KIDSOTT_REELS_ENGAGEMENT_B1
// Hosted Aiven only. Free-text comments are not enabled.

const db = require("../config/db");
const MAX_ID = 18446744073709551615n;

function hostedDatabaseReady() {
  const host = String(process.env.DB_HOST || "").trim().toLowerCase();
  const database = String(process.env.DB_NAME || "").trim();

  return host.endsWith(".aivencloud.com") &&
    database === "kidsott_db_v2";
}

function parseReelId(value) {
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

function userIdFromRequest(req) {
  const id = req.user && req.user.id;
  return Number.isSafeInteger(id) && id > 0
    ? String(id)
    : null;
}

function databaseError(res, error) {
  console.error(
    "[REELS_ENGAGEMENT_B1]",
    String((error && error.code) || "DATABASE_ERROR")
  );

  return res.status(503).json({
    success: false,
    message: "Reel engagement is temporarily unavailable."
  });
}

function unavailable(res) {
  return res.status(503).json({
    success: false,
    message: "Hosted engagement database is unavailable."
  });
}

function checkId(req, res) {
  const id = parseReelId(req.params.id);

  if (!id) {
    res.status(400).json({
      success: false,
      message: "Invalid Reel ID."
    });
    return null;
  }

  return id;
}

async function publishedReel(id) {
  const [rows] = await db.query(
    `SELECT r.id,
            COALESCE(s.likes_enabled, 1) AS likesEnabled
       FROM reels r
       LEFT JOIN reel_interaction_settings s
         ON s.reel_id = r.id
      WHERE r.id = ?
        AND r.status = 'published'
        AND r.is_active = 1
      LIMIT 1`,
    [id]
  );

  return rows[0] || null;
}

async function countLikes(id) {
  const [[row]] = await db.query(
    "SELECT COUNT(*) AS total FROM reel_likes WHERE reel_id = ?",
    [id]
  );

  return Number(row.total);
}

async function getEngagement(req, res) {
  const id = checkId(req, res);
  if (!id) return;

  if (!hostedDatabaseReady()) return unavailable(res);

  try {
    const reel = await publishedReel(id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reel not found."
      });
    }

    const likeCount = await countLikes(id);

    return res.json({
      success: true,
      reelId: id,
      likeCount,
      likesEnabled: Number(reel.likesEnabled) === 1,
      commentsEnabled: false
    });
  } catch (error) {
    return databaseError(res, error);
  }
}

async function getMyLike(req, res) {
  const id = checkId(req, res);
  if (!id) return;

  const userId = userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in required."
    });
  }

  if (!hostedDatabaseReady()) return unavailable(res);

  try {
    const reel = await publishedReel(id);

    if (!reel) {
      return res.status(404).json({
        success: false,
        message: "Reel not found."
      });
    }

    const [rows] = await db.query(
      `SELECT 1 AS liked
         FROM reel_likes
        WHERE reel_id = ? AND user_id = ?
        LIMIT 1`,
      [id, userId]
    );

    return res.json({
      success: true,
      reelId: id,
      liked: rows.length > 0
    });
  } catch (error) {
    return databaseError(res, error);
  }
}

async function changeLike(req, res, liked) {
  const id = checkId(req, res);
  if (!id) return;

  const userId = userIdFromRequest(req);

  if (!userId) {
    return res.status(401).json({
      success: false,
      message: "Sign in required."
    });
  }

  if (
    process.env.KIDSOTT_REELS_LIKE_WRITES_ENABLED !== "true"
  ) {
    return res.status(503).json({
      success: false,
      message: "Reel Like writes are not enabled."
    });
  }

  if (!hostedDatabaseReady()) return unavailable(res);

  try {
    if (liked) {
      const reel = await publishedReel(id);

      if (!reel) {
        return res.status(404).json({
          success: false,
          message: "Reel not found."
        });
      }

      if (Number(reel.likesEnabled) !== 1) {
        return res.status(403).json({
          success: false,
          message: "Likes are disabled for this Reel."
        });
      }

      await db.query(
        `INSERT INTO reel_likes (reel_id, user_id)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE created_at = created_at`,
        [id, userId]
      );
    } else {
      await db.query(
        `DELETE FROM reel_likes
          WHERE reel_id = ? AND user_id = ?`,
        [id, userId]
      );
    }

    return res.json({
      success: true,
      reelId: id,
      liked,
      likeCount: await countLikes(id)
    });
  } catch (error) {
    return databaseError(res, error);
  }
}

async function putLike(req, res) {
  return changeLike(req, res, true);
}

async function deleteLike(req, res) {
  return changeLike(req, res, false);
}

async function getAdminEngagement(req, res) {
  if (!hostedDatabaseReady()) return unavailable(res);

  try {
    const [rows] = await db.query(
      `SELECT r.id AS reelId,
              r.title,
              r.status,
              r.is_active AS isActive,
              (SELECT COUNT(*)
                 FROM reel_likes l
                WHERE l.reel_id = r.id) AS likeCount,
              (SELECT COUNT(*)
                 FROM reel_comments c
                WHERE c.reel_id = r.id
                  AND c.status = 'pending') AS pendingComments
         FROM reels r
         ORDER BY r.created_at DESC, r.id DESC
         LIMIT 50`
    );

    return res.json({
      success: true,
      data: rows.map(row => ({
        reelId: String(row.reelId),
        title: row.title,
        status: row.status,
        isActive: Boolean(row.isActive),
        likeCount: Number(row.likeCount),
        pendingComments: Number(row.pendingComments)
      }))
    });
  } catch (error) {
    return databaseError(res, error);
  }
}

module.exports = {
  getEngagement,
  getMyLike,
  putLike,
  deleteLike,
  getAdminEngagement
};