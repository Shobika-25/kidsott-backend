"use strict";

// KIDSOTT_RAZORPAY_TEST_ACCESS_V1
// Test-only access gate.
// Must be used AFTER authenticate and requireParentGrant.
// Does not create payments or activate Premium.

function parseAllowedUserIds(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return new Set();
  }

  const parts = raw.split(",");

  if (parts.some(part => !/^[1-9]\d*$/.test(part.trim()))) {
    return new Set();
  }

  const ids = parts.map(part => Number(part.trim()));

  if (ids.some(id => !Number.isSafeInteger(id))) {
    return new Set();
  }

  return new Set(ids);
}

function requireRazorpayTestAccess(req, res, next) {
  if (process.env.KIDSOTT_RAZORPAY_TEST_ENABLED !== "true") {
    return res.status(404).json({
      success: false,
      message: "Test checkout is unavailable.",
    });
  }

  const userId = Number(req.user?.id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return res.status(401).json({
      success: false,
      message: "Authentication required.",
    });
  }

  const allowed = parseAllowedUserIds(
    process.env.KIDSOTT_RAZORPAY_TEST_USER_IDS
  );

  if (!allowed.has(userId)) {
    return res.status(403).json({
      success: false,
      message: "Test checkout is not available for this account.",
    });
  }

  return next();
}

module.exports = {
  parseAllowedUserIds,
  requireRazorpayTestAccess,
};