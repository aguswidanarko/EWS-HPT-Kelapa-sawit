// Importer for the real-world "REKAP HPT PISP1" monthly recap workbook (docs/IMPORT_FORMAT_PISP1.md).
// Unlike routes/importExcel.js (flat "one row = one observation" templates), this is a pivot
// format: one row per Blok, columns per month/rotation, header rows offset by a few rows and
// occasionally shifted between files/years. So headers are located dynamically by LABEL TEXT
// (Afdeling/Blok/Ha/Jan.../TGL SENSUS/...), never by hard-coded row/column numbers.
//
// This module ONLY normalizes+extracts records and (on commit) resolves/creates master Blok rows.
// All classification/incident/alert logic is delegated to the EXISTING services -- nothing here
// re-implements thresholdEngine or sensusEngines:
//   - services/ingestion.js  ingestSensus() / ingestTreatment()  (which themselves call
//     services/sensusEngines.js computeByHptCode() and services/thresholdEngine.js runThresholdEngine())
//
// 6 in-scope sheets (BRD-covered HPT): REKAP SNS UPDKS, REKAP SNS TIKUS, SNSS ORYCTES, SNSS RAYAP,
// SNS GANODERMA, REKAP PENGENDALIAN TIKUS. See OUT_OF_SCOPE_NOTES below for sheets intentionally
// NOT built (KBH beetle-trap monitoring, Beneficial Plant) -- these are a requirement gap noted in
// the preview response, not silently dropped.

const XLSX = require('xlsx');
const db = require('../db/db');
const { ingestSensus, ingestTreatment } = require('./ingestion');

// ---------------------------------------------------------------------------------------------
// Documented conventions (surfaced to the caller via `assumptions` in the preview/commit result):
// ---------------------------------------------------------------------------------------------
const ASSUMPTIONS = [
  'Sel bulan/rotasi yang KOSONG atau bernilai 0 diperlakukan sebagai "belum disensus" dan DILEWATI '
  + '(tidak membuat record sensus palsu) -- rekap ini tidak punya penanda terpisah "sudah disensus, hasil nihil" '
  + 'vs "belum diisi", jadi konvensi yang dipakai konsisten adalah: kosong/nol = lewati. Pengecualian: SNSS ORYCTES '
  + 'punya kolom "Jumlah Sampel" sebagai penanda "sudah disensus" yang sesungguhnya, jadi bulan-blok Oryctes hanya '
  + 'dilewati jika Jumlah Sampel itu sendiri kosong/nol.',
  'REKAP SNS UPDKS & REKAP SNS TIKUS hanya memuat rata-rata/persentase hasil akhir per Blok per bulan (bukan hitungan '
  + 'mentah per baris sampel). Untuk tetap memakai formula & engine yang SUDAH ADA (services/sensusEngines.js) tanpa '
  + 'duplikasi logika, nilai itu dikonversi ke input formula yang secara matematis menghasilkan angka akhir yang sama '
  + '(UPDKS: ulat_hidup_total=nilai, jumlah_pelepah_diamati=1; TIKUS: serangan_baru=nilai, serangan_lama=0, jumlah_sampel=100). '
  + 'Hasil hitung akhir (ekor/pelepah / %) identik dengan angka di rekap; hanya representasi mentahnya sintetis.',
  'REKAP SNS UPDKS adalah rekap agregat tanpa breakdown spesies (Ulat Api vs Ulat Kantong). Karena tabel THRESHOLD '
  + 'UPDKS dikunci per grup spesies, data hasil import diberi species default kode "UA" (Ulat Api lainnya) supaya '
  + 'tetap bisa diklasifikasi -- ini asumsi yang perlu dikonfirmasi ke user (apakah rekap ini representatif ulat api).',
  'SNS GANODERMA: kolom S1-S4 adalah JUMLAH POKOK per kriteria keparahan (bukan status tunggal per Blok). Status '
  + 'kualitatif blok diambil dari kriteria TERTINGGI yang jumlahnya >0 (S4>S3>S2>S1), sesuai skala ordinal '
  + 'GANODERMA_SCALE di services/sensusEngines.js; jika semua nol -> TIDAK_ADA.',
  'SNSS ORYCTES: "jumlah_pokok_terserang" diambil dari kolom Jumlah pada kategori "Serangan Baru" bulan tsb; '
  + '"jumlah_pokok_diamati" dari kolom "Jumlah Sampel" (satu nilai dipakai bersama utk kedua blok bulan pada baris '
  + 'yang sama, karena sheet hanya punya satu kolom Jumlah Sampel per baris).',
  'REKAP PENGENDALIAN TIKUS: SETIAP kelompok kolom (Rotasi 1..5, Sensus Awal, Sensus Sesudah Kampanye -- termasuk '
  + 'kelompok berlabel ganda pada file contoh) menghasilkan satu record TREATMENT (metode "Racun Tikus") jika '
  + 'kolom Tanggal kelompok itu terisi, sesuai instruksi IMPORT_FORMAT_PISP1.md butir 6.',
  'Afdeling/Blok/Estate yang belum ada di Master Data dibuat otomatis dari kolom Afdeling+Block+Ha+Tahun Tanam '
  + '(match by afdeling code + blok code); Blok yang SUDAH ADA tidak pernah ditimpa/diubah oleh importer ini.',
  'Sel "Tanggal"/"TGL SENSUS" yang kosong pada baris yang tetap dianggap valid (mis. blok bulan Oryctes tanpa '
  + 'tanggal eksplisit) diberi tanggal default tanggal 1 pada bulan/tahun kolom tsb -- ditandai di catatan record.',
];

const OUT_OF_SCOPE_NOTES = {
  'Rekap ESTATE UPDKS': 'Laporan agregat turunan (bukan data input mentah) -- dashboard sudah punya reporting/peta sendiri untuk agregat serupa.',
  'REKAP P UPDKS PERIODE JAN': 'Laporan agregat turunan (view periode) -- tidak perlu diimport.',
  'REKAP P UPDKS PERIODE MAR  ': 'Laporan agregat turunan (view periode) -- tidak perlu diimport.',
  'REKAP ESTATE TIKUS': 'Laporan agregat turunan (bukan data input mentah).',
  'REKAP SNS KBH': 'GAP REQUIREMENT: monitoring perangkap KBH (kumbang/predator alami, biokontrol Oryctes) -- kategori HPT/monitoring BARU, bukan salah satu dari 5 HPT BRD (UPDKS/Tikus/Oryctes/Rayap/Ganoderma). Perlu entitas & threshold baru di luar cakupan BRD saat ini; didiskusikan dulu dengan user.',
  'REKAP SNS KBH (2)': 'GAP REQUIREMENT: sama seperti REKAP SNS KBH (varian periode berbeda).',
  'REKAP KBH': 'GAP REQUIREMENT: sama seperti REKAP SNS KBH (rekap agregat KBH).',
  'BENEFICIAL PLANT': 'GAP REQUIREMENT: monitoring tanaman inang musuh alami (pengendalian hayati) -- juga di luar cakupan 5 HPT BRD, kategori monitoring baru.',
  'BENEFICIAL PLANT ': 'GAP REQUIREMENT: sama seperti BENEFICIAL PLANT (varian nama sheet dengan spasi).',
};

const IN_SCOPE_SHEETS = {
  'REKAP SNS UPDKS': { kind: 'pivotMonthly', hptCode: 'UPDKS', recordType: 'SENSUS' },
  'REKAP SNS TIKUS': { kind: 'pivotMonthly', hptCode: 'TIKUS', recordType: 'SENSUS' },
  'SNSS ORYCTES': { kind: 'oryctes', hptCode: 'ORYCTES', recordType: 'SENSUS' },
  'SNSS RAYAP': { kind: 'rayapGanoderma', hptCode: 'RAYAP', recordType: 'SENSUS' },
  'SNS GANODERMA': { kind: 'rayapGanoderma', hptCode: 'GANODERMA', recordType: 'SENSUS' },
  'REKAP PENGENDALIAN TIKUS': { kind: 'pengendalianTikus', hptCode: 'TIKUS', recordType: 'TREATMENT' },
};

// =================================================================================================
// Low-level sheet reading helpers (label-driven, not row/col-number-driven)
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

// =================================================================================================
// Per-sheet extractors -- pure functions, NO db access, return normalized "planned record" lists.
// =================================================================================================

/** REKAP SNS UPDKS / REKAP SNS TIKUS: one row per Blok, one value column per month. */
function extractPivotMonthly(ws, hptCode) {
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

  const monthColsCount = Object.keys(monthCols).length;
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
    let anyValueForRow = 0;

    for (const [mnumStr, col] of Object.entries(monthCols)) {
      const mnum = Number(mnumStr);
      const raw = row[col];
      if (isEmptyOrZero(raw)) {
        rowsSkippedEmpty++;
        continue;
      }
      const value = Number(raw);
      anyValueForRow++;
      try {
        const tanggal = `${year}-${pad2(mnum)}-01`;
        let hasil_json;
        let speciesCode = null;
        if (hptCode === 'UPDKS') {
          hasil_json = { ulat_hidup_total: value, jumlah_pelepah_diamati: 1 };
          speciesCode = 'UA';
        } else {
          hasil_json = { serangan_baru: value, serangan_lama: 0, jumlah_sampel: 100 };
        }
        records.push({
          kind: 'SENSUS',
          hptCode,
          afdRaw: row[afdCol],
          blokRaw,
          ha,
          tahunTanam,
          statusTanaman: null,
          tanggal,
          hasil_json,
          speciesCode,
          raw_value: value,
          catatan: `Import PISP1 (${hptCode === 'UPDKS' ? 'REKAP SNS UPDKS' : 'REKAP SNS TIKUS'}), bulan ${mnum}/${year}${jenisTanah ? `, jenis tanah ${jenisTanah}` : ''}. Nilai asli rekap: ${value}.`,
        });
      } catch (e) {
        errors.push({ blok: blokRaw, month: mnum, message: e.message });
      }
    }
    if (anyValueForRow === 0) {
      // whole row had nothing but empty/zero months -- still counts toward rowsRead/blocks
    }
  }

  return { records, rowsRead, rowsSkippedEmpty, errors, monthColsCount };
}

/** SNSS ORYCTES: two (or more) side-by-side "BULAN <NAME> <YEAR>" blocks, Jumlah/% sub-columns. */
function extractOryctes(ws) {
  const matrix = readMatrix(ws);
  const header = findHeaderRow(matrix, ['afd', 'jumlah sampel'], 20);
  if (!header) return { error: 'Header (Afd/Blok/Jumlah Sampel) tidak ditemukan.' };
  const headerRow = header.row;
  const headerRowArr = matrix[headerRow];
  const afdCol = header.cols['afd'];
  const jumlahSampelCol = header.cols['jumlah sampel'];
  const blokCol = findColByRegex(headerRowArr, /blok/i);
  const luasCol = findColByRegex(headerRowArr, /luas/i);
  const tanggalCol = findColByRegex(headerRowArr, /tanggal/i);
  if (blokCol == null) return { error: 'Kolom Blok tidak ditemukan.' };

  const blockLabelRow = headerRow - 1 >= 0 ? matrix[headerRow - 1] || [] : [];
  const monthBlocks = [];
  for (let c = 0; c < blockLabelRow.length; c++) {
    const v = blockLabelRow[c];
    if (v === '' || v == null) continue;
    const m = String(v).match(/bulan\s+([a-z]+)\s+(\d{4})/i);
    if (m) {
      const monthNum = monthNumFromLabel(m[1]);
      const year = parseInt(m[2], 10);
      if (monthNum) monthBlocks.push({ startCol: c, monthNum, year });
    }
  }
  if (monthBlocks.length === 0) return { error: 'Baris "BULAN <NAMA> <TAHUN>" tidak ditemukan di atas header.' };
  monthBlocks.sort((a, b) => a.startCol - b.startCol);
  for (let i = 0; i < monthBlocks.length; i++) {
    monthBlocks[i].endCol = i + 1 < monthBlocks.length ? monthBlocks[i + 1].startCol - 1 : headerRowArr.length - 1;
  }

  for (const block of monthBlocks) {
    let serangan_baru_col = null;
    for (let c = block.startCol; c <= block.endCol; c++) {
      if (headerRowArr[c] && /serangan\s*baru/i.test(String(headerRowArr[c]))) { serangan_baru_col = c; break; }
    }
    block.serangan_baru_jumlah_col = serangan_baru_col;
  }

  const records = [];
  const errors = [];
  let rowsRead = 0;
  let rowsSkippedEmpty = 0;
  for (let r = headerRow + 2; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const blokRaw = row[blokCol];
    if (blokRaw === '' || blokRaw == null) continue;
    rowsRead++;
    const luas = luasCol != null ? numOrNull(row[luasCol]) : null;
    const rowTanggal = tanggalCol != null ? toISODate(row[tanggalCol]) : null;

    for (const block of monthBlocks) {
      const jumlahSampel = numOrNull(row[jumlahSampelCol]);
      if (jumlahSampel === null || jumlahSampel === 0) {
        rowsSkippedEmpty++;
        continue;
      }
      try {
        const terserang = block.serangan_baru_jumlah_col != null ? (numOrNull(row[block.serangan_baru_jumlah_col]) || 0) : 0;
        const tanggal = rowTanggal || `${block.year}-${pad2(block.monthNum)}-01`;
        records.push({
          kind: 'SENSUS',
          hptCode: 'ORYCTES',
          afdRaw: row[afdCol],
          blokRaw,
          ha: luas,
          tahunTanam: null,
          statusTanaman: null,
          tanggal,
          hasil_json: { jumlah_pokok_terserang: terserang, jumlah_pokok_diamati: jumlahSampel },
          speciesCode: null,
          catatan: `Import PISP1 (SNSS ORYCTES), bulan ${block.monthNum}/${block.year}. Jumlah Sampel=${jumlahSampel}, Serangan Baru(Jumlah)=${terserang}.`,
        });
      } catch (e) {
        errors.push({ blok: blokRaw, month: `${block.monthNum}/${block.year}`, message: e.message });
      }
    }
  }
  return { records, rowsRead, rowsSkippedEmpty, errors, monthColsCount: monthBlocks.length };
}

/** SNSS RAYAP / SNS GANODERMA: one row per Blok, single "current rotation" reading. */
function extractRayapGanoderma(ws, hptCode) {
  const matrix = readMatrix(ws);
  const header = findHeaderRow(matrix, ['areal', 'afd'], 20);
  if (!header) return { error: 'Header (Areal/Afd/Blok) tidak ditemukan.' };
  const headerRowArr = matrix[header.row];
  const arealCol = header.cols['areal'];
  const afdCol = header.cols['afd'];
  const blokCol = findColByRegex(headerRowArr, /blok/i);
  const ttCol = findColByRegex(headerRowArr, /^tt$/i);
  const luasCol = findColByRegex(headerRowArr, /luas/i);
  const pkkCol = findColByRegex(headerRowArr, /^pkk$/i);
  if (blokCol == null) return { error: 'Kolom Blok tidak ditemukan.' };

  let tglSensusRow = null;
  let tglSensusCol = null;
  for (let r = header.row + 1; r <= header.row + 4 && r < matrix.length; r++) {
    const c = findColByRegex(matrix[r] || [], /tgl\s*sensus/i);
    if (c != null) { tglSensusRow = r; tglSensusCol = c; break; }
  }
  if (tglSensusRow == null) return { error: 'Kolom TGL SENSUS tidak ditemukan.' };
  const subRowArr = matrix[tglSensusRow] || [];

  let serBaruCol = null;
  let pokokNormalCol = null;
  const sMap = {};
  if (hptCode === 'RAYAP') {
    // "SERANGAN BARU" (new attack count) vs "SERANGAN RAYAP KEMBALI" (recurrence) -- pick the
    // first exact-ish "serangan baru" match, not the "kembali" one.
    for (let c = 0; c < subRowArr.length; c++) {
      const v = normLabel(subRowArr[c]);
      if (v && v.includes('serangan baru')) { serBaruCol = c; break; }
    }
  } else {
    pokokNormalCol = findColByRegex(subRowArr, /pokok\s*normal/i);
    for (let r2 = tglSensusRow; r2 <= tglSensusRow + 2 && r2 < matrix.length; r2++) {
      const rowArr = matrix[r2] || [];
      for (let c = 0; c < rowArr.length; c++) {
        const v = normLabel(rowArr[c]);
        const m = v.match(/^s([1-4])$/);
        if (m) sMap[Number(m[1])] = c;
      }
      if (Object.keys(sMap).length >= 4) break;
    }
  }

  // data starts at the first row (after tglSensusRow) where the Blok column actually holds a value
  let dataStartRow = null;
  for (let r = tglSensusRow + 1; r < matrix.length; r++) {
    const v = (matrix[r] || [])[blokCol];
    if (v !== '' && v != null) { dataStartRow = r; break; }
  }
  if (dataStartRow == null) return { records: [], rowsRead: 0, rowsSkippedEmpty: 0, errors: [] };

  const records = [];
  const errors = [];
  let rowsRead = 0;
  let rowsSkippedEmpty = 0;
  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const blokRaw = row[blokCol];
    if (blokRaw === '' || blokRaw == null) continue;
    rowsRead++;
    const tglSensus = toISODate(row[tglSensusCol]);
    if (!tglSensus) { rowsSkippedEmpty++; continue; }
    try {
      const areal = arealCol != null ? row[arealCol] : null;
      const tt = ttCol != null ? numOrNull(row[ttCol]) : null;
      const luas = luasCol != null ? numOrNull(row[luasCol]) : null;
      const pkk = pkkCol != null ? numOrNull(row[pkkCol]) : null;
      let hasil_json;
      let catatan;
      if (hptCode === 'RAYAP') {
        const terserang = serBaruCol != null ? (numOrNull(row[serBaruCol]) || 0) : 0;
        hasil_json = { jumlah_pokok_terserang: terserang, jumlah_pokok_diamati: pkk || 0 };
        catatan = `Import PISP1 (SNSS RAYAP), TGL SENSUS ${tglSensus}. Serangan Baru=${terserang}, PKK=${pkk ?? '-'}.`;
      } else {
        const sVals = { 1: numOrNull(row[sMap[1]]) || 0, 2: numOrNull(row[sMap[2]]) || 0, 3: numOrNull(row[sMap[3]]) || 0, 4: numOrNull(row[sMap[4]]) || 0 };
        let status = 'TIDAK_ADA';
        if (sVals[4] > 0) status = 'TERINFEKSI_BERAT';
        else if (sVals[3] > 0) status = 'TERINFEKSI_SEDANG';
        else if (sVals[2] > 0) status = 'TERINFEKSI_RINGAN';
        else if (sVals[1] > 0) status = 'INDIKASI_AWAL';
        hasil_json = { status_serangan: status };
        const pokokNormal = pokokNormalCol != null ? numOrNull(row[pokokNormalCol]) : null;
        catatan = `Import PISP1 (SNS GANODERMA), TGL SENSUS ${tglSensus}. Pokok Normal=${pokokNormal ?? '-'}, S1=${sVals[1]}, S2=${sVals[2]}, S3=${sVals[3]}, S4=${sVals[4]}.`;
      }
      records.push({
        kind: 'SENSUS',
        hptCode,
        afdRaw: row[afdCol],
        blokRaw,
        ha: luas,
        tahunTanam: tt,
        statusTanaman: areal ? String(areal).trim().toUpperCase() : null,
        tanggal: tglSensus,
        hasil_json,
        speciesCode: null,
        catatan,
      });
    } catch (e) {
      errors.push({ blok: blokRaw, message: e.message });
    }
  }
  return { records, rowsRead, rowsSkippedEmpty, errors };
}

/** REKAP PENGENDALIAN TIKUS: pivot per Blok, column groups "Rotasi N" / "Sensus Awal" / "Sensus Sesudah Kampanye". */
function extractPengendalianTikus(ws) {
  const matrix = readMatrix(ws);
  const merges = ws['!merges'] || [];
  const header = findHeaderRow(matrix, ['afd', 'luas'], 20);
  if (!header) return { error: 'Header (Afd/Blok/Luas) tidak ditemukan.' };
  const groupHeaderRow = header.row;
  const headerRowArr = matrix[groupHeaderRow];
  const afdCol = header.cols['afd'];
  const luasCol = header.cols['luas'];
  const blokCol = findColByRegex(headerRowArr, /blok/i);
  if (blokCol == null) return { error: 'Kolom Blok tidak ditemukan.' };

  const subHeaderRow = matrix[groupHeaderRow + 1] || [];

  // Build column-group spans from merges anchored on the group header row; fall back to
  // single-column groups for any non-empty, not-yet-covered cell on that row.
  const spans = [];
  const covered = new Set();
  for (const m of merges) {
    if (m.s.r === groupHeaderRow) {
      const label = headerRowArr[m.s.c];
      if (label !== '' && label != null) {
        spans.push({ label: String(label).trim(), start: m.s.c, end: m.e.c });
        for (let c = m.s.c; c <= m.e.c; c++) covered.add(c);
      }
    }
  }
  for (let c = 0; c < headerRowArr.length; c++) {
    if (covered.has(c)) continue;
    const v = headerRowArr[c];
    if (v !== '' && v != null && c !== afdCol && c !== blokCol && c !== luasCol) {
      spans.push({ label: String(v).trim(), start: c, end: c });
    }
  }
  spans.sort((a, b) => a.start - b.start);
  // Disambiguate repeated labels (the sample file re-uses "Rotasi 4" / "Sensus Sesudah Kampanye").
  const seenLabels = new Map();
  for (const s of spans) {
    const n = (seenLabels.get(s.label) || 0) + 1;
    seenLabels.set(s.label, n);
    s.displayLabel = n > 1 ? `${s.label} (kol ${XLSX.utils.encode_col(s.start)})` : s.label;
  }

  for (const s of spans) {
    s.cols = {};
    for (let c = s.start; c <= s.end; c++) {
      const v = normLabel(subHeaderRow[c]);
      if (!v) continue;
      if (v.includes('tanggal')) s.cols.tanggal = c;
      else if (v.includes('jmlh racun') || v.includes('jumlah racun')) s.cols.jumlah_racun = c;
      else if (v.includes('umpan hilang')) s.cols.pct_umpan_hilang = c;
      else if (v.includes('serangan baru')) s.cols.pct_serangan_baru = c;
      else if (v.includes('jmlh pkk') || v.includes('jumlah pkk')) s.cols.jumlah_pkk = c;
      else if (v === 'hk') s.cols.hk = c;
    }
  }
  const validSpans = spans.filter((s) => s.cols.tanggal !== undefined);

  const dataStartRow = groupHeaderRow + 2;
  const records = [];
  const errors = [];
  let rowsRead = 0;
  let rowsSkippedEmpty = 0;
  for (let r = dataStartRow; r < matrix.length; r++) {
    const row = matrix[r] || [];
    const blokRaw = row[blokCol];
    if (blokRaw === '' || blokRaw == null) continue;
    rowsRead++;
    const luas = luasCol != null ? numOrNull(row[luasCol]) : null;

    for (const span of validSpans) {
      const tanggal = toISODate(row[span.cols.tanggal]);
      if (!tanggal) { rowsSkippedEmpty++; continue; }
      try {
        const jumlahRacun = span.cols.jumlah_racun != null ? numOrNull(row[span.cols.jumlah_racun]) : null;
        const jumlahPkk = span.cols.jumlah_pkk != null ? numOrNull(row[span.cols.jumlah_pkk]) : null;
        const hk = span.cols.hk != null ? numOrNull(row[span.cols.hk]) : null;
        const pctUmpan = span.cols.pct_umpan_hilang != null ? numOrNull(row[span.cols.pct_umpan_hilang]) : null;
        const pctSerangan = span.cols.pct_serangan_baru != null ? numOrNull(row[span.cols.pct_serangan_baru]) : null;
        const notes = [];
        if (pctUmpan != null) notes.push(`% Umpan Hilang=${pctUmpan}`);
        if (pctSerangan != null) notes.push(`% Serangan Baru=${pctSerangan}`);
        records.push({
          kind: 'TREATMENT',
          hptCode: 'TIKUS',
          afdRaw: row[afdCol],
          blokRaw,
          ha: luas,
          tahunTanam: null,
          statusTanaman: null,
          tanggal,
          metode: 'Racun Tikus',
          jumlah_material: jumlahRacun,
          material: jumlahRacun != null ? 'Racun Tikus' : null,
          jumlah_pokok: jumlahPkk,
          hk,
          catatan: `Import PISP1 (REKAP PENGENDALIAN TIKUS), kelompok "${span.displayLabel}", Tanggal ${tanggal}${notes.length ? '. ' + notes.join(', ') : ''}.`,
        });
      } catch (e) {
        errors.push({ blok: blokRaw, group: span.displayLabel, message: e.message });
      }
    }
  }
  return { records, rowsRead, rowsSkippedEmpty, errors, monthColsCount: validSpans.length, groups: validSpans.map((s) => s.displayLabel) };
}

// =================================================================================================
// Estate label detection + workbook-level extraction
// =================================================================================================

function detectEstateLabel(wb) {
  for (const name of Object.keys(IN_SCOPE_SHEETS)) {
    if (!wb.SheetNames.includes(name)) continue;
    const ws = wb.Sheets[name];
    if (!ws['!ref']) continue;
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let r = range.s.r; r <= Math.min(range.e.r, 12); r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'string') {
          const m = cell.v.match(/PISP\s*\d+/i);
          if (m) return m[0].replace(/\s+/g, ' ').trim();
        }
      }
    }
  }
  return null;
}

function extractWorkbook(wb) {
  const estateLabel = detectEstateLabel(wb) || 'PISP1';
  const sheets = [];
  for (const [sheetName, meta] of Object.entries(IN_SCOPE_SHEETS)) {
    if (!wb.SheetNames.includes(sheetName)) {
      sheets.push({ sheet: sheetName, present: false, hptCode: meta.hptCode, recordType: meta.recordType, error: 'Sheet tidak ditemukan pada file ini.' });
      continue;
    }
    const ws = wb.Sheets[sheetName];
    let out;
    try {
      if (meta.kind === 'pivotMonthly') out = extractPivotMonthly(ws, meta.hptCode);
      else if (meta.kind === 'oryctes') out = extractOryctes(ws);
      else if (meta.kind === 'rayapGanoderma') out = extractRayapGanoderma(ws, meta.hptCode);
      else if (meta.kind === 'pengendalianTikus') out = extractPengendalianTikus(ws);
      else out = { error: `Sheet kind tidak dikenal: ${meta.kind}` };
    } catch (e) {
      out = { error: e.message };
    }
    sheets.push({ sheet: sheetName, present: true, hptCode: meta.hptCode, recordType: meta.recordType, ...out });
  }
  const outOfScope = Object.keys(OUT_OF_SCOPE_NOTES)
    .filter((s) => wb.SheetNames.includes(s))
    .map((s) => ({ sheet: s, note: OUT_OF_SCOPE_NOTES[s] }));
  const unknownSheets = wb.SheetNames.filter(
    (s) => !IN_SCOPE_SHEETS[s] && !OUT_OF_SCOPE_NOTES[s]
  );
  return { estateLabel, sheets, outOfScope, unknownSheets };
}

// =================================================================================================
// Master data (Estate/Afdeling/Blok) resolution helpers
// =================================================================================================

function normEstateCode(label) {
  return String(label).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function afdCodeFromRaw(raw) {
  const s = String(raw == null ? '' : raw).trim();
  return /^afd/i.test(s) ? s.toUpperCase() : `AFD${s}`;
}
function findEstateByCode(code) {
  return db.prepare('SELECT * FROM estate WHERE code=?').get(code);
}
function findAfdelingByCode(estate_id, code) {
  return db.prepare('SELECT * FROM afdeling WHERE estate_id=? AND code=?').get(estate_id, code);
}
function findBlokByCode(afdeling_id, code) {
  return db.prepare('SELECT * FROM blok WHERE afdeling_id=? AND code=?').get(afdeling_id, code);
}

/** Merge ha/tahun_tanam/status_tanaman facts about each (afd,blok) across ALL sheets, used ONLY
 *  when a Blok needs to be CREATED (never to overwrite an existing Blok row). */
function buildBlokFacts(sheets) {
  const facts = new Map();
  for (const sr of sheets) {
    if (!sr.records) continue;
    for (const rec of sr.records) {
      const key = `${afdCodeFromRaw(rec.afdRaw)}|${String(rec.blokRaw).trim()}`;
      const cur = facts.get(key) || {};
      if (rec.ha != null && cur.ha == null) cur.ha = rec.ha;
      if (rec.tahunTanam != null && cur.tahunTanam == null) cur.tahunTanam = rec.tahunTanam;
      if (rec.statusTanaman && !cur.statusTanaman) cur.statusTanaman = rec.statusTanaman;
      facts.set(key, cur);
    }
  }
  return facts;
}

// =================================================================================================
// Public: preview (read-only) and commit (writes, reuses ingestSensus/ingestTreatment)
// =================================================================================================

function previewFile(filePath) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const extracted = extractWorkbook(wb);
  const estateCode = normEstateCode(extracted.estateLabel);
  const estate = findEstateByCode(estateCode);

  const globalNewBlok = new Set();
  const globalExistingBlok = new Set();
  const blokExistsCache = new Map();

  function blokExists(afdCode, blokCode) {
    const key = `${afdCode}|${blokCode}`;
    if (blokExistsCache.has(key)) return blokExistsCache.get(key);
    let exists = false;
    if (estate) {
      const afd = findAfdelingByCode(estate.id, afdCode);
      if (afd) exists = !!findBlokByCode(afd.id, blokCode);
    }
    blokExistsCache.set(key, exists);
    return exists;
  }

  const sheets = extracted.sheets.map((sr) => {
    if (!sr.records) {
      return {
        sheet: sr.sheet, present: sr.present !== false, hpt: sr.hptCode, record_type: sr.recordType,
        rows_read: 0, records_valid: 0, rows_skipped_empty: 0, blocks_detected: 0, blocks_new: 0, blocks_existing: 0,
        errors: sr.error ? [{ message: sr.error }] : (sr.errors || []),
      };
    }
    let newBloks = 0;
    let existingBloks = 0;
    const blokSet = new Set();
    for (const rec of sr.records) {
      const afdCode = afdCodeFromRaw(rec.afdRaw);
      const blokCode = String(rec.blokRaw).trim();
      blokSet.add(`${afdCode}|${blokCode}`);
    }
    for (const key of blokSet) {
      const [afdCode, blokCode] = key.split('|');
      const exists = blokExists(afdCode, blokCode);
      if (exists) { existingBloks++; globalExistingBlok.add(key); } else { newBloks++; globalNewBlok.add(key); }
    }
    return {
      sheet: sr.sheet, present: true, hpt: sr.hptCode, record_type: sr.recordType,
      rows_read: sr.rowsRead || 0, records_valid: sr.records.length, rows_skipped_empty: sr.rowsSkippedEmpty || 0,
      blocks_detected: blokSet.size, blocks_new: newBloks, blocks_existing: existingBloks,
      groups: sr.groups, errors: sr.errors || [],
    };
  });

  const totals = sheets.reduce(
    (acc, s) => {
      acc.rows_read += s.rows_read || 0;
      acc.records_valid += s.records_valid || 0;
      acc.rows_skipped_empty += s.rows_skipped_empty || 0;
      acc.errors += (s.errors || []).length;
      return acc;
    },
    { rows_read: 0, records_valid: 0, rows_skipped_empty: 0, errors: 0 }
  );
  totals.blocks_new = globalNewBlok.size;
  totals.blocks_existing = globalExistingBlok.size;

  return {
    estate: { code: estateCode, name: extracted.estateLabel, exists: !!estate },
    sheets,
    totals,
    out_of_scope: extracted.outOfScope,
    unknown_sheets: extracted.unknownSheets,
    assumptions: ASSUMPTIONS,
  };
}

function commitFile(filePath, ctx) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const extracted = extractWorkbook(wb);
  const estateCode = normEstateCode(extracted.estateLabel);

  let estate = findEstateByCode(estateCode);
  let estateCreated = false;
  if (!estate) {
    const info = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run(estateCode, extracted.estateLabel);
    estate = db.prepare('SELECT * FROM estate WHERE id=?').get(info.lastInsertRowid);
    estateCreated = true;
  }

  const blokFacts = buildBlokFacts(extracted.sheets);
  const afdelingCache = new Map();
  const blokCache = new Map();
  let afdelingsCreated = 0;
  let bloksCreated = 0;

  function resolveBlok(afdRaw, blokRaw) {
    const afdCode = afdCodeFromRaw(afdRaw);
    let afd = afdelingCache.get(afdCode);
    if (!afd) {
      afd = findAfdelingByCode(estate.id, afdCode);
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
      blok = findBlokByCode(afd.id, blokCode);
      if (!blok) {
        const facts = blokFacts.get(`${afdCode}|${blokCode}`) || {};
        const info = db
          .prepare(`INSERT INTO blok (afdeling_id, code, name, luas, tahun_tanam, status_tanaman) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(afd.id, blokCode, `Blok ${blokCode}`, facts.ha ?? null, facts.tahunTanam ?? null, facts.statusTanaman ?? null);
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

  const sheetResults = [];
  const totals = { committed: 0, failed: 0, ews_alert_count: 0 };

  for (const sr of extracted.sheets) {
    if (!sr.records) {
      sheetResults.push({ sheet: sr.sheet, committed: 0, failed: 0, ews_alert_count: 0, note: sr.error || 'Tidak ada data pada sheet ini.' });
      continue;
    }
    let committed = 0;
    let ewsAlertCount = 0;
    const failures = [];
    for (const rec of sr.records) {
      try {
        const hpt = getHpt(rec.hptCode);
        if (!hpt) throw new Error(`HPT code tidak dikenal di master data: ${rec.hptCode}`);
        const blok = resolveBlok(rec.afdRaw, rec.blokRaw);
        if (rec.kind === 'SENSUS') {
          let species_id = null;
          if (rec.speciesCode) {
            const sp = getSpecies(hpt.id, rec.speciesCode);
            species_id = sp ? sp.id : null;
          }
          const out = ingestSensus(
            { blok_id: blok.id, jenis_sensus: rec.hptCode, species_id, tanggal: rec.tanggal, hasil_json: rec.hasil_json, catatan: rec.catatan || null, source: 'EXCEL' },
            ctx
          );
          if (out.engineResult && out.engineResult.ews_alert) ewsAlertCount++;
        } else if (rec.kind === 'TREATMENT') {
          ingestTreatment(
            {
              blok_id: blok.id, hpt_id: hpt.id, tanggal_mulai: rec.tanggal, metode_pengendalian: rec.metode,
              jumlah_pokok: rec.jumlah_pokok, hk: rec.hk, material: rec.material, jumlah_material: rec.jumlah_material,
              catatan: rec.catatan, source: 'EXCEL',
            },
            ctx
          );
        }
        committed++;
      } catch (e) {
        failures.push({ blok: rec.blokRaw, tanggal: rec.tanggal, error: e.message });
      }
    }
    sheetResults.push({ sheet: sr.sheet, committed, failed: failures.length, ews_alert_count: ewsAlertCount, failures: failures.slice(0, 50) });
    totals.committed += committed;
    totals.failed += failures.length;
    totals.ews_alert_count += ewsAlertCount;
  }

  return {
    estate: { code: estate.code, name: estate.name, created: estateCreated },
    afdelings_created: afdelingsCreated,
    bloks_created: bloksCreated,
    sheets: sheetResults,
    totals,
    out_of_scope: extracted.outOfScope,
    assumptions: ASSUMPTIONS,
  };
}

module.exports = {
  IN_SCOPE_SHEETS,
  OUT_OF_SCOPE_NOTES,
  ASSUMPTIONS,
  extractWorkbook,
  previewFile,
  commitFile,
};
