"use strict";

// KIDSOTT_PARENT_AUTH_CONTROLLER_V1
// Re-authenticates the signed-in account owner.
// This does not independently verify age or parent status.

const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const db = require("../config/db");

const GRANT_PURPOSE = "kidsott_subscription_parent";
const GRANT_AUDIENCE = "kidsott-subscriptions";
const GRANT_ISSUER = "kidsott";
const GRANT_SECONDS = 300;

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Development-level attempt tracking.
// A shared rate limiter is required for multi-server deployment.
const failedAttempts = new Map();

function getLoginToken(req) {
  const authorization =
    req.headers.authorization;

  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    return "";
  }

  return authorization.substring(7).trim();
}

function getParentSigningKey() {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured."
    );
  }

  // Domain separation keeps a parent grant distinct
  // from the regular account login JWT.
  return crypto
    .createHmac("sha256", secret)
    .update("kidsott-parent-grant-v1")
    .digest();
}

function fingerprintLoginToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");
}

// KIDSOTT_PARENT_LOCKOUT_FIX_V2
// Five failed attempts within 15 minutes trigger a
// 15-minute lockout beginning at the fifth failure.

function getLockout(userId) {
  const record = failedAttempts.get(userId);

  if (!record) {
    return 0;
  }

  const now = Date.now();

  if (record.lockedUntil > now) {
    return record.lockedUntil - now;
  }

  if (
    record.lockedUntil > 0 ||
    record.windowStartedAt + LOCKOUT_MS <= now
  ) {
    failedAttempts.delete(userId);
  }

  return 0;
}

function recordFailure(userId) {
  const now = Date.now();

  let record = failedAttempts.get(userId);

  if (
    !record ||
    !Number.isFinite(record.windowStartedAt) ||
    record.windowStartedAt + LOCKOUT_MS <= now
  ) {
    record = {
      count: 0,
      windowStartedAt: now,
      lockedUntil: 0,
    };
  }

  if (record.lockedUntil > now) {
    return record.lockedUntil - now;
  }

  record.count += 1;

  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
  }

  failedAttempts.set(userId, record);

  return record.lockedUntil > now
    ? record.lockedUntil - now
    : 0;
}

function clearFailures(userId) {
  failedAttempts.delete(userId);
}

function invalidCredentials(res) {
  return res.status(401).json({
    success: false,
    message: "Invalid parent account credentials.",
  });
}

async function verifyParent(req, res) {
  try {
    // Must be called AFTER existing authenticate middleware.
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "Please sign in first.",
      });
    }

    const loginToken = getLoginToken(req);

    if (!loginToken) {
      return res.status(401).json({
        success: false,
        message: "A login session is required.",
      });
    }

    const userId = Number(req.user.id);

    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid account session.",
      });
    }

    const email =
      typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password =
      typeof req.body?.password === "string"
        ? req.body.password
        : "";

    if (
      !email ||
      !password ||
      email.length > 190 ||
      password.length > 256
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter your registered email and password.",
      });
    }

    const remainingLockout = getLockout(userId);

    if (remainingLockout > 0) {
      res.set(
        "Retry-After",
        String(Math.ceil(remainingLockout / 1000))
      );

      return res.status(429).json({
        success: false,
        message:
          "Too many attempts. Please try again later.",
      });
    }

    // Identity is taken from the authenticated JWT,
    // not from an arbitrary email supplied by the client.
    const [users] = await db.query(
      `
        SELECT
          id,
          email,
          password_hash,
          role,
          is_active
        FROM users
        WHERE id = ?
        LIMIT 1
      `,
      [userId]
    );

    const user = users[0];

    const matchingAccount =
      user &&
      Boolean(user.is_active) &&
      String(user.email).trim().toLowerCase() === email;

    let passwordMatches = false;

    if (matchingAccount) {
      passwordMatches = await bcrypt.compare(
        password,
        user.password_hash
      );
    }

    if (!matchingAccount || !passwordMatches) {
      const lockout = recordFailure(userId);

      if (lockout > 0) {
        res.set(
          "Retry-After",
          String(Math.ceil(lockout / 1000))
        );

        return res.status(429).json({
          success: false,
          message:
            "Too many attempts. Please try again later.",
        });
      }

      return invalidCredentials(res);
    }

    clearFailures(userId);

    // Only the login account owner's credentials
    // have been confirmed at this point.
    const parentAccessToken = jwt.sign(
      {
        purpose: GRANT_PURPOSE,
        loginFingerprint:
          fingerprintLoginToken(loginToken),
      },
      getParentSigningKey(),
      {
        subject: String(userId),
        audience: GRANT_AUDIENCE,
        issuer: GRANT_ISSUER,
        algorithm: "HS256",
        expiresIn: GRANT_SECONDS,
      }
    );

    return res.status(200).json({
      success: true,
      reauthenticated: true,
      parentAccessToken,
      expiresInSeconds: GRANT_SECONDS,
      message:
        "Account credentials verified successfully.",
    });
  } catch (error) {
    console.error(
      "PARENT VERIFICATION ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Unable to verify account credentials.",
    });
  }
}

// Add to future subscription API routes after
// the existing authenticate middleware.
function requireParentGrant(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      message: "Account authentication is required.",
    });
  }

  const parentToken =
    req.headers["x-parent-authorization"];

  if (
    typeof parentToken !== "string" ||
    !parentToken ||
    parentToken.length > 4096
  ) {
    return res.status(403).json({
      success: false,
      message: "Parent verification is required.",
    });
  }

  const loginToken = getLoginToken(req);

  if (!loginToken) {
    return res.status(401).json({
      success: false,
      message: "Account authentication is required.",
    });
  }

  try {
    const decoded = jwt.verify(
      parentToken,
      getParentSigningKey(),
      {
        algorithms: ["HS256"],
        audience: GRANT_AUDIENCE,
        issuer: GRANT_ISSUER,
      }
    );

    if (
      typeof decoded !== "object" ||
      decoded.sub !== String(req.user.id) ||
      decoded.purpose !== GRANT_PURPOSE ||
      decoded.loginFingerprint !==
        fingerprintLoginToken(loginToken)
    ) {
      return res.status(403).json({
        success: false,
        message: "Parent authorization is invalid.",
      });
    }

    req.parentAuthorization = {
      accountId: Number(req.user.id),
      expiresAt: decoded.exp,
    };

    return next();
  } catch {
    return res.status(403).json({
      success: false,
      message:
        "Parent authorization has expired or is invalid.",
    });
  }
}

module.exports = {
  verifyParent,
  requireParentGrant,
};