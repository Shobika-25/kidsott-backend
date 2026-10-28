"use strict";

// KIDSOTT_ADMIN_REPORTS_READONLY_V1
// Current-state inventory and *record-creation* trends, never inferred viewing/revenue data.
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

const PERIOD_DAYS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90 });
const ENTITLEMENT_STATUSES = ["inactive", "active", "grace_period", "expired", "revoked"];
const PURCHASE_STATUSES = [
  "pending", "active", "grace_period", "billing_retry", "on_hold",
  "paused", "canceled", "expired", "revoked"
];
const TICKET_STATUSES = ["open", "in_progress", "resolved", "closed"];

function count(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Unexpected MySQL aggregate value");
  }
  return parsed;
}

function statusBreakdown(rows, allowed) {
  const found = new Map();
  for (const row of rows) {
    const label = String(row.status);
    if (!allowed.includes(label) || found.has(label)) {
      throw new Error("Unexpected database status value");
    }
    found.set(label, count(row.itemCount));
  }
  return allowed.map(status => ({ status, count: found.get(status) || 0 }));
}

function trend(rows) {
  return rows.map(row => {
    const date = String(row.day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error("Unexpected MySQL day grouping");
    }
    return { date, count: count(row.itemCount) };
  });
}

router.get("/overview", async (req, res) => {
  const period = req.query.period === undefined ? "30d" : req.query.period;
  if (typeof period !== "string" || !Object.prototype.hasOwnProperty.call(PERIOD_DAYS, period)) {
    return res.status(400).json({
      success: false,
      message: "period must be 7d, 30d or 90d."
    });
  }
  const days = PERIOD_DAYS[period];

  try {
    const [[summary]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM videos) AS totalVideos,
        (SELECT COUNT(*) FROM videos WHERE status = 'published') AS publishedVideos,
        (SELECT COUNT(*) FROM videos WHERE status = 'draft') AS draftVideos,
        (SELECT COUNT(*) FROM categories) AS totalCategories,
        (SELECT COUNT(*) FROM categories WHERE is_active = 1) AS activeCategories,
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS registeredUsers,
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = 1) AS activeUsers,
        (SELECT COUNT(*) FROM support_tickets) AS totalTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS openTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'in_progress') AS inProgressTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'resolved') AS resolvedTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'closed') AS closedTickets,
        (SELECT COUNT(*) FROM subscription_plans WHERE is_enabled = 1) AS enabledPlanRecords,
        (SELECT COUNT(*) FROM subscription_entitlements) AS entitlementRecords,
        (SELECT COUNT(*) FROM subscription_purchases) AS purchaseRecords
    `);
    if (!summary) throw new Error("Missing MySQL summary");

    const [[periodTotals]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM videos
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS createdVideos,
        (SELECT COUNT(*) FROM users
           WHERE role = 'user' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS createdUsers,
        (SELECT COUNT(*) FROM support_tickets
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS createdTickets,
        (SELECT COUNT(*) FROM subscription_purchases
           WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)) AS createdPurchaseRecords
    `, [days, days, days, days]);
    if (!periodTotals) throw new Error("Missing MySQL period summary");

    const [ticketStatuses] = await db.query(`
      SELECT status, COUNT(*) AS itemCount
      FROM support_tickets
      GROUP BY status
    `);
    const [entitlementStatuses] = await db.query(`
      SELECT status, COUNT(*) AS itemCount
      FROM subscription_entitlements
      GROUP BY status
    `);
    const [purchaseStatuses] = await db.query(`
      SELECT status, COUNT(*) AS itemCount
      FROM subscription_purchases
      GROUP BY status
    `);

    const [categoryRows] = await db.query(`
      SELECT c.name, c.is_active AS isActive,
        COUNT(v.id) AS videoCount,
        SUM(CASE WHEN v.status = 'published' THEN 1 ELSE 0 END) AS publishedVideoCount
      FROM categories c
      LEFT JOIN videos v ON v.category_id = c.id
      GROUP BY c.id, c.name, c.is_active
      ORDER BY videoCount DESC, c.name ASC
      LIMIT 15
    `);

    const [videoDays] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS itemCount
      FROM videos
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      ORDER BY day ASC
    `, [days]);
    const [userDays] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS itemCount
      FROM users
      WHERE role = 'user' AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      ORDER BY day ASC
    `, [days]);
    const [ticketDays] = await db.query(`
      SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day, COUNT(*) AS itemCount
      FROM support_tickets
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d')
      ORDER BY day ASC
    `, [days]);

    const lifetimeKeys = [
      "totalVideos", "publishedVideos", "draftVideos", "totalCategories",
      "activeCategories", "registeredUsers", "activeUsers", "totalTickets",
      "openTickets", "inProgressTickets", "resolvedTickets", "closedTickets",
      "enabledPlanRecords", "entitlementRecords", "purchaseRecords"
    ];
    const lifetime = {};
    for (const key of lifetimeKeys) lifetime[key] = count(summary[key]);
    if (lifetime.publishedVideos + lifetime.draftVideos !== lifetime.totalVideos ||
        lifetime.activeUsers > lifetime.registeredUsers ||
        lifetime.activeCategories > lifetime.totalCategories ||
        lifetime.openTickets + lifetime.inProgressTickets + lifetime.resolvedTickets +
          lifetime.closedTickets !== lifetime.totalTickets) {
      throw new Error("Database counts changed during the report; refresh and retry");
    }

    const newlyCreated = {};
    for (const key of ["createdVideos", "createdUsers", "createdTickets", "createdPurchaseRecords"]) {
      newlyCreated[key] = count(periodTotals[key]);
    }

    const categories = categoryRows.map(row => ({
      name: String(row.name || ""),
      active: Number(row.isActive) === 1,
      videoCount: count(row.videoCount),
      publishedVideoCount: count(row.publishedVideoCount)
    }));

    return res.status(200).json({
      success: true,
      period,
      window: { days, semantics: "rolling record-creation window" },
      generatedAt: new Date().toISOString(),
      lifetime,
      newlyCreated,
      statusBreakdowns: {
        videos: [
          { status: "published", count: lifetime.publishedVideos },
          { status: "draft", count: lifetime.draftVideos }
        ],
        regularUsers: [
          { status: "active", count: lifetime.activeUsers },
          { status: "inactive", count: lifetime.registeredUsers - lifetime.activeUsers }
        ],
        supportTickets: statusBreakdown(ticketStatuses, TICKET_STATUSES),
        entitlementRecords: statusBreakdown(entitlementStatuses, ENTITLEMENT_STATUSES),
        purchaseRecords: statusBreakdown(purchaseStatuses, PURCHASE_STATUSES)
      },
      categoryInventory: categories,
      creationTrends: {
        videos: trend(videoDays),
        regularUsers: trend(userDays),
        supportTickets: trend(ticketDays)
      },
      unavailable: {
        revenue: true,
        verifiedPayments: true,
        playbackEvents: true,
        watchHours: true,
        viewCompletionRate: true,
        uniqueViewers: true,
        deviceDistribution: true,
        historicTicketStatusTransitions: true
      },
      notes: [
        "Lifetime counts are current totals; only newlyCreated and creationTrends use the selected period.",
        "Purchase records do not establish payment amounts, revenue or verified store collections.",
        "An active entitlement database row does not independently verify a successful payment.",
        "Watch history stores progress snapshots, not individual playback events or watch hours.",
        "Ticket status counts describe current statuses, not the dates tickets changed status."
      ]
    });
  } catch (error) {
    console.error("ADMIN REPORTS OVERVIEW FAILED:", error && (error.code || error.name) || "unknown");
    return res.status(500).json({
      success: false,
      message: "Unable to load Reports overview."
    });
  }
});

module.exports = router;