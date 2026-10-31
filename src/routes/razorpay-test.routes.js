"use strict";

// KIDSOTT_RAZORPAY_TEST_ROUTES_V1
//
// Isolated development-only payment routes.
//
// IMPORTANT:
// This router is NOT mounted in the Express app yet.
//
// Intended future mount:
//   app.use("/subscriptions", razorpayTestRoutes);
//
// Endpoint after mounting:
//   POST /subscriptions/test/razorpay/orders
//
// Security middleware order:
//   1. authenticate
//   2. requireParentGrant
//   3. requireRazorpayTestAccess
//   4. createRazorpayTestOrder
//
// No production Premium activation.

const express = require("express");

const authenticate = require(
  "../middleware/auth.middleware"
);

const {
  requireParentGrant,
} = require(
  "../controllers/parent.controller"
);

const {
  requireRazorpayTestAccess,
} = require(
  "../services/razorpay-test.access"
);

const {
  createRazorpayTestOrder,
} = require(
  "../controllers/razorpay-test.controller"
);

const {
  verifyRazorpayTestPayment,
} = require(
  "../controllers/razorpay-test.verify.controller"
);
const router = express.Router();

router.post(
  "/test/razorpay/orders",
  authenticate,
  requireParentGrant,
  requireRazorpayTestAccess,
  createRazorpayTestOrder
);

router.post(
  "/test/razorpay/verify",
  authenticate,
  requireParentGrant,
  requireRazorpayTestAccess,
  verifyRazorpayTestPayment
);
module.exports = router;