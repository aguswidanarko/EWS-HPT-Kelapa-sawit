const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestDetection } = require('../services/ingestion');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['estate_id', 'afdeling_id', 'blok_id', 'hpt_id', 'kategori', 'ews_alert']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
    let sql = 'SELECT * FROM detection';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM detection WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'PETUGAS_DETEKSI', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const result = ingestDetection(
      { ...req.body, source: req.body.source || 'WEB' },
      { user_id: req.body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({ data: result.row, threshold_engine: { kategori: result.engineResult.kategori, incident: result.engineResult.incident, alert: result.engineResult.alert }, duplicate_suspect: result.duplicate, location_warning: result.location_warning });
  })
);

module.exports = router;
