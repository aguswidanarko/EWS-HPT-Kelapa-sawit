// Leaf (foliar) Analysis (SPEC_V2.md section 2: leaf_analysis -- "input_by_role selalu 'RISET'
// secara bisnis"). This is the R&D/Riset lab-side record; field findings against it are captured
// separately in routes/defisiensiHara.js (defisiensi_hara_temuan).

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const WRITE_ROLES = ['ADMIN', 'RISET', 'RND_FOD'];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['blok_id', 'unsur_hara', 'severity', 'status']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM leaf_analysis';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY tanggal DESC, created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM leaf_analysis WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const temuan = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE leaf_analysis_id=? ORDER BY tanggal DESC').all(row.id);
    res.json({ data: { ...row, temuan } });
  })
);

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { blok_id, tanggal, unsur_hara, hasil, severity, catatan } = req.body;
    if (!tanggal || !unsur_hara) return res.status(400).json({ error: 'tanggal, unsur_hara wajib diisi' });
    const info = db
      .prepare(
        `INSERT INTO leaf_analysis (blok_id, tanggal, unsur_hara, hasil, severity, status, input_by_role, user_id, catatan)
         VALUES (@blok_id, @tanggal, @unsur_hara, @hasil, @severity, 'OPEN', 'RISET', @user_id, @catatan)`
      )
      .run({
        blok_id: blok_id || null,
        tanggal,
        unsur_hara,
        hasil: hasil ?? null,
        severity: severity || null,
        user_id: req.user.id,
        catatan: catatan || null,
      });
    const row = db.prepare('SELECT * FROM leaf_analysis WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_LEAF_ANALYSIS', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM leaf_analysis WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['blok_id', 'tanggal', 'unsur_hara', 'hasil', 'severity', 'status', 'catatan'].filter((f) => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE leaf_analysis SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id: req.params.id });
    const after = db.prepare('SELECT * FROM leaf_analysis WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_LEAF_ANALYSIS', before, after });
    res.json({ data: after });
  })
);

module.exports = router;
