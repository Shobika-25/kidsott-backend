"use strict";

const express = require("express");
const db = require("../config/db");
const authenticate = require("../middleware/auth.middleware");
const requireAdmin = require("../middleware/admin.middleware");

const router = express.Router();
router.use(authenticate, requireAdmin);

// Read-only admin endpoint. Public /api/home routes remain untouched.
router.get("/sections", async (_req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        id, section_key AS sectionKey, title,
        layout, source_type AS sourceType,
        source_value AS sourceValue,
        item_limit AS itemLimit,
        sort_order AS sortOrder,
        is_active AS isActive
      FROM home_sections
      ORDER BY sort_order ASC, id ASC
    `);

    // Video assignments are optional in older deployments; manual
    // source_value is also supported by the current mobile Home API.
    let associations = [];
    try {
      const [links] = await db.query(`
        SELECT section_id AS sectionId, video_id AS videoId,
               sort_order AS sortOrder
        FROM home_section_videos
        ORDER BY section_id ASC, sort_order ASC, video_id ASC
      `);
      associations = links;
    } catch (error) {
      // Suppress only the missing-table case. Other DB errors must surface.
      if (error.code !== "ER_NO_SUCH_TABLE") throw error;
    }

    const assigned = new Map();
    for (const link of associations) {
      const sectionId = Number(link.sectionId);
      const videoId = Number(link.videoId);
      if (!Number.isSafeInteger(sectionId) || sectionId <= 0 ||
          !Number.isSafeInteger(videoId) || videoId <= 0) continue;
      const ids = assigned.get(sectionId) || [];
      if (!ids.includes(videoId)) ids.push(videoId);
      assigned.set(sectionId, ids);
    }

    function manualIds(raw) {
      if (!raw) return [];
      let items;
      try {
        items = JSON.parse(String(raw));
      } catch {
        items = String(raw).split(",").map(x => x.trim());
      }
      return Array.isArray(items)
        ? [...new Set(items.map(Number).filter(n =>
            Number.isSafeInteger(n) && n > 0))]
        : [];
    }

    const sections = rows.map(row => {
      const id = Number(row.id);
      const type = String(row.sourceType || "");
      const links = assigned.get(id) || [];
      const fallback = type === "manual" ? manualIds(row.sourceValue) : [];
      return {
        id,
        sectionKey: String(row.sectionKey || ""),
        title: String(row.title || ""),
        layout: String(row.layout || "landscape"),
        sourceType: type,
        sourceValue: row.sourceValue == null ? "" : String(row.sourceValue),
        itemLimit: Math.max(1, Number(row.itemLimit) || 10),
        sortOrder: Number(row.sortOrder),
        isActive: Boolean(row.isActive),
        videoIds: links.length ? links : fallback,
      };
    });

    return res.json({ success: true, sections });
  } catch (error) {
    console.error("ADMIN HOME LIST ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to load admin home configuration."
    });
  }
});

router.use("/", require("./admin-home-write.routes"));

module.exports = router;