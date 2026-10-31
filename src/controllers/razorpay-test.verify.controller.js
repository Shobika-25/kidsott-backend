"use strict";

// KIDSOTT_RZ15B_VERIFY_CONTROLLER_V1
// Test-only verification controller.
// Must be mounted behind:
// authenticate -> requireParentGrant -> requireRazorpayTestAccess
// No production Premium activation.

const {
  parseAllowedUserIds,
} = require("../services/razorpay-test.access");

const {
  verifyAndRecordRazorpayTestPayment,
} = require("../services/razorpay-test.verification");

function createTestVerifyController(dependencies = {}) {
  return async function handleTestVerify(req, res) {
    res.set("Cache-Control", "no-store");

    if (process.env.KIDSOTT_RAZORPAY_TEST_ENABLED !== "true") {
      return res.status(404).json({
        success: false,
        message: "Test payment verification unavailable.",
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
        message: "Test checkout unavailable for this account.",
      });
    }

    const body = req.body;

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid test payment request.",
      });
    }

    const { orderId, paymentId, signature } = body;

    if (
      typeof orderId !== "string" ||
      !/^order_[A-Za-z0-9]{1,100}$/.test(orderId) ||
      typeof paymentId !== "string" ||
      !/^pay_[A-Za-z0-9]{1,100}$/.test(paymentId) ||
      typeof signature !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(signature)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid Razorpay test payment fields.",
      });
    }

    try {
      const db =
        dependencies.db || require("../config/db");

      const verify =
        dependencies.verify ||
        verifyAndRecordRazorpayTestPayment;

      const result = await verify({
        db,
        userId,
        orderId,
        paymentId,
        signature,
      });

      if (
        !result ||
        result.provider !== "razorpay_test" ||
        result.environment !== "test" ||
        result.orderId !== orderId ||
        result.paymentId !== paymentId ||
        result.verified !== true ||
        result.premiumActivated !== false
      ) {
        throw new Error("Invalid test verification result.");
      }

      return res.status(200).json({
        success: true,
        provider: "razorpay_test",
        environment: "test",
        testPaymentVerified: true,
        orderId,
        paymentId,
        premiumActivated: false,
        message: "Test payment verified. Premium was not activated.",
      });
    } catch {
      // Do not expose signatures, API secrets or DB details.
      return res.status(503).json({
        success: false,
        testPaymentVerified: false,
        premiumActivated: false,
        message: "Unable to verify test payment.",
      });
    }
  };
}

const verifyRazorpayTestPayment =
  createTestVerifyController();

module.exports = {
  createTestVerifyController,
  verifyRazorpayTestPayment,
};