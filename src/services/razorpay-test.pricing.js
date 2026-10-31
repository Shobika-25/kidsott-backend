"use strict";

// KIDSOTT_RAZORPAY_TEST_PRICING_V1
// Server-side MySQL pricing.
// No purchases, entitlement updates, or database writes.

const SUPPORTED_PLANS = new Set(["monthly", "yearly"]);

function toPaise(value) {
  const text = String(value ?? "").trim();

  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(text);

  if (!match) {
    throw new Error("Invalid subscription price.");
  }

  const rupees = Number(match[1]);
  const paise = Number((match[2] || "").padEnd(2, "0"));

  const total = rupees * 100 + paise;

  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("Subscription price must be positive.");
  }

  return total;
}

async function getRazorpayTestQuote(db, planCode) {
  if (!SUPPORTED_PLANS.has(planCode)) {
    throw new Error("Unsupported subscription plan.");
  }

  if (!db || typeof db.query !== "function") {
    throw new Error("Database connection is required.");
  }

  const [rows] = await db.query(
    `
      SELECT
        id,
        plan_code,
        display_name,
        price_amount,
        price_currency,
        is_enabled
      FROM subscription_plans
      WHERE plan_code = ?
      LIMIT 1
    `,
    [planCode]
  );

  const row = rows[0];

  if (!row || row.plan_code !== planCode) {
    throw new Error("Subscription plan not found.");
  }

  if (row.price_currency !== "INR") {
    throw new Error("Only INR test pricing is supported.");
  }

  const planId = Number(row.id);

  if (!Number.isSafeInteger(planId) || planId <= 0) {
    throw new Error("Invalid subscription plan ID.");
  }

  return {
    planId,
    planCode,
    planName: row.display_name,
    amountPaise: toPaise(row.price_amount),
    currency: "INR",
    isEnabled: Number(row.is_enabled) === 1,
    provider: "razorpay_test",
  };
}

function requireRazorpayTestCheckoutAllowed(quote) {
  if (process.env.KIDSOTT_RAZORPAY_TEST_ENABLED !== "true") {
    throw new Error("Razorpay test checkout is disabled.");
  }

  if (!quote || quote.provider !== "razorpay_test") {
    throw new Error("Invalid Razorpay test quote.");
  }

  if (quote.isEnabled !== true) {
    throw new Error("Subscription plan is disabled.");
  }

  return quote;
}

module.exports = {
  toPaise,
  getRazorpayTestQuote,
  requireRazorpayTestCheckoutAllowed,
};