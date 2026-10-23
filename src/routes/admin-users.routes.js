"use strict";

// Admin-only, read-only directory of *regular* KidsOTT accounts.
// No password hashes, JWTs, purchases or administrator account details.
const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();
router.use(authenticate, requireAdmin);

function intParam(raw, defaultValue, max) {
  if (raw === undefined) return defaultValue;
  if (typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");

  const page = intParam(req.query.page, 1, 100000);
  const pageSize = intParam(req.query.pageSize, 50, 100);
  if (page === null || pageSize === null) {
    return res.status(400).json({
      success: false,
      message: "page must be 1-100000 and pageSize must be 1-100."
    });
  }

  const offset = (page - 1) * pageSize;
  try {
    const [[count]] = await db.query(
      "SELECT COUNT(*) AS total FROM users WHERE role = 'user'"
    );
    const [rows] = await db.query(`
      SELECT id, name, email,
             is_active AS isActive,
             created_at AS createdAt
      FROM users
      WHERE role = 'user'
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `, [pageSize, offset]);

    const total = Number(count.total) || 0;
    const users = rows.map(row => ({
      id: Number(row.id),
      name: String(row.name || ""),
      email: String(row.email || ""),
      status: Boolean(row.isActive) ? "active" : "inactive",
      createdAt: row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt || "")
    }));

    return res.status(200).json({
      success: true,
      users,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error("ADMIN USER DIRECTORY QUERY FAILED:", error.code || error.name);
    return res.status(500).json({
      success: false,
      message: "Unable to load the user directory."
    });
  }
});

module.exports = router;