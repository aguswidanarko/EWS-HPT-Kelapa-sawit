// Agro Observation (BRD V3 "EWS Dictionary" AGR-005..014 -- Etiolasi, Pokok doyong, Areal tanpa
// teras, Overpruning, Susunan pelepah, Ground cover management, Pokok kerdil, Abnormal, Pokok
// sisipan, Pokok mati). Thin REST wrapper around services/ingestion.js's ingestAgroObservation(),
// same shape as routes/detection.js -- the service already does all the resolve/classify/insert
// work, this route only handles auth/role gating and the HTTP request/response envelope.
//
// This closes the gap flagged in services/ewsRegistry.js's agroObservationEntry() comment
// ("POST /api/agro-observation (Task #26 - not yet created)") -- until now the only writer of
// agro_observation rows was the Import/Export Center's bulk Excel commit path
// (routes/ewsTransaction.js); this is the first live single-record create endpoint, built for the
// Mobile V3 Dynamic Form Engine (BRD_V3_Mobile_Offline.docx section 3) so field officers can
// capture these 10 indicators from the field like every other EWS module.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { ingestAgroObservation } = require('../services/ingestion');

const router = express.Router();
router.use(requireAuth);

const CREATE_ROLES = ['ADMIN', 'RND_FOD', 'PETUGAS_SENSUS', 'ASKEP_ASISTEN', 'PETUGAS_LAPANGAN'];

// -------------------------------------------------------------------------------------- list
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['estate_id', 'afdeling_id', 'blok_id', 'hpt_id', 'ews_id', 'kategori', 'ews_alert']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
    let sql = 'SELECT * FROM agro_observation';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM agro_observation WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

// ------------------------------------------------------------------------------------ create
// Mobile's EWS_FORM_SCHEMA (ewsFormSchema.ts, mirrors this backend's ewsRegistry.js) always knows
// hpt_id (resolved locally from the synced `hpt` table by code) and sends it directly -- the
// ews_id fallback lookup below exists only as a defensive backstop for any other caller (e.g. a
// future admin tool) that only has ews_id on hand.
router.post(
  '/',
  requireRole(...CREATE_ROLES),
  asyncHandler(async (req, res) => {
    const body = { ...req.body };
    if (!body.hpt_id && body.ews_id) {
      const dict = db.prepare('SELECT hpt_id FROM ews_dictionary WHERE ews_id=?').get(body.ews_id);
      if (dict) body.hpt_id = dict.hpt_id;
    }
    const result = ingestAgroObservation(
      { ...body, source: body.source || 'MOBILE' },
      { user_id: body.user_id || req.user.id, ip_session: req.ip }
    );
    res.status(201).json({
      data: result.row,
      classification: {
        kategori: result.classified.kategori,
        ews_alert: !!result.classified.ews_alert,
        incident: result.classified.incident,
        alert: result.classified.alert,
        rule_version_id: result.classified.rule_version_id,
        classify_note: result.classified.classify_error || null,
      },
      location_warning: !!result.location_warning,
    });
  })
);

module.exports = router;
