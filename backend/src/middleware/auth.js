// JWT auth + RBAC middleware.

const jwt = require('jsonwebtoken');
const db = require('../db/db');

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ews-hpt-dev-access-secret-change-in-prod';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ews-hpt-dev-refresh-secret-change-in-prod';
const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role_code, type: 'access' },
    ACCESS_SECRET,
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id, type: 'refresh' }, REFRESH_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

function verifyRefreshToken(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

/** Requires a valid access token; attaches req.user = { id, email, role_code, ...profile }. */
function requireAuth(req, res, next) {
  const header = req.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing bearer token' });
  let payload;
  try {
    payload = jwt.verify(token, ACCESS_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token', detail: e.message });
  }
  if (payload.type !== 'access') return res.status(401).json({ error: 'Wrong token type' });

  const user = db
    .prepare(
      `SELECT u.id, u.name, u.email, u.estate_id, u.afdeling_id, u.area_kerja, u.is_active,
              r.code AS role_code, r.name AS role_name
       FROM user u JOIN role r ON r.id = u.role_id WHERE u.id = ?`
    )
    .get(payload.sub);
  if (!user || !user.is_active) return res.status(401).json({ error: 'User not found or inactive' });
  req.user = user;
  next();
}

/** Restricts a route to a set of role codes. ADMIN always allowed. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
    if (req.user.role_code === 'ADMIN' || roles.includes(req.user.role_code)) return next();
    return res.status(403).json({ error: `Forbidden: requires role in [${roles.join(', ')}]` });
  };
}

module.exports = {
  requireAuth,
  requireRole,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  ACCESS_EXPIRES_IN,
};
