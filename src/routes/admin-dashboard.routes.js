"use strict";

// KIDSOTT_ADMIN_DASHBOARD_READONLY_V1
// Inventory and operational counts only. No fabricated playback, device, or billing analytics.
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

const DAYS = Object.freeze({ "7d": 7, "30d": 30, "90d": 90 });

function toCount(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("Invalid MySQL aggregate count");
  }
  return number;
}

function iso(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function fail(res, error) {
  console.error("ADMIN DASHBOARD READ ERROR:",
    error && (error.code || error.name) || "unknown");
  return res.status(500).json({
    success: false,
    message: "Unable to load Dashboard overview."
  });
}

router.get("/overview", async (req, res) => {
  const period = req.query.period === undefined ? "30d" : req.query.period;
  if (typeof period !== "string" || !Object.hasOwn(DAYS, period)) {
    return res.status(400).json({
      success: false,
      message: "period must be 7d, 30d or 90d."
    });
  }
  const days = DAYS[period];

  try {
    const [[summary]] = await db.query(`
      SELECT
        (SELECT COUNT(*) FROM videos) AS totalVideos,
        (SELECT COUNT(*) FROM videos WHERE status = 'published') AS publishedVideos,
        (SELECT COUNT(*) FROM videos WHERE status = 'draft') AS draftVideos,
        (SELECT COUNT(*) FROM users WHERE role = 'user') AS totalUsers,
        (SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = 1) AS activeUsers,
        (SELECT COUNT(*) FROM categories) AS totalCategories,
        (SELECT COUNT(*) FROM categories WHERE is_active = 1) AS activeCategories,
        (SELECT COUNT(*) FROM support_tickets) AS totalSupportTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'open') AS openSupportTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'in_progress') AS inProgressSupportTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'resolved') AS resolvedSupportTickets,
        (SELECT COUNT(*) FROM support_tickets WHERE status = 'closed') AS closedSupportTickets,
        (SELECT COUNT(*) FROM watch_history) AS watchHistoryRecords,
        (SELECT COUNT(*) FROM watch_history WHERE completed = 1) AS completedHistoryRecords
    `);

    const [[periodRow]] = await db.query(`
      SELECT COUNT(*) AS recentlyAddedVideos
      FROM videos
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `, [days]);

    const [recentRows] = await db.query(`
      SELECT v.id, v.title, v.status, v.updated_at AS updatedAt,
        v.thumbnail_url AS posterUrl, c.name AS category
      FROM videos v
      INNER JOIN categories c ON c.id = v.category_id
      ORDER BY v.updated_at DESC, v.id DESC
      LIMIT 8
    `);

    const [categoryRows] = await db.query(`
      SELECT c.name, COUNT(v.id) AS videoCount
      FROM categories c
      LEFT JOIN videos v ON v.category_id = c.id
      GROUP BY c.id, c.name
      ORDER BY videoCount DESC, c.name ASC
      LIMIT 10
    `);

    const [uploadRows] = await db.query(`
      SELECT DATE_FORMAT(v.created_at, '%Y-%m-%d') AS day,
        COUNT(*) AS videoCount
      FROM videos v
      WHERE v.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      GROUP BY DATE_FORMAT(v.created_at, '%Y-%m-%d')
      ORDER BY day ASC
    `, [days]);

    const metrics = {};
    for (const name of [
      "totalVideos", "publishedVideos", "draftVideos", "totalUsers", "activeUsers",
      "totalCategories", "activeCategories", "totalSupportTickets",
      "openSupportTickets", "inProgressSupportTickets", "resolvedSupportTickets",
      "closedSupportTickets", "watchHistoryRecords", "completedHistoryRecords"
    ]) metrics[name] = toCount(summary[name]);
    metrics.recentlyAddedVideos = toCount(periodRow.recentlyAddedVideos);

    return res.status(200).json({
      success: true,
      period,
      generatedAt: new Date().toISOString(),
      metrics,
      recentContent: recentRows.map(row => ({
        id: String(row.id),
        title: String(row.title || ""),
        category: String(row.category || ""),
        status: row.status,
        updatedAt: iso(row.updatedAt),
        posterUrl: row.posterUrl ? String(row.posterUrl) : null
      })),
      categoryInventory: categoryRows.map(row => ({
        name: String(row.name || ""),
        videoCount: toCount(row.videoCount)
      })),
      uploadTrend: uploadRows.map(row => ({
        date: String(row.day),
        videoCount: toCount(row.videoCount)
      })),
      unavailable: {
        scheduledVideos: true,
        playStarts: true,
        watchHours: true,
        completionRate: true,
        mostWatched: true,
        viewingDevices: true,
        categoryPlayback: true,
        revenue: true
      },
      explanation: "Watch-history rows are stored progress records, not video-play events. Upload trends are video creation counts, not playback counts."
    });
  } catch (error) {
    return fail(res, error);
  }
});

module.exports = router;
