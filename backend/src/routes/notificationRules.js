// Notification rule configuration CRUD (trigger x recipient) — SPEC.md section 7.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ data: db.prepare('SELECT * FROM notification_rule ORDER BY id').all() });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { trigger_type, recipient_role, recipient_user_id, recipient_pic, channel, active } = req.body;
    if (!trigger_type) return res.status(400).json({ error: 'trigger_type wajib diisi' });
    const info = db
      .prepare(
        `INSERT INTO notification_rule (trigger_type, recipient_role, recipient_user_id, recipient_pic, channel, active)
         VALUES (@trigger_type, @recipient_role, @recipient_user_id, @recipient_pic, @channel, @active)`
      )
      .run({
        trigger_type,
        recipient_role: recipient_role || null,
        recipient_user_id: recipient_user_id || null,
        recipient_pic: recipient_pic ? 1 : 0,
        channel: channel || 'DASHBOARD',
        active: active === undefined ? 1 : Number(active),
      });
    const row = db.prepare('SELECT * FROM notification_rule WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_NOTIFICATION_RULE', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM notification_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['trigger_type', 'recipient_role', 'recipient_user_id', 'recipient_pic', 'channel', 'active'].filter((f) => req.body[f] !== undefined);
    if (fields.length) {
      const setSql = fields.map((f) => `${f}=@${f}`).join(', ');
      db.prepare(`UPDATE notification_rule SET ${setSql}, updated_at=datetime('now') WHERE id=@id`).run({ ...req.body, id: req.params.id });
    }
    const after = db.prepare('SELECT * FROM notification_rule WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_NOTIFICATION_RULE', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM notification_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM notification_rule WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_NOTIFICATION_RULE', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

// Notification log (per alert): channel, recipient, waktu, status, response provider, error.
router.get(
  '/log',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.alert_id) { clauses.push('alert_id=@alert_id'); params.alert_id = req.query.alert_id; }
    if (req.query.status) { clauses.push('status=@status'); params.status = req.query.status; }
    let sql = 'SELECT * FROM notification';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

module.exports = router;
