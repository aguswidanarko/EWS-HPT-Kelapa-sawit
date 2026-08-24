// One-time historical seed import for foliar (leaf) nutrient analysis from the bundled workbook
// seed_data/defisiensi_hara_lsu_2026.xlsx -> leaf_analysis table.
//
// Self-guarding + idempotent, same pattern as the sibling seed importers (waterManagement.js,
// tbmVegetatif.js): an import_log row with entity_type='KB_SEED_DEFISIENSI_HARA' and
// status='COMMITTED' is the guard, so re-running this at every server boot after the first
// successful commit is a safe no-op ({ skipped: true }).
//
// Master-data (estate/afdeling/blok) resolution follows the same create-if-missing/never-overwrite
// discipline as services/importPisp1.js and the sibling importers (findEstateByCode /
// findAfdelingByCode / findBlokByCode), reimplemented here against the shared `db` connection.
//
// leaf_analysis has NO rule-engine classification call in its real POST route (routes/leafAnalysis.js
// does a plain direct insert with `severity` as a raw stored field) -- this importer does not invent
// one either. `severity` is always left NULL here (see note below).
//
// CLEAN-DATA-ONLY POLICY (explicit user instruction: only import complete/unambiguous data; never
// fabricate or guess a value that isn't clearly present):
//   - Source is ONLY the "FR Kalbar Leaf Analysis (New)" sheet. The other 11 sheets in the workbook
//     are intentionally NOT read: "FR Kalbar Leaf Analysis" (stale older version of the same data),
//     "KALE TEST (Blok sama)" (test data, ages don't match the main sheet), "Leaf Analysis For Arcgis
//     FAVE" / "Leaf Analysis For Arcgis " (derivative ArcGIS export duplicates), "Sampel Khusus" (39
//     rows with non-standard/descriptive blok codes, not clean identifiers), "Indicator" / "Data For
//     Slide" (workbook chrome, not row-level data), and the soil ("tanah") / "Aplikasi Pupuk" sheets
//     (out of scope for this table entirely).
//   - The sheet only carries a YEAR per reading (no day/month) -- this is a genuine, accepted gap
//     (structural to the WHOLE sheet, not a per-row ambiguity), so tanggal is built as
//     `${year}-01-01` uniformly, and that precision loss is disclosed explicitly in `catatan` for
//     every row this importer writes.
//   - The row-level aggregate "Kategori Status Hara" column (an overall per-year status text) is
//     NEVER imported -- it was found to sometimes contradict the per-unsur D/L/O/H/E codes (e.g.
//     Cu=Deficient but overall says Non-Deficient), and there is no schema field for a row-level (as
//     opposed to per-unsur) status anyway.
//   - `severity` is never derived from the D/L/O/H/E code -- there is no confirmed conversion table
//     from that code to the system's RINGAN/SEDANG/BERAT severity scale. It is always left NULL.
//     Instead the raw D/L/O/H/E code is preserved verbatim in `catatan` (with a plain-language
//     expansion for the five standard codes: D=Deficient, L=Low, O=Optimum, H=High, E=Excess -- an
//     established agronomic reading of those single-letter foliar-status codes, not a severity
//     mapping) so the information is not lost, just not mis-mapped onto a scale it was never
//     confirmed to match. A small number of cells carry a non-letter marker in that column (observed:
//     numeric 0, always paired 1:1 with hasil=0 itself, i.e. a "reading is exactly zero" formula
//     artifact rather than a D/L/O/H/E judgement) -- those are preserved verbatim too, unexpanded,
//     rather than guessed at.
//   - Header layout is located by LABEL TEXT (Kebun/Afd/Blok header cells, "Status Hara <year>"
//     section titles), then self-verified by sampling actual cell values under each detected span to
//     tell the numeric "hasil" block apart from the "D/L/O/H/E status" block for the same year --
//     never assumed from a fixed column number.
//   - One leaf_analysis row is emitted per (Kebun, Afdeling, Blok, tahun, unsur_hara) combination
//     that has a genuine numeric `hasil` for that unsur (up to 5 years x 6 unsur = 30 rows per sheet
//     row/blok). A blank or non-numeric cell (observed: stray whitespace-only cells) skips only that
//     one unsur/year reading, never the whole sheet row.
//   - Any sheet row missing Kebun, Afdeling, or Blok is skipped entirely (location unresolvable) --
//     observed in this workbook as a handful of trailing legend/footer rows that carry only a Kebun
//     name with nothing else.
//   - `input_by_role` is always 'RISET' (fixed business rule per the table's own CREATE TABLE
//     comment and routes/leafAnalysis.js). `user_id` is always NULL (no real user for a historical
//     import, same convention the sibling importers use). `status` stays at its schema default
//     'OPEN'.

const path = require('path');
const XLSX = require('xlsx');

const SEED_FILE = path.join(__dirname, '..', '..', '..', 'seed_data', 'defisiensi_hara_lsu_2026.xlsx');
const FILENAME = 'defisiensi_hara_lsu_2026.xlsx';
const ENTITY_TYPE = 'KB_SEED_DEFISIENSI_HARA';
const SOURCE_SHEET = 'FR Kalbar Leaf Analysis (New)';

const CODE_LABELS = { D: 'Deficient', L: 'Low', O: 'Optimum', H: 'High', E: 'Excess' };

// ---------------------------------------------------------------------------------------------
// Low-level sheet reading helpers (label-driven, not row/col-number-driven) -- same approach as
// services/importPisp1.js's readMatrix/normLabel/findHeaderRow.
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
function findHeaderRow(matrix, requiredLabels, maxRow = 10) {
  for (let r = 0; r < Math.min(maxRow, matrix.length); r++) {
    const row = matrix[r] || [];
    const colFor = {};
    for (let c = 0; c < row.length; c++) {
      const v = normLabel(row[c]);
      if (!v) continue;
      for (const label of requiredLabels) {
        if (colFor[label] === undefined && v === label) colFor[label] = c;
      }
    }
    if (requiredLabels.every((l) => colFor[l] !== undefined)) return { row: r, cols: colFor };
  }
  return null;
}

function isCleanNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Sample up to `sampleSize` data rows at a given column to decide whether that column carries
 *  numeric readings ("hasil" block) or short letter/status codes ("D/L/O/H/E" block). Self-verifying
 *  against real data rather than assuming a fixed layout. Returns 'hasil' | 'code' | null (unclear). */
function classifyColumn(matrix, dataStartRow, col, sampleSize = 40) {
  let numeric = 0;
  let codeLike = 0;
  let seen = 0;
  for (let r = dataStartRow; r < matrix.length && seen < sampleSize; r++) {
    const v = matrix[r][col];
    if (v === '' || v == null) continue;
    seen++;
    if (isCleanNumber(v)) numeric++;
    else if (typeof v === 'string' && v.trim().length <= 2) codeLike++;
  }
  if (numeric === 0 && codeLike === 0) return null;
  return numeric >= codeLike ? 'hasil' : 'code';
}

/**
 * Builds { year: { unsurLabel: { hasilCol, codeCol } } } by:
 *  1. locating the header row (Kebun/Afd/Blok all present) and the "section title" row above it,
 *  2. scanning that section-title row for "Status Hara <year>" cells,
 *  3. for each match, walking the (up to 6) contiguous unsur-name columns starting there,
 *  4. sampling real data underneath each span to tell the numeric block from the status-code block.
 */
function locateYearUnsurColumns(matrix, notes) {
  const header = findHeaderRow(matrix, ['kebun', 'afd', 'blok'], 10);
  if (!header) return null;
  const headerRow = header.row;
  const titleRow = headerRow - 1;
  if (titleRow < 0) return null;
  const dataStartRow = headerRow + 1;

  const matches = [];
  const rowArr = matrix[titleRow] || [];
  for (let c = 0; c < rowArr.length; c++) {
    const v = String(rowArr[c] == null ? '' : rowArr[c]).trim();
    const m = v.match(/status\s*hara\s*(\d{4})/i);
    if (m) matches.push({ col: c, year: Number(m[1]) });
  }

  const hasilMap = {};
  const codeMap = {};
  for (const { col, year } of matches) {
    // Walk contiguous unsur-name columns starting at `col` (header row has a non-blank label,
    // bounded by the next section-title cell or a hard cap of 6 -- the widest span observed).
    const unsurCols = [];
    const rowLen = matrix[headerRow].length;
    for (let c = col; c < col + 6 && c < rowLen; c++) {
      const label = matrix[headerRow][c];
      if (label === '' || label == null) break;
      if (c > col && rowArr[c] && String(rowArr[c]).trim()) break; // next section title starts
      unsurCols.push({ col: c, label: String(label).trim() });
    }
    if (!unsurCols.length) {
      notes.push(`Kolom unsur di bawah "Status Hara ${year}" (kolom ${col}) tidak ditemukan -- blok ini dilewati.`);
      continue;
    }
    const kind = classifyColumn(matrix, dataStartRow, unsurCols[0].col);
    if (!kind) {
      notes.push(`Tidak bisa menentukan jenis data (hasil numerik vs kode status) untuk "Status Hara ${year}" (kolom ${col}) -- blok ini dilewati.`);
      continue;
    }
    const target = kind === 'hasil' ? hasilMap : codeMap;
    if (target[year]) {
      notes.push(`Blok "Status Hara ${year}" jenis ${kind} muncul lebih dari satu kali -- hanya kemunculan pertama (kolom ${col}) yang dipakai.`);
      continue;
    }
    target[year] = {};
    for (const u of unsurCols) target[year][u.label] = u.col;
  }

  return { headerCols: header.cols, dataStartRow, hasilMap, codeMap };
}

function afdCodeFromRaw(raw) {
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

function catatanFor(year, rawCode) {
  let s = `Tanggal presisi tidak tersedia, hanya tahun ${year} dari sumber data.`;
  const code = rawCode === '' || rawCode == null ? null : String(rawCode).trim();
  if (code == null) {
    s += ' Kode klasifikasi sumber tidak tersedia untuk pembacaan ini.';
  } else if (CODE_LABELS[code]) {
    s += ` Kode asli sumber: ${code} (${CODE_LABELS[code]}).`;
  } else {
    s += ` Kode asli sumber: ${code} (kode non-standar/di luar D/L/O/H/E, dicatat apa adanya).`;
  }
  return s;
}

module.exports = function seedDefisiensiHara(db) {
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

  const ws = wb.Sheets[SOURCE_SHEET];
  if (!ws) {
    notes.push(`Sheet "${SOURCE_SHEET}" tidak ditemukan pada file -- tidak ada yang diimport.`);
    return { skipped: false, committed: 0, failed: 0, rowsRead: 0, notes };
  }
  notes.push(
    `Sheet lain di workbook ini ("FR Kalbar Leaf Analysis", "KALE TEST (Blok sama)", "Leaf Analysis For Arcgis FAVE", `
    + `"Leaf Analysis For Arcgis ", "Sampel Khusus", "Indicator", "Data For Slide", dan 4 sheet Aplikasi Pupuk/tanah) `
    + `sengaja tidak dibaca -- lihat komentar header modul ini untuk alasan per sheet.`
  );

  const matrix = readMatrix(ws);
  const layout = locateYearUnsurColumns(matrix, notes);
  if (!layout) {
    notes.push('Header Kebun/Afd/Blok tidak ditemukan pada sheet -- tidak ada yang diimport.');
    return { skipped: false, committed: 0, failed: 0, rowsRead: 0, notes };
  }
  const { headerCols, dataStartRow, hasilMap, codeMap } = layout;
  const years = Object.keys(hasilMap).map(Number).sort();
  notes.push(`Kolom hasil numerik ditemukan untuk tahun: ${years.join(', ')} (kode D/L/O/H/E ditemukan untuk tahun: ${Object.keys(codeMap).map(Number).sort().join(', ')}).`);

  const kebunCol = headerCols.kebun;
  const afdCol = headerCols.afd;
  const blokCol = headerCols.blok;
  const headerRowArr = matrix[dataStartRow - 1];
  const ttCol = headerRowArr.findIndex((v) => normLabel(v) === 'tt');
  const luasCol = headerRowArr.findIndex((v) => normLabel(v) === 'luas');

  // ---- Pass 1: extract clean (blok, year, unsur) readings (pure, no db access). ----
  let rowsRead = 0;
  let rowsSkippedLocation = 0;
  const blokRows = []; // { kebunRaw, afdRaw, blokRaw, tahunTanam, luas, readings: [{year, unsur, hasil, code}] }

  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const kebunRaw = row[kebunCol];
    const afdRaw = row[afdCol];
    const blokRaw = row[blokCol];
    const allBlank = (kebunRaw === '' || kebunRaw == null) && (afdRaw === '' || afdRaw == null) && (blokRaw === '' || blokRaw == null);
    if (allBlank) continue; // spacer row, not data at all
    rowsRead++;

    if (kebunRaw === '' || kebunRaw == null || afdRaw === '' || afdRaw == null || blokRaw === '' || blokRaw == null) {
      rowsSkippedLocation++; // e.g. trailing legend rows with only a Kebun name
      continue;
    }

    const readings = [];
    for (const year of years) {
      const hasilCols = hasilMap[year];
      const codeCols = codeMap[year] || {};
      for (const unsur of Object.keys(hasilCols)) {
        const hv = row[hasilCols[unsur]];
        if (!isCleanNumber(hv)) continue; // blank or non-numeric (e.g. stray whitespace cell) -- skip just this reading
        const cv = codeCols[unsur] !== undefined ? row[codeCols[unsur]] : null;
        readings.push({ year, unsur, hasil: hv, code: cv });
      }
    }
    if (!readings.length) continue; // row resolvable but had no clean numeric reading at all

    blokRows.push({
      kebunRaw: String(kebunRaw).trim(),
      afdRaw,
      blokRaw: String(blokRaw).trim(),
      tahunTanam: ttCol >= 0 ? (isCleanNumber(row[ttCol]) ? row[ttCol] : null) : null,
      luas: luasCol >= 0 ? (isCleanNumber(row[luasCol]) ? row[luasCol] : null) : null,
      readings,
    });
  }

  // ---- Pass 2: resolve/create master data + insert, all inside one transaction. ----
  const estateCache = new Map();
  const afdelingCache = new Map();
  const blokCache = new Map();
  let estatesCreated = 0;
  let afdelingsCreated = 0;
  let bloksCreated = 0;
  let committed = 0;
  let failed = 0;
  const failures = [];
  const now = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO leaf_analysis (blok_id, tanggal, unsur_hara, hasil, severity, status, input_by_role, user_id, catatan, created_at, updated_at)
    VALUES (@blok_id, @tanggal, @unsur_hara, @hasil, NULL, 'OPEN', 'RISET', NULL, @catatan, @created_at, @updated_at)
  `);

  const runImport = db.transaction(() => {
    function resolveEstate(kebunRaw) {
      let estate = estateCache.get(kebunRaw);
      if (estate) return estate;
      estate = findEstateByCode(db, kebunRaw);
      if (!estate) {
        const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(kebunRaw, kebunRaw);
        estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
        estatesCreated++;
      }
      estateCache.set(kebunRaw, estate);
      return estate;
    }

    function resolveBlok(rec) {
      const estate = resolveEstate(rec.kebunRaw);
      const afdCode = afdCodeFromRaw(rec.afdRaw);
      const afdKey = `${estate.id}|${afdCode}`;
      let afd = afdelingCache.get(afdKey);
      if (!afd) {
        afd = findAfdelingByCode(db, estate.id, afdCode);
        if (!afd) {
          const info = db
            .prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)')
            .run(estate.id, afdCode, `Afdeling ${afdCode}`);
          afd = db.prepare('SELECT * FROM afdeling WHERE id=?').get(info.lastInsertRowid);
          afdelingsCreated++;
        }
        afdelingCache.set(afdKey, afd);
      }

      const blokKey = `${afd.id}|${rec.blokRaw}`;
      let blok = blokCache.get(blokKey);
      if (!blok) {
        blok = findBlokByCode(db, afd.id, rec.blokRaw);
        if (!blok) {
          const info = db
            .prepare('INSERT INTO blok (afdeling_id, code, name, luas, tahun_tanam) VALUES (?, ?, ?, ?, ?)')
            .run(afd.id, rec.blokRaw, `Blok ${rec.blokRaw}`, rec.luas, rec.tahunTanam);
          blok = db.prepare('SELECT * FROM blok WHERE id=?').get(info.lastInsertRowid);
          bloksCreated++;
        }
        blokCache.set(blokKey, blok);
      }
      return blok;
    }

    for (const rec of blokRows) {
      let blok;
      try {
        blok = resolveBlok(rec);
      } catch (e) {
        failed += rec.readings.length;
        failures.push({ kebun: rec.kebunRaw, afd: rec.afdRaw, blok: rec.blokRaw, error: `Blok tidak bisa diresolusi/dibuat: ${e.message}` });
        continue;
      }

      for (const reading of rec.readings) {
        try {
          insertStmt.run({
            blok_id: blok.id,
            tanggal: `${reading.year}-01-01`,
            unsur_hara: reading.unsur,
            hasil: reading.hasil,
            catatan: catatanFor(reading.year, reading.code),
            created_at: now,
            updated_at: now,
          });
          committed++;
        } catch (e) {
          failed++;
          failures.push({ kebun: rec.kebunRaw, afd: rec.afdRaw, blok: rec.blokRaw, year: reading.year, unsur: reading.unsur, error: e.message });
        }
      }
    }

    db.prepare(
      `INSERT INTO import_log (entity_type, filename, total_rows, valid_rows, error_rows, status, committed_count)
       VALUES (?, ?, ?, ?, ?, 'COMMITTED', ?)`
    ).run(ENTITY_TYPE, FILENAME, rowsRead, blokRows.length, rowsSkippedLocation, committed);
  });

  runImport();

  if (failures.length) {
    notes.push(`${failures.length} pembacaan gagal diinsert (contoh, maks 20 ditampilkan): ${JSON.stringify(failures.slice(0, 20))}`);
  }
  notes.push(`${rowsSkippedLocation} baris dilewati karena Kebun/Afdeling/Blok tidak lengkap (lokasi tidak bisa diresolusi).`);
  notes.push(`Estate dibuat: ${estatesCreated}, Afdeling dibuat: ${afdelingsCreated}, Blok dibuat: ${bloksCreated}.`);

  return {
    skipped: false,
    committed,
    failed,
    rowsRead,
    rowsSkippedLocation,
    estatesCreated,
    afdelingsCreated,
    bloksCreated,
    notes,
  };
};
