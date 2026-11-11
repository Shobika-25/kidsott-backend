"use strict";

// KIDSOTT_REELS_SAVES_CODE_RELEASE_39F2
// KIDSOTT_REELS_SAVES_39D: authenticated, per-user Saved Collections.
// Requires manually approved hosted Aiven table `reel_saves`.
// Protected routes become available only when their reviewed code is deployed. No per-feature flag.
const db = require("../config/db");
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

function validId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value)) return null;
  try {
    return BigInt(value) <= MAX_UNSIGNED_BIGINT ? value : null;
  } catch (_) {
    return null;
  }
}

function userId(req) {
  const value = req.user && req.user.id;
  return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}

function gate(req, res) {
  if (!userId(req)) {
    res.status(401).json({ success: false, message: "Sign in required." });
    return false;
  }
  // The Reels router's existing hosted-Aiven guard runs before these handlers.
  return true;
}

function reelParam(req, res) {
  const id = validId(req.params.id);
  if (!id) res.status(400).json({ success: false, message: "Invalid Reel ID." });
  return id;
}

function unavailable(res, error) {
  console.error("[REELS_SAVES_39D]", String(error && error.code || "DATABASE_ERROR"));
  return res.status(503).json({
    success: false,
    message: "Saved Collections is temporarily unavailable."
  });
}

// Match the eligibility requirements of the existing public Reels feed.
// Do not save a private/draft/inactive Reel or disabled catalog media.
const eligible = `
  r.status = 'published' AND r.is_active = 1
  AND c.is_active = 1
  AND (
    (r.source_type = 'catalog'
      AND v.status = 'published' AND v.is_active = 1
      AND v.video_url IS NOT NULL AND CHAR_LENGTH(TRIM(v.video_url)) > 0)
    OR
    (r.source_type = 'upload'
      AND r.video_url IS NOT NULL AND CHAR_LENGTH(TRIM(r.video_url)) > 0)
  )`;

const joins = `
  FROM reels r
  LEFT JOIN videos v ON r.source_type = 'catalog' AND v.id = r.video_id
  LEFT JOIN categories c ON c.id = CASE
    WHEN r.source_type = 'catalog' THEN v.category_id ELSE r.category_id END`;

async function findEligible(id) {
  const [rows] = await db.query(
    `SELECT r.id ${joins} WHERE r.id = ? AND ${eligible} LIMIT 1`,
    [id]
  );
  return rows.length > 0;
}

async function getMySave(req, res) {
  if (!gate(req, res)) return;
  const id = reelParam(req, res);
  if (!id) return;
  try {
    if (!await findEligible(id)) {
      return res.status(404).json({ success: false, message: "Reel unavailable." });
    }
    const [rows] = await db.query(
      "SELECT 1 AS saved FROM reel_saves WHERE user_id = ? AND reel_id = ? LIMIT 1",
      [userId(req), id]
    );
    return res.json({ success: true, reelId: id, saved: rows.length > 0 });
  } catch (error) {
    return unavailable(res, error);
  }
}

async function putSave(req, res) {
  if (!gate(req, res)) return;
  const id = reelParam(req, res);
  if (!id) return;
  try {
    if (!await findEligible(id)) {
      return res.status(404).json({ success: false, message: "Reel unavailable." });
    }
    await db.query(
      `INSERT INTO reel_saves (user_id, reel_id) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE created_at = created_at`,
      [userId(req), id]
    );
    return res.json({ success: true, reelId: id, saved: true });
  } catch (error) {
    return unavailable(res, error);
  }
}

async function deleteSave(req, res) {
  if (!gate(req, res)) return;
  const id = reelParam(req, res);
  if (!id) return;
  try {
    // Unsave is allowed even if a previously saved Reel was unpublished.
    await db.query(
      "DELETE FROM reel_saves WHERE user_id = ? AND reel_id = ?",
      [userId(req), id]
    );
    return res.json({ success: true, reelId: id, saved: false });
  } catch (error) {
    return unavailable(res, error);
  }
}

function pageParams(query) {
  const rawPage = query.page === undefined ? "1" : query.page;
  const rawLimit = query.limit === undefined ? "20" : query.limit;
  if (typeof rawPage !== "string" || typeof rawLimit !== "string" ||
      !/^[1-9][0-9]{0,5}$/.test(rawPage) ||
      !/^[1-9][0-9]{0,2}$/.test(rawLimit)) return null;
  const page = Number(rawPage);
  const limit = Number(rawLimit);
  if (limit > 50 || !Number.isSafeInteger(page)) return null;
  return { page, limit, offset: (page - 1) * limit };
}

async function getSavedReels(req, res) {
  if (!gate(req, res)) return;
  const pagination = pageParams(req.query || {});
  if (!pagination) {
    return res.status(400).json({ success: false, message: "Invalid page or limit." });
  }
  try {
    const filter = `
      FROM reel_saves s
      INNER JOIN reels r ON r.id = s.reel_id
      LEFT JOIN videos v ON r.source_type = 'catalog' AND v.id = r.video_id
      LEFT JOIN categories c ON c.id = CASE
        WHEN r.source_type = 'catalog' THEN v.category_id ELSE r.category_id END
      WHERE s.user_id = ? AND ${eligible}`;
    const [rows] = await db.query(
      `SELECT r.id,
        r.source_type AS sourceType,
        CASE WHEN r.source_type = 'catalog' THEN v.title ELSE r.title END AS title,
        CASE WHEN r.source_type = 'catalog' THEN v.description ELSE r.description END AS description,
        c.name AS category,
        CASE WHEN r.source_type = 'catalog'
          THEN COALESCE(v.portrait_thumbnail_url, v.thumbnail_url)
          ELSE r.thumbnail_url END AS thumbnailUrl,
        CASE WHEN r.source_type = 'catalog' THEN v.video_url ELSE r.video_url END AS videoUrl,
        CASE WHEN r.source_type = 'catalog' THEN v.duration_seconds ELSE r.duration_seconds END AS durationSeconds,
        s.created_at AS savedAt
       ${filter}
       ORDER BY s.created_at DESC, s.reel_id DESC
       LIMIT ? OFFSET ?`,
      [userId(req), pagination.limit, pagination.offset]
    );
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total ${filter}`, [userId(req)]
    );
    return res.json({
      success: true,
      data: rows.map(row => ({
        id: String(row.id),
        sourceType: row.sourceType,
        title: row.title || "",
        description: row.description || "",
        category: row.category || "",
        thumbnailUrl: row.thumbnailUrl || null,
        videoUrl: row.videoUrl || null,
        durationSeconds: Number(row.durationSeconds || 0),
        savedAt: row.savedAt
      })),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: Number(countRow.total)
      }
    });
  } catch (error) {
    return unavailable(res, error);
  }
}

module.exports = { getMySave, putSave, deleteSave, getSavedReels };