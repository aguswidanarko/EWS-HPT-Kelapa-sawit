// Photo upload (mobile camera + dashboard). Stores file to uploads/photos, references path in
// PHOTO table with entity/GPS/timestamp metadata (SPEC.md section 3 PHOTO, section 6 "Foto").

const express = require('express');
const path = require('path');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadPhoto } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/',
  uploadPhoto.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload (field name: file)' });
    const { entity_type, entity_id, gps_lat, gps_lng, timestamp } = req.body;
    if (!entity_type) return res.status(400).json({ error: 'entity_type wajib diisi (DETECTION/SENSUS/TREATMENT/MORTALITY)' });
    const file_path = path.relative(process.cwd(), req.file.path);
    const info = db
      .prepare(
        `INSERT INTO photo (entity_type, entity_id, file_path, gps_lat, gps_lng, timestamp, user_id, compressed_size)
         VALUES (@entity_type, @entity_id, @file_path, @gps_lat, @gps_lng, @timestamp, @user_id, @compressed_size)`
      )
      .run({
        entity_type,
        entity_id: entity_id || null,
        file_path,
        gps_lat: gps_lat ?? null,
        gps_lng: gps_lng ?? null,
        timestamp: timestamp || new Date().toISOString(),
        user_id: req.user.id,
        compressed_size: req.file.size,
      });
    const row = db.prepare('SELECT * FROM photo WHERE id=?').get(info.lastInsertRowid);

    // Backfill foto_id on the referenced record if it already exists.
    if (entity_id && ['DETECTION', 'SENSUS', 'TREATMENT', 'MORTALITY'].includes(entity_type)) {
      const table = entity_type.toLowerCase();
      try {
        db.prepare(`UPDATE ${table} SET foto_id=? WHERE id=?`).run(row.id, entity_id);
      } catch (e) {
        /* ignore if table/id mismatch */
      }
    }

    auditFromReq(req, { aktivitas: 'UPLOAD_PHOTO', after: row });
    res.status(201).json({ data: row, url: `/uploads/photos/${path.basename(req.file.path)}` });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.entity_type) { clauses.push('entity_type=@entity_type'); params.entity_type = req.query.entity_type; }
    if (req.query.entity_id) { clauses.push('entity_id=@entity_id'); params.entity_id = req.query.entity_id; }
    let sql = 'SELECT * FROM photo';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

module.exports = router;
