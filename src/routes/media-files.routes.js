"use strict";

const express = require("express");
const path = require("node:path");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const cloudImageStorage = require("../services/supabase-storage.service");

const db = require("../config/db");
const crypto = require("node:crypto");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();

// Must match the upload route's storage location.
const MEDIA_ROOT = path.resolve(
  __dirname,
  "../../../../KidsOTTLocalMedia"
);

const MIME_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|jpg|jpeg|png|webp)$/i;

function validMediaName(kind, filename) {
  if (
    kind !== "videos" &&
    kind !== "images"
  ) {
    return false;
  }

  if (
    typeof filename !== "string" ||
    !UUID_PATTERN.test(filename)
  ) {
    return false;
  }

  const extension = path.extname(filename)
    .toLowerCase();

  if (kind === "videos") {
    return extension === ".mp4" ||
      extension === ".webm";
  }

  return [
    ".jpg",
    ".jpeg",
    ".png",
    ".webp",
  ].includes(extension);
}

async function isPubliclyEligible(kind, filename) {
  const relativeUrl =
    "/api/media/files/" +
    kind +
    "/" +
    filename;

  // Supports either relative or absolute URLs stored
  // in the existing MySQL video metadata columns.
  const suffix = "%" + relativeUrl;

  if (kind === "videos") {
    const [rows] = await db.query(`
      SELECT v.id
      FROM videos v
      INNER JOIN categories c
        ON c.id = v.category_id
      WHERE v.status = 'published'
        AND v.is_active = 1
        AND c.is_active = 1
        AND v.video_url LIKE ?
      LIMIT 1
    `, [suffix]);

    return rows.length > 0;
  }

  // KIDSOTT_CATEGORY_IMAGE_ACCESS_V1
  // Active category artwork may be served publicly.
  // Inactive category artwork remains protected.
  if (kind === "images") {
    const [categoryRows] = await db.query(
      "SELECT id FROM categories WHERE is_active = 1 AND image_url LIKE ? LIMIT 1",
      [suffix]
    );
    if (categoryRows.length > 0) return true;
  }

  const [rows] = await db.query(`
    SELECT v.id
    FROM videos v
    INNER JOIN categories c
      ON c.id = v.category_id
    WHERE v.status = 'published'
      AND v.is_active = 1
      AND c.is_active = 1
      AND (
        v.thumbnail_url LIKE ?
        OR v.landscape_thumbnail_url LIKE ?
        OR v.portrait_thumbnail_url LIKE ?
      )
    LIMIT 1
  `, [suffix, suffix, suffix]);

  return rows.length > 0;
}

function parseRange(value, size) {
  if (!value) {
    return null;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(value);

  if (!match) {
    return false;
  }

  let start;
  let end;

  if (match[1] === "") {
    const suffixLength = Number(match[2]);

    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return false;
    }

    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);

    end = match[2] === ""
      ? size - 1
      : Number(match[2]);

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end)
    ) {
      return false;
    }

    end = Math.min(end, size - 1);
  }

  if (
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return false;
  }

  return { start, end };
}

// KIDSOTT_ADMIN_PREVIEW_V1
// A short-lived, file-specific capability URL; never include the login JWT in a URL.
const PREVIEW_TTL_MS = 10 * 60 * 1000;

function adminPreviewEnabled() {
  const host = String(process.env.DB_HOST || "").trim().toLowerCase();
  const localDb = ["localhost", "127.0.0.1", "::1"].includes(host);
  if (process.env.NODE_ENV !== "production") {
    return localDb;
  }
  // Hosted draft previews require an explicit production opt-in.
  // All existing Admin JWT, role, file-reference and ticket checks remain in force.
  return host.length > 0 && !localDb &&
    process.env.KIDSOTT_ENABLE_HOSTED_ADMIN_PREVIEW === "true";
}

function previewSigningKey() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    return null;
  }
  return crypto.createHmac("sha256", secret)
    .update("kidsott-admin-media-preview-v1")
    .digest();
}

async function referencedByVideo(kind, filename) {
  const suffix = "%/api/media/files/" + kind + "/" + filename;
  if (kind === "videos") {
    const [rows] = await db.query(
      "SELECT id FROM videos WHERE video_url LIKE ? LIMIT 1",
      [suffix]
    );
    return rows.length > 0;
  }
  // Category artwork is available to authenticated Admin previews,
  // including when the category is inactive.
  if (kind === "images") {
    const [categoryRows] = await db.query(
      "SELECT id FROM categories WHERE image_url LIKE ? LIMIT 1",
      [suffix]
    );
    if (categoryRows.length > 0) return true;
  }

  const [rows] = await db.query(
    "SELECT id FROM videos WHERE " +
      "thumbnail_url LIKE ? OR landscape_thumbnail_url LIKE ? " +
      "OR portrait_thumbnail_url LIKE ? LIMIT 1",
    [suffix, suffix, suffix]
  );
  return rows.length > 0;
}

function issuePreviewTicket(userId, kind, filename, key) {
  const expiresAt = Date.now() + PREVIEW_TTL_MS;
  const nonce = crypto.randomBytes(12).toString("hex");
  const data = Buffer.from(
    [userId, kind, filename, expiresAt, nonce].join("|"), "utf8"
  ).toString("base64url");
  const signature = crypto.createHmac("sha256", key)
    .update(data).digest("base64url");
  return { ticket: data + "." + signature, expiresAt };
}

function parsePreviewTicket(ticket, kind, filename, key) {
  if (typeof ticket !== "string" || ticket.length > 1024 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(ticket)) {
    return null;
  }
  const [data, supplied] = ticket.split(".");
  const expected = crypto.createHmac("sha256", key)
    .update(data).digest();
  const received = Buffer.from(supplied, "base64url");
  if (received.length !== expected.length ||
      !crypto.timingSafeEqual(received, expected)) {
    return null;
  }
  const fields = Buffer.from(data, "base64url")
    .toString("utf8").split("|");
  if (fields.length !== 5) return null;
  const [userText, signedKind, signedFile, expiryText, nonce] = fields;
  const userId = Number(userText);
  const expiresAt = Number(expiryText);
  const now = Date.now();
  if (!Number.isSafeInteger(userId) || userId < 1 ||
      signedKind !== kind || signedFile !== filename ||
      !/^[a-f0-9]{24}$/.test(nonce) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now ||
      expiresAt > now + PREVIEW_TTL_MS) {
    return null;
  }
  return userId;
}

async function serveMedia(req, res, allowAdminPreview = false) {
  const { kind, filename } = req.params;

  if (!validMediaName(kind, filename)) {
    return res.status(400).json({
      success: false,
      message: "Invalid media file.",
    });
  }

  try {
    // Protect unpublished and inactive videos at
    // the actual media-serving boundary.
    const eligible = allowAdminPreview || await isPubliclyEligible(
      kind,
      filename
    );

    if (!eligible) {
      return res.status(404).json({
        success: false,
        message: "Media not available.",
      });
    }

    const filepath = path.join(
      MEDIA_ROOT,
      kind,
      filename
    );

    let stat;

    try {
      stat = await fsp.stat(filepath);
    } catch (error) {
      // KIDSOTT_SUPABASE_VIDEO_READ_FALLBACK_V1
      // Eligible published media or validated Admin preview ONLY.
      // Existing local videos remain first priority; do not migrate them.
      // Cloud video bucket currently supports MP4; legacy WebM remains local.
      if (error.code === "ENOENT" && kind === "videos" &&
          filename.toLowerCase().endsWith(".mp4")) {
        try {
          const signedUrl = await cloudImageStorage.createSignedReadUrl(
            "videos", filename, 120
          );
          const targetUrl = new URL(signedUrl);
          const projectUrl = new URL(process.env.SUPABASE_URL);
          if (targetUrl.protocol !== "https:" ||
              targetUrl.host !== projectUrl.host ||
              !targetUrl.pathname.startsWith(
                "/storage/v1/object/sign/kidsott-videos-dev/videos/"
              ) ||
              !targetUrl.pathname.endsWith("/" + encodeURIComponent(filename))) {
            throw new Error("Unexpected private video redirect target.");
          }
          res.set({
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          });
          // 307 preserves the GET/HEAD method; video byte-range playback
          // and seeking must be tested separately before production.
          return res.redirect(307, signedUrl);
        } catch (cloudError) {
          console.error(
            "MEDIA CLOUD VIDEO ERROR:",
            cloudError.code || "unknown"
          );
          return res.status(404).json({
            success: false,
            message: "Media file not found.",
          });
        }
      }
      // KIDSOTT_SUPABASE_IMAGE_READ_FALLBACK_V1
      // Reach here only after MySQL publication eligibility or authorized Admin preview.
      // Always prefer an existing local file; never migrate or modify legacy files.
      if (error.code === "ENOENT" && kind === "images") {
        try {
          const signedUrl = await cloudImageStorage.createSignedReadUrl(
            "images", filename, 120
          );
          // Prevent any unintended redirect target, even if SDK behavior changes.
          const targetUrl = new URL(signedUrl);
          const projectUrl = new URL(process.env.SUPABASE_URL);
          if (targetUrl.protocol !== "https:" ||
              targetUrl.host !== projectUrl.host ||
              !targetUrl.pathname.startsWith(
                "/storage/v1/object/sign/kidsott-images-dev/images/"
              )) {
            throw new Error("Unexpected private image redirect target.");
          }
          res.set({
            "Cache-Control": "no-store",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          });
          return res.redirect(307, signedUrl);
        } catch (cloudError) {
          console.error(
            "MEDIA CLOUD IMAGE ERROR:",
            cloudError.code || "unknown"
          );
          return res.status(404).json({
            success: false,
            message: "Media file not found.",
          });
        }
      }
      if (
        error.code === "ENOENT" ||
        error.code === "EACCES"
      ) {
        return res.status(404).json({
          success: false,
          message: "Media file not found.",
        });
      }

      throw error;
    }

    if (!stat.isFile() || stat.size <= 0) {
      return res.status(404).json({
        success: false,
        message: "Media file not found.",
      });
    }

    const extension = path.extname(filename)
      .toLowerCase();

    const mime = MIME_TYPES[extension];

    res.set({
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    const range = parseRange(
      req.headers.range,
      stat.size
    );

    if (range === false) {
      res.set(
        "Content-Range",
        "bytes */" + stat.size
      );

      return res.status(416).end();
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;

    if (range) {
      res.status(206);
      res.set(
        "Content-Range",
        `bytes ${start}-${end}/${stat.size}`
      );
    } else {
      res.status(200);
    }

    res.set(
      "Content-Length",
      String(end - start + 1)
    );

    // Express routes GET handlers for HEAD requests too.
    if (req.method === "HEAD") {
      return res.end();
    }

    const stream = fs.createReadStream(filepath, {
      start,
      end,
    });

    stream.on("error", error => {
      console.error(
        "MEDIA STREAM ERROR:",
        error.code || "unknown"
      );

      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(error);
      }
    });

    stream.pipe(res);
  } catch (error) {
    console.error(
      "MEDIA FILE ERROR:",
      error.code || "unknown"
    );

    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Unable to load media.",
      });
    }

    return res.end();
  }
}

// Mint one file-scoped ticket with existing Admin JWT and role middleware.
router.post(
  "/admin-preview/:kind/:filename/ticket",
  authenticate,
  requireAdmin,
  async (req, res) => {
    try {
      if (!adminPreviewEnabled()) {
        return res.status(404).json({ success: false, message: "Unavailable." });
      }
      const { kind, filename } = req.params;
      if (!validMediaName(kind, filename)) {
        return res.status(400).json({ success: false, message: "Invalid media file." });
      }
      const key = previewSigningKey();
      if (!key) {
        return res.status(503).json({ success: false, message: "Preview configuration unavailable." });
      }
      if (!await referencedByVideo(kind, filename)) {
        return res.status(404).json({ success: false, message: "Media not available." });
      }
      const userId = Number(req.user && req.user.id);
      if (!Number.isSafeInteger(userId) || userId < 1) {
        return res.status(403).json({ success: false, message: "Access denied." });
      }
      const { ticket, expiresAt } = issuePreviewTicket(userId, kind, filename, key);
      const url = "/api/media/files/admin-preview/" +
        kind + "/" + filename + "?ticket=" + encodeURIComponent(ticket);
      res.set("Cache-Control", "no-store");
      return res.json({ success: true, url, expiresAt });
    } catch (error) {
      console.error("ADMIN PREVIEW TICKET ERROR:", error.code || "unknown");
      return res.status(500).json({ success: false, message: "Unable to prepare preview." });
    }
  }
);

// <img> and <video> cannot attach an Authorization header.
// A valid temporary capability is checked against an active Admin user
// and a saved video reference before serving the existing byte-range handler.
router.get("/admin-preview/:kind/:filename", async (req, res) => {
  try {
    if (!adminPreviewEnabled()) {
      return res.status(404).json({ success: false, message: "Unavailable." });
    }
    const { kind, filename } = req.params;
    if (!validMediaName(kind, filename)) {
      return res.status(400).json({ success: false, message: "Invalid media file." });
    }
    const key = previewSigningKey();
    if (!key) {
      return res.status(503).json({ success: false, message: "Preview configuration unavailable." });
    }
    const userId = parsePreviewTicket(req.query.ticket, kind, filename, key);
    if (!userId) {
      return res.status(403).json({ success: false, message: "Preview ticket invalid or expired." });
    }
    const [admins] = await db.query(
      "SELECT id FROM users WHERE id = ? AND role = 'admin' AND is_active = 1 LIMIT 1",
      [userId]
    );
    if (!admins.length || !await referencedByVideo(kind, filename)) {
      return res.status(404).json({ success: false, message: "Media not available." });
    }
    res.set("Referrer-Policy", "no-referrer");
    return serveMedia(req, res, true);
  } catch (error) {
    console.error("ADMIN PREVIEW FILE ERROR:", error.code || "unknown");
    return res.status(500).json({ success: false, message: "Unable to preview media." });
  }
});

// Public media remains published/active/category-eligible only.
router.get("/:kind/:filename", (req, res) => serveMedia(req, res, false));

module.exports = router;