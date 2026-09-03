const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestMortality } = require('../services/ingestion');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['incident_id', 'treatment_id', 'service_required', 'hasil_efektivitas']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM mortality';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM mortality WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'PETUGAS_PENGENDALIAN', 'PETUGAS_LAPANGAN'),
  asyncHandler(async (req, res) => {
    const result = ingestMortality(
      { ...req.body, source: req.body.source || 'WEB' },
      { user_id: req.body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({ data: result.row, evaluasi_efektivitas: result.evalResult });
  })
);

module.exports = router;
