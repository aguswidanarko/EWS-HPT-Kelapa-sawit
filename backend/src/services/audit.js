// Central audit log writer (SPEC.md section 3 AUDIT_LOG, section 7 "Audit Trail").
// Call this from any route/service that performs a write. Kept synchronous (better-sqlite3 is
// sync) so it always runs in the same transaction context as the write it is auditing.

const db = require('../db/db');

const insertStmt = db.prepare(`
  INSERT INTO audit_log (user_id, aktivitas, waktu, data_sebelum_json, data_sesudah_json, device_source, ip_session)
  VALUES (@user_id, @aktivitas, datetime('now'), @data_sebelum_json, @data_sesudah_json, @device_source, @ip_session)
`);

/**
 * @param {object} opts
 * @param {number|null} opts.user_id
 * @param {string} opts.aktivitas short action code, e.g. CREATE_DETECTION, ALERT_STATUS_CHANGE
 * @param {any} [opts.before]
 * @param {any} [opts.after]
 * @param {string} [opts.device_source] MOBILE/EXCEL/WEB/API
 * @param {string} [opts.ip_session]
 */
function logAudit({ user_id = null, aktivitas, before = null, after = null, device_source = 'API', ip_session = null }) {
  insertStmt.run({
    user_id,
    aktivitas,
    data_sebelum_json: before === null ? null : JSON.stringify(before),
    data_sesudah_json: after === null ? null : JSON.stringify(after),
    device_source,
    ip_session,
  });
}

/** Express helper: derive device_source/ip_session from a request. */
function auditFromReq(req, { aktivitas, before = null, after = null }) {
  logAudit({
    user_id: req.user ? req.user.id : null,
    aktivitas,
    before,
    after,
    device_source: req.get('X-Source') || req.body?.source || 'WEB',
    ip_session: `${req.ip}${req.user ? ' session:' + req.user.id : ''}`,
  });
}

module.exports = { logAudit, auditFromReq };
