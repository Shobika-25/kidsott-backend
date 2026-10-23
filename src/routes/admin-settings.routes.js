"use strict";

// KIDSOTT_ADMIN_SETTINGS_READONLY_V1
// App-wide settings are NOT stored in user_settings: that table is per-user.
// The support contact is the only shared settings record confirmed in MySQL.
const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();
router.use(authenticate, requireAdmin);
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
});

function timestamp(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Read-only; never send any parent preferences or PINs in an admin response.
router.get("/support-contact", async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT email, phone, updated_at AS updatedAt
      FROM support_contact
      WHERE id = 1
      LIMIT 1
    `);
    const row = rows[0] || null;
    return res.status(200).json({
      success: true,
      configured: row !== null,
      contact: row
        ? {
            email: String(row.email || "").trim(),
            phone: String(row.phone || "").trim(),
            updatedAt: timestamp(row.updatedAt)
          }
        : { email: "", phone: "", updatedAt: null }
    });
  } catch (error) {
    console.error(
      "ADMIN SETTINGS SUPPORT CONTACT READ FAILED:",
      (error && (error.code || error.name)) || "unknown"
    );
    return res.status(500).json({
      success: false,
      message: "Unable to load support contact settings."
    });
  }
});

module.exports = router;
