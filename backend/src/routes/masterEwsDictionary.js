// Master EWS Dictionary (BRD V3 backend/docs/brd_v3/BRD_V3_Backend.docx + Dashboard docx) --
// CRUD + Excel preview/commit for the `ews_dictionary` table (the single source of truth mapping
// every EWS_ID to its scope/hpt/planting_stage/threshold text/recommendation, see schema.sql).
// Same two-phase upload idiom as routes/importExcel.js (upload -> preview -> commit with an
// explicit confirm=true gate, import_log ledger row per attempt) but with one addition specific
// to this table: BRD V3's "rule versioning (active rule never overwritten, new version created on
// change)" requirement. Every commit that actually changes an existing EWS_ID's tracked fields
// inserts a NEW rule_version row (entity_type='EWS_DICTIONARY') rather than mutating history away
// -- exactly the pattern seedEwsDictionaryV3.js uses for the initial 32-row seed, applied again
// here for subsequent admin edits/re-uploads. Unchanged rows are left alone (no version churn).
//
// An EWS_ID is never deleted through this route, only deactivated (status=NONAKTIF) -- matches
// the ews_dictionary.status column comment in schema.sql.

const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');
const { listEwsIds } = require('../services/ewsRegistry');

const router = express.Router();
router.use(requireAuth);

const WRITE_ROLES = ['ADMIN', 'RND_FOD'];
const VALID_SCOPES = ['HPT', 'Yield Making', 'Agro', 'WM'];
const VALID_STATUS = ['ACTIVE', 'NONAKTIF'];
const TRACKED_FIELDS = ['scope', 'hpt_id', 'planting_stage', 'threshold_display_text', 'inspection_interval', 'recommendation', 'status'];

// -------------------------------------------------------------- list / detail / version history
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['scope', 'status']) {
      if (req.query[f] !== undefined) {
        clauses.push(`d.${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = `SELECT d.*, h.code AS hpt_code, h.name AS hpt_name FROM ews_dictionary d JOIN hpt h ON h.id = d.hpt_id`;
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY d.ews_id';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

router.get(
  '/:ews_id',
  asyncHandler(async (req, res) => {
    const row = db
      .prepare(`SELECT d.*, h.code AS hpt_code, h.name AS hpt_name FROM ews_dictionary d JOIN hpt h ON h.id = d.hpt_id WHERE d.ews_id = ?`)
      .get(req.params.ews_id);
    if (!row) return res.status(404).json({ error: 'EWS_ID tidak ditemukan' });
    res.json({ data: row });
  })
);

router.get(
  '/:ews_id/versions',
  asyncHandler(async (req, res) => {
    const dict = db.prepare('SELECT id FROM ews_dictionary WHERE ews_id=?').get(req.params.ews_id);
    if (!dict) return res.status(404).json({ error: 'EWS_ID tidak ditemukan' });
    const versions = db
      .prepare(`SELECT * FROM rule_version WHERE entity_type='EWS_DICTIONARY' AND entity_id=? ORDER BY version_no DESC`)
      .all(dict.id);
    res.json({ data: versions });
  })
);

// -------------------------------------------------------------- template
router.get(
  '/meta/template',
  asyncHandler(async (req, res) => {
    const headers = ['EWS_ID', 'Scope', 'HPT_Code', 'Planting_Stage', 'Threshold_Display_Text', 'Inspection_Interval', 'Recommendation', 'Status'];
    const example = ['AGR-006', 'Agro', 'POKOK_DOYONG', 'TBM/TM', '>15 derajat / severity', '2 bulan', 'Hubungi Riset', 'ACTIVE'];
    const wb = XLSX.utils.book_new();
    const dataSheet = XLSX.utils.aoa_to_sheet([headers, example]);
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Data');
    const dictSheet = XLSX.utils.aoa_to_sheet([
      ['Kolom', 'Wajib', 'Format', 'Keterangan'],
      ['EWS_ID', 'ya', 'text', 'mis. HPT-001, AGR-004, YM-001, WM-002. Baru = ditambahkan; sudah ada = diperbarui (versi baru dicatat jika ada perubahan)'],
      ['Scope', 'ya', 'HPT | Yield Making | Agro | WM', ''],
      ['HPT_Code', 'ya', 'text', 'Harus sudah ada di Master Data > Indikator (hpt.code) -- baris ini TIDAK membuat indikator baru'],
      ['Planting_Stage', 'tidak', 'text', 'TM / TBM / TB-0 / TBM/TM / kosongkan jika tidak spesifik tahap'],
      ['Threshold_Display_Text', 'tidak', 'text', 'Teks ambang batas untuk ditampilkan (engine tetap membaca formula/threshold, lihat routes/formulas.js)'],
      ['Inspection_Interval', 'tidak', 'text', ''],
      ['Recommendation', 'tidak', 'text', ''],
      ['Status', 'tidak', 'ACTIVE | NONAKTIF', 'Default ACTIVE. EWS_ID tidak pernah dihapus, hanya dinonaktifkan'],
    ]);
    XLSX.utils.book_append_sheet(wb, dictSheet, 'Data Dictionary');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="template_master_ews_dictionary.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

router.get(
  '/meta/ews-ids',
  asyncHandler(async (req, res) => {
    res.json({ data: listEwsIds(req.query.scope || undefined) });
  })
);

// -------------------------------------------------------------- helpers
function validateRow(row, idx) {
  const errors = [];
  const ews_id = row.EWS_ID ? String(row.EWS_ID).trim() : null;
  const scope = row.Scope ? String(row.Scope).trim() : null;
  const hptCode = row.HPT_Code ? String(row.HPT_Code).trim() : null;
  const status = row.Status ? String(row.Status).trim().toUpperCase() : 'ACTIVE';
  if (!ews_id) errors.push(`baris ${idx}: EWS_ID wajib diisi`);
  if (!scope || !VALID_SCOPES.includes(scope)) errors.push(`baris ${idx}: Scope wajib salah satu dari ${VALID_SCOPES.join(' / ')}`);
  let hpt = null;
  if (!hptCode) {
    errors.push(`baris ${idx}: HPT_Code wajib diisi`);
  } else {
    hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(hptCode);
    if (!hpt) errors.push(`baris ${idx}: HPT_Code "${hptCode}" tidak ditemukan di Master Data (indikator harus dibuat dulu di Master Data > Indikator)`);
  }
  if (!VALID_STATUS.includes(status)) errors.push(`baris ${idx}: Status harus ACTIVE atau NONAKTIF`);
  return { errors, ews_id, scope, hpt, status };
}

function nextVersionNo(entityId) {
  const row = db.prepare(`SELECT MAX(version_no) AS mx FROM rule_version WHERE entity_type='EWS_DICTIONARY' AND entity_id=?`).get(entityId);
  return (row.mx || 0) + 1;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// -------------------------------------------------------------- preview
router.post(
  '/preview',
  requireRole(...WRITE_ROLES),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });
    const wb = XLSX.readFile(req.file.path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const validRows = [];
    const errorRows = [];
    const seenInFile = new Set();
    rows.forEach((row, i) => {
      const idx = i + 2;
      const { errors, ews_id } = validateRow(row, idx);
      if (ews_id && seenInFile.has(ews_id)) errors.push(`baris ${idx}: EWS_ID "${ews_id}" duplikat dalam file ini`);
      if (ews_id) seenInFile.add(ews_id);
      if (errors.length) errorRows.push({ row: idx, errors, data: row });
      else validRows.push(row);
    });

    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, 'EWS_DICTIONARY', ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, req.file.originalname, rows.length, validRows.length, errorRows.length, JSON.stringify(errorRows));

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
  '/commit',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true (no partial import tanpa konfirmasi eksplisit)' });
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    const wb = XLSX.readFile(file_path);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

    const insDictionary = db.prepare(
      `INSERT INTO ews_dictionary (ews_id, scope, hpt_id, planting_stage, threshold_display_text, inspection_interval, recommendation, status)
       VALUES (@ews_id, @scope, @hpt_id, @planting_stage, @threshold_display_text, @inspection_interval, @recommendation, @status)`
    );
    const updDictionary = db.prepare(
      `UPDATE ews_dictionary SET scope=@scope, hpt_id=@hpt_id, planting_stage=@planting_stage, threshold_display_text=@threshold_display_text,
       inspection_interval=@inspection_interval, recommendation=@recommendation, status=@status, current_rule_version_id=@current_rule_version_id,
       updated_at=datetime('now') WHERE id=@id`
    );
    const insRuleVersion = db.prepare(
      `INSERT INTO rule_version (entity_type, entity_id, version_no, effective_date, status, changed_by_user_id, change_note, snapshot_json)
       VALUES ('EWS_DICTIONARY', @entity_id, @version_no, @effective_date, 'AKTIF', @changed_by_user_id, @change_note, @snapshot_json)`
    );

    let created = 0;
    let updated = 0;
    let unchanged = 0;
    const failures = [];

    const commitTxn = db.transaction((allRows) => {
      allRows.forEach((row, i) => {
        const idx = i + 2;
        const { errors, ews_id, scope, hpt, status } = validateRow(row, idx);
        if (errors.length) return; // skip invalid rows silently at commit time (already surfaced at preview)

        const planting_stage = row.Planting_Stage ? String(row.Planting_Stage).trim() : null;
        const threshold_display_text = row.Threshold_Display_Text ? String(row.Threshold_Display_Text).trim() : null;
        const inspection_interval = row.Inspection_Interval ? String(row.Inspection_Interval).trim() : null;
        const recommendation = row.Recommendation ? String(row.Recommendation).trim() : null;

        try {
          const existing = db.prepare('SELECT * FROM ews_dictionary WHERE ews_id=?').get(ews_id);
          const incoming = { scope, hpt_id: hpt.id, planting_stage, threshold_display_text, inspection_interval, recommendation, status };

          if (!existing) {
            const dictInfo = insDictionary.run({ ews_id, ...incoming });
            const version_no = 1;
            const rvInfo = insRuleVersion.run({
              entity_id: dictInfo.lastInsertRowid,
              version_no,
              effective_date: todayISO(),
              changed_by_user_id: req.user.id,
              change_note: `EWS_ID baru ditambahkan via import (${log.filename || 'upload'})`,
              snapshot_json: JSON.stringify({ ews_id, ...incoming }),
            });
            db.prepare('UPDATE ews_dictionary SET current_rule_version_id=? WHERE id=?').run(rvInfo.lastInsertRowid, dictInfo.lastInsertRowid);
            created++;
            return;
          }

          const changed = TRACKED_FIELDS.some((f) => (existing[f] ?? null) !== (incoming[f] ?? null));
          if (!changed) {
            unchanged++;
            return;
          }

          const version_no = nextVersionNo(existing.id);
          const rvInfo = insRuleVersion.run({
            entity_id: existing.id,
            version_no,
            effective_date: todayISO(),
            changed_by_user_id: req.user.id,
            change_note: `EWS_ID diperbarui via import (${log.filename || 'upload'})`,
            snapshot_json: JSON.stringify({ ews_id, ...incoming }),
          });
          updDictionary.run({ id: existing.id, ...incoming, current_rule_version_id: rvInfo.lastInsertRowid });
          updated++;
        } catch (e) {
          failures.push({ row: idx, error: e.message });
        }
      });
    });
    commitTxn(rows);

    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(created + updated, log.id);
    auditFromReq(req, { aktivitas: 'IMPORT_MASTER_EWS_DICTIONARY', after: { import_log_id: log.id, created, updated, unchanged, failures } });
    res.json({ data: { created, updated, unchanged, failed: failures.length, failures } });
  })
);

router.get(
  '/meta/log',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    res.json({ data: db.prepare(`SELECT * FROM import_log WHERE entity_type='EWS_DICTIONARY' ORDER BY created_at DESC LIMIT 200`).all() });
  })
);

module.exports = router;
