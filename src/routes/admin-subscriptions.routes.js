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


// KIDSOTT_SUBSCRIPTION_ADMIN_INTEGRITY_READONLY_V1
// Admin-only, aggregate information; no tokens, receipts, monetary claims or SQL writes.
router.get("/integrity", async (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    const [planRows] = await db.query(
      `SELECT plan_code, billing_period, is_enabled,
              apple_product_id, google_product_id, google_base_plan_id
         FROM subscription_plans
        WHERE plan_code IN ('monthly', 'yearly')
        ORDER BY FIELD(plan_code, 'monthly', 'yearly')`
    );
    const [entitlementRows] = await db.query(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(status IN ('active', 'grace_period')), 0) AS accessMarkedActive,
              COALESCE(SUM(status = 'expired'), 0) AS expired,
              COALESCE(SUM(status IN ('active','grace_period') AND purchase_id IS NULL), 0) AS activeWithoutPurchase,
              COALESCE(SUM(status IN ('active','grace_period') AND last_verified_at IS NULL), 0) AS activeWithoutVerificationTimestamp,
              COALESCE(SUM(status IN ('active','grace_period') AND expires_at IS NOT NULL AND expires_at < NOW()), 0) AS activePastExpiry
         FROM subscription_entitlements`
    );
    const [purchaseRows] = await db.query(
      "SELECT COUNT(*) AS total FROM subscription_purchases"
    );
    const [eventRows] = await db.query(
      "SELECT COUNT(*) AS total FROM subscription_store_events"
    );
    const count = (value) => {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 0) {
        throw new Error("Invalid aggregate subscription result");
      }
      return number;
    };
    const plans = planRows.map(row => ({
      code: String(row.plan_code),
      period: String(row.billing_period),
      enabled: Number(row.is_enabled) === 1,
      appleProductConfigured: Boolean(row.apple_product_id),
      googleProductConfigured: Boolean(row.google_product_id && row.google_base_plan_id)
    }));
    const e = entitlementRows[0] || {};
    const integrity = {
      entitlementRecords: count(e.total ?? 0),
      accessMarkedActive: count(e.accessMarkedActive ?? 0),
      expiredEntitlements: count(e.expired ?? 0),
      activeWithoutPurchase: count(e.activeWithoutPurchase ?? 0),
      activeWithoutVerificationTimestamp: count(e.activeWithoutVerificationTimestamp ?? 0),
      activePastExpiry: count(e.activePastExpiry ?? 0),
      purchaseRecords: count(purchaseRows[0]?.total ?? 0),
      storeEventRecords: count(eventRows[0]?.total ?? 0)
    };
    const warnings = [];
    if (plans.length !== 2 || plans.some(p => !["monthly", "yearly"].includes(p.code))) {
      warnings.push("Expected monthly and yearly plan records were not both found.");
    }
    if (plans.some(p => p.enabled)) {
      warnings.push("An enabled plan was found. Confirm store validation and launch readiness before any live billing.");
    }
    if (integrity.activeWithoutPurchase > 0) {
      warnings.push("Some active/grace entitlements have no linked purchase; review their origin.");
    }
    if (integrity.activeWithoutVerificationTimestamp > 0) {
      warnings.push("Some active/grace entitlements have no recorded verification timestamp.");
    }
    if (integrity.activePastExpiry > 0) {
      warnings.push("Some entitlements remain marked active/grace after their stored expiry.");
    }
    return res.status(200).json({
      success: true,
      mode: "read_only",
      revenueAvailable: false,
      plans,
      integrity,
      warnings
    });
  } catch (error) {
    console.error("ADMIN SUBSCRIPTION INTEGRITY ERROR:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load subscription integrity information."
    });
  }
});

// KIDSOTT_SUBSCRIPTIONS_PLAN_METADATA_V2
// Admin-only catalog copy; never changes store billing, plan enablement or Premium entitlements.
router.get("/plan-metadata", async (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    const [rows] = await db.query(
      "SELECT id, description FROM subscription_plans WHERE plan_code IN ('monthly','yearly') ORDER BY id"
    );
    return res.status(200).json({
      success: true,
      metadata: rows.map(row => ({
        id: String(row.id),
        description: row.description == null ? "" : String(row.description)
      }))
    });
  } catch (error) {
    console.error("SUBSCRIPTION PLAN METADATA READ ERROR:", error.code || error.name);
    return res.status(500).json({success:false, message:"Unable to load plan details."});
  }
});

router.put("/plan-metadata/:id", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  const planId = String(req.params.id || "");
  const adminId = String(req.user?.id || "");
  if (!/^[1-9][0-9]{0,19}$/.test(planId)) {
    return res.status(400).json({success:false, message:"Invalid subscription plan ID."});
  }
  if (!/^[1-9][0-9]{0,19}$/.test(adminId)) {
    return res.status(403).json({success:false, message:"Administrator session is required."});
  }
  const payload = req.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "description,displayName" ||
      typeof payload.displayName !== "string" ||
      typeof payload.description !== "string") {
    return res.status(400).json({success:false, message:"Only plan name and description may be edited."});
  }
  const displayName = payload.displayName.trim();
  const description = payload.description.trim();
  if (displayName.length < 2 || displayName.length > 100 || description.length > 300 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(displayName + description)) {
    return res.status(400).json({success:false, message:"Plan name or description is invalid."});
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query(
      "SELECT id, plan_code, display_name, description, is_enabled FROM subscription_plans WHERE id = ? AND plan_code IN ('monthly','yearly') FOR UPDATE",
      [planId]
    );
    const old = rows[0];
    if (!old) {
      await conn.rollback();
      return res.status(404).json({success:false, message:"Subscription plan not found."});
    }
    if (Number(old.is_enabled) !== 0) {
      await conn.rollback();
      return res.status(409).json({success:false, message:"Disable billing before editing published plan details."});
    }
    const previousDescription = old.description == null ? "" : String(old.description);
    const changed = old.display_name !== displayName || previousDescription !== description;
    if (!changed) {
      await conn.rollback();
      return res.status(200).json({success:true, changed:false, message:"No changes required."});
    }
    const nextDescription = description || null;
    const [result] = await conn.query(
      "UPDATE subscription_plans SET display_name = ?, description = ? WHERE id = ? AND is_enabled = 0",
      [displayName, nextDescription, planId]
    );
    if (Number(result.affectedRows) !== 1) throw new Error("Subscription plan changed during editing");
    await conn.query(
      `INSERT INTO admin_subscription_plan_action_history
       (plan_id, actor_admin_id, previous_name, new_name, previous_description, new_description)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [planId, adminId, old.display_name, displayName, old.description, nextDescription]
    );
    await conn.commit();
    return res.status(200).json({success:true, changed:true, message:"Plan details updated."});
  } catch (error) {
    if (conn) {
      try { await conn.rollback(); } catch (_) { /* Original error takes priority. */ }
    }
    console.error("SUBSCRIPTION PLAN METADATA UPDATE ERROR:", error.code || error.name);
    return res.status(500).json({success:false, message:"Unable to save plan details."});
  } finally {
    if (conn) conn.release();
  }
});

// KIDSOTT_SUBSCRIPTION_CATALOG_V3_MOUNT
router.use("/catalog", require("./admin-subscription-catalog.routes"));

module.exports = router;