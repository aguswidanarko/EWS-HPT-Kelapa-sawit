// BRD V3.1 "Assessment Mapping Engine" (BRD_Backend_Addendum_V3_1.docx). Turns ONE Universal
// Assessment visit (raw per-pokok observations + area + water) into potentially MANY EWS
// results, reusing the EXISTING classification/incident/alert machinery instead of a parallel
// engine (BRD Addendum section 1: "Menambahkan backend layer yang mengubah satu Universal
// Assessment menjadi raw observations, EWS calculations, EWS results, alert dan action trigger").
//
// Design (see the report delivered to the user for the full reasoning):
//   - Every indicator this engine can compute reuses services/ruleEngine.js's
//     computeIndicatorResult(hpt_code, payload, blok, opts), which already resolves hpt_id,
//     reads the active `formula` row for the given (hpt_id, context), evaluates it, classifies
//     against `threshold`, and creates/updates incident + alert + notifications exactly like
//     detection/sensus/agro_observation already do. This engine's only job is building the RIGHT
//     payload shape per indicator from the per-tree tally, not reimplementing classification.
//   - sourceType is always 'ASSESSMENT' (new, alongside DETECTION/SENSUS/MORTALITY) with no
//     sourceId, so findOrCreateIncident() never writes into detection_id/sensus_id/mortality_id
//     for an assessment-derived incident (see thresholdEngine.js's idField lookup -- an unknown
//     sourceType simply skips that column, which is exactly what we want here since incident has
//     no assessment_id column).
//   - Percentage-style indicators (Tikus/Oryctes/Rayap, all context='SENSUS') and the two Water
//     Management indicators (context='YIELD_MAKING' / 'WM_GENANGAN') already have real
//     formula+threshold rows from V1/V2 seeding, so this engine feeds them directly.
//   - Eight Agro indicators (Kerdil/Etiolasi/Sisipan/PokokMati/Abnormal/Overpruning/
//     SusunanPelepah/GroundCover) have an EXISTING CATEGORICAL_CONDITION formula on
//     agro_observation.kategori that used to be filled by the petugas picking
//     RINGAN/SEDANG/BERAT directly (old EwsFormScreen SimpleFields flow). V3.1 instead computes
//     a rate (count flagged / total pokok sampled * 100) from the per-pokok tally and bands it
//     into RINGAN/SEDANG/BERAT via percentToSeverityBand() below -- a documented DEFAULT banding
//     (>0-10% Ringan, >10-25% Sedang, >25% Berat), since neither the BRD nor the source workbook
//     gives exact cutoffs for these visual-severity indicators. It is a single, clearly-labelled
//     function, easy for Riset/business to retune later without touching the ingestion path.
//   - Ground Cover (EWS-25) is BRD Addendum section 6's many-to-one example: Piringan is the
//     primary per-pokok rate, bumped one severity band if the area-level Gawangan is also
//     TIDAK_BAIK or dominant weeds were recorded -- a documented default combination rule.
//   - Ulat (generic UPDKS symptom) and Basal stem root (Ganoderma symptom) are explicitly NOT
//     auto-classified: their real formulas need a proper dedicated sensus count
//     (ulat_hidup_total/jumlah_pelepah_diamati, status_serangan text) that a coarse per-pokok
//     boolean cannot honestly supply (assessment_mapping.notes says so explicitly for both). When
//     found, this engine records a calculation_result row with requires_manual_sensus=1 and a
//     Bahasa Indonesia note recommending the dedicated sensus, WITHOUT fabricating a
//     kategori/incident/alert.
//   - Kastrasi, Sanitasi, Tirathaba, Upper stem root, Lainnya, KBH, Beneficial Plants, Aplikasi
//     Pupuk (EWS-18/TBM_VEGETATIF) and Aplikasi by-product (EWS-17/BAHAN_ORGANIK) all have
//     EXISTING formulas that expect a different, more specific measurement than what the
//     Universal Assessment Form captures (see assessment_mapping.notes for each) -- they are
//     stored as raw supporting data only (assessment_area_observation / assessment_tree columns)
//     with NO calculation_result row, exactly as BRD Addendum section 16 catatan mapping
//     instructs ("tidak boleh dipaksa menjadi EWS baru tanpa keputusan bisnis").
//   - Pokok Doyong (EWS-21) and Partenocarpi/Yield Making (EWS-16) have no corresponding
//     Assessment Mapping row at all (confirmed against the supplied mapping dictionary) -- they
//     remain served by the existing per-EWS_ID Observasi EWS picker (EwsPickerScreen /
//     EwsFormScreen), which this V3.1 work does NOT remove.

const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { checkLocationWarning } = require('./geo');
const { computeIndicatorResult } = require('./ruleEngine');
const { logAudit } = require('./audit');

// --------------------------------------------------------------------------------- utilities

function todayCompact(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function generateAssessmentCode(date = new Date()) {
  const ymd = todayCompact(date);
  const prefix = `ASMT-${ymd}-`;
  const row = db.prepare(`SELECT assessment_code FROM assessment WHERE assessment_code LIKE ? ORDER BY assessment_code DESC LIMIT 1`).get(`${prefix}%`);
  let seq = 1;
  if (row) {
    const lastSeq = parseInt(row.assessment_code.slice(prefix.length), 10);
    if (!Number.isNaN(lastSeq)) seq = lastSeq + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

function j(v) {
  return v === undefined || v === null ? null : JSON.stringify(v);
}
function parseJ(v, fallback) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch { return fallback; }
}

/**
 * DEFAULT severity banding for rate-based Agro indicators whose existing formula reads a
 * categorical `kategori` rather than a raw percentage (see file header). Documented, single
 * function -- change here to retune every categorical indicator at once.
 */
function percentToSeverityBand(ratePct) {
  if (!(ratePct > 0)) return 'NORMAL';
  if (ratePct <= 10) return 'RINGAN';
  if (ratePct <= 25) return 'SEDANG';
  return 'BERAT';
}
const SEVERITY_ORDER_LOCAL = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT'];
function bumpBand(band, steps = 1) {
  const i = SEVERITY_ORDER_LOCAL.indexOf(band);
  if (i === -1) return band;
  return SEVERITY_ORDER_LOCAL[Math.min(SEVERITY_ORDER_LOCAL.length - 1, i + steps)];
}

const DEFISIENSI_SEVERITY_ORDER = ['TIDAK_ADA', 'RINGAN', 'SEDANG', 'BERAT'];
function worstOf(bands) {
  let best = 'TIDAK_ADA';
  for (const b of bands) {
    if (DEFISIENSI_SEVERITY_ORDER.indexOf(b) > DEFISIENSI_SEVERITY_ORDER.indexOf(best)) best = b;
  }
  return best;
}

// Resolve which of the stage-split EWS alias codes (e.g. Tikus's EWS-01/02/03) applies, purely
// for tagging calculation_result.ews_id / the "perlu sensus" note -- the actual classification
// always goes through computeIndicatorResult, which resolves fase_tanaman from the blok itself.
function pickAliasForStage(aliasList, stage) {
  const list = (aliasList || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (list.length <= 1) return list[0] || null;
  const idx = { TM: 0, TBM: 1, 'TB-0': 2 }[stage];
  return list[idx !== undefined ? idx : 0] || list[0];
}

function getHptIdByCode(code) {
  const row = db.prepare('SELECT id FROM hpt WHERE code=?').get(code);
  return row ? row.id : null;
}

function insertCalcResult(row) {
  const info = db
    .prepare(
      `INSERT INTO calculation_result (
        assessment_id, ews_id, hpt_id, numerator, denominator, rate, unit, kategori, ews_alert,
        incident_id, alert_id, rule_version_id, requires_manual_sensus, note
      ) VALUES (@assessment_id, @ews_id, @hpt_id, @numerator, @denominator, @rate, @unit, @kategori, @ews_alert,
        @incident_id, @alert_id, @rule_version_id, @requires_manual_sensus, @note)`
    )
    .run(row);
  return info.lastInsertRowid;
}

// --------------------------------------------------------------------------- per-tree tallies

const KONDISI_TO_EWS = [
  { tag: 'KERDIL', hptCode: 'POKOK_KERDIL', aliasFallback: 'EWS-26' },
  { tag: 'ETIOLASI', hptCode: 'ETIOLASI', aliasFallback: 'EWS-20' },
  { tag: 'SISIPAN', hptCode: 'POKOK_SISIPAN', aliasFallback: 'EWS-28' },
  { tag: 'ABNORMAL', hptCode: 'ABNORMAL', aliasFallback: 'EWS-27' },
];

const HAMA_TO_SENSUS = [
  { jenis: 'TIKUS', hptCode: 'TIKUS', aliasList: 'EWS-01/EWS-02/EWS-03' },
  { jenis: 'RAYAP', hptCode: 'RAYAP', aliasList: 'EWS-10/EWS-11/EWS-12' },
  { jenis: 'KUMBANG', hptCode: 'ORYCTES', aliasList: 'EWS-07/EWS-08/EWS-09' },
];

function countTrees(trees, predicate) {
  return trees.reduce((n, t) => (predicate(t) ? n + 1 : n), 0);
}
function hasHama(tree, jenis) {
  return (tree.hama || []).some((h) => String(h.jenis).toUpperCase() === jenis);
}
function hasKondisi(tree, tag) {
  return (tree.kondisi || []).map((k) => String(k).toUpperCase()).includes(tag);
}

// --------------------------------------------------------------------------------- main entry

/**
 * @param {object} input Universal Assessment payload (see routes/assessment.js for the exact
 *   shape mobile sends -- header fields + trees[] + area{} + water{}).
 * @param {object} ctx { user_id, ip_session }
 */
function ingestAssessment(input, ctx = {}) {
  if (!input.blok_id || !input.tanggal || !Array.isArray(input.trees) || input.trees.length === 0) {
    throw Object.assign(new Error('blok_id, tanggal, dan minimal 1 data pokok wajib diisi'), { status: 400 });
  }

  const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);
  const planting_stage = input.planting_stage || blok.status_tanaman || null;
  const location_warning = checkLocationWarning(blok, input.gps_lat, input.gps_lng);

  const trees = input.trees;
  const total = trees.length;
  const server_id = input.server_id || uuidv4();
  const assessment_code = generateAssessmentCode();
  const now = new Date().toISOString();

  const txResult = db.transaction(() => {
    // ---- 1. assessment header -------------------------------------------------------------
    const info = db
      .prepare(
        `INSERT INTO assessment (
          local_id, server_id, assessment_code, user_id, device_id, estate_id, afdeling_id, blok_id,
          planting_stage, baris, sampling_method, sample_count, tanggal, waktu_mulai, waktu_selesai,
          gps_lat, gps_lng, gps_accuracy, location_warning, catatan, status, petugas,
          sync_status, sync_attempt, sync_error, source, created_at, updated_at
        ) VALUES (
          @local_id, @server_id, @assessment_code, @user_id, @device_id, @estate_id, @afdeling_id, @blok_id,
          @planting_stage, @baris, @sampling_method, @sample_count, @tanggal, @waktu_mulai, @waktu_selesai,
          @gps_lat, @gps_lng, @gps_accuracy, @location_warning, @catatan, 'SUBMITTED', @petugas,
          @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
        )`
      )
      .run({
        local_id: input.local_id || null,
        server_id,
        assessment_code,
        user_id: ctx.user_id || input.user_id || null,
        device_id: input.device_id || null,
        estate_id,
        afdeling_id,
        blok_id: input.blok_id,
        planting_stage,
        baris: input.baris || null,
        sampling_method: input.sampling_method || null,
        sample_count: total,
        tanggal: input.tanggal,
        waktu_mulai: input.waktu_mulai || null,
        waktu_selesai: input.waktu_selesai || null,
        gps_lat: input.gps_lat ?? null,
        gps_lng: input.gps_lng ?? null,
        gps_accuracy: input.gps_accuracy ?? null,
        location_warning: location_warning ? 1 : 0,
        catatan: input.catatan || null,
        petugas: input.petugas || null,
        sync_status: input.sync_status || 'SYNCED',
        sync_attempt: input.sync_attempt || 0,
        sync_error: null,
        source: ['MOBILE', 'EXCEL', 'WEB', 'API'].includes(input.source) ? input.source : 'API',
        created_at: input.created_at || now,
        updated_at: now,
      });
    const assessment_id = info.lastInsertRowid;

    // ---- 2. per-pokok rows ------------------------------------------------------------------
    // NOTE: mobile's sync/payloads.ts buildAssessmentPayload() resolves each tree's photo to a
    // SERVER photo id (`foto_id`) BEFORE this endpoint is ever called (photo-before-record
    // ordering, same as every other V2/V3 upload) - `foto_local_id` is a mobile-only concept that
    // never crosses the wire. Both columns are accepted here (foto_id from the normal mobile/API
    // path, foto_local_id as a fallback for any other caller that genuinely only has a local id)
    // so a photo actually gets linked to its pokok row instead of silently staying NULL.
    const insertTree = db.prepare(
      `INSERT INTO assessment_tree (
        assessment_id, pokok_index, status_pokok, kondisi_json, pruning, susunan_pelepah, piringan,
        gulma_piringan_json, defisiensi_json, hama_json, foto_local_id, foto_id, gps_lat, gps_lng, catatan
      ) VALUES (@assessment_id, @pokok_index, @status_pokok, @kondisi_json, @pruning, @susunan_pelepah, @piringan,
        @gulma_piringan_json, @defisiensi_json, @hama_json, @foto_local_id, @foto_id, @gps_lat, @gps_lng, @catatan)`
    );
    trees.forEach((t, idx) => {
      insertTree.run({
        assessment_id,
        pokok_index: t.pokok_index || idx + 1,
        status_pokok: t.status_pokok || (((t.kondisi && t.kondisi.length) || (t.hama && t.hama.length) || (t.defisiensi && t.defisiensi.length)) ? 'EXCEPTION' : 'NORMAL'),
        kondisi_json: j(t.kondisi),
        pruning: t.pruning || 'NORMAL',
        susunan_pelepah: t.susunan_pelepah || null,
        piringan: t.piringan || null,
        gulma_piringan_json: j(t.gulma_piringan),
        defisiensi_json: j(t.defisiensi),
        hama_json: j(t.hama),
        foto_local_id: t.foto_local_id || null,
        foto_id: t.foto_id ?? null,
        gps_lat: t.gps_lat ?? null,
        gps_lng: t.gps_lng ?? null,
        catatan: t.catatan || null,
      });
    });

    // ---- 3. area + water observations (optional, once per assessment) ----------------------
    if (input.area) {
      const a = input.area;
      db.prepare(
        `INSERT INTO assessment_area_observation (
          assessment_id, gawangan, gulma_gawangan_json, aplikasi_pupuk, jenis_pupuk, tanggal_pupuk,
          keterangan_pupuk, by_product_json, keterangan_by_product, erosi, catatan, kbh, beneficial_plants
        ) VALUES (@assessment_id, @gawangan, @gulma_gawangan_json, @aplikasi_pupuk, @jenis_pupuk, @tanggal_pupuk,
          @keterangan_pupuk, @by_product_json, @keterangan_by_product, @erosi, @catatan, @kbh, @beneficial_plants)`
      ).run({
        assessment_id,
        gawangan: a.gawangan || null,
        gulma_gawangan_json: j(a.gulma_gawangan),
        aplikasi_pupuk: a.aplikasi_pupuk ? 1 : 0,
        jenis_pupuk: a.jenis_pupuk || null,
        tanggal_pupuk: a.tanggal_pupuk || null,
        keterangan_pupuk: a.keterangan_pupuk || null,
        by_product_json: j(a.by_product),
        keterangan_by_product: a.keterangan_by_product || null,
        erosi: a.erosi || null,
        catatan: a.catatan || null,
        kbh: a.kbh || null,
        beneficial_plants: a.beneficial_plants || null,
      });
    }
    if (input.water) {
      const w = input.water;
      db.prepare(
        `INSERT INTO assessment_water_observation (
          assessment_id, drainase, water_level_cm, water_weir, kondisi_parit, lama_genangan_hari, catatan
        ) VALUES (@assessment_id, @drainase, @water_level_cm, @water_weir, @kondisi_parit, @lama_genangan_hari, @catatan)`
      ).run({
        assessment_id,
        drainase: w.drainase || null,
        water_level_cm: w.water_level_cm ?? null,
        water_weir: w.water_weir || null,
        kondisi_parit: w.kondisi_parit || null,
        lama_genangan_hari: w.lama_genangan_hari ?? null,
        catatan: w.catatan || null,
      });
    }

    // ---- 4. calculation engine ---------------------------------------------------------------
    const calcResults = [];
    const commonOpts = { sourceType: 'ASSESSMENT', user_id: ctx.user_id || input.user_id || null };

    function runAndRecord({ ews_alias, hptCode, context, payload, numerator, denominator, unit }) {
      const hpt_id = getHptIdByCode(hptCode);
      try {
        const result = computeIndicatorResult(hptCode, payload, blok, { ...commonOpts, context });
        const id = insertCalcResult({
          assessment_id,
          ews_id: ews_alias,
          hpt_id,
          numerator: numerator ?? null,
          denominator: denominator ?? null,
          rate: denominator ? (numerator / denominator) * 100 : null,
          unit: unit || result.satuan || null,
          kategori: result.kategori,
          ews_alert: result.alert_required ? 1 : 0,
          incident_id: result.engineResult.incident ? result.engineResult.incident.id : null,
          alert_id: result.engineResult.alert ? result.engineResult.alert.id : null,
          rule_version_id: result.rule_version_id || null,
          requires_manual_sensus: 0,
          note: null,
        });
        calcResults.push({ id, ews_id: ews_alias, hpt_code: hptCode, kategori: result.kategori, ews_alert: result.alert_required, computed: true });
      } catch (e) {
        // Soft-fail (missing formula/threshold, etc.) -- never blocks capture, matches
        // tryClassifyAgro()'s existing convention in services/ingestion.js.
        const id = insertCalcResult({
          assessment_id, ews_id: ews_alias, hpt_id, numerator: numerator ?? null, denominator: denominator ?? null,
          rate: denominator ? (numerator / denominator) * 100 : null, unit: unit || null, kategori: null,
          ews_alert: 0, incident_id: null, alert_id: null, rule_version_id: null, requires_manual_sensus: 0,
          note: `Belum dapat dihitung otomatis: ${e.message}`,
        });
        calcResults.push({ id, ews_id: ews_alias, hpt_code: hptCode, kategori: null, ews_alert: false, computed: false, error: e.message });
      }
    }

    function recordManualSensusNeeded({ ews_alias, hptCode, count }) {
      const hpt_id = getHptIdByCode(hptCode);
      const id = insertCalcResult({
        assessment_id, ews_id: ews_alias, hpt_id, numerator: count, denominator: total, rate: (count / total) * 100,
        unit: '%', kategori: null, ews_alert: 0, incident_id: null, alert_id: null, rule_version_id: null,
        requires_manual_sensus: 1,
        note: `Gejala ditemukan pada ${count} dari ${total} pokok yang diperiksa - lakukan sensus lengkap untuk klasifikasi resmi.`,
      });
      // snake_case to match every other field here AND api/v2.ts's AssessmentCreateResult /
      // sync/engine.ts's uploadAssessments() on the mobile side, which reads
      // `r.requires_manual_sensus` - a camelCase key here would silently read back as
      // `undefined` (falsy) on the client and drop the "do a dedicated sensus" flag entirely.
      calcResults.push({ id, ews_id: ews_alias, hpt_code: hptCode, kategori: null, ews_alert: false, computed: false, requires_manual_sensus: true });
    }

    // -- Tikus / Rayap / Oryctes: existing SENSUS-context PERCENTAGE formulas, fed directly ----
    for (const h of HAMA_TO_SENSUS) {
      const count = countTrees(trees, (t) => hasHama(t, h.jenis));
      if (count === 0 && !trees.some((t) => (t.hama || []).length)) continue; // nothing recorded for HPT at all this visit
      const ews_alias = pickAliasForStage(h.aliasList, planting_stage);
      const payload =
        h.hptCode === 'TIKUS'
          ? { serangan_baru: count, serangan_lama: 0, jumlah_sampel: total }
          : { jumlah_pokok_terserang: count, jumlah_pokok_diamati: total };
      runAndRecord({ ews_alias, hptCode: h.hptCode, context: 'SENSUS', payload, numerator: count, denominator: total, unit: '%' });
    }

    // -- Ulat (UPDKS symptom) / Basal stem root (Ganoderma symptom): flag for dedicated sensus -
    const ulatCount = countTrees(trees, (t) => hasHama(t, 'ULAT'));
    if (ulatCount > 0) recordManualSensusNeeded({ ews_alias: pickAliasForStage('EWS-04/EWS-05/EWS-06', planting_stage), hptCode: 'UPDKS', count: ulatCount });
    const ganodermaCount = countTrees(trees, (t) => hasHama(t, 'BASAL_STEM_ROOT'));
    if (ganodermaCount > 0) recordManualSensusNeeded({ ews_alias: pickAliasForStage('EWS-13/EWS-14/EWS-15', planting_stage), hptCode: 'GANODERMA', count: ganodermaCount });

    // -- Kerdil / Etiolasi / Sisipan / Abnormal: rate -> banded kategori -----------------------
    for (const k of KONDISI_TO_EWS) {
      const count = countTrees(trees, (t) => hasKondisi(t, k.tag));
      if (count === 0) continue;
      const rate = (count / total) * 100;
      runAndRecord({
        ews_alias: k.aliasFallback, hptCode: k.hptCode, context: 'AGRO_OBSERVATION',
        payload: { kategori: percentToSeverityBand(rate) }, numerator: count, denominator: total, unit: '%',
      });
    }

    // -- Tumbang + Kosong/Mati -> POKOK_MATI (EWS-29), counted as one union --------------------
    const matiCount = countTrees(trees, (t) => hasKondisi(t, 'TUMBANG') || hasKondisi(t, 'KOSONG_MATI'));
    if (matiCount > 0) {
      const rate = (matiCount / total) * 100;
      runAndRecord({ ews_alias: 'EWS-29', hptCode: 'POKOK_MATI', context: 'AGRO_OBSERVATION', payload: { kategori: percentToSeverityBand(rate) }, numerator: matiCount, denominator: total, unit: '%' });
    }

    // -- Overpruning (EWS-23): only "OVER" counts as the alert-worthy exception ----------------
    const overCount = countTrees(trees, (t) => t.pruning === 'OVER');
    if (overCount > 0) {
      const rate = (overCount / total) * 100;
      runAndRecord({ ews_alias: 'EWS-23', hptCode: 'OVERPRUNING', context: 'AGRO_OBSERVATION', payload: { kategori: percentToSeverityBand(rate) }, numerator: overCount, denominator: total, unit: '%' });
    }

    // -- Susunan pelepah (EWS-24, TM only, sparse field) ---------------------------------------
    const susunanRecorded = trees.filter((t) => t.susunan_pelepah);
    if (susunanRecorded.length) {
      const bad = countTrees(susunanRecorded, (t) => t.susunan_pelepah === 'TIDAK_SESUAI');
      if (bad > 0) {
        const rate = (bad / susunanRecorded.length) * 100;
        runAndRecord({ ews_alias: 'EWS-24', hptCode: 'SUSUNAN_PELEPAH', context: 'AGRO_OBSERVATION', payload: { kategori: percentToSeverityBand(rate) }, numerator: bad, denominator: susunanRecorded.length, unit: '%' });
      }
    }

    // -- Ground cover (EWS-25, many-to-one: Piringan primary, Gawangan/Gulma bump) -------------
    const piringanRecorded = trees.filter((t) => t.piringan);
    if (piringanRecorded.length || (input.area && (input.area.gawangan || (input.area.gulma_gawangan || []).length))) {
      const badPiringan = countTrees(piringanRecorded, (t) => t.piringan === 'TIDAK_BAIK');
      let band = piringanRecorded.length ? percentToSeverityBand((badPiringan / piringanRecorded.length) * 100) : 'NORMAL';
      const gawanganBad = input.area && input.area.gawangan === 'TIDAK_BAIK';
      const weedsPresent = input.area && ((input.area.gulma_gawangan || []).length > 0 || trees.some((t) => (t.gulma_piringan || []).length > 0));
      if (gawanganBad) band = bumpBand(band, 1);
      if (weedsPresent) band = bumpBand(band, 1);
      if (band !== 'NORMAL') {
        runAndRecord({
          ews_alias: 'EWS-25', hptCode: 'GROUND_COVER', context: 'AGRO_OBSERVATION', payload: { kategori: band },
          numerator: badPiringan, denominator: piringanRecorded.length || total, unit: '%',
        });
      }
    }

    // -- Defisiensi Hara (EWS-19, many-to-one across N unsur x per-pokok, worst-of) ------------
    const defisiensiSeverities = [];
    for (const t of trees) for (const d of t.defisiensi || []) defisiensiSeverities.push(d.severity);
    if (defisiensiSeverities.length) {
      const worst = worstOf(defisiensiSeverities);
      if (worst !== 'TIDAK_ADA') {
        const affected = countTrees(trees, (t) => (t.defisiensi || []).length > 0);
        runAndRecord({ ews_alias: 'EWS-19', hptCode: 'DEFISIENSI_HARA', context: 'DEFISIENSI_HARA', payload: { severity: worst }, numerator: affected, denominator: total, unit: '%' });
      }
    }

    // -- Water Management (EWS-30 water level, EWS-31 flooding duration) ----------------------
    if (input.water && input.water.water_level_cm !== undefined && input.water.water_level_cm !== null) {
      runAndRecord({ ews_alias: 'EWS-30', hptCode: 'WATER_MANAGEMENT', context: 'YIELD_MAKING', payload: { water_level_cm: input.water.water_level_cm }, numerator: null, denominator: null, unit: 'cm' });
    }
    if (input.water && input.water.lama_genangan_hari !== undefined && input.water.lama_genangan_hari !== null) {
      runAndRecord({ ews_alias: 'EWS-31', hptCode: 'WATER_MANAGEMENT', context: 'WM_GENANGAN', payload: { flooding_duration_hari: input.water.lama_genangan_hari }, numerator: null, denominator: null, unit: 'hari' });
    }

    db.prepare(`UPDATE assessment SET status='CALCULATED', updated_at=datetime('now') WHERE id=?`).run(assessment_id);

    logAudit({
      user_id: ctx.user_id || input.user_id || null,
      aktivitas: `ASSESSMENT_SUBMIT ${assessment_code} blok=${blok.code} pokok=${total} ews_computed=${calcResults.filter((r) => r.computed).length}`,
      after: { assessment_id, assessment_code, calcResults },
      device_source: input.source || 'API',
      ip_session: ctx.ip_session || null,
    });

    return { assessment_id, assessment_code, server_id, calcResults };
  })();

  const assessmentRow = db.prepare('SELECT * FROM assessment WHERE id=?').get(txResult.assessment_id);
  return {
    assessment: assessmentRow,
    calculationResults: txResult.calcResults,
    location_warning,
  };
}

function getAssessmentDetail(id) {
  const assessment = db.prepare('SELECT * FROM assessment WHERE id=?').get(id);
  if (!assessment) return null;
  const trees = db.prepare('SELECT * FROM assessment_tree WHERE assessment_id=? ORDER BY pokok_index').all(id).map((t) => ({
    ...t,
    kondisi: parseJ(t.kondisi_json, []),
    gulma_piringan: parseJ(t.gulma_piringan_json, []),
    defisiensi: parseJ(t.defisiensi_json, []),
    hama: parseJ(t.hama_json, []),
  }));
  const area = db.prepare('SELECT * FROM assessment_area_observation WHERE assessment_id=?').get(id) || null;
  const water = db.prepare('SELECT * FROM assessment_water_observation WHERE assessment_id=?').get(id) || null;
  const calculationResults = db.prepare('SELECT * FROM calculation_result WHERE assessment_id=? ORDER BY id').all(id);
  return { assessment, trees, area, water, calculationResults };
}

module.exports = { ingestAssessment, getAssessmentDetail, percentToSeverityBand, generateAssessmentCode };
