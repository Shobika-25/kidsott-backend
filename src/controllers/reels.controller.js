"use strict";

// KIDSOTT_REELS_READ_API_V1
// Read-only metadata endpoints.
// Playback authorization will be integrated separately.

const db = require("../config/db");

function parsePagination(query) {
  const rawPage = query.page === undefined
    ? "1" : query.page;

  const rawLimit = query.limit === undefined
    ? "20" : query.limit;

  if (
    typeof rawPage !== "string" ||
    typeof rawLimit !== "string" ||
    !/^[1-9][0-9]{0,5}$/.test(rawPage) ||
    !/^[1-9][0-9]{0,2}$/.test(rawLimit)
  ) {
    return null;
  }

  const page = Number(rawPage);
  const limit = Number(rawLimit);

  if (limit > 50) {
    return null;
  }

  return {
    page,
    limit,
    offset: (page - 1) * limit
  };
}

const joins = `
  FROM reels r

  LEFT JOIN videos v
    ON r.source_type = 'catalog'
   AND v.id = r.video_id

  LEFT JOIN categories c
    ON c.id = CASE
      WHEN r.source_type = 'catalog'
        THEN v.category_id
      ELSE r.category_id
    END
`;

const fields = `
  r.id,
  r.source_type AS sourceType,
  r.video_id AS videoId,

  CASE
    WHEN r.source_type = 'catalog'
      THEN v.title
    ELSE r.title
  END AS title,

  CASE
    WHEN r.source_type = 'catalog'
      THEN v.description
    ELSE r.description
  END AS description,

  c.id AS categoryId,
  c.name AS category,

  CASE
    WHEN r.source_type = 'catalog'
      THEN COALESCE(
        v.portrait_thumbnail_url,
        v.thumbnail_url
      )
    ELSE r.thumbnail_url
  END AS thumbnailUrl,

  CASE
    WHEN r.source_type = 'catalog'
      THEN v.duration_seconds
    ELSE r.duration_seconds
  END AS durationSeconds,

  CASE
    WHEN r.source_type = 'catalog'
      THEN v.age_rating
    ELSE r.age_rating
  END AS ageRating,

  r.status,
  r.is_active AS isActive,
  r.sort_order AS sortOrder,
  r.created_at AS createdAt
`;

const eligible = `
  r.status = 'published'
  AND r.is_active = 1
  AND c.is_active = 1
  AND (
    (
      r.source_type = 'catalog'
      AND v.status = 'published'
      AND v.is_active = 1
      AND v.video_url IS NOT NULL
      AND CHAR_LENGTH(TRIM(v.video_url)) > 0
    )
    OR
    (
      r.source_type = 'upload'
      AND r.video_url IS NOT NULL
      AND CHAR_LENGTH(TRIM(r.video_url)) > 0
    )
  )
`;

function mapReel(row) {
  return {
    id: String(row.id),
    sourceType: row.sourceType,
    videoId: row.videoId == null
      ? null : String(row.videoId),
    title: row.title || "",
    description: row.description || "",
    categoryId: row.categoryId == null
      ? null : String(row.categoryId),
    category: row.category || "",
    thumbnailUrl: row.thumbnailUrl || null,
    durationSeconds: Number(row.durationSeconds || 0),
    ageRating: row.ageRating || null,
    status: row.status,
    isActive: Number(row.isActive) === 1,
    sortOrder: Number(row.sortOrder),
    createdAt: row.createdAt,
    ...(Object.prototype.hasOwnProperty.call(row, "videoUrl")
      ? { videoUrl: row.videoUrl || null }
      : {})
  };
}

function failure(res, error) {
  console.error(
    "REELS_READ_ERROR:",
    error.code || error.message
  );

  return res.status(500).json({
    success: false,
    message: "Unable to load reels."
  });
}

async function getPublishedReels(req, res) {
  const pagination = parsePagination(req.query);

  if (!pagination) {
    return res.status(400).json({
      success: false,
      message: "Invalid page or limit."
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT ${fields},
        /* KIDSOTT_REELS_PUBLIC_VIDEO_SOURCE_06EE: eligible public feed only */
        CASE WHEN r.source_type = 'catalog' THEN v.video_url
             ELSE r.video_url END AS videoUrl
        ${joins}
        WHERE ${eligible}
       ORDER BY r.sort_order ASC, r.id DESC
       LIMIT ? OFFSET ?`,
      [pagination.limit, pagination.offset]
    );

    const [[totalRow]] = await db.query(
      `SELECT COUNT(*) AS total
       ${joins}
       WHERE ${eligible}`
    );

    return res.json({
      success: true,
      data: rows.map(mapReel),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: Number(totalRow.total)
      }
    });
  } catch (error) {
    return failure(res, error);
  }
}

async function getAdminReels(req, res) {
  const pagination = parsePagination(req.query);

  if (!pagination) {
    return res.status(400).json({
      success: false,
      message: "Invalid page or limit."
    });
  }

  try {
    const [rows] = await db.query(
      `SELECT ${fields},
         -- KIDSOTT_REELS_ADMIN_VIDEO_SOURCE_V1
         CASE
           WHEN r.source_type = 'catalog'
             THEN v.video_url
           ELSE r.video_url
         END AS videoUrl
       ${joins}
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT ? OFFSET ?`,
      [pagination.limit, pagination.offset]
    );

    const [[totalRow]] = await db.query(
      "SELECT COUNT(*) AS total FROM reels"
    );

    return res.json({
      success: true,
      data: rows.map(mapReel),
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: Number(totalRow.total)
      }
    });
  } catch (error) {
    return failure(res, error);
  }
}

// KIDSOTT_REELS_CATALOG_DRAFT_V1

async function createCatalogDraftReel(req, res) {
  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    !Object.prototype.hasOwnProperty.call(body, "videoId")
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid videoId is required."
    });
  }

  const rawId = body.videoId;

  if (
    (typeof rawId !== "string" && typeof rawId !== "number") ||
    (typeof rawId === "number" && !Number.isSafeInteger(rawId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid video ID."
    });
  }

  const videoId = String(rawId);

  if (
    !/^[1-9][0-9]*$/.test(videoId) ||
    videoId.length > 20 ||
    BigInt(videoId) > 18446744073709551615n
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid video ID."
    });
  }

  try {
    const [videos] = await db.query(
      `
      SELECT
        v.id,
        v.status,
        v.is_active AS isActive,
        v.video_url AS videoUrl,
        c.is_active AS categoryActive
      FROM videos v
      INNER JOIN categories c
        ON c.id = v.category_id
      WHERE v.id = ?
      LIMIT 1
      `,
      [videoId]
    );

    if (videos.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Catalog video not found."
      });
    }

    const video = videos[0];

    if (
      video.status !== "published" ||
      Number(video.isActive) !== 1 ||
      Number(video.categoryActive) !== 1 ||
      typeof video.videoUrl !== "string" ||
      !video.videoUrl.trim()
    ) {
      return res.status(422).json({
        success: false,
        message: "Catalog video is not eligible for Reels."
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO reels (
        source_type,
        video_id,
        status,
        is_active,
        sort_order
      )
      VALUES ('catalog', ?, 'draft', 0, 0)
      `,
      [videoId]
    );

    return res.status(201).json({
      success: true,
      message: "Catalog reel draft created.",
      data: {
        id: String(result.insertId),
        sourceType: "catalog",
        videoId,
        status: "draft",
        isActive: false
      }
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "This video is already linked to Reels."
      });
    }

    if (
      error.code === "ER_NO_REFERENCED_ROW_2" ||
      error.code === "ER_NO_REFERENCED_ROW"
    ) {
      return res.status(409).json({
        success: false,
        message: "The referenced video is no longer available."
      });
    }

    console.error(
      "REELS_CATALOG_CREATE_ERROR:",
      error.code || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to create catalog reel draft."
    });
  }
}

// KIDSOTT_REELS_ACTIONS_API_05F_V1
// Admin-only, exact hosted-Aiven connection, explicitly enabled in local dev.
function reelsManagementEnabled() {
  const approvedHost = "kidsott-mysql-shobi5002-05dc.i.aivencloud.com";
  const actual = (db.pool || db)?.config?.connectionConfig;
  return process.env.NODE_ENV !== "production" &&
    process.env.KIDSOTT_REELS_ADMIN_ACTIONS_ENABLED === "true" &&
    String(process.env.DB_HOST || "").trim().toLowerCase() === approvedHost &&
    actual && actual.host === approvedHost &&
    Number(actual.port) === 10111 &&
    actual.database === "kidsott_db_v2" &&
    Boolean(actual.ssl) && actual.ssl.rejectUnauthorized !== false;
}
function reelMutationId(value) {
  if (!/^[1-9][0-9]*$/.test(String(value || ""))) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function reelMutationError(res, error) {
  console.error("REELS_ADMIN_MUTATION_ERROR:", error.code || "unknown");
  return res.status(500).json({ success: false, message: "Unable to update Reel." });
}
async function reelRowForUpdate(conn, id) {
  const [rows] = await conn.query(
    `SELECT id, source_type AS sourceType, video_id AS videoId,
      video_url AS videoUrl, category_id AS categoryId,
      status, is_active AS isActive, sort_order AS sortOrder
     FROM reels WHERE id = ? FOR UPDATE`, [id]
  );
  return rows[0] || null;
}
async function eligibleForPublication(conn, reel, overrideCategory) {
  if (reel.sourceType === "catalog") {
    const [rows] = await conn.query(
      `SELECT v.status, v.is_active AS isActive, v.video_url AS videoUrl,
         c.is_active AS categoryActive
       FROM videos v INNER JOIN categories c ON c.id = v.category_id
       WHERE v.id = ? LIMIT 1`, [reel.videoId]
    );
    const v = rows[0];
    return Boolean(v && v.status === "published" &&
      Number(v.isActive) === 1 && Number(v.categoryActive) === 1 &&
      typeof v.videoUrl === "string" && v.videoUrl.trim());
  }
  if (reel.sourceType !== "upload") return false;
  const categoryId = overrideCategory || reel.categoryId;
  const [categories] = await conn.query(
    "SELECT id FROM categories WHERE id = ? AND is_active = 1 LIMIT 1",
    [categoryId]
  );
  if (categories.length !== 1) return false;
  const match = String(reel.videoUrl || "").match(
    /^\/api\/media\/files\/videos\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.mp4)$/i
  );
  if (!match) return false;
  const uploads = require("./reels-upload.controller");
  if (typeof uploads.verifyPrivateMp4ForPublication !== "function") return false;
  return Boolean(await uploads.verifyPrivateMp4ForPublication(match[1]));
}
async function updateAdminReel(req, res) {
  if (!reelsManagementEnabled()) return res.status(404).json({ success: false, message: "Unavailable." });
  const id = reelMutationId(req.params.id);
  const input = req.body;
  if (!id || !input || typeof input !== "object" || Array.isArray(input)) {
    return res.status(400).json({ success: false, message: "Invalid Reel update." });
  }
  let conn, transaction = false;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction(); transaction = true;
    const reel = await reelRowForUpdate(conn, id);
    if (!reel) return res.status(404).json({ success: false, message: "Reel not found." });
    const catalog = reel.sourceType === "catalog";
    const allowed = catalog ? ["sortOrder"] :
      ["title", "description", "categoryId", "ageRating", "sortOrder"];
    if (Object.keys(input).length !== allowed.length ||
        Object.keys(input).some(key => !allowed.includes(key))) {
      return res.status(400).json({ success: false, message: "Unexpected or missing editable fields." });
    }
    const sortOrder = Number(input.sortOrder);
    if (!Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 1000000) {
      return res.status(400).json({ success: false, message: "Invalid sort order." });
    }
    if (catalog) {
      await conn.query(
        "UPDATE reels SET sort_order = ? WHERE id = ? AND source_type = 'catalog'",
        [sortOrder, id]
      );
    } else {
      const title = input.title, description = input.description;
      const categoryId = reelMutationId(input.categoryId);
      const rating = input.ageRating;
      if (typeof title !== "string" || title.trim().length < 2 || title.trim().length > 100 ||
          typeof description !== "string" || description.length > 500 ||
          !categoryId || !["3+", "7+", "13+"].includes(rating)) {
        return res.status(400).json({ success: false, message: "Invalid Reel metadata." });
      }
      const [categories] = await conn.query(
        "SELECT id FROM categories WHERE id = ? AND is_active = 1 LIMIT 1",
        [categoryId]
      );
      if (categories.length !== 1) {
        return res.status(422).json({ success: false, message: "Choose an active category." });
      }
      if (reel.status === "published" && Number(reel.isActive) === 1 &&
          !await eligibleForPublication(conn, reel, categoryId)) {
        return res.status(422).json({ success: false, message: "Published Reel is no longer eligible." });
      }
      await conn.query(
        `UPDATE reels SET title = ?, description = ?, category_id = ?,
         age_rating = ?, sort_order = ? WHERE id = ? AND source_type = 'upload'`,
        [title.trim(), description.trim(), categoryId, rating, sortOrder, id]
      );
    }
    await conn.commit(); transaction = false;
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { id: String(id), status: reel.status,
      isActive: Number(reel.isActive) === 1 } });
  } catch (error) { return reelMutationError(res, error); }
  finally {
    if (conn) {
      if (transaction) await conn.rollback().catch(() => {});
      conn.release();
    }
  }
}
async function changeReelVisibility(req, res) {
  if (!reelsManagementEnabled()) return res.status(404).json({ success: false, message: "Unavailable." });
  const id = reelMutationId(req.params.id);
  const body = req.body;
  if (!id || !body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || typeof body.action !== "string" ||
      !["publish", "unpublish", "activate", "deactivate"].includes(body.action)) {
    return res.status(400).json({ success: false, message: "Invalid visibility action." });
  }
  let conn, transaction = false;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction(); transaction = true;
    const reel = await reelRowForUpdate(conn, id);
    if (!reel) return res.status(404).json({ success: false, message: "Reel not found." });
    const action = body.action;
    if ((action === "publish" && reel.status !== "draft") ||
        (action === "activate" && (reel.status !== "published" || Number(reel.isActive) === 1)) ||
        (action === "deactivate" && (reel.status !== "published" || Number(reel.isActive) !== 1)) ||
        (action === "unpublish" && reel.status !== "published")) {
      return res.status(409).json({ success: false, message: "Reel state changed. Refresh and retry." });
    }
    if ((action === "publish" || action === "activate") &&
        !await eligibleForPublication(conn, reel)) {
      return res.status(422).json({ success: false,
        message: "Reel cannot become public: catalog, category or private MP4 is not eligible." });
    }
    const status = action === "unpublish" ? "draft" : "published";
    const active = action === "publish" || action === "activate" ? 1 : 0;
    await conn.query(
      "UPDATE reels SET status = ?, is_active = ? WHERE id = ?",
      [status, active, id]
    );
    await conn.commit(); transaction = false;
    res.set("Cache-Control", "no-store");
    return res.json({ success: true, data: { id: String(id), status, isActive: active === 1 } });
  } catch (error) { return reelMutationError(res, error); }
  finally {
    if (conn) {
      if (transaction) await conn.rollback().catch(() => {});
      conn.release();
    }
  }
}
module.exports = {
  getPublishedReels,
  getAdminReels,
  updateAdminReel,
  changeReelVisibility,
  createCatalogDraftReel
};