// Action Plan (SPEC_V2.md section 2 / section 1 item 4: "Action Plan jadi modul formal, bukan
// sekadar field saran_pengendalian di sensus"). Status flow OPEN->PLANNED->IN_PROGRESS->
// COMPLETED->VERIFIED->CLOSED -- distinct from the Alert 7-state flow. Overdue/escalated are
// derived from due_date vs status on every read, and persisted opportunistically so list queries
// filtering on `overdue` stay correct without a background job.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const OPEN_STATUSES = ['OPEN', 'PLANNED', 'IN_PROGRESS'];
const VALID_STATUSES = ['OPEN', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];
const ESCALATE_AFTER_DAYS = 7; // judgment call: no explicit escalation-day number in SPEC_V2.md; documented in final report.

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Recomputes overdue/escalated for one row and persists if changed. Returns the fresh row. */
function refreshOverdue(row) {
  if (!row) return row;
  const isOpenStatus = OPEN_STATUSES.includes(row.status);
  const overdue = !!(isOpenStatus && row.due_date && row.due_date < todayISO());
  let escalated = !!row.escalated;
  if (overdue && row.due_date) {
    const daysOverdue = Math.floor((Date.now() - new Date(row.due_date).getTime()) / 86400000);
    if (daysOverdue >= ESCALATE_AFTER_DAYS) escalated = true;
  }
  if (!isOpenStatus) escalated = row.escalated ? true : false; // don't un-escalate history once closed/verified
  if (Number(row.overdue) !== (overdue ? 1 : 0) || Number(row.escalated) !== (escalated ? 1 : 0)) {
    db.prepare(`UPDATE action_plan SET overdue=?, escalated=? WHERE id=?`).run(overdue ? 1 : 0, escalated ? 1 : 0, row.id);
    return db.prepare('SELECT * FROM action_plan WHERE id=?').get(row.id);
  }
  return row;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['status', 'pic_user_id', 'incident_id', 'alert_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM action_plan';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY due_date IS NULL, due_date, created_at DESC LIMIT 500';
    let rows = db.prepare(sql).all(params);
    rows = rows.map(refreshOverdue);
    if (req.query.overdue !== undefined) {
      const want = req.query.overdue === '1' || req.query.overdue === 'true';
      rows = rows.filter((r) => !!r.overdue === want);
    }
    res.json({ data: rows });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    let row = db.prepare('SELECT * FROM action_plan WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    row = refreshOverdue(row);
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { incident_id, alert_id, problem, recommendation, pic_user_id, due_date, related_leaf_analysis_id } = req.body;
    const server_id = req.body.server_id || uuidv4();
    const info = db
      .prepare(
        `INSERT INTO action_plan (
          local_id, server_id, incident_id, alert_id, problem, recommendation, pic_user_id, due_date,
          status, related_leaf_analysis_id, user_id, device_id, source, sync_status
        ) VALUES (
          @local_id, @server_id, @incident_id, @alert_id, @problem, @recommendation, @pic_user_id, @due_date,
          'OPEN', @related_leaf_analysis_id, @user_id, @device_id, @source, @sync_status
        )`
      )
      .run({
        local_id: req.body.local_id || null,
        server_id,
        incident_id: incident_id || null,
        alert_id: alert_id || null,
        problem: problem || null,
        recommendation: recommendation || null,
        pic_user_id: pic_user_id || null,
        due_date: due_date || null,
        related_leaf_analysis_id: related_leaf_analysis_id || null,
        user_id: req.user.id,
        device_id: req.body.device_id || null,
        source: req.body.source || 'WEB',
        sync_status: req.body.sync_status || 'SYNCED',
      });
    const row = db.prepare('SELECT * FROM action_plan WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_ACTION_PLAN', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD', 'PETUGAS_PENGENDALIAN'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM action_plan WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const editable = ['problem', 'recommendation', 'actual_action', 'pic_user_id', 'due_date', 'status', 'evidence_photo_id'];
    const fields = editable.filter((f) => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ error: `status harus salah satu dari ${VALID_STATUSES.join(', ')}` });
    }
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE action_plan SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id: req.params.id });
    let after = db.prepare('SELECT * FROM action_plan WHERE id=?').get(req.params.id);
    after = refreshOverdue(after);
    auditFromReq(req, { aktivitas: 'UPDATE_ACTION_PLAN', before, after });
    res.json({ data: after });
  })
);

// PUT /:id/verify -> verification step (SPEC_V2.md section 2: verification_note, verified_by_user_id, verified_at).
router.put(
  '/:id/verify',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM action_plan WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare(
      `UPDATE action_plan SET status='VERIFIED', verification_note=?, verified_by_user_id=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`
    ).run(req.body.verification_note || null, req.user.id, req.params.id);
    const after = db.prepare('SELECT * FROM action_plan WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'VERIFY_ACTION_PLAN', before, after });
    res.json({ data: after });
  })
);

module.exports = router;
