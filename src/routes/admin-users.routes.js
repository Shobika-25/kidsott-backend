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
             phone_number AS phoneNumber, last_login_at AS lastLoginAt, created_at AS createdAt
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
      // KIDSOTT_ADMIN_USER_PHONE_LASTLOGIN_V1
      phoneNumber: row.phoneNumber == null
        ? null
        : String(row.phoneNumber),
      lastLoginAt: row.lastLoginAt == null
        ? null
        : row.lastLoginAt instanceof Date
          ? row.lastLoginAt.toISOString()
          : new Date(row.lastLoginAt).toISOString(),
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

// KIDSOTT_ADMIN_USER_EDIT_WITH_HISTORY_V2
// Regular accounts only. Changes and history share one transaction.
// KIDSOTT_ADMIN_USER_PHONE_EDIT_V3
// Admin may edit ordinary accounts only.
// Optional phoneNumber uses E.164 format.
// Audit history records field names, not contact values.
router.put("/:id", async (req, res) => {
  res.set("Cache-Control", "no-store, private");

  const rawId = req.params.id;
  const adminId = Number(req.user?.id);

  if (
    req.user?.role !== "admin" ||
    !Number.isSafeInteger(adminId) ||
    adminId < 1
  ) {
    return res.status(403).json({
      success: false,
      message: "Administrator access is required."
    });
  }

  if (
    typeof rawId !== "string" ||
    !/^[1-9][0-9]*$/.test(rawId) ||
    !Number.isSafeInteger(Number(rawId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID."
    });
  }

  const body = req.body;

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid account details."
    });
  }

  const allowedFields = new Set([
    "name",
    "email",
    "phoneNumber"
  ]);

  if (
    Object.keys(body).some(key => !allowedFields.has(key)) ||
    typeof body.name !== "string" ||
    typeof body.email !== "string"
  ) {
    return res.status(400).json({
      success: false,
      message: "Only name, email and optional phone are editable."
    });
  }

  const name = body.name.trim();
  const email = body.email.trim().toLowerCase();

  if (
    name.length < 1 ||
    name.length > 120 ||
    email.length < 3 ||
    email.length > 190 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      success: false,
      message: "Enter a valid name and email."
    });
  }

  const hasPhone = Object.prototype.hasOwnProperty.call(
    body,
    "phoneNumber"
  );

  let requestedPhone = null;

  if (hasPhone) {
    if (
      body.phoneNumber !== null &&
      typeof body.phoneNumber !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number."
      });
    }

    requestedPhone = body.phoneNumber === null
      ? null
      : body.phoneNumber.trim() || null;

    if (
      requestedPhone !== null &&
      !/^\+[1-9][0-9]{7,14}$/.test(requestedPhone)
    ) {
      return res.status(400).json({
        success: false,
        message: "Use international phone format, e.g. +919876543210."
      });
    }
  }

  let connection;
  let transactionOpen = false;

  try {
    connection = await db.getConnection();

    await connection.beginTransaction();
    transactionOpen = true;

    const [accounts] = await connection.query(
      `SELECT
         id,
         name,
         email,
         phone_number AS phoneNumber,
         role
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [Number(rawId)]
    );

    if (
      accounts.length !== 1 ||
      accounts[0].role !== "user"
    ) {
      await connection.rollback();
      transactionOpen = false;

      return res.status(404).json({
        success: false,
        message: "Regular user account not found."
      });
    }

    const current = accounts[0];
    const currentPhone = current.phoneNumber ?? null;

    // Old name/email-only clients preserve phone.
    const phoneNumber = hasPhone
      ? requestedPhone
      : currentPhone;

    const changedFields = [];

    if (current.name !== name) {
      changedFields.push("name");
    }

    if (current.email !== email) {
      changedFields.push("email");
    }

    if (currentPhone !== phoneNumber) {
      changedFields.push("phone_number");
    }

    if (changedFields.length === 0) {
      await connection.rollback();
      transactionOpen = false;

      return res.status(200).json({
        success: true,
        changed: false,
        message: "No changes were required."
      });
    }

    const [updated] = await connection.query(
      `UPDATE users
       SET name = ?,
           email = ?,
           phone_number = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND role = 'user'`,
      [
        name,
        email,
        phoneNumber,
        Number(rawId)
      ]
    );

    if (Number(updated.affectedRows) !== 1) {
      throw new Error("Unexpected user update result.");
    }

    const [history] = await connection.query(
      `INSERT INTO admin_user_action_history
         (
           actor_admin_id,
           target_user_id,
           action_type,
           changed_fields
         )
       VALUES (?, ?, ?, ?)`,
      [
        adminId,
        Number(rawId),
        "profile_updated",
        JSON.stringify(changedFields)
      ]
    );

    if (Number(history.affectedRows) !== 1) {
      throw new Error("Action history was not recorded.");
    }

    await connection.commit();
    transactionOpen = false;

    return res.status(200).json({
      success: true,
      changed: true,
      message: "User account updated successfully."
    });

  } catch (error) {
    if (connection && transactionOpen) {
      try {
        await connection.rollback();
        transactionOpen = false;
      } catch (rollbackError) {
        console.error(
          "ADMIN USER ROLLBACK FAILED:",
          rollbackError.code || rollbackError.name
        );
      }
    }

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        success: false,
        message: "Email address is already in use."
      });
    }

    console.error(
      "ADMIN USER UPDATE FAILED:",
      error.code || error.name
    );

    return res.status(500).json({
      success: false,
      message: "Unable to update user account."
    });

  } finally {
    if (connection) connection.release();
  }
});

// KIDSOTT_ADMIN_USER_STATUS_V1
// Only active/inactive are supported by the current users schema.
// Regular accounts only. Status and history share one transaction.
router.patch("/:id/status", async (req, res) => {
  res.set("Cache-Control", "no-store, private");

  const actorAdminId = Number(req.user?.id);
  const rawId = req.params.id;
  const body = req.body;

  if (
    req.user?.role !== "admin" ||
    !Number.isSafeInteger(actorAdminId) ||
    actorAdminId < 1
  ) {
    return res.status(403).json({
      success: false,
      message: "Administrator access is required."
    });
  }

  if (
    typeof rawId !== "string" ||
    !/^[1-9][0-9]*$/.test(rawId) ||
    !Number.isSafeInteger(Number(rawId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID."
    });
  }

  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(body, "status") ||
    (body.status !== "active" && body.status !== "inactive")
  ) {
    return res.status(400).json({
      success: false,
      message: "Only active or inactive account status is supported."
    });
  }

  const targetUserId = Number(rawId);
  const nextStatus = body.status;
  const nextIsActive = nextStatus === "active" ? 1 : 0;

  let conn = null;
  let inTransaction = false;

  try {
    conn = await db.getConnection();

    await conn.beginTransaction();
    inTransaction = true;

    // Row locking prevents concurrent Admin status updates
    // from generating inconsistent history entries.
    const [rows] = await conn.query(
      `SELECT id, role, is_active
       FROM users
       WHERE id = ?
       FOR UPDATE`,
      [targetUserId]
    );

    // Never modify an administrator through the regular
    // Users Management module.
    if (
      rows.length !== 1 ||
      rows[0].role !== "user"
    ) {
      await conn.rollback();
      inTransaction = false;

      return res.status(404).json({
        success: false,
        message: "Regular user account was not found."
      });
    }

    const currentFlag = Number(rows[0].is_active);

    if (currentFlag !== 0 && currentFlag !== 1) {
      throw new Error("Unexpected stored account status.");
    }

    const previousStatus =
      currentFlag === 1 ? "active" : "inactive";

    // No database changes or history for unchanged requests.
    if (previousStatus === nextStatus) {
      await conn.rollback();
      inTransaction = false;

      return res.status(200).json({
        success: true,
        changed: false,
        status: previousStatus,
        message: "Account status is already up to date."
      });
    }

    const [update] = await conn.query(
      `UPDATE users
       SET is_active = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND role = 'user'`,
      [nextIsActive, targetUserId]
    );

    if (Number(update.affectedRows) !== 1) {
      throw new Error("Account status update was not confirmed.");
    }

    const actionType = nextStatus === "active"
      ? "account_activated"
      : "account_deactivated";

    const [history] = await conn.query(
      `INSERT INTO admin_user_action_history
       (
         actor_admin_id,
         target_user_id,
         action_type,
         changed_fields,
         previous_status,
         new_status
       )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        actorAdminId,
        targetUserId,
        actionType,
        JSON.stringify(["is_active"]),
        previousStatus,
        nextStatus
      ]
    );

    if (
      Number(history.affectedRows) !== 1 ||
      !Number.isSafeInteger(Number(history.insertId)) ||
      Number(history.insertId) < 1
    ) {
      throw new Error("Account status history was not confirmed.");
    }

    await conn.commit();
    inTransaction = false;

    return res.status(200).json({
      success: true,
      changed: true,
      status: nextStatus,
      message: nextStatus === "active"
        ? "User account activated successfully."
        : "User account deactivated successfully."
    });

  } catch (error) {
    if (inTransaction && conn) {
      try {
        await conn.rollback();
        inTransaction = false;
      } catch (rollbackError) {
        console.error(
          "ADMIN USER STATUS ROLLBACK FAILED:",
          rollbackError.code || rollbackError.name
        );

        return res.status(500).json({
          success: false,
          message: "Account status update failed; database recovery review is required."
        });
      }
    }

    console.error(
      "ADMIN USER STATUS UPDATE FAILED:",
      error.code || error.name
    );

    return res.status(500).json({
      success: false,
      message: "Unable to update and record account status."
    });

  } finally {
    if (conn) conn.release();
  }
});

// KIDSOTT_ADMIN_USER_ACTION_HISTORY_V1
// Read-only history for regular user accounts.
// No passwords, JWTs, private contact values or fake events.
router.get("/:id/action-history", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");

  if (
    !req.user ||
    req.user.role !== "admin" ||
    !Number.isSafeInteger(Number(req.user.id)) ||
    Number(req.user.id) < 1
  ) {
    return res.status(403).json({
      success: false,
      message: "Administrator access is required."
    });
  }

  const rawId = req.params.id;

  if (
    typeof rawId !== "string" ||
    !/^[1-9][0-9]*$/.test(rawId) ||
    !Number.isSafeInteger(Number(rawId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid user ID."
    });
  }

  const page = intParam(req.query.page, 1, 100000);
  const pageSize = intParam(req.query.pageSize, 20, 100);

  if (page === null || pageSize === null) {
    return res.status(400).json({
      success: false,
      message: "Invalid pagination parameters."
    });
  }

  const targetUserId = Number(rawId);
  const offset = (page - 1) * pageSize;

  try {
    // History is available only for ordinary user accounts.
    const [accounts] = await db.query(
      `SELECT id
       FROM users
       WHERE id = ?
         AND role = 'user'
       LIMIT 1`,
      [targetUserId]
    );

    if (accounts.length !== 1) {
      return res.status(404).json({
        success: false,
        message: "Regular user account was not found."
      });
    }

    const [[count]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM admin_user_action_history
       WHERE target_user_id = ?`,
      [targetUserId]
    );

    const total = Number(count.total);

    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("Invalid action-history record count.");
    }

    const [rows] = await db.query(
      `SELECT
         id,
         actor_admin_id AS actorAdminId,
         action_type AS actionType,
         changed_fields AS changedFields,
         previous_status AS previousStatus,
         new_status AS newStatus,
         created_at AS createdAt
       FROM admin_user_action_history
       WHERE target_user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [targetUserId, pageSize, offset]
    );

    const allowedFields = new Set([
      "name",
      "email",
      "phone_number",
      "is_active"
    ]);

    const events = rows.map(row => {
      let fields = [];

      if (row.changedFields !== null &&
          row.changedFields !== undefined) {
        const parsed = typeof row.changedFields === "string"
          ? JSON.parse(row.changedFields)
          : row.changedFields;

        if (!Array.isArray(parsed)) {
          throw new Error("Invalid stored history field list.");
        }

        fields = parsed.filter(
          field =>
            typeof field === "string" &&
            allowedFields.has(field)
        );
      }

      const recordedAt = new Date(row.createdAt);

      if (Number.isNaN(recordedAt.getTime())) {
        throw new Error("Invalid stored history timestamp.");
      }

      return {
        id: String(row.id),
        actorAdminId: String(row.actorAdminId),
        actionType: String(row.actionType),
        changedFields: fields,
        previousStatus: row.previousStatus ?? null,
        newStatus: row.newStatus ?? null,
        createdAt: recordedAt.toISOString()
      };
    });

    return res.status(200).json({
      success: true,
      userId: String(targetUserId),
      events,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });

  } catch (error) {
    console.error(
      "ADMIN USER ACTION HISTORY QUERY FAILED:",
      error.code || error.name
    );

    return res.status(500).json({
      success: false,
      message: "Unable to load user action history."
    });
  }
});

// KIDSOTT_ADMIN_CHILD_PROFILES_READONLY_V1
// GET <existing-admin-users-mount>/:id/child-profiles
// Route inherits authenticate and requireAdmin from this router.
// Read-only: no child profile create/edit/delete endpoints are enabled.
router.get("/:id/child-profiles", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");

  const rawId = req.params.id;
  if (
    typeof rawId !== "string" ||
    !/^[1-9][0-9]*$/.test(rawId) ||
    !Number.isSafeInteger(Number(rawId))
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid parent user ID."
    });
  }

  const page = intParam(req.query.page, 1, 100000);
  const pageSize = intParam(req.query.pageSize, 20, 100);
  if (page === null || pageSize === null) {
    return res.status(400).json({
      success: false,
      message: "Invalid child-profile pagination parameters."
    });
  }

  const parentUserId = Number(rawId);
  const offset = (page - 1) * pageSize;

  try {
    const [parents] = await db.query(
      `SELECT id FROM users
       WHERE id = ? AND role = 'user'
       LIMIT 1`,
      [parentUserId]
    );

    if (parents.length !== 1) {
      return res.status(404).json({
        success: false,
        message: "Regular parent account not found."
      });
    }

    const [[count]] = await db.query(
      `SELECT COUNT(*) AS total FROM child_profiles
       WHERE parent_user_id = ?`,
      [parentUserId]
    );

    const total = Number(count.total);
    if (!Number.isSafeInteger(total) || total < 0) {
      throw new Error("Invalid child-profile count.");
    }

    const [rows] = await db.query(
      `SELECT id, name,
              age_group AS ageGroup,
              age_restriction AS ageRestriction,
              screen_time_limit_minutes AS screenTimeLimitMinutes,
              is_active AS isActive,
              created_at AS createdAt,
              updated_at AS updatedAt
       FROM child_profiles
       WHERE parent_user_id = ?
       ORDER BY id ASC
       LIMIT ? OFFSET ?`,
      [parentUserId, pageSize, offset]
    );

    const children = rows.map(row => ({
      id: String(row.id),
      name: String(row.name),
      ageGroup: String(row.ageGroup),
      ageRestriction: String(row.ageRestriction),
      screenTimeLimitMinutes: row.screenTimeLimitMinutes == null
        ? null
        : Number(row.screenTimeLimitMinutes),
      isActive: Number(row.isActive) === 1,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString()
    }));

    return res.status(200).json({
      success: true,
      userId: String(parentUserId),
      children,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (error) {
    console.error(
      "ADMIN CHILD PROFILE DIRECTORY QUERY FAILED:",
      error.code || error.name
    );
    return res.status(500).json({
      success: false,
      message: "Unable to load child profiles."
    });
  }
});

// KIDSOTT_ADMIN_CHILD_PROFILES_PARENT_OWNED_READONLY_V1
// The parent owns profile creation/edit/status from the mobile app.
// Admin child profile writes intentionally denied before reaching MySQL.
function childPositiveId(raw) {
  return typeof raw === "string" && /^[1-9][0-9]*$/.test(raw) &&
    Number.isSafeInteger(Number(raw)) ? Number(raw) : null;
}
function childAdminActor(req) {
  const id = Number(req.user?.id);
  return req.user?.role === "admin" && Number.isSafeInteger(id) && id > 0 ? id : null;
}
function rejectAdminChildProfileWrite(req, res) {
  res.set("Cache-Control", "no-store, private");
  res.set("Allow", req.method === "POST" ? "GET, HEAD" : "");
  // Use 405, not 403: the existing Admin API client treats 403 as session revocation.
  return res.status(405).json({ success: false,
    code: "CHILD_PROFILES_PARENT_MANAGED",
    message: "Child profiles are managed by parents in the mobile app. Admin access is read-only." });
}
router.post("/:id/child-profiles", rejectAdminChildProfileWrite);
router.put("/:id/child-profiles/:childId", rejectAdminChildProfileWrite);
router.patch("/:id/child-profiles/:childId/status", rejectAdminChildProfileWrite);

router.get("/:id/child-profiles/:childId/action-history", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  if (!childAdminActor(req)) return res.status(403).json({ success: false, message: "Admin required." });
  const parent = childPositiveId(req.params.id);
  const childId = childPositiveId(req.params.childId);
  if (!parent || !childId) return res.status(400).json({ success: false, message: "Invalid profile ID." });
  const page = intParam(req.query.page, 1, 100000);
  const pageSize = intParam(req.query.pageSize, 20, 100);
  if (!page || !pageSize) return res.status(400).json({ success: false, message: "Invalid pagination." });
  try {
    const [parents] = await db.query(
      `SELECT id FROM users WHERE id = ? AND role = 'user' LIMIT 1`, [parent]);
    if (parents.length !== 1) return res.status(404).json({ success: false, message: "Parent not found." });
    const [children] = await db.query(
      `SELECT id FROM child_profiles WHERE id = ? AND parent_user_id = ? LIMIT 1`,
      [childId, parent]);
    if (children.length !== 1) return res.status(404).json({ success: false, message: "Child not found." });
    const [[count]] = await db.query(
      `SELECT COUNT(*) AS total FROM admin_child_profile_action_history
       WHERE parent_user_id = ? AND child_profile_id = ?`, [parent, childId]);
    const total = Number(count.total);
    if (!Number.isSafeInteger(total) || total < 0) throw new Error("Invalid audit count.");
    const [rows] = await db.query(
      `SELECT id, actor_admin_id AS actorAdminId, action_type AS actionType,
              changed_fields AS changedFields, previous_status AS previousStatus,
              new_status AS newStatus, created_at AS createdAt
         FROM admin_child_profile_action_history
        WHERE parent_user_id = ? AND child_profile_id = ?
        ORDER BY id DESC LIMIT ? OFFSET ?`,
      [parent, childId, pageSize, (page - 1) * pageSize]);
    const allowedFields = new Set(["name", "age_group", "age_restriction",
      "screen_time_limit_minutes", "is_active"]);
    const events = rows.map(row => {
      const fields = typeof row.changedFields === "string"
        ? JSON.parse(row.changedFields) : row.changedFields;
      if (!Array.isArray(fields) ||
          fields.some(field => typeof field !== "string" || !allowedFields.has(field))) {
        throw new Error("Invalid stored child action fields.");
      }
      const timestamp = new Date(row.createdAt);
      if (Number.isNaN(timestamp.getTime())) throw new Error("Invalid audit timestamp.");
      return { id: String(row.id), actorAdminId: String(row.actorAdminId),
        actionType: String(row.actionType), changedFields: fields,
        previousStatus: row.previousStatus ?? null, newStatus: row.newStatus ?? null,
        createdAt: timestamp.toISOString() };
    });
    return res.status(200).json({ success: true, parentUserId: String(parent),
      childId: String(childId), events,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } });
  } catch (error) {
    console.error("ADMIN CHILD PROFILE ACTION HISTORY ERROR:", error.code || error.name);
    return res.status(500).json({ success: false, message: "Unable to load child action history." });
  }
});


// KIDSOTT_ADMIN_USER_DELETION_IMPACT_READONLY_V1
// Admin deletion-impact review: always READ ONLY and never an authorization to delete.
// Every dependency count is aggregate only; no user/profile/contact values returned.
const adminDeletionDependencyQueries = Object.freeze([
  ["childProfiles", "SELECT COUNT(*) AS total FROM child_profiles WHERE parent_user_id = ?"],
  ["childProfileAudit", "SELECT COUNT(*) AS total FROM admin_child_profile_action_history WHERE parent_user_id = ?"],
  ["accountAudit", "SELECT COUNT(*) AS total FROM admin_user_action_history WHERE target_user_id = ?"],
  ["subscriptionPurchases", "SELECT COUNT(*) AS total FROM subscription_purchases WHERE user_id = ?"],
  ["subscriptionEntitlements", "SELECT COUNT(*) AS total FROM subscription_entitlements WHERE user_id = ?"],
  ["supportTickets", "SELECT COUNT(*) AS total FROM support_tickets WHERE user_id = ?"],
  ["favorites", "SELECT COUNT(*) AS total FROM favorites WHERE user_id = ?"],
  ["watchHistory", "SELECT COUNT(*) AS total FROM watch_history WHERE user_id = ?"],
  ["userSettings", "SELECT COUNT(*) AS total FROM user_settings WHERE user_id = ?"],
  ["createdVideos", "SELECT COUNT(*) AS total FROM videos WHERE created_by = ?"],
]);
router.get("/:id/deletion-impact", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
  if (req.user?.role !== "admin") return res.status(403).json({
    success: false, message: "Administrator access is required."
  });
  const idString = req.params.id;
  if (typeof idString !== "string" || !/^[1-9][0-9]*$/.test(idString) ||
      !Number.isSafeInteger(Number(idString))) {
    return res.status(400).json({success: false, message: "Invalid account ID."});
  }
  const userId = Number(idString);
  try {
    const [users] = await db.query(
      "SELECT id FROM users WHERE id = ? AND role = 'user' LIMIT 1", [userId]);
    if (users.length !== 1) return res.status(404).json({
      success: false, message: "Regular account not found."
    });
    const dependencies = {};
    for (const [key, sql] of adminDeletionDependencyQueries) {
      const [[row]] = await db.query(sql, [userId]);
      const count = Number(row?.total);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("Invalid dependency count: " + key);
      }
      dependencies[key] = count;
    }
    return res.status(200).json({
      success: true,
      userId: String(userId),
      deletionEnabled: false,
      requiresManualPolicyReview: true,
      dependencies,
      message: "Permanent deletion is disabled. Counts are for impact review only."
    });
  } catch (error) {
    console.error("ADMIN USER DELETION IMPACT ERROR:", error.code || error.name);
    return res.status(500).json({
      success: false, message: "Unable to load account dependency review."
    });
  }
});

module.exports = router;
