// One-time historical seed importer for the bundled "PT Pancasurya Agrindo (Kebun Tambusai)" HPT
// workbook (seed_data/hpt_psa_2026.xlsx) -> sensus / treatment / mortality tables.
//
// Self-guarding + idempotent the same way db.js's one-time migrations / the sibling seed modules
// are: an import_log row with entity_type=KB_SEED_HPT_PSA and status=COMMITTED is the guard -- once
// present, a later call (e.g. every subsequent server boot) short-circuits to `{ skipped: true }`
// without touching the sheet or the database again.
//
// This module ONLY normalizes+extracts records and (on commit) resolves/creates master Estate/
// Afdeling/Blok rows. All classification/incident/alert logic is delegated to the EXISTING services
// -- nothing here re-implements thresholdEngine, sensusEngines or the mortality-effectiveness rule:
//   - services/ingestion.js  ingestSensus() / ingestTreatment() / ingestMortality()
// (ingestSensus itself calls services/sensusEngines.js computeByHptCode() and
// services/thresholdEngine.js runThresholdEngine(); ingestMortality calls its own
// evaluateEffectiveness() against the HPT's THRESHOLD table.)
//
// Master data (estate/afdeling/blok) resolution mirrors services/importPisp1.js's
// resolveBlok/findEstateByCode/findAfdelingByCode/findBlokByCode/afdCodeFromRaw discipline: resolve
// by code, CREATE if missing, and NEVER overwrite an already-existing estate/afdeling/blok row.
// Those helpers are internal to importPisp1.js (not exported), so equivalent logic -- along with the
// label-driven readMatrix/findHeaderRow/findColByRegex/monthColsFromRow reading helpers -- is
// reimplemented here against the shared `db` connection passed in by the caller, same as
// db/seedImports/waterManagement.js already does for its own sheet.
//
// ------------------------------------------------------------------------------------------------
// SHEETS ACTUALLY USED (verified by opening the real file -- see deviations from the original scan
// below where the real structure differed from what a same-template-family guess would predict):
//   1. "REKAP SNS UPDKS"  -- pivot: one row per Blok, one value column per month -> SENSUS UPDKS.
//   2. "REKAP SNS TIKUS"  -- same pivot shape (sparse, ~few of ~412 Blok filled) -> SENSUS TIKUS.
//   3. "KUMBANG"          -- *** DEVIATION ***: the task brief expected this sheet to be shaped like
//      importPisp1.js's side-by-side "BULAN <NAME> <YEAR>" SNSS ORYCTES columns. The REAL file
//      instead has "KUMBANG" laid out EXACTLY like REKAP SNS UPDKS/TIKUS above (Afdeling/Block/Jenis
//      Tanah/Ha/Tahun Tanam header, then one "Hasil Sensus Pokok Terserang Kumbang Tanduk" value
//      column per month) -- confirmed by the sheet's own legend row ("0,00 - 1,00" / "> 1 %"), i.e.
//      the monthly value IS already a percentage, not a raw terserang/diamati pair. There is a
//      SEPARATE sheet literally named "SNSS ORYCTES" in this workbook that DOES match importPisp1's
//      side-by-side shape, but every data cell on it is 0/blank (confirmed by scanning the whole
//      sheet for any non-zero numeric value outside its header) -- it carries no real sensus data
//      and is correctly excluded. So the SAME pivot-monthly extractor used for UPDKS/TIKUS is reused
//      for KUMBANG too, with an ORYCTES-specific hasil_json mapping -> SENSUS ORYCTES.
//   4. "REKAP PENGENDALIAN HAMA UPDKS" -- contains exactly ONE row with real Afd+Blok+Tgl
//      Sensus+Jenis Ulat identification (Afd 5, Blok I23, Setora nitens, Tgl Sensus 23-Juli-26):
//        - TREATMENT (hpt UPDKS): metode_pengendalian="Fogging" (the only one of the sheet's 3
//          method groups -- Fogging/Drone Sprayer/Kep Sprayer -- that actually has Kebutuhan Bahan
//          values on this row), material="Decis/ Kencis + Solar".
//        - MORTALITY follow-up: Tgl Mortalitas=30-Juli-26, sampel(Pelepah sample)=21,
//          jumlah_hidup=4, linked to the treatment row via treatment_id (so ingestMortality's own
//          effectiveness/threshold + incident-linking logic runs exactly as it would for a live
//          entry -- see MORTALITY DEVIATION note below).
//      *** DEVIATION (row scoping) ***: two OTHER rows on this same sheet (Excel rows 67/68, 0-indexed
//      66/67) also carry real Kebutuhan Bahan values (Luas/Tgl Sensus/Pelepah semple/dosages) but have
//      NO Afd/Blok cell filled in at all -- there is no way to attribute them to a Blok, so per the
//      "only complete/unambiguous data" instruction they are skipped entirely (not fabricated).
//      A separate "REKAP" (Afdeling-grouped rollup/Total) sub-table restates the same one real record
//      further down the same sheet (Excel row ~130, 0-indexed 129, keyed by a bare Afdeling NUMBER in
//      the Blok column instead of a real Blok code, with "Total" rows below it) -- this is a derived
//      aggregate, not new raw input (same class of table already excluded elsewhere in this org's
//      templates, see services/importPisp1.js's OUT_OF_SCOPE_NOTES for "Rekap ESTATE ..." sheets), so
//      the row-scan stops at the first fully-blank separator row and never reads into it.
//
// EXCLUDED (verified empty of real results, or out of schema scope, by opening the file):
//   "REKAP ESTATE UPDKS", "REKAP ESTATE TIKUS", "REKAP ESTATE ORYCTES" -- derived aggregate reports.
//   "REKAP PENGENDALIAN TIKUS" -- every data cell is blank/0 (blok list only, no real treatments).
//   "SNSS ORYCTES" -- every data cell is blank/0 (see KUMBANG deviation note above).
//   "SNSS RAYAP", "SNS GANODERMA" -- blok master list filled in but "TGL SENSUS"/result columns are
//     blank for every row -- no real sensus event recorded on either sheet.
//   "REKAP SNS KBH", "REKAP KBH", "SENSUS KBH" -- owl-box/beetle-trap biocontrol monitoring, not a
//     pest/disease with a matching table in this schema -- out of scope (same reasoning importPisp1.js
//     documents for its own KBH sheets).
//   "BENEFICIAL PLANT ", "REALISASI BENEFICIAL PLANT" -- beneficial-plant biocontrol realization,
//     same out-of-scope reasoning.
//
// MORTALITY DEVIATION: the task brief assumed no ingestion.js helper exists for mortality writes and
// asked for a hand-built INSERT. services/ingestion.js in fact already exports `ingestMortality()`
// (which computes hasil_efektivitas/service_required via its own evaluateEffectiveness() against the
// HPT threshold table, links the incident, and can raise a SERVICE_REQUIRED alert+notification -- the
// exact same path a live mobile/API mortality submission takes). Reusing it -- rather than writing a
// raw INSERT that would leave hasil_efektivitas hand-set to NULL and skip all of that -- keeps this
// one historical row classified identically to how the system classifies every other mortality
// reading, consistent with "call the existing ingestion helpers, don't reimplement their logic" for
// the sensus/treatment side of this same module. The row's own RAW facts (tanggal, sampel,
// jumlah_hidup, jumlah_mati) are exactly what's present on the sheet -- only the derived
// hasil_efektivitas classification comes from the shared engine instead of being left NULL.
//
// CLEAN-DATA-ONLY POLICY (explicit user instruction: only import complete/unambiguous rows; anything
// needing confirmation or incomplete is skipped, never fabricated/guessed):
//   - Pivot sheets (UPDKS/TIKUS/KUMBANG): an empty OR zero-valued month cell is treated as "not yet
//     sensused" and skipped (no synthetic zero-result record is created) -- same convention already
//     documented for these exact sheet shapes in services/importPisp1.js's ASSUMPTIONS (this file has
//     no separate marker distinguishing "sensused, result nil" from "not yet filled in").
//   - UPDKS/TIKUS/KUMBANG pivot sheets report only an AGGREGATE final value per Blok per month (not
//     raw per-sample counts). To reuse the existing formulas in services/sensusEngines.js without
//     duplicating their logic, each value is converted into a synthetic-but-mathematically-equivalent
//     input that reproduces the exact same computed result:
//       UPDKS:   { ulat_hidup_total: value, jumlah_pelepah_diamati: 1 }        (ekor/pelepah = value)
//       TIKUS:   { serangan_baru: value, serangan_lama: 0, jumlah_sampel: 100 } (% = value)
//       ORYCTES: { jumlah_pokok_terserang: value, jumlah_pokok_diamati: 100 }   (% = value)
//     (TIKUS's convention is copied verbatim from importPisp1.js; ORYCTES's is the same trick applied
//     to computeOryctes's identical terserang/diamati*100 formula, since KUMBANG's value column is
//     already a percentage -- confirmed against its own legend thresholds "0,00 - 1,00" / "> 1 %".)
//   - UPDKS sensus rows get species default code 'UA' ("Ulat Api lainnya"), same as importPisp1.js,
//     because this rekap is an aggregate with no per-species breakdown but UPDKS thresholds are keyed
//     per species group.
//   - REKAP PENGENDALIAN HAMA UPDKS: only a row with a real Afd, Blok, Tgl Sensus AND Jenis Ulat is
//     considered a candidate record; Kebutuhan Bahan material/jumlah_material is only ever taken from
//     values genuinely present in the sheet for the method group that actually has them (never
//     defaulted to a method with blank dosage cells). Because the one real record here has TWO
//     distinct materials (Decis/Kencis=4.6335, Solar=77.225) under its single active method
//     ("Fogging"), and the `treatment` table only has ONE jumlah_material number, jumlah_material is
//     left NULL rather than fabricating a combined/averaged figure that would misrepresent either
//     value -- both exact dosages are written out in full in `catatan` instead. tanggal_mulai is
//     taken from "Tgl Sensus" (the only genuine date directly associated with this Kebutuhan Bahan
//     calculation on the sheet -- there is no separate "tanggal aplikasi" column); this is documented
//     in the row's own catatan rather than silently assumed.
//   - Mortality follow-up is only attached when Tgl Mortalitas, Pelepah sample (sampel) AND Jumlah
//     Ulat Hidup are all genuinely present and the date is parseable; "Σ Ulat kantong Mati"
//     (jumlah_mati) is blank on the one real row here and is left NULL rather than backed into from
//     the sheet's own Mortalitas% figure.
//   - Afdeling for this file is a bare numeric code (e.g. 1..10) with no full name anywhere in the
//     workbook -- used verbatim as `AFD<n>` / "Afdeling <n>", same afdCodeFromRaw convention as every
//     other seed importer in this codebase, never inventing a fuller name.
//   - Estate/Afdeling/Blok rows that don't already exist are created from the ha/tahun_tanam facts
//     directly present in these sheets; a Blok that ALREADY EXISTS in master data is never
//     overwritten by this importer.

const path = require('path');
const XLSX = require('xlsx');
const { ingestSensus, ingestTreatment, ingestMortality } = require('../../services/ingestion');

const SEED_FILE = path.join(__dirname, '..', '..', '..', 'seed_data', 'hpt_psa_2026.xlsx');
const ENTITY_TYPE = 'KB_SEED_HPT_PSA';
const FILENAME = 'hpt_psa_2026.xlsx';

const ESTATE_CODE = 'PSA';
const ESTATE_NAME = 'PT Pancasurya Agrindo (Kebun Tambusai)';

const PIVOT_SHEETS = [
  { sheet: 'REKAP SNS UPDKS', hptCode: 'UPDKS' },
  { sheet: 'REKAP SNS TIKUS', hptCode: 'TIKUS' },
  { sheet: 'KUMBANG', hptCode: 'ORYCTES' },
];
const PENGENDALIAN_SHEET = 'REKAP PENGENDALIAN HAMA UPDKS';

// =================================================================================================
// Low-level sheet reading helpers (label-driven, not row/col-number-driven) -- adapted from
// services/importPisp1.js (readMatrix/normLabel/findHeaderRow/findColByRegex/monthColsFromRow/
// toISODate/numOrNull/afdCodeFromRaw/findEstateByCode/findAfdelingByCode/findBlokByCode). That
// module doesn't export these, so equivalent logic is reimplemented here (same approach already
// taken by db/seedImports/waterManagement.js for its own sheet).
// =================================================================================================

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

const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7,
  agu: 8, ags: 8, agt: 8, agus: 8, agustus: 8, aug: 8,
  sep: 9, sept: 9, september: 9,
  okt: 10, oktober: 10, oct: 10, october: 10,
  nov: 11, november: 11,
  des: 12, desember: 12, dec: 12, december: 12,
};
const MONTH_KEYS_SORTED = Object.keys(MONTH_MAP).sort((a, b) => b.length - a.length);

function monthNumFromLabel(label) {
  const s = String(label || '').trim().toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return null;
  for (const key of MONTH_KEYS_SORTED) {
    if (s.startsWith(key)) return MONTH_MAP[key];
  }
  return null;
}

function monthColsFromRow(row) {
  const out = {};
  for (let c = 0; c < (row || []).length; c++) {
    const v = row[c];
    if (v === '' || v == null) continue;
    const m = monthNumFromLabel(v);
    if (m && out[m] === undefined) out[m] = c;
  }
  return out;
}

function isEmptyOrZero(v) {
  if (v === '' || v == null) return true;
  const n = Number(v);
  if (Number.isNaN(n)) return true;
  return n === 0;
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Generic ISO-date parser (Excel date serial / Date object / 'YYYY-MM-DD...' string). */
function toISODate(v) {
  if (v === '' || v == null) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
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

/** "REKAP PENGENDALIAN HAMA UPDKS" stores its dates as literal text like "23-Juli-26" /
 *  "30-Juli-26" (day - Indonesian month name - 2-digit year), which toISODate() above does not
 *  parse. Returns null (never guesses) if the value isn't cleanly one of the couple of shapes
 *  actually seen in this workbook. */
function parseIndoShortDate(v) {
  if (v === '' || v == null) return null;
  const iso = toISODate(v);
  if (iso) return iso;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[-/]([A-Za-z]+)[-/](\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthNum = monthNumFromLabel(m[2]);
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    if (monthNum && day >= 1 && day <= 31 && year > 2000) return `${year}-${pad2(monthNum)}-${pad2(day)}`;
  }
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const day = parseInt(m2[1], 10);
    const month = parseInt(m2[2], 10);
    const year = parseInt(m2[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${year}-${pad2(month)}-${pad2(day)}`;
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

/** Merge ha/tahun_tanam facts about each (afd,blok) across ALL sheets, used ONLY when a Blok needs
 *  to be CREATED (never to overwrite an existing Blok row) -- same idea as importPisp1.js's
 *  buildBlokFacts. */
function buildBlokFacts(entries) {
  const facts = new Map();
  for (const e of entries) {
    if (e.afdRaw == null || e.blokRaw == null || e.afdRaw === '' || e.blokRaw === '') continue;
    const key = `${afdCodeFromRaw(e.afdRaw)}|${String(e.blokRaw).trim()}`;
    const cur = facts.get(key) || {};
    if (e.ha != null && cur.ha == null) cur.ha = e.ha;
    if (e.tahunTanam != null && cur.tahunTanam == null) cur.tahunTanam = e.tahunTanam;
    facts.set(key, cur);
  }
  return facts;
}

// =================================================================================================
// Per-sheet extractors -- pure functions, NO db access, return normalized "planned record" lists.
// =================================================================================================

function hasilJsonFor(hptCode, value) {
  if (hptCode === 'UPDKS') return { hasil_json: { ulat_hidup_total: value, jumlah_pelepah_diamati: 1 }, speciesCode: 'UA' };
  if (hptCode === 'TIKUS') return { hasil_json: { serangan_baru: value, serangan_lama: 0, jumlah_sampel: 100 }, speciesCode: null };
  if (hptCode === 'ORYCTES') return { hasil_json: { jumlah_pokok_terserang: value, jumlah_pokok_diamati: 100 }, speciesCode: null };
  throw new Error(`hasilJsonFor: hptCode tidak dikenal: ${hptCode}`);
}

/** REKAP SNS UPDKS / REKAP SNS TIKUS / KUMBANG: one row per Blok, one value column per month.
 *  Adapted from importPisp1.js's extractPivotMonthly -- structurally identical header/month-row
 *  layout on all three sheets in this real file (see KUMBANG deviation note in the header comment
 *  above for why ORYCTES uses this shape here instead of importPisp1's side-by-side SNSS ORYCTES
 *  format). */
function extractPivotMonthly(ws, hptCode, sheetLabel) {
  const matrix = readMatrix(ws);
  const header = findHeaderRow(matrix, ['afdeling', 'ha'], 20);
  if (!header) return { error: 'Header (Afdeling/.../Ha) tidak ditemukan pada 20 baris pertama sheet ini.' };
  const headerRowArr = matrix[header.row];
  const afdCol = header.cols['afdeling'];
  const haCol = header.cols['ha'];
  const blokCol = findColByRegex(headerRowArr, /^block$|^blok$/i) ?? findColByRegex(headerRowArr, /block|blok/i);
  if (blokCol == null) return { error: 'Kolom Block/Blok tidak ditemukan.' };
  const tahunTanamCol = findColByRegex(headerRowArr, /tahun\s*tanam|^tt$/i);
  const jenisTanahCol = findColByRegex(headerRowArr, /jenis\s*tanah/i);

  let monthRow = null;
  let monthCols = null;
  for (let r = header.row + 1; r <= header.row + 6 && r < matrix.length; r++) {
    const mc = monthColsFromRow(matrix[r] || []);
    if (Object.keys(mc).length >= 6) {
      monthRow = r;
      monthCols = mc;
      break;
    }
  }
  if (!monthRow) return { error: 'Baris header bulan (Jan..Des) tidak ditemukan.' };

  let year = null;
  for (let r = header.row; r <= monthRow; r++) {
    for (const v of matrix[r] || []) {
      const s = String(v == null ? '' : v);
      const m = s.match(/20\d{2}/);
      if (m) {
        const y = parseInt(m[0], 10);
        if (year === null || y > year) year = y;
      }
    }
  }
  if (!year) year = new Date().getFullYear();

  // KUMBANG carries a sheet-wide "Areal: TBM" declaration (row just above the header) -- a real,
  // directly-present fact applicable to every row on this sheet, used only as a creation-time
  // status_tanaman default for NEW bloks (never overwrites an existing blok).
  let sheetAreal = null;
  for (let r = 0; r < header.row; r++) {
    for (const v of matrix[r] || []) {
      if (typeof v === 'string' && /^areal$|^\s*:?\s*(tbm|tm)\b/i.test(v.trim())) {
        const m = String(v).match(/tbm\d*|tm\b/i);
        if (m) { sheetAreal = m[0].toUpperCase(); break; }
      }
    }
    if (sheetAreal) break;
  }

  const records = [];
  const errors = [];
  let rowsRead = 0;
  let rowsSkippedEmpty = 0;

  for (let r = monthRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const blokRaw = row[blokCol];
    if (blokRaw === '' || blokRaw == null) continue;
    rowsRead++;
    const ha = numOrNull(row[haCol]);
    const tahunTanam = tahunTanamCol != null ? numOrNull(row[tahunTanamCol]) : null;
    const jenisTanah = jenisTanahCol != null ? row[jenisTanahCol] : null;

    for (const [mnumStr, col] of Object.entries(monthCols)) {
      const mnum = Number(mnumStr);
      const raw = row[col];
      if (isEmptyOrZero(raw)) { rowsSkippedEmpty++; continue; }
      const value = Number(raw);
      try {
        const tanggal = `${year}-${pad2(mnum)}-01`;
        const { hasil_json, speciesCode } = hasilJsonFor(hptCode, value);
        records.push({
          kind: 'SENSUS',
          hptCode,
          afdRaw: row[afdCol],
          blokRaw,
          ha,
          tahunTanam,
          statusTanaman: sheetAreal,
          tanggal,
          hasil_json,
          speciesCode,
          catatan: `Import Seed HPT PSA (${sheetLabel}), bulan ${mnum}/${year}${jenisTanah ? `, jenis tanah ${jenisTanah}` : ''}. Nilai asli rekap: ${value}.`,
        });
      } catch (e) {
        errors.push({ blok: blokRaw, month: mnum, message: e.message });
      }
    }
  }

  return { records, rowsRead, rowsSkippedEmpty, errors };
}

/** REKAP PENGENDALIAN HAMA UPDKS: label+merge-driven extraction of the sheet's "Sensus Awal" /
 *  "Kebutuhan Bahan" (Fogging / Drone Sprayer / Kep Sprayer) / "Sensus Mortalitas" / "Mortalitas %"
 *  column groups. Only rows with a real Afd + Blok + Tgl Sensus + Jenis Ulat are candidate records
 *  (see CLEAN-DATA-ONLY POLICY note in the header comment); the scan stops at the sheet's first
 *  fully-blank row, which marks the end of raw per-blok data and the start of a derived "REKAP"
 *  rollup sub-table further down the same sheet. */
function extractPengendalianHamaUpdks(ws) {
  const matrix = readMatrix(ws);
  const merges = ws['!merges'] || [];
  const header = findHeaderRow(matrix, ['afd', 'blok'], 30);
  if (!header) return { error: 'Header Afd/Blok tidak ditemukan pada 30 baris pertama.' };
  const groupHeaderRow = header.row;
  const headerRowArr = matrix[groupHeaderRow];
  const afdCol = header.cols['afd'];
  const blokCol = findColByRegex(headerRowArr, /^blok$/i) ?? findColByRegex(headerRowArr, /blok/i);
  const thnTanamCol = findColByRegex(headerRowArr, /thn\s*tanam|tahun\s*tanam/i);
  const jmlhPkkCol = findColByRegex(headerRowArr, /jmlh\s*pkk|jumlah\s*pokok/i);
  const luasCol = findColByRegex(headerRowArr, /^luas$/i);
  if (blokCol == null) return { error: 'Kolom Blok tidak ditemukan.' };

  function spanFor(labelRegex) {
    for (const mm of merges) {
      if (mm.s.r === groupHeaderRow) {
        const label = String(headerRowArr[mm.s.c] || '');
        if (labelRegex.test(label)) return { start: mm.s.c, end: mm.e.c };
      }
    }
    const c = findColByRegex(headerRowArr, labelRegex);
    return c != null ? { start: c, end: c } : null;
  }
  const sensusAwalSpan = spanFor(/sensus\s*awal/i);
  const kebutuhanSpan = spanFor(/kebutuhan\s*bahan/i);
  const mortalitasSpan = spanFor(/sensus\s*mortalitas/i);
  const mortalitasPctSpan = spanFor(/mortalitas\s*%/i);
  if (!sensusAwalSpan) return { error: 'Group header "Sensus Awal" tidak ditemukan.' };
  if (!mortalitasSpan) return { error: 'Group header "Sensus Mortalitas" tidak ditemukan.' };

  let subRow = null;
  for (let r = groupHeaderRow + 1; r <= groupHeaderRow + 3 && r < matrix.length; r++) {
    if (findColByRegex(matrix[r] || [], /tgl\s*sensus/i) != null) { subRow = r; break; }
  }
  if (subRow == null) return { error: 'Sub-header "Tgl Sensus" tidak ditemukan.' };
  const subRowArr = matrix[subRow];

  function colInSpan(span, regex) {
    if (!span) return null;
    for (let c = span.start; c <= span.end; c++) {
      const v = subRowArr[c];
      if (v !== '' && v != null && regex.test(String(v).trim())) return c;
    }
    return null;
  }

  const tglSensusCol = colInSpan(sensusAwalSpan, /tgl\s*sensus/i);
  const jenisUlatCol = colInSpan(sensusAwalSpan, /jenis\s*ulat/i);
  const pelepahSampleAwalCol = colInSpan(sensusAwalSpan, /pelepah\s*se?mple/i);
  const ulatPelepahAwalCol = colInSpan(sensusAwalSpan, /ulat\s*\/\s*pelepah/i);
  const luasSensusCol = colInSpan(sensusAwalSpan, /^luas$/i);

  const tglMortalitasCol = colInSpan(mortalitasSpan, /tgl\s*mortalitas/i);
  const pelepahSampleMortCol = colInSpan(mortalitasSpan, /pelepah\s*sample/i);
  const jumlahUlatHidupCol = colInSpan(mortalitasSpan, /jumlah\s*ulat\s*hidup/i);
  const ulatKantongMatiCol = colInSpan(mortalitasSpan, /ulat\s*kantong\s*mati/i);
  const mortalitasPctCol = mortalitasPctSpan ? mortalitasPctSpan.start : null;

  // "Fogging" / "Drone Sprayer..." / "Kep Sprayer..." method sub-groups sit one row below the
  // group header, inside the "Kebutuhan Bahan" span (found via merges, not hard-coded columns).
  const methodHeaderRow = groupHeaderRow + 1;
  const methodSpans = [];
  if (kebutuhanSpan) {
    for (const mm of merges) {
      if (mm.s.r === methodHeaderRow && mm.s.c >= kebutuhanSpan.start && mm.e.c <= kebutuhanSpan.end) {
        const label = matrix[methodHeaderRow][mm.s.c];
        if (label !== '' && label != null) methodSpans.push({ label: String(label).trim(), start: mm.s.c, end: mm.e.c });
      }
    }
  }
  for (const span of methodSpans) {
    span.materials = [];
    for (let c = span.start; c <= span.end; c++) {
      const name = subRowArr[c];
      if (name !== '' && name != null) span.materials.push({ col: c, name: String(name).trim() });
    }
  }

  const dataStartRow = subRow + 2; // skip the "Kecil/Sedang/Besar/Total" + per-unit-dosage sub-sub-header row
  const records = [];
  const skipped = [];
  let rowsRead = 0;

  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const rowHasAny = row.some((v) => v !== '' && v != null);
    if (!rowHasAny) break; // first fully-blank row -> end of raw data zone (REKAP rollup begins after this)

    const afdRaw = afdCol != null ? row[afdCol] : null;
    const blokRaw = blokCol != null ? row[blokCol] : null;
    const tglSensusRaw = tglSensusCol != null ? row[tglSensusCol] : null;
    const jenisUlatRaw = jenisUlatCol != null ? row[jenisUlatCol] : null;
    const hasCoreFields = afdRaw !== '' && afdRaw != null && blokRaw !== '' && blokRaw != null
      && tglSensusRaw !== '' && tglSensusRaw != null && jenisUlatRaw !== '' && jenisUlatRaw != null;
    if (!hasCoreFields) continue; // no real sensus event on this row, or Afd/Blok not identifiable -- skip, don't guess

    const tglSensus = parseIndoShortDate(tglSensusRaw);
    if (!tglSensus) {
      skipped.push({ row: r, reason: `Tgl Sensus tidak bisa diparse: ${JSON.stringify(tglSensusRaw)}` });
      continue;
    }
    rowsRead++;

    const activeMethods = methodSpans
      .map((span) => ({
        label: span.label,
        values: span.materials.map((m) => ({ ...m, value: numOrNull(row[m.col]) })).filter((m) => m.value !== null),
      }))
      .filter((span) => span.values.length > 0);

    let metode = null;
    let materialText = null;
    let materialDetailNote = 'Tidak ada nilai Kebutuhan Bahan pada baris ini.';
    if (activeMethods.length >= 1) {
      metode = activeMethods.map((s) => s.label).join(' + ');
      materialText = activeMethods.map((s) => s.values.map((m) => m.name).join(' + ')).join(' + ');
      materialDetailNote = `Kebutuhan Bahan (${metode}): ${activeMethods
        .map((s) => s.values.map((m) => `${m.name}=${m.value}`).join(', '))
        .join('; ')}.`;
    }

    const luas = luasSensusCol != null ? numOrNull(row[luasSensusCol]) : (luasCol != null ? numOrNull(row[luasCol]) : null);
    const jmlhPkk = jmlhPkkCol != null ? numOrNull(row[jmlhPkkCol]) : null;
    const tahunTanam = thnTanamCol != null ? numOrNull(row[thnTanamCol]) : null;
    const pelepahSampleAwal = pelepahSampleAwalCol != null ? numOrNull(row[pelepahSampleAwalCol]) : null;
    const ulatPelepahAwal = ulatPelepahAwalCol != null ? numOrNull(row[ulatPelepahAwalCol]) : null;

    const treatment = {
      afdRaw,
      blokRaw,
      ha: luas,
      tahunTanam,
      jumlahPokok: jmlhPkk,
      tanggal: tglSensus,
      metode,
      material: materialText,
      catatan: `Import Seed HPT PSA (REKAP PENGENDALIAN HAMA UPDKS). Tgl Sensus=${tglSensus}, Jenis Ulat=${jenisUlatRaw}`
        + (pelepahSampleAwal != null ? `, Pelepah sample=${pelepahSampleAwal}` : '')
        + (ulatPelepahAwal != null ? `, Ulat/Pelepah (sensus awal)=${ulatPelepahAwal}` : '')
        + `. ${materialDetailNote} Tanggal diambil dari Tgl Sensus (tidak ada kolom tanggal aplikasi terpisah pada sheet ini).`,
    };

    let mortality = null;
    const tglMortalitasRaw = tglMortalitasCol != null ? row[tglMortalitasCol] : null;
    const sampelMort = pelepahSampleMortCol != null ? numOrNull(row[pelepahSampleMortCol]) : null;
    const jumlahHidup = jumlahUlatHidupCol != null ? numOrNull(row[jumlahUlatHidupCol]) : null;
    if (tglMortalitasRaw != null && tglMortalitasRaw !== '' && sampelMort !== null && jumlahHidup !== null) {
      const tglMortalitas = parseIndoShortDate(tglMortalitasRaw);
      if (tglMortalitas) {
        const jumlahMati = ulatKantongMatiCol != null ? numOrNull(row[ulatKantongMatiCol]) : null;
        mortality = { tanggal: tglMortalitas, sampel: sampelMort, jumlah_hidup: jumlahHidup, jumlah_mati: jumlahMati };
      } else {
        skipped.push({ row: r, reason: `Tgl Mortalitas tidak bisa diparse: ${JSON.stringify(tglMortalitasRaw)} -- mortalitas dilewati, treatment tetap diimport.` });
      }
    }

    records.push({
      treatment,
      mortality,
      mortalitasPctSheet: mortalitasPctCol != null ? numOrNull(row[mortalitasPctCol]) : null,
    });
  }

  return { records, rowsRead, skipped };
}

// =================================================================================================
// Public entry point
// =================================================================================================

module.exports = function seedHptPsa(db) {
  const already = db
    .prepare("SELECT 1 FROM import_log WHERE entity_type=? AND status='COMMITTED' LIMIT 1")
    .get(ENTITY_TYPE);
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

  let rowsRead = 0;
  const pivotOut = {};
  for (const { sheet, hptCode } of PIVOT_SHEETS) {
    const ws = wb.Sheets[sheet];
    if (!ws) {
      notes.push(`Sheet "${sheet}" tidak ditemukan pada file ini -- dilewati.`);
      pivotOut[hptCode] = { records: [] };
      continue;
    }
    const out = extractPivotMonthly(ws, hptCode, sheet);
    if (out.error) {
      notes.push(`Sheet "${sheet}": ${out.error}`);
      pivotOut[hptCode] = { records: [] };
      continue;
    }
    rowsRead += out.rowsRead;
    notes.push(
      `Sheet "${sheet}": ${out.rowsRead} baris Blok dibaca, ${out.records.length} pembacaan bulanan bersih diekstrak `
      + `(${out.rowsSkippedEmpty} sel kosong/nol dilewati sebagai "belum disensus")${out.errors.length ? `, ${out.errors.length} error` : ''}.`
    );
    pivotOut[hptCode] = out;
  }

  const pengWs = wb.Sheets[PENGENDALIAN_SHEET];
  let pengOut = { records: [], rowsRead: 0, skipped: [] };
  if (!pengWs) {
    notes.push(`Sheet "${PENGENDALIAN_SHEET}" tidak ditemukan pada file ini -- dilewati.`);
  } else {
    const out = extractPengendalianHamaUpdks(pengWs);
    if (out.error) {
      notes.push(`Sheet "${PENGENDALIAN_SHEET}": ${out.error}`);
    } else {
      pengOut = out;
      rowsRead += out.rowsRead;
      notes.push(
        `Sheet "${PENGENDALIAN_SHEET}": ${out.rowsRead} baris dengan Afd/Blok/Tgl Sensus/Jenis Ulat lengkap ditemukan, `
        + `${out.records.length} record treatment valid diekstrak (${out.records.filter((r) => r.mortality).length} disertai follow-up mortalitas).`
      );
      if (out.skipped.length) {
        notes.push(`Sheet "${PENGENDALIAN_SHEET}": ${out.skipped.length} baris/field dilewati: ${JSON.stringify(out.skipped)}`);
      }
    }
  }

  const factsSource = [];
  for (const hptCode of Object.keys(pivotOut)) {
    for (const rec of pivotOut[hptCode].records || []) factsSource.push(rec);
  }
  for (const rec of pengOut.records) {
    factsSource.push({ afdRaw: rec.treatment.afdRaw, blokRaw: rec.treatment.blokRaw, ha: rec.treatment.ha, tahunTanam: rec.treatment.tahunTanam });
  }
  const blokFacts = buildBlokFacts(factsSource);

  let committed = 0;
  let failed = 0;
  let mortalityCommitted = 0;
  const failures = [];
  const sheetResults = {};
  let estateCreated = false;
  let afdelingsCreated = 0;
  let bloksCreated = 0;

  const runImport = db.transaction(() => {
    let estate = findEstateByCode(db, ESTATE_CODE);
    if (!estate) {
      const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(ESTATE_CODE, ESTATE_NAME);
      estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
      estateCreated = true;
    }

    const afdelingCache = new Map();
    const blokCache = new Map();
    function resolveBlok(afdRaw, blokRaw) {
      const afdCode = afdCodeFromRaw(afdRaw);
      let afd = afdelingCache.get(afdCode);
      if (!afd) {
        afd = findAfdelingByCode(db, estate.id, afdCode);
        if (!afd) {
          const info = db.prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)').run(estate.id, afdCode, `Afdeling ${afdRaw}`);
          afd = db.prepare('SELECT * FROM afdeling WHERE id=?').get(info.lastInsertRowid);
          afdelingsCreated++;
        }
        afdelingCache.set(afdCode, afd);
      }
      const blokCode = String(blokRaw).trim();
      const key = `${afd.id}|${blokCode}`;
      let blok = blokCache.get(key);
      if (!blok) {
        blok = findBlokByCode(db, afd.id, blokCode);
        if (!blok) {
          const facts = blokFacts.get(`${afdCode}|${blokCode}`) || {};
          const info = db
            .prepare('INSERT INTO blok (afdeling_id, code, name, luas, tahun_tanam) VALUES (?, ?, ?, ?, ?)')
            .run(afd.id, blokCode, `Blok ${blokCode}`, facts.ha ?? null, facts.tahunTanam ?? null);
          blok = db.prepare('SELECT * FROM blok WHERE id=?').get(info.lastInsertRowid);
          bloksCreated++;
        }
        blokCache.set(key, blok);
      }
      return blok;
    }

    const hptCache = {};
    function getHpt(code) {
      if (!(code in hptCache)) hptCache[code] = db.prepare('SELECT * FROM hpt WHERE code=?').get(code) || null;
      return hptCache[code];
    }
    function getSpecies(hpt_id, code) {
      return db.prepare('SELECT * FROM species WHERE hpt_id=? AND code=?').get(hpt_id, code);
    }

    for (const { sheet, hptCode } of PIVOT_SHEETS) {
      const recs = (pivotOut[hptCode] && pivotOut[hptCode].records) || [];
      let sheetCommitted = 0;
      let sheetFailed = 0;
      for (const rec of recs) {
        try {
          const hpt = getHpt(hptCode);
          if (!hpt) throw new Error(`HPT code tidak dikenal di master data: ${hptCode}`);
          const blok = resolveBlok(rec.afdRaw, rec.blokRaw);
          let species_id = null;
          if (rec.speciesCode) {
            const sp = getSpecies(hpt.id, rec.speciesCode);
            species_id = sp ? sp.id : null;
          }
          ingestSensus(
            { blok_id: blok.id, jenis_sensus: hptCode, species_id, tanggal: rec.tanggal, hasil_json: rec.hasil_json, catatan: rec.catatan, source: 'EXCEL' },
            {}
          );
          sheetCommitted++;
          committed++;
        } catch (e) {
          sheetFailed++;
          failed++;
          failures.push({ sheet, blok: rec.blokRaw, tanggal: rec.tanggal, error: e.message });
        }
      }
      sheetResults[sheet] = { committed: sheetCommitted, failed: sheetFailed };
    }

    let pengCommitted = 0;
    let pengFailed = 0;
    for (const rec of pengOut.records) {
      try {
        const hpt = getHpt('UPDKS');
        if (!hpt) throw new Error('HPT code tidak dikenal di master data: UPDKS');
        const blok = resolveBlok(rec.treatment.afdRaw, rec.treatment.blokRaw);
        const { row: treatmentRow } = ingestTreatment(
          {
            blok_id: blok.id,
            hpt_id: hpt.id,
            luas_serangan: rec.treatment.ha,
            metode_pengendalian: rec.treatment.metode,
            tanggal_mulai: rec.treatment.tanggal,
            jumlah_pokok: rec.treatment.jumlahPokok,
            material: rec.treatment.material,
            jumlah_material: null, // see MORTALITY/material-ambiguity note in the header comment above
            catatan: rec.treatment.catatan,
            source: 'EXCEL',
          },
          {}
        );
        pengCommitted++;
        committed++;

        if (rec.mortality) {
          try {
            ingestMortality(
              {
                tanggal: rec.mortality.tanggal,
                blok: String(rec.treatment.blokRaw),
                blok_id: blok.id,
                treatment_id: treatmentRow.id,
                sampel: rec.mortality.sampel,
                jumlah_hidup: rec.mortality.jumlah_hidup,
                jumlah_mati: rec.mortality.jumlah_mati,
                source: 'EXCEL',
              },
              {}
            );
            mortalityCommitted++;
            committed++;
          } catch (e) {
            failed++;
            failures.push({ sheet: PENGENDALIAN_SHEET, type: 'MORTALITY', blok: rec.treatment.blokRaw, error: e.message });
          }
        }
      } catch (e) {
        pengFailed++;
        failed++;
        failures.push({ sheet: PENGENDALIAN_SHEET, type: 'TREATMENT', blok: rec.treatment.blokRaw, error: e.message });
      }
    }
    sheetResults[PENGENDALIAN_SHEET] = { committed: pengCommitted, failed: pengFailed, mortalityCommitted };

    db.prepare(
      `INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
       VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)`
    ).run(ENTITY_TYPE, FILENAME, rowsRead, committed, failed, committed);
  });

  runImport();

  if (failures.length) {
    notes.push(`${failures.length} baris gagal saat insert (lihat detail): ${JSON.stringify(failures.slice(0, 20))}`);
  }

  return {
    skipped: false,
    committed,
    failed,
    rowsRead,
    mortalityCommitted,
    estate: { code: ESTATE_CODE, name: ESTATE_NAME, created: estateCreated },
    afdelingsCreated,
    bloksCreated,
    sheetResults,
    notes,
  };
};
