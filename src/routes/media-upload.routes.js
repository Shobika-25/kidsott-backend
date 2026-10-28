"use strict";

const express = require("express");
const multer = require("multer");
const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const cloudImageStorage = require("../services/supabase-storage.service");

const authenticate = require("../middleware/auth.middleware");

const router = express.Router();

// Local-only storage, outside the KidsOTT repositories.
// Do not deploy with this storage configuration.
const MEDIA_ROOT = path.resolve(
  __dirname,
  "../../../../KidsOTTLocalMedia"
);

const VIDEO_LIMIT = 500 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;

const VIDEO_TYPES = Object.freeze({
  ".mp4": "video/mp4",
  ".webm": "video/webm",
});

const IMAGE_TYPES = Object.freeze({
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
});

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Administrator access required.",
    });
  }

  return next();
}

function makeUploader(kind) {
  const isVideo = kind === "video";
  const types = isVideo ? VIDEO_TYPES : IMAGE_TYPES;
  const directory = path.join(
    MEDIA_ROOT,
    isVideo ? "videos" : "images"
  );

  const diskStorage = multer.diskStorage({
    destination(req, file, callback) {
      fs.mkdir(directory, { recursive: true })
        .then(() => callback(null, directory))
        .catch(callback);
    },

    filename(req, file, callback) {
      const extension = path.extname(
        file.originalname || ""
      ).toLowerCase();

      callback(
        null,
        crypto.randomUUID() + extension
      );
    },
  });

  // KIDSOTT_SUPABASE_IMAGE_UPLOAD_V1
  // Videos remain on local disk; only NEW images use in-memory staging.
  const storage = isVideo ? diskStorage : multer.memoryStorage();

  return multer({
    storage,

    limits: {
      fileSize: isVideo ? VIDEO_LIMIT : IMAGE_LIMIT,
      files: 1,
      fields: 0,
      parts: 1,
      headerPairs: 50,
    },

    // Keep the file filter synchronous.
    fileFilter(req, file, callback) {
      const extension = path.extname(
        file.originalname || ""
      ).toLowerCase();

      const expectedMime = types[extension];

      if (
        file.fieldname !== "file" ||
        !expectedMime ||
        file.mimetype !== expectedMime
      ) {
        const error = new Error(
          isVideo
            ? "Only MP4 and WebM videos are accepted."
            : "Only JPG, PNG and WebP images are accepted."
        );

        error.code = "INVALID_MEDIA_TYPE";
        return callback(error);
      }

      return callback(null, true);
    },
  }).single("file");
}

async function validFileSignature(file, kind) {
  const handle = await fs.open(file.path, "r");

  try {
    const header = Buffer.alloc(24);

    const { bytesRead } = await handle.read(
      header,
      0,
      header.length,
      0
    );

    if (bytesRead < 12) {
      return false;
    }

    const extension = path.extname(
      file.filename
    ).toLowerCase();

    if (kind === "video") {
      if (extension === ".mp4") {
        return header.toString("ascii", 4, 8) === "ftyp";
      }

      if (extension === ".webm") {
        return header.subarray(0, 4).equals(
          Buffer.from([0x1a, 0x45, 0xdf, 0xa3])
        );
      }

      return false;
    }

    if (extension === ".jpg" || extension === ".jpeg") {
      return header.subarray(0, 3).equals(
        Buffer.from([0xff, 0xd8, 0xff])
      );
    }

    if (extension === ".png") {
      return header.subarray(0, 8).equals(
        Buffer.from([
          0x89, 0x50, 0x4e, 0x47,
          0x0d, 0x0a, 0x1a, 0x0a,
        ])
      );
    }

    if (extension === ".webp") {
      return (
        header.toString("ascii", 0, 4) === "RIFF" &&
        header.toString("ascii", 8, 12) === "WEBP"
      );
    }

    return false;
  } finally {
    await handle.close();
  }
}

function validMemoryImageSignature(file) {
  if (!file || !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 || file.buffer.length !== file.size) {
    return false;
  }
  const bytes = file.buffer;
  const extension = path.extname(file.filename || "").toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes.length >= 3 &&
      bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  }
  if (extension === ".png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (extension === ".webp") {
    return bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}
async function removeRejectedFile(file) {
  if (!file || !file.path) {
    return;
  }

  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(
        "MEDIA CLEANUP ERROR:",
        error.code || "unknown"
      );
    }
  }
}

function uploadHandler(kind) {
  const uploader = makeUploader(kind);

  return (req, res) => {
    uploader(req, res, async error => {
      if (error) {
        await removeRejectedFile(req.file);

        const status =
          error.code === "LIMIT_FILE_SIZE" ? 413 :
          error.code === "INVALID_MEDIA_TYPE" ? 415 :
          error instanceof multer.MulterError ? 400 :
          500;

        if (status === 500) {
          console.error(
            "MEDIA UPLOAD ERROR:",
            error.code || "unknown"
          );
        }

        return res.status(status).json({
          success: false,
          message:
            status === 413
              ? "File exceeds the allowed size."
              : status === 415
                ? error.message
                : status === 400
                  ? "Invalid upload request. Select one file."
                  : "Unable to upload file.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "Select a file to upload.",
        });
      }

      try {
        // KIDSOTT_SUPABASE_MEMORY_IMAGE_FILENAME_V1
        // Multer memoryStorage supplies `buffer`, not `filename`.
        // Generate the same UUID.extension contract as the old disk route.
        if (kind === "image") {
          const extension = path.extname(
            req.file.originalname || ""
          ).toLowerCase();
          if (!Object.prototype.hasOwnProperty.call(IMAGE_TYPES, extension) ||
              IMAGE_TYPES[extension] !== req.file.mimetype) {
            return res.status(415).json({
              success: false,
              message: "Unsupported image content.",
            });
          }
          req.file.filename = crypto.randomUUID() + extension;
        }

        const signatureValid = kind === "image"
          ? validMemoryImageSignature(req.file)
          : await validFileSignature(req.file, kind);

        if (!signatureValid) {
          await removeRejectedFile(req.file);

          return res.status(415).json({
            success: false,
            message:
              "File content does not match the supported format.",
          });
        }

        // KIDSOTT_SUPABASE_IMAGE_UPLOAD_V1: cloud-only for future images.
        // Re-run signature validation inside the storage adapter before writing.
        if (kind === "image") {
          await cloudImageStorage.uploadImageBuffer(
            req.file.filename,
            req.file.mimetype,
            req.file.buffer
          );
        }
        // KIDSOTT_SUPABASE_NEW_MP4_UPLOAD_V1
        // Only NEW MP4 files go to private Supabase Storage.
        // Multer first stages the new file on local disk so large files
        // never consume up to 500 MB of RAM. Old files are never touched.
        // New WebM video uploads remain local and unchanged.
        if (kind === "video" &&
            path.extname(req.file.filename || "").toLowerCase() === ".mp4") {
          const expectedDirectory = path.join(MEDIA_ROOT, "videos");
          if (!req.file.path ||
              path.dirname(path.resolve(req.file.path)) !== expectedDirectory ||
              path.basename(req.file.path) !== req.file.filename) {
            throw new Error("Unexpected MP4 staging path.");
          }
          const cloudVideoMaxBytes = 52428800;
          if (!Number.isSafeInteger(req.file.size) ||
              req.file.size > cloudVideoMaxBytes) {
            await removeRejectedFile(req.file);
            return res.status(413).json({
              success: false,
              message: "MP4 exceeds the 50 MB Supabase storage limit.",
            });
          }
          const mp4Buffer = await fs.readFile(req.file.path);
          await cloudImageStorage.uploadVideoBuffer(
            req.file.filename,
            req.file.mimetype,
            mp4Buffer
          );
          // Delete ONLY this newly staged upload after cloud success.
          // If this fails, return an error; never claim clean cloud-only storage.
          await fs.unlink(req.file.path);
        }
        const folder = kind === "video"
          ? "videos"
          : "images";

        const relativeUrl =
          "/api/media/files/" +
          folder +
          "/" +
          encodeURIComponent(req.file.filename);

        return res.status(201).json({
          success: true,
          kind,
          fileName: req.file.filename,
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          relativeUrl,
        });
      } catch (validationError) {
        if (kind === "video" && validationError &&
            ["CLOUD_VIDEO_UPLOAD_FAILED", "INVALID_VIDEO_MIME",
             "INVALID_VIDEO_SIZE", "INVALID_VIDEO_SIGNATURE",
             "INVALID_MEDIA_FILENAME", "INVALID_MEDIA_EXTENSION",
             "SUPABASE_NOT_CONFIGURED"].includes(validationError.code)) {
          console.error("MEDIA SUPABASE VIDEO ERROR:", validationError.code);
          await removeRejectedFile(req.file);
          const badInput = String(validationError.code).startsWith("INVALID_");
          const status = badInput ? 415 :
            validationError.code === "SUPABASE_NOT_CONFIGURED" ? 503 : 502;
          return res.status(status).json({
            success: false,
            message: badInput ? "Unsupported MP4 content." :
              "Unable to store video in cloud storage.",
          });
        }
        if (kind === "image" &&
            ["CLOUD_UPLOAD_FAILED", "SUPABASE_NOT_CONFIGURED",
             "INVALID_MEDIA_SIGNATURE", "INVALID_IMAGE_SIGNATURE",
             "INVALID_IMAGE_MIME", "INVALID_IMAGE_SIZE"].includes(
              validationError && validationError.code
            )) {
          console.error(
            "MEDIA SUPABASE IMAGE ERROR:",
            validationError.code
          );
          const clientError = validationError.code.startsWith("INVALID_");
          return res.status(clientError ? 415 :
            validationError.code === "SUPABASE_NOT_CONFIGURED" ? 503 : 502
          ).json({
            success: false,
            message: clientError
              ? "Unsupported image content."
              : "Unable to store image in cloud storage.",
          });
        }
        await removeRejectedFile(req.file);

        console.error(
          "MEDIA VALIDATION ERROR:",
          validationError.code || "unknown"
        );

        return res.status(500).json({
          success: false,
          message: "Unable to validate uploaded file.",
        });
      }
    });
  };
}

// Both endpoints require a valid Admin session.
router.use(authenticate, requireAdmin);

// multipart/form-data, field name: file
router.post(
  "/video",
  uploadHandler("video")
);

router.post(
  "/image",
  uploadHandler("image")
);

module.exports = router;