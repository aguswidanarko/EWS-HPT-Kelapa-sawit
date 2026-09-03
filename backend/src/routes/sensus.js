const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestSensus } = require('../services/ingestion');
const { buildSamplingPlan } = require('../services/sensusEngines');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['estate_id', 'afdeling_id', 'blok_id', 'jenis_sensus', 'kategori', 'ews_alert']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
    let sql = 'SELECT * FROM sensus';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

// GET /api/sensus/plan?blok_id=&jenis_sensus= -> the baris-sampel/grid the officer should walk
router.get(
  '/plan',
  asyncHandler(async (req, res) => {
    const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(req.query.blok_id);
    if (!blok) return res.status(404).json({ error: 'Blok not found' });
    const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(req.query.jenis_sensus);
    const metode = hpt ? hpt.metode_sensus : 'BARIS_SAMPEL';
    res.json({ data: buildSamplingPlan(blok, metode) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM sensus WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'PETUGAS_SENSUS', 'RND_FOD', 'PETUGAS_LAPANGAN'),
  asyncHandler(async (req, res) => {
    const result = ingestSensus(
      { ...req.body, source: req.body.source || 'WEB' },
      { user_id: req.body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({
      data: result.row,
      computed: result.computed,
      threshold_engine: { kategori: result.engineResult.kategori, incident: result.engineResult.incident, alert: result.engineResult.alert },
      duplicate_suspect: result.duplicate,
    });
  })
);

module.exports = router;
