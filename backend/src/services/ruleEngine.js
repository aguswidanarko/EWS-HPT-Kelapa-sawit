// Generic Rule Engine (SPEC_V2.md section 3). Replaces the V1 hard-coded "5 formula" arithmetic
// (which used to live entirely as JS functions in services/sensusEngines.js) with data driven by
// the `formula` table, while keeping thresholdEngine.js's classification/incident/alert pipeline
// (already table-driven in V1, nothing to refactor there) untouched.
//
// Contract (SPEC_V2.md section 3):
//   computeIndicatorResult(hpt_code, input_payload, blok)
//     -> { hasil, kategori, threshold_ref, rule_version_id, rekomendasi, next_action, alert_required }
//
// Design notes / judgment calls (see final report to user for the full list):
//   - `formula` rows can be looked up by (hpt_id, context) since SPEC_V2.md section 5's own
//     ambiguity note says one hpt_id can carry >1 formula (e.g. UPDKS/Tikus/Oryctes each has a
//     "screening %" formula for early detection AND a "per-pelepah/pokok census" formula for
//     sensus results). `context` defaults to 'SENSUS' to match the pre-existing sensusEngines.js
//     call sites (ingestion.js only ever computed the sensus-formula number).
//   - Every formula_type evaluator below is a PURE function of (expression_json, payload) except
//     RAINFALL_ACCUMULATION, which is allowed an optional `db`+`blok_id` to accumulate a rolling
//     window from already-stored yield_making rows when the payload itself doesn't carry the
//     whole window.
//   - This module intentionally does NOT duplicate the classify()/findOrCreateIncident()/
//     createAlert()/dispatchNotifications() steps -- those remain in thresholdEngine.js exactly
//     as in V1 (already generic / table-driven, not hard-coded), and computeIndicatorResult()
//     below simply calls runThresholdEngine() after computing `hasil` via the formula table.

const db = require('../db/db');
const { runThresholdEngine, getActiveThresholds, classify, todayISO } = require('./thresholdEngine');

// ---------------------------------------------------------------------------------------------
// Formula evaluators, one per formula_type (SPEC_V2.md section 3 enumeration).
// Each returns { hasil_hitung, satuan, forced_kandidat_pengendalian?, meta? }.
// ---------------------------------------------------------------------------------------------

function numField(payload, field) {
  const v = payload ? payload[field] : undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumFields(payload, fields) {
  return (fields || []).reduce((acc, f) => acc + numField(payload, f), 0);
}

/** COUNT_TOTAL: sum of one or more fields, no division. e.g. total_bunch + abnormal_bunch counts. */
function evalCountTotal(expr, payload) {
  const hasil_hitung = sumFields(payload, expr.fields || []);
  return { hasil_hitung, satuan: expr.unit || null };
}

/**
 * PERCENTAGE: numerator(s) / denominator * multiply. Generalizes all three V1 ratio formulas
 * (UPDKS ekor/pelepah, Tikus %, Oryctes %) plus new Yield Making percentage indicators
 * (abnormal_bunch_pct, yellowing_pct). `numerator_fields` is summed (supports Tikus's
 * serangan_baru+serangan_lama). `zero_denominator_fallback: 'BINARY_100_OR_0'` reproduces Rayap's
 * "ambang ekonomi 0%" edge case: when the denominator is 0/absent, result is `multiply` if the
 * numerator is >0, else 0 (matches services/sensusEngines.js's original computeRayap exactly).
 */
function evalPercentage(expr, payload) {
  const numerator = expr.numerator_fields
    ? sumFields(payload, expr.numerator_fields)
    : numField(payload, expr.numerator_field);
  const denominator = numField(payload, expr.denominator_field);
  const multiply = expr.multiply === undefined ? 1 : expr.multiply;

  let hasil_hitung;
  if (denominator > 0) {
    hasil_hitung = (numerator / denominator) * multiply;
  } else if (expr.zero_denominator_fallback === 'BINARY_100_OR_0') {
    hasil_hitung = numerator > 0 ? multiply : 0;
  } else if (expr.require_denominator_gt_zero) {
    throw new Error(`${expr.denominator_field || 'denominator'} harus > 0`);
  } else {
    hasil_hitung = 0;
  }

  const out = { hasil_hitung, satuan: expr.unit || null };
  if (expr.forced_when_numerator_gt_zero) out.forced_kandidat_pengendalian = numerator > 0;
  return out;
}

/** THRESHOLD: a single field is passed straight through for direct comparison against the
 *  `threshold` table (no arithmetic) -- e.g. water_level_cm, panjang_pelepah_cm. */
function evalThreshold(expr, payload) {
  const hasil_hitung = numField(payload, expr.field);
  return { hasil_hitung, satuan: expr.unit || null };
}

/** DURATION: either a duration field taken as-is (e.g. flooding_duration_hari) or the day
 *  difference between two date fields. */
function evalDuration(expr, payload) {
  if (expr.field) {
    return { hasil_hitung: numField(payload, expr.field), satuan: expr.unit || 'hari' };
  }
  const start = payload ? payload[expr.start_field] : null;
  const end = payload ? payload[expr.end_field] : null;
  if (!start || !end) return { hasil_hitung: 0, satuan: expr.unit || 'hari' };
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const days = Math.max(0, Math.round(ms / 86400000));
  return { hasil_hitung: days, satuan: expr.unit || 'hari' };
}

/** DATE_INTERVAL: days elapsed since a reference date field vs an expected interval_days --
 *  mainly used by schedulingEngine.js, exposed here too for direct formula evaluation/testing. */
function evalDateInterval(expr, payload) {
  const ref = payload ? payload[expr.date_field || 'last_inspection'] : null;
  if (!ref) return { hasil_hitung: null, satuan: 'hari', meta: { overdue: false } };
  const days = Math.floor((Date.now() - new Date(ref).getTime()) / 86400000);
  const overdue = expr.interval_days ? days > expr.interval_days : false;
  return { hasil_hitung: days, satuan: 'hari', meta: { overdue } };
}

/** RAINFALL_ACCUMULATION: sums a rainfall field either directly from the payload (single already-
 *  aggregated reading) or, when `db`+`blok_id` context is supplied, over a rolling window of past
 *  yield_partenocarpi rows for that blok (used for the FR's "curah hujan > 270 mm/bulan" check). */
function evalRainfallAccumulation(expr, payload, ctx = {}) {
  const field = expr.field || 'rainfall_mm';
  if (payload && payload[field] !== undefined && payload.__use_window !== true) {
    return { hasil_hitung: numField(payload, field), satuan: expr.unit || 'mm', meta: { window_days: expr.window_days || null } };
  }
  if (ctx.db && ctx.blok_id && expr.window_days) {
    const since = new Date(Date.now() - expr.window_days * 86400000).toISOString().slice(0, 10);
    const row = ctx.db
      .prepare(`SELECT COALESCE(SUM(${field}),0) AS total FROM yield_partenocarpi WHERE blok_id=? AND tanggal >= ?`)
      .get(ctx.blok_id, since);
    return { hasil_hitung: row ? row.total : 0, satuan: expr.unit || 'mm', meta: { window_days: expr.window_days } };
  }
  return { hasil_hitung: numField(payload, field), satuan: expr.unit || 'mm' };
}

/** MINIMUM_SAMPLE: checks an observed sample/count field against a required minimum (from the
 *  formula itself or from sampling_rule.minimum_sample) -- returns the observed count as
 *  hasil_hitung plus meta.meets_minimum, used to gate whether a result is even valid to classify. */
function evalMinimumSample(expr, payload) {
  const observed = numField(payload, expr.field);
  const minimum = expr.minimum;
  return { hasil_hitung: observed, satuan: expr.unit || 'sampel', meta: { minimum, meets_minimum: minimum == null ? true : observed >= minimum } };
}

/** CATEGORICAL_CONDITION: maps a qualitative field to an ordinal scale, so it can be stored /
 *  compared on the same numeric threshold columns as every other indicator. Reproduces V1's
 *  Ganoderma GANODERMA_SCALE mapping exactly, generalized to any field/scale/default. */
function evalCategoricalCondition(expr, payload) {
  const raw = (payload && (payload[expr.field] || (expr.fallback_field && payload[expr.fallback_field]))) || expr.default || '';
  const key = String(raw).toUpperCase();
  const scale = expr.scale || {};
  const code = Object.prototype.hasOwnProperty.call(scale, key) ? scale[key] : (scale[expr.default] ?? 0);
  return { hasil_hitung: code, satuan: expr.unit || 'skala', meta: { key } };
}

/** AND_OR: compound boolean condition tree, e.g. Partenocarpi's 4-way AND EWS trigger (bunga
 *  jantan antesis < 4 tandan/ha AND populasi EK < 20.000 ekor/ha AND curah hujan > 270 mm/bulan
 *  AND > 20 mm/periode pagi-siang). Each leaf condition is {field, operator, value}; nested
 *  {op, conditions:[...]} nodes are also allowed. hasil_hitung is 1/0 (true/false) so it can still
 *  be classified against a boolean-style threshold row if desired; meta carries the leaf detail
 *  for display/debugging. */
function evalCondition(cond, payload) {
  if (cond.op) return evalAndOr(cond, payload);
  const v = numField(payload, cond.field);
  const target = Number(cond.value);
  switch (cond.operator) {
    case '>': return v > target;
    case '>=': return v >= target;
    case '<': return v < target;
    case '<=': return v <= target;
    case '==':
    case '=': return v === target;
    case '!=': return v !== target;
    default: return false;
  }
}
function evalAndOr(expr, payload) {
  const conditions = expr.conditions || [];
  const results = conditions.map((c) => ({ cond: c, ok: evalCondition(c, payload) }));
  const combined = expr.op === 'OR' ? results.some((r) => r.ok) : results.every((r) => r.ok);
  return { hasil_hitung: combined ? 1 : 0, satuan: 'boolean', meta: { op: expr.op, results } };
}

const EVALUATORS = {
  COUNT_TOTAL: evalCountTotal,
  PERCENTAGE: evalPercentage,
  THRESHOLD: evalThreshold,
  DURATION: evalDuration,
  DATE_INTERVAL: evalDateInterval,
  RAINFALL_ACCUMULATION: evalRainfallAccumulation,
  MINIMUM_SAMPLE: evalMinimumSample,
  CATEGORICAL_CONDITION: evalCategoricalCondition,
  AND_OR: evalAndOr,
};

/** Evaluate one `formula` row against a payload. `ctx` (optional) carries { db, blok_id } for
 *  formula types that may need to look at history (RAINFALL_ACCUMULATION). */
function evaluateFormula(formulaRow, payload, ctx = {}) {
  const evaluator = EVALUATORS[formulaRow.formula_type];
  if (!evaluator) throw new Error(`formula_type tidak dikenal: ${formulaRow.formula_type}`);
  const expr = typeof formulaRow.expression_json === 'string' ? JSON.parse(formulaRow.expression_json) : formulaRow.expression_json;
  const result = evaluator(expr, payload, ctx);
  if (!result.satuan && formulaRow.unit) result.satuan = formulaRow.unit;
  return result;
}

/** Fetch the active formula row(s) for an hpt_id, optionally filtered by context
 *  ('SENSUS'/'DETEKSI'/...). Falls back to any active row for that hpt_id if no row matches the
 *  requested context, so callers that don't care about context still get a usable formula. */
function getActiveFormula(hpt_id, context) {
  const rows = db.prepare(`SELECT * FROM formula WHERE hpt_id=? AND active=1 ORDER BY updated_at DESC`).all(hpt_id);
  if (!rows.length) return null;
  if (context) {
    const matched = rows.find((r) => r.context === context);
    if (matched) return matched;
  }
  return rows[0];
}

/** Records a rule_version ledger row snapshotting exactly what was used to compute a result, so
 *  later edits to formula/threshold never change the meaning of past history (SPEC_V2.md section
 *  1 item 3). */
function recordRuleVersion({ entity_type, entity_id, effective_date, snapshot, changed_by_user_id = null, change_note = null }) {
  const info = db
    .prepare(
      `INSERT INTO rule_version (entity_type, entity_id, version_no, effective_date, status, changed_by_user_id, change_note, snapshot_json)
       VALUES (@entity_type, @entity_id, 1, @effective_date, 'AKTIF', @changed_by_user_id, @change_note, @snapshot_json)`
    )
    .run({
      entity_type,
      entity_id,
      effective_date: effective_date || todayISO(),
      changed_by_user_id,
      change_note,
      snapshot_json: JSON.stringify(snapshot || {}),
    });
  return info.lastInsertRowid;
}

/**
 * Main V2 entry point (SPEC_V2.md section 3 contract):
 *   computeIndicatorResult(hpt_code, input_payload, blok)
 *     -> { hasil, kategori, threshold_ref, rule_version_id, rekomendasi, next_action, alert_required }
 *
 * @param {string} hpt_code
 * @param {object} input_payload raw field-form input (formula-specific shape)
 * @param {object} blok blok row (must include id, status_tanaman)
 * @param {object} [opts]
 * @param {number} [opts.species_id]
 * @param {string} [opts.context] formula context, default 'SENSUS'
 * @param {'DETECTION'|'SENSUS'|'MORTALITY'} [opts.sourceType]
 * @param {number} [opts.sourceId]
 * @param {number} [opts.user_id] for rule_version audit trail
 */
function computeIndicatorResult(hpt_code, input_payload, blok, opts = {}) {
  const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(hpt_code);
  if (!hpt) throw Object.assign(new Error(`Indikator tidak dikenal: ${hpt_code}`), { status: 400 });
  if (!blok || !blok.id) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });

  const formulaRow = getActiveFormula(hpt.id, opts.context || 'SENSUS');
  if (!formulaRow) throw Object.assign(new Error(`Tidak ada formula aktif untuk indikator ${hpt_code}`), { status: 400 });

  const computed = evaluateFormula(formulaRow, input_payload, { db, blok_id: blok.id });

  const engineResult = runThresholdEngine({
    hpt_id: hpt.id,
    species_id: opts.species_id || null,
    blok_id: blok.id,
    nilai_hasil: computed.hasil_hitung,
    sourceType: opts.sourceType || 'SENSUS',
    sourceId: opts.sourceId,
    forced_kandidat_pengendalian: !!computed.forced_kandidat_pengendalian,
  });

  const rule_version_id = recordRuleVersion({
    entity_type: 'FORMULA',
    entity_id: formulaRow.id,
    effective_date: todayISO(),
    changed_by_user_id: opts.user_id || null,
    change_note: `computeIndicatorResult ${hpt_code}`,
    snapshot: {
      formula: formulaRow,
      threshold_matched: engineResult.thresholdRow || null,
      hasil: computed.hasil_hitung,
      kategori: engineResult.kategori,
    },
  });

  return {
    hasil: computed.hasil_hitung,
    satuan: computed.satuan,
    kategori: engineResult.kategori,
    threshold_ref: engineResult.thresholdRow
      ? `${engineResult.thresholdRow.kategori}: ${engineResult.thresholdRow.nilai_min ?? '-∞'}..${engineResult.thresholdRow.nilai_max ?? '+∞'} ${engineResult.thresholdRow.satuan || ''}`.trim()
      : null,
    rule_version_id,
    rekomendasi: engineResult.thresholdRow ? engineResult.thresholdRow.tindakan : null,
    next_action: engineResult.thresholdRow ? engineResult.thresholdRow.tindakan : null,
    alert_required: engineResult.ews_alert,
    engineResult,
    computedMeta: computed.meta || null,
  };
}

module.exports = {
  EVALUATORS,
  evaluateFormula,
  getActiveFormula,
  recordRuleVersion,
  computeIndicatorResult,
  // exported for reuse/testing of individual evaluators
  evalCountTotal,
  evalPercentage,
  evalThreshold,
  evalDuration,
  evalDateInterval,
  evalRainfallAccumulation,
  evalMinimumSample,
  evalCategoricalCondition,
  evalAndOr,
};
