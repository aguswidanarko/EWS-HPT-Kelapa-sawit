// BRD EWS HPT V3.2.1 section 19 (API Error Standardization).
//
// Most routes respond to a client-side problem with a direct `res.status(4xx).json({ error: '...'
// })` rather than throwing (throwing would go through errorHandler.js instead -- see that file's
// header comment for the exact same standardization done there). There are 150+ such call sites
// across backend/src/routes; rewriting each individually is a much bigger, riskier change than
// this stabilization release calls for. Instead, this middleware wraps res.json() once, so any
// response already shaped like `{ error: 'message' }` on a 4xx/5xx status gets the same `success`
// and `error_code` fields added on the way out -- the existing `error` string is left untouched
// (every current dashboard/mobile call site still reads it exactly as before).
const { codeForStatus, KNOWN_ERROR_CODES } = require('./errorHandler');

function normalizeErrorResponses(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === 'object' &&
      !Array.isArray(body) &&
      typeof body.error === 'string' &&
      body.success === undefined
    ) {
      const code = KNOWN_ERROR_CODES.has(body.error_code) ? body.error_code : codeForStatus(res.statusCode);
      return originalJson({ success: false, error_code: code, ...body });
    }
    return originalJson(body);
  };
  next();
}

module.exports = { normalizeErrorResponses };
