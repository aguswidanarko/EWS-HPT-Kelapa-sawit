// One-time historical seed importer for the bundled "PT Surya Intisari Raya - 1, Kebun Sei Lukut"
// water management workbook (seed_data/water_management_sirl_2026.xlsx) -> water_management table.
//
// Self-guarding / idempotent the same way db.js's one-time migrations are: an import_log row with
// entity_type=KB_SEED_WATER_MANAGEMENT and status=COMMITTED is the guard -- once present, a later
// call (e.g. every subsequent server boot) short-circuits to `{ skipped: true }` without touching
// the sheet or the database again.
//
// CLEAN-DATA-ONLY DISCIPLINE (explicit user instruction: only import complete/unambiguous rows;
// anything needing confirmation or incomplete must NOT be imported):
//   - Source is ONLY the two raw field-reading sheets "TGL 16" and "TGL 18". The master location
//     sheet (GPS in 5 inconsistent formats), the color-only roadmap sheet, the visual map sheet,
//     and the REKAPAN aggregate rollup are all intentionally NOT read here.
//   - Real observed structure (verified by opening the file, see notes below) differs in one
//     important way from a naive "per-row date column" assumption: each sheet carries a SINGLE
//     "TANGGAL PENGECEKAN" date value in its header block (not a per-row date column), and the
//     sheet's actual embedded date does NOT match what its name would suggest (sheet "TGL 16"
//     actually contains "18 AGUSTUS 2026"; sheet "TGL 18" actually contains "5 AGUSTUS 2026").
//     Per instruction to never infer the date from the sheet's name, this importer reads the real
//     date TEXT found inside each sheet's header and applies it to every row extracted from that
//     sheet. If that header date cannot be found/parsed, the ENTIRE sheet is skipped (logged in
//     `notes`) rather than guessing -- there is no finer-grained (per-row) date to fall back to.
//   - TINGGI AIR (CM) -> water_level_cm: only accepted when the cell is a genuine numeric cell.
//     A present-but-non-numeric value (e.g. a cell stored as text like "+25") causes that ROW to be
//     SKIPPED entirely (not coerced/stripped), because the semantics of such a value are unconfirmed.
//     A genuinely blank cell is not an anomaly -- it is left as water_level_cm=NULL and the row is
//     still imported (blok/afdeling/pintu-air/tanggal are still unambiguous).
//   - flooding is always left at the schema default 0 (no reliable per-row flooding signal exists
//     in the source); flooding_duration_hari is always NULL (not present in the source at all);
//     gps_lat/gps_lng/gps_accuracy are always NULL (the only GPS lives in the excluded, inconsistent
//     master sheet); location_warning is always 0 and the GIS containment check
//     (services/gisContainment.js checkContainmentByBlokId) is intentionally NOT called for this
//     import -- there is no reliable GPS to check against here.
//   - kategori/ews_alert are produced by the SAME classification call the live API uses
//     (services/ruleEngine.js computeIndicatorResult, via a tryClassify() copied verbatim from
//     routes/yieldMaking.js), soft-failing to null/0 if no WATER_MANAGEMENT formula is configured
//     yet -- that is expected/normal, not an error.
//
// Master data (estate/afdeling/blok) resolution mirrors services/importPisp1.js's
// resolveBlok/findEstateByCode/findAfdelingByCode/findBlokByCode/afdCodeFromRaw pattern: resolve by
// code, CREATE if missing, and NEVER overwrite an already-existing estate/afdeling/blok row. Those
// helpers are internal to importPisp1.js (not exported), so equivalent logic is reimplemented here
// against the shared `db` connection passed in by the caller.

const path = require('path');
const XLSX = require('xlsx');
const { computeIndicatorResult } = require('../../services/ruleEngine');

const ENTITY_TYPE = 'KB_SEED_WATER_MANAGEMENT';
const FILENAME = 'water_management_sirl_2026.xlsx';
const SOURCE_SHEETS = ['TGL 16', 'TGL 18'];

// ---------------------------------------------------------------------------------------------
// Low-level sheet reading helpers (label-driven, not row/col-number-driven) -- same approach as
// services/importPisp1.js's readMatrix/normLabel/findHeaderRow/findColByRegex.
// ---------------------------------------------------------------------------------------------

function readMatrix(ws) {
  if (!ws['!ref']) return [];
  const range = XLSX.utils.decode_range(ws['!ref']);
  const rows = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      row[c] = cell ? cell.v : '';
    }
    rows.push(row);
  }
  return rows;
}

function normLabel(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** Find the first row (within maxRow) that contains a cell for EVERY required label substring. */
function findHeaderRow(matrix, requiredLabels, maxRow = 30) {
  for (let r = 0; r < Math.min(maxRow, matrix.length); r++) {
    const row = matrix[r] || [];
    const colFor = {};
    for (let c = 0; c < row.length; c++) {
      const v = normLabel(row[c]);
      if (!v) continue;
      for (const label of requiredLabels) {
        if (colFor[label] === undefined && v.includes(label)) colFor[label] = c;
      }
    }
    if (requiredLabels.every((l) => colFor[l] !== undefined)) return { row: r, cols: colFor };
  }
  return null;
}

function findColByRegex(row, regex) {
  for (let c = 0; c < (row || []).length; c++) {
    const v = row[c];
    if (v !== '' && v != null && regex.test(String(v).trim())) return c;
  }
  return null;
}

const INDONESIAN_MONTHS = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
  agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Parses the sheet-level "TANGGAL PENGECEKAN: <d> <Indonesian month> <yyyy>" header value found
 *  inside the sheet itself into an ISO date string. Returns null if not found/unparseable -- the
 *  caller must then skip the whole sheet rather than guess (e.g. from the sheet's name). */
function findSheetCheckDate(matrix) {
  for (let r = 0; r < Math.min(15, matrix.length); r++) {
    const row = matrix[r] || [];
    for (let c = 0; c < row.length; c++) {
      if (normLabel(row[c]).includes('tanggal pengecekan')) {
        // Value lives in a later cell of the SAME row (merged label cell), scan the rest of the row.
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const raw = row[c2];
          if (raw === '' || raw == null) continue;
          const m = String(raw).match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
          if (m) {
            const day = parseInt(m[1], 10);
            const monthName = m[2].trim().toLowerCase();
            const year = parseInt(m[3], 10);
            const month = INDONESIAN_MONTHS[monthName];
            if (month && day >= 1 && day <= 31 && year > 2000) {
              return `${year}-${pad2(month)}-${pad2(day)}`;
            }
          }
        }
      }
    }
  }
  return null;
}

/** TINGGI AIR (CM): only accept a genuine numeric cell. Present-but-non-numeric (e.g. text "+25")
 *  is reported back to the caller as `ambiguous: true` so the whole row can be skipped -- a blank
 *  cell is `ambiguous: false, value: null` (a real, un-fabricated gap, row still importable). */
function readWaterLevelCell(ws, r, c) {
  const cell = ws[XLSX.utils.encode_cell({ r, c })];
  if (!cell || cell.v === '' || cell.v == null) return { ambiguous: false, value: null };
  if (cell.t === 'n' && typeof cell.v === 'number' && Number.isFinite(cell.v)) {
    return { ambiguous: false, value: cell.v };
  }
  return { ambiguous: true, value: null };
}

// ---------------------------------------------------------------------------------------------
// Per-sheet extraction: header row is "AFD" + "BLOK" (both present, row 8 in the real file),
// NOMOR PINTU AIR lives in that SAME header row, TINGGI AIR (CM) lives in the sub-header row right
// below it. Located by label text so the two sheets don't need identical column layouts.
// ---------------------------------------------------------------------------------------------

function extractSheet(ws, sheetName, notes) {
  const matrix = readMatrix(ws);

  const checkDate = findSheetCheckDate(matrix);
  if (!checkDate) {
    notes.push(`Sheet "${sheetName}": tanggal pengecekan (header) tidak ditemukan/tidak bisa diparse -- seluruh sheet dilewati (bukan tebakan dari nama sheet).`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }

  const header = findHeaderRow(matrix, ['afd', 'blok'], 20);
  if (!header) {
    notes.push(`Sheet "${sheetName}": header AFD/BLOK tidak ditemukan pada 20 baris pertama -- dilewati.`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }
  const headerRowArr = matrix[header.row];
  const afdCol = header.cols['afd'];
  const blokCol = header.cols['blok'];
  const pintuAirCol = findColByRegex(headerRowArr, /nomor\s*pintu\s*air/i);

  let waterLevelCol = null;
  let subHeaderRow = null;
  for (let r = header.row + 1; r <= header.row + 3 && r < matrix.length; r++) {
    const c = findColByRegex(matrix[r] || [], /tinggi\s*air/i);
    if (c != null) { waterLevelCol = c; subHeaderRow = r; break; }
  }
  if (waterLevelCol == null) {
    notes.push(`Sheet "${sheetName}": kolom TINGGI AIR (CM) tidak ditemukan -- dilewati.`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }

  const dataStartRow = (subHeaderRow != null ? subHeaderRow : header.row) + 1;
  const records = [];
  let rowsRead = 0;
  let rowsSkipped = 0;

  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const afdRaw = afdCol != null ? row[afdCol] : null;
    const blokRaw = blokCol != null ? row[blokCol] : null;
    const pintuAirRaw = pintuAirCol != null ? row[pintuAirCol] : null;
    // A fully blank row (common trailing/spacer rows) is not "data" at all -- don't count it.
    if ((afdRaw === '' || afdRaw == null) && (blokRaw === '' || blokRaw == null) && (pintuAirRaw === '' || pintuAirRaw == null)) {
      continue;
    }
    rowsRead++;

    if (afdRaw === '' || afdRaw == null || blokRaw === '' || blokRaw == null || pintuAirRaw === '' || pintuAirRaw == null) {
      rowsSkipped++;
      continue; // AFD/BLOK/pintu-air code blank -> ambiguous, skip row.
    }

    const wl = readWaterLevelCell(ws, r, waterLevelCol);
    if (wl.ambiguous) {
      rowsSkipped++; // e.g. "+25" stored as text -- semantics unconfirmed, skip rather than guess.
      continue;
    }

    records.push({
      afdRaw,
      blokRaw,
      titikParit: String(pintuAirRaw).trim(),
      tanggal: checkDate,
      waterLevelCm: wl.value,
      sheetName,
    });
  }

  return { records, rowsRead, rowsSkipped };
}

// ---------------------------------------------------------------------------------------------
// Master data (Estate/Afdeling/Blok) resolution -- same discipline as services/importPisp1.js:
// resolve by code, create if missing, never overwrite an existing row.
// ---------------------------------------------------------------------------------------------

// The workbook header text ("PT. SURYA INTISARI RAYA - 1") never abbreviates itself the way
// importPisp1's source files do (no "PISP\d+" token to key off), but the bundled seed file's own
// name already establishes the abbreviation this system uses for this company ("sirl"). Estate code
// is therefore built from that same abbreviation + the trailing "- <n>" company-unit number found
// verbatim in the sheet, e.g. "PT. SURYA INTISARI RAYA - 1" -> "SIRL1".
function detectEstateLabel(wb) {
  for (const sheetName of SOURCE_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= Math.min(range.e.r, 6); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'string') {
          const m = cell.v.match(/PT\.?\s*SURYA\s+INTISARI\s+RAYA\s*-?\s*(\d+)/i);
          if (m) return { label: cell.v.trim().replace(/\s+/g, ' '), code: `SIRL${m[1]}` };
        }
      }
    }
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

/** Tries to compute kategori/ews_alert via the generic rule engine for WATER_MANAGEMENT. Soft-fails
 *  (returns nulls) if no formula/threshold is configured yet for that indicator -- copied verbatim
 *  (same call shape) from routes/yieldMaking.js tryClassify() so historical rows classify exactly
 *  like a live API POST would. */
function tryClassify(payload, blok) {
  try {
    const result = computeIndicatorResult('WATER_MANAGEMENT', payload, blok, { context: 'YIELD_MAKING', sourceType: 'SENSUS' });
    return { kategori: result.kategori, ews_alert: result.alert_required ? 1 : 0 };
  } catch (e) {
    return { kategori: null, ews_alert: 0, classify_error: e.message };
  }
}

// =================================================================================================
// Public entry point
// =================================================================================================

module.exports = function seedWaterManagement(db) {
  const already = db
    .prepare("SELECT 1 FROM import_log WHERE entity_type=? AND status='COMMITTED' LIMIT 1")
    .get(ENTITY_TYPE);
  if (already) return { skipped: true };

  const notes = [];
  const filePath = path.join(__dirname, '..', '..', '..', 'seed_data', FILENAME);
  const wb = XLSX.readFile(filePath, { cellDates: true });

  const estateInfo = detectEstateLabel(wb) || { label: 'PT Surya Intisari Raya - 1', code: 'SIRL1' };
  if (!detectEstateLabel(wb)) {
    notes.push('Label estate tidak ditemukan secara eksplisit di sheet -- menggunakan fallback "PT Surya Intisari Raya - 1" / kode SIRL1.');
  }

  let totalRowsRead = 0;
  let totalRowsSkipped = 0;
  const allRecords = [];

  for (const sheetName of SOURCE_SHEETS) {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      notes.push(`Sheet "${sheetName}" tidak ditemukan pada file -- dilewati.`);
      continue;
    }
    const { records, rowsRead, rowsSkipped } = extractSheet(ws, sheetName, notes);
    totalRowsRead += rowsRead;
    totalRowsSkipped += rowsSkipped;
    allRecords.push(...records);
  }

  // --- Resolve/create master data + insert, all inside one transaction ---------------------------
  let estateCreated = false;
  let afdelingsCreated = 0;
  let bloksCreated = 0;
  const afdelingCache = new Map();
  const blokCache = new Map();
  const distinctAfdKeys = new Set();
  const distinctBlokKeys = new Set();
  let committed = 0;
  let failed = 0;
  const failures = [];

  const insertStmt = db.prepare(`
    INSERT INTO water_management (
      server_id, estate_id, afdeling_id, blok_id, titik_parit, tanggal, water_level_cm,
      flooding, flooding_duration_hari, kategori, ews_alert, gps_lat, gps_lng, gps_accuracy,
      location_warning, catatan, sync_status, sync_attempt, source
    ) VALUES (
      @server_id, @estate_id, @afdeling_id, @blok_id, @titik_parit, @tanggal, @water_level_cm,
      0, NULL, @kategori, @ews_alert, NULL, NULL, NULL,
      0, @catatan, 'SYNCED', 0, 'EXCEL'
    )
  `);

  const runImport = db.transaction(() => {
    let estate = findEstateByCode(db, estateInfo.code);
    if (!estate) {
      const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(estateInfo.code, estateInfo.label);
      estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
      estateCreated = true;
    }

    function resolveBlok(afdRaw, blokRaw) {
      const afdCode = afdCodeFromRaw(afdRaw);
      let afd = afdelingCache.get(afdCode);
      if (!afd) {
        afd = findAfdelingByCode(db, estate.id, afdCode);
        if (!afd) {
          const info = db
            .prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)')
            .run(estate.id, afdCode, `Afdeling ${afdRaw}`);
          afd = db.prepare('SELECT * FROM afdeling WHERE id=?').get(info.lastInsertRowid);
          afdelingsCreated++;
        }
        afdelingCache.set(afdCode, afd);
      }
      distinctAfdKeys.add(afdCode);

      const blokCode = String(blokRaw).trim();
      const key = `${afd.id}|${blokCode}`;
      let blok = blokCache.get(key);
      if (!blok) {
        blok = findBlokByCode(db, afd.id, blokCode);
        if (!blok) {
          const info = db
            .prepare('INSERT INTO blok (afdeling_id, code, name) VALUES (?, ?, ?)')
            .run(afd.id, blokCode, `Blok ${blokCode}`);
          blok = db.prepare('SELECT * FROM blok WHERE id=?').get(info.lastInsertRowid);
          bloksCreated++;
        }
        blokCache.set(key, blok);
      }
      distinctBlokKeys.add(`${afdCode}|${blokCode}`);
      return { blok, afdelingId: afd.id, estateId: estate.id };
    }

    let rowSeq = 0;
    for (const rec of allRecords) {
      rowSeq++;
      try {
        const { blok, afdelingId, estateId } = resolveBlok(rec.afdRaw, rec.blokRaw);

        const payload = {
          titik_parit: rec.titikParit,
          water_level_cm: rec.waterLevelCm,
          flooding: 0,
          flooding_duration_hari: null,
          blok_id: blok.id,
          tanggal: rec.tanggal,
        };
        const classified = tryClassify(payload, blok);

        const sheetTag = rec.sheetName.replace(/\s+/g, '');
        const params = {
          server_id: `WMSEED-${sheetTag}-R${rowSeq}`,
          estate_id: estateId,
          afdeling_id: afdelingId,
          blok_id: blok.id,
          titik_parit: rec.titikParit,
          tanggal: rec.tanggal,
          water_level_cm: rec.waterLevelCm,
          kategori: classified.kategori,
          ews_alert: classified.ews_alert,
          catatan: `Data historis import dari Database Water Management PT SIRL, sheet ${rec.sheetName}.`,
        };
        insertStmt.run(params);
        committed++;
      } catch (e) {
        failed++;
        failures.push({ afd: rec.afdRaw, blok: rec.blokRaw, titik_parit: rec.titikParit, error: e.message });
      }
    }

    db.prepare(`
      INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
      VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)
    `).run(ENTITY_TYPE, FILENAME, totalRowsRead, allRecords.length, totalRowsRead - allRecords.length + failed, committed);
  });

  runImport();

  if (failures.length) {
    notes.push(`${failures.length} baris gagal saat insert (lihat detail): ${JSON.stringify(failures.slice(0, 10))}`);
  }

  return {
    skipped: false,
    committed,
    failed,
    rowsRead: totalRowsRead,
    rowsSkippedAsAmbiguous: totalRowsSkipped,
    estate: { code: estateInfo.code, name: estateInfo.label, created: estateCreated },
    afdelingsCreated,
    bloksCreated,
    distinctAfdelingCount: distinctAfdKeys.size,
    distinctBlokCount: distinctBlokKeys.size,
    notes,
  };
};
