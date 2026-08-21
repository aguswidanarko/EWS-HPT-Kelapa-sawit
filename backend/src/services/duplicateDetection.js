// Duplicate detection (BRD 02 section 43 / SPEC.md section 7).
// Flags likely-duplicate submissions by (estate+afdeling+blok+tanggal+hpt+petugas+activity_type).

const db = require('../db/db');

const TABLES = {
  DETECTION: 'detection',
  SENSUS: 'sensus',
  TREATMENT: 'treatment',
};

/**
 * @param {'DETECTION'|'SENSUS'|'TREATMENT'} activityType
 * @param {object} rec must contain estate_id, afdeling_id, blok_id, tanggal, hpt_id (or jenis_sensus), user_id
 * @param {number} [excludeId] id to exclude (when checking on update)
 * @returns {boolean}
 */
function isLikelyDuplicate(activityType, rec, excludeId = null) {
  const table = TABLES[activityType];
  if (!table) return false;
  const hptField = activityType === 'SENSUS' ? 'jenis_sensus' : 'hpt_id';
  const hptValue = activityType === 'SENSUS' ? rec.jenis_sensus : rec.hpt_id;
  if (!rec.blok_id || !rec.tanggal || !hptValue || !rec.user_id) return false;

  let sql = `SELECT COUNT(*) AS c FROM ${table}
    WHERE estate_id = @estate_id AND afdeling_id = @afdeling_id AND blok_id = @blok_id
      AND tanggal = @tanggal AND ${hptField} = @hptValue AND user_id = @user_id`;
  if (excludeId) sql += ' AND id != @excludeId';

  const row = db.prepare(sql).get({
    estate_id: rec.estate_id,
    afdeling_id: rec.afdeling_id,
    blok_id: rec.blok_id,
    tanggal: rec.tanggal,
    hptValue,
    user_id: rec.user_id,
    excludeId,
  });
  return row.c > 0;
}

module.exports = { isLikelyDuplicate };
