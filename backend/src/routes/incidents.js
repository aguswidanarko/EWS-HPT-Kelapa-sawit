// Incident Management: every case that crosses a threshold gets an Incident ID connecting the
// full cycle Deteksi -> Sensus -> Treatment -> Mortality, fully traceable (SPEC.md principle #8).

const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['status', 'severity', 'estate_id', 'afdeling_id', 'blok_id', 'hpt_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`i.${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = `SELECT i.*, h.name AS hpt_name, e.name AS estate_name, af.name AS afdeling_name, b.code AS blok_code
               FROM incident i
               LEFT JOIN hpt h ON h.id=i.hpt_id LEFT JOIN estate e ON e.id=i.estate_id
               LEFT JOIN afdeling af ON af.id=i.afdeling_id LEFT JOIN blok b ON b.id=i.blok_id`;
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY i.opened_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const incident = db
      .prepare(
        `SELECT i.*, h.name AS hpt_name, e.name AS estate_name, af.name AS afdeling_name, b.code AS blok_code
         FROM incident i
         LEFT JOIN hpt h ON h.id=i.hpt_id LEFT JOIN estate e ON e.id=i.estate_id
         LEFT JOIN afdeling af ON af.id=i.afdeling_id LEFT JOIN blok b ON b.id=i.blok_id
         WHERE i.id=?`
      )
      .get(req.params.id);
    if (!incident) return res.status(404).json({ error: 'Not found' });

    const detections = db.prepare('SELECT * FROM detection WHERE incident_id=? ORDER BY tanggal, created_at').all(incident.id);
    const sensuses = db.prepare('SELECT * FROM sensus WHERE incident_id=? ORDER BY tanggal, created_at').all(incident.id);
    const treatments = db.prepare('SELECT * FROM treatment WHERE incident_id=? ORDER BY tanggal_mulai, created_at').all(incident.id);
    const mortalities = db.prepare('SELECT * FROM mortality WHERE incident_id=? ORDER BY tanggal, created_at').all(incident.id);
    const alerts = db.prepare('SELECT * FROM alert WHERE incident_id=? ORDER BY created_at').all(incident.id);

    const timeline = [
      ...detections.map((d) => ({ type: 'DETEKSI', at: d.created_at, ref: d })),
      ...alerts.map((a) => ({ type: 'WARNING/ALERT', at: a.created_at, ref: a })),
      ...sensuses.map((s) => ({ type: 'SENSUS', at: s.created_at, ref: s })),
      ...treatments.map((t) => ({ type: 'TREATMENT', at: t.created_at, ref: t })),
      ...mortalities.map((m) => ({ type: 'MORTALITAS', at: m.created_at, ref: m })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    res.json({
      data: { ...incident, detections, sensuses, treatments, mortalities, alerts, timeline },
    });
  })
);

module.exports = router;
