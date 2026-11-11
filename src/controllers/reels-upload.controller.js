"use strict";

// KIDSOTT_REELS_UPLOAD_DRAFT_V1
// Private Supabase MP4 -> Hosted Aiven draft metadata.

const crypto = require("node:crypto");
const db = require("../config/db");
const storage = require("../services/supabase-storage.service");
const receiptService = require("../services/reels-upload-receipt.service");

const APPROVED_HOST =
  "kidsott-mysql-shobi5002-05dc.i.aivencloud.com";

const APPROVED_DATABASE = "kidsott_db_v2";

const MAX_ID = 18446744073709551615n;

const FILE_PATTERN =
  /^\/api\/media\/files\/videos\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4)$/i;

// KIDSOTT_REELS_UPLOAD_COVER_ABSOLUTE_40C2
const IMAGE_PATTERN =
  /^(?:https:\/\/kidsott-backend\.onrender\.com)?\/api\/media\/files\/images\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

function requireHostedAiven(req, res, next) {
  const config = (
    db.pool || db
  )?.config?.connectionConfig;

  if (
    !config ||
    config.host !== APPROVED_HOST ||
    Number(config.port) !== 10111 ||
    config.database !== APPROVED_DATABASE ||
    !config.ssl ||
    config.ssl.rejectUnauthorized === false
  ) {
    return res.status(503).json({
      success: false,
      message: "Hosted Reels database configuration required."
    });
  }

  if (
    process.env.KIDSOTT_REELS_UPLOAD_DRAFT_ENABLED !== "true"
  ) {
    return res.status(404).json({
      success: false,
      message: "Reel upload registration is not enabled."
    });
  }

  next();
}

function text(value, max, required = true) {
  if (typeof value !== "string") return null;

  const result = value.trim();

  if (
    result.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(result) ||
    (required && !result)
  ) {
    return null;
  }

  return result;
}

function positiveId(value) {
  if (
    typeof value !== "string" &&
    !(typeof value === "number" && Number.isSafeInteger(value))
  ) {
    return null;
  }

  const raw = String(value);

  if (!/^[1-9][0-9]{0,19}$/.test(raw)) {
    return null;
  }

  const parsed = BigInt(raw);

  return parsed <= MAX_ID ? raw : null;
}

function validate(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return null;
  }

  const allowed = new Set([
    "title",
    "description",
    "categoryId",
    "videoUrl",
    "thumbnailUrl",
    "durationSeconds",
    "ageRating",
    "uploadReceipt"
  ]);

  if (Object.keys(body).some(key => !allowed.has(key))) {
    return null;
  }

  const title = text(body.title, 200);
  const description = body.description === undefined
    ? ""
    : text(body.description, 2000, false);

  const ageRating = text(body.ageRating, 30);
  const categoryId = positiveId(body.categoryId);

  const videoUrl = text(body.videoUrl, 250);
  const match = videoUrl && FILE_PATTERN.exec(videoUrl);

  const duration = body.durationSeconds;

  const thumbnail = body.thumbnailUrl == null ||
    body.thumbnailUrl === ""
    ? null
    : text(body.thumbnailUrl, 250);

  if (
    !title ||
    description === null ||
    !ageRating ||
    !categoryId ||
    !match ||
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    duration > 180 ||
    (thumbnail !== null && !IMAGE_PATTERN.test(thumbnail))
  ) {
    return null;
  }

  return {
    title,
    description,
    ageRating,
    categoryId,
    videoUrl,
    filename: match[1],
    thumbnailUrl: thumbnail,
    duration
  };
}

async function verifyPrivateMp4(filename) {
  const signedUrl = await storage.createSignedReadUrl(
    "videos",
    filename,
    60
  );

  const expectedProject = new URL(
    process.env.SUPABASE_URL
  );

  const target = new URL(signedUrl);

  const expectedPath =
    "/storage/v1/object/sign/" +
    storage.getBucketName("videos") +
    "/" +
    storage.getObjectPath("videos", filename);

  if (
    expectedProject.protocol !== "https:" ||
    target.protocol !== "https:" ||
    target.host !== expectedProject.host ||
    target.pathname !== expectedPath
  ) {
    throw new Error("INVALID_PRIVATE_MEDIA_TARGET");
  }

  // Check a tiny byte range, without retrieving the entire MP4.
  const response = await fetch(signedUrl, {
    method: "GET",
    headers: {
      Range: "bytes=0-0"
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000)
  });

  try {
    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();

    return (
      (response.status === 200 || response.status === 206) &&
      contentType.startsWith("video/mp4")
    );
  } finally {
    if (response.body) {
      await response.body.cancel();
    }
  }
}

async function createUploadedReelDraft(req, res) {
  const input = validate(req.body);

  if (!input) {
    return res.status(400).json({
      success: false,
      message:
        "Invalid Reel metadata. Use an uploaded MP4, " +
        "a valid category and duration from 1 to 180 seconds."
    });
  }

  // KIDSOTT_REELS_RECEIPT_ENFORCEMENT_V1
  // Validate ownership before Supabase or MySQL access.
  const suppliedReceipt = req.body.uploadReceipt;

  if (
    typeof suppliedReceipt !== "string" ||
    suppliedReceipt.length === 0 ||
    suppliedReceipt.length > 1024
  ) {
    return res.status(400).json({
      success: false,
      message: "A valid upload receipt is required."
    });
  }

  if (!receiptService.receiptsEnabled()) {
    return res.status(404).json({
      success: false,
      message: "Reels receipt verification is disabled."
    });
  }

  if (!receiptService.isConfigured()) {
    return res.status(503).json({
      success: false,
      message: "Reels receipt verification is unavailable."
    });
  }

  const adminId = req.user && req.user.id;

  if (
    !receiptService.verifyReceipt(
      suppliedReceipt,
      adminId,
      input.filename
    )
  ) {
    return res.status(403).json({
      success: false,
      message: "Upload receipt is invalid or expired."
    });
  }

  try {
    const verified = await verifyPrivateMp4(input.filename);

    if (!verified) {
      return res.status(422).json({
        success: false,
        message: "Uploaded private MP4 could not be verified."
      });
    }
  } catch (error) {
    console.error(
      "REELS_PRIVATE_MEDIA_CHECK:",
      error.code || error.name || "UNKNOWN"
    );

    return res.status(503).json({
      success: false,
      message: "Private media verification unavailable."
    });
  }

  let connection;
  let lockAcquired = false;

  const lockName =
    "kidsott-reel-" +
    crypto.createHash("sha256")
      .update(input.filename)
      .digest("hex")
      .slice(0, 40);

  try {
    connection = await db.getConnection();

    const [[identity]] = await connection.query(
      "SELECT DATABASE() AS dbName"
    );

    if (identity.dbName !== APPROVED_DATABASE) {
      throw new Error("UNEXPECTED_DATABASE");
    }

    const [[lock]] = await connection.query(
      "SELECT GET_LOCK(?, 5) AS acquired",
      [lockName]
    );

    if (Number(lock.acquired) !== 1) {
      return res.status(503).json({
        success: false,
        message: "Reel registration is busy. Try again."
      });
    }

    lockAcquired = true;

    const [categories] = await connection.query(
      `SELECT id
       FROM categories
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [input.categoryId]
    );

    if (categories.length !== 1) {
      return res.status(422).json({
        success: false,
        message: "An active category is required."
      });
    }

    const [existing] = await connection.query(
      `SELECT id
       FROM reels
       WHERE source_type = 'upload'
         AND video_url = ?
       LIMIT 1`,
      [input.videoUrl]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "This uploaded MP4 already has a Reel record."
      });
    }

    // KIDSOTT_REELS_CATALOG_MEDIA_COLLISION_V1
    // Never register media already owned by the videos catalog.
    // Preserve all existing video records and original media URLs.
    const [catalogMedia] = await connection.query(
      `SELECT id
       FROM videos
       WHERE video_url = ?
          OR video_url LIKE ?
       LIMIT 1`,
      [
        input.videoUrl,
        "%" + input.videoUrl
      ]
    );

    if (catalogMedia.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "This media belongs to the existing video catalog. " +
          "Use the catalog Reels linking feature instead."
      });
    }

    const [result] = await connection.query(
      `INSERT INTO reels (
        source_type,
        video_id,
        title,
        description,
        category_id,
        video_url,
        thumbnail_url,
        duration_seconds,
        age_rating,
        status,
        is_active,
        sort_order
      ) VALUES (
        'upload', NULL, ?, ?, ?, ?, ?, ?, ?,
        'draft', 0, 0
      )`,
      [
        input.title,
        input.description,
        input.categoryId,
        input.videoUrl,
        input.thumbnailUrl,
        input.duration,
        input.ageRating
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Uploaded Reel draft created.",
      data: {
        id: String(result.insertId),
        sourceType: "upload",
        title: input.title,
        status: "draft",
        isActive: false,
        videoUrl: input.videoUrl
      }
    });
  } catch (error) {
    console.error(
      "REELS_UPLOAD_DRAFT_ERROR:",
      error.code || error.message
    );

    return res.status(500).json({
      success: false,
      message: "Unable to register uploaded Reel draft."
    });
  } finally {
    if (connection) {
      try {
        if (lockAcquired) {
          await connection.query(
            "SELECT RELEASE_LOCK(?)",
            [lockName]
          );
        }
      } finally {
        connection.release();
      }
    }
  }
}

module.exports = {
  requireHostedAiven,
  createUploadedReelDraft
};

// KIDSOTT_REELS_PUBLICATION_VERIFY_05F_V1
module.exports.verifyPrivateMp4ForPublication = verifyPrivateMp4;
