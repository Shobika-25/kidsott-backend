"use strict";

// KIDSOTT_ADMIN_SUBSCRIPTION_READONLY_V1
// Administrative reporting only. Never enables purchases, plans, entitlements or payments.
const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();
router.use(authenticate, requireAdmin);
router.use((req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  res.set("Pragma", "no-cache");
  next();
});

function pageParam(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function pagination(req, res) {
  const page = pageParam(req.query.page, 1, 100000);
  const pageSize = pageParam(req.query.pageSize, 50, 100);
  if (page === null || pageSize === null) {
    res.status(400).json({
      success: false,
      message: "page must be 1-100000 and pageSize must be 1-100."
    });
    return null;
  }
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function databaseError(res, label, error) {
  console.error("ADMIN SUBSCRIPTIONS " + label + " ERROR:", error && (error.code || error.name) || "unknown");
  return res.status(500).json({
    success: false,
    message: "Unable to load subscription records."
  });
}

// Verified counts of *stored records*; not financial revenue or active paid subscriptions.
router.get("/summary", async (req, res) => {
  try {
    const [[e]] = await db.query(`
      SELECT COUNT(*) AS entitlementRecords,
        COALESCE(SUM(status IN ('active', 'grace_period')), 0) AS activeEntitlementRecords,
        COALESCE(SUM(status = 'expired'), 0) AS expiredEntitlementRecords
      FROM subscription_entitlements
    `);
    const [[p]] = await db.query(`SELECT COUNT(*) AS purchaseRecords FROM subscription_purchases`);
    const [[plans]] = await db.query(`
      SELECT COUNT(*) AS totalPlans,
        COALESCE(SUM(is_enabled = 1), 0) AS enabledPlans
      FROM subscription_plans
    `);
    return res.status(200).json({
      success: true,
      summary: {
        entitlementRecords: Number(e.entitlementRecords) || 0,
        activeEntitlementRecords: Number(e.activeEntitlementRecords) || 0,
        expiredEntitlementRecords: Number(e.expiredEntitlementRecords) || 0,
        purchaseRecords: Number(p.purchaseRecords) || 0,
        totalPlans: Number(plans.totalPlans) || 0,
        enabledPlans: Number(plans.enabledPlans) || 0
      },
      revenueAvailable: false,
      paymentAmountsAvailable: false
    });
  } catch (error) {
    return databaseError(res, "SUMMARY", error);
  }
});

router.get("/plans", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, plan_code, display_name, billing_period, is_enabled,
        apple_product_id, google_product_id, google_base_plan_id, updated_at
      FROM subscription_plans
      ORDER BY FIELD(plan_code, 'monthly', 'yearly'), id ASC
    `);
    const plans = rows.map(row => ({
      id: String(row.id),
      code: String(row.plan_code),
      name: String(row.display_name),
      period: String(row.billing_period),
      isEnabled: Number(row.is_enabled) === 1,
      appleProductConfigured: Boolean(row.apple_product_id),
      googleProductConfigured: Boolean(row.google_product_id && row.google_base_plan_id),
      updatedAt: iso(row.updated_at)
    }));
    return res.status(200).json({ success: true, plans, billingIsReadOnly: true });
  } catch (error) {
    return databaseError(res, "PLANS", error);
  }
});

router.get("/memberships", async (req, res) => {
  const pg = pagination(req, res);
  if (!pg) return;
  try {
    const [[count]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM subscription_entitlements e
      INNER JOIN users u ON u.id = e.user_id AND u.role = 'user'
    `);
    const [rows] = await db.query(`
      SELECT e.id, e.user_id, u.name AS user_name, u.email AS user_email,
        e.entitlement_code, e.status AS entitlement_status,
        e.expires_at AS entitlement_expires_at,
        e.last_verified_at AS entitlement_verified_at,
        e.created_at,
        p.id AS purchase_id, p.status AS purchase_status,
        p.store, p.environment, p.auto_renewing,
        p.period_start_at, p.expires_at AS purchase_expires_at,
        p.last_verified_at AS purchase_verified_at,
        pl.id AS plan_id, pl.plan_code, pl.display_name AS plan_name,
        pl.billing_period,
        CASE WHEN e.expires_at > UTC_TIMESTAMP(3)
             AND p.expires_at > UTC_TIMESTAMP(3) THEN 1 ELSE 0 END AS period_valid
      FROM subscription_entitlements e
      INNER JOIN users u ON u.id = e.user_id AND u.role = 'user'
      LEFT JOIN subscription_purchases p
        ON p.id = e.purchase_id AND p.user_id = e.user_id
      LEFT JOIN subscription_plans pl ON pl.id = p.plan_id
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ? OFFSET ?
    `, [pg.pageSize, pg.offset]);
    const memberships = rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      userName: String(row.user_name || ""),
      userEmail: String(row.user_email || ""),
      code: String(row.entitlement_code || ""),
      entitlementStatus: String(row.entitlement_status || "inactive"),
      entitlementExpiresAt: iso(row.entitlement_expires_at),
      entitlementVerifiedAt: iso(row.entitlement_verified_at),
      createdAt: iso(row.created_at),
      purchaseId: row.purchase_id == null ? null : String(row.purchase_id),
      purchaseStatus: row.purchase_status == null ? null : String(row.purchase_status),
      store: row.store == null ? null : String(row.store),
      environment: row.environment == null ? null : String(row.environment),
      autoRenewing: Number(row.auto_renewing) === 1,
      startsAt: iso(row.period_start_at),
      purchaseExpiresAt: iso(row.purchase_expires_at),
      purchaseVerifiedAt: iso(row.purchase_verified_at),
      planId: row.plan_id == null ? null : String(row.plan_id),
      planCode: row.plan_code == null ? null : String(row.plan_code),
      planName: row.plan_name == null ? null : String(row.plan_name),
      billingPeriod: row.billing_period == null ? null : String(row.billing_period),
      verifiedPremiumActive: Boolean(
        row.purchase_id && row.entitlement_verified_at && row.purchase_verified_at &&
        Number(row.period_valid) === 1 &&
        ["active", "grace_period"].includes(row.entitlement_status) &&
        ["active", "grace_period"].includes(row.purchase_status)
      )
    }));
    const total = Number(count.total) || 0;
    return res.status(200).json({
      success: true, memberships,
      pagination: { page: pg.page, pageSize: pg.pageSize, total,
        totalPages: Math.ceil(total / pg.pageSize) }
    });
  } catch (error) {
    return databaseError(res, "MEMBERSHIPS", error);
  }
});

// Store purchase metadata only. These are NOT verified monetary payment transactions.
// Never return payment secrets, identifiers, or event payloads.
router.get("/purchases", async (req, res) => {
  const pg = pagination(req, res);
  if (!pg) return;
  try {
    const [[count]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM subscription_purchases p
      INNER JOIN users u ON u.id = p.user_id AND u.role = 'user'
    `);
    const [rows] = await db.query(`
      SELECT p.id, p.user_id, u.name AS user_name,
        p.plan_id, pl.plan_code, pl.display_name AS plan_name,
        p.store, p.environment, p.status, p.auto_renewing,
        p.period_start_at, p.expires_at, p.last_verified_at, p.created_at
      FROM subscription_purchases p
      INNER JOIN users u ON u.id = p.user_id AND u.role = 'user'
      INNER JOIN subscription_plans pl ON pl.id = p.plan_id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT ? OFFSET ?
    `, [pg.pageSize, pg.offset]);
    const purchases = rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      userName: String(row.user_name || ""),
      planId: String(row.plan_id),
      planCode: String(row.plan_code || ""),
      planName: String(row.plan_name || ""),
      store: String(row.store || ""),
      environment: String(row.environment || ""),
      status: String(row.status || ""),
      autoRenewing: Number(row.auto_renewing) === 1,
      startsAt: iso(row.period_start_at),
      expiresAt: iso(row.expires_at),
      lastVerifiedAt: iso(row.last_verified_at),
      createdAt: iso(row.created_at)
    }));
    const total = Number(count.total) || 0;
    return res.status(200).json({
      success: true, purchases,
      pagination: { page: pg.page, pageSize: pg.pageSize, total,
        totalPages: Math.ceil(total / pg.pageSize) },
      monetaryTransactionsAvailable: false
    });
  } catch (error) {
    return databaseError(res, "PURCHASES", error);
  }
});

module.exports = router;