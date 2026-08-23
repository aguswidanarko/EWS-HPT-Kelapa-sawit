// Generic Scheduling Engine (SPEC_V2.md section 1 item 5 / section 4 Backend module list).
// Generates `schedule` rows (the same V1 table, jenis_kegiatan/hpt_id/tanggal_rencana -- no new
// schema needed for the schedule itself) from `scheduling_rule` + each blok's most recent
// inspection date for that indicator ("last_inspection"), instead of a human manually typing
// dates in one at a time.

const db = require('../db/db');

const DAY_MS = 86400000;

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Converts a scheduling_rule row into a number of days (best-effort for MONTHLY, which is
 *  treated as 30 days -- good enough for "due" scheduling, not for calendar-exact billing). */
function intervalDays(rule) {
  const n = rule.interval_value || 1;
  switch (rule.interval_type) {
    case 'DAILY':
      return n;
    case 'BIWEEKLY':
      return 14 * n;
    case 'MONTHLY':
      return 30 * n;
    case 'CUSTOM': {
      const unit = rule.interval_unit || 'DAY';
      if (unit === 'WEEK') return 7 * n;
      if (unit === 'MONTH') return 30 * n;
      return n;
    }
    default:
      return 30 * n;
  }
}

/** Finds the most recent activity date for (blok_id, hpt_id) across detection/sensus and the new
 *  V2 field tables that carry a `tanggal` + `blok_id` column, used as `last_inspection`. */
function findLastInspection(blok_id, hpt_id, hptCode) {
  const candidates = [];
  const det = db.prepare(`SELECT MAX(tanggal) t FROM detection WHERE blok_id=? AND hpt_id=?`).get(blok_id, hpt_id);
  if (det && det.t) candidates.push(det.t);
  const sens = db.prepare(`SELECT MAX(tanggal) t FROM sensus WHERE blok_id=? AND jenis_sensus=?`).get(blok_id, hptCode);
  if (sens && sens.t) candidates.push(sens.t);
  const V2_TABLES = {
    PARTENOCARPI: 'yield_partenocarpi',
    WATER_MANAGEMENT: 'water_management',
    BAHAN_ORGANIK: 'bahan_organik',
    TBM_VEGETATIF: 'tbm_vegetatif',
  };
  const table = V2_TABLES[hptCode];
  if (table) {
    const row = db.prepare(`SELECT MAX(tanggal) t FROM ${table} WHERE blok_id=?`).get(blok_id);
    if (row && row.t) candidates.push(row.t);
  }
  if (!candidates.length) return null;
  return candidates.sort().pop();
}

/**
 * Generates due `schedule` rows for one active scheduling_rule across all bloks (or a filtered
 * subset). Idempotent per (blok_id, hpt_id, tanggal_rencana): won't create a duplicate RENCANA
 * row for the same blok/indicator/day if one already exists.
 *
 * @param {object} rule a scheduling_rule row
 * @param {object} [opts]
 * @param {number[]} [opts.blok_ids] restrict to these bloks (default: all bloks)
 * @param {string} [opts.jenis_kegiatan] default 'SENSUS'
 * @returns {Array} rows created (schedule rows)
 */
function generateScheduleForRule(rule, opts = {}) {
  const hpt = db.prepare('SELECT * FROM hpt WHERE id=?').get(rule.hpt_id);
  if (!hpt) return [];
  const jenis_kegiatan = opts.jenis_kegiatan || rule.jenis_kegiatan || 'SENSUS';
  const bloks = opts.blok_ids && opts.blok_ids.length
    ? db.prepare(`SELECT * FROM blok WHERE id IN (${opts.blok_ids.map(() => '?').join(',')})`).all(...opts.blok_ids)
    : db.prepare('SELECT * FROM blok').all();

  const created = [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const days = intervalDays(rule);

  for (const blok of bloks) {
    const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(blok.afdeling_id);
    const estate_id = afdeling ? afdeling.estate_id : null;

    let tanggal_rencana;
    if (rule.based_on === 'FIXED_DATE') {
      tanggal_rencana = todayStr; // fixed-date rules are expected to be re-triggered on their own cadence externally (cron/manual)
    } else {
      const last = findLastInspection(blok.id, hpt.id, hpt.code);
      tanggal_rencana = last ? addDays(last, days) : todayStr;
    }

    // Idempotency: skip if a RENCANA row already exists for this blok+hpt+jenis_kegiatan+date.
    const exists = db
      .prepare(`SELECT id FROM schedule WHERE blok_id=? AND hpt_id=? AND jenis_kegiatan=? AND tanggal_rencana=? AND status='RENCANA'`)
      .get(blok.id, hpt.id, jenis_kegiatan, tanggal_rencana);
    if (exists) continue;

    const info = db
      .prepare(
        `INSERT INTO schedule (estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana, status)
         VALUES (?, ?, ?, ?, ?, ?, 'RENCANA')`
      )
      .run(estate_id, blok.afdeling_id, blok.id, jenis_kegiatan, hpt.id, tanggal_rencana);
    created.push(db.prepare('SELECT * FROM schedule WHERE id=?').get(info.lastInsertRowid));
  }
  return created;
}

/** Runs generateScheduleForRule for every active scheduling_rule. Used by routes/schedulingRules.js
 *  "generate now" action and can be wired to a cron/scheduled task later. */
function generateAllDueSchedules(opts = {}) {
  const rules = db.prepare('SELECT * FROM scheduling_rule WHERE active=1').all();
  const result = [];
  for (const rule of rules) {
    const created = generateScheduleForRule(rule, opts);
    result.push({ scheduling_rule_id: rule.id, hpt_id: rule.hpt_id, created_count: created.length, created });
  }
  return result;
}

/** Overdue check for a single blok+hpt against its scheduling_rule (used by dashboards / Monitoring
 *  Schedule screen to flag "due"/"overdue" without necessarily having created a schedule row yet). */
function isOverdue(blok_id, hpt_id, jenis_kegiatan = 'SENSUS') {
  const hpt = db.prepare('SELECT * FROM hpt WHERE id=?').get(hpt_id);
  if (!hpt) return null;
  const rule = db
    .prepare('SELECT * FROM scheduling_rule WHERE hpt_id=? AND jenis_kegiatan=? AND active=1 ORDER BY updated_at DESC LIMIT 1')
    .get(hpt_id, jenis_kegiatan);
  if (!rule) return null;
  const last = findLastInspection(blok_id, hpt_id, hpt.code);
  if (!last) return { overdue: true, reason: 'Belum pernah diperiksa', last_inspection: null };
  const days = intervalDays(rule);
  const dueDate = addDays(last, days);
  const overdue = new Date(dueDate).getTime() < Date.now();
  return { overdue, last_inspection: last, due_date: dueDate };
}

module.exports = { intervalDays, findLastInspection, generateScheduleForRule, generateAllDueSchedules, isOverdue };
