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

// BRD-05/BRD-06 fix (SIT findings: raw "FOREIGN KEY constraint failed" / "UNIQUE constraint
// failed: table.col1, table.col2" messages were shown verbatim to end users across Master Data,
// Rule & Parameter Management, PIC/User, and Notification - both on save (bad/empty relation) and
// on delete (row still referenced elsewhere). better-sqlite3 does not tell us which table/column a
// FOREIGN KEY failure belongs to (SQLite itself doesn't include it), so that case gets one good
// generic message; UNIQUE and NOT NULL failures DO include "table.column" and get a more specific
// one built from it.
const FRIENDLY_FIELD_NAMES = {
  region: 'Region', bisnis_unit: 'Bisnis Unit', estate: 'PT', afdeling: 'Afdeling', blok: 'Blok',
  hpt: 'HPT', species: 'Species', threshold: 'Threshold', user: 'User', role: 'Role',
  ews_category: 'Kategori Indikator', sampling_rule: 'Sampling Rule', scheduling_rule: 'Scheduling Rule',
  notification_rule: 'Notification', pic: 'PIC', code: 'Kode', name: 'Nama', estate_id: 'PT',
  afdeling_id: 'Afdeling', region_id: 'Region', bisnis_unit_id: 'Bisnis Unit', blok_id: 'Blok',
  hpt_id: 'HPT', phone: 'Nomor Telepon', email: 'Email',
};
function friendlyField(raw) {
  return FRIENDLY_FIELD_NAMES[raw] || raw;
}

function friendlySqliteMessage(err) {
  const msg = err?.message || '';

  const uniqueMatch = msg.match(/UNIQUE constraint failed:\s*(.+)/i);
  if (uniqueMatch) {
    const cols = uniqueMatch[1].split(',').map((c) => c.trim().split('.').pop());
    const label = cols.map(friendlyField).join(' + ');
    return `Data dengan ${label} ini sudah digunakan sebelumnya. Gunakan nilai yang berbeda.`;
  }

  const notNullMatch = msg.match(/NOT NULL constraint failed:\s*(.+)/i);
  if (notNullMatch) {
    const col = notNullMatch[1].trim().split('.').pop();
    return `Kolom "${friendlyField(col)}" wajib diisi.`;
  }

  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return 'Data tidak dapat disimpan atau dihapus karena berkaitan dengan data lain: periksa apakah semua pilihan (dropdown) sudah dipilih dengan benar, atau data ini kemungkinan masih digunakan pada fitur lain sehingga tidak bisa dihapus.';
  }

  return 'Terjadi kesalahan pada database saat memproses data. Silakan coba lagi atau hubungi admin sistem.';
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Builds the standardized envelope. Exported so the handful of places that respond manually
 * (e.g. middleware/auth.js, which runs before a route's asyncHandler wrapper would apply) can
 * produce the same shape instead of a bare `{ error }`. */
function errorPayload(status, err) {
  let code = KNOWN_ERROR_CODES.has(err?.code) ? err.code : null;
  const sqlite = isSqliteError(err);
  if (!code && sqlite) {
    // More specific than a blanket DATABASE_ERROR where we can tell - matches the categories
    // mobile/dashboard already branch on (see api/client.ts getErrorCategory()).
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') code = 'DUPLICATE_ERROR';
    else if (err.code && err.code.startsWith('SQLITE_CONSTRAINT')) code = 'VALIDATION_ERROR';
    else code = 'DATABASE_ERROR';
  }
  if (!code) code = codeForStatus(status);
  // BRD-05/BRD-06: never let a raw SQLite driver message (FOREIGN KEY/UNIQUE/NOT NULL constraint
  // failed) reach the UI - translate it to friendly Indonesian text instead.
  const message = sqlite ? friendlySqliteMessage(err) : err?.message || 'Internal error';
  return { success: false, error: message, error_code: code };
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  // Unclassified errors (a genuine bug, not a route's deliberate `throw {status:400,...}`) are a
  // server fault, not a client one -- default to 500/SERVER_ERROR instead of the previous
  // (incorrect) implicit 400 default. Exception (BRD-05/BRD-06): a SQLite CONSTRAINT violation
  // (FOREIGN KEY/UNIQUE/NOT NULL) is caused by the request's own data, not a server fault, so it's
  // reported as 400 like any other validation error rather than a misleading 500.
  const isConstraintError = typeof err?.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT');
  const status = err.status || err.statusCode || (isConstraintError ? 400 : 500);
  res.status(status).json(errorPayload(status, err));
}

module.exports = { asyncHandler, errorHandler, errorPayload, codeForStatus, KNOWN_ERROR_CODES };
