// PIC / User / Role Management (BRD 02 section 39). ADMIN-only writes.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

function userRow(id) {
  return db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.area_kerja, u.estate_id, u.afdeling_id, u.is_active,
              u.created_at, u.updated_at, r.code AS role_code, r.name AS role_name
       FROM user u JOIN role r ON r.id=u.role_id WHERE u.id=?`
    )
    .get(id);
}

router.get(
  '/roles',
  asyncHandler(async (req, res) => res.json({ data: db.prepare('SELECT * FROM role ORDER BY id').all() }))
);

router.get(
  '/',
  requireRole('ADMIN', 'RND_FOD', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.role_code) {
      clauses.push('r.code = @role_code');
      params.role_code = req.query.role_code;
    }
    if (req.query.estate_id) {
      clauses.push('u.estate_id = @estate_id');
      params.estate_id = req.query.estate_id;
    }
    let sql = `SELECT u.id, u.name, u.email, u.phone, u.area_kerja, u.estate_id, u.afdeling_id, u.is_active,
                      r.code AS role_code, r.name AS role_name
               FROM user u JOIN role r ON r.id=u.role_id`;
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY u.id';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.post(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { name, email, password, role_code, estate_id, afdeling_id, area_kerja, phone } = req.body;
    if (!name || !email || !password || !role_code) {
      return res.status(400).json({ error: 'name, email, password, role_code wajib diisi' });
    }
    const role = db.prepare('SELECT id FROM role WHERE code=?').get(role_code);
    if (!role) return res.status(400).json({ error: `role_code tidak dikenal: ${role_code}` });
    const password_hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO user (name, email, phone, password_hash, role_id, estate_id, afdeling_id, area_kerja)
         VALUES (@name, @email, @phone, @password_hash, @role_id, @estate_id, @afdeling_id, @area_kerja)`
      )
      .run({
        name,
        email: email.toLowerCase().trim(),
        phone: phone || null,
        password_hash,
        role_id: role.id,
        estate_id: estate_id || null,
        afdeling_id: afdeling_id || null,
        area_kerja: area_kerja || null,
      });
    const row = userRow(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_USER', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const before = userRow(req.params.id);
    if (!before) return res.status(404).json({ error: 'User not found' });
    const { name, phone, estate_id, afdeling_id, area_kerja, is_active, role_code, password } = req.body;
    const params = { id: req.params.id };
    const sets = [];
    if (name !== undefined) { sets.push('name=@name'); params.name = name; }
    if (phone !== undefined) { sets.push('phone=@phone'); params.phone = phone; }
    if (estate_id !== undefined) { sets.push('estate_id=@estate_id'); params.estate_id = estate_id; }
    if (afdeling_id !== undefined) { sets.push('afdeling_id=@afdeling_id'); params.afdeling_id = afdeling_id; }
    if (area_kerja !== undefined) { sets.push('area_kerja=@area_kerja'); params.area_kerja = area_kerja; }
    if (is_active !== undefined) { sets.push('is_active=@is_active'); params.is_active = Number(is_active); }
    if (role_code !== undefined) {
      const role = db.prepare('SELECT id FROM role WHERE code=?').get(role_code);
      if (!role) return res.status(400).json({ error: 'role_code tidak dikenal' });
      sets.push('role_id=@role_id');
      params.role_id = role.id;
    }
    if (password) {
      sets.push('password_hash=@password_hash');
      params.password_hash = bcrypt.hashSync(password, 10);
    }
    if (sets.length) {
      db.prepare(`UPDATE user SET ${sets.join(', ')}, updated_at=datetime('now') WHERE id=@id`).run(params);
    }
    const after = userRow(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_USER', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const before = userRow(req.params.id);
    if (!before) return res.status(404).json({ error: 'User not found' });
    db.prepare('UPDATE user SET is_active=0 WHERE id=?').run(req.params.id); // soft delete, preserves FK history
    auditFromReq(req, { aktivitas: 'DEACTIVATE_USER', before });
    res.json({ data: { id: Number(req.params.id), deactivated: true } });
  })
);

// -------------------------------------------------------------- PIC assignments
router.get(
  '/pic',
  asyncHandler(async (req, res) => {
    res.json({
      data: db
        .prepare(
          `SELECT p.*, u.name AS user_name, u.email AS user_email FROM pic p JOIN user u ON u.id=p.user_id ORDER BY p.id`
        )
        .all(),
    });
  })
);

router.post(
  '/pic',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { user_id, estate_id, afdeling_id, blok_id, jenis_aktivitas, hpt_id, notification_channel } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id wajib diisi' });
    const info = db
      .prepare(
        `INSERT INTO pic (user_id, estate_id, afdeling_id, blok_id, jenis_aktivitas, hpt_id, notification_channel)
         VALUES (@user_id, @estate_id, @afdeling_id, @blok_id, @jenis_aktivitas, @hpt_id, @notification_channel)`
      )
      .run({
        user_id,
        estate_id: estate_id || null,
        afdeling_id: afdeling_id || null,
        blok_id: blok_id || null,
        jenis_aktivitas: jenis_aktivitas || 'ALL',
        hpt_id: hpt_id || null,
        notification_channel: notification_channel || 'DASHBOARD',
      });
    const row = db.prepare('SELECT * FROM pic WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_PIC', after: row });
    res.status(201).json({ data: row });
  })
);

router.delete(
  '/pic/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM pic WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM pic WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_PIC', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

module.exports = router;
