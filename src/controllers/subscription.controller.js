"use strict";

// KIDSOTT_SUBSCRIPTION_CONTROLLER_V1
//
// Read-only subscription API controllers.
// No store purchases or Premium activation here.
//
// Store verification must be implemented before
// trusted services can write active purchase records.

const db = require("../config/db");

const ENTITLEMENT_CODE = "premium";

const ACCESS_STATUSES = new Set([
  "active",
  "grace_period",
]);

function sendError(res, operation, error) {
  console.error(
    `SUBSCRIPTION ${operation} ERROR:`,
    error
  );

  return res.status(500).json({
    success: false,
    message:
      "Unable to load subscription information.",
  });
}

// GET /subscriptions/plans
//
// Returns the actual plan configuration from MySQL.
// Prices must later come from Google Play / App Store.

async function getSubscriptionPlans(req, res) {
  try {
    res.set("Cache-Control", "no-store");

    const [rows] = await db.query(
      `
        SELECT
          id,
          plan_code,
          display_name,
          billing_period,
          apple_product_id,
          google_product_id,
          google_base_plan_id,
          is_enabled
        FROM subscription_plans
        WHERE plan_code IN (
          'monthly',
          'yearly'
        )
        ORDER BY FIELD(
          plan_code,
          'monthly',
          'yearly'
        )
      `
    );

    const plans = rows.map((row) => {
      const isEnabled =
        Number(row.is_enabled) === 1;

      const availableOnIos = Boolean(
        isEnabled &&
        row.apple_product_id
      );

      const availableOnAndroid = Boolean(
        isEnabled &&
        row.google_product_id &&
        row.google_base_plan_id
      );

      return {
        id: Number(row.id),

        code: row.plan_code,
        name: row.display_name,
        period: row.billing_period,

        isEnabled,

        availableOnAndroid,
        availableOnIos,

        storeProducts: {
          appStore: row.apple_product_id,

          googlePlay: {
            productId:
              row.google_product_id,

            basePlanId:
              row.google_base_plan_id,
          },
        },
      };
    });

    return res.status(200).json({
      success: true,
      plans,

      billingEnabled: plans.some(
        (plan) =>
          plan.availableOnAndroid ||
          plan.availableOnIos
      ),

      message:
        "Subscription plans loaded.",
    });
  } catch (error) {
    return sendError(
      res,
      "PLANS",
      error
    );
  }
}

// GET /subscriptions/me
//
// Must be registered with:
//   authenticate
//   requireParentGrant
//
// Reads only the current signed-in user's records.

async function getMySubscription(req, res) {
  try {
    res.set("Cache-Control", "no-store");

    if (
      !req.user ||
      !Number.isSafeInteger(Number(req.user.id)) ||
      Number(req.user.id) <= 0
    ) {
      return res.status(401).json({
        success: false,
        message:
          "Please sign in to view your membership.",
      });
    }

    const userId = Number(req.user.id);

    const [rows] = await db.query(
      `
        SELECT
          e.entitlement_code,
          e.status AS entitlement_status,
          e.expires_at AS entitlement_expires_at,
          e.last_verified_at AS entitlement_verified_at,

          p.id AS purchase_id,
          p.status AS purchase_status,
          p.store AS purchase_store,
          p.environment AS purchase_environment,
          p.auto_renewing,
          p.expires_at AS purchase_expires_at,
          p.last_verified_at AS purchase_verified_at,

          pl.plan_code,
          pl.display_name AS plan_name,
          pl.billing_period,

          (
            e.expires_at > UTC_TIMESTAMP(3)
          ) AS entitlement_not_expired,

          (
            p.expires_at > UTC_TIMESTAMP(3)
          ) AS purchase_not_expired

        FROM subscription_entitlements e

        LEFT JOIN subscription_purchases p
          ON p.id = e.purchase_id
          AND p.user_id = e.user_id

        LEFT JOIN subscription_plans pl
          ON pl.id = p.plan_id

        WHERE e.user_id = ?
          AND e.entitlement_code = ?

        LIMIT 1
      `,
      [
        userId,
        ENTITLEMENT_CODE,
      ]
    );

    const row = rows[0];

    if (!row) {
      return res.status(200).json({
        success: true,

        entitlement: {
          code: ENTITLEMENT_CODE,
          status: "inactive",
          isActive: false,
          expiresAt: null,
        },

        subscription: null,
      });
    }

    const entitlementStatus =
      String(row.entitlement_status || "inactive");

    const purchaseStatus =
      String(row.purchase_status || "");

    const entitlementVerified =
      Boolean(row.entitlement_verified_at);

    const purchaseVerified =
      Boolean(row.purchase_verified_at);

    const datesAreValid =
      Number(row.entitlement_not_expired) === 1 &&
      Number(row.purchase_not_expired) === 1;

    // Fail closed if a matching verified purchase,
    // entitlement, or valid paid period is missing.
    const hasPremium =
      Boolean(row.purchase_id) &&
      entitlementVerified &&
      purchaseVerified &&
      ACCESS_STATUSES.has(entitlementStatus) &&
      ACCESS_STATUSES.has(purchaseStatus) &&
      datesAreValid;

    const effectiveStatus =
      !hasPremium &&
      ACCESS_STATUSES.has(entitlementStatus) &&
      !datesAreValid
        ? "expired"
        : entitlementStatus;

    const subscription =
      row.purchase_id
        ? {
            planCode: row.plan_code,
            planName: row.plan_name,
            billingPeriod: row.billing_period,

            store: row.purchase_store,
            environment:
              row.purchase_environment,

            purchaseStatus,
            autoRenewing:
              Number(row.auto_renewing) === 1,

            expiresAt:
              row.purchase_expires_at,
          }
        : null;

    return res.status(200).json({
      success: true,

      entitlement: {
        code: ENTITLEMENT_CODE,
        status: effectiveStatus,
        isActive: hasPremium,

        expiresAt:
          row.entitlement_expires_at,
      },

      subscription,
    });
  } catch (error) {
    return sendError(
      res,
      "STATUS",
      error
    );
  }
}

module.exports = {
  getSubscriptionPlans,
  getMySubscription,
};