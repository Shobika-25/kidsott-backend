"use strict";

// Secure administration for existing Home tables.
// Mounted beneath /api/admin/home and behind authenticate + requireAdmin.
// Public /api/home routes and their response formats are NOT modified.
const express = require("express");
const db = require("../config/db");
const router = express.Router();

const SOURCE_TYPES = new Set([
  "manual", "category", "featured", "all", "recent", "trending",
  "popular", "favorites", "recommended", "continue_watching"
]);
const FIELDS = new Set([
  "sectionKey", "title", "layout", "sourceType", "sourceValue",
  "itemLimit", "sortOrder", "isActive", "videoIds"
]);
const safeId = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
const fail = (status, message) => {
  const error = new Error(message);
  error.status = status;
  throw error;
};
const plainObject = body => body !== null && typeof body === "object" &&
  !Array.isArray(body) && Object.getPrototypeOf(body) === Object.prototype;

function checkBody(body) {
  if (!plainObject(body)) fail(400, "Expected a JSON object.");
  for (const key of Object.keys(body)) {
    if (!FIELDS.has(key)) fail(400, `Unsupported Home field: ${key}.`);
  }
  return body;
}

function keyFrom(text) {
  return String(text).trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function idsFromCsv(value) {
  if (!value) return [];
  let entries;
  try { entries = JSON.parse(String(value)); }
  catch { entries = String(value).split(","); }
  if (!Array.isArray(entries)) return [];
  const ids = entries.map(safeId).filter(Boolean);
  return [...new Set(ids)];
}

function parseVideoIds(value) {
  if (!Array.isArray(value) || value.length > 50) {
    fail(400, "videoIds must be an array containing at most 50 video IDs.");
  }
  const ids = value.map(safeId);
  if (ids.some(id => id === null) || new Set(ids).size !== ids.length) {
    fail(400, "videoIds contains an invalid or repeated ID.");
  }
  return ids;
}

function asInt(value, field, min, max) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < min || value > max) {
    fail(400, `${field} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function parseFields(input, previous, existingIds) {
  const full = { ...previous, ...input };
  const title = typeof full.title === "string" ? full.title.trim() : "";
  if (title.length < 2 || title.length > 160) {
    fail(400, "Section title must be 2 to 160 characters.");
  }
  const sectionKey = previous?.sectionKey ??
    (full.sectionKey === undefined ? keyFrom(title) : full.sectionKey);
  if (typeof sectionKey !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(sectionKey) ||
      sectionKey.length > 120) {
    fail(400, "sectionKey must contain lowercase letters, numbers and hyphens.");
  }
  if (previous && input.sectionKey !== undefined && input.sectionKey !== previous.sectionKey) {
    fail(400, "Existing sectionKey cannot be changed.");
  }
  if (!["portrait", "landscape"].includes(full.layout)) {
    fail(400, "Layout must be portrait or landscape.");
  }
  if (!SOURCE_TYPES.has(full.sourceType)) {
    fail(400, "Unsupported section sourceType.");
  }
  if (!previous && full.sourceType === "continue_watching") {
    fail(400, "Continue Watching is managed by the mobile app. Do not add duplicates.");
  }
  const itemLimit = asInt(full.itemLimit, "itemLimit", 1, 50);
  const sortOrder = asInt(full.sortOrder, "sortOrder", 0, 9999);
  if (typeof full.isActive !== "boolean") {
    fail(400, "isActive must be true or false.");
  }
  if (full.sourceType === "manual") {
    if (Object.prototype.hasOwnProperty.call(input, "sourceValue") &&
        input.sourceValue !== undefined && input.sourceValue !== null &&
        input.sourceValue !== "") {
      fail(400, "For manual sections, use videoIds instead of sourceValue.");
    }
    const ids = Object.prototype.hasOwnProperty.call(input, "videoIds")
      ? parseVideoIds(input.videoIds)
      : (previous?.sourceType === "manual" ? existingIds : []);
    if (ids.length > itemLimit) fail(400, "Assigned videos exceed itemLimit.");
    if (full.isActive && ids.length === 0) {
      fail(400, "An active manual section must contain at least one video.");
    }
    const sourceValue = ids.join(",");
    if (sourceValue.length > 190) {
      fail(400, "Manual video IDs exceed the source_value column limit.");
    }
    return {
      sectionKey, title, layout: full.layout, sourceType: full.sourceType,
      sourceValue, itemLimit, sortOrder, isActive: full.isActive, videoIds: ids
    };
  }
  if (input.videoIds !== undefined && parseVideoIds(input.videoIds).length) {
    fail(400, "videoIds can only be assigned to a manual section.");
  }
  let sourceValue = full.sourceValue === undefined || full.sourceValue === null
    ? "" : full.sourceValue;
  if (typeof sourceValue !== "string") fail(400, "sourceValue must be text.");
  sourceValue = sourceValue.trim();
  if (sourceValue.length > 190) fail(400, "sourceValue exceeds 190 characters.");
  if (full.sourceType === "category" &&
      (!sourceValue || (previous && previous.sourceType !== "category" &&
      input.sourceValue === undefined))) {
    fail(400, "Category source requires an explicit sourceValue.");
  }
  // Do not carry a category source value into a different source mode.
  if (previous && previous.sourceType !== full.sourceType &&
      input.sourceValue === undefined && full.sourceType !== "category") {
    sourceValue = "";
  }
  return {
    sectionKey, title, layout: full.layout, sourceType: full.sourceType,
    sourceValue, itemLimit, sortOrder, isActive: full.isActive, videoIds: []
  };
}

async function manualIds(conn, row) {
  const [links] = await conn.query(
    "SELECT video_id AS videoId FROM home_section_videos WHERE section_id = ? ORDER BY sort_order ASC, video_id ASC",
    [row.id]
  );
  const ids = links.map(link => safeId(link.videoId)).filter(Boolean);
  return ids.length ? [...new Set(ids)] : idsFromCsv(row.source_value);
}

async function checkVideos(conn, videoIds, active) {
  if (!videoIds.length) return;
  const placeholders = videoIds.map(() => "?").join(",");
  const [rows] = await conn.query(
    `SELECT id, status FROM videos WHERE id IN (${placeholders})`, videoIds
  );
  if (rows.length !== videoIds.length) {
    fail(400, "One or more assigned videos no longer exist.");
  }
  if (active && rows.some(row => row.status !== "published")) {
    fail(400, "Active manual sections may only contain published videos.");
  }
}

async function updateLinks(conn, sectionId, ids) {
  await conn.query("DELETE FROM home_section_videos WHERE section_id = ?", [sectionId]);
  for (let i = 0; i < ids.length; i++) {
    await conn.query(
      "INSERT INTO home_section_videos (section_id, video_id, sort_order) VALUES (?, ?, ?)",
      [sectionId, ids[i], i + 1]
    );
  }
}

function dbError(res, error) {
  if (error.status) return res.status(error.status).json({ success: false, message: error.message });
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ success: false, message: "Section key already exists." });
  }
  if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_NO_REFERENCED_ROW_2") {
    return res.status(409).json({ success: false, message: "Related videos or sections changed. Refresh and retry." });
  }
  console.error("ADMIN HOME WRITE ERROR:", error);
  return res.status(500).json({ success: false, message: "Unable to save Home configuration." });
}

async function transaction(res, operation, successCode = 200) {
  let conn;
  let started = false;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    started = true;
    const result = await operation(conn);
    await conn.commit();
    started = false;
    return res.status(successCode).json({ success: true, ...result });
  } catch (error) {
    if (started) {
      try { await conn.rollback(); }
      catch (rollbackError) { console.error("HOME ROLLBACK ERROR:", rollbackError); }
    }
    return dbError(res, error);
  } finally {
    if (conn) conn.release();
  }
}

function rowFields(row) {
  return {
    id: safeId(row.id), sectionKey: row.section_key, title: row.title,
    layout: row.layout, sourceType: row.source_type,
    sourceValue: row.source_value == null ? "" : String(row.source_value),
    itemLimit: Number(row.item_limit), sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active)
  };
}

async function lockedRow(conn, id) {
  const [rows] = await conn.query(
    "SELECT * FROM home_sections WHERE id = ? FOR UPDATE", [id]
  );
  if (!rows.length) fail(404, "Home section not found.");
  return rows[0];
}

// Create a Home section. Existing public API uses the same underlying tables.
router.post("/sections", (req, res) => transaction(res, async conn => {
  const body = checkBody(req.body);
  const fields = parseFields(body, {
    sectionKey: body.sectionKey === undefined ? keyFrom(body.title || "") : body.sectionKey,
    title: body.title, layout: body.layout, sourceType: body.sourceType,
    sourceValue: body.sourceValue, itemLimit: body.itemLimit,
    sortOrder: body.sortOrder, isActive: body.isActive
  }, []);
  // parseFields gets defaults from its object; create has no prior DB row.
  if (fields.sourceType === "continue_watching") {
    fail(400, "Continue Watching is managed by the mobile app.");
  }
  await checkVideos(conn, fields.videoIds, fields.isActive);
  const [result] = await conn.query(
    `INSERT INTO home_sections
      (section_key, title, layout, source_type, source_value, item_limit, sort_order, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [fields.sectionKey, fields.title, fields.layout, fields.sourceType,
      fields.sourceValue || null, fields.itemLimit, fields.sortOrder, fields.isActive ? 1 : 0]
  );
  const id = safeId(result.insertId);
  if (!id) fail(500, "Invalid Home section identifier.");
  await updateLinks(conn, id, fields.videoIds);
  return { id, message: "Home section created." };
}, 201));

router.put("/sections/:id", (req, res) => transaction(res, async conn => {
  const id = safeId(req.params.id);
  if (!id) fail(400, "Invalid Home section ID.");
  const body = checkBody(req.body);
  const row = await lockedRow(conn, id);
  const previous = rowFields(row);
  const oldIds = previous.sourceType === "manual" ? await manualIds(conn, row) : [];
  const next = parseFields(body, previous, oldIds);
  await checkVideos(conn, next.videoIds, next.isActive);
  await conn.query(
    `UPDATE home_sections SET title = ?, layout = ?, source_type = ?,
      source_value = ?, item_limit = ?, sort_order = ?, is_active = ? WHERE id = ?`,
    [next.title, next.layout, next.sourceType, next.sourceValue || null,
      next.itemLimit, next.sortOrder, next.isActive ? 1 : 0, id]
  );
  // Both the mobile Home controller (source_value) and public Home
  // endpoint (home_section_videos) receive the same ordered assignments.
  await updateLinks(conn, id, next.videoIds);
  return { id, message: "Home section updated." };
}));

router.patch("/sections/:id/status", (req, res) => transaction(res, async conn => {
  const id = safeId(req.params.id);
  if (!id) fail(400, "Invalid Home section ID.");
  if (!plainObject(req.body) || Object.keys(req.body).length !== 1 ||
      typeof req.body.isActive !== "boolean") {
    fail(400, "Expected isActive as a boolean.");
  }
  const row = await lockedRow(conn, id);
  if (req.body.isActive && row.source_type === "manual") {
    const ids = await manualIds(conn, row);
    if (!ids.length) fail(400, "Cannot activate an empty manual section.");
    await checkVideos(conn, ids, true);
  }
  await conn.query("UPDATE home_sections SET is_active = ? WHERE id = ?",
    [req.body.isActive ? 1 : 0, id]);
  return { id, message: "Section visibility saved." };
}));

router.put("/sections/:id/videos", (req, res) => transaction(res, async conn => {
  const id = safeId(req.params.id);
  if (!id) fail(400, "Invalid Home section ID.");
  if (!plainObject(req.body) || Object.keys(req.body).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(req.body, "videoIds")) {
    fail(400, "Expected videoIds only.");
  }
  const row = await lockedRow(conn, id);
  if (row.source_type !== "manual") {
    fail(400, "Video assignments are supported only for manual sections.");
  }
  const ids = parseVideoIds(req.body.videoIds);
  if (ids.length > row.item_limit || (row.is_active && !ids.length)) {
    fail(400, "Video assignments do not meet this section's limit.");
  }
  const csv = ids.join(",");
  if (csv.length > 190) fail(400, "Video assignments exceed source_value limit.");
  await checkVideos(conn, ids, Boolean(row.is_active));
  await conn.query("UPDATE home_sections SET source_value = ? WHERE id = ?",
    [csv || null, id]);
  await updateLinks(conn, id, ids);
  return { id, message: "Section video assignments saved." };
}));

router.post("/sections/reorder", (req, res) => transaction(res, async conn => {
  if (!plainObject(req.body) || Object.keys(req.body).length !== 1 ||
      !Array.isArray(req.body.sectionIds)) {
    fail(400, "Expected sectionIds array.");
  }
  const ids = req.body.sectionIds.map(safeId);
  if (!ids.length || ids.length > 9999 || ids.some(id => id === null) ||
      new Set(ids).size !== ids.length) {
    fail(400, "Invalid sectionIds array.");
  }
  const [rows] = await conn.query("SELECT id FROM home_sections ORDER BY id FOR UPDATE");
  const existing = new Set(rows.map(row => safeId(row.id)));
  if (rows.length !== ids.length || ids.some(id => !existing.has(id))) {
    fail(409, "Section list changed. Refresh before reordering.");
  }
  for (let i = 0; i < ids.length; i++) {
    await conn.query("UPDATE home_sections SET sort_order = ? WHERE id = ?", [i + 1, ids[i]]);
  }
  return { message: "Home section order saved." };
}));

router.delete("/sections/:id", (req, res) => transaction(res, async conn => {
  const id = safeId(req.params.id);
  if (!id) fail(400, "Invalid Home section ID.");
  await lockedRow(conn, id);
  await conn.query("DELETE FROM home_section_videos WHERE section_id = ?", [id]);
  await conn.query("DELETE FROM home_sections WHERE id = ?", [id]);
  return { id, message: "Home section deleted. Video records were not deleted." };
}));

module.exports = router;