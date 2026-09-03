// V3.2: Master User Mobile Apps per Afdeling -- bulk-provisions ONE shared mobile-login user
// account per Afdeling so field staff can submit ALL field data types (Deteksi/Sensus/
// Pengendalian/Mortalitas/Yield Making/Assessment/Agro Observation/Defisiensi Hara) from a single
// afdeling-level account, instead of the old per-specialty PETUGAS_DETEKSI/PETUGAS_SENSUS/
// PETUGAS_PENGENDALIAN roles. See services/permissions.js (PETUGAS_LAPANGAN) and db.js's
// migrateV32Role() for the role itself, and the ~9 requireRole()/CREATE_ROLES call sites across
// routes/detection.js, sensus.js, treatment.js, mortality.js, yieldMaking.js, assessment.js,
// agroObservation.js, defisiensiHara.js, actionPlans.js that had to explicitly allow it.
//
// Source format: 1-sheet workbook (MASTER_AFD), columns "Kode PT" / "Afdeling" / "User Mobile" /
// "Password", as supplied by the user's "Master_user_mobile_apps.xlsx" -- built against the same
// V3.2 Master Blok Terpusat PT/Afdeling codes as Master_Data_PT_Afd_Blok_EWS_Ok.xlsx (so Master
// Blok must be uploaded/committed FIRST; this import resolves "Kode PT" -> estate.code and
// "Afdeling" -> afdeling.code scoped to that PT against whatever master data exists at the time).
//
// Admin-only end to end (requireRole always additionally allows SUPER_ADMIN -- see
// middleware/auth.js), same as masterBlokImport.js.
//
// Same preview (parse + validate only, no writes) -> commit (confirm:true) discipline as
// masterBlokImport.js, but deliberately has NO prune step: unlike location master data, a "row
// missing from the latest upload" for a login account is NOT a safe signal to delete/deactivate
// someone's login (the row could be missing because of a spreadsheet edit mistake, not because the
// afdeling stopped needing a login). Commit only ever upserts (create new / update existing by
// email) -- an admin who genuinely needs to deactivate an account still does that by hand via the
// existing PIC/User page (PUT /api/users/:id, soft-delete via is_active=0).
//
// Username -> email: "<usermobile, lowercased>@ews.local" (matches the existing seed convention
// "<name>@ews.local"; the `user` table's `email` column is just a UNIQUE TEXT field with no
// server-side email-format validation -- see routes/auth.js login lookup).
//
// Password: stored EXACTLY as given in the source file (coerced to a string, since Excel stores
// "12345" as a number) -- bcrypt-hashed like every other user. All 357 accounts in the file the
// user uploaded share the same weak numeric password ("12345"); this is flagged back to the admin
// in the preview response as a non-blocking warning (a deliberate simplicity choice for shared
// field-crew logins, same tradeoff already accepted for the demo credentials flagged earlier), but
// is respected as-is per the user's request -- never rejected or silently strengthened.
//
// Exact duplicate rows (same Kode PT + Afdeling + User Mobile + Password) are silently collapsed,
// matching the known data-quality issue already found in the companion Master Blok file: PT "ANJA"
// lists Afdeling AFD1..AFD10 twice, producing 9 literal duplicate rows here too. A row that
// repeats the same (Kode PT, Afdeling) key with a DIFFERENT username/password is a genuine
// conflict and is excluded from commit with an error, exactly like masterBlokImport.js's blok
// conflict handling.

const express = require('express');
const XLSX = require('xlsx');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadExcel } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const SHEET_AFD = 'MASTER_AFD';
const COLS_AFD = ['Kode PT', 'Afdeling', 'User Mobile', 'Password'];
const EMAIL_DOMAIN = '@ews.local';
const ROLE_CODE = 'PETUGAS_LAPANGAN';

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
  const afdSheet = findSheet(wb, SHEET_AFD);
  if (!afdSheet) throw new Error(`Sheet wajib tidak ditemukan dalam file: ${SHEET_AFD}`);
  return { afd: sheetToRows(afdSheet, COLS_AFD) };
}

// ------------------------------------------------------------------ validation

function validate({ afd }) {
  const errors = [];
  const warnings = [];
  const byKey = new Map(); // "kodePt::afdeling" -> resolved row
  const byUsername = new Map(); // lowercased username -> the (kodePt,afdeling) key that first claimed it
  const conflictKeys = new Set();

  afd.forEach((row, i) => {
    const n = i + 2; // +1 for 0-index, +1 for header row
    const kodePt = row['Kode PT'] != null ? String(row['Kode PT']).trim() : null;
    const afdeling = row['Afdeling'] != null ? String(row['Afdeling']).trim() : null;
    const userMobile = row['User Mobile'] != null ? String(row['User Mobile']).trim() : null;
    const password = row['Password'] != null ? String(row['Password']).trim() : null;

    if (!kodePt) errors.push(`MASTER_AFD baris ${n}: kolom "Kode PT" wajib diisi`);
    if (!afdeling) errors.push(`MASTER_AFD baris ${n}: kolom "Afdeling" wajib diisi`);
    if (!userMobile) errors.push(`MASTER_AFD baris ${n}: kolom "User Mobile" wajib diisi`);
    if (!password) errors.push(`MASTER_AFD baris ${n}: kolom "Password" wajib diisi`);
    if (!kodePt || !afdeling || !userMobile || !password) return;

    const estate = db.prepare('SELECT id, name FROM estate WHERE code=?').get(kodePt);
    if (!estate) {
      errors.push(`MASTER_AFD baris ${n}: "Kode PT" "${kodePt}" tidak ditemukan di Master Blok (upload/commit Master Blok terlebih dahulu)`);
      return;
    }
    const afdelingRow = db.prepare('SELECT id, code FROM afdeling WHERE estate_id=? AND code=?').get(estate.id, afdeling);
    if (!afdelingRow) {
      errors.push(`MASTER_AFD baris ${n}: pasangan Kode PT "${kodePt}" + Afdeling "${afdeling}" tidak ditemukan di Master Blok`);
      return;
    }

    const email = userMobile.toLowerCase() + EMAIL_DOMAIN;
    const key = `${kodePt}::${afdeling}`;
    const resolved = { kodePt, afdeling, userMobile, email, password, estateId: estate.id, estateName: estate.name, afdelingId: afdelingRow.id };

    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, resolved);
    } else if (!conflictKeys.has(key)) {
      const same = existing.email === email && existing.password === password;
      if (!same) {
        conflictKeys.add(key);
        errors.push(
          `MASTER_AFD baris ${n}: Kode PT "${kodePt}" + Afdeling "${afdeling}" muncul lebih dari sekali dengan User Mobile/Password berbeda`
        );
      }
      // exact duplicate rows (same PT+Afdeling+User Mobile+Password) are silently collapsed --
      // matches the known 9 duplicate "ANJA" rows in the source file.
    }

    const claimedBy = byUsername.get(email);
    if (!claimedBy) {
      byUsername.set(email, key);
    } else if (claimedBy !== key) {
      errors.push(
        `MASTER_AFD baris ${n}: User Mobile "${userMobile}" sudah dipakai oleh pasangan Kode PT/Afdeling lain (harus unik per akun)`
      );
      conflictKeys.add(key);
      conflictKeys.add(claimedBy);
    }
  });
  conflictKeys.forEach((key) => byKey.delete(key)); // conflicting rows excluded from commit entirely

  const rows = [...byKey.values()];
  const weakPasswordCount = rows.filter((r) => r.password.length < 8).length;
  if (weakPasswordCount > 0) {
    warnings.push(
      `${weakPasswordCount} akun memakai password pendek/lemah (kurang dari 8 karakter) -- diterapkan apa adanya sesuai file, ` +
        `disarankan diganti berkala oleh admin demi keamanan.`
    );
  }

  return { errors, warnings, rows };
}

function summarize(parsed) {
  const estates = new Set(parsed.rows.map((r) => r.kodePt));
  return {
    account_count: parsed.rows.length,
    pt_count: estates.size,
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
        ['Kode PT', 'Afdeling', 'User Mobile', 'Password'],
        ['KTBM-1', 'AFD 1', 'EWS-KTBM-1-1', 12345],
      ]),
      SHEET_AFD
    );
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="template_master_user_mobile.xlsx"');
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

    const totalRows = parsed.rows.length + parsed.errors.length; // approximation: rows dropped due to hard errors aren't in parsed.rows
    const info = db
      .prepare(
        `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status)
         VALUES (?, 'MASTER_USER_MOBILE_V32', ?, ?, ?, ?, ?, 'PREVIEWED')`
      )
      .run(req.user.id, req.file.originalname, totalRows, parsed.rows.length, parsed.errors.length, JSON.stringify(parsed.errors));

    res.json({
      data: {
        import_log_id: info.lastInsertRowid,
        summary: summarize(parsed),
        warnings: parsed.warnings,
        errors: parsed.errors.slice(0, 300),
        error_count: parsed.errors.length,
        file_path: req.file.path,
        // small preview sample so the admin can sanity-check the email/username mapping before committing
        sample: parsed.rows.slice(0, 10).map((r) => ({ kodePt: r.kodePt, afdeling: r.afdeling, email: r.email })),
      },
    });
  })
);

// ------------------------------------------------------------------ commit (upsert-only by email, never deletes/deactivates)

router.post(
  '/commit',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { import_log_id, confirm, file_path } = req.body;
    if (!confirm) return res.status(400).json({ error: 'Import tidak boleh dilakukan tanpa confirm=true' });
    const log = db.prepare('SELECT * FROM import_log WHERE id=?').get(import_log_id);
    if (!log) return res.status(404).json({ error: 'import_log tidak ditemukan, jalankan preview terlebih dahulu' });
    if (!file_path || !fs.existsSync(file_path)) return res.status(400).json({ error: 'file_path tidak ditemukan, upload ulang jika sesi kadaluarsa' });

    const role = db.prepare('SELECT id FROM role WHERE code=?').get(ROLE_CODE);
    if (!role) return res.status(500).json({ error: `role ${ROLE_CODE} tidak ditemukan -- restart backend agar migrasi role V3.2 berjalan` });

    let parsed;
    try {
      parsed = validate(readWorkbook(file_path));
    } catch (e) {
      return res.status(400).json({ error: `Gagal membaca file: ${e.message}` });
    }

    const stats = { created: 0, updated: 0 };
    const failures = [];

    const upsertUser = db.prepare(`
      INSERT INTO user (name, email, password_hash, role_id, estate_id, afdeling_id, area_kerja)
      VALUES (@name, @email, @password_hash, @role_id, @estate_id, @afdeling_id, @area_kerja)
      ON CONFLICT(email) DO UPDATE SET
        name=excluded.name,
        password_hash=excluded.password_hash,
        role_id=excluded.role_id,
        estate_id=excluded.estate_id,
        afdeling_id=excluded.afdeling_id,
        area_kerja=excluded.area_kerja,
        is_active=1,
        updated_at=datetime('now')
    `);

    const run = db.transaction(() => {
      for (const r of parsed.rows) {
        const before = db.prepare('SELECT id FROM user WHERE email=?').get(r.email);
        try {
          upsertUser.run({
            name: `Petugas Lapangan ${r.afdeling} - ${r.estateName}`,
            email: r.email,
            password_hash: bcrypt.hashSync(r.password, 10),
            role_id: role.id,
            estate_id: r.estateId,
            afdeling_id: r.afdelingId,
            area_kerja: `${r.kodePt} / ${r.afdeling}`,
          });
          if (before) stats.updated++; else stats.created++;
        } catch (e) {
          failures.push({ kodePt: r.kodePt, afdeling: r.afdeling, email: r.email, error: e.message });
        }
      }
    });
    run();

    const committedCount = stats.created + stats.updated;
    db.prepare(`UPDATE import_log SET status='COMMITTED', committed_count=? WHERE id=?`).run(committedCount, log.id);
    auditFromReq(req, { aktivitas: 'IMPORT_MASTER_USER_MOBILE_V32', after: { import_log_id: log.id, stats, failed: failures.length } });
    res.json({ data: { import_log_id: log.id, stats, failed: failures.length, failures } });
  })
);

router.get(
  '/log',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const rows = db.prepare(`SELECT * FROM import_log WHERE entity_type='MASTER_USER_MOBILE_V32' ORDER BY created_at DESC LIMIT 50`).all();
    res.json({ data: rows.map((r) => ({ ...r, errors_json: undefined })) });
  })
);

module.exports = router;
