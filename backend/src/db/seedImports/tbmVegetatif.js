// One-time historical seed import for TBM Vegetatif (PT KTBM, Afdeling 3) from the bundled
// workbook seed_data/tbm_vegetatif_ktbm_afd3.xlsx.
//
// Self-guarding + idempotent: modeled on db.js's one-time migration pattern -- an import_log row
// with entity_type='KB_SEED_TBM_VEGETATIF' and status='COMMITTED' is the idempotency guard (same
// role as db.js's "WHERE status=..." predicate guards for migrateAlertStatusV2), so re-running
// this at every server boot after the first successful commit is a safe no-op.
//
// Master-data (estate/afdeling/blok) resolution/creation follows the exact discipline in
// services/importPisp1.js (resolveBlok / findEstateByCode / findAfdelingByCode / findBlokByCode /
// afdCodeFromRaw): create if missing, NEVER overwrite an existing row.
//
// Classification reuses routes/yieldMaking.js's tryClassify() (copied verbatim) so historical rows
// get the exact same kategori/ews_alert behavior real API-created rows would get -- including its
// soft-fail-to-null behavior when no formula is configured yet for TBM_VEGETATIF.
//
// CLEAN-DATA-ONLY POLICY (explicit user instruction: only import complete/unambiguous data; never
// fabricate or guess a value that isn't clearly present):
//   - tanggal (NOT NULL): each blok sheet's "BULAN TANAM" cell is checked for a genuine, parseable
//     Excel date. If a sheet has no real date anywhere (either missing entirely, or only a bare
//     month-name string with no year, e.g. "MARET"/"Juli"), the ENTIRE blok sheet is skipped --
//     no row from it is imported, and no year is ever guessed.
//   - Sheets I22 and I24 contain byte-for-byte identical measurement data (copy-paste artifact,
//     not two genuinely distinct datasets): only I22 is considered for import, I24 is always
//     skipped outright, regardless of its date status.
//   - Bloks J20 and J24: their own-sheet "UMUR TANAMAN" (age in months) conflicts with the Rekap
//     sheet's rollup value for that blok (J24's conflict is large and its measurement data is
//     identical to I19's -- probable template copy error). For these two bloks specifically,
//     umur_bulan is left NULL for every imported row (the frond-length/count measurements
//     themselves are not in question and are still imported). For every other imported blok,
//     umur_bulan comes from that blok's own sheet header (more granular than the Rekap rollup).
//   - jumlah_pelepah is only present in some sheets; when a sheet has no "jlh pelepah" column data
//     for a given sample point, jumlah_pelepah is NULL for that record (not a reason to skip it).
//   - lai, target_produksi_ton_ha, hasil_evaluasi, gps_lat/gps_lng/gps_accuracy are never present in
//     this workbook -- always left NULL, never fabricated.
//   - kategori/ews_alert are never set by hand here; they come only from tryClassify (may end up
//     null if no formula is configured for TBM_VEGETATIF yet -- that's an accepted soft-fail).

const path = require('path');
const XLSX = require('xlsx');
const { v4: uuidv4 } = require('uuid');
const { computeIndicatorResult } = require('../../services/ruleEngine');

const SEED_FILE = path.join(__dirname, '..', '..', '..', 'seed_data', 'tbm_vegetatif_ktbm_afd3.xlsx');
const ENTITY_TYPE = 'KB_SEED_TBM_VEGETATIF';
const FILENAME = 'tbm_vegetatif_ktbm_afd3.xlsx';

const ESTATE_CODE = 'KTBM';
const ESTATE_NAME = 'PT KTBM';

// All 12 per-blok sheets in the workbook (everything except "Rekap"). I24 is always skipped
// (duplicate of I22, see header note above) -- it stays in this list only so the module reports
// *why* it was skipped rather than silently ignoring it.
const BLOK_SHEETS = ['J18', 'J19', 'J20', 'J24', 'J25', 'I19', 'I20', 'I21', 'I22', 'I23', 'I24', 'H19'];
const DUPLICATE_SKIP_SHEETS = new Set(['I24']);
// Bloks whose own-sheet UMUR TANAMAN conflicts with the Rekap rollup (see header note) --
// umur_bulan is forced NULL for these even though real measurement data is still imported.
const AMBIGUOUS_AGE_BLOKS = new Set(['J20', 'J24']);

// Data-row layout (0-indexed columns) shared by every blok sheet: col A = BARIS (row number,
// numeric on real data rows, 'TOTAL'/'RATA2' text on trailing summary rows -- used as the
// data-row marker). Three side-by-side "TITIK SAMPEL" groups, each with PLP 3(CM) / Diameter
// bonggol / jlh pelepah.
const SAMPLE_GROUPS = [
  { plpCol: 1, jlhCol: 3 }, // TITIK SAMPEL 1: B / D
  { plpCol: 4, jlhCol: 6 }, // TITIK SAMPEL 2: E / G
  { plpCol: 7, jlhCol: 9 }, // TITIK SAMPEL 3: H / J
];

function readMatrix(ws) {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row[c] = cell ? cell.v : undefined;
    }
    rows.push(row);
  }
  return rows;
}

function cellVal(ws, addr) {
  const cell = ws[addr];
  return cell ? cell.v : undefined;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Returns a strict 'YYYY-MM-DD' only for a genuinely parseable date value (real Excel date
 *  serial/Date object, or an unambiguous YYYY-MM-DD-ish string). Bare month-name text (e.g.
 *  "Juli", "MARET") and empty cells both return null -- never guessed at. */
function toISODateStrict(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  if (typeof v === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(v);
      if (d && d.y) return `${d.y}-${pad2(d.m)}-${pad2(d.d)}`;
    } catch (e) {
      /* fall through */
    }
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Bare month names / anything else non-numeric is intentionally NOT parsed further --
    // a string like "MARET" or "Juli" carries no year and must not be guessed.
  }
  return null;
}

function afdCodeFromRaw(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^afd/i.test(s) ? s.toUpperCase() : `AFD${s}`;
}
function findEstateByCode(db, code) {
  return db.prepare('SELECT * FROM estate WHERE code=?').get(code);
}
function findAfdelingByCode(db, estate_id, code) {
  return db.prepare('SELECT * FROM afdeling WHERE estate_id=? AND code=?').get(estate_id, code);
}
function findBlokByCode(db, afdeling_id, code) {
  return db.prepare('SELECT * FROM blok WHERE afdeling_id=? AND code=?').get(afdeling_id, code);
}

/** Copied verbatim (module-level db/computeIndicatorResult only) from routes/yieldMaking.js's
 *  tryClassify -- soft-fails to nulls if no formula/threshold is configured yet for the
 *  indicator, so a missing Rule & Parameter Management setup never blocks the import. */
function tryClassify(db, hptCode, payload, blok, ctx) {
  try {
    const result = computeIndicatorResult(hptCode, payload, blok, { context: 'YIELD_MAKING', sourceType: 'SENSUS', user_id: ctx.user_id });
    return { kategori: result.kategori, ews_alert: result.alert_required ? 1 : 0, hasil: result.hasil, incident: result.engineResult.incident, alert: result.engineResult.alert, rule_version_id: result.rule_version_id };
  } catch (e) {
    return { kategori: null, ews_alert: 0, hasil: null, incident: null, alert: null, rule_version_id: null, classify_error: e.message };
  }
}

/** Extracts clean measurement records from one blok sheet, or a {skip: reason} descriptor if the
 *  whole sheet must be skipped. Pure -- no db access. */
function extractSheet(ws, sheetName) {
  if (DUPLICATE_SKIP_SHEETS.has(sheetName)) {
    return { skip: 'Duplikat byte-for-byte dari sheet I22 (artefak copy-paste) -- dilewati sesuai instruksi, tidak diimport sebagai data terpisah.' };
  }
  if (!ws || !ws['!ref']) {
    return { skip: 'Sheet tidak ditemukan atau kosong pada file ini.' };
  }

  const blokCodeRaw = cellVal(ws, 'C5');
  const blokCode = blokCodeRaw != null && String(blokCodeRaw).trim() ? String(blokCodeRaw).trim() : sheetName;
  const afdRaw = cellVal(ws, 'C4');
  const luas = numOrNull(cellVal(ws, 'C6'));
  const bulanTanamRaw = cellVal(ws, 'C7');
  const umurRaw = cellVal(ws, 'C8');

  const tanggal = toISODateStrict(bulanTanamRaw);
  if (!tanggal) {
    return {
      skip: `Tidak ada tanggal (BULAN TANAM) yang bisa dipastikan pada sheet ini -- nilai mentah: ${JSON.stringify(bulanTanamRaw)}. `
        + 'Ini adalah gap data asli (nama bulan tanpa tahun, atau kosong sama sekali); sheet dilewati seluruhnya daripada menebak tahun.',
    };
  }

  const umur_bulan = AMBIGUOUS_AGE_BLOKS.has(blokCode) ? null : numOrNull(umurRaw);

  const matrix = readMatrix(ws);
  const records = [];
  // Data rows start right after the "BARIS / TITIK SAMPEL n" + sub-header rows (row index 13,
  // 0-indexed -- Excel row 14, BARIS=10) and run until the first non-numeric BARIS cell
  // ('TOTAL'/'RATA2' summary rows).
  for (let r = 13; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const barisVal = row[0];
    if (typeof barisVal !== 'number') continue; // skips 'TOTAL'/'RATA2' rows and any blank trailer
    for (const g of SAMPLE_GROUPS) {
      const plp = numOrNull(row[g.plpCol]);
      if (plp === null) continue; // no clean panjang_pelepah_cm value for this sample point
      const jlh = numOrNull(row[g.jlhCol]);
      records.push({
        blokCode,
        afdRaw,
        tanggal,
        umur_bulan,
        panjang_pelepah_cm: plp,
        jumlah_pelepah: jlh, // null when this sheet has no "jlh pelepah" column data -- fine, per-field gap
        catatan: `Data historis import dari Database TBM Vegetatif PT KTBM Afd 3, sheet ${sheetName}.`,
      });
    }
  }

  return { blokCode, afdRaw, luas, plantingYear: tanggal ? Number(tanggal.slice(0, 4)) : null, records };
}

module.exports = function seedTbmVegetatif(db) {
  const already = db.prepare("SELECT 1 FROM import_log WHERE entity_type=? AND status='COMMITTED' LIMIT 1").get(ENTITY_TYPE);
  if (already) {
    return { skipped: true, committed: 0, failed: 0, rowsRead: 0, notes: ['Sudah pernah diimport sebelumnya (import_log COMMITTED ditemukan) -- dilewati.'] };
  }

  const notes = [];
  let wb;
  try {
    wb = XLSX.readFile(SEED_FILE, { cellDates: true });
  } catch (e) {
    notes.push(`Gagal membaca file seed: ${e.message}`);
    return { skipped: false, committed: 0, failed: 0, rowsRead: 0, notes };
  }

  const sheetExtracts = [];
  let rowsRead = 0;
  for (const sheetName of BLOK_SHEETS) {
    const ws = wb.Sheets[sheetName];
    const out = extractSheet(ws, sheetName);
    if (out.skip) {
      notes.push(`Sheet ${sheetName}: DILEWATI -- ${out.skip}`);
      sheetExtracts.push({ sheetName, skipped: true });
      continue;
    }
    rowsRead += out.records.length;
    notes.push(`Sheet ${sheetName}: ${out.records.length} pengukuran bersih diekstrak (umur_bulan=${out.umur_bulan == null ? 'NULL (ambigu, lihat catatan modul)' : out.umur_bulan}).`);
    sheetExtracts.push({ sheetName, skipped: false, ...out });
  }

  const usableSheets = sheetExtracts.filter((s) => !s.skipped && s.records.length > 0);

  // ---- Resolve/create master data (estate/afdeling/blok) -- never overwrite existing rows. ----
  let estate = findEstateByCode(db, ESTATE_CODE);
  if (!estate) {
    const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(ESTATE_CODE, ESTATE_NAME);
    estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
  }

  const afdelingCache = new Map();
  const blokCache = new Map();

  function resolveBlok(sheetOut) {
    const afdCode = afdCodeFromRaw(sheetOut.afdRaw);
    let afd = afdelingCache.get(afdCode);
    if (!afd) {
      afd = findAfdelingByCode(db, estate.id, afdCode);
      if (!afd) {
        const info = db.prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)').run(estate.id, afdCode, `Afdeling ${sheetOut.afdRaw}`);
        afd = db.prepare('SELECT * FROM afdeling WHERE id=?').get(info.lastInsertRowid);
      }
      afdelingCache.set(afdCode, afd);
    }
    const key = `${afd.id}|${sheetOut.blokCode}`;
    let blok = blokCache.get(key);
    if (!blok) {
      blok = findBlokByCode(db, afd.id, sheetOut.blokCode);
      if (!blok) {
        const info = db
          .prepare('INSERT INTO blok (afdeling_id, code, name, luas, tahun_tanam) VALUES (?, ?, ?, ?, ?)')
          .run(afd.id, sheetOut.blokCode, `Blok ${sheetOut.blokCode}`, sheetOut.luas ?? null, sheetOut.plantingYear ?? null);
        blok = db.prepare('SELECT * FROM blok WHERE id=?').get(info.lastInsertRowid);
      }
      blokCache.set(key, blok);
    }
    return blok;
  }

  let committed = 0;
  let failed = 0;
  const failures = [];
  const now = new Date().toISOString();

  const insertSql = `INSERT INTO tbm_vegetatif (
    local_id, server_id, incident_id, user_id, device_id,
    estate_id, afdeling_id, blok_id,
    tanggal, umur_bulan, panjang_pelepah_cm, jumlah_pelepah, lai, target_produksi_ton_ha, hasil_evaluasi, kategori,
    ews_alert, gps_lat, gps_lng, gps_accuracy, location_warning, foto_id, catatan,
    sync_status, sync_attempt, sync_error, source, created_at, updated_at
  ) VALUES (
    @local_id, @server_id, @incident_id, @user_id, @device_id,
    @estate_id, @afdeling_id, @blok_id,
    @tanggal, @umur_bulan, @panjang_pelepah_cm, @jumlah_pelepah, @lai, @target_produksi_ton_ha, @hasil_evaluasi, @kategori,
    @ews_alert, @gps_lat, @gps_lng, @gps_accuracy, @location_warning, @foto_id, @catatan,
    @sync_status, @sync_attempt, @sync_error, @source, @created_at, @updated_at
  )`;
  const insertStmt = db.prepare(insertSql);

  for (const sheetOut of usableSheets) {
    let blok;
    try {
      blok = resolveBlok(sheetOut);
    } catch (e) {
      failed += sheetOut.records.length;
      failures.push({ sheet: sheetOut.sheetName, error: `Blok tidak bisa diresolusi/dibuat: ${e.message}` });
      continue;
    }

    for (const rec of sheetOut.records) {
      try {
        const payload = {
          umur_bulan: rec.umur_bulan,
          panjang_pelepah_cm: rec.panjang_pelepah_cm,
          jumlah_pelepah: rec.jumlah_pelepah,
          lai: null,
          target_produksi_ton_ha: null,
          hasil_evaluasi: null,
        };
        const classified = tryClassify(db, 'TBM_VEGETATIF', payload, blok, { user_id: null });

        insertStmt.run({
          local_id: null,
          server_id: uuidv4(),
          incident_id: classified.incident ? classified.incident.id : null,
          user_id: null,
          device_id: null,
          estate_id: estate.id,
          afdeling_id: blok.afdeling_id,
          blok_id: blok.id,
          tanggal: rec.tanggal,
          umur_bulan: rec.umur_bulan,
          panjang_pelepah_cm: rec.panjang_pelepah_cm,
          jumlah_pelepah: rec.jumlah_pelepah,
          lai: null,
          target_produksi_ton_ha: null,
          hasil_evaluasi: null,
          kategori: classified.kategori,
          ews_alert: classified.ews_alert,
          gps_lat: null,
          gps_lng: null,
          gps_accuracy: null,
          location_warning: 0,
          foto_id: null,
          catatan: rec.catatan,
          sync_status: 'SYNCED',
          sync_attempt: 0,
          sync_error: null,
          source: 'EXCEL',
          created_at: now,
          updated_at: now,
        });
        committed++;
      } catch (e) {
        failed++;
        failures.push({ sheet: sheetOut.sheetName, blok: rec.blokCode, tanggal: rec.tanggal, error: e.message });
      }
    }
  }

  if (failures.length) {
    notes.push(`${failures.length} baris gagal diinsert (lihat detail): ${JSON.stringify(failures.slice(0, 20))}`);
  }

  db.prepare(
    `INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
     VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)`
  ).run(ENTITY_TYPE, FILENAME, rowsRead, committed, failed, committed);

  return { skipped: false, committed, failed, rowsRead, notes };
};
