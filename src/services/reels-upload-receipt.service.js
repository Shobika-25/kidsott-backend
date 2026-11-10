"use strict";

// KIDSOTT_REELS_UPLOAD_RECEIPT_V1
// HMAC receipt utility. No database or storage access.

const crypto = require("node:crypto");

const PURPOSE = "kidsott-reels-upload-receipt-v1:";
const TTL_SECONDS = 10 * 60;
const MAX_TOKEN_LENGTH = 1024;
const MAX_ID = 18446744073709551615n;

const FILE_RE =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.mp4$/i;

function receiptsEnabled() {
  return process.env.KIDSOTT_REELS_UPLOAD_RECEIPT_ENABLED === "true";
}

function signingKey() {
  const hex = process.env.KIDSOTT_REELS_RECEIPT_KEY;

  return typeof hex === "string" &&
    /^[a-f0-9]{64}$/i.test(hex)
    ? Buffer.from(hex, "hex")
    : null;
}

function isConfigured() {
  return signingKey() !== null;
}

function normalizeId(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 1) {
      return null;
    }

    value = String(value);
  }

  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value)
  ) {
    return null;
  }

  return BigInt(value) <= MAX_ID ? value : null;
}

function sign(payload, key) {
  return crypto
    .createHmac("sha256", key)
    .update(PURPOSE, "utf8")
    .update(payload, "ascii")
    .digest();
}

function issueReceipt(adminId, fileName) {
  if (!receiptsEnabled()) {
    throw new Error("REELS_RECEIPT_DISABLED");
  }

  const key = signingKey();
  const id = normalizeId(adminId);

  if (!key) {
    throw new Error("REELS_RECEIPT_KEY_MISSING");
  }

  if (
    !id ||
    typeof fileName !== "string" ||
    !FILE_RE.test(fileName)
  ) {
    throw new Error("REELS_RECEIPT_INVALID_INPUT");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + TTL_SECONDS;

  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      adminId: id,
      fileName,
      issuedAt,
      expiresAt,
      nonce: crypto.randomBytes(16).toString("hex")
    }),
    "utf8"
  ).toString("base64url");

  const receipt =
    payload + "." +
    sign(payload, key).toString("base64url");

  return {
    receipt,
    expiresAt: new Date(expiresAt * 1000).toISOString()
  };
}

function verifyReceipt(receipt, adminId, fileName) {
  if (!receiptsEnabled()) {
    return false;
  }

  const key = signingKey();
  const id = normalizeId(adminId);

  if (
    !key ||
    !id ||
    typeof fileName !== "string" ||
    !FILE_RE.test(fileName)
  ) {
    return false;
  }

  if (
    typeof receipt !== "string" ||
    receipt.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(receipt)
  ) {
    return false;
  }

  const [payload, encodedSignature] = receipt.split(".");

  const signature = Buffer.from(
    encodedSignature, "base64url"
  );

  const expected = sign(payload, key);

  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(signature, expected)
  ) {
    return false;
  }

  let claims;

  try {
    claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );
  } catch {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);

  return Boolean(
    claims &&
    claims.v === 1 &&
    claims.adminId === id &&
    claims.fileName === fileName &&
    Number.isSafeInteger(claims.issuedAt) &&
    Number.isSafeInteger(claims.expiresAt) &&
    claims.expiresAt - claims.issuedAt === TTL_SECONDS &&
    claims.issuedAt <= now + 30 &&
    now < claims.expiresAt &&
    typeof claims.nonce === "string" &&
    /^[a-f0-9]{32}$/.test(claims.nonce)
  );
}

module.exports = Object.freeze({
  receiptsEnabled,
  isConfigured,
  issueReceipt,
  verifyReceipt
});