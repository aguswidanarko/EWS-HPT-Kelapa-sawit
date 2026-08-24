// One-time historical seed import for the "Sensus & Deteksi Tikus FR Kalbar" workbook
// (seed_data/sensus_deteksi_tikus_fr_kalbar.xlsx) -> sensus + detection tables, jenis/hpt = TIKUS.
//
// Self-guarding + idempotent, same pattern as the other KB_SEED_* importers in this directory: an
// import_log row with entity_type='KB_SEED_SENSUS_TIKUS_KALBAR' and status='COMMITTED' is the guard.
//
// Unlike waterManagement.js/tbmVegetatif.js (which insert directly), this importer reuses the EXACT
// same shared ingestion pipeline the live app uses -- services/ingestion.js ingestSensus()/
// ingestDetection() -- so threshold classification (services/sensusEngines.js computeByHptCode /
// services/thresholdEngine.js runThresholdEngine), incident/alert creation and the audit log all
// happen exactly like a real API-created row would. Nothing here re-implements that logic. Master
// data (estate/afdeling/blok) resolution follows the same "resolve by code, CREATE if missing, NEVER
// overwrite an existing row" discipline as services/importPisp1.js's resolveBlok/findEstateByCode/
// findAfdelingByCode/findBlokByCode/afdCodeFromRaw (reimplemented here against the passed-in `db`,
// same as waterManagement.js/tbmVegetatif.js do, since those importPisp1.js helpers aren't exported).
//
// =================================================================================================
// CLEAN-DATA-ONLY DISCIPLINE (explicit user instruction: only import complete/unambiguous rows;
// anything needing confirmation or incomplete must NOT be imported). Key decisions, verified by
// actually opening the real file (xlsx sheet names/headers differ in some details from the initial
// task summary -- this header comment reflects what was actually observed):
//
//   1. SHEET SELECTION -- only sheets whose (trimmed) name matches literally "<Kebun> (Sensus)" or
//      "<Kebun> (Deteksi)" are read (label-driven regex match, not a hard-coded sheet list). This
//      naturally captures all 17 canonical sheets actually present (LS/KALE/USP/FAPE/SMP/MKSS/BKP/
//      PTLJ each have a Sensus+Deteksi pair = 16, plus "MKSK (Deteksi)" with NO matching "MKSK
//      (Sensus)" sheet = 17 total) and naturally EXCLUDES every non-canonical sheet: "FAPE Deteksi
//      (Mentah)" (smaller separate raw log -- the canonical "FAPE (Deteksi)" sheet is used instead,
//      to avoid double-counting), "Comparison" (per task brief: ~2000 broken #REF! cells), and every
//      other rekap/summary sheet (Summary FR Kalbar, Percepatan Pengendalian, PR Racun, Summary Dtk
//      Sns dan Action, Summary Pengendalian 4-9 May, List Rekomendasi utk Sensus/Campaign, Summary
//      Det Sns 16-31 Jul 2026, "Sensus & Deteksi SMP 2", "Sensus dan Deteksi SMP 1") -- none of these
//      match the strict "<Kebun> (Sensus|Deteksi)" pattern so they're skipped automatically; the
//      unmatched sheet names actually found are still reported back in `notes` for transparency.
//      NOTE ON THE TASK BRIEF'S "MKSK/MKSS" WORDING: the real file has THREE separate sheets here,
//      not a single kebun with one missing pair-half: "MKSS (Sensus)" + "MKSS (Deteksi)" (Kebun
//      column literally reads "MKSS" in both) AND a separate "MKSK (Deteksi)" (Kebun column reads
//      "MKSK", no matching "MKSK (Sensus)" sheet at all). Per the "use whatever's literally written,
//      don't normalize/guess" instruction, MKSS and MKSK are imported as two distinct estate codes
//      exactly as written -- this still satisfies the underlying observation the brief was pointing
//      at ("one kebun's Deteksi-only sheet has no Sensus counterpart"), just under its real literal
//      spelling (MKSK) rather than being folded into MKSS.
//
//   2. HEADER PARSING is entirely label-driven (readMatrix/findHeaderRow/findColByRegex style copied
//      from services/importPisp1.js), never by fixed row/column numbers -- confirmed necessary since
//      the real column layout is NOT uniform across kebun (extra "Pokok Terserang (Lama)/%" columns
//      on some sheets but not others, extra unrelated trailing columns -- weekly bait-decay % on
//      KALE Sensus, ad hoc dateless "Deteksi ..." % columns on BKP/PTLJ Sensus -- these have no
//      "Tanggal Sensus" label of their own so the group-scan below naturally never reads them).
//
//   3. "COMBINED/ROLLED-UP FIRST GROUP" PATTERN -- every sheet repeats a "Tanggal Sensus / Pokok
//      Sensus / .../ Rekomendasi" column-group one or more times per row (once per detection method
//      x period, or once per sensus period for FAPE which has 3: "Mei - Juni 2026", "Mei 2026",
//      "Juni 2026"). Verified by comparing actual cell values: whenever a row-block has MORE THAN
//      ONE such group, the FIRST group is always a derived rollup -- either a byte-for-byte
//      duplicate of the single AKP group (LS/KALE/USP/BKP/SMP/MKSS Deteksi, single-period sheets)
//      or the most-recently-populated of the several genuine period groups that follow it (FAPE
//      Sensus's "Mei-Juni 2026" column exactly mirrors whichever of "Mei 2026"/"Juni 2026" has data;
//      same pattern for the multi-period Deteksi sheets FAPE/PTLJ/MKSS/SMP). It is never a genuinely
//      independent reading. Per "only unambiguous data", this first group is ALWAYS SKIPPED whenever
//      a row-block has 2+ groups; only groups 2..N (the real, granular, individually-dated readings)
//      are imported. This is a purely structural rule (count "Tanggal Sensus" columns, drop the
//      first if there's more than one) -- it needs no per-kebun special-casing and was verified
//      against every kebun's actual header layout before being applied generally.
//
//   4. "NOT YET SENSUSED/DETECTED" placeholders -- a genuinely blank Tanggal Sensus cell (seen e.g.
//      on USP/MKSS/BKP Sensus rows not yet worked, paired with a blank Pokok Sensus and Rekomendasi
//      "Belum Sensus"), and separately a Tanggal Sensus cell that parses to the Excel epoch-zero
//      date (observed literally as "1899-12-30T00:00:00.000Z" once read with cellDates:true -- this
//      IS the underlying "00:00:00 time-only" artifact the task brief described, just surfaced as a
//      full epoch-zero date rather than a bare time string once xlsx parses it) are BOTH treated as
//      "not yet done for this blok/period" and the whole reading-group for that row is skipped --
//      never fabricated. Any date that parses to a year < 1950 is treated as this same placeholder.
//      The trailing aggregate/rollup block appended at the bottom of "LS (Sensus) " (per-Afd and
//      per-Rayon subtotal rows, and one whole-kebun total row) is caught by this exact same rule --
//      every one of those rollup rows has a blank Tanggal Sensus, so they are skipped as "incomplete"
//      without needing separate rollup-detection logic.
//
//   5. REAL RAW COUNTS, NOT SYNTHESIZED -- "Pokok Sensus" (sample size) and "Pokok Terserang (Baru)"
//      / "Pokok Terserang (Lama)" (attack counts) are genuine raw counts in this file (unlike
//      services/importPisp1.js's REKAP SNS TIKUS sheet, which only has a pre-computed percentage and
//      has to synthesize a fake jumlah_sampel=100 to reuse the formula) -- those real counts are fed
//      directly into services/sensusEngines.js computeTikus({serangan_baru, serangan_lama,
//      jumlah_sampel}) via ingestSensus, exactly reproducing the source file's own "%" column
//      mathematically, with no synthetic substitution needed. A "Pokok Sensus" (sample size) that is
//      missing/blank/zero makes the group un-formulable (computeTikus requires sampel>0) and is
//      skipped -- consistent with the "not yet sensused" convention above (a 0/blank sample size and
//      a blank Tanggal Sensus co-occur in every case observed).
//
//   6. ESTATE CODE = the "Kebun" column value, VERBATIM, not the "Est" column and not the sheet-name
//      kebun label -- per explicit instruction to prefer Kebun when it and Est disagree. Verified
//      this is the right granularity: on "LS (Sensus) " the Kebun column literally reads "LS I" for
//      some rows and "LS II" for others (each internally consistent with its own non-overlapping set
//      of Afd values), i.e. the source file itself already splits "LS" into two separate estates at
//      the Kebun-column level; "Est" is a coarser secondary grouping inside each Kebun value and is
//      not used for master-data resolution at all (kept only for context/traceability in `catatan`).
//      Distinct literal Kebun values observed across the 17 sheets: LS I, LS II, KALE, USP, FAPE,
//      SMP-1, SMP-2, MKSS, MKSK, BKP, PTLJ (11 estates). Afdeling codes use the exact same
//      afdCodeFromRaw() convention as every sibling importer (prefix "AFD" unless already prefixed) -
//      applied verbatim to whatever Afd text is written, including BKP's place names (e.g. "Semayang"
//      -> "AFDSEMAYANG") and USP's plain numbers (1 -> "AFD1"), never normalized/guessed otherwise.
//      Blok codes are the raw Blok text, trimmed, verbatim (e.g. "B05", "A59a", "C17a").
//      A row is skipped ENTIRELY (no group of it imported) if Kebun, Afd, or Blok is blank -- can't
//      resolve a location -- per explicit instruction.
//
//   7. SPECIES: TIKUS is not broken into species in this file -- species_id is always left NULL.
//
//   8. jumlah_indikasi (detection) is the "%" value the source file itself reports for that group's
//      "Terserang (Baru)" reading (falls back to computing terserang_baru/diamati*100 only if that
//      cell is itself blank/non-numeric but the counts it should be derived from are present) --
//      matches the threshold table's own satuan ('%') for TIKUS so classification is meaningful.
//      kondisi_indikator records which of the two real detection methods this file actually uses per
//      SPEC (AKP-berkala vs Grading TPH), per reading-group (not a single hard-coded string), since
//      each group's own header row unambiguously says which method it is ("Pokok Sensus" column =
//      AKP/pokok-based; "Jumlah TBS" column = Grading TPH/bunch-based).
//      baris/posisi are always left NULL (no per-tree/point granularity exists in this file -- every
//      reading here is a per-blok-per-period aggregate, exactly as the task brief describes).
// =================================================================================================

const path = require('path');
const XLSX = require('xlsx');
const { ingestSensus, ingestDetection } = require('../../services/ingestion');

const ENTITY_TYPE = 'KB_SEED_SENSUS_TIKUS_KALBAR';
const FILENAME = 'sensus_deteksi_tikus_fr_kalbar.xlsx';
const HPT_CODE = 'TIKUS';

// Matches "<Kebun> (Sensus)" / "<Kebun> (Deteksi)" (trimmed) -- deliberately strict so it does NOT
// match "FAPE Deteksi (Mentah)", "Comparison", "Sensus & Deteksi SMP 2", etc. See header note #1.
const CANONICAL_SHEET_RE = /^(.+?)\s*\((Sensus|Deteksi)\)$/i;

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

/** Find the first row (within maxRow) that contains a cell for EVERY required label substring, each
 *  in a DIFFERENT column. */
function findHeaderRow(matrix, requiredLabels, maxRow = 12) {
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

function findColExact(row, start, end, label) {
  for (let c = start; c <= end; c++) {
    if (normLabel(row[c]) === label) return c;
  }
  return null;
}

function findColMatch(row, start, end, regex) {
  for (let c = start; c <= end; c++) {
    const v = row[c];
    if (v !== '' && v != null && regex.test(String(v).trim())) return c;
  }
  return null;
}

/** Nearest non-blank cell at or to the left of `col` in `row`, never crossing below `floorCol` --
 *  used only for cosmetic period labels in `catatan` (best-effort, never load-bearing for import
 *  decisions). `floorCol` is bounded to the first "Tanggal Sensus" group's own start column so this
 *  never wanders left into the shared Kebun/Est/Afd/.../Luas columns or the sheet's title cell. */
function nearestLabelLeft(row, col, floorCol) {
  for (let c = col; c >= floorCol; c--) {
    const v = row[c];
    if (v !== '' && v != null) return String(v).trim();
  }
  return null;
}

function numOrNull(v) {
  if (v == null) return null;
  const s = typeof v === 'string' ? v.trim() : v;
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Strict ISO date, treating the Excel epoch-zero placeholder (year < 1950 -- observed literally as
 *  "1899-12-30T00:00:00.000Z", the "00:00:00 time-only" artifact once cellDates:true parses it) the
 *  same as a genuinely blank cell: both mean "not yet sensused/detected for this period" (see header
 *  note #4) and return null so the caller skips the whole reading rather than fabricating a date. */
function toISODate(v) {
  if (v === '' || v == null) return null;
  let d = null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    d = v;
  } else if (typeof v === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(v);
      if (parsed && parsed.y) d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    } catch (e) {
      /* fall through */
    }
  } else if (typeof v === 'string') {
    const s = v.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s);
    else {
      const parsed = new Date(s);
      if (!Number.isNaN(parsed.getTime())) d = parsed;
    }
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  if (d.getUTCFullYear() < 1950) return null; // epoch-zero placeholder -- treat as "not yet done"
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// =================================================================================================
// Reading-group detection: every "Tanggal Sensus / Pokok Sensus (or Jumlah TBS) / ... / Rekomendasi"
// block is found purely by label (never by hard-coded column numbers), and any row-block with more
// than one such group has its FIRST group dropped (see header note #3).
// =================================================================================================

function findTanggalGroupStarts(labelRowArr) {
  const starts = [];
  for (let c = 0; c < labelRowArr.length; c++) {
    if (normLabel(labelRowArr[c]) === 'tanggal sensus') starts.push(c);
  }
  return starts;
}

/** Builds the list of USABLE reading-groups for a row-block (i.e. already drops the first group when
 *  there is more than one -- header note #3). Each group carries the column indices for every
 *  sub-field found within its span, resolved by label, plus a `kind` ('AKP' | 'GRADING_TPH' | null)
 *  determined by whether its diamati column is literally "Pokok Sensus" or "Jumlah TBS". */
function buildGroups(labelRowArr) {
  const starts = findTanggalGroupStarts(labelRowArr);
  if (starts.length === 0) return [];
  const usableStarts = starts.length > 1 ? starts.slice(1) : starts;
  const allStarts = starts; // needed to compute each usable group's end boundary correctly
  return usableStarts.map((start) => {
    const idx = allStarts.indexOf(start);
    const end = idx + 1 < allStarts.length ? allStarts[idx + 1] - 1 : labelRowArr.length - 1;
    const diamatiPokokCol = findColExact(labelRowArr, start, end, 'pokok sensus');
    const diamatiTbsCol = findColExact(labelRowArr, start, end, 'jumlah tbs');
    const diamatiCol = diamatiPokokCol != null ? diamatiPokokCol : diamatiTbsCol;
    const kind = diamatiPokokCol != null ? 'AKP' : diamatiTbsCol != null ? 'GRADING_TPH' : null;
    const terserangBaruCol = findColMatch(labelRowArr, start, end, /terserang\s*\(baru\)/i);
    const terserangLamaCol = findColMatch(labelRowArr, start, end, /terserang\s*\(lama\)/i);
    const rekomendasiCol = findColMatch(labelRowArr, start, end, /rekomendasi/i);
    const pctBaruCol = terserangBaruCol != null ? findColExact(labelRowArr, terserangBaruCol + 1, end, '%') : null;
    const pctLamaCol = terserangLamaCol != null ? findColExact(labelRowArr, terserangLamaCol + 1, end, '%') : null;
    return { start, end, kind, diamatiCol, terserangBaruCol, terserangLamaCol, rekomendasiCol, pctBaruCol, pctLamaCol };
  });
}

// =================================================================================================
// Per-sheet extraction (pure -- no db access). Returns { records, rowsRead, rowsSkipped, error }.
// A "record" is one (blok, period/method) reading, already tagged SENSUS or DETECTION.
// =================================================================================================

function extractSheet(ws, sheetName, kind /* 'SENSUS' | 'DETECTION' */, notes) {
  const matrix = readMatrix(ws);
  const header = findHeaderRow(matrix, ['kebun', 'afd', 'blok'], 12);
  if (!header) {
    notes.push(`Sheet "${sheetName}": header Kebun/Afd/Blok tidak ditemukan pada 12 baris pertama -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }
  const labelRow = header.row;
  const labelRowArr = matrix[labelRow] || [];
  const kebunCol = header.cols['kebun'];
  const estCol = findColExact(labelRowArr, 0, labelRowArr.length - 1, 'est');
  const afdCol = header.cols['afd'];
  const blokCol = findColExact(labelRowArr, 0, labelRowArr.length - 1, 'blok');
  const luasCol = findColMatch(labelRowArr, 0, labelRowArr.length - 1, /luas/i);

  if (blokCol == null) {
    notes.push(`Sheet "${sheetName}": kolom Blok tidak ditemukan -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }

  const groups = buildGroups(labelRowArr);
  if (groups.length === 0) {
    notes.push(`Sheet "${sheetName}": tidak ditemukan kolom grup "Tanggal Sensus" yang bisa dipakai -- seluruh sheet dilewati.`);
    return { records: [], rowsRead: 0, rowsSkipped: 0 };
  }
  const allGroupStarts = findTanggalGroupStarts(labelRowArr);
  const droppedFirstGroup = allGroupStarts.length > 1;
  const labelFloorCol = Math.min(...allGroupStarts);

  const superHeaderRow1 = labelRow > 0 ? matrix[labelRow - 1] || [] : [];
  const superHeaderRow0 = labelRow > 1 ? matrix[labelRow - 2] || [] : [];

  const records = [];
  let rowsRead = 0;
  let rowsSkipped = 0;

  for (let r = labelRow + 1; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const kebunRaw = row[kebunCol];
    const afdRaw = row[afdCol];
    const blokRaw = row[blokCol];
    if ((blokRaw === '' || blokRaw == null) && (kebunRaw === '' || kebunRaw == null) && (afdRaw === '' || afdRaw == null)) {
      continue; // fully blank spacer row -- not data at all
    }
    rowsRead++;

    // Header note #4/#6: blank Kebun/Afd/Blok -> can't resolve location, skip row entirely.
    if (kebunRaw === '' || kebunRaw == null || afdRaw === '' || afdRaw == null || blokRaw === '' || blokRaw == null) {
      rowsSkipped++;
      continue;
    }

    const luas = luasCol != null ? numOrNull(row[luasCol]) : null;
    const estRaw = estCol != null ? row[estCol] : null;
    let anyGroupUsed = false;

    for (const g of groups) {
      const tanggal = toISODate(row[g.start]);
      if (!tanggal) continue; // header note #4 -- not yet sensused/detected this period
      const diamati = g.diamatiCol != null ? numOrNull(row[g.diamatiCol]) : null;
      if (diamati == null || diamati <= 0) continue; // header note #5 -- no usable sample/TBS count

      const terserangBaru = g.terserangBaruCol != null ? (numOrNull(row[g.terserangBaruCol]) ?? 0) : 0;
      const terserangLama = g.terserangLamaCol != null ? numOrNull(row[g.terserangLamaCol]) : null;
      let pctBaru = g.pctBaruCol != null ? numOrNull(row[g.pctBaruCol]) : null;
      if (pctBaru == null) pctBaru = (terserangBaru / diamati) * 100;
      const rekomendasi = g.rekomendasiCol != null ? row[g.rekomendasiCol] : null;
      const rekomendasiText = rekomendasi != null && String(rekomendasi).trim() ? String(rekomendasi).trim() : null;
      const periodLabel = kind === 'SENSUS'
        ? nearestLabelLeft(superHeaderRow1, g.start, labelFloorCol)
        : [nearestLabelLeft(superHeaderRow0, g.start, labelFloorCol), nearestLabelLeft(superHeaderRow1, g.start, labelFloorCol)].filter(Boolean).join(' / ');

      records.push({
        kind,
        method: g.kind, // 'AKP' | 'GRADING_TPH' | null (SENSUS rows are always AKP-style)
        kebunRaw: String(kebunRaw).trim(),
        estRaw,
        afdRaw,
        blokRaw,
        luas,
        tanggal,
        diamati,
        terserangBaru,
        terserangLama,
        pctBaru,
        rekomendasi: rekomendasiText,
        periodLabel: periodLabel || null,
        sheetName,
      });
      anyGroupUsed = true;
    }
    if (!anyGroupUsed) rowsSkipped++; // blok present but no group had a complete, usable reading
  }

  return { records, rowsRead, rowsSkipped, droppedFirstGroup, groupCount: groups.length };
}

// =================================================================================================
// Master data (Estate/Afdeling/Blok) resolution -- same discipline as services/importPisp1.js:
// resolve by code, create if missing, never overwrite an existing row. See header note #6.
// =================================================================================================

function afdCodeFromRaw(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^afd/i.test(s) ? s.toUpperCase() : `AFD${s}`.toUpperCase();
}
function estateCodeFromKebun(raw) {
  return String(raw).trim().replace(/\s+/g, ' ').toUpperCase();
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

function methodLabel(method) {
  if (method === 'AKP') return 'AKP-berkala (Pokok Sensus)';
  if (method === 'GRADING_TPH') return 'Grading TPH (Tandan Buah Segar)';
  return 'AKP';
}

// =================================================================================================
// Public entry point
// =================================================================================================

module.exports = function seedSensusTikusKalbar(db) {
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

  // --- Discover canonical sheets (header note #1) -------------------------------------------------
  const canonical = []; // { sheetName, kebunLabel, kind }
  const unmatched = [];
  for (const name of wb.SheetNames) {
    const trimmed = name.trim();
    const m = trimmed.match(CANONICAL_SHEET_RE);
    if (m) {
      canonical.push({ sheetName: name, kebunLabel: m[1].trim().toUpperCase(), kind: m[2].toUpperCase() === 'SENSUS' ? 'SENSUS' : 'DETECTION' });
    } else {
      unmatched.push(name);
    }
  }
  notes.push(
    `${canonical.length} sheet kanonik ditemukan (pola "<Kebun> (Sensus)"/"<Kebun> (Deteksi)"): ${canonical.map((s) => s.sheetName.trim()).join(', ')}.`
  );
  notes.push(`${unmatched.length} sheet lain pada file ini TIDAK diimport (bukan sheet kanonik): ${unmatched.join(', ')}.`);

  const kebunLabels = [...new Set(canonical.map((s) => s.kebunLabel))].sort();
  const missingSensus = kebunLabels.filter((k) => !canonical.some((s) => s.kebunLabel === k && s.kind === 'SENSUS'));
  if (missingSensus.length) {
    notes.push(`Kebun tanpa sheet "(Sensus)" (hanya "(Deteksi)"): ${missingSensus.join(', ')} -- ini valid, bukan error, lanjutkan hanya dengan data yang ada.`);
  }

  // --- Extract every canonical sheet (pure, no db access) ------------------------------------------
  let totalRowsRead = 0;
  let totalRowsSkipped = 0;
  const allRecords = [];
  const perSheetSummary = [];

  for (const { sheetName, kind } of canonical) {
    const ws = wb.Sheets[sheetName];
    const out = extractSheet(ws, sheetName, kind, notes);
    totalRowsRead += out.rowsRead || 0;
    totalRowsSkipped += out.rowsSkipped || 0;
    allRecords.push(...(out.records || []));
    perSheetSummary.push({
      sheet: sheetName.trim(),
      kind,
      rowsRead: out.rowsRead || 0,
      rowsSkipped: out.rowsSkipped || 0,
      recordsExtracted: (out.records || []).length,
      groupCount: out.groupCount || 0,
      firstGroupDropped: !!out.droppedFirstGroup,
    });
  }

  // --- Resolve/create master data + call ingestSensus/ingestDetection, all inside one transaction --
  const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(HPT_CODE);
  if (!hpt) {
    notes.push(`HPT code "${HPT_CODE}" tidak ditemukan di master data -- import dibatalkan tanpa menulis apa pun.`);
    return { skipped: false, committed: 0, failed: 0, rowsRead: totalRowsRead, notes };
  }

  const estateCache = new Map();
  const afdelingCache = new Map();
  const blokCache = new Map();
  let estatesCreated = 0;
  let afdelingsCreated = 0;
  let bloksCreated = 0;
  let committed = 0;
  let committedSensus = 0;
  let committedDetection = 0;
  let failed = 0;
  let ewsAlertCount = 0;
  const failures = [];
  const perKebunCommitted = {};

  const runImport = db.transaction(() => {
    function resolveEstate(kebunRaw) {
      const code = estateCodeFromKebun(kebunRaw);
      let estate = estateCache.get(code);
      if (!estate) {
        estate = findEstateByCode(db, code);
        if (!estate) {
          const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(code, String(kebunRaw).trim());
          estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
          estatesCreated++;
        }
        estateCache.set(code, estate);
      }
      return estate;
    }

    function resolveBlok(estate, afdRaw, blokRaw, luas) {
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

    for (const rec of allRecords) {
      const kebunKey = rec.kebunRaw;
      perKebunCommitted[kebunKey] = perKebunCommitted[kebunKey] || { sensus: 0, detection: 0, failed: 0 };
      try {
        const estate = resolveEstate(rec.kebunRaw);
        const blok = resolveBlok(estate, rec.afdRaw, rec.blokRaw, rec.luas);

        const catatanParts = [
          `Data historis import dari Database Sensus & Deteksi Tikus FR Kalbar, kebun ${rec.kebunRaw}${rec.estRaw ? ` (Est ${rec.estRaw})` : ''}, sheet "${rec.sheetName.trim()}"${rec.periodLabel ? `, periode ${rec.periodLabel}` : ''}.`,
        ];

        if (rec.kind === 'SENSUS') {
          catatanParts.push(`Pokok Sensus=${rec.diamati}, Pokok Terserang (Baru)=${rec.terserangBaru}${rec.terserangLama != null ? `, Pokok Terserang (Lama)=${rec.terserangLama}` : ''}.`);
          if (rec.rekomendasi) catatanParts.push(`Rekomendasi: ${rec.rekomendasi}.`);
          const hasil_json = { serangan_baru: rec.terserangBaru, serangan_lama: rec.terserangLama || 0, jumlah_sampel: rec.diamati };
          const out = ingestSensus(
            {
              blok_id: blok.id,
              jenis_sensus: HPT_CODE,
              species_id: null,
              tanggal: rec.tanggal,
              hasil_json,
              catatan: catatanParts.join(' '),
              source: 'EXCEL',
            },
            {}
          );
          if (out.engineResult && out.engineResult.ews_alert) ewsAlertCount++;
          committedSensus++;
          perKebunCommitted[kebunKey].sensus++;
        } else {
          const diamatiLabel = rec.method === 'GRADING_TPH' ? 'Jumlah TBS' : 'Pokok Sensus';
          const terserangLabel = rec.method === 'GRADING_TPH' ? 'TBS Terserang (Baru)' : 'Pokok Terserang (Baru)';
          catatanParts.push(`${diamatiLabel}=${rec.diamati}, ${terserangLabel}=${rec.terserangBaru}${rec.terserangLama != null ? `, Terserang (Lama)=${rec.terserangLama}` : ''}.`);
          if (rec.rekomendasi) catatanParts.push(`Rekomendasi: ${rec.rekomendasi}.`);
          const out = ingestDetection(
            {
              blok_id: blok.id,
              hpt_id: hpt.id,
              species_id: null,
              baris: null,
              posisi: null,
              tanggal: rec.tanggal,
              kondisi_indikator: methodLabel(rec.method),
              jumlah_indikasi: rec.pctBaru,
              catatan: catatanParts.join(' '),
              source: 'EXCEL',
            },
            {}
          );
          if (out.engineResult && out.engineResult.ews_alert) ewsAlertCount++;
          committedDetection++;
          perKebunCommitted[kebunKey].detection++;
        }
        committed++;
      } catch (e) {
        failed++;
        perKebunCommitted[kebunKey].failed++;
        failures.push({ kind: rec.kind, kebun: rec.kebunRaw, afd: rec.afdRaw, blok: rec.blokRaw, tanggal: rec.tanggal, sheet: rec.sheetName.trim(), error: e.message });
      }
    }

    // total_rows = raw source rows read (sheet rows with a Blok value, across all 17 sheets);
    // valid_rows = extracted candidate records (can exceed total_rows since one row commonly yields
    // several records -- e.g. AKP + Grading TPH per Deteksi row, or multiple sensus periods per
    // FAPE row, see header note #3); error_rows = records that failed to commit (0 in the normal
    // case -- an insert failure here means a genuine bug, not an expected data gap, since every
    // "incomplete" row was already filtered out before this point).
    db.prepare(
      `INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
       VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)`
    ).run(ENTITY_TYPE, FILENAME, totalRowsRead, allRecords.length, failed, committed);
  });

  runImport();

  if (failures.length) {
    notes.push(`${failures.length} baris gagal saat insert (lihat detail): ${JSON.stringify(failures.slice(0, 20))}`);
  }

  return {
    skipped: false,
    committed,
    committedSensus,
    committedDetection,
    failed,
    ewsAlertCount,
    rowsRead: totalRowsRead,
    rowsSkippedAsIncomplete: totalRowsSkipped,
    estatesCreated,
    afdelingsCreated,
    bloksCreated,
    perKebun: perKebunCommitted,
    perSheet: perSheetSummary,
    notes,
  };
};
