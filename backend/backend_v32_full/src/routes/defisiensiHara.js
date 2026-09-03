// Defisiensi Hara field findings (SPEC_V2.md section 2: defisiensi_hara_temuan). Mandor/Petugas
// records what they observe in the field against a blok that Riset flagged via leaf_analysis;
// same sync envelope as detection/sensus (local_id/server_id/device_id/user_id/sync_status/...).

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');
const { checkContainmentByBlokId } = require('../services/gisContainment');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['blok_id', 'leaf_analysis_id', 'unsur_hara', 'severity', 'status']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM defisiensi_hara_temuan';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY tanggal DESC, created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'PETUGAS_DETEKSI', 'PETUGAS_SENSUS', 'ASKEP_ASISTEN', 'RND_FOD', 'PETUGAS_LAPANGAN'),
  asyncHandler(async (req, res) => {
    const { blok_id, tanggal, unsur_hara, temuan_lapangan, severity, leaf_analysis_id } = req.body;
    if (!blok_id || !tanggal) return res.status(400).json({ error: 'blok_id, tanggal wajib diisi' });
    const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(blok_id);
    if (!blok) return res.status(400).json({ error: 'Blok tidak ditemukan' });
    const afdeling_id = req.body.afdeling_id || blok.afdeling_id;
    const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
    const estate_id = req.body.estate_id || (afdeling ? afdeling.estate_id : null);
    const location_warning = checkContainmentByBlokId(blok_id, req.body.gps_lat, req.body.gps_lng);

    const server_id = req.body.server_id || uuidv4();
    const info = db
      .prepare(
        `INSERT INTO defisiensi_hara_temuan (
          local_id, server_id, leaf_analysis_id, incident_id, user_id, device_id,
          estate_id, afdeling_id, blok_id, tanggal, unsur_hara, temuan_lapangan, severity, status,
          evidence_photo_id, gps_lat, gps_lng, gps_accuracy, location_warning, catatan,
          sync_status, sync_attempt, sync_error, source
        ) VALUES (
          @local_id, @server_id, @leaf_analysis_id, @incident_id, @user_id, @device_id,
          @estate_id, @afdeling_id, @blok_id, @tanggal, @unsur_hara, @temuan_lapangan, @severity, 'OPEN',
          @evidence_photo_id, @gps_lat, @gps_lng, @gps_accuracy, @location_warning, @catatan,
          @sync_status, @sync_attempt, @sync_error, @source
        )`
      )
      .run({
        local_id: req.body.local_id || null,
        server_id,
        leaf_analysis_id: leaf_analysis_id || null,
        incident_id: req.body.incident_id || null,
        user_id: req.user.id,
        device_id: req.body.device_id || null,
        estate_id,
        afdeling_id,
        blok_id,
        tanggal,
        unsur_hara: unsur_hara || null,
        temuan_lapangan: temuan_lapangan || null,
        severity: severity || null,
        evidence_photo_id: req.body.evidence_photo_id || null,
        gps_lat: req.body.gps_lat ?? null,
        gps_lng: req.body.gps_lng ?? null,
        gps_accuracy: req.body.gps_accuracy ?? null,
        location_warning: location_warning ? 1 : 0,
        catatan: req.body.catatan || null,
        sync_status: req.body.sync_status || 'SYNCED',
        sync_attempt: req.body.sync_attempt || 0,
        sync_error: req.body.sync_error || null,
        source: req.body.source || 'WEB',
      });
    const row = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_DEFISIENSI_HARA_TEMUAN', after: row });
    res.status(201).json({ data: row, location_warning: !!location_warning });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['status', 'severity', 'action_plan_id', 'catatan'].filter((f) => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE defisiensi_hara_temuan SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id: req.params.id });
    const after = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_DEFISIENSI_HARA_TEMUAN', before, after });
    res.json({ data: after });
  })
);

module.exports = router;
