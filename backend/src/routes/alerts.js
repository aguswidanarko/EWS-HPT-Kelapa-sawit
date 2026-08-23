// EWS Alert Center (SPEC.md section 7, updated to SPEC_V2.md section 1 item 6). Status:
// NEW->ACKNOWLEDGED->ACTION_REQUIRED->IN_PROGRESS->COMPLETED->VERIFIED->CLOSED (V2 7-state flow;
// V1 data migrated once at boot in db/db.js: CONTROLLED->COMPLETED, MONITORING->VERIFIED). No
// approval gating -- any allowed role can move status forward/back; every change is audit logged.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const VALID_STATUSES = ['NEW', 'ACKNOWLEDGED', 'ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['status', 'kategori', 'estate_id', 'afdeling_id', 'blok_id', 'hpt_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`a.${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = `SELECT a.*, i.incident_code, h.name AS hpt_name, e.name AS estate_name, af.name AS afdeling_name, b.code AS blok_code
               FROM alert a
               JOIN incident i ON i.id = a.incident_id
               LEFT JOIN hpt h ON h.id = a.hpt_id
               LEFT JOIN estate e ON e.id = a.estate_id
               LEFT JOIN afdeling af ON af.id = a.afdeling_id
               LEFT JOIN blok b ON b.id = a.blok_id`;
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY a.created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const alert = db
      .prepare(
        `SELECT a.*, i.incident_code, h.name AS hpt_name, e.name AS estate_name, af.name AS afdeling_name, b.code AS blok_code
         FROM alert a
         JOIN incident i ON i.id = a.incident_id
         LEFT JOIN hpt h ON h.id = a.hpt_id
         LEFT JOIN estate e ON e.id = a.estate_id
         LEFT JOIN afdeling af ON af.id = a.afdeling_id
         LEFT JOIN blok b ON b.id = a.blok_id
         WHERE a.id=?`
      )
      .get(req.params.id);
    if (!alert) return res.status(404).json({ error: 'Not found' });
    const notifications = db.prepare('SELECT * FROM notification WHERE alert_id=? ORDER BY created_at DESC').all(alert.id);
    let source = null;
    if (alert.source_type === 'DETECTION') source = db.prepare('SELECT * FROM detection WHERE id=?').get(alert.source_id);
    if (alert.source_type === 'SENSUS') source = db.prepare('SELECT * FROM sensus WHERE id=?').get(alert.source_id);
    if (alert.source_type === 'MORTALITY') source = db.prepare('SELECT * FROM mortality WHERE id=?').get(alert.source_id);
    const photos = source ? db.prepare('SELECT * FROM photo WHERE entity_type=? AND entity_id=?').all(alert.source_type, source.id) : [];
    res.json({ data: { ...alert, notifications, source, photos } });
  })
);

router.put(
  '/:id/status',
  requireRole('ADMIN', 'MANAGER', 'ASKEP_ASISTEN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: `status harus salah satu dari ${VALID_STATUSES.join(', ')}` });
    const before = db.prepare('SELECT * FROM alert WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE alert SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
    const after = db.prepare('SELECT * FROM alert WHERE id=?').get(req.params.id);

    // Mirror onto the parent incident's status for a consistent overall picture, and close it
    // out (closed_at) when the alert reaches CLOSED.
    db.prepare(`UPDATE incident SET status=?, updated_at=datetime('now')${status === 'CLOSED' ? ", closed_at=datetime('now')" : ''} WHERE id=?`).run(
      status,
      before.incident_id
    );

    auditFromReq(req, { aktivitas: 'ALERT_STATUS_CHANGE', before, after });
    res.json({ data: after });
  })
);

module.exports = router;
