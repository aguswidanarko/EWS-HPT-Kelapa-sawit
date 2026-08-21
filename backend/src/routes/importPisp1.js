// Import Data (PISP1 monthly recap workbook) -- docs/IMPORT_FORMAT_PISP1.md.
// Same anti-partial-import discipline as routes/importExcel.js (BRD 02 section 28): upload ->
// preview (parse-only, no db writes) -> commit (only with explicit confirm:true).
// All classification/incident/alert logic is delegated to services/importPisp1.js, which itself
// reuses services/ingestion.js (-> sensusEngines.js / thresholdEngine.js) -- nothing duplicated here.

const express = require('express');
const fs = require('fs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { previewFile, commitFile } = require('../services/importPisp1');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/preview',
  requireRole('ADMIN', 'RND_FOD'),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });

    let result;
    try {
      result = previewFile(req.file.path);
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, 'PISP1', ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(
        req.user.id,
        req.file.originalname,
        result.totals.rows_read,
        result.totals.records_valid,
        result.totals.errors,
        JSON.stringify({ sheets: result.sheets, out_of_scope: result.out_of_scope })
      );

    res.json({
      data: {
        import_log_id: info.lastInsertRowid,
        file_path: req.file.path,
        ...result,
      },
    });
  })
);

router.post(
  '/commit',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) {
      return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true (no partial import tanpa konfirmasi eksplisit)' });
    }
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (log.status === 'COMMITTED') return res.status(400).json({ error: 'Import ini sudah pernah di-commit sebelumnya.' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    let result;
    try {
      result = commitFile(file_path, { user_id: req.user.id });
    } catch (e) {
      return res.status(400).json({ error: `Gagal mengimpor file: ${e.message}` });
    }

    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(result.totals.committed, log.id);
    auditFromReq(req, { aktivitas: 'IMPORT_PISP1', after: { import_log_id: log.id, ...result } });

    res.json({ data: result });
  })
);

module.exports = router;
