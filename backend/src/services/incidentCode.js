// Generates incident_code in the form EWS-YYYYMMDD-XXXX, sequential per day (SPEC.md section 3/4).

function todayCompact(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {Date} [date]
 * @returns {string} e.g. EWS-20260821-0001
 */
function generateIncidentCode(db, date = new Date()) {
  const ymd = todayCompact(date);
  const prefix = `EWS-${ymd}-`;
  const row = db
    .prepare(
      `SELECT incident_code FROM incident WHERE incident_code LIKE ? ORDER BY incident_code DESC LIMIT 1`
    )
    .get(`${prefix}%`);
  let seq = 1;
  if (row) {
    const lastSeq = parseInt(row.incident_code.slice(prefix.length), 10);
    if (!Number.isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

module.exports = { generateIncidentCode, todayCompact };
