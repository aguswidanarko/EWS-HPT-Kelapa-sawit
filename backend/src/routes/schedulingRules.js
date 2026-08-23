// Generic Scheduling Rule CRUD + "generate now" action (SPEC_V2.md section 1 item 5 / section 4
// Backend module list). Backs the Dashboard "Monitoring Schedule" + "Rule & Parameter Management"
// screens (SPEC_V2.md section 4 Dashboard).

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');
const { generateAllDueSchedules, generateScheduleForRule, isOverdue } = require('../services/schedulingEngine');

const router = express.Router();
router.use(requireAuth);

const WRITE_ROLES = ['ADMIN', 'RND_FOD'];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['hpt_id', 'jenis_kegiatan', 'interval_type', 'based_on', 'active']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM scheduling_rule';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY hpt_id, id';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const fields = ['hpt_id', 'jenis_kegiatan', 'interval_type', 'interval_value', 'interval_unit', 'based_on', 'active'].filter((f) => req.body[f] !== undefined);
    if (!fields.length || req.body.hpt_id === undefined || req.body.interval_type === undefined) {
      return res.status(400).json({ error: 'hpt_id dan interval_type wajib diisi' });
    }
    const cols = fields.join(', ');
    const params = fields.map((f) => '@' + f).join(', ');
    const info = db.prepare(`INSERT INTO scheduling_rule (${cols}) VALUES (${params})`).run(req.body);
    const row = db.prepare('SELECT * FROM scheduling_rule WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_SCHEDULING_RULE', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM scheduling_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['hpt_id', 'jenis_kegiatan', 'interval_type', 'interval_value', 'interval_unit', 'based_on', 'active'].filter((f) => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE scheduling_rule SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id: req.params.id });
    const after = db.prepare('SELECT * FROM scheduling_rule WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_SCHEDULING_RULE', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM scheduling_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM scheduling_rule WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_SCHEDULING_RULE', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

// POST /api/scheduling-rules/generate -> run every active rule now, create due `schedule` rows.
// Body: { blok_ids?: number[] }
router.post(
  '/generate',
  requireRole('ADMIN', 'RND_FOD', 'ASKEP_ASISTEN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const result = generateAllDueSchedules({ blok_ids: req.body.blok_ids });
    auditFromReq(req, { aktivitas: 'GENERATE_SCHEDULE', after: { total_created: result.reduce((a, r) => a + r.created_count, 0) } });
    res.json({ data: result });
  })
);

router.post(
  '/:id/generate',
  requireRole('ADMIN', 'RND_FOD', 'ASKEP_ASISTEN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const rule = db.prepare('SELECT * FROM scheduling_rule WHERE id=?').get(req.params.id);
    if (!rule) return res.status(404).json({ error: 'Not found' });
    const created = generateScheduleForRule(rule, { blok_ids: req.body.blok_ids });
    auditFromReq(req, { aktivitas: 'GENERATE_SCHEDULE', after: { scheduling_rule_id: rule.id, created_count: created.length } });
    res.json({ data: created });
  })
);

// GET /api/scheduling-rules/overdue?hpt_id=&blok_id= -> Monitoring Schedule screen backing.
router.get(
  '/overdue',
  asyncHandler(async (req, res) => {
    const { hpt_id, blok_id, jenis_kegiatan } = req.query;
    if (!hpt_id || !blok_id) return res.status(400).json({ error: 'hpt_id dan blok_id wajib diisi' });
    res.json({ data: isOverdue(Number(blok_id), Number(hpt_id), jenis_kegiatan || 'SENSUS') });
  })
);

module.exports = router;
