"use strict";

// KIDSOTT_RAZORPAY_TEST_GATEWAY_V1
// Development-only payment provider adapter.
// No Express routes, MySQL writes, entitlement changes or live payments.
// No additional npm packages required.

const { createHmac, timingSafeEqual } = require("node:crypto");

const RAZORPAY_API_ORIGIN = "https://api.razorpay.com";
const REQUEST_TIMEOUT_MS = 15000;

function getTestCredentials() {
  if (process.env.KIDSOTT_RAZORPAY_TEST_ENABLED !== "true") {
    throw new Error("Razorpay test gateway is disabled.");
  }

  const keyId = String(
    process.env.RAZORPAY_TEST_KEY_ID || ""
  ).trim();

  const keySecret = String(
    process.env.RAZORPAY_TEST_KEY_SECRET || ""
  ).trim();

  if (!/^rzp_test_[A-Za-z0-9]+$/.test(keyId) || !keySecret) {
    throw new Error("Valid Razorpay TEST credentials are required.");
  }

  return { keyId, keySecret };
}

function checkAmount(amountPaise) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new TypeError(
      "Amount must be a positive integer in paise."
    );
  }
}

function checkRazorpayId(value, prefix) {
  if (
    typeof value !== "string" ||
    !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)
  ) {
    throw new TypeError(
      `Invalid Razorpay ${prefix} identifier.`
    );
  }
}

async function testApiRequest(method, path, payload) {
  const { keyId, keySecret } = getTestCredentials();

  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      `${RAZORPAY_API_ORIGIN}${path}`,
      {
        method,
        signal: controller.signal,
        headers: {
          Authorization:
            `Basic ${Buffer.from(
              `${keyId}:${keySecret}`
            ).toString("base64")}`,
          Accept: "application/json",
          ...(payload
            ? { "Content-Type": "application/json" }
            : {}),
        },
        ...(payload
          ? { body: JSON.stringify(payload) }
          : {}),
      }
    );

    const result = await response.json().catch(() => null);

    if (
      !response.ok ||
      !result ||
      typeof result !== "object"
    ) {
      throw new Error(
        `Razorpay TEST API request failed (HTTP ${response.status}).`
      );
    }

    return result;
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(
        "Razorpay TEST API request timed out."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Use only from an authenticated, parent-authorized backend route.
// The amount must come from trusted server-side plan pricing.

async function createTestOrder({ amountPaise, receipt }) {
  checkAmount(amountPaise);

  if (
    typeof receipt !== "string" ||
    !/^[A-Za-z0-9_-]{1,40}$/.test(receipt)
  ) {
    throw new TypeError(
      "Receipt must be 1-40 safe characters."
    );
  }

  const order = await testApiRequest(
    "POST",
    "/v1/orders",
    {
      amount: amountPaise,
      currency: "INR",
      receipt,
      partial_payment: false,
    }
  );

  checkRazorpayId(order.id, "order");

  if (
    order.amount !== amountPaise ||
    order.currency !== "INR"
  ) {
    throw new Error(
      "Razorpay TEST order did not match requested details."
    );
  }

  return {
    provider: "razorpay_test",
    environment: "test",
    keyId: getTestCredentials().keyId,
    orderId: order.id,
    amountPaise: order.amount,
    currency: "INR",
  };
}

// orderId must come from a backend-stored pending order.

function verifyTestCheckoutSignature({
  orderId,
  paymentId,
  signature,
}) {
  const { keySecret } = getTestCredentials();

  checkRazorpayId(orderId, "order");
  checkRazorpayId(paymentId, "pay");

  if (
    typeof signature !== "string" ||
    !/^[0-9a-fA-F]{64}$/.test(signature)
  ) {
    return false;
  }

  const expected = createHmac("sha256", keySecret)
    .update(`${orderId}|${paymentId}`, "utf8")
    .digest();

  const received = Buffer.from(signature, "hex");

  return (
    received.length === expected.length &&
    timingSafeEqual(received, expected)
  );
}

// Verify both checkout signature and captured payment
// directly with Razorpay's API.
// Returns test verification only: never grants Premium.

async function verifyCapturedTestPayment({
  orderId,
  paymentId,
  signature,
  expectedAmountPaise,
}) {
  checkAmount(expectedAmountPaise);

  if (
    !verifyTestCheckoutSignature({
      orderId,
      paymentId,
      signature,
    })
  ) {
    throw new Error(
      "Razorpay TEST checkout signature is invalid."
    );
  }

  const payment = await testApiRequest(
    "GET",
    `/v1/payments/${encodeURIComponent(paymentId)}`
  );

  if (
    payment.id !== paymentId ||
    payment.order_id !== orderId ||
    payment.amount !== expectedAmountPaise ||
    payment.currency !== "INR" ||
    payment.status !== "captured" ||
    payment.captured !== true
  ) {
    throw new Error(
      "Razorpay TEST payment is not a matching captured payment."
    );
  }

  return {
    provider: "razorpay_test",
    environment: "test",
    verified: true,
    orderId,
    paymentId,
    amountPaise: expectedAmountPaise,
    currency: "INR",
    status: "captured",
  };
}

module.exports = {
  createTestOrder,
  verifyTestCheckoutSignature,
  verifyCapturedTestPayment,
};