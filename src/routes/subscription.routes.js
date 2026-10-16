"use strict";

// KIDSOTT_SUBSCRIPTION_ROUTES_V1
//
// Read-only subscription routes.
//
// Plans: authenticated account.
// Membership: authenticated account + parent grant.
//
// These endpoints do not perform purchases.

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
  getSubscriptionPlans,
  getMySubscription,
} = require(
  "../controllers/subscription.controller"
);

const router = express.Router();

// GET /subscriptions/plans
// Loads real plan configuration from MySQL.
// Store pricing and checkout are not active yet.
router.get(
  "/plans",
  authenticate,
  getSubscriptionPlans
);

// GET /subscriptions/me
// Requires current login and a valid
// short-lived parent authorization token.
//
// The parent token is provided in:
// X-Parent-Authorization: <parent-grant>
router.get(
  "/me",
  authenticate,
  requireParentGrant,
  getMySubscription
);

module.exports = router;