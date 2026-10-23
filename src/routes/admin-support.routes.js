"use strict";

// KIDSOTT_ADMIN_SUPPORT_READONLY_V1
// These admin reports read existing mobile support tickets without modifying them.
// There are no agent, priority, reply or internal-note columns in the current schema.
const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();
router.use(authenticate, requireAdmin);
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  next();
});

function pageParam(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number <= maximum ? number : null;
}

function requestedPage(req, res) {
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
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function failed(res, context, error) {
  console.error("ADMIN SUPPORT " + context + " ERROR:",
    error && (error.code || error.name) || "unknown");
  return res.status(500).json({
    success: false,
    message: "Unable to load support information."
  });
}

// Counts reflect stored tickets, not agent queue assignments or delivery statuses.
router.get("/summary", async (_req, res) => {
  try {
    const [[row]] = await db.query(`
      SELECT COUNT(*) AS total,
        COALESCE(SUM(t.status = 'open'), 0) AS open,
        COALESCE(SUM(t.status = 'in_progress'), 0) AS inProgress,
        COALESCE(SUM(t.status = 'resolved'), 0) AS resolved,
        COALESCE(SUM(t.status = 'closed'), 0) AS closed
      FROM support_tickets t
      INNER JOIN users u ON u.id = t.user_id AND u.role = 'user'
    `);
    return res.status(200).json({
      success: true,
      summary: {
        total: Number(row.total) || 0,
        open: Number(row.open) || 0,
        inProgress: Number(row.inProgress) || 0,
        resolved: Number(row.resolved) || 0,
        closed: Number(row.closed) || 0
      },
      agentAssignmentsAvailable: false,
      priorityAvailable: false,
      replyHistoryAvailable: false
    });
  } catch (error) {
    return failed(res, "SUMMARY", error);
  }
});

router.get("/types", async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT name FROM support_types
      WHERE is_active = 1
      ORDER BY sort_order ASC, id ASC
      LIMIT 100
    `);
    return res.status(200).json({
      success: true,
      types: rows.map(row => String(row.name || "").trim()).filter(Boolean)
    });
  } catch (error) {
    return failed(res, "TYPES", error);
  }
});

router.get("/tickets", async (req, res) => {
  const pg = requestedPage(req, res);
  if (!pg) return;
  try {
    const [[counter]] = await db.query(`
      SELECT COUNT(*) AS total
      FROM support_tickets t
      INNER JOIN users u ON u.id = t.user_id AND u.role = 'user'
    `);
    const [rows] = await db.query(`
      SELECT t.id, t.user_id, u.name AS user_name, u.email AS user_email,
        t.type, t.message, t.status, t.created_at, t.updated_at
      FROM support_tickets t
      INNER JOIN users u ON u.id = t.user_id AND u.role = 'user'
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `, [pg.pageSize, pg.offset]);

    const tickets = rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      userName: String(row.user_name || ""),
      userEmail: String(row.user_email || ""),
      type: String(row.type || ""),
      message: String(row.message || ""),
      status: String(row.status || ""),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at)
    }));
    const total = Number(counter.total) || 0;
    return res.status(200).json({
      success: true,
      tickets,
      pagination: {
        page: pg.page,
        pageSize: pg.pageSize,
        total,
        totalPages: Math.ceil(total / pg.pageSize)
      }
    });
  } catch (error) {
    return failed(res, "TICKETS", error);
  }
});

module.exports = router;