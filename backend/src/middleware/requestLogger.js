// BRD EWS HPT V3.2.1 section 22 (Logging Backend): logs timestamp, method, path, status,
// response_time, client IP, user ID, and (when a route sets it) the affected record ID, for every
// request -- so a sync failure reported by Mobile/Dashboard can be cross-referenced against what
// the server actually saw. Deliberately a single console.log line (structured, greppable) rather
// than pulling in a logging dependency -- this is a stabilization release, not an infra change.
//
// A route that creates/updates a specific record can set `res.locals.record_id` before responding
// (optional -- most routes don't need to) so it shows up in the log line; see routes/sync.js
// upload handlers for an example.

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const entry = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      response_time_ms: Math.round(durationMs * 100) / 100,
      client_ip: req.ip,
      user_id: req.user ? req.user.id : null,
      record_id: res.locals.record_id ?? null,
    };
    // eslint-disable-next-line no-console
    console.log(`[req] ${JSON.stringify(entry)}`);
  });
  next();
}

module.exports = { requestLogger };
