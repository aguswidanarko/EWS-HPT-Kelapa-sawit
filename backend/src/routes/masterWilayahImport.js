// Import Data (Master Wilayah: Region / PT (Estate) / Rayon / Afdeling / Pemilik) -- V3
// Addendum 2, source: "Data Per PT Afdeling & Rayon FR.xlsx" (columns Region, PT, BusinessUnit,
// Pemilik, Rayon, AfdelingCode, AfdelingName). Same anti-partial-import discipline as
// routes/importExcel.js: upload -> preview (parse + validate only, no db writes) -> commit
// (only with explicit confirm:true).
//
// Unlike importExcel.js (which looks up already-existing master rows), this importer CREATES
// the master hierarchy itself: Region -> Estate (PT) -> Rayon -> Afdeling, upserted by natural
// key (region.code, estate.code, rayon (estate_id,code), afdeling (estate_id,code)) so the
// import is idempotent/cumulative -- re-running the same or an updated file is always safe and
// never duplicates rows, matching this codebase's versioned-upsert idiom (see
// masterEwsDictionary.js commit).

const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const REQUIRED_COLS = ['Region', 'PT', 'BusinessUnit', 'Pemilik', 'Rayon', 'AfdelingCode', 'AfdelingName'];
const VALID_PEMILIK = ['INTI', 'PLASMA', 'KKPA'];

// The source workbook has a title/blank area before the real header row, so the header row is
// located by scanning for a row whose first cell is exactly "Region" rather than assuming row 1.
function readRows(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  const headerIdx = grid.findIndex((r) => r && String(r[0] || '').trim() === 'Region');
  if (headerIdx === -1) {
    throw new Error(`Header kolom "Region" tidak ditemukan. Kolom wajib: ${REQUIRED_COLS.join(', ')}`);
  }
  const headers = grid[headerIdx].map((h) => String(h || '').trim());
  const dataGrid = grid.slice(headerIdx + 1).filter((r) => r && r.some((c) => c !== null && String(c).trim() !== ''));
  const rows = dataGrid.map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : null; });
    return obj;
  });
  return rows;
}

function validateRow(row, idx) {
  const errors = [];
  for (const col of REQUIRED_COLS) {
    if (!row[col]) errors.push(`baris ${idx}: kolom "${col}" wajib diisi`);
  }
  if (row.Pemilik && !VALID_PEMILIK.includes(row.Pemilik.toUpperCase())) {
    errors.push(`baris ${idx}: Pemilik "${row.Pemilik}" tidak dikenal (harus INTI/PLASMA/KKPA)`);
  }
  return errors;
}

function summarize(rows) {
  const regions = new Set();
  const estates = new Set();
  const rayons = new Set();
  rows.forEach((r) => {
    if (r.Region) regions.add(r.Region);
    if (r.PT) estates.add(r.PT);
    if (r.PT && r.Rayon) rayons.add(`${r.PT}::${r.Rayon}`);
  });
  return { region_count: regions.size, estate_count: estates.size, rayon_count: rayons.size, afdeling_count: rows.length };
}

// -------------------------------------------------------------- template
router.get(
  '/template',
  asyncHandler(async (req, res) => {
    const wb = XLSX.utils.book_new();
    const example = [
      ['Riau', 'ANJA', 'ANJA21 - Kebun 1', 'INTI', 'Rayon A', '01', 'AFDELING 01'],
      ['Riau', 'ANJA', 'ANJA21 - Kebun 1', 'INTI', 'Rayon A', '02', 'AFDELING 02'],
    ];
    const dataSheet = XLSX.utils.aoa_to_sheet([REQUIRED_COLS, ...example]);
    XLSX.utils.book_append_sheet(wb, dataSheet, 'All Region');
    const dictSheet = XLSX.utils.aoa_to_sheet([
      ['Kolom', 'Wajib', 'Keterangan'],
      ['Region', 'ya', 'Nama wilayah region, mis. Riau/Kalbar/Kaltim'],
      ['PT', 'ya', 'Kode PT/kebun singkat, mis. ANJA -- menjadi kode Estate'],
      ['BusinessUnit', 'ya', 'Nama lengkap kebun, mis. "ANJA21 - Kebun 1" -- menjadi nama Estate'],
      ['Pemilik', 'ya', 'INTI / PLASMA / KKPA'],
      ['Rayon', 'ya', 'Label rayon dalam PT tsb, mis. "Rayon A" (unik per PT, boleh berulang antar PT)'],
      ['AfdelingCode', 'ya', 'Kode afdeling, unik per PT'],
      ['AfdelingName', 'ya', 'Nama afdeling'],
    ]);
    XLSX.utils.book_append_sheet(wb, dictSheet, 'Data Dictionary');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="template_master_wilayah.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

// -------------------------------------------------------------- preview
router.post(
  '/preview',
  requireRole('ADMIN'),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });

    let rows;
    try {
      rows = readRows(req.file.path);
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const validRows = [];
    const errorRows = [];
    rows.forEach((row, i) => {
      const errors = validateRow(row, i + 1);
      if (errors.length) errorRows.push({ row: i + 1, errors, data: row });
      else validRows.push(row);
    });

    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, 'MASTER_WILAYAH', ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, req.file.originalname, rows.length, validRows.length, errorRows.length, JSON.stringify(errorRows));

    res.json({
      data: {
        import_log_id: info.lastInsertRowid,
        total: rows.length,
        valid: validRows.length,
        error: errorRows.length,
        errors: errorRows.slice(0, 200),
        summary: summarize(validRows),
        file_path: req.file.path,
      },
    });
  })
);

// -------------------------------------------------------------- commit
router.post(
  '/commit',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true' });
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    let rows;
    try {
      rows = readRows(file_path);
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const stats = {
      region: { created: 0, updated: 0 },
      estate: { created: 0, updated: 0 },
      rayon: { created: 0, updated: 0 },
      afdeling: { created: 0, updated: 0 },
    };
    const failures = [];

    const upsertRegion = db.prepare(`
      INSERT INTO region (code, name) VALUES (@code, @name)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
    `);
    const upsertEstate = db.prepare(`
      INSERT INTO estate (code, name, region_id) VALUES (@code, @name, @region_id)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, region_id=excluded.region_id, updated_at=datetime('now')
    `);
    const upsertRayon = db.prepare(`
      INSERT INTO rayon (estate_id, code, name) VALUES (@estate_id, @code, @name)
      ON CONFLICT(estate_id, code) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
    `);
    const upsertAfdeling = db.prepare(`
      INSERT INTO afdeling (estate_id, code, name, rayon_id, pemilik) VALUES (@estate_id, @code, @name, @rayon_id, @pemilik)
      ON CONFLICT(estate_id, code) DO UPDATE SET name=excluded.name, rayon_id=excluded.rayon_id, pemilik=excluded.pemilik, updated_at=datetime('now')
    `);

    // touchedRegions/Estates/Rayons dedupe stat-counting to once per UNIQUE key per commit run
    // (many rows share the same Region/PT/Rayon) -- without this, created/updated counts would
    // reflect row count rather than actual distinct region/estate/rayon operations.
    const touchedRegions = new Set();
    const touchedEstates = new Set();
    const touchedRayons = new Set();

    const run = db.transaction(() => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const errors = validateRow(row, i + 1);
        if (errors.length) continue; // skip invalid rows silently at commit time (already surfaced at preview)
        try {
          const regionCode = row.Region.trim().toUpperCase();
          if (!touchedRegions.has(regionCode)) {
            touchedRegions.add(regionCode);
            const before1 = db.prepare('SELECT id FROM region WHERE code=?').get(regionCode);
            upsertRegion.run({ code: regionCode, name: row.Region.trim() });
            if (before1) stats.region.updated++; else stats.region.created++;
          }
          const region = db.prepare('SELECT id FROM region WHERE code=?').get(regionCode);

          const estateCode = row.PT.trim();
          if (!touchedEstates.has(estateCode)) {
            touchedEstates.add(estateCode);
            const before2 = db.prepare('SELECT id FROM estate WHERE code=?').get(estateCode);
            upsertEstate.run({ code: estateCode, name: row.BusinessUnit.trim(), region_id: region.id });
            if (before2) stats.estate.updated++; else stats.estate.created++;
          }
          const estate = db.prepare('SELECT id FROM estate WHERE code=?').get(estateCode);

          const rayonCode = row.Rayon.trim();
          const rayonKey = `${estate.id}::${rayonCode}`;
          if (!touchedRayons.has(rayonKey)) {
            touchedRayons.add(rayonKey);
            const before3 = db.prepare('SELECT id FROM rayon WHERE estate_id=? AND code=?').get(estate.id, rayonCode);
            upsertRayon.run({ estate_id: estate.id, code: rayonCode, name: rayonCode });
            if (before3) stats.rayon.updated++; else stats.rayon.created++;
          }
          const rayon = db.prepare('SELECT id FROM rayon WHERE estate_id=? AND code=?').get(estate.id, rayonCode);

          const afdelingCode = row.AfdelingCode.trim();
          const before4 = db.prepare('SELECT id FROM afdeling WHERE estate_id=? AND code=?').get(estate.id, afdelingCode);
          upsertAfdeling.run({
            estate_id: estate.id,
            code: afdelingCode,
            name: row.AfdelingName.trim(),
            rayon_id: rayon.id,
            pemilik: row.Pemilik.trim().toUpperCase(),
          });
          if (before4) stats.afdeling.updated++; else stats.afdeling.created++;
        } catch (e) {
          failures.push({ row: i + 1, error: e.message });
        }
      }
    });
    run();

    const committed = stats.afdeling.created + stats.afdeling.updated;
    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(committed, log.id);
    auditFromReq(req, { aktivitas: 'IMPORT_MASTER_WILAYAH', after: { import_log_id: log.id, stats, failures } });
    res.json({ data: { stats, failed: failures.length, failures } });
  })
);

router.get(
  '/log',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    res.json({ data: db.prepare(`SELECT * FROM import_log WHERE entity_type='MASTER_WILAYAH' ORDER BY created_at DESC LIMIT 50`).all() });
  })
);

module.exports = router;
