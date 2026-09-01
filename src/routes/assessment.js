// BRD V3.1 Universal Assessment Form endpoint. Thin REST wrapper around
// services/assessmentEngine.js's ingestAssessment()/getAssessmentDetail(), same idiom as
// routes/agroObservation.js -- the service does all the resolve/tally/classify/insert work,
// this route only handles auth/role gating and the HTTP request/response envelope.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestAssessment, getAssessmentDetail } = require('../services/assessmentEngine');

const router = express.Router();
router.use(requireAuth);

const CREATE_ROLES = ['ADMIN', 'RND_FOD', 'PETUGAS_SENSUS', 'ASKEP_ASISTEN'];

// -------------------------------------------------------------------------------------- list
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['estate_id', 'afdeling_id', 'blok_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
    let sql = 'SELECT * FROM assessment';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 200';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = getAssessmentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json({ data: detail });
  })
);

// ------------------------------------------------------------------------------------ create
router.post(
  '/',
  requireRole(...CREATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    const result = ingestAssessment(
      { ...body, source: body.source || 'MOBILE' },
      { user_id: body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({
      data: result.assessment,
      calculation_results: result.calculationResults,
      location_warning: !!result.location_warning,
    });
  })
);

module.exports = router;
