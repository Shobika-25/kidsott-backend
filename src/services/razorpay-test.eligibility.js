"use strict";

// KIDSOTT_RAZORPAY_TEST_ELIGIBILITY_V1
//
// Test-only plan eligibility.
// Does not modify production plan availability.
// Does not create orders or activate Premium.

const {
  getRazorpayTestQuote,
} = require("./razorpay-test.pricing");

const {
  parseAllowedUserIds,
} = require("./razorpay-test.access");

function requireApprovedTestAccount(userId) {
  if (
    process.env.KIDSOTT_RAZORPAY_TEST_ENABLED !== "true"
  ) {
    throw new Error(
      "Razorpay test checkout is disabled."
    );
  }

  const id = Number(userId);

  if (
    !Number.isSafeInteger(id) ||
    id <= 0
  ) {
    throw new Error(
      "Valid authenticated user is required."
    );
  }

  const allowed = parseAllowedUserIds(
    process.env.KIDSOTT_RAZORPAY_TEST_USER_IDS
  );

  if (!allowed.has(id)) {
    throw new Error(
      "Account is not approved for test checkout."
    );
  }

  return id;
}

async function getAuthorizedRazorpayTestQuote(
  db,
  userId,
  planCode
) {
  const approvedUserId =
    requireApprovedTestAccount(userId);

  const quote = await getRazorpayTestQuote(
    db,
    planCode
  );

  if (
    quote.provider !== "razorpay_test" ||
    quote.currency !== "INR" ||
    !Number.isSafeInteger(quote.amountPaise) ||
    quote.amountPaise <= 0
  ) {
    throw new Error(
      "Invalid Razorpay test quote."
    );
  }

  // This is an isolated DEVELOPMENT path.
  //
  // Production plan is_enabled remains unchanged.
  // Disabled plans are eligible only through this
  // explicitly enabled, account-allowlisted service.
  //
  // Never use this result to grant Premium access.

  return Object.freeze({
    userId: approvedUserId,
    planId: quote.planId,
    planCode: quote.planCode,
    planName: quote.planName,
    amountPaise: quote.amountPaise,
    currency: "INR",
    provider: "razorpay_test",
    environment: "test",
    productionEntitlement: false,
  });
}

module.exports = {
  requireApprovedTestAccount,
  getAuthorizedRazorpayTestQuote,
};