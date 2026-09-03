// V3.2: Master Blok Terpusat -- single-source-of-truth upload for the FULL location hierarchy
// (Region -> Bisnis Unit -> PT (estate) -> Afdeling -> Blok), replacing the old scattered/
// inconsistent per-user manual entry that was causing mobile sync failures (blok codes that
// didn't match between devices). Source format: 3-sheet workbook (MASTER_PT / MASTER_AFD /
// MASTER_BLOK), as supplied by the user's "Master_Data_PT_Afd_Blok_EWS_Ok.xlsx".
//
// Admin-only end to end (requireRole always additionally allows SUPER_ADMIN -- see
// middleware/auth.js), matching the user's explicit instruction "Masterblok hanya bisa dirubah
// oleh user admin".
//
// Same anti-partial-import discipline as masterWilayahImport.js/importExcel.js: upload ->
// preview (parse + validate only, no db writes) -> commit (confirm:true, upserts by natural key,
// NEVER deletes) -> prune (separate, explicit confirm:true step that removes old region/bisnis
// unit/PT/afdeling/blok rows no longer present in the latest commit, but ONLY those that are not
// referenced by any historical record -- SQLite's own FOREIGN KEY enforcement, already ON in
// db.js, is what decides "still referenced"; a row that's still in use is skipped and reported so
// the admin knows the old-code -> new-code remap (see docs/MIGRASI_MASTER_BLOK_V32.md) needs to
// run before it can be pruned). This matches the user's confirmed preference: prepare an
// old->new blok mapping first, never a destructive wipe.
//
// Blok fields that don't exist in the new source (status_tanaman, referensi_polygon,
// jumlah_baris, parameter_sampling_json -- used by Peta EWS / Rule Sampling) are deliberately
// left untouched on every upsert (both INSERT default-null and UPDATE not-in-SET-list), per the
// user's confirmed answer "Pertahankan sebagai field kosong/opsional".

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

const SHEET_PT = 'MASTER_PT';
const SHEET_AFD = 'MASTER_AFD';
const SHEET_BLOK = 'MASTER_BLOK';
const COLS_PT = ['Region', 'Kode PT', 'Nama PT'];
const COLS_AFD = ['Kode PT', 'Afdeling'];
const COLS_BLOK = ['Kode PT', 'Afdeling', 'Blok'];

// ------------------------------------------------------------------ parsing helpers

function findSheet(wb, wantedName) {
  const found = wb.SheetNames.find((n) => n.trim().toUpperCase() === wantedName);
  if (!found) return null;
  return wb.Sheets[found];
}

function sheetToRows(sheet, requiredCols) {
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });
  if (!grid.length) return [];
  const headers = grid[0].map((h) => String(h || '').trim());
  const missing = requiredCols.filter((c) => !headers.includes(c));
  if (missing.length) throw new Error(`kolom wajib tidak ditemukan: ${missing.join(', ')}`);
  const dataRows = grid.slice(1).filter((r) => r && r.some((c) => c !== null && String(c).trim() !== ''));
  return dataRows.map((r) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] != null && String(r[i]).trim() !== '' ? r[i] : null;
    });
    return obj;
  });
}

function readWorkbook(filePath) {
  const wb = XLSX.readFile(filePath);
  const ptSheet = findSheet(wb, SHEET_PT);
  const afdSheet = findSheet(wb, SHEET_AFD);
  const blokSheet = findSheet(wb, SHEET_BLOK);
  const missingSheets = [
    !ptSheet && SHEET_PT,
    !afdSheet && SHEET_AFD,
    !blokSheet && SHEET_BLOK,
  ].filter(Boolean);
  if (missingSheets.length) {
    throw new Error(`Sheet wajib tidak ditemukan dalam file: ${missingSheets.join(', ')}`);
  }
  return {
    pt: sheetToRows(ptSheet, COLS_PT),
    afd: sheetToRows(afdSheet, COLS_AFD),
    blok: sheetToRows(blokSheet, COLS_BLOK),
  };
}

// Derives the Bisnis Unit code from "Nama PT" -- the segment before the first " - ", per the
// established naming convention across the whole master file (e.g. "KTBM - Kebun Sei Besar" ->
// "KTBM"). This IS the format check requested: "format data yang diupload juga harus mengikuti
// format penamaan PT pada master data".
function deriveBisnisUnit(namaPt) {
  if (!namaPt || typeof namaPt !== 'string') return null;
  const idx = namaPt.indexOf(' - ');
  if (idx <= 0) return null;
  const prefix = namaPt.slice(0, idx).trim();
  const rest = namaPt.slice(idx + 3).trim();
  if (!prefix || !rest) return null;
  return prefix;
}

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ validation

function validate({ pt, afd, blok }) {
  const errors = [];
  const ptByCode = new Map(); // Kode PT -> row (first occurrence)

  pt.forEach((row, i) => {
    const n = i + 2; // +1 for 0-index, +1 for header row
    const region = row['Region'] != null ? String(row['Region']).trim() : null;
    const kodePt = row['Kode PT'] != null ? String(row['Kode PT']).trim() : null;
    const namaPt = row['Nama PT'] != null ? String(row['Nama PT']).trim() : null;
    if (!region) errors.push(`MASTER_PT baris ${n}: kolom "Region" wajib diisi`);
    if (!kodePt) errors.push(`MASTER_PT baris ${n}: kolom "Kode PT" wajib diisi`);
    if (!namaPt) {
      errors.push(`MASTER_PT baris ${n}: kolom "Nama PT" wajib diisi`);
    } else if (!deriveBisnisUnit(namaPt)) {
      errors.push(
        `MASTER_PT baris ${n}: "Nama PT" ("${namaPt}") tidak mengikuti format penamaan master data ` +
          `("<Bisnis Unit> - <nama kebun>", mis. "KTBM - Kebun Sei Besar")`
      );
    }
    if (kodePt) {
      if (ptByCode.has(kodePt)) {
        errors.push(`MASTER_PT baris ${n}: "Kode PT" "${kodePt}" duplikat (sudah dipakai baris lain)`);
      } else if (region && namaPt && deriveBisnisUnit(namaPt)) {
        ptByCode.set(kodePt, { region, kodePt, namaPt, bisnisUnit: deriveBisnisUnit(namaPt) });
      }
    }
  });

  const afdByKey = new Map(); // "kodePt::afdeling" -> row
  afd.forEach((row, i) => {
    const n = i + 2;
    const kodePt = row['Kode PT'] != null ? String(row['Kode PT']).trim() : null;
    const afdeling = row['Afdeling'] != null ? String(row['Afdeling']).trim() : null;
    if (!kodePt) errors.push(`MASTER_AFD baris ${n}: kolom "Kode PT" wajib diisi`);
    if (!afdeling) errors.push(`MASTER_AFD baris ${n}: kolom "Afdeling" wajib diisi`);
    if (kodePt && afdeling) {
      if (!ptByCode.has(kodePt)) {
        errors.push(`MASTER_AFD baris ${n}: "Kode PT" "${kodePt}" tidak ditemukan di sheet MASTER_PT`);
      } else {
        afdByKey.set(`${kodePt}::${afdeling}`, { kodePt, afdeling });
      }
    }
  });

  const blokByKey = new Map(); // "kodePt::afdeling::blok" -> resolved row (dedup, conflict-checked)
  const blokConflicts = new Set();
  blok.forEach((row, i) => {
    const n = i + 2;
    const kodePt = row['Kode PT'] != null ? String(row['Kode PT']).trim() : null;
    const afdeling = row['Afdeling'] != null ? String(row['Afdeling']).trim() : null;
    const blokCode = row['Blok'] != null ? String(row['Blok']).trim() : null;
    if (!kodePt) errors.push(`MASTER_BLOK baris ${n}: kolom "Kode PT" wajib diisi`);
    if (!afdeling) errors.push(`MASTER_BLOK baris ${n}: kolom "Afdeling" wajib diisi`);
    if (!blokCode) errors.push(`MASTER_BLOK baris ${n}: kolom "Blok" wajib diisi`);
    if (!kodePt || !afdeling || !blokCode) return;
    const afdKey = `${kodePt}::${afdeling}`;
    if (!afdByKey.has(afdKey)) {
      errors.push(`MASTER_BLOK baris ${n}: pasangan Kode PT "${kodePt}" + Afdeling "${afdeling}" tidak ditemukan di sheet MASTER_AFD`);
      return;
    }
    const key = `${afdKey}::${blokCode}`;
    const resolved = {
      kodePt,
      afdeling,
      blokCode,
      tahunTanam: numOrNull(row['Tahun Tanam']),
      luas: numOrNull(row['Luas (Ha)']),
      jumlahPokok: numOrNull(row['Jumlah Pokok (Total Stand)']),
    };
    const existing = blokByKey.get(key);
    if (!existing) {
      blokByKey.set(key, resolved);
    } else if (!blokConflicts.has(key)) {
      const same =
        existing.tahunTanam === resolved.tahunTanam && existing.luas === resolved.luas && existing.jumlahPokok === resolved.jumlahPokok;
      if (!same) {
        blokConflicts.add(key);
        errors.push(
          `MASTER_BLOK baris ${n}: Blok "${blokCode}" pada PT "${kodePt}" / Afdeling "${afdeling}" muncul lebih dari sekali dengan data berbeda`
        );
      }
      // exact duplicate rows are silently deduped (no error) -- matches the 175 known duplicate
      // rows found in the original file, safe to collapse.
    }
  });
  blokConflicts.forEach((key) => blokByKey.delete(key)); // conflicting rows excluded from commit entirely

  return {
    errors,
    pt: [...ptByCode.values()],
    afd: [...afdByKey.values()],
    blok: [...blokByKey.values()],
  };
}

function summarize(parsed) {
  const regions = new Set(parsed.pt.map((r) => r.region.trim().toUpperCase()));
  const bisnisUnits = new Set(parsed.pt.map((r) => `${r.region.trim().toUpperCase()}::${r.bisnisUnit}`));
  return {
    region_count: regions.size,
    bisnis_unit_count: bisnisUnits.size,
    pt_count: parsed.pt.length,
    afdeling_count: parsed.afd.length,
    blok_count: parsed.blok.length,
  };
}

// ------------------------------------------------------------------ template

router.get(
  '/template',
  asyncHandler(async (req, res) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ID', 'Region', 'Kode PT', 'Nama PT', 'Lokasi Kebun'],
        [1, 'Riau', 'KTBM-1', 'KTBM - Kebun Contoh', 'Kebun Contoh'],
      ]),
      SHEET_PT
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Kode PT', 'Afdeling'],
        ['KTBM-1', 'AFD 1'],
      ]),
      SHEET_AFD
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['Kode PT', 'Afdeling', 'Blok', 'Tahun Tanam', 'Luas (Ha)', 'Jumlah Pokok (Total Stand)'],
        ['KTBM-1', 'AFD 1', 'A001', 2024, 28.42, 4067],
      ]),
      SHEET_BLOK
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="template_master_blok.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  })
);

// ------------------------------------------------------------------ preview

router.post(
  '/preview',
  requireRole('ADMIN'),
  uploadExcel.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload' });

    let parsed;
    try {
      const raw = readWorkbook(req.file.path);
      parsed = validate(raw);
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const totalRows = parsed.pt.length + parsed.afd.length + parsed.blok.length;
    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, 'MASTER_BLOK_V32', ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, req.file.originalname, totalRows, totalRows - parsed.errors.length, parsed.errors.length, JSON.stringify(parsed.errors));

    res.json({
      data: {
        import_log_id: info.lastInsertRowid,
        summary: summarize(parsed),
        errors: parsed.errors.slice(0, 300),
        error_count: parsed.errors.length,
        file_path: req.file.path,
      },
    });
  })
);

// ------------------------------------------------------------------ commit (upsert-only, never deletes)

router.post(
  '/commit',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true' });
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    let parsed;
    try {
      parsed = validate(readWorkbook(file_path));
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const stats = {
      region: { created: 0, updated: 0 },
      bisnis_unit: { created: 0, updated: 0 },
      estate: { created: 0, updated: 0 },
      afdeling: { created: 0, updated: 0 },
      blok: { created: 0, updated: 0 },
    };
    const failures = [];
    const keep = { region: new Set(), bisnis_unit: new Set(), estate: new Set(), afdeling: new Set(), blok: new Set() };

    const upsertRegion = db.prepare(`
      INSERT INTO region (code, name) VALUES (@code, @name)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
    `);
    const upsertBisnisUnit = db.prepare(`
      INSERT INTO bisnis_unit (region_id, code, name) VALUES (@region_id, @code, @name)
      ON CONFLICT(region_id, code) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
    `);
    const upsertEstate = db.prepare(`
      INSERT INTO estate (code, name, region_id, bisnis_unit_id) VALUES (@code, @name, @region_id, @bisnis_unit_id)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, region_id=excluded.region_id, bisnis_unit_id=excluded.bisnis_unit_id, updated_at=datetime('now')
    `);
    const upsertAfdeling = db.prepare(`
      INSERT INTO afdeling (estate_id, code, name) VALUES (@estate_id, @code, @name)
      ON CONFLICT(estate_id, code) DO UPDATE SET name=excluded.name, updated_at=datetime('now')
    `);
    // status_tanaman/referensi_polygon/jumlah_baris/parameter_sampling_json deliberately absent
    // from the SET clause -- an existing blok's Peta EWS / Rule Sampling data is preserved as-is.
    const upsertBlok = db.prepare(`
      INSERT INTO blok (afdeling_id, code, luas, tahun_tanam, jumlah_pokok) VALUES (@afdeling_id, @code, @luas, @tahun_tanam, @jumlah_pokok)
      ON CONFLICT(afdeling_id, code) DO UPDATE SET luas=excluded.luas, tahun_tanam=excluded.tahun_tanam, jumlah_pokok=excluded.jumlah_pokok, updated_at=datetime('now')
    `);

    const run = db.transaction(() => {
      const regionIdByCode = new Map();
      for (const p of parsed.pt) {
        const regionCode = p.region.trim().toUpperCase();
        keep.region.add(regionCode);
        if (!regionIdByCode.has(regionCode)) {
          const before = db.prepare('SELECT id FROM region WHERE code=?').get(regionCode);
          upsertRegion.run({ code: regionCode, name: p.region.trim() });
          if (before) stats.region.updated++; else stats.region.created++;
          regionIdByCode.set(regionCode, db.prepare('SELECT id FROM region WHERE code=?').get(regionCode).id);
        }
      }

      const buIdByKey = new Map();
      for (const p of parsed.pt) {
        const regionCode = p.region.trim().toUpperCase();
        const regionId = regionIdByCode.get(regionCode);
        const buKey = `${regionCode}::${p.bisnisUnit}`;
        keep.bisnis_unit.add(buKey);
        if (!buIdByKey.has(buKey)) {
          const before = db.prepare('SELECT id FROM bisnis_unit WHERE region_id=? AND code=?').get(regionId, p.bisnisUnit);
          upsertBisnisUnit.run({ region_id: regionId, code: p.bisnisUnit, name: p.bisnisUnit });
          if (before) stats.bisnis_unit.updated++; else stats.bisnis_unit.created++;
          buIdByKey.set(buKey, db.prepare('SELECT id FROM bisnis_unit WHERE region_id=? AND code=?').get(regionId, p.bisnisUnit).id);
        }
      }

      const estateIdByCode = new Map();
      for (const p of parsed.pt) {
        const regionCode = p.region.trim().toUpperCase();
        const regionId = regionIdByCode.get(regionCode);
        const buId = buIdByKey.get(`${regionCode}::${p.bisnisUnit}`);
        keep.estate.add(p.kodePt);
        const before = db.prepare('SELECT id FROM estate WHERE code=?').get(p.kodePt);
        try {
          upsertEstate.run({ code: p.kodePt, name: p.namaPt, region_id: regionId, bisnis_unit_id: buId });
          if (before) stats.estate.updated++; else stats.estate.created++;
          estateIdByCode.set(p.kodePt, db.prepare('SELECT id FROM estate WHERE code=?').get(p.kodePt).id);
        } catch (e) {
          failures.push({ scope: 'MASTER_PT', kodePt: p.kodePt, error: e.message });
        }
      }

      const afdelingIdByKey = new Map();
      for (const a of parsed.afd) {
        const estateId = estateIdByCode.get(a.kodePt);
        if (!estateId) continue; // PT failed above, already in failures
        keep.afdeling.add(`${a.kodePt}::${a.afdeling}`);
        const before = db.prepare('SELECT id FROM afdeling WHERE estate_id=? AND code=?').get(estateId, a.afdeling);
        try {
          upsertAfdeling.run({ estate_id: estateId, code: a.afdeling, name: a.afdeling });
          if (before) stats.afdeling.updated++; else stats.afdeling.created++;
          afdelingIdByKey.set(`${a.kodePt}::${a.afdeling}`, db.prepare('SELECT id FROM afdeling WHERE estate_id=? AND code=?').get(estateId, a.afdeling).id);
        } catch (e) {
          failures.push({ scope: 'MASTER_AFD', kodePt: a.kodePt, afdeling: a.afdeling, error: e.message });
        }
      }

      for (const b of parsed.blok) {
        const afdelingId = afdelingIdByKey.get(`${b.kodePt}::${b.afdeling}`);
        if (!afdelingId) continue;
        keep.blok.add(`${b.kodePt}::${b.afdeling}::${b.blokCode}`);
        const before = db.prepare('SELECT id FROM blok WHERE afdeling_id=? AND code=?').get(afdelingId, b.blokCode);
        try {
          upsertBlok.run({ afdeling_id: afdelingId, code: b.blokCode, luas: b.luas, tahun_tanam: b.tahunTanam, jumlah_pokok: b.jumlahPokok });
          if (before) stats.blok.updated++; else stats.blok.created++;
        } catch (e) {
          failures.push({ scope: 'MASTER_BLOK', kodePt: b.kodePt, afdeling: b.afdeling, blok: b.blokCode, error: e.message });
        }
      }
    });
    run();

    const committedCount = stats.blok.created + stats.blok.updated;
    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=?, errors_json=? WHERE id=?`).run(
      committedCount,
      JSON.stringify({ keep: { region: [...keep.region], bisnis_unit: [...keep.bisnis_unit], estate: [...keep.estate], afdeling: [...keep.afdeling], blok: [...keep.blok] } }),
      log.id
    );
    auditFromReq(req, { aktivitas: 'IMPORT_MASTER_BLOK_V32', after: { import_log_id: log.id, stats, failed: failures.length } });
    res.json({ data: { import_log_id: log.id, stats, failed: failures.length, failures } });
  })
);

// ------------------------------------------------------------------ prune (removes stale rows,
// only those with zero remaining references anywhere else in the database)

router.post(
  '/prune',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Prune tidak boleh dilakukan tanpa confirm=true' });
    const log = db.prepare(`SELECT * FROM import_log WHERE id=? AND entity_type='MASTER_BLOK_V32' AND status='COMMITTED'`).get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log COMMITTED untuk Master Blok tidak ditemukan' });

    let keep;
    try {
      keep = JSON.parse(log.errors_json).keep;
    } catch {
      return res.status(400).json({ error: 'Data keep-set import ini tidak valid/kadaluarsa, jalankan commit ulang' });
    }

    const removed = { blok: [], afdeling: [], estate: [], bisnis_unit: [], region: [] };
    const kept = { blok: 0, afdeling: 0, estate: 0, bisnis_unit: 0, region: 0 };

    function tryDelete(table, id) {
      try {
        db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id);
        return true;
      } catch (e) {
        if (/FOREIGN KEY constraint failed/i.test(e.message)) return false;
        throw e;
      }
    }

    const run = db.transaction(() => {
      // Blok: prune any blok row whose "kodePt::afdeling::blok" key isn't in the keep set.
      const allBlok = db
        .prepare(
          `SELECT b.id, b.code AS blok_code, a.code AS afdeling_code, e.code AS estate_code
           FROM blok b JOIN afdeling a ON a.id = b.afdeling_id JOIN estate e ON e.id = a.estate_id`
        )
        .all();
      for (const row of allBlok) {
        const key = `${row.estate_code}::${row.afdeling_code}::${row.blok_code}`;
        if (keep.blok.includes(key)) { kept.blok++; continue; }
        if (tryDelete('blok', row.id)) removed.blok.push(key); else kept.blok++;
      }

      const allAfd = db.prepare(`SELECT a.id, a.code AS afdeling_code, e.code AS estate_code FROM afdeling a JOIN estate e ON e.id = a.estate_id`).all();
      for (const row of allAfd) {
        const key = `${row.estate_code}::${row.afdeling_code}`;
        if (keep.afdeling.includes(key)) { kept.afdeling++; continue; }
        if (tryDelete('afdeling', row.id)) removed.afdeling.push(key); else kept.afdeling++;
      }

      const allEstate = db.prepare(`SELECT id, code FROM estate`).all();
      for (const row of allEstate) {
        if (keep.estate.includes(row.code)) { kept.estate++; continue; }
        if (tryDelete('estate', row.id)) removed.estate.push(row.code); else kept.estate++;
      }

      const allBu = db.prepare(`SELECT bu.id, bu.code, r.code AS region_code FROM bisnis_unit bu JOIN region r ON r.id = bu.region_id`).all();
      for (const row of allBu) {
        const key = `${row.region_code}::${row.code}`;
        if (keep.bisnis_unit.includes(key)) { kept.bisnis_unit++; continue; }
        if (tryDelete('bisnis_unit', row.id)) removed.bisnis_unit.push(key); else kept.bisnis_unit++;
      }

      const allRegion = db.prepare(`SELECT id, code FROM region`).all();
      for (const row of allRegion) {
        if (keep.region.includes(row.code)) { kept.region++; continue; }
        if (tryDelete('region', row.id)) removed.region.push(row.code); else kept.region++;
      }
    });
    run();

    auditFromReq(req, { aktivitas: 'PRUNE_MASTER_BLOK_V32', after: { import_log_id: log.id, removed, kept } });
    res.json({
      data: {
        removed,
        // "kept" counts rows that were candidates for removal (not in the latest upload) but were
        // skipped because a historical record still references them -- these are exactly the
        // codes that need the old->new remap (docs/MIGRASI_MASTER_BLOK_V32.md) before they can be
        // pruned safely.
        skipped_still_in_use: kept,
      },
    });
  })
);

router.get(
  '/log',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const rows = db.prepare(`SELECT * FROM import_log WHERE entity_type='MASTER_BLOK_V32' ORDER BY created_at DESC LIMIT 50`).all();
    res.json({ data: rows.map((r) => ({ ...r, errors_json: undefined })) });
  })
);

module.exports = router;
