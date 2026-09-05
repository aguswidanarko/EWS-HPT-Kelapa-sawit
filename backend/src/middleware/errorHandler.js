// Centralized error handler + async route wrapper so routes can `throw` / reject freely.
//
// BRD EWS HPT V3.2.1 section 19 (API Error Standardization): every error response should carry a
// machine-readable category so Mobile can tell "no network" apart from "bad input" apart from
// "server broke" (section 20 relies on this to show the right Indonesian message). We add that
// category as new fields (`success`, `error_code`) alongside the EXISTING `error` string field
// rather than replacing `error` with a `{code,message}` object as the BRD's example JSON shows
// literally -- the dashboard and mobile app both already read `response.data.error` as a plain
// string in ~30 call sites, and swapping it for an object there would be a much larger, riskier
// change than this stabilization release calls for (BRD section 34 non-goals: no incidental
// redesign). This additive shape keeps every existing call site working unchanged while giving
// new/updated call sites (see routes/sync.js, mobile api/client.ts) the category to branch on.
// A follow-up release can migrate callers to `error_code` and drop the string duplication.

const KNOWN_ERROR_CODES = new Set([
  'AUTH_ERROR',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'DUPLICATE_ERROR',
  'SERVER_ERROR',
  'DATABASE_ERROR',
  // NETWORK_ERROR is a client-side classification (no response was received at all) -- see
  // mobile/src/api/client.ts isNetworkError()/getErrorCategory(). The backend never emits it.
]);

const CODE_BY_STATUS = {
  400: 'VALIDATION_ERROR',
  401: 'AUTH_ERROR',
  403: 'AUTH_ERROR',
  404: 'NOT_FOUND',
  409: 'DUPLICATE_ERROR',
};

function codeForStatus(status) {
  if (CODE_BY_STATUS[status]) return CODE_BY_STATUS[status];
  return status >= 500 ? 'SERVER_ERROR' : 'VALIDATION_ERROR';
}

function isSqliteError(err) {
  return typeof err?.code === 'string' && err.code.startsWith('SQLITE_');
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Builds the standardized envelope. Exported so the handful of places that respond manually
 * (e.g. middleware/auth.js, which runs before a route's asyncHandler wrapper would apply) can
 * produce the same shape instead of a bare `{ error }`. */
function errorPayload(status, err) {
  let code = KNOWN_ERROR_CODES.has(err?.code) ? err.code : null;
  if (!code) code = isSqliteError(err) ? 'DATABASE_ERROR' : codeForStatus(status);
  const message = err?.message || 'Internal error';
  return { success: false, error: message, error_code: code };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  // Unclassified errors (a genuine bug, not a route's deliberate `throw {status:400,...}`) are a
  // server fault, not a client one -- default to 500/SERVER_ERROR instead of the previous
  // (incorrect) implicit 400 default.
  const status = err.status || err.statusCode || 500;
  res.status(status).json(errorPayload(status, err));
}

module.exports = { asyncHandler, errorHandler, errorPayload, codeForStatus, KNOWN_ERROR_CODES };
