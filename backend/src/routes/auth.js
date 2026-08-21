// POST /api/auth/login, POST /api/auth/refresh, GET /api/auth/me
// Login response includes the full "data user yang disinkronkan" profile per BRD 01 section 9:
// role, estate, afdeling, area_kerja, hak akses (permissions).

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { asyncHandler } = require('../middleware/errorHandler');
const { requireAuth, signAccessToken, signRefreshToken, verifyRefreshToken, ACCESS_EXPIRES_IN } = require('../middleware/auth');
const { logAudit } = require('../services/audit');
const { ROLE_PERMISSIONS } = require('../services/permissions');

const router = express.Router();

function loadUserProfile(id) {
  const user = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.phone, u.area_kerja, u.estate_id, u.afdeling_id,
              r.code AS role_code, r.name AS role_name,
              e.name AS estate_name, a.name AS afdeling_name
       FROM user u
       JOIN role r ON r.id = u.role_id
       LEFT JOIN estate e ON e.id = u.estate_id
       LEFT JOIN afdeling a ON a.id = u.afdeling_id
       WHERE u.id = ?`
    )
    .get(id);
  if (!user) return null;
  return { ...user, hak_akses: ROLE_PERMISSIONS[user.role_code] || [] };
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, device_id } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email dan password wajib diisi' });

    const row = db.prepare('SELECT * FROM user WHERE email = ?').get(email.toLowerCase().trim());
    if (!row || !row.is_active) return res.status(401).json({ error: 'Email atau password salah' });

    const ok = bcrypt.compareSync(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: 'Email atau password salah' });

    const role = db.prepare('SELECT code FROM role WHERE id=?').get(row.role_id);
    const userForToken = { id: row.id, email: row.email, role_code: role.code };

    const access_token = signAccessToken(userForToken);
    const refresh_token = signRefreshToken(userForToken);

    logAudit({
      user_id: row.id,
      aktivitas: 'LOGIN',
      after: { email: row.email, device_id: device_id || null },
      device_source: req.get('X-Source') || 'API',
      ip_session: req.ip,
    });

    res.json({
      access_token,
      refresh_token,
      expires_in: ACCESS_EXPIRES_IN,
      user: loadUserProfile(row.id),
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token wajib diisi' });
    let payload;
    try {
      payload = verifyRefreshToken(refresh_token);
    } catch (e) {
      return res.status(401).json({ error: 'Refresh token tidak valid/kadaluarsa' });
    }
    if (payload.type !== 'refresh') return res.status(401).json({ error: 'Token type salah' });
    const row = db.prepare('SELECT u.*, r.code AS role_code FROM user u JOIN role r ON r.id=u.role_id WHERE u.id=?').get(payload.sub);
    if (!row || !row.is_active) return res.status(401).json({ error: 'User tidak aktif' });

    const access_token = signAccessToken({ id: row.id, email: row.email, role_code: row.role_code });
    res.json({ access_token, expires_in: ACCESS_EXPIRES_IN });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: loadUserProfile(req.user.id) });
  })
);

module.exports = router;
