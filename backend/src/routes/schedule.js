// Jadwal (Schedule) CRUD. No approval workflow (SPEC.md principle #6) — status is purely
// operational: RENCANA/BERJALAN/SELESAI/DIBATALKAN.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['user_id', 'estate_id', 'afdeling_id', 'blok_id', 'status']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    if (req.query.since) {
      clauses.push('tanggal_rencana >= @since');
      params.since = req.query.since;
    }
    let sql = 'SELECT * FROM schedule';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY tanggal_rencana';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.post(
  '/',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { user_id, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana } = req.body;
    const info = db
      .prepare(
        `INSERT INTO schedule (user_id, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana, status)
         VALUES (@user_id, @estate_id, @afdeling_id, @blok_id, @jenis_kegiatan, @hpt_id, @tanggal_rencana, 'RENCANA')`
      )
      .run({ user_id: user_id || null, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id: hpt_id || null, tanggal_rencana });
    const row = db.prepare('SELECT * FROM schedule WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_SCHEDULE', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['user_id', 'estate_id', 'afdeling_id', 'blok_id', 'jenis_kegiatan', 'hpt_id', 'tanggal_rencana', 'status'].filter(
      (f) => req.body[f] !== undefined
    );
    if (fields.length) {
      const setSql = fields.map((f) => `${f}=@${f}`).join(', ');
      db.prepare(`UPDATE schedule SET ${setSql}, updated_at=datetime('now') WHERE id=@id`).run({ ...req.body, id: req.params.id });
    }
    const after = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_SCHEDULE', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id',
  requireRole('ADMIN', 'ASKEP_ASISTEN', 'MANAGER', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM schedule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM schedule WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_SCHEDULE', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

module.exports = router;
