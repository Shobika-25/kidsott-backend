"use strict";

// KIDSOTT_SUPABASE_STORAGE_SERVICE_V1
// Backend-only storage adapter. Adding this file does NOT activate cloud uploads.
// Never import this module into the Admin frontend or React Native application.
//
// SECURITY CONTRACT:
// - The upload route must authenticate and authorize an Admin first.
// - The media delivery route must check existing MySQL publish/category rules
//   (or validate an Admin preview ticket) BEFORE minting any signed URL.
// - Keep both Supabase buckets PRIVATE; never put server keys in a URL.
// - Existing /api/media/files/{images|videos}/<uuid>.<extension> URLs remain
//   the long-lived API contract. Do not save expiring signed URLs in MySQL.

const UUID_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|webm|jpg|jpeg|png|webp)$/i;
const IMAGE_MIME = Object.freeze({
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
});
const VIDEO_MIME = Object.freeze({
  mp4: "video/mp4",
  // The current Supabase video bucket allows MP4 only.
});
const BUCKETS = Object.freeze({
  images: "kidsott-images-dev",
  videos: "kidsott-videos-dev",
});
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

let client;

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getClient() {
  if (client) return client;

  const url = String(process.env.SUPABASE_URL || "").trim();
  const secret = String(
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ""
  ).trim();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) || !secret) {
    throw storageError("SUPABASE_NOT_CONFIGURED", "Backend Supabase configuration missing or invalid.");
  }

  // Loading dependencies here lets this file be syntax-checked independently.
  // Node.js 20 requires an explicit WebSocket transport in this SDK version.
  const { createClient } = require("@supabase/supabase-js");
  const WebSocket = require("ws");

  client = createClient(url, secret, {
    realtime: { transport: WebSocket },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return client;
}

function getBucketName(kind) {
  if (kind !== "images" && kind !== "videos") {
    throw storageError("INVALID_MEDIA_KIND", "Unsupported media kind.");
  }
  return BUCKETS[kind];
}

function getObjectPath(kind, filename) {
  getBucketName(kind);
  if (typeof filename !== "string" || !UUID_FILE.test(filename)) {
    throw storageError("INVALID_MEDIA_FILENAME", "Invalid media filename.");
  }

  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const supported = kind === "images" ? IMAGE_MIME : VIDEO_MIME;
  if (!Object.prototype.hasOwnProperty.call(supported, extension)) {
    throw storageError("INVALID_MEDIA_EXTENSION", "Unsupported file extension for this bucket.");
  }

  // Fixed kind prefix means callers cannot specify arbitrary folders or paths.
  return `${kind}/${filename}`;
}

// Step 06B verification: reads BUCKET METADATA ONLY. It performs no writes.
async function verifyPrivateBuckets() {
  const supabase = getClient();
  const result = {};

  for (const kind of ["images", "videos"]) {
    const bucketName = getBucketName(kind);
    const { data, error } = await supabase.storage.getBucket(bucketName);
    if (error) {
      throw storageError(
        "BUCKET_LOOKUP_FAILED",
        `${kind} bucket metadata could not be verified (${String(error.code || "unknown")}).`
      );
    }
    if (!data || data.public !== false) {
      throw storageError("BUCKET_NOT_PRIVATE", `${kind} bucket must remain private.`);
    }
    result[kind] = { name: bucketName, private: true };
  }

  return result;
}

function validImageSignature(buffer, mimeType) {
  if (mimeType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (mimeType === "image/webp") {
    return buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

// FUTURE USE ONLY: this function is NOT wired into any upload route yet.
// Call only after the existing Admin authentication, Multer and file checks.
async function uploadImageBuffer(filename, mimeType, buffer) {
  const objectPath = getObjectPath("images", filename);
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  if (IMAGE_MIME[extension] !== mimeType) {
    throw storageError("INVALID_IMAGE_MIME", "Image MIME type does not match file extension.");
  }
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw storageError("INVALID_IMAGE_SIZE", "Invalid image buffer size.");
  }
  if (!validImageSignature(buffer, mimeType)) {
    throw storageError("INVALID_IMAGE_SIGNATURE", "Invalid image content signature.");
  }

  const { data, error } = await getClient()
    .storage.from(BUCKETS.images)
    .upload(objectPath, buffer, {
      contentType: mimeType,
      upsert: false,
      cacheControl: "60",
    });

  if (error) {
    throw storageError(
      "CLOUD_UPLOAD_FAILED",
      `Supabase image upload failed (${String(error.code || "unknown")}).`
    );
  }

  // No signed or public URL is returned; use the stable backend media route.
  return { bucket: BUCKETS.images, objectPath: data.path || objectPath };
}

// KIDSOTT_SUPABASE_VIDEO_BUFFER_UPLOAD_V1
// Backend only: the caller MUST first authenticate an Admin, validate
// multipart file metadata, and check the MP4 magic bytes.
// Never return a Supabase URL to the Admin upload service.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // Supabase Free global maximum
async function uploadVideoBuffer(filename, mimeType, buffer) {
  const objectPath = getObjectPath("videos", filename);
  if (mimeType !== "video/mp4" || !filename.toLowerCase().endsWith(".mp4")) {
    throw storageError("INVALID_VIDEO_MIME", "Only MP4 video uploads are supported.");
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_VIDEO_BYTES) {
    throw storageError("INVALID_VIDEO_SIZE", "Video is empty or exceeds the storage limit.");
  }
  if (buffer.toString("ascii", 4, 8) !== "ftyp") {
    throw storageError("INVALID_VIDEO_SIGNATURE", "Invalid MP4 file signature.");
  }

  const { data, error } = await getClient()
    .storage.from(BUCKETS.videos)
    .upload(objectPath, buffer, {
      contentType: "video/mp4",
      upsert: false,
      cacheControl: "60",
    });

  if (error || !data) {
    throw storageError(
      "CLOUD_VIDEO_UPLOAD_FAILED",
      "Cloud video upload failed (" + String((error && error.code) || "unknown") + ")."
    );
  }
  return { bucket: BUCKETS.videos, objectPath: data.path || objectPath };
}
// FUTURE USE ONLY: the calling route MUST first enforce MySQL eligibility or
// an authenticated Admin preview. Never call directly for arbitrary clients.
async function createSignedReadUrl(kind, filename, expiresInSeconds = 120) {
  const bucketName = getBucketName(kind);
  const objectPath = getObjectPath(kind, filename);
  if (!Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 30 || expiresInSeconds > 900) {
    throw storageError("INVALID_SIGNED_URL_TTL", "Signed URL TTL must be 30-900 seconds.");
  }

  const { data, error } = await getClient()
    .storage.from(bucketName)
    .createSignedUrl(objectPath, expiresInSeconds);

  if (error || !data || !data.signedUrl) {
    throw storageError(
      "SIGNED_URL_FAILED",
      `Supabase signed URL could not be created (${String((error && error.code) || "unknown")}).`
    );
  }
  return data.signedUrl;
}

module.exports = Object.freeze({
  verifyPrivateBuckets,
  getBucketName,
  getObjectPath,
  uploadImageBuffer,
  uploadVideoBuffer,
  createSignedReadUrl,
});
