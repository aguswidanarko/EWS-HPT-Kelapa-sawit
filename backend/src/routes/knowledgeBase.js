// Knowledge Base: admin/RND_FOD upload (PDF/DOC/DOCX/XLS/XLSX/image), categorize, version,
// publish (status_aktif), everyone can read/download (incl. offline sync on mobile).

const express = require('express');
const path = require('path');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadKnowledgeBase, KB_DIR } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.hpt_id) {
      clauses.push('hpt_id = @hpt_id');
      params.hpt_id = req.query.hpt_id;
    }
    if (req.query.kategori) {
      clauses.push('kategori = @kategori');
      params.kategori = req.query.kategori;
    }
    if (req.query.status_aktif !== undefined) {
      clauses.push('status_aktif = @status_aktif');
      params.status_aktif = req.query.status_aktif;
    }
    let sql = 'SELECT * FROM knowledge_base';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY updated_at DESC';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

// Download the underlying file (works offline once mobile has synced it locally too).
router.get(
  '/:id/file',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    if (!row || !row.file_path) return res.status(404).json({ error: 'File not found' });
    res.sendFile(path.resolve(row.file_path));
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'RND_FOD'),
  uploadKnowledgeBase.single('file'),
  asyncHandler(async (req, res) => {
    const { hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif } = req.body;
    if (!judul) return res.status(400).json({ error: 'judul wajib diisi' });
    const file_path = req.file ? path.relative(process.cwd(), req.file.path) : null;
    const file_type = req.file ? req.file.mimetype : null;
    const info = db
      .prepare(
        `INSERT INTO knowledge_base (hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif, file_path, file_type, uploaded_by)
         VALUES (@hpt_id, @kategori, @judul, @versi, @tanggal_berlaku, @status_aktif, @file_path, @file_type, @uploaded_by)`
      )
      .run({
        hpt_id: hpt_id || null,
        kategori: kategori || null,
        judul,
        versi: versi || '1.0',
        tanggal_berlaku: tanggal_berlaku || null,
        status_aktif: status_aktif === undefined ? 1 : Number(status_aktif),
        file_path,
        file_type,
        uploaded_by: req.user.id,
      });
    const row = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_KNOWLEDGE_BASE', after: row });
    res.status(201).json({ data: row });
  })
);

// New version of an existing KB entry: keeps the old row (status_aktif can be flipped off) and
// inserts a new row referencing the same judul/hpt with an incremented versi.
router.post(
  '/:id/new-version',
  requireRole('ADMIN', 'RND_FOD'),
  uploadKnowledgeBase.single('file'),
  asyncHandler(async (req, res) => {
    const prev = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Not found' });
    const file_path = req.file ? path.relative(process.cwd(), req.file.path) : prev.file_path;
    const file_type = req.file ? req.file.mimetype : prev.file_type;
    db.prepare('UPDATE knowledge_base SET status_aktif = 0 WHERE id = ?').run(prev.id);
    const info = db
      .prepare(
        `INSERT INTO knowledge_base (hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif, file_path, file_type, uploaded_by)
         VALUES (@hpt_id, @kategori, @judul, @versi, @tanggal_berlaku, 1, @file_path, @file_type, @uploaded_by)`
      )
      .run({
        hpt_id: prev.hpt_id,
        kategori: prev.kategori,
        judul: prev.judul,
        versi: req.body.versi || `${(parseFloat(prev.versi) || 1) + 0.1}`.slice(0, 4),
        tanggal_berlaku: req.body.tanggal_berlaku || prev.tanggal_berlaku,
        file_path,
        file_type,
        uploaded_by: req.user.id,
      });
    const row = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'NEW_VERSION_KNOWLEDGE_BASE', before: prev, after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['hpt_id', 'kategori', 'judul', 'versi', 'tanggal_berlaku', 'status_aktif'].filter(
      (f) => req.body[f] !== undefined
    );
    if (fields.length) {
      const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
      db.prepare(`UPDATE knowledge_base SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({
        ...req.body,
        id: req.params.id,
      });
    }
    const after = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_KNOWLEDGE_BASE', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM knowledge_base WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_KNOWLEDGE_BASE', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

module.exports = router;
