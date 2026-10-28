"use strict";

// KIDSOTT_ADMIN_SUPPORT_READONLY_V1
// KIDSOTT_SUPPORT_FRONTEND_29A04
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
        t.type, t.message, t.status, t.priority, t.assigned_admin_id,
        assigned.name AS assigned_admin_name, t.created_at, t.updated_at
      FROM support_tickets t
      INNER JOIN users u ON u.id = t.user_id AND u.role = 'user'
      LEFT JOIN users assigned ON assigned.id = t.assigned_admin_id AND assigned.role = 'admin'
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
      priority: String(row.priority || "medium"),
      assignedAdminId: row.assigned_admin_id == null ? null : String(row.assigned_admin_id),
      assignedAdminName: String(row.assigned_admin_name || ""),
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

// KIDSOTT_SUPPORT_ADMIN_OPERATIONS_29A03
// Admin-only ticket mutations. Persist a metadata audit row in same transaction.
const SUP_SUPPORT_STATUSES = new Set(['open','in_progress','resolved','closed']);
const SUP_SUPPORT_PRIORITIES = new Set(['low','medium','high','urgent']);

function supTicketId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
function supActorId(req) {
  const id = Number(req.user && req.user.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function supHasOnly(body, field) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    Object.keys(body).length === 1 && Object.hasOwn(body, field);
}
function supBad(res, code, message) { return res.status(code).json({success:false, message}); }
function supFault(res, error) {
  console.error('ADMIN SUPPORT MUTATION ERROR:', error && (error.code || error.name) || 'unknown');
  return supBad(res, 500, 'Unable to update support ticket.');
}

router.get('/agents', async (_req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, name, email FROM users WHERE role = 'admin' AND is_active = 1 ORDER BY name, id LIMIT 200`
    );
    return res.json({success:true, agents: rows.map(row => ({
      id:String(row.id), name:String(row.name), email:String(row.email)
    }))});
  } catch (e) { return supFault(res, e); }
});

router.get('/tickets/:ticketId/history', async (req, res) => {
  const ticketId = supTicketId(req.params.ticketId);
  if (!ticketId) return supBad(res, 400, 'Invalid ticket ID.');
  try {
    const [found] = await db.query('SELECT id FROM support_tickets WHERE id = ? LIMIT 1',[ticketId]);
    if (!found.length) return supBad(res, 404, 'Ticket not found.');
    const [rows] = await db.query(
      `SELECT h.id, h.action_type, h.previous_value, h.new_value, h.created_at,
              u.name AS admin_name
         FROM admin_support_ticket_history h
         INNER JOIN users u ON u.id = h.actor_admin_id
        WHERE h.ticket_id = ? ORDER BY h.id DESC LIMIT 200`,
      [ticketId]
    );
    return res.json({success:true, history:rows.map(row => ({
      id:String(row.id),
      type:String(row.action_type),
      previousValue:row.previous_value === null ? null : String(row.previous_value),
      newValue:row.new_value === null ? null : String(row.new_value),
      adminName:String(row.admin_name),
      createdAt:new Date(row.created_at).toISOString()
    }))});
  } catch (e) { return supFault(res, e); }
});

async function supMutateTicket(req, res, field) {
  const ticketId = supTicketId(req.params.ticketId);
  const actorId = supActorId(req);
  if (!ticketId) return supBad(res, 400, 'Invalid ticket ID.');
  if (!actorId) return supBad(res, 401, 'Valid administrator session required.');
  const apiField = field === 'assignment' ? 'assignedAdminId' : field;
  if (!supHasOnly(req.body, apiField)) return supBad(res, 400, 'Supply only '+apiField+'.');
  let requested = req.body[apiField];
  if (field === 'status' && !SUP_SUPPORT_STATUSES.has(requested))
    return supBad(res, 400, 'Invalid ticket status.');
  if (field === 'priority' && !SUP_SUPPORT_PRIORITIES.has(requested))
    return supBad(res, 400, 'Invalid ticket priority.');
  if (field === 'assignment') {
    if (requested !== null && (typeof requested !== 'string' || !supTicketId(requested)))
      return supBad(res, 400, 'Assigned Admin ID must be a positive ID string or null.');
    requested = requested === null ? null : Number(requested);
  }
  if (typeof db.getConnection !== 'function') return supBad(res, 503, 'Transactional database unavailable.');
  let connection;
  let transaction = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction(); transaction = true;
    const [rows] = await connection.query(
      `SELECT id,status,priority,assigned_admin_id,resolved_at,closed_at
         FROM support_tickets WHERE id = ? FOR UPDATE`, [ticketId]
    );
    if (!rows.length) {
      await connection.rollback();transaction=false;
      return supBad(res, 404, 'Ticket not found.');
    }
    const row = rows[0];
    let previous;
    let next;
    if (field === 'status') {
      previous = String(row.status); next = requested;
      if ((previous === 'closed' && next !== 'open' && next !== 'closed') ||
          (next === 'closed' && previous !== 'resolved' && previous !== 'closed')) {
        await connection.rollback();transaction=false;
        return supBad(res, 409, 'Close only a resolved ticket; reopen a closed ticket to Open.');
      }
    } else if (field === 'priority') {
      previous = String(row.priority); next = requested;
    } else {
      previous = row.assigned_admin_id === null ? null : String(row.assigned_admin_id);
      next = requested === null ? null : String(requested);
      if (next !== null) {
        const [admins] = await connection.query(
          `SELECT id FROM users WHERE id = ? AND role = 'admin' AND is_active = 1 LIMIT 1`,
          [requested]
        );
        if (!admins.length) {
          await connection.rollback();transaction=false;
          return supBad(res, 400, 'Assigned account is not an active Admin.');
        }
      }
    }
    if (previous === next) {
      await connection.rollback();transaction=false;
      return res.json({success:true, changed:false, ticketId:String(ticketId)});
    }
    if (field === 'status') {
      await connection.query(
        `UPDATE support_tickets SET status = ?,
          resolved_at = CASE WHEN ? = 'resolved' THEN COALESCE(resolved_at, UTC_TIMESTAMP(3))
                             WHEN ? = 'closed' THEN resolved_at ELSE NULL END,
          closed_at = CASE WHEN ? = 'closed' THEN UTC_TIMESTAMP(3) ELSE NULL END
          WHERE id = ?`, [next,next,next,next,ticketId]
      );
    } else if (field === 'priority') {
      await connection.query(`UPDATE support_tickets SET priority = ? WHERE id = ?`, [next,ticketId]);
    } else {
      await connection.query(`UPDATE support_tickets SET assigned_admin_id = ? WHERE id = ?`, [requested,ticketId]);
    }
    await connection.query(
      `INSERT INTO admin_support_ticket_history
        (ticket_id,actor_admin_id,action_type,previous_value,new_value)
        VALUES (?,?,?,?,?)`, [ticketId,actorId,field,previous,next]
    );
    await connection.commit();transaction=false;
    return res.json({success:true, changed:true, ticketId:String(ticketId), previousValue:previous, newValue:next});
  } catch (e) {
    if (transaction && connection) {
      try {await connection.rollback();} catch (_) { /* logged by original error */ }
    }
    return supFault(res, e);
  } finally {
    if (connection) connection.release();
  }
}

router.patch('/tickets/:ticketId/status', (req,res) => supMutateTicket(req,res,'status'));
router.patch('/tickets/:ticketId/priority', (req,res) => supMutateTicket(req,res,'priority'));
router.patch('/tickets/:ticketId/assignment', (req,res) => supMutateTicket(req,res,'assignment'));

// KIDSOTT_SUPPORT_ADMIN_MESSAGES_29A05
// Strictly Admin-only internal storage. Reply records are NOT delivered to parents.
const SUP29A05_KINDS = new Set(['reply', 'note']);

function sup29a05Body(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      Object.keys(raw).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(raw, 'kind') ||
      !Object.prototype.hasOwnProperty.call(raw, 'body') ||
      !SUP29A05_KINDS.has(raw.kind) ||
      typeof raw.body !== 'string') return null;
  const body = raw.body.trim();
  if (body.length < 2 || body.length > 4000 || body.includes('\u0000')) return null;
  return {kind:raw.kind, body};
}

router.get('/tickets/:ticketId/messages', async (req, res) => {
  const ticketId = supTicketId(req.params.ticketId);
  if (!ticketId) return supBad(res, 400, 'Invalid ticket ID.');
  try {
    const [found] = await db.query(
      'SELECT id FROM support_tickets WHERE id = ? LIMIT 1', [ticketId]
    );
    if (!found.length) return supBad(res, 404, 'Ticket not found.');
    const [rows] = await db.query(
      `SELECT m.id, m.kind, m.body, m.delivery_status, m.created_at,
              u.name AS admin_name
         FROM admin_support_ticket_messages m
         INNER JOIN users u ON u.id = m.actor_admin_id
        WHERE m.ticket_id = ? ORDER BY m.id ASC LIMIT 201`, [ticketId]
    );
    const truncated = rows.length > 200;
    return res.status(200).json({
      success:true, ticketId:String(ticketId), truncated,
      messages:rows.slice(0,200).map(row => ({
        id:String(row.id), kind:String(row.kind), body:String(row.body),
        deliveryStatus:String(row.delivery_status), adminName:String(row.admin_name),
        createdAt:new Date(row.created_at).toISOString()
      }))
    });
  } catch (error) { return supFault(res, error); }
});

router.post('/tickets/:ticketId/messages', async (req, res) => {
  const ticketId = supTicketId(req.params.ticketId);
  const actorId = supActorId(req);
  if (!ticketId) return supBad(res, 400, 'Invalid ticket ID.');
  if (!actorId) return supBad(res, 401, 'Valid administrator session required.');
  const message = sup29a05Body(req.body);
  if (!message) return supBad(res, 400, 'Provide only kind (reply/note) and a 2–4000 character body.');
  if (typeof db.getConnection !== 'function') return supBad(res, 503, 'Transactional database unavailable.');
  let connection;
  let transaction = false;
  try {
    connection = await db.getConnection();
    await connection.beginTransaction(); transaction = true;
    const [admins] = await connection.query(
      `SELECT id FROM users WHERE id = ? AND role = 'admin' AND is_active = 1 LIMIT 1`,
      [actorId]
    );
    if (!admins.length) {
      await connection.rollback(); transaction=false;
      return supBad(res, 403, 'Active administrator required.');
    }
    const [tickets] = await connection.query(
      'SELECT id, status FROM support_tickets WHERE id = ? FOR UPDATE', [ticketId]
    );
    if (!tickets.length) {
      await connection.rollback(); transaction=false;
      return supBad(res, 404, 'Ticket not found.');
    }
    if (message.kind === 'reply' && tickets[0].status === 'closed') {
      await connection.rollback(); transaction=false;
      return supBad(res, 409, 'Reopen a closed ticket before saving a staff reply.');
    }
    const [result] = await connection.query(
      `INSERT INTO admin_support_ticket_messages
        (ticket_id, actor_admin_id, kind, body, delivery_status)
       VALUES (?, ?, ?, ?, 'not_sent')`,
      [ticketId, actorId, message.kind, message.body]
    );
    await connection.commit(); transaction=false;
    return res.status(201).json({
      success:true, messageId:String(result.insertId),
      ticketId:String(ticketId), kind:message.kind,
      saved:true, delivered:false, deliveryStatus:'not_sent'
    });
  } catch (error) {
    if (transaction && connection) {
      try { await connection.rollback(); } catch (_) { /* retain original failure */ }
    }
    return supFault(res, error);
  } finally {
    if (connection) connection.release();
  }
});

// KIDSOTT_SUPPORT_CONFIG_ADMIN_29A09 — protected Support configuration endpoints
router.use('/config', require('./admin-support-config.routes'));

module.exports = router;