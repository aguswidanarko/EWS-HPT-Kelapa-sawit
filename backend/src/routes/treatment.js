const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestTreatment } = require('../services/ingestion');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['estate_id', 'afdeling_id', 'blok_id', 'hpt_id', 'status', 'incident_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM treatment';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM treatment WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'PETUGAS_PENGENDALIAN', 'ASKEP_ASISTEN', 'PETUGAS_LAPANGAN'),
  asyncHandler(async (req, res) => {
    const result = ingestTreatment(
      { ...req.body, source: req.body.source || 'WEB' },
      { user_id: req.body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({ data: result.row, incident: result.incident });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'PETUGAS_PENGENDALIAN', 'ASKEP_ASISTEN', 'PETUGAS_LAPANGAN'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM treatment WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['status', 'tanggal_selesai', 'catatan', 'jumlah_pokok', 'hk'].filter((f) => req.body[f] !== undefined);
    if (fields.length) {
      const setSql = fields.map((f) => `${f}=@${f}`).join(', ');
      db.prepare(`UPDATE treatment SET ${setSql}, updated_at=datetime('now') WHERE id=@id`).run({ ...req.body, id: req.params.id });
    }
    const after = db.prepare('SELECT * FROM treatment WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_TREATMENT', before, after });
    res.json({ data: after });
  })
);

module.exports = router;
