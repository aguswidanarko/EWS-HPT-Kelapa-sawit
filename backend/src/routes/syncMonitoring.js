// Monitoring Synchronization (SPEC.md section 7): last sync per mobile user/device, counts.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();
router.use(requireAuth);

router.get(
  '/',
  requireRole('ADMIN', 'RND_FOD', 'MANAGER', 'ASKEP_ASISTEN'),
  asyncHandler(async (req, res) => {
    const rows = db
      .prepare(
        `SELECT sl.user_id, u.name AS user_name, sl.device_id, MAX(sl.started_at) AS last_sync_started,
                (SELECT finished_at FROM sync_log s2 WHERE s2.user_id=sl.user_id AND s2.device_id=sl.device_id ORDER BY started_at DESC LIMIT 1) AS last_sync_finished,
                (SELECT status FROM sync_log s3 WHERE s3.user_id=sl.user_id AND s3.device_id=sl.device_id ORDER BY started_at DESC LIMIT 1) AS last_status,
                SUM(sl.jumlah_data) AS total_jumlah_data, SUM(sl.success_count) AS total_success, SUM(sl.failed_count) AS total_failed
         FROM sync_log sl JOIN user u ON u.id = sl.user_id
         GROUP BY sl.user_id, sl.device_id
         ORDER BY last_sync_started DESC`
      )
      .all();
    res.json({ data: rows });
  })
);

router.get(
  '/logs',
  requireRole('ADMIN', 'RND_FOD', 'MANAGER', 'ASKEP_ASISTEN'),
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.user_id) { clauses.push('user_id=@user_id'); params.user_id = req.query.user_id; }
    if (req.query.device_id) { clauses.push('device_id=@device_id'); params.device_id = req.query.device_id; }
    let sql = 'SELECT * FROM sync_log';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY started_at DESC LIMIT 200';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

module.exports = router;
