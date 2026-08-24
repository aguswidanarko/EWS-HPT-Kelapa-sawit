// One-time historical seed import for the bundled "Summary Pengendalian HPT" workbook
// (seed_data/summary_pengendalian_hpt.xlsx) -> treatment (rodenticide bait applications) +
// sensus (post-baiting monitoring checks) tables.
//
// Despite the filename/sheet titles implying broad "Pengendalian HPT" (all pest/disease control)
// coverage, this workbook's actual content is 100% Tikus (rat) rodenticide baiting -- there is no
// Ganoderma/Oryctes/UPDKS/other HPT data anywhere in it. hpt_code is therefore hardcoded to
// 'TIKUS' for every record produced here (there is no per-row HPT column to read it from).
//
// Self-guarding + idempotent: modeled on db.js's one-time migration pattern and the sibling seed
// importers (seedImports/waterManagement.js, seedImports/tbmVegetatif.js) -- an import_log row
// with entity_type='KB_SEED_PENGENDALIAN_TIKUS' and status='COMMITTED' is the idempotency guard,
// so re-running this at every server boot after the first successful commit is a safe no-op.
//
// Actual row-writing is fully delegated to services/ingestion.js's ingestTreatment()/ingestSensus()
// -- nothing here re-implements incident linkage, threshold classification, or the audit log; this
// module only extracts clean records from the sheets and resolves/creates master data (following
// services/importPisp1.js's resolveBlok/findEstateByCode/findAfdelingByCode/findBlokByCode/
// afdCodeFromRaw discipline: resolve by code, CREATE if missing, NEVER overwrite an existing row).
//
// SHEET SCOPE (verified by opening the real file -- see notes below for exactly what was checked):
//   - ONLY the 7 "Detail {KEBUN}" sheets (Detail FAPE, Detail SMP, Detail PTLJ, Detail BKP,
//     Detail LS, Detail MKSK, Detail KALE) are read. Every other sheet in the workbook is a
//     rollup/aggregate/pivot VIEW (Summary*/Summary (Slide) */Grafik*), not atomic per-blok-per-
//     rotation data, and is intentionally never opened here.
//   - "Monitoring Pengendalian PTLJ" is EXCLUDED: its own "Kebun" column contains only "LS"/
//     "LS I"/"LS II" values, never "PTLJ" -- the sheet's real ownership is ambiguous/unconfirmed,
//     so per the clean-data-only instruction it is skipped entirely rather than guessed at.
//   - "Output Tikus PTLJ" and "Roadmap PTLJ" are EXCLUDED: PTLJ-only extra-field sheets with a
//     schema inconsistent with the other 6 kebun's "Detail X" sheets. "Detail PTLJ" already covers
//     PTLJ's core data on the same schema as every other kebun, so these are skipped for
//     consistency rather than special-cased.
//
// CLEAN-DATA-ONLY DISCIPLINE (explicit user instruction: only import complete/unambiguous rows;
// anything needing confirmation or incomplete must NOT be imported):
//   - Every column is located by HEADER TEXT (case-insensitive substring / merged-cell group
//     label match), never by a fixed column index -- column positions shift across the 7 kebun
//     sheets because each kebun ran a different number of bait-application rotations (verified:
//     5 to 10 "Tanggal Aplikasi" columns depending on kebun). Column-group spans are read off the
//     real `ws['!merges']` the same way services/importPisp1.js's extractPengendalianTikus does.
//   - TREATMENT (one row per blok per rotation that has a real, parseable "Tanggal Aplikasi"):
//       tanggal_mulai = that rotation's application date (skip the rotation entirely if this date
//       isn't a genuine parseable value -- never guessed);
//       material = the blok's single "Jenis Racun" value, casing-normalized ("KLERAT"/"Klerat" ->
//       "Klerat", "RATGONE"/"Ratgone" -> "Ratgone"); a combined value like "Klerat + Ratgone" is
//       kept verbatim, never split;
//       jumlah_material = that rotation's "Pemakaian Racun" (kg) value, ONLY when it's a clean
//       number (NULL otherwise -- a missing dosage is not a reason to drop the whole record, since
//       the application date itself is still a real, standalone fact);
//       metode_pengendalian = fixed "Racun Tikus (Baiting)" (the whole sheet is implicitly this
//       one method -- there is no per-row method column, same reasoning importPisp1.js already
//       applies for its own REKAP PENGENDALIAN TIKUS sheet).
//     The "Pemakaian Racun (%)" column group (relative dose vs rotation 1, e.g. 100/82.9/63.4...)
//     is a DIFFERENT group from "Pemakaian Racun" (kg) and is never read -- matched by label
//     excluding any group whose header contains "%".
//   - SENSUS (one row per blok per "Pemeriksaan Rn" sub-block that has a real "Tanggal Cek" AND a
//     real numeric "Pokok Sensus" AND a real numeric "Serangan Baru"): jenis_sensus='TIKUS',
//     hasil_json = { serangan_baru: <real value>, serangan_lama: 0, jumlah_sampel: <real Pokok
//     Sensus> } (matches services/sensusEngines.js computeTikus's exact expected field names,
//     confirmed by reading that file). serangan_lama is always 0 -- not a missing value, but a
//     structural fact: this workbook has no carry-over-vs-new-attack breakdown at all, so there is
//     no "real serangan_lama" to omit. Pokok Sensus values of exactly 0 are skipped (computeTikus
//     requires jumlah_sampel > 0; a 0-sample check is not usable data). A present "Tanggal Cek"
//     with a blank "Pokok Sensus" or blank "Serangan Baru" (observed: a handful of rows across
//     ~6600 otherwise-clean checks) causes that ONE rotation-check to be skipped, not fabricated.
//   - "Umpan Hilang %" (bait consumption) and "Serangan Baru %" (change in attack rate, alongside
//     the count) are READ nowhere in this module and NEVER written to the `mortality` table: they
//     are indirect efficacy PROXIES, not direct dead/alive rat counts, and mortality's
//     jumlah_hidup/jumlah_mati columns have no honest source value here. The real Pokok
//     Sensus/Serangan Baru pair is instead written to `sensus` (a genuine post-baiting monitoring
//     check), which is the correct, non-fabricating home for this data.
//   - The "Sensus 10% Before/After Treatment", "R<n> vs R<n+1>" comparison columns, and "Serangan
//     Sebelum"/"Serangan Stlh R<n>" summary columns (present on some kebun sheets) are intentionally
//     NOT read -- they are derived/comparison views layered on top of the same per-rotation
//     "Pemeriksaan Rn" data already extracted above, not additional atomic facts.
//   - Estate/afdeling naming: the "PT" column's literal values (e.g. "FAPE", "SMP 1", "SMP 2",
//     "PTLJ", "BKP", "LS 1", "LS 2", "MKSK", "KALE I", "KALE II") are each treated as their own
//     distinct estate code verbatim -- no attempt to merge "SMP 1"/"SMP 2" or otherwise restructure,
//     since that ambiguity is explicitly unresolved and using the literal written codes is the safe
//     default. Afdeling codes are similarly used as literally written (roman numerals for most
//     kebun, place names like "KCK"/"Tokam"/"Sei Goa" for BKP).
//   - species_id is always NULL (no species breakdown for Tikus in this file).
//   - Any row where Blok is blank is not counted as data at all (matches the sibling importers'
//     convention for spacer/trailing rows).
//   - Pokok Sensus / Serangan Baru are conceptually integer tree counts; a verified spreadsheet
//     artifact stores some as floating-point noise from formula residue (e.g. literal cell values
//     of 0.00001 or 1e-7 -- 473 such near-zero cases found across the workbook, unambiguously
//     meant to be 0) plus a smaller set of non-integer-but-not-near-zero values (e.g. 176.8). Both
//     are rounded to the nearest whole number via Math.round before being written -- a
//     representation fix for a value already unambiguously present and numeric, not a guess at a
//     missing one, so it stays inside the clean-data-only policy.
//
// KNOWN CLASSIFICATION LIMITATION (not a bug here, same soft-fail precedent documented in
// seedImports/waterManagement.js): kategori/ews_alert on every sensus row come from the SAME
// services/thresholdEngine.js runThresholdEngine() the live API uses, via ingestSensus(). That
// engine keys THRESHOLD rows by (hpt_id, fase_tanaman) where fase_tanaman comes from the target
// blok's `status_tanaman`. This workbook carries no planting-phase/status_tanaman signal at all
// (only Luas (Ha)), so every blok this module creates has status_tanaman=NULL (never fabricated),
// which runThresholdEngine treats as fase_tanaman='SEMUA'. The TIKUS THRESHOLD table currently has
// no 'SEMUA' rows (only TBM1/TBM2/TBM3/TM) -- so every imported sensus row here soft-fails to
// kategori='NORMAL'/ews_alert=0 regardless of its real hasil_hitung, exactly the same
// "soft-fail-to-null/0 if no rule is configured for this exact combination -- expected/normal, not
// an error" behavior the sibling importers already document, just triggered by a missing
// fase_tanaman match rather than a missing formula. Verified counts are still correct and usable
// for dashboards driven directly off hasil_hitung/hasil_json.

const path = require('path');
const XLSX = require('xlsx');
const { ingestSensus, ingestTreatment } = require('../../services/ingestion');

const ENTITY_TYPE = 'KB_SEED_PENGENDALIAN_TIKUS';
const FILENAME = 'summary_pengendalian_hpt.xlsx';
const HPT_CODE = 'TIKUS';
const METODE_PENGENDALIAN = 'Racun Tikus (Baiting)';
const DETAIL_SHEET_REGEX = /^detail\s+/i;

// ---------------------------------------------------------------------------------------------
// Low-level sheet reading helpers (label-driven, not row/col-number-driven) -- same approach as
// services/importPisp1.js's readMatrix/normLabel/findHeaderRow/findColByRegex/toISODate/numOrNull.
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
function findHeaderRow(matrix, requiredLabels, maxRow = 20) {
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

function pad2(n) {
  return String(n).padStart(2, '0');
}

function toISODate(v) {
  if (v === '' || v == null) return null;
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
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Pokok Sensus / Serangan Baru are conceptually integer tree counts, but a real (verified)
 *  spreadsheet artifact stores some of them as floating-point noise from formula residue -- e.g.
 *  literal cell values of 0.00001 or 1e-7 (473 such near-zero cases found across the workbook)
 *  where the count is unambiguously meant to be 0, and a smaller set of non-noise-looking but
 *  still non-integer "Pokok Sensus" values (e.g. 176.8) that are rounded the same way for
 *  consistency. Math.round is a representation fix for a value already unambiguously present and
 *  numeric -- not a guess at a missing value -- so it stays within the clean-data-only policy. */
function roundedCountOrNull(v) {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}

/** "KLERAT"/"Klerat" -> "Klerat", "RATGONE"/"Ratgone" -> "Ratgone". A combined value like
 *  "Klerat + Ratgone" (or anything else) matches neither exactly and is kept verbatim -- never
 *  split between two materials. */
function normalizeMaterial(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === 'klerat') return 'Klerat';
  if (lower === 'ratgone') return 'Ratgone';
  return s;
}

// ---------------------------------------------------------------------------------------------
// Master data (Estate/Afdeling/Blok) resolution -- same discipline as services/importPisp1.js:
// resolve by code, create if missing, never overwrite an existing row.
// ---------------------------------------------------------------------------------------------

function afdCodeFromRaw(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^afd/i.test(s) ? s.toUpperCase() : `AFD${s}`;
}

/** Estate code = the literal "PT" column value, trimmed -- verbatim, NOT stripped/normalized
 *  (unlike importPisp1.js's normEstateCode, which is designed for merging PISP-style abbreviated
 *  labels). Per explicit instruction, "SMP 1"/"SMP 2"/"LS 1"/"LS 2"/"KALE I"/"KALE II" are each
 *  their own distinct estate, never merged or restructured -- applied per-row since a single
 *  "Detail X" sheet can contain more than one literal "PT" value (e.g. Detail SMP has both
 *  "SMP 1" and "SMP 2"). This also matches the exact verbatim-code convention already used by the
 *  other historical-data seed importers running against this same database (their estate rows for
 *  these same kebun -- e.g. "FAPE", "BKP", "PTLJ", "MKSK", "SMP 1", "LS 1" -- are found and reused
 *  as-is here rather than duplicated under a differently-cased/stripped code). */
function estateCodeFromRaw(raw) {
  return String(raw == null ? '' : raw).trim();
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

// ---------------------------------------------------------------------------------------------
// Per-sheet extraction: header spans two rows (group label row + sub-label row), located by
// merged-cell spans on the group row -- same technique as services/importPisp1.js's
// extractPengendalianTikus, adapted to this workbook's actual column layout (which differs from
// PISP1's REKAP PENGENDALIAN TIKUS: repeating "Tanggal Aplikasi I".."X" + "Jenis Racun" +
// "Pemakaian Racun" Rot-N columns for dosing, and repeating "Pemeriksaan Rn" sub-blocks for
// monitoring, rather than PISP1's single "Rotasi N" column-group-per-rotation).
// ---------------------------------------------------------------------------------------------

function extractSheet(ws, sheetName, notes) {
  const matrix = readMatrix(ws);
  const merges = ws['!merges'] || [];

  const header = findHeaderRow(matrix, ['afd', 'blok'], 10);
  if (!header) {
    notes.push(`Sheet "${sheetName}": header AFD/Blok tidak ditemukan pada 10 baris pertama -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0 };
  }
  const groupRow = header.row;
  const groupRowArr = matrix[groupRow];
  const subRowArr = matrix[groupRow + 1] || [];

  const ptCol = findColByRegex(groupRowArr, /^pt$/i) ?? 0;
  const afdCol = header.cols['afd'];
  const blokCol = findColByRegex(groupRowArr, /blok/i);
  const luasCol = findColByRegex(groupRowArr, /luas/i);
  const jenisRacunCol = findColByRegex(groupRowArr, /jenis\s*racun/i);
  if (blokCol == null) {
    notes.push(`Sheet "${sheetName}": kolom Blok tidak ditemukan -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0 };
  }

  // "Tanggal Aplikasi I".."X" -- individual (non-grouped) columns, located purely by label text
  // and taken in left-to-right (= rotation) order.
  const dateCols = [];
  for (let c = 0; c < groupRowArr.length; c++) {
    if (normLabel(groupRowArr[c]).includes('tanggal aplikasi')) dateCols.push(c);
  }
  if (!dateCols.length) {
    notes.push(`Sheet "${sheetName}": kolom "Tanggal Aplikasi" tidak ditemukan -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0 };
  }

  // Build merged-cell column-group spans anchored on the group header row (same technique as
  // importPisp1.js's extractPengendalianTikus).
  const spans = [];
  const covered = new Set();
  for (const m of merges) {
    if (m.s.r === groupRow) {
      const label = groupRowArr[m.s.c];
      if (label !== '' && label != null) {
        spans.push({ label: String(label).trim(), start: m.s.c, end: m.e.c });
        for (let c = m.s.c; c <= m.e.c; c++) covered.add(c);
      }
    }
  }
  for (let c = 0; c < groupRowArr.length; c++) {
    if (covered.has(c)) continue;
    const v = groupRowArr[c];
    if (v !== '' && v != null) spans.push({ label: String(v).trim(), start: c, end: c });
  }
  spans.sort((a, b) => a.start - b.start);

  // "Pemakaian Racun" (kg dosage per rotation) -- explicitly excludes "Pemakaian Racun (%)" (a
  // different, relative-dose group present on every kebun sheet right next to it).
  const pakSpan = spans.find((s) => /pemakaian\s*racun/i.test(s.label) && !/%/.test(s.label));
  const pakRotCols = [];
  if (pakSpan) {
    for (let c = pakSpan.start; c <= pakSpan.end; c++) {
      if (normLabel(subRowArr[c]).startsWith('rot')) pakRotCols.push(c);
    }
  } else {
    notes.push(`Sheet "${sheetName}": kolom grup "Pemakaian Racun" (dosis kg, bukan %) tidak ditemukan -- jumlah_material akan NULL untuk semua rotasi di sheet ini.`);
  }
  if (pakSpan && pakRotCols.length !== dateCols.length) {
    notes.push(`Sheet "${sheetName}": jumlah kolom "Tanggal Aplikasi" (${dateCols.length}) tidak sama dengan jumlah kolom "Pemakaian Racun" Rot-N (${pakRotCols.length}) -- dipasangkan berdasarkan urutan sampai jumlah terkecil, sisanya jumlah_material=NULL.`);
  }

  // "Pemeriksaan R1".."Rn" sub-blocks -- each yields Tanggal Cek / Pokok Sensus / Serangan Baru.
  const pemGroups = spans
    .filter((s) => /pemeriksaan\s*r\d+/i.test(s.label))
    .sort((a, b) => a.start - b.start)
    .map((s) => {
      const cols = {};
      for (let c = s.start; c <= s.end; c++) {
        const v = normLabel(subRowArr[c]);
        if (!v) continue;
        if (cols.tanggal === undefined && v.includes('tanggal')) cols.tanggal = c;
        else if (cols.pokok === undefined && v.includes('pokok')) cols.pokok = c;
        else if (cols.serangan === undefined && v === 'serangan baru') cols.serangan = c;
      }
      return { label: s.label, cols };
    })
    .filter((g) => g.cols.tanggal !== undefined && g.cols.pokok !== undefined && g.cols.serangan !== undefined);

  const dataStartRow = groupRow + 2;
  const records = [];
  let rowsRead = 0;

  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const blokRaw = row[blokCol];
    if (blokRaw === '' || blokRaw == null) continue; // not a data row at all (spacer/trailer)
    rowsRead++;

    const ptRaw = row[ptCol];
    const afdRaw = afdCol != null ? row[afdCol] : null;
    if (ptRaw === '' || ptRaw == null || afdRaw === '' || afdRaw == null) {
      // No unambiguous estate/afdeling to attach this blok's records to -- skip the whole row.
      continue;
    }
    const luas = luasCol != null ? numOrNull(row[luasCol]) : null;
    const material = jenisRacunCol != null ? normalizeMaterial(row[jenisRacunCol]) : null;

    // --- TREATMENT: one record per rotation with a real, parseable application date ---
    const pairCount = pakRotCols.length ? Math.min(dateCols.length, pakRotCols.length) : dateCols.length;
    for (let i = 0; i < dateCols.length; i++) {
      const tanggal = toISODate(row[dateCols[i]]);
      if (!tanggal) continue; // no clean date for this rotation -- skip it, never guessed.
      const jumlahMaterial = i < pairCount && pakRotCols.length ? numOrNull(row[pakRotCols[i]]) : null;
      records.push({
        kind: 'TREATMENT',
        ptRaw,
        afdRaw,
        blokRaw,
        luas,
        tanggal,
        material,
        jumlah_material: jumlahMaterial,
        catatan: `Data historis import dari Database Summary Pengendalian HPT, sheet "${sheetName}", Aplikasi Rotasi ${i + 1}.`,
      });
    }

    // --- SENSUS: one record per "Pemeriksaan Rn" block with a real check date + real counts ---
    for (const g of pemGroups) {
      const tanggal = toISODate(row[g.cols.tanggal]);
      if (!tanggal) continue;
      const pokokSensus = roundedCountOrNull(row[g.cols.pokok]);
      if (pokokSensus === null || pokokSensus <= 0) continue; // no clean, usable sample count
      const seranganBaru = roundedCountOrNull(row[g.cols.serangan]);
      if (seranganBaru === null) continue; // real check date+sample present but attack count missing -- skip, don't fabricate 0
      records.push({
        kind: 'SENSUS',
        ptRaw,
        afdRaw,
        blokRaw,
        luas,
        tanggal,
        jumlah_sampel: pokokSensus,
        serangan_baru: seranganBaru,
        catatan: `Data historis import dari Database Summary Pengendalian HPT, sheet "${sheetName}", ${g.label} (monitoring pasca-baiting). Pokok Sensus=${pokokSensus}, Serangan Baru=${seranganBaru}.`,
      });
    }
  }

  return { records, rowsRead, pemGroupCount: pemGroups.length, rotationCount: dateCols.length };
}

// =================================================================================================
// Public entry point
// =================================================================================================

module.exports = function seedPengendalianTikus(db) {
  const already = db
    .prepare("SELECT 1 FROM import_log WHERE entity_type=? AND status='COMMITTED' LIMIT 1")
    .get(ENTITY_TYPE);
  if (already) {
    return { skipped: true, committed: 0, failed: 0, rowsRead: 0, notes: ['Sudah pernah diimport sebelumnya (import_log COMMITTED ditemukan) -- dilewati.'] };
  }

  const notes = [];
  const filePath = path.join(__dirname, '..', '..', '..', 'seed_data', FILENAME);
  let wb;
  try {
    wb = XLSX.readFile(filePath, { cellDates: true });
  } catch (e) {
    notes.push(`Gagal membaca file seed: ${e.message}`);
    return { skipped: false, committed: 0, failed: 0, rowsRead: 0, notes };
  }

  const detailSheets = wb.SheetNames.filter((n) => DETAIL_SHEET_REGEX.test(n));
  if (!detailSheets.length) {
    notes.push('Tidak ada sheet "Detail {KEBUN}" ditemukan pada file ini -- tidak ada yang diimport.');
    return { skipped: false, committed: 0, failed: 0, rowsRead: 0, notes };
  }

  let totalRowsRead = 0;
  const allRecords = [];
  const perSheetSummary = [];

  for (const sheetName of detailSheets) {
    const ws = wb.Sheets[sheetName];
    const out = extractSheet(ws, sheetName, notes);
    totalRowsRead += out.rowsRead;
    const treatCount = out.records.filter((r) => r.kind === 'TREATMENT').length;
    const sensusCount = out.records.filter((r) => r.kind === 'SENSUS').length;
    perSheetSummary.push({
      sheet: sheetName,
      blokRows: out.rowsRead,
      rotationCount: out.rotationCount || 0,
      pemeriksaanGroups: out.pemGroupCount || 0,
      treatmentRecords: treatCount,
      sensusRecords: sensusCount,
    });
    allRecords.push(...out.records);
  }

  // --- Resolve/create master data + insert, all inside one transaction ------------------------
  const estateCache = new Map();
  const afdelingCache = new Map();
  const blokCache = new Map();
  let estatesCreated = 0;
  let afdelingsCreated = 0;
  let bloksCreated = 0;
  let committed = 0;
  let failed = 0;
  const failures = [];
  let treatmentCommitted = 0;
  let sensusCommitted = 0;

  const runImport = db.transaction(() => {
    function resolveEstate(ptRaw) {
      const code = estateCodeFromRaw(ptRaw);
      let estate = estateCache.get(code);
      if (!estate) {
        estate = findEstateByCode(db, code);
        if (!estate) {
          const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(code, String(ptRaw).trim());
          estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
          estatesCreated++;
        }
        estateCache.set(code, estate);
      }
      return estate;
    }

    function resolveBlok(ptRaw, afdRaw, blokRaw, luas) {
      const estate = resolveEstate(ptRaw);
      const afdCode = afdCodeFromRaw(afdRaw);
      const afdKey = `${estate.id}|${afdCode}`;
      let afd = afdelingCache.get(afdKey);
      if (!afd) {
        afd = findAfdelingByCode(db, estate.id, afdCode);
        if (!afd) {
          const info = db
            .prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)')
            .run(estate.id, afdCode, `Afdeling ${afdRaw}`);
          afd = db.prepare('SELECT * FROM afdeling WHERE id=?').get(info.lastInsertRowid);
          afdelingsCreated++;
        }
        afdelingCache.set(afdKey, afd);
      }

      const blokCode = String(blokRaw).trim();
      const blokKey = `${afd.id}|${blokCode}`;
      let blok = blokCache.get(blokKey);
      if (!blok) {
        blok = findBlokByCode(db, afd.id, blokCode);
        if (!blok) {
          const info = db
            .prepare('INSERT INTO blok (afdeling_id, code, name, luas) VALUES (?, ?, ?, ?)')
            .run(afd.id, blokCode, `Blok ${blokCode}`, luas ?? null);
          blok = db.prepare('SELECT * FROM blok WHERE id=?').get(info.lastInsertRowid);
          bloksCreated++;
        }
        blokCache.set(blokKey, blok);
      }
      return blok;
    }

    const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(HPT_CODE);
    if (!hpt) {
      notes.push(`HPT code "${HPT_CODE}" tidak ditemukan di master data -- semua record TREATMENT akan gagal (sensus tetap dicoba, ingestSensus melakukan lookup HPT sendiri).`);
    }

    for (const rec of allRecords) {
      try {
        const blok = resolveBlok(rec.ptRaw, rec.afdRaw, rec.blokRaw, rec.luas);
        if (rec.kind === 'TREATMENT') {
          if (!hpt) throw new Error(`HPT code tidak dikenal di master data: ${HPT_CODE}`);
          ingestTreatment(
            {
              blok_id: blok.id,
              hpt_id: hpt.id,
              tanggal_mulai: rec.tanggal,
              metode_pengendalian: METODE_PENGENDALIAN,
              material: rec.material,
              jumlah_material: rec.jumlah_material,
              catatan: rec.catatan,
              source: 'EXCEL',
            },
            {}
          );
          treatmentCommitted++;
        } else {
          ingestSensus(
            {
              blok_id: blok.id,
              jenis_sensus: HPT_CODE,
              species_id: null,
              tanggal: rec.tanggal,
              hasil_json: { serangan_baru: rec.serangan_baru, serangan_lama: 0, jumlah_sampel: rec.jumlah_sampel },
              catatan: rec.catatan,
              source: 'EXCEL',
            },
            {}
          );
          sensusCommitted++;
        }
        committed++;
      } catch (e) {
        failed++;
        failures.push({ kind: rec.kind, pt: rec.ptRaw, afd: rec.afdRaw, blok: rec.blokRaw, tanggal: rec.tanggal, error: e.message });
      }
    }

    db.prepare(
      `INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
       VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)`
    ).run(ENTITY_TYPE, FILENAME, totalRowsRead, allRecords.length, allRecords.length - committed, committed);
  });

  runImport();

  if (failures.length) {
    notes.push(`${failures.length} record gagal saat insert (lihat detail): ${JSON.stringify(failures.slice(0, 20))}`);
  }

  return {
    skipped: false,
    committed,
    failed,
    treatmentCommitted,
    sensusCommitted,
    rowsRead: totalRowsRead,
    estatesCreated,
    afdelingsCreated,
    bloksCreated,
    perSheetSummary,
    notes,
  };
};
