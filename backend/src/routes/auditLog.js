// Audit log listing with filters (SPEC.md section 7 "Audit Trail").

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  requireRole('ADMIN', 'RND_FOD', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.user_id) { clauses.push('user_id=@user_id'); params.user_id = req.query.user_id; }
    if (req.query.aktivitas) { clauses.push('aktivitas LIKE @aktivitas'); params.aktivitas = `%${req.query.aktivitas}%`; }
    if (req.query.device_source) { clauses.push('device_source=@device_source'); params.device_source = req.query.device_source; }
    if (req.query.from) { clauses.push('waktu >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('waktu <= @to'); params.to = req.query.to; }
    let sql = 'SELECT * FROM audit_log';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY waktu DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

module.exports = router;
