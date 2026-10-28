"use strict";
// KIDSOTT_SUBSCRIPTION_CATALOG_V3
// Admin plan catalogue only. Never creates payments, activates store billing or grants access.
const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");
const router = express.Router();
router.use(authenticate, requireAdmin);

const SELECT_PLANS = `SELECT p.id, p.plan_code, p.display_name, p.description,
  p.billing_period, p.price_amount, p.price_currency, p.trial_days,
  p.max_profiles, p.access_level, p.features_json,
  p.apple_product_id, p.google_product_id, p.google_base_plan_id,
  p.is_enabled, p.updated_at,
  (SELECT COUNT(*) FROM subscription_purchases sp WHERE sp.plan_id = p.id) AS purchase_count
  FROM subscription_plans p`;
const allowedKeys = ["code", "name", "description", "period", "price", "currency", "trialDays", "maxProfiles", "access", "features", "appleProductId", "googleProductId", "googleBasePlanId"];
const control = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const periodSet = new Set(["monthly", "yearly"]);
const currencySet = new Set(["INR", "USD", "AED"]);
const accessSet = new Set(["standard", "premium", "all_content"]);

function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).sort().join("|") !== [...allowedKeys].sort().join("|")) {
    return { error: "Invalid plan form or unsupported fields." };
  }
  const trimmed = (field, max, min = 0) =>
    typeof body[field] === "string" && !control.test(body[field]) &&
    body[field].trim().length >= min && body[field].trim().length <= max
      ? body[field].trim() : null;
  const code = trimmed("code", 30, 3);
  const name = trimmed("name", 100, 2);
  const description = trimmed("description", 300, 0);
  const appleProductId = trimmed("appleProductId", 190, 0);
  const googleProductId = trimmed("googleProductId", 190, 0);
  const googleBasePlanId = trimmed("googleBasePlanId", 120, 0);
  if (!code || !/^[a-z][a-z0-9_-]{2,29}$/.test(code) ||
      !name || description === null || appleProductId === null ||
      googleProductId === null || googleBasePlanId === null ||
      (googleBasePlanId && !googleProductId) ||
      !periodSet.has(body.period) || !currencySet.has(body.currency) ||
      !accessSet.has(body.access) || !Number.isInteger(body.trialDays) ||
      body.trialDays < 0 || body.trialDays > 365 ||
      !Number.isInteger(body.maxProfiles) || body.maxProfiles < 1 || body.maxProfiles > 20 ||
      !Array.isArray(body.features) || body.features.length > 20 ||
      body.features.some(x => typeof x !== "string" || !x.trim() || x.trim().length > 100 || control.test(x)) ||
      (body.price !== null && (typeof body.price !== "number" ||
        !Number.isFinite(body.price) || body.price < 0 || body.price > 99999999.99 ||
        Math.abs(Math.round(body.price * 100) - body.price * 100) > 0.000001))) {
    return { error: "Check the plan code, price, features, store identifiers and required fields." };
  }
  const features = [...new Set(body.features.map(x => x.trim()))];
  return { value: { code, name, description, period: body.period,
    price: body.price, currency: body.currency, trialDays: body.trialDays,
    maxProfiles: body.maxProfiles, access: body.access, features,
    appleProductId: appleProductId || null, googleProductId: googleProductId || null,
    googleBasePlanId: googleBasePlanId || null } };
}
function publicPlan(p) {
  const parsed = p.features_json ? JSON.parse(p.features_json) : [];
  if (!Array.isArray(parsed) || parsed.some(x => typeof x !== "string")) throw new Error("Corrupt plan features");
  return { id: String(p.id), code: p.plan_code, name: p.display_name,
    description: p.description || "", period: p.billing_period,
    price: p.price_amount == null ? null : Number(p.price_amount),
    currency: p.price_currency, trialDays: Number(p.trial_days),
    maxProfiles: Number(p.max_profiles), access: p.access_level,
    features: parsed, appleProductId: p.apple_product_id || "",
    googleProductId: p.google_product_id || "", googleBasePlanId: p.google_base_plan_id || "",
    isEnabled: Number(p.is_enabled) === 1, purchaseCount: Number(p.purchase_count || 0),
    updatedAt: p.updated_at instanceof Date ? p.updated_at.toISOString() : String(p.updated_at || "") };
}
function fail(res, operation, error) {
  console.error("SUBSCRIPTION CATALOG", operation, error.code || error.name || "UNKNOWN");
  return res.status(500).json({ success: false, message: "Unable to process subscription plan." });
}
function sessionAdmin(req, res) {
  const id = String(req.user?.id || "");
  if (!/^[1-9][0-9]{0,19}$/.test(id)) {
    res.status(403).json({ success: false, message: "Administrator authentication is required." });
    return null;
  }
  return id;
}
function noStoreChanges(old, current) {
  return Number(old.is_enabled) === 0 && Number(old.purchase_count) === 0;
}

router.get("/", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  try {
    const [rows] = await db.query(SELECT_PLANS + " ORDER BY p.id");
    return res.status(200).json({ success: true, plans: rows.map(publicPlan), billingWritesEnabled: false });
  } catch (error) { return fail(res, "LIST", error); }
});

router.post("/", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const actorId = sessionAdmin(req, res);
  if (!actorId) return;
  const checked = validate(req.body);
  if (checked.error) return res.status(400).json({success:false, message: checked.error});
  const p = checked.value;
  if (p.code === "monthly" || p.code === "yearly") {
    return res.status(409).json({success:false,message:"These plan codes are reserved for the existing subscriptions."});
  }
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO subscription_plans
      (plan_code, display_name, description, billing_period, price_amount, price_currency,
       trial_days, max_profiles, access_level, features_json, apple_product_id,
       google_product_id, google_base_plan_id, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [p.code, p.name, p.description || null, p.period, p.price, p.currency,
       p.trialDays, p.maxProfiles, p.access, JSON.stringify(p.features),
       p.appleProductId, p.googleProductId, p.googleBasePlanId]
    );
    const planId = String(result.insertId);
    await conn.query(
      `INSERT INTO admin_subscription_catalog_history
       (plan_id, actor_admin_id, action_type, previous_json, next_json)
       VALUES (?, ?, 'created', NULL, ?)`,
      [planId, actorId, JSON.stringify(p)]
    );
    await conn.commit();
    return res.status(201).json({success:true, id:planId, message:"Plan created. Store billing remains disabled."});
  } catch (error) {
    if (conn) { try { await conn.rollback(); } catch (_) {} }
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({success:false, message:"Plan code already exists."});
    return fail(res, "CREATE", error);
  } finally { if (conn) conn.release(); }
});

router.put("/:id", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  const actorId = sessionAdmin(req, res);
  if (!actorId) return;
  const planId = String(req.params.id || "");
  if (!/^[1-9][0-9]{0,19}$/.test(planId)) return res.status(400).json({success:false,message:"Invalid plan ID."});
  const checked = validate(req.body);
  if (checked.error) return res.status(400).json({success:false,message:checked.error});
  const p = checked.value;
  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [rows] = await conn.query(SELECT_PLANS + " WHERE p.id = ? FOR UPDATE", [planId]);
    const old = rows[0];
    if (!old) { await conn.rollback(); return res.status(404).json({success:false,message:"Plan not found."}); }
    if (!noStoreChanges(old, p)) { await conn.rollback(); return res.status(409).json({success:false,message:"Plans with billing activity cannot be edited here."}); }
    if (p.code !== old.plan_code) { await conn.rollback(); return res.status(400).json({success:false,message:"Plan code cannot be changed."}); }
    if ((old.plan_code === "monthly" || old.plan_code === "yearly") && p.period !== old.billing_period) {
      await conn.rollback(); return res.status(400).json({success:false,message:"The default plan billing cycle cannot be changed."});
    }
    const previous = publicPlan(old);
    const changed = p.name !== previous.name || p.description !== previous.description ||
      p.period !== previous.period || p.price !== previous.price || p.currency !== previous.currency ||
      p.trialDays !== previous.trialDays || p.maxProfiles !== previous.maxProfiles ||
      p.access !== previous.access || JSON.stringify(p.features) !== JSON.stringify(previous.features) ||
      p.appleProductId !== (previous.appleProductId || null) ||
      p.googleProductId !== (previous.googleProductId || null) ||
      p.googleBasePlanId !== (previous.googleBasePlanId || null);
    if (!changed) { await conn.rollback(); return res.status(200).json({success:true,changed:false,message:"No changes required."}); }
    const [result] = await conn.query(
      `UPDATE subscription_plans SET display_name = ?, description = ?, billing_period = ?,
        price_amount = ?, price_currency = ?, trial_days = ?, max_profiles = ?,
        access_level = ?, features_json = ?, apple_product_id = ?, google_product_id = ?,
        google_base_plan_id = ? WHERE id = ? AND is_enabled = 0`,
      [p.name, p.description || null, p.period, p.price, p.currency, p.trialDays,
       p.maxProfiles, p.access, JSON.stringify(p.features), p.appleProductId,
       p.googleProductId, p.googleBasePlanId, planId]
    );
    if (Number(result.affectedRows) !== 1) throw new Error("Plan update conflict");
    await conn.query(
      `INSERT INTO admin_subscription_catalog_history
        (plan_id, actor_admin_id, action_type, previous_json, next_json)
        VALUES (?, ?, 'updated', ?, ?)`,
      [planId, actorId, JSON.stringify(previous), JSON.stringify(p)]
    );
    await conn.commit();
    return res.status(200).json({success:true, changed:true, message:"Plan updated."});
  } catch (error) {
    if (conn) {try {await conn.rollback();} catch (_) {}}
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({success:false,message:"Plan code already exists."});
    return fail(res, "UPDATE", error);
  } finally { if (conn) conn.release(); }
});

module.exports = router;
