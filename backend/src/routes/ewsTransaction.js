// Per-EWS_ID transaction template/import/export (BRD V3 "Import Center" / "Export Center",
// generalized across all 32 EWS_IDs from services/ewsRegistry.js instead of one route per
// indicator). Same two-phase upload idiom as routes/importExcel.js and
// routes/masterEwsDictionary.js (upload -> preview -> commit with confirm=true, import_log
// ledger row per attempt), but generic: which table gets written and which columns the template
// needs come from the registry, not from a hard-coded switch here.
//
// Dispatch by backing table (see ewsRegistry.js's entryPoint):
//   sensus            -> services/ingestion.js ingestSensus() (already resolves blok/location/dup)
//   agro_observation  -> services/ingestion.js ingestAgroObservation() (already resolves blok/location/classify)
//   yield_partenocarpi / water_management / bahan_organik / tbm_vegetatif
//                     -> generic table-driven insert below (mirrors routes/yieldMaking.js's
//                        makeSubRouter exactly, but reads table/hpt_code/insertFields/fieldDefaults
//                        from the registry instead of a closure -- kept separate from
//                        yieldMaking.js rather than refactoring that already-live route, to avoid
//                        any risk of regressing the existing dashboard manual-entry endpoints)
//   defisiensi_hara_temuan -> generic insert below, no auto rule-engine classification (matches
//                        routes/defisiensiHara.js: severity is set by the petugas, not computed)
//
// classifyContext: WM-002 needs context='WM_GENANGAN' (duration formula) instead of the
// WM-001/default 'YIELD_MAKING' (threshold formula) -- see ewsRegistry.js's WM-001/WM-002 comment
// for why this is a real gap in routes/yieldMaking.js's direct dashboard route, not just registry
// metadata. This import path is the first place that gap is actually fixed, by passing
// entry.classifyContext through to computeIndicatorResult() explicitly.

const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { logAudit } = require('../services/audit');
const { computeIndicatorResult } = require('../services/ruleEngine');
const { checkContainmentByBlokId } = require('../services/gisContainment');
const { ingestSensus, ingestAgroObservation } = require('../services/ingestion');
const { getEwsEntry, getTemplateColumns, listEwsIds } = require('../services/ewsRegistry');

const router = express.Router();
router.use(requireAuth);

const WRITE_ROLES = ['ADMIN', 'RND_FOD', 'PETUGAS_SENSUS', 'ASKEP_ASISTEN'];
const YIELD_MAKING_TABLES = new Set(['yield_partenocarpi', 'water_management', 'bahan_organik', 'tbm_vegetatif']);

// router.param (not a bare router.use) so this only fires for routes that actually declare
// :ews_id in their path -- a bare router.use(fn) would also run (and wrongly 404) for
// /meta/ews-ids below, since Express hasn't matched a specific route yet when a pathless
// middleware runs.
router.param('ews_id', (req, res, next, ews_id) => {
  const entry = getEwsEntry(ews_id);
  if (!entry) return res.status(404).json({ error: `EWS_ID tidak dikenal: ${ews_id} (lihat GET /api/ews-transaction/meta/ews-ids)` });
  req.ewsEntry = entry;
  next();
});

// -------------------------------------------------------------- meta
router.get(
  '/meta/ews-ids',
  asyncHandler(async (req, res) => {
    res.json({ data: listEwsIds(req.query.scope || undefined) });
  })
);

// -------------------------------------------------------------- template
router.get(
  '/:ews_id/template',
  asyncHandler(async (req, res) => {
    const cols = getTemplateColumns(req.params.ews_id);
    const headers = cols.map((c) => c.field);
    const example = cols.map((c) => (c.type === 'number' ? 0 : c.options ? c.options[0] : ''));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, example]), 'Data');
    const dictSheet = XLSX.utils.aoa_to_sheet([
      ['Kolom', 'Wajib', 'Tipe', 'Keterangan'],
      ...cols.map((c) => [c.field, c.required ? 'ya' : 'tidak', c.type || 'text', c.label + (c.options ? ` (${c.options.join('/')})` : '')]),
    ]);
    XLSX.utils.book_append_sheet(wb, dictSheet, 'Data Dictionary');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="template_${req.params.ews_id}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

// -------------------------------------------------------------- export
router.get(
  '/:ews_id/export',
  asyncHandler(async (req, res) => {
    const entry = req.ewsEntry;
    let sql = `SELECT * FROM ${entry.table}`;
    const params = [];
    if (entry.table === 'sensus') {
      sql += ' WHERE jenis_sensus = ?';
      params.push(entry.hpt_code);
    } else if (entry.table === 'agro_observation') {
      sql += ' WHERE ews_id = ?';
      params.push(req.params.ews_id);
    }
    // yieldMaking-style tables (yield_partenocarpi/water_management/bahan_organik/tbm_vegetatif)
    // and defisiensi_hara_temuan have no per-row EWS_ID/hpt discriminator column -- the whole
    // table IS the export for their EWS_ID(s) (WM-001+WM-002 share water_management; AGR-002+
    // AGR-003 share tbm_vegetatif -- see ewsRegistry.js comments). Exporting either EWS_ID under
    // those tables returns the same full table, which is correct, not a bug: there is nothing
    // finer-grained to filter by at the row level for these.
    if (req.query.from) { sql += (params.length ? ' AND' : ' WHERE') + ' tanggal >= ?'; params.push(req.query.from); }
    if (req.query.to) { sql += (params.length || req.query.from ? ' AND' : ' WHERE') + ' tanggal <= ?'; params.push(req.query.to); }
    sql += ' ORDER BY created_at DESC LIMIT 5000';
    const rows = db.prepare(sql).all(...params);

    const wb = XLSX.utils.book_new();
    const sheet = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([['(tidak ada data)']]);
    XLSX.utils.book_append_sheet(wb, sheet, 'Export');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="export_${req.params.ews_id}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

// -------------------------------------------------------------- helpers
function resolveBlok(blok_code) {
  if (!blok_code) return null;
  return db.prepare('SELECT * FROM blok WHERE code=?').get(String(blok_code).trim());
}

function validateRow(entry, row, idx) {
  const errors = [];
  const blok = resolveBlok(row.blok_code);
  if (!blok) errors.push(`baris ${idx}: blok_code tidak dikenal`);
  if (!row.tanggal) errors.push(`baris ${idx}: tanggal wajib diisi`);
  else if (Number.isNaN(Date.parse(row.tanggal))) errors.push(`baris ${idx}: format tanggal tidak valid`);
  for (const vf of entry.valueFields) {
    if (vf.required && (row[vf.field] === null || row[vf.field] === undefined || row[vf.field] === '')) {
      errors.push(`baris ${idx}: ${vf.field} wajib diisi`);
    }
    if (vf.type === 'number' && row[vf.field] !== null && row[vf.field] !== undefined && row[vf.field] !== '' && Number.isNaN(Number(row[vf.field]))) {
      errors.push(`baris ${idx}: ${vf.field} harus angka`);
    }
    if (vf.options && row[vf.field] && !vf.options.includes(String(row[vf.field]).toUpperCase())) {
      errors.push(`baris ${idx}: ${vf.field} harus salah satu dari ${vf.options.join('/')}`);
    }
  }
  return { errors, blok };
}

/** Classify + insert one row into a yieldMaking-style table (mirrors routes/yieldMaking.js's
 *  makeSubRouter exactly, driven by the registry entry instead of a route closure). */
function ingestYieldMakingStyleRow(entry, row, blok, ctx) {
  const afdeling_id = blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = afdeling ? afdeling.estate_id : null;
  const location_warning = checkContainmentByBlokId(blok.id, row.gps_lat, row.gps_lng) ? 1 : 0;

  let classified;
  try {
    const result = computeIndicatorResult(entry.hpt_code, row, blok, { context: entry.classifyContext || 'YIELD_MAKING', sourceType: 'IMPORT', user_id: ctx.user_id });
    classified = { kategori: result.kategori, ews_alert: result.alert_required ? 1 : 0, incident: result.engineResult.incident };
  } catch (e) {
    classified = { kategori: null, ews_alert: 0, incident: null, classify_error: e.message };
  }

  const server_id = uuidv4();
  const now = new Date().toISOString();
  const insertFields = entry.valueFields.map((f) => f.field);
  const cols = ['local_id', 'server_id', 'incident_id', 'user_id', 'device_id', 'estate_id', 'afdeling_id', 'blok_id', 'tanggal', ...insertFields, 'kategori', 'ews_alert', 'gps_lat', 'gps_lng', 'gps_accuracy', 'location_warning', 'foto_id', 'catatan', 'sync_status', 'sync_attempt', 'sync_error', 'source', 'created_at', 'updated_at'];
  const params = {
    local_id: null,
    server_id,
    incident_id: classified.incident ? classified.incident.id : null,
    user_id: ctx.user_id || null,
    device_id: null,
    estate_id,
    afdeling_id,
    blok_id: blok.id,
    tanggal: row.tanggal,
    kategori: classified.kategori,
    ews_alert: classified.ews_alert,
    gps_lat: row.gps_lat ?? null,
    gps_lng: row.gps_lng ?? null,
    gps_accuracy: row.gps_accuracy ?? null,
    location_warning,
    foto_id: null,
    catatan: row.catatan || null,
    sync_status: 'SYNCED',
    sync_attempt: 0,
    sync_error: null,
    source: 'EXCEL',
    created_at: now,
    updated_at: now,
  };
  for (const f of insertFields) params[f] = row[f] ?? (entry.fieldDefaults && f in entry.fieldDefaults ? entry.fieldDefaults[f] : null);

  const info = db.prepare(`INSERT INTO ${entry.table} (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`).run(params);
  const insertedRow = db.prepare(`SELECT * FROM ${entry.table} WHERE id=?`).get(info.lastInsertRowid);
  logAudit({ user_id: ctx.user_id || null, aktivitas: `IMPORT_EWS_${entry.hpt_code}`, after: insertedRow, device_source: 'EXCEL' });
  return insertedRow;
}

/** Insert one defisiensi_hara_temuan row (AGR-004) -- no auto classification, matches
 *  routes/defisiensiHara.js exactly (severity comes from the petugas, not a formula). */
function ingestDefisiensiHaraRow(row, blok, ctx) {
  const afdeling_id = blok.afdeling_id;
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(afdeling_id);
  const estate_id = afdeling ? afdeling.estate_id : null;
  const location_warning = checkContainmentByBlokId(blok.id, row.gps_lat, row.gps_lng) ? 1 : 0;
  const server_id = uuidv4();
  const info = db
    .prepare(
      `INSERT INTO defisiensi_hara_temuan (
        server_id, user_id, estate_id, afdeling_id, blok_id, tanggal, unsur_hara, temuan_lapangan, severity, status,
        gps_lat, gps_lng, gps_accuracy, location_warning, catatan, sync_status, sync_attempt, source
      ) VALUES (
        @server_id, @user_id, @estate_id, @afdeling_id, @blok_id, @tanggal, @unsur_hara, @temuan_lapangan, @severity, 'OPEN',
        @gps_lat, @gps_lng, @gps_accuracy, @location_warning, @catatan, 'SYNCED', 0, 'EXCEL'
      )`
    )
    .run({
      server_id,
      user_id: ctx.user_id || null,
      estate_id,
      afdeling_id,
      blok_id: blok.id,
      tanggal: row.tanggal,
      unsur_hara: row.unsur_hara || null,
      temuan_lapangan: row.temuan_lapangan || null,
      severity: row.severity || null,
      gps_lat: row.gps_lat ?? null,
      gps_lng: row.gps_lng ?? null,
      gps_accuracy: row.gps_accuracy ?? null,
      location_warning,
      catatan: row.catatan || null,
    });
  const insertedRow = db.prepare('SELECT * FROM defisiensi_hara_temuan WHERE id=?').get(info.lastInsertRowid);
  logAudit({ user_id: ctx.user_id || null, aktivitas: 'IMPORT_EWS_DEFISIENSI_HARA', after: insertedRow, device_source: 'EXCEL' });
  return insertedRow;
}

function commitRow(entry, ews_id, row, blok, ctx) {
  if (entry.table === 'sensus') {
    const hasil_json = {};
    for (const vf of entry.valueFields) hasil_json[vf.field] = row[vf.field];
    return ingestSensus({ blok_id: blok.id, jenis_sensus: entry.hpt_code, tanggal: row.tanggal, hasil_json, catatan: row.catatan, gps_lat: row.gps_lat, gps_lng: row.gps_lng, source: 'EXCEL' }, ctx).row;
  }
  if (entry.table === 'agro_observation') {
    const hpt = db.prepare('SELECT id FROM hpt WHERE code=?').get(entry.hpt_code);
    const payload = { blok_id: blok.id, hpt_id: hpt.id, ews_id, tanggal: row.tanggal, catatan: row.catatan, petugas: row.petugas, gps_lat: row.gps_lat, gps_lng: row.gps_lng, source: 'EXCEL' };
    for (const vf of entry.valueFields) payload[vf.field] = row[vf.field];
    return ingestAgroObservation(payload, ctx).row;
  }
  if (YIELD_MAKING_TABLES.has(entry.table)) {
    return ingestYieldMakingStyleRow(entry, row, blok, ctx);
  }
  if (entry.table === 'defisiensi_hara_temuan') {
    return ingestDefisiensiHaraRow(row, blok, ctx);
  }
  throw new Error(`Tabel tidak didukung oleh generic import: ${entry.table}`);
}

// -------------------------------------------------------------- preview
router.post(
  '/:ews_id/preview',
  requireRole(...WRITE_ROLES),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    const entry = req.ewsEntry;
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const validRows = [];
    const errorRows = [];
    rows.forEach((row, i) => {
      const idx = i + 2;
      const { errors } = validateRow(entry, row, idx);
      if (errors.length) errorRows.push({ row: idx, errors, data: row });
      else validRows.push(row);
    });

    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, `EWS_${req.params.ews_id}`, req.file.originalname, rows.length, validRows.length, errorRows.length, JSON.stringify(errorRows));

    res.json({
      data: {
        import_log_id: info.lastInsertRowid,
        total: rows.length,
        valid: validRows.length,
        error: errorRows.length,
        errors: errorRows.slice(0, 200),
        file_path: req.file.path,
      },
    });
  })
);

// -------------------------------------------------------------- commit
router.post(
  '/:ews_id/commit',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const entry = req.ewsEntry;
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true (no partial import tanpa konfirmasi eksplisit)' });
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    const wb = XLSX.readFile(file_path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    let committed = 0;
    const failures = [];
    rows.forEach((row, i) => {
      const idx = i + 2;
      const { errors, blok } = validateRow(entry, row, idx);
      if (errors.length) return; // skip invalid rows silently at commit time (already surfaced at preview)
      try {
        commitRow(entry, req.params.ews_id, row, blok, { user_id: req.user.id });
        committed++;
      } catch (e) {
        failures.push({ row: idx, error: e.message });
      }
    });

    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(committed, log.id);
    logAudit({ user_id: req.user.id, aktivitas: `IMPORT_EWS_TXN_${req.params.ews_id}`, after: { import_log_id: log.id, committed, failures }, device_source: 'EXCEL' });
    res.json({ data: { committed, failed: failures.length, failures } });
  })
);

module.exports = router;
