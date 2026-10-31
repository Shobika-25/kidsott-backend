"use strict";

// KIDSOTT_RAZORPAY_TEST_ORDER_CONTROLLER_V1
//
// Isolated Razorpay TEST order controller.
// NOT registered in Express routes in this step.
//
// Future route MUST run these middleware in order:
//   authenticate
//   requireParentGrant
//   requireRazorpayTestAccess
//
// Writes ONLY to razorpay_test_transactions.
// Never writes subscription_purchases or subscription_entitlements.
// Never activates production Premium.

const { randomBytes } = require("node:crypto");

const {
  parseAllowedUserIds,
} = require("../services/razorpay-test.access");

const SUPPORTED_PLANS = new Set(["monthly", "yearly"]);

function makeReceipt() {
  return (
    "rt_" +
    Date.now().toString(36) +
    "_" +
    randomBytes(10).toString("hex")
  );
}

function createTestOrderController(dependencies = {}) {
  return async function handleTestOrder(req, res) {
    res.set("Cache-Control", "no-store");

    // Fail closed before database or gateway access.
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

    const allowedUsers = parseAllowedUserIds(
      process.env.KIDSOTT_RAZORPAY_TEST_USER_IDS
    );

    if (!allowedUsers.has(userId)) {
      return res.status(403).json({
        success: false,
        message: "Test checkout is not available for this account.",
      });
    }

    const planCode = req.body?.planCode;

    if (!SUPPORTED_PLANS.has(planCode)) {
      return res.status(400).json({
        success: false,
        message: "Select a valid subscription plan.",
      });
    }

    try {
      // Dependencies are injectable for offline mock testing.
      const db =
        dependencies.db || require("../config/db");

      const getQuote =
        dependencies.getQuote ||
        require("../services/razorpay-test.eligibility")
          .getAuthorizedRazorpayTestQuote;

      const gatewayCreateOrder =
        dependencies.gatewayCreateOrder ||
        require("../services/razorpay-test.gateway")
          .createTestOrder;

      // Price comes only from trusted MySQL plan data.
      const quote = await getQuote(
        db,
        userId,
        planCode
      );

      if (
        quote.userId !== userId ||
        quote.provider !== "razorpay_test" ||
        quote.environment !== "test" ||
        quote.productionEntitlement !== false ||
        quote.currency !== "INR" ||
        !Number.isSafeInteger(quote.amountPaise) ||
        quote.amountPaise <= 0
      ) {
        throw new Error("Invalid test payment quote.");
      }

      const receipt = makeReceipt();

      // Uses TEST keys only, enforced by the gateway.
      const order = await gatewayCreateOrder({
        amountPaise: quote.amountPaise,
        receipt,
      });

      if (
        order.provider !== "razorpay_test" ||
        order.environment !== "test" ||
        !/^rzp_test_[A-Za-z0-9]+$/.test(order.keyId) ||
        !/^order_[A-Za-z0-9]+$/.test(order.orderId) ||
        order.amountPaise !== quote.amountPaise ||
        order.currency !== "INR"
      ) {
        throw new Error("Test order response mismatch.");
      }

      // Isolated test table ONLY.
      const [writeResult] = await db.query(
        `
          INSERT INTO razorpay_test_transactions (
            user_id,
            plan_id,
            plan_code,
            provider,
            receipt,
            razorpay_order_id,
            amount_paise,
            currency,
            status
          )
          VALUES (
            ?, ?, ?,
            'razorpay_test',
            ?, ?, ?,
            'INR',
            'created'
          )
        `,
        [
          userId,
          quote.planId,
          quote.planCode,
          receipt,
          order.orderId,
          quote.amountPaise,
        ]
      );

      if (Number(writeResult.affectedRows) !== 1) {
        throw new Error("Test order was not stored.");
      }

      return res.status(201).json({
        success: true,
        provider: "razorpay_test",
        environment: "test",
        plan: {
          code: quote.planCode,
          name: quote.planName,
        },
        checkout: {
          keyId: order.keyId,
          orderId: order.orderId,
          amountPaise: order.amountPaise,
          currency: "INR",
        },
        premiumActivated: false,
      });
    } catch (error) {
      // Do not expose API credentials or database internals.
      console.error(
        "RAZORPAY TEST ORDER ERROR:",
        error instanceof Error ? error.message : "Unknown error"
      );

      return res.status(503).json({
        success: false,
        message: "Unable to prepare test checkout.",
      });
    }
  };
}

async function createRazorpayTestOrder(req, res) {
  const handler = createTestOrderController();
  return handler(req, res);
}

module.exports = {
  createRazorpayTestOrder,
  createTestOrderController,
};