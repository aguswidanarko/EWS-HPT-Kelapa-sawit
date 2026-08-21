// Import Data (Excel) — SPEC.md section 7 "Import Data". Supports Deteksi/Sensus/Pengendalian
// (+Mortalitas). Flow: upload -> preview (validate every row, count valid/error, list errors) ->
// commit (only with explicit confirm=true, never partial-imports silently).
// Also serves downloadable Excel templates matching each table's structure (header + example row
// + a data-dictionary sheet).

const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { ingestDetection, ingestSensus, ingestTreatment, ingestMortality } = require('../services/ingestion');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

// -------------------------------------------------------------- Templates
const TEMPLATES = {
  DETECTION: {
    headers: ['estate_code', 'afdeling_code', 'blok_code', 'tanggal', 'waktu', 'hpt_code', 'baris', 'posisi', 'gejala', 'kondisi_indikator', 'jumlah_indikasi', 'catatan', 'gps_lat', 'gps_lng'],
    example: ['EST1', 'AFD1', 'B01', '2026-08-20', '09:00', 'UPDKS', 13, 5, 'Daun berlubang', 'Ulat terlihat', 3.5, 'Contoh catatan', -2.1, 101.5],
    dictionary: [
      ['Kolom', 'Wajib', 'Format', 'Keterangan'],
      ['estate_code', 'ya', 'text', 'Kode Estate sesuai Master Data'],
      ['afdeling_code', 'ya', 'text', 'Kode Afdeling sesuai Master Data'],
      ['blok_code', 'ya', 'text', 'Kode Blok sesuai Master Data'],
      ['tanggal', 'ya', 'YYYY-MM-DD', 'Tanggal deteksi'],
      ['hpt_code', 'ya', 'text', 'Kode HPT sesuai Master Data, mis. UPDKS/TIKUS/ORYCTES/RAYAP/GANODERMA'],
      ['jumlah_indikasi', 'tidak', 'angka', 'Jika diisi, threshold engine otomatis mengevaluasi'],
      ['gps_lat / gps_lng', 'tidak', 'angka desimal', 'Koordinat GPS'],
    ],
  },
  SENSUS: {
    headers: ['estate_code', 'afdeling_code', 'blok_code', 'tanggal', 'jenis_sensus (hpt_code)', 'hasil_json'],
    example: ['EST1', 'AFD1', 'B01', '2026-08-20', 'UPDKS', '{"ulat_hidup_total":10,"jumlah_pelepah_diamati":2}'],
    dictionary: [
      ['Kolom', 'Wajib', 'Format', 'Keterangan'],
      ['jenis_sensus', 'ya', 'text (hpt_code)', 'UPDKS/TIKUS/ORYCTES/RAYAP/GANODERMA'],
      ['hasil_json', 'ya', 'JSON text', 'Field sesuai rumus per HPT, lihat README backend'],
    ],
  },
  TREATMENT: {
    headers: ['estate_code', 'afdeling_code', 'blok_code', 'hpt_code', 'tanggal_mulai', 'tanggal_selesai', 'metode_pengendalian', 'jumlah_pokok', 'hk', 'material', 'jumlah_material', 'alat', 'pic'],
    example: ['EST1', 'AFD1', 'B01', 'UPDKS', '2026-08-21', '2026-08-22', 'fogging', 50, 4, 'Insektisida X', 5, 'Mist blower', 'Budi'],
    dictionary: [
      ['Kolom', 'Wajib', 'Format', 'Keterangan'],
      ['hpt_code', 'ya', 'text', 'Kode HPT terkait'],
      ['metode_pengendalian', 'ya', 'text', 'drone spraying/fogging/manual/racun tikus/lainnya'],
    ],
  },
  MORTALITY: {
    headers: ['tanggal', 'blok_code', 'sampel', 'jumlah_hidup', 'jumlah_mati', 'kondisi'],
    example: ['2026-08-23', 'B01', 20, 3, 17, 'Baik'],
    dictionary: [
      ['Kolom', 'Wajib', 'Format', 'Keterangan'],
      ['sampel', 'ya', 'angka', 'Jumlah sampel diamati'],
      ['jumlah_hidup', 'ya', 'angka', 'Digunakan untuk evaluasi efektivitas treatment'],
    ],
  },
};

router.get(
  '/template/:entity',
  asyncHandler(async (req, res) => {
    const entity = req.params.entity.toUpperCase();
    const tpl = TEMPLATES[entity];
    if (!tpl) return res.status(404).json({ error: `Template tidak tersedia untuk ${entity}` });
    const wb = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.aoa_to_sheet([tpl.headers, tpl.example]);
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Data');
    const dictSheet = XLSX.utils.aoa_to_sheet(tpl.dictionary);
    XLSX.utils.book_append_sheet(wb, dictSheet, 'Data Dictionary');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="template_${entity.toLowerCase()}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

// -------------------------------------------------------------- helpers
function lookupMaster(code, table) {
  if (!code) return null;
  return db.prepare(`SELECT * FROM ${table} WHERE code=?`).get(String(code).trim());
}

function validateRow(entity, row, idx) {
  const errors = [];
  const blok = lookupMaster(row.blok_code, 'blok');
  let hpt = null;
  if (entity !== 'MORTALITY') {
    const hptCode = entity === 'SENSUS' ? row['jenis_sensus (hpt_code)'] || row.jenis_sensus : row.hpt_code;
    hpt = lookupMaster(hptCode, 'hpt');
    if (!hpt) errors.push(`baris ${idx}: hpt_code/jenis_sensus tidak dikenal`);
  }
  if (entity !== 'MORTALITY' && !blok) errors.push(`baris ${idx}: blok_code tidak dikenal`);
  if (entity === 'MORTALITY' && !blok) errors.push(`baris ${idx}: blok_code tidak dikenal`);
  if (entity !== 'TREATMENT' && !row.tanggal) errors.push(`baris ${idx}: tanggal wajib diisi`);
  if (entity === 'TREATMENT' && !row.tanggal_mulai) errors.push(`baris ${idx}: tanggal_mulai wajib diisi`);
  if (entity === 'SENSUS') {
    try {
      JSON.parse(row.hasil_json || '{}');
    } catch (e) {
      errors.push(`baris ${idx}: hasil_json bukan JSON valid`);
    }
  }
  if (row.tanggal && Number.isNaN(Date.parse(row.tanggal))) errors.push(`baris ${idx}: format tanggal tidak valid`);
  return { errors, blok, hpt };
}

// -------------------------------------------------------------- preview
router.post(
  '/preview/:entity',
  requireRole('ADMIN', 'RND_FOD'),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    const entity = req.params.entity.toUpperCase();
    if (!TEMPLATES[entity]) return res.status(400).json({ error: `entity tidak dikenal: ${entity}` });
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });

    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const validRows = [];
    const errorRows = [];
    rows.forEach((row, i) => {
      const { errors } = validateRow(entity, row, i + 2); // +2: header row + 1-index
      if (errors.length) errorRows.push({ row: i + 2, errors, data: row });
      else validRows.push(row);
    });

    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, entity, req.file.originalname, rows.length, validRows.length, errorRows.length, JSON.stringify(errorRows));

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
  '/commit/:entity',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const entity = req.params.entity.toUpperCase();
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
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const { errors, blok, hpt } = validateRow(entity, row, i + 2);
      if (errors.length) continue; // skip invalid rows silently at commit time (already surfaced at preview)
      try {
        if (entity === 'DETECTION') {
          ingestDetection(
            { blok_id: blok.id, hpt_id: hpt.id, tanggal: row.tanggal, waktu: row.waktu, baris: row.baris, posisi: row.posisi, gejala: row.gejala, kondisi_indikator: row.kondisi_indikator, jumlah_indikasi: row.jumlah_indikasi, catatan: row.catatan, gps_lat: row.gps_lat, gps_lng: row.gps_lng, source: 'EXCEL' },
            { user_id: req.user.id }
          );
        } else if (entity === 'SENSUS') {
          ingestSensus(
            { blok_id: blok.id, jenis_sensus: hpt.code, tanggal: row.tanggal, hasil_json: JSON.parse(row.hasil_json || '{}'), source: 'EXCEL' },
            { user_id: req.user.id }
          );
        } else if (entity === 'TREATMENT') {
          ingestTreatment(
            { blok_id: blok.id, hpt_id: hpt.id, tanggal_mulai: row.tanggal_mulai, tanggal_selesai: row.tanggal_selesai, metode_pengendalian: row.metode_pengendalian, jumlah_pokok: row.jumlah_pokok, hk: row.hk, material: row.material, jumlah_material: row.jumlah_material, alat: row.alat, pic: row.pic, source: 'EXCEL' },
            { user_id: req.user.id }
          );
        } else if (entity === 'MORTALITY') {
          ingestMortality(
            { blok_id: blok.id, tanggal: row.tanggal, sampel: row.sampel, jumlah_hidup: row.jumlah_hidup, jumlah_mati: row.jumlah_mati, kondisi: row.kondisi, source: 'EXCEL' },
            { user_id: req.user.id }
          );
        }
        committed++;
      } catch (e) {
        failures.push({ row: i + 2, error: e.message });
      }
    }

    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(committed, log.id);
    auditFromReq(req, { aktivitas: `IMPORT_EXCEL_${entity}`, after: { import_log_id: log.id, committed, failures } });
    res.json({ data: { committed, failed: failures.length, failures } });
  })
);

router.get(
  '/log',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    res.json({ data: db.prepare('SELECT * FROM import_log ORDER BY created_at DESC LIMIT 200').all() });
  })
);

module.exports = router;
