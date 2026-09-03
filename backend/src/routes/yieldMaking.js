// Yield Making modules (SPEC_V2.md section 2 / section 4 Backend: "routes/yieldMaking.js
// (partenocarpi/water/organik/tbm sub-routes atau 1 file dgn 4 sub-router)"). One file, 4
// sub-routers, mounted at /api/yield-making/{partenocarpi,water-management,bahan-organik,
// tbm-vegetatif} -- same auth/response conventions as routes/detection.js, and the same
// classify-via-formula-table pipeline as HPT (services/ruleEngine.js computeIndicatorResult),
// generalized to these new indicators so nothing HPT-specific is hard-coded here either.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');
const { computeIndicatorResult } = require('../services/ruleEngine');
const { checkContainmentByBlokId } = require('../services/gisContainment');

const router = express.Router();
router.use(requireAuth);

const CREATE_ROLES = ['ADMIN', 'RND_FOD', 'PETUGAS_SENSUS', 'ASKEP_ASISTEN', 'PETUGAS_LAPANGAN'];

function resolveLocation(input) {
  const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(input.blok_id);
  if (!blok) throw Object.assign(new Error('Blok tidak ditemukan'), { status: 400 });
  const afdeling_id = input.afdeling_id || blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = input.estate_id || (afdeling ? afdeling.estate_id : null);
  const location_warning = checkContainmentByBlokId(input.blok_id, input.gps_lat, input.gps_lng);
  return { blok, afdeling_id, estate_id, location_warning: location_warning ? 1 : 0 };
}

/** Tries to compute kategori/ews_alert via the generic rule engine for `hptCode`. Soft-fails
 *  (returns nulls) if no formula/threshold is configured yet for that indicator, so field data
 *  can still be captured even before an admin finishes Rule & Parameter Management setup. */
function tryClassify(hptCode, payload, blok, ctx) {
  try {
    const result = computeIndicatorResult(hptCode, payload, blok, { context: 'YIELD_MAKING', sourceType: 'SENSUS', user_id: ctx.user_id });
    return { kategori: result.kategori, ews_alert: result.alert_required ? 1 : 0, hasil: result.hasil, incident: result.engineResult.incident, alert: result.engineResult.alert, rule_version_id: result.rule_version_id };
  } catch (e) {
    return { kategori: null, ews_alert: 0, hasil: null, incident: null, alert: null, rule_version_id: null, classify_error: e.message };
  }
}

function makeSubRouter({ table, hptCode, insertFields, auditTag, fieldDefaults = {} }) {
  const r = express.Router();

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      const clauses = [];
      const params = {};
      for (const f of ['estate_id', 'afdeling_id', 'blok_id', 'kategori', 'ews_alert']) {
        if (req.query[f] !== undefined) {
          clauses.push(`${f} = @${f}`);
          params[f] = req.query[f];
        }
      }
      if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
      if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
      let sql = `SELECT * FROM ${table}`;
      if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
      sql += ' ORDER BY created_at DESC LIMIT 500';
      res.json({ data: db.prepare(sql).all(params) });
    })
  );

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json({ data: row });
    })
  );

  r.post(
    '/',
    requireRole(...CREATE_ROLES),
    asyncHandler(async (req, res) => {
      if (!req.body.blok_id || !req.body.tanggal) return res.status(400).json({ error: 'blok_id, tanggal wajib diisi' });
      const { blok, afdeling_id, estate_id, location_warning } = resolveLocation(req.body);
      const classified = tryClassify(hptCode, req.body, blok, { user_id: req.user.id });

      const server_id = req.body.server_id || uuidv4();
      const now = new Date().toISOString();
      const cols = ['local_id', 'server_id', 'incident_id', 'user_id', 'device_id', 'estate_id', 'afdeling_id', 'blok_id', 'tanggal', ...insertFields, 'kategori', 'ews_alert', 'gps_lat', 'gps_lng', 'gps_accuracy', 'location_warning', 'foto_id', 'catatan', 'sync_status', 'sync_attempt', 'sync_error', 'source', 'created_at', 'updated_at'];
      const placeholders = cols.map((c) => '@' + c).join(', ');
      const params = {
        local_id: req.body.local_id || null,
        server_id,
        incident_id: classified.incident ? classified.incident.id : null,
        user_id: req.user.id,
        device_id: req.body.device_id || null,
        estate_id,
        afdeling_id,
        blok_id: req.body.blok_id,
        tanggal: req.body.tanggal,
        kategori: classified.kategori,
        ews_alert: classified.ews_alert,
        gps_lat: req.body.gps_lat ?? null,
        gps_lng: req.body.gps_lng ?? null,
        gps_accuracy: req.body.gps_accuracy ?? null,
        location_warning,
        foto_id: req.body.foto_id || null,
        catatan: req.body.catatan || null,
        sync_status: req.body.sync_status || 'SYNCED',
        sync_attempt: req.body.sync_attempt || 0,
        sync_error: req.body.sync_error || null,
        source: req.body.source || 'WEB',
        created_at: req.body.created_at || now,
        updated_at: now,
      };
      // NOT NULL DEFAULT 0 columns (e.g. water_management.flooding) need an explicit fallback --
      // passing an explicit `null` param bypasses SQLite's column DEFAULT (that only kicks in
      // when the column is omitted from the INSERT entirely), so `fieldDefaults` covers those.
      for (const f of insertFields) params[f] = req.body[f] ?? (f in fieldDefaults ? fieldDefaults[f] : null);

      const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).run(params);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid);
      auditFromReq(req, { aktivitas: auditTag, after: row });
      res.status(201).json({
        data: row,
        classification: { kategori: classified.kategori, ews_alert: !!classified.ews_alert, incident: classified.incident, alert: classified.alert, rule_version_id: classified.rule_version_id, classify_note: classified.classify_error || null },
        location_warning: !!location_warning,
      });
    })
  );

  return r;
}

router.use(
  '/partenocarpi',
  makeSubRouter({
    table: 'yield_partenocarpi',
    hptCode: 'PARTENOCARPI',
    insertFields: ['periode', 'rainfall_mm', 'indikator_hujan_pagi', 'total_bunch', 'abnormal_bunch', 'abnormal_bunch_pct', 'populasi_ek'],
    auditTag: 'CREATE_YIELD_PARTENOCARPI',
  })
);

router.use(
  '/water-management',
  makeSubRouter({
    table: 'water_management',
    hptCode: 'WATER_MANAGEMENT',
    insertFields: ['titik_parit', 'water_level_cm', 'flooding', 'flooding_duration_hari'],
    fieldDefaults: { flooding: 0 },
    auditTag: 'CREATE_WATER_MANAGEMENT',
  })
);

router.use(
  '/bahan-organik',
  makeSubRouter({
    table: 'bahan_organik',
    hptCode: 'BAHAN_ORGANIK',
    insertFields: ['area_type', 'total_sample', 'yellowing_count', 'yellowing_pct', 'vegetative_condition', 'baseline_tbm_normal', 'comparison_result'],
    auditTag: 'CREATE_BAHAN_ORGANIK',
  })
);

router.use(
  '/tbm-vegetatif',
  makeSubRouter({
    table: 'tbm_vegetatif',
    hptCode: 'TBM_VEGETATIF',
    insertFields: ['umur_bulan', 'panjang_pelepah_cm', 'jumlah_pelepah', 'lai', 'target_produksi_ton_ha', 'hasil_evaluasi'],
    auditTag: 'CREATE_TBM_VEGETATIF',
  })
);

module.exports = router;
