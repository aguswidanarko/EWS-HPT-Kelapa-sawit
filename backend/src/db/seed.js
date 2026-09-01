// Demo seed data (SPEC.md section 8 build item #8). Run with `npm run seed`.
// Idempotent-ish: clears existing rows in dependent tables first so it can be re-run during dev
// without manually deleting ews.db every time.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { ingestDetection, ingestSensus } = require('../services/ingestion');
const { KB_DIR } = require('../middleware/upload');

const TODAY = new Date().toISOString().slice(0, 10);
const EFFECTIVE = '2026-01-01';

function reset() {
  const tables = [
    // ---- V2 tables first (some reference V1 tables/each other; foreign_keys is OFF during
    // reset so order isn't strictly required, but kept dependency-safe for readability) ----
    'scoring_entry', 'scoring_criteria', 'defisiensi_hara_temuan', 'leaf_analysis',
    'tbm_vegetatif', 'bahan_organik', 'water_management', 'yield_partenocarpi',
    'action_plan', 'rule_version', 'formula', 'sampling_rule', 'scheduling_rule', 'ews_category',
    // ---- V1 tables (unchanged order/content from V1 seed.js) ----
    'notification', 'alert', 'mortality', 'treatment', 'sensus', 'detection', 'incident',
    'schedule', 'pic', 'photo', 'gps', 'audit_log', 'sync_log', 'notification_rule',
    'geojson_layer', 'import_log', 'knowledge_base', 'threshold', 'species', 'hpt',
    'user', 'blok', 'afdeling', 'estate', 'role',
  ];
  db.exec('PRAGMA foreign_keys = OFF;');
  const hasSeqTable = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'`).get();
  for (const t of tables) {
    db.exec(`DELETE FROM ${t};`);
    if (hasSeqTable) db.exec(`DELETE FROM sqlite_sequence WHERE name='${t}';`);
  }
  db.exec('PRAGMA foreign_keys = ON;');
}

function main() {
  console.log('Seeding EWS HPT demo data...');
  reset();

  // ---------------------------------------------------------------- ROLES
  // V1 roles unchanged, plus V2 roles (SPEC_V2.md section 1 item 7: SUPER_ADMIN, RISET,
  // VIEWER_MANAGEMENT added on top -- no V1 role removed/renamed).
  const roles = [
    ['ADMIN', 'Administrator'],
    ['SUPER_ADMIN', 'Super Admin'],
    ['RND_FOD', 'R&D / FOD'],
    ['MANAGER', 'Manager'],
    ['ASKEP_ASISTEN', 'Askep / Asisten'],
    ['PETUGAS_DETEKSI', 'Petugas Deteksi'],
    ['PETUGAS_SENSUS', 'Petugas Sensus'],
    ['PETUGAS_PENGENDALIAN', 'Petugas Pengendalian'],
    ['RISET', 'Riset (Leaf Analysis / Defisiensi Hara)'],
    ['VIEWER_MANAGEMENT', 'Viewer / Management (read-only)'],
  ];
  const insRole = db.prepare('INSERT INTO role (code, name) VALUES (?, ?)');
  const roleId = {};
  for (const [code, name] of roles) roleId[code] = insRole.run(code, name).lastInsertRowid;

  // ---------------------------------------------------------------- ESTATE / AFDELING / BLOK
  const estateId = db.prepare('INSERT INTO estate (code, name) VALUES (?, ?)').run('EST1', 'Estate Sungai Lembu').lastInsertRowid;

  const insAfd = db.prepare('INSERT INTO afdeling (estate_id, code, name) VALUES (?, ?, ?)');
  const afd1 = insAfd.run(estateId, 'AFD1', 'Afdeling I').lastInsertRowid;
  const afd2 = insAfd.run(estateId, 'AFD2', 'Afdeling II').lastInsertRowid;
  const afd3 = insAfd.run(estateId, 'AFD3', 'Afdeling III').lastInsertRowid;

  const samplingParams = JSON.stringify({
    baris_sampel: { start: 3, step: 10 },
    grid: { baris_start: 3, baris_step: 20, posisi_start: 3, posisi_step: 10 },
    posisi_per_baris: 40,
  });

  const insBlok = db.prepare(
    `INSERT INTO blok (afdeling_id, code, name, luas, tahun_tanam, status_tanaman, referensi_polygon, jumlah_baris, parameter_sampling_json)
     VALUES (@afdeling_id, @code, @name, @luas, @tahun_tanam, @status_tanaman, @referensi_polygon, @jumlah_baris, @parameter_sampling_json)`
  );
  function makePolygon(lat, lng) {
    const d = 0.004;
    return JSON.stringify({
      type: 'Polygon',
      coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
    });
  }
  const bloks = {};
  const blokDefs = [
    { code: 'B01', name: 'Blok B01', afdeling_id: afd1, luas: 25.4, tahun_tanam: 2010, status_tanaman: 'TM', jumlah_baris: 40, lat: -2.1001, lng: 101.5001 },
    { code: 'B02', name: 'Blok B02', afdeling_id: afd1, luas: 20.1, tahun_tanam: 2022, status_tanaman: 'TBM2', jumlah_baris: 30, lat: -2.1050, lng: 101.5050 },
    { code: 'B03', name: 'Blok B03', afdeling_id: afd2, luas: 22.7, tahun_tanam: 2008, status_tanaman: 'TM', jumlah_baris: 35, lat: -2.1101, lng: 101.5101 },
    { code: 'B04', name: 'Blok B04', afdeling_id: afd2, luas: 18.3, tahun_tanam: 2024, status_tanaman: 'TBM1', jumlah_baris: 28, lat: -2.1150, lng: 101.5150 },
    { code: 'B05', name: 'Blok B05', afdeling_id: afd3, luas: 30.0, tahun_tanam: 2012, status_tanaman: 'TM', jumlah_baris: 45, lat: -2.1201, lng: 101.5201 },
    { code: 'B06', name: 'Blok B06', afdeling_id: afd3, luas: 24.6, tahun_tanam: 2011, status_tanaman: 'TM', jumlah_baris: 38, lat: -2.1250, lng: 101.5250 },
  ];
  for (const b of blokDefs) {
    const id = insBlok.run({
      afdeling_id: b.afdeling_id,
      code: b.code,
      name: b.name,
      luas: b.luas,
      tahun_tanam: b.tahun_tanam,
      status_tanaman: b.status_tanaman,
      referensi_polygon: makePolygon(b.lat, b.lng),
      jumlah_baris: b.jumlah_baris,
      parameter_sampling_json: samplingParams,
    }).lastInsertRowid;
    bloks[b.code] = { id, ...b };
  }

  // ---------------------------------------------------------------- HPT
  const insHpt = db.prepare(
    `INSERT INTO hpt (code, name, nama_lokal, kategori, status_aktif, deskripsi, gejala, metode_deteksi, metode_sensus, satuan, threshold_default, panduan_md)
     VALUES (@code, @name, @nama_lokal, @kategori, 1, @deskripsi, @gejala, @metode_deteksi, @metode_sensus, @satuan, @threshold_default, @panduan_md)`
  );
  const hptId = {};
  const hptDefs = [
    { code: 'UPDKS', name: 'Ulat Pemakan Daun Kelapa Sawit', nama_lokal: 'UPDKS', kategori: 'HAMA', deskripsi: 'Ulat api & ulat kantong pemakan daun', gejala: 'Daun berlubang/gundul, pelepah rusak', metode_deteksi: 'Pengamatan visual pelepah', metode_sensus: 'BARIS_SAMPEL', satuan: 'ekor/pelepah', threshold_default: 'Lihat tabel THRESHOLD (per kelompok spesies)', panduan_md: '# UPDKS\nHitung ulat hidup per pelepah pada baris sampel 3,13,23,...' },
    { code: 'TIKUS', name: 'Tikus', nama_lokal: 'Tikus', kategori: 'HAMA', deskripsi: 'Hama tikus pada TBM/TM', gejala: 'Pangkal pelepah/buah tergerek', metode_deteksi: 'Pengamatan visual bekas gerekan', metode_sensus: 'BARIS_SAMPEL', satuan: '%', threshold_default: 'Berbeda per fase tanaman (TBM1/TBM2-3/TM)', panduan_md: '# Tikus\n% serangan = (serangan baru+lama)/sampel x 100%' },
    { code: 'ORYCTES', name: 'Oryctes rhinoceros', nama_lokal: 'Kumbang Tanduk', kategori: 'HAMA', deskripsi: 'Kumbang tanduk penggerek pucuk', gejala: 'Pucuk terpotong huruf V', metode_deteksi: 'Pengamatan visual pucuk', metode_sensus: 'BARIS_SAMPEL', satuan: '%', threshold_default: '% pokok terserang', panduan_md: '# Oryctes\n% serangan = pokok terserang/pokok diamati x 100%' },
    { code: 'RAYAP', name: 'Rayap', nama_lokal: 'Rayap', kategori: 'HAMA', deskripsi: 'Rayap tanah menyerang pokok', gejala: 'Bekas gerekan tanah pada pangkal batang', metode_deteksi: 'Pengamatan visual pangkal batang', metode_sensus: 'GRID', satuan: '%', threshold_default: 'Ambang ekonomi 0% - setiap pokok terserang wajib dikendalikan', panduan_md: '# Rayap\nAmbang ekonomi 0%. Grid baris 3,23,43,... x posisi 3,13,23,...' },
    { code: 'GANODERMA', name: 'Ganoderma boninense', nama_lokal: 'Busuk Pangkal Batang', kategori: 'PENYAKIT', deskripsi: 'Penyakit busuk pangkal batang', gejala: 'Tubuh buah jamur, daun tombak tidak membuka, layu', metode_deteksi: 'Pengamatan visual pangkal batang seluruh pokok', metode_sensus: 'SELURUH_POKOK', satuan: 'skala', threshold_default: 'Kualitatif: TIDAK_ADA/INDIKASI_AWAL/TERINFEKSI_RINGAN/SEDANG/BERAT', panduan_md: '# Ganoderma\nIndikasi & status serangan kualitatif, seluruh pokok diperiksa.' },
  ];
  for (const h of hptDefs) hptId[h.code] = insHpt.run(h).lastInsertRowid;

  // ---------------------------------------------------------------- SPECIES (UPDKS)
  const insSpecies = db.prepare('INSERT INTO species (hpt_id, code, name, group_name) VALUES (?, ?, ?, ?)');
  const speciesId = {};
  const ulatApi = [
    ['SA', 'Setothosea asigna'], ['SN', 'Setora nitens'], ['PL', 'Plesispa reichei'],
    ['DT', 'Darna trima'], ['DD', 'Darna diducta'], ['UA', 'Ulat Api lainnya'],
  ];
  const ulatKantong = [
    ['MC', 'Metisa plana'], ['CT', 'Cremastopsyche pendula'], ['HG', 'Hyalarcta huebneri'],
    ['MP', 'Mahasena corbetti'], ['PP', 'Pteroma plagiophleps'], ['UK', 'Ulat Kantong lainnya'],
  ];
  for (const [code, name] of ulatApi) speciesId[code] = insSpecies.run(hptId.UPDKS, code, name, 'ULAT_API').lastInsertRowid;
  for (const [code, name] of ulatKantong) speciesId[code] = insSpecies.run(hptId.UPDKS, code, name, 'ULAT_KANTONG').lastInsertRowid;

  // ---------------------------------------------------------------- THRESHOLD
  const insThr = db.prepare(
    `INSERT INTO threshold (hpt_id, species_id, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan, severity, effective_date, status)
     VALUES (@hpt_id, @species_id, @fase_tanaman, @kategori, @nilai_min, @nilai_max, @satuan, @tindakan, @severity, @effective_date, 'AKTIF')`
  );
  function thr(hpt_id, species_id, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan) {
    insThr.run({ hpt_id, species_id: species_id || null, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan, severity: kategori, effective_date: EFFECTIVE });
  }

  // UPDKS - Ulat Api group (keyed off species SA; group match applies it to whole ULAT_API group)
  thr(hptId.UPDKS, speciesId.SA, 'SEMUA', 'NORMAL', 0, 2, 'ekor/pelepah', 'Pengamatan rutin');
  thr(hptId.UPDKS, speciesId.SA, 'SEMUA', 'RINGAN', 2, 3.99, 'ekor/pelepah', 'Tingkatkan frekuensi sensus');
  thr(hptId.UPDKS, speciesId.SA, 'SEMUA', 'SEDANG', 4, 4.99, 'ekor/pelepah', 'Rencanakan pengendalian');
  thr(hptId.UPDKS, speciesId.SA, 'SEMUA', 'BERAT', 5, null, 'ekor/pelepah', 'Pengendalian segera (contoh BRD: 6,5 ekor/pelepah -> BERAT)');
  thr(hptId.UPDKS, speciesId.SA, 'SEMUA', 'TIDAK_EFEKTIF', 2, null, 'ekor/pelepah', 'Treatment perlu service jika ulat hidup masih >2 ekor/pelepah');
  // UPDKS - Ulat Kantong group (slightly more tolerant, keyed off species MC)
  thr(hptId.UPDKS, speciesId.MC, 'SEMUA', 'NORMAL', 0, 3, 'ekor/pelepah', 'Pengamatan rutin');
  thr(hptId.UPDKS, speciesId.MC, 'SEMUA', 'RINGAN', 3, 5.99, 'ekor/pelepah', 'Tingkatkan frekuensi sensus');
  thr(hptId.UPDKS, speciesId.MC, 'SEMUA', 'SEDANG', 6, 7.99, 'ekor/pelepah', 'Rencanakan pengendalian');
  thr(hptId.UPDKS, speciesId.MC, 'SEMUA', 'BERAT', 8, null, 'ekor/pelepah', 'Pengendalian segera');

  // TIKUS - berbeda per fase tanaman
  for (const fase of ['TBM1']) {
    thr(hptId.TIKUS, null, fase, 'NORMAL', 0, 1, '%', 'Pengamatan rutin');
    thr(hptId.TIKUS, null, fase, 'RINGAN', 1, 2.99, '%', 'Pasang umpan terbatas');
    thr(hptId.TIKUS, null, fase, 'SEDANG', 3, 4.99, '%', 'Pengendalian umpan blok');
    thr(hptId.TIKUS, null, fase, 'BERAT', 5, null, '%', 'Pengendalian intensif');
  }
  for (const fase of ['TBM2', 'TBM3']) {
    thr(hptId.TIKUS, null, fase, 'NORMAL', 0, 2, '%', 'Pengamatan rutin');
    thr(hptId.TIKUS, null, fase, 'RINGAN', 2, 4.99, '%', 'Pasang umpan terbatas');
    thr(hptId.TIKUS, null, fase, 'SEDANG', 5, 7.99, '%', 'Pengendalian umpan blok');
    thr(hptId.TIKUS, null, fase, 'BERAT', 8, null, '%', 'Pengendalian intensif');
  }
  thr(hptId.TIKUS, null, 'TM', 'NORMAL', 0, 3, '%', 'Pengamatan rutin');
  thr(hptId.TIKUS, null, 'TM', 'RINGAN', 3, 5.99, '%', 'Pasang umpan terbatas');
  thr(hptId.TIKUS, null, 'TM', 'SEDANG', 6, 9.99, '%', 'Pengendalian umpan blok');
  thr(hptId.TIKUS, null, 'TM', 'BERAT', 10, null, '%', 'Pengendalian intensif');

  // ORYCTES - sama untuk semua fase
  thr(hptId.ORYCTES, null, 'SEMUA', 'NORMAL', 0, 2, '%', 'Pengamatan rutin');
  thr(hptId.ORYCTES, null, 'SEMUA', 'RINGAN', 2, 4.99, '%', 'Pasang feromon trap tambahan');
  thr(hptId.ORYCTES, null, 'SEMUA', 'SEDANG', 5, 9.99, '%', 'Sanitasi bahan organik + pengendalian manual');
  thr(hptId.ORYCTES, null, 'SEMUA', 'BERAT', 10, null, '%', 'Pengendalian intensif + sanitasi kebun');

  // RAYAP - ambang ekonomi 0%: pokok terserang otomatis kandidat pengendalian
  thr(hptId.RAYAP, null, 'SEMUA', 'NORMAL', 0, 0.009, '%', 'Pengamatan rutin (ambang ekonomi 0%)');
  thr(hptId.RAYAP, null, 'SEMUA', 'BERAT', 0.01, null, '%', 'Pengendalian segera - ambang ekonomi 0%, setiap pokok terserang wajib dikendalikan');

  // GANODERMA - kualitatif (ordinal 0-4 dari services/sensusEngines.js GANODERMA_SCALE)
  thr(hptId.GANODERMA, null, 'SEMUA', 'NORMAL', 0, 0, 'skala', 'Pengamatan rutin (tidak ada indikasi)');
  thr(hptId.GANODERMA, null, 'SEMUA', 'RINGAN', 1, 1, 'skala', 'Pemantauan intensif, tandai pokok');
  thr(hptId.GANODERMA, null, 'SEMUA', 'SEDANG', 2, 2, 'skala', 'Isolasi/pembongkaran akar terinfeksi terbatas');
  thr(hptId.GANODERMA, null, 'SEMUA', 'BERAT', 3, 3, 'skala', 'Pembongkaran pokok + sanitasi + soil treatment');
  thr(hptId.GANODERMA, null, 'SEMUA', 'CRITICAL', 4, 4, 'skala', 'Pembongkaran & isolasi blok segera, koordinasi R&D');

  // ---------------------------------------------------------------- USERS
  const pw = bcrypt.hashSync('password123', 10);
  const insUser = db.prepare(
    `INSERT INTO user (name, email, phone, password_hash, role_id, estate_id, afdeling_id, area_kerja)
     VALUES (@name, @email, @phone, @password_hash, @role_id, @estate_id, @afdeling_id, @area_kerja)`
  );
  const userId = {};
  const userDefs = [
    { key: 'admin', name: 'Admin EWS', email: 'admin@ews.local', phone: '628110000001', role_id: roleId.ADMIN, estate_id: null, afdeling_id: null, area_kerja: 'Seluruh Estate' },
    { key: 'rnd', name: 'Rina R&D', email: 'rnd@ews.local', phone: '628110000002', role_id: roleId.RND_FOD, estate_id: null, afdeling_id: null, area_kerja: 'Seluruh Estate' },
    { key: 'manager', name: 'Made Manager', email: 'manager@ews.local', phone: '628110000003', role_id: roleId.MANAGER, estate_id: estateId, afdeling_id: null, area_kerja: 'Estate Sungai Lembu' },
    { key: 'askep', name: 'Andi Askep', email: 'askep@ews.local', phone: '628110000004', role_id: roleId.ASKEP_ASISTEN, estate_id: estateId, afdeling_id: afd1, area_kerja: 'Afdeling I' },
    { key: 'deteksi', name: 'Dedi Petugas Deteksi', email: 'deteksi@ews.local', phone: '628110000005', role_id: roleId.PETUGAS_DETEKSI, estate_id: estateId, afdeling_id: afd1, area_kerja: 'Afdeling I - Blok B01,B02' },
    { key: 'sensus', name: 'Siti Petugas Sensus', email: 'sensus@ews.local', phone: '628110000006', role_id: roleId.PETUGAS_SENSUS, estate_id: estateId, afdeling_id: afd1, area_kerja: 'Afdeling I - Blok B01,B02' },
    { key: 'pengendalian', name: 'Parjo Petugas Pengendalian', email: 'pengendalian@ews.local', phone: '628110000007', role_id: roleId.PETUGAS_PENGENDALIAN, estate_id: estateId, afdeling_id: afd2, area_kerja: 'Afdeling II' },
    // ---- V2 demo users (SPEC_V2.md section 1 item 7 new roles) ----
    { key: 'superadmin', name: 'Sinta Super Admin', email: 'superadmin@ews.local', phone: '628110000008', role_id: roleId.SUPER_ADMIN, estate_id: null, afdeling_id: null, area_kerja: 'Seluruh Estate' },
    { key: 'riset', name: 'Rudi Riset', email: 'riset@ews.local', phone: '628110000009', role_id: roleId.RISET, estate_id: null, afdeling_id: null, area_kerja: 'Seluruh Estate' },
    { key: 'viewer', name: 'Vino Viewer Management', email: 'viewer@ews.local', phone: '628110000010', role_id: roleId.VIEWER_MANAGEMENT, estate_id: null, afdeling_id: null, area_kerja: 'Seluruh Estate' },
  ];
  for (const u of userDefs) userId[u.key] = insUser.run({ ...u, password_hash: pw }).lastInsertRowid;

  // ---------------------------------------------------------------- PIC
  const insPic = db.prepare(
    `INSERT INTO pic (user_id, estate_id, afdeling_id, blok_id, jenis_aktivitas, hpt_id, notification_channel) VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  insPic.run(userId.askep, estateId, afd1, null, 'ALL', null, 'DASHBOARD');
  insPic.run(userId.manager, estateId, null, null, 'ALL', null, 'EMAIL');
  insPic.run(userId.rnd, estateId, null, null, 'ALL', null, 'WHATSAPP');

  // ---------------------------------------------------------------- NOTIFICATION RULES
  const insRule = db.prepare(
    `INSERT INTO notification_rule (trigger_type, recipient_role, recipient_user_id, recipient_pic, channel, active) VALUES (?, ?, ?, ?, ?, 1)`
  );
  insRule.run('KATEGORI_SEDANG', 'ASKEP_ASISTEN', null, 0, 'DASHBOARD');
  insRule.run('KATEGORI_BERAT', 'MANAGER', null, 0, 'EMAIL');
  insRule.run('KATEGORI_BERAT', null, null, 1, 'DASHBOARD');
  insRule.run('KATEGORI_CRITICAL', 'RND_FOD', null, 0, 'WHATSAPP');
  insRule.run('SERVICE_REQUIRED', 'ASKEP_ASISTEN', null, 0, 'DASHBOARD');

  // ---------------------------------------------------------------- KNOWLEDGE BASE
  fs.mkdirSync(KB_DIR, { recursive: true });
  const kbFiles = [
    { filename: 'sop-deteksi-updks.md', content: '# SOP Deteksi UPDKS\n\n1. Amati pelepah pada baris sampel.\n2. Hitung ulat hidup per pelepah.\n3. Catat spesies (Ulat Api/Ulat Kantong) bila memungkinkan.\n4. Input hasil ke aplikasi mobile, sistem akan menghitung kategori otomatis.' },
    { filename: 'panduan-sensus-tikus.md', content: '# Panduan Sensus Tikus\n\nGunakan baris sampel 3,13,23,... Hitung serangan baru dan lama per sampel pohon. Persentase serangan dihitung otomatis oleh sistem berdasarkan threshold aktif per fase tanaman.' },
    { filename: 'gejala-ganoderma.md', content: '# Gejala Ganoderma boninense\n\nTubuh buah jamur pada pangkal batang, daun tombak tidak membuka, pelepah bawah menguning dan layu. Periksa seluruh pokok pada blok berisiko tinggi (TM tua, riwayat kasus).' },
  ];
  const insKb = db.prepare(
    `INSERT INTO knowledge_base (hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif, file_path, file_type, uploaded_by)
     VALUES (@hpt_id, @kategori, @judul, @versi, @tanggal_berlaku, 1, @file_path, @file_type, @uploaded_by)`
  );
  const kbMeta = [
    { hpt_id: hptId.UPDKS, kategori: 'Deteksi', judul: 'SOP Deteksi UPDKS', file: kbFiles[0] },
    { hpt_id: hptId.TIKUS, kategori: 'Sensus', judul: 'Panduan Sensus Tikus', file: kbFiles[1] },
    { hpt_id: hptId.GANODERMA, kategori: 'Gejala', judul: 'Gejala Ganoderma boninense', file: kbFiles[2] },
  ];
  for (const kb of kbMeta) {
    const filePath = path.join(KB_DIR, kb.file.filename);
    fs.writeFileSync(filePath, kb.file.content, 'utf8');
    insKb.run({
      hpt_id: kb.hpt_id,
      kategori: kb.kategori,
      judul: kb.judul,
      versi: '1.0',
      tanggal_berlaku: EFFECTIVE,
      file_path: path.relative(process.cwd(), filePath),
      file_type: 'text/markdown',
      uploaded_by: userId.rnd,
    });
  }

  // =================================================================================================
  // ============================ V2 EXTENSIONS (SPEC_V2.md) =======================================
  // =================================================================================================
  // Everything below is ADDITIVE on top of the V1 seed above (nothing above this line changed in
  // meaning). See SPEC_V2.md section 5 for the exact threshold numbers used, and the task's final
  // report for every judgment call made where the FR/BRD text didn't map cleanly onto the
  // yield_partenocarpi/water_management/bahan_organik/tbm_vegetatif table's fixed column set.

  // ---------------------------------------------------------------- EWS CATEGORY
  const insCategory = db.prepare('INSERT INTO ews_category (code, name) VALUES (?, ?)');
  const categoryId = {};
  for (const [code, name] of [
    ['HPT', 'Hama & Penyakit Tanaman'],
    ['YIELD_MAKING', 'Yield Making'],
    ['AGRONOMY', 'Agronomy'],
    ['DEFISIENSI_HARA', 'Defisiensi Hara'],
  ]) {
    categoryId[code] = insCategory.run(code, name).lastInsertRowid;
  }

  // Backfill category_id on the 5 V1 HPT rows (indicator_type already defaults to 'HPT' via the
  // ALTER TABLE ... DEFAULT 'HPT' migration in db.js, nothing to change there).
  const updHptCategory = db.prepare('UPDATE hpt SET category_id=? WHERE id=?');
  for (const code of ['UPDKS', 'TIKUS', 'ORYCTES', 'RAYAP', 'GANODERMA']) {
    updHptCategory.run(categoryId.HPT, hptId[code]);
  }

  // ---------------------------------------------------------------- NEW INDICATORS (hpt table reused)
  const insIndicator = db.prepare(
    `INSERT INTO hpt (code, name, nama_lokal, kategori, status_aktif, deskripsi, gejala, metode_deteksi, metode_sensus, satuan, threshold_default, panduan_md, indicator_type, category_id)
     VALUES (@code, @name, @nama_lokal, @kategori, 1, @deskripsi, @gejala, @metode_deteksi, @metode_sensus, @satuan, @threshold_default, @panduan_md, @indicator_type, @category_id)`
  );
  const indicatorDefs = [
    {
      code: 'PARTENOCARPI', name: 'Partenocarpi / Elaeidobius', nama_lokal: 'Partenocarpi',
      kategori: 'YIELD_MAKING', deskripsi: 'Monitoring fruit set / penyerbukan (Elaeidobius kamerunicus) dan abnormal bunch',
      gejala: 'Bunga jantan antesis rendah, populasi EK rendah, abnormal bunch tinggi',
      metode_deteksi: 'Pengamatan tandan bunga + curah hujan', metode_sensus: 'BARIS_SAMPEL', satuan: 'boolean',
      threshold_default: 'Lihat tabel THRESHOLD (kombinasi curah hujan/populasi EK/abnormal bunch, FR)',
      panduan_md: '# Partenocarpi/Elaeidobius\nSensus minimal 6 baris/blok. EWS aktif jika populasi EK<20.000 ekor/ha DAN curah hujan>270mm/bulan DAN >20mm/periode pagi-siang, ATAU abnormal bunch harian >1%.',
      indicator_type: 'YIELD_MAKING', category_id: categoryId.YIELD_MAKING,
    },
    {
      code: 'WATER_MANAGEMENT', name: 'Water Management', nama_lokal: 'Manajemen Air',
      kategori: 'AGRONOMY', deskripsi: 'Monitoring level air parit', gejala: 'Level air di luar target 40-60cm, genangan berkepanjangan',
      metode_deteksi: 'Pengukuran level air per titik parit', metode_sensus: 'KUALITATIF', satuan: 'cm',
      threshold_default: 'Target normal 40-60 cm di bawah permukaan tanah; alert jika <40cm',
      panduan_md: '# Water Management\nSensus level air paling lambat tanggal 25 tiap bulan, per titik parit.',
      indicator_type: 'YIELD_MAKING', category_id: categoryId.YIELD_MAKING,
    },
    {
      code: 'BAHAN_ORGANIK', name: 'Bahan Organik (Area Pasir)', nama_lokal: 'Bahan Organik',
      kategori: 'AGRONOMY', deskripsi: 'Monitoring kondisi daun menguning pada area pasir', gejala: 'Daun menguning >5% (TM), TBM di bawah baseline normal',
      metode_deteksi: 'Pengamatan visual daun', metode_sensus: 'BARIS_SAMPEL', satuan: '%',
      threshold_default: 'Daun menguning >5% (TM) -- alert',
      panduan_md: '# Bahan Organik\nPer blok area pasir. TM: daun menguning >5% -> alert. TBM: dibandingkan baseline TBM normal (kualitatif, lihat comparison_result).',
      indicator_type: 'YIELD_MAKING', category_id: categoryId.YIELD_MAKING,
    },
    {
      code: 'TBM_VEGETATIF', name: 'TBM Sehat / Standar Vegetatif', nama_lokal: 'TBM Vegetatif',
      kategori: 'AGRONOMY', deskripsi: 'Evaluasi pertumbuhan vegetatif TBM terhadap standar umur', gejala: 'Pertumbuhan (panjang pelepah/jumlah pelepah/LAI) di bawah standar umur',
      metode_deteksi: 'Pengukuran pelepah + LAI', metode_sensus: 'BARIS_SAMPEL', satuan: 'skala',
      threshold_default: 'Di bawah standar umur -> rekomendasi perbaikan (FR tidak memberi angka standar numerik per umur, lihat hasil_evaluasi)',
      panduan_md: '# TBM Vegetatif\nMinimal setiap 3 bulan, sampel pokok 1%. Target produksi acuan (bukan alert threshold): TBM2=10 ton/Ha, TBM3=20 ton/Ha, TM1=30 ton/Ha, TM3=40 ton/Ha.',
      indicator_type: 'YIELD_MAKING', category_id: categoryId.YIELD_MAKING,
    },
    {
      code: 'DEFISIENSI_HARA', name: 'Defisiensi Hara', nama_lokal: 'Defisiensi Hara',
      kategori: 'DEFISIENSI_HARA', deskripsi: 'Defisiensi unsur hara dari leaf (foliar) analysis', gejala: 'Gejala defisiensi per unsur hara (N/P/K/Mg/dst, lihat panduan)',
      metode_deteksi: 'Leaf analysis (Riset) + temuan lapangan (Mandor/Petugas)', metode_sensus: 'KUALITATIF', satuan: 'skala',
      threshold_default: 'Severity RINGAN/SEDANG/BERAT dari leaf analysis (kualitatif, expert judgment Riset -- tidak ada angka numerik baku di FR)',
      panduan_md: '# Defisiensi Hara\nleaf_analysis (Riset) menetapkan unsur_hara + severity; defisiensi_hara_temuan mencatat temuan lapangan yang mengacu ke leaf_analysis tsb.',
      indicator_type: 'DEFISIENSI_HARA', category_id: categoryId.DEFISIENSI_HARA,
    },
  ];
  for (const ind of indicatorDefs) hptId[ind.code] = insIndicator.run(ind).lastInsertRowid;

  // ---------------------------------------------------------------- FORMULA (generic rule engine)
  const insFormula = db.prepare(
    `INSERT INTO formula (hpt_id, formula_type, context, expression_json, unit, description, active)
     VALUES (@hpt_id, @formula_type, @context, @expression_json, @unit, @description, 1)`
  );
  function formula(hpt_id, formula_type, context, expr, unit, description) {
    insFormula.run({ hpt_id, formula_type, context, expression_json: JSON.stringify(expr), unit, description });
  }

  // ---- 5 legacy HPT, re-expressed as data (SPEC_V2.md section 3). Mathematically IDENTICAL to
  // the hard-coded functions in services/sensusEngines.js -- see services/ruleEngine.js header
  // comment + this task's regression report for the before/after PISP1 import proof. context
  // 'SENSUS' matches services/sensusEngines.js's computeByHptCode() lookup.
  formula(hptId.UPDKS, 'PERCENTAGE', 'SENSUS',
    { numerator_fields: ['ulat_hidup_total'], denominator_field: 'jumlah_pelepah_diamati', multiply: 1, unit: 'ekor/pelepah', require_denominator_gt_zero: true },
    'ekor/pelepah', 'UPDKS: ulat_hidup_total / jumlah_pelepah_diamati (identik dengan V1 computeUPDKS)');
  formula(hptId.TIKUS, 'PERCENTAGE', 'SENSUS',
    { numerator_fields: ['serangan_baru', 'serangan_lama'], denominator_field: 'jumlah_sampel', multiply: 100, unit: '%', require_denominator_gt_zero: true },
    '%', 'Tikus: (serangan_baru+serangan_lama)/jumlah_sampel*100 (identik dengan V1 computeTikus)');
  formula(hptId.ORYCTES, 'PERCENTAGE', 'SENSUS',
    { numerator_fields: ['jumlah_pokok_terserang'], denominator_field: 'jumlah_pokok_diamati', multiply: 100, unit: '%', require_denominator_gt_zero: true },
    '%', 'Oryctes: jumlah_pokok_terserang/jumlah_pokok_diamati*100 (identik dengan V1 computeOryctes)');
  formula(hptId.RAYAP, 'PERCENTAGE', 'SENSUS',
    { numerator_fields: ['jumlah_pokok_terserang'], denominator_field: 'jumlah_pokok_diamati', multiply: 100, unit: '%', zero_denominator_fallback: 'BINARY_100_OR_0', forced_when_numerator_gt_zero: true },
    '%', 'Rayap: ambang ekonomi 0% - identik dengan V1 computeRayap (termasuk forced_kandidat_pengendalian)');
  formula(hptId.GANODERMA, 'CATEGORICAL_CONDITION', 'SENSUS',
    { field: 'status_serangan', fallback_field: 'indikasi', default: 'TIDAK_ADA', unit: 'skala',
      scale: { TIDAK_ADA: 0, INDIKASI_AWAL: 1, TERINFEKSI_RINGAN: 2, TERINFEKSI_SEDANG: 3, TERINFEKSI_BERAT: 4 } },
    'skala', 'Ganoderma: skala ordinal (identik dengan V1 GANODERMA_SCALE)');

  // ---- 4 new Yield Making indicators + Defisiensi Hara. context 'YIELD_MAKING' matches
  // routes/yieldMaking.js's computeIndicatorResult() call.
  // JUDGMENT CALL (documented, see task report): the FR's Partenocarpi condition also references
  // "bunga jantan antesis < 4 tandan/ha", but SPEC_V2.md section 2's yield_partenocarpi column
  // list has no such field -- only the 3 conditions below (populasi_ek/rainfall_mm/
  // indikator_hujan_pagi) plus the separate abnormal_bunch_pct>1% rule can be evaluated from the
  // table as specified. Not silently invented as a DB column.
  formula(hptId.PARTENOCARPI, 'AND_OR', 'YIELD_MAKING',
    { op: 'OR', conditions: [
        { op: 'AND', conditions: [
            { field: 'populasi_ek', operator: '<', value: 20000 },
            { field: 'rainfall_mm', operator: '>', value: 270 },
            { field: 'indikator_hujan_pagi', operator: '>', value: 20 },
          ] },
        { field: 'abnormal_bunch_pct', operator: '>', value: 1 },
      ] },
    'boolean', 'FR: (populasi EK<20.000/ha DAN curah hujan>270mm/bulan DAN >20mm/periode pagi-siang) ATAU abnormal bunch harian>1%. "bunga jantan antesis<4 tandan/ha" tidak ada kolomnya di schema V2 -- lihat catatan judgment call.');
  formula(hptId.WATER_MANAGEMENT, 'THRESHOLD', 'YIELD_MAKING',
    { field: 'water_level_cm', unit: 'cm' },
    'cm', 'FR: target normal 40-60cm di bawah permukaan tanah, alert jika <40cm. flooding_duration_hari>20hari belum digabung ke formula ini (judgment call, lihat laporan).');
  formula(hptId.BAHAN_ORGANIK, 'PERCENTAGE', 'YIELD_MAKING',
    { numerator_fields: ['yellowing_count'], denominator_field: 'total_sample', multiply: 100, unit: '%' },
    '%', 'FR: daun menguning >5% (TM) -> alert. Perbandingan TBM ke baseline (comparison_result) tetap kualitatif/manual.');
  formula(hptId.TBM_VEGETATIF, 'CATEGORICAL_CONDITION', 'YIELD_MAKING',
    { field: 'hasil_evaluasi', default: 'SESUAI_STANDAR', unit: 'skala', scale: { SESUAI_STANDAR: 0, DI_BAWAH_STANDAR: 1 } },
    'skala', 'FR tidak memberi angka standar pertumbuhan numerik per umur -- klasifikasi memakai hasil_evaluasi kualitatif (SESUAI_STANDAR/DI_BAWAH_STANDAR), bukan panjang_pelepah_cm/jumlah_pelepah/lai langsung (judgment call).');
  formula(hptId.DEFISIENSI_HARA, 'CATEGORICAL_CONDITION', 'DEFISIENSI_HARA',
    { field: 'severity', default: 'TIDAK_ADA', unit: 'skala', scale: { TIDAK_ADA: 0, RINGAN: 1, SEDANG: 2, BERAT: 3 } },
    'skala', 'Skeleton formula untuk severity leaf_analysis -- belum dipanggil otomatis oleh routes/leafAnalysis.js atau defisiensiHara.js (severity tetap expert judgment Riset), disediakan untuk Rule & Parameter Management.');

  // ---------------------------------------------------------------- THRESHOLD (V2 indicators, exact FR numbers -- SPEC_V2.md section 5)
  thr(hptId.PARTENOCARPI, null, 'SEMUA', 'NORMAL', 0, 0, 'boolean', 'Kondisi mendukung fruit set normal, lanjutkan monitoring bulanan');
  thr(hptId.PARTENOCARPI, null, 'SEMUA', 'BERAT', 1, 1, 'boolean', 'Risiko penurunan fruit set (populasi EK<20.000/ha & curah hujan>270mm/bulan & >20mm pagi-siang, atau abnormal bunch>1%) -- evaluasi bantuan penyerbukan');

  thr(hptId.WATER_MANAGEMENT, null, 'SEMUA', 'NORMAL', 40, null, 'cm', 'Level air sesuai/di atas target normal 40-60 cm di bawah permukaan tanah');
  thr(hptId.WATER_MANAGEMENT, null, 'SEMUA', 'BERAT', null, 39.99, 'cm', 'Level air < 40 cm -- risiko kekeringan akar, evaluasi water management segera (FR)');

  thr(hptId.BAHAN_ORGANIK, null, 'TM', 'NORMAL', 0, 5, '%', 'Daun menguning <=5% (TM), kondisi normal');
  thr(hptId.BAHAN_ORGANIK, null, 'TM', 'BERAT', 5.01, null, '%', 'Daun menguning >5% (TM) -- evaluasi bahan organik/pemupukan (FR)');
  thr(hptId.BAHAN_ORGANIK, null, 'SEMUA', 'NORMAL', 0, 5, '%', 'Daun menguning <=5%, kondisi normal (fallback fase selain TM)');
  thr(hptId.BAHAN_ORGANIK, null, 'SEMUA', 'BERAT', 5.01, null, '%', 'Daun menguning >5% -- evaluasi bahan organik/pemupukan');

  thr(hptId.TBM_VEGETATIF, null, 'SEMUA', 'NORMAL', 0, 0, 'skala', 'Pertumbuhan sesuai standar umur');
  thr(hptId.TBM_VEGETATIF, null, 'SEMUA', 'BERAT', 1, 1, 'skala', 'Pertumbuhan di bawah standar umur -- rekomendasi perbaikan (FR)');

  thr(hptId.DEFISIENSI_HARA, null, 'SEMUA', 'NORMAL', 0, 0, 'skala', 'Tidak ada indikasi defisiensi');
  thr(hptId.DEFISIENSI_HARA, null, 'SEMUA', 'RINGAN', 1, 1, 'skala', 'Defisiensi ringan');
  thr(hptId.DEFISIENSI_HARA, null, 'SEMUA', 'SEDANG', 2, 2, 'skala', 'Defisiensi sedang');
  thr(hptId.DEFISIENSI_HARA, null, 'SEMUA', 'BERAT', 3, 3, 'skala', 'Defisiensi berat -- tindak lanjut segera');

  // ---------------------------------------------------------------- SAMPLING_RULE (SPEC_V2.md section 5 "Scope sensus" column)
  const insSamplingRule = db.prepare(
    `INSERT INTO sampling_rule (hpt_id, method, row_start, row_interval, plant_start, plant_interval, minimum_sample, unit_scope, description, active)
     VALUES (@hpt_id, @method, @row_start, @row_interval, @plant_start, @plant_interval, @minimum_sample, @unit_scope, @description, 1)`
  );
  function samplingRule(hpt_id, opts) {
    insSamplingRule.run({
      hpt_id, method: null, row_start: null, row_interval: null, plant_start: null, plant_interval: null,
      minimum_sample: null, unit_scope: null, description: null, ...opts,
    });
  }
  samplingRule(hptId.UPDKS, { method: 'BARIS_SAMPEL', row_start: 3, row_interval: 10, minimum_sample: 0.01, unit_scope: 'BARIS_SAMPEL', description: 'Setiap blok terdeteksi, sampel pokok 1% (baris & pokok sesuai SOP)' });
  samplingRule(hptId.TIKUS, { method: 'BARIS_SAMPEL', row_start: 3, row_interval: 10, minimum_sample: 24, unit_scope: 'BARIS_SAMPEL', description: 'Setiap blok, +-24 pokok/blok' });
  samplingRule(hptId.ORYCTES, { method: 'GAWANGAN', minimum_sample: 12, unit_scope: 'GAWANGAN', description: '12 gawangan/blok atau setiap 10 gawang' });
  samplingRule(hptId.RAYAP, { method: 'GRID', row_start: 3, row_interval: 20, plant_start: 3, plant_interval: 10, unit_scope: 'SELURUH_POKOK', description: 'Setiap blok, semua pokok (grid baris 3,23,43,63.. x pokok 3,13,23,33..)' });
  samplingRule(hptId.GANODERMA, { method: 'SELURUH_POKOK', unit_scope: 'SELURUH_POKOK', description: 'Setiap blok, semua pokok' });
  samplingRule(hptId.PARTENOCARPI, { method: 'BARIS_SAMPEL', minimum_sample: 6, unit_scope: 'BARIS_SAMPEL', description: 'Minimal 6 baris sensus/blok atau representasi total pokok/ha' });
  samplingRule(hptId.WATER_MANAGEMENT, { method: 'PER_TITIK_PARIT', unit_scope: 'GAWANGAN', description: 'Per titik parit (unit_scope enum tidak punya nilai "per titik" persis -- GAWANGAN dipakai sbg padanan terdekat, lihat method untuk nama asli)' });
  samplingRule(hptId.BAHAN_ORGANIK, { method: 'BARIS_SAMPEL', unit_scope: 'BARIS_SAMPEL', description: 'Per blok area pasir' });
  samplingRule(hptId.TBM_VEGETATIF, { method: 'BARIS_SAMPEL', minimum_sample: 0.01, unit_scope: 'BARIS_SAMPEL', description: 'Setiap blok terdeteksi, sampel pokok 1%' });

  // ---------------------------------------------------------------- SCHEDULING_RULE (SPEC_V2.md section 5 "Interval" column)
  const insSchedulingRule = db.prepare(
    `INSERT INTO scheduling_rule (hpt_id, jenis_kegiatan, interval_type, interval_value, interval_unit, based_on, active)
     VALUES (@hpt_id, @jenis_kegiatan, @interval_type, @interval_value, @interval_unit, @based_on, 1)`
  );
  function schedulingRule(hpt_id, opts) {
    insSchedulingRule.run({ hpt_id, jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1, interval_unit: 'MONTH', based_on: 'LAST_INSPECTION', ...opts });
  }
  // Deteksi HPT tahap awal, semua 5 jenis HPT: rotasi 2 minggu (2x/bulan), kebun non-endemik.
  for (const code of ['UPDKS', 'TIKUS', 'ORYCTES', 'RAYAP', 'GANODERMA']) {
    schedulingRule(hptId[code], { jenis_kegiatan: 'DETEKSI', interval_type: 'BIWEEKLY', interval_value: 1 });
  }
  schedulingRule(hptId.UPDKS, { jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1 });
  schedulingRule(hptId.TIKUS, { jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1 });
  schedulingRule(hptId.ORYCTES, { jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1 });
  schedulingRule(hptId.RAYAP, { jenis_kegiatan: 'SENSUS', interval_type: 'CUSTOM', interval_value: 2, interval_unit: 'MONTH' });
  // Ganoderma: semester (endemik area gambut) seeded as the default cadence. FR also mentions
  // "1x/tahun (non-endemik)" but blok has no endemik/non-endemik flag in the schema to key a
  // second rule off of -- documented judgment call, only the semester cadence is seeded.
  schedulingRule(hptId.GANODERMA, { jenis_kegiatan: 'SENSUS', interval_type: 'CUSTOM', interval_value: 6, interval_unit: 'MONTH' });
  schedulingRule(hptId.PARTENOCARPI, { jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1 });
  // Water Management: "paling lambat tgl 25/bulan" read as a fixed monthly deadline, not a
  // rolling last-inspection interval.
  schedulingRule(hptId.WATER_MANAGEMENT, { jenis_kegiatan: 'SENSUS', interval_type: 'MONTHLY', interval_value: 1, based_on: 'FIXED_DATE' });
  // Bahan Organik: FR's Interval column is "--" (no number given) -- NOT seeded, to avoid
  // inventing a cadence the source document doesn't specify.
  schedulingRule(hptId.TBM_VEGETATIF, { jenis_kegiatan: 'SENSUS', interval_type: 'CUSTOM', interval_value: 3, interval_unit: 'MONTH' });

  // ---------------------------------------------------------------- SCORING CRITERIA (SKELETON -- see routes/scoring.js header)
  const insScoringCriteria = db.prepare(
    `INSERT INTO scoring_criteria (side, code, name, max_poin, description, active) VALUES (@side, @code, @name, @max_poin, @description, 1)`
  );
  for (let i = 1; i <= 5; i++) {
    insScoringCriteria.run({
      side: 'RND', code: `RND_TBD_${i}`, name: `[PLACEHOLDER] Kriteria R&D #${i} - TBD`, max_poin: 10,
      description: 'Rincian kriteria resmi belum tersedia di SPEC_V2.md/FR/BRD manapun -- placeholder struktur skeleton, JANGAN dipakai sebagai rubrik final. Edit dari Master Data > Scoring Criteria setelah kriteria asli dikonfirmasi.',
    });
  }
  for (let i = 1; i <= 5; i++) {
    insScoringCriteria.run({
      side: 'TIM_OPERASIONAL', code: `TIM_OPS_TBD_${i}`, name: `[PLACEHOLDER] Kriteria Tim Operasional #${i} - TBD`, max_poin: 10,
      description: 'Rincian kriteria resmi belum tersedia di SPEC_V2.md/FR/BRD manapun -- placeholder struktur skeleton, JANGAN dipakai sebagai rubrik final. Edit dari Master Data > Scoring Criteria setelah kriteria asli dikonfirmasi.',
    });
  }
  insScoringCriteria.run({
    side: 'BONUS', code: 'BONUS_TBD', name: '[PLACEHOLDER] Bonus - TBD', max_poin: 10,
    description: 'Placeholder bonus (max 10 poin per SPEC_V2.md section 2) -- rincian kriteria bonus resmi belum tersedia.',
  });

  // ---------------------------------------------------------------- SCHEDULE
  const insSched = db.prepare(
    `INSERT INTO schedule (user_id, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'RENCANA')`
  );
  insSched.run(userId.sensus, estateId, afd1, bloks.B01.id, 'SENSUS', hptId.UPDKS, TODAY, );
  insSched.run(userId.deteksi, estateId, afd2, bloks.B03.id, 'DETEKSI', hptId.TIKUS, TODAY);
  insSched.run(userId.sensus, estateId, afd3, bloks.B05.id, 'SENSUS', hptId.GANODERMA, TODAY);

  // ---------------------------------------------------------------- SAMPLE FIELD DATA
  // A handful of routine (NORMAL) detections/sensus for realism...
  ingestDetection({ blok_id: bloks.B02.id, hpt_id: hptId.ORYCTES, tanggal: TODAY, waktu: '08:15', gejala: 'Pucuk sedikit terpotong', kondisi_indikator: 'Ringan', jumlah_indikasi: 1, catatan: 'Pengamatan rutin', gps_lat: -2.1052, gps_lng: 101.5048, source: 'MOBILE', device_id: 'device-deteksi-01' }, { user_id: userId.deteksi });
  ingestDetection({ blok_id: bloks.B05.id, hpt_id: hptId.GANODERMA, tanggal: TODAY, waktu: '09:00', gejala: 'Tidak ada gejala', kondisi_indikator: 'Baik', catatan: 'Pengamatan rutin, tidak ada indikasi', gps_lat: -2.1203, gps_lng: 101.5199, source: 'MOBILE', device_id: 'device-deteksi-02' }, { user_id: userId.deteksi });
  ingestSensus({ blok_id: bloks.B06.id, jenis_sensus: 'ORYCTES', tanggal: TODAY, hasil_json: { jumlah_pokok_terserang: 3, jumlah_pokok_diamati: 120 }, gps_lat: -2.1252, gps_lng: 101.5248, source: 'MOBILE', device_id: 'device-sensus-01' }, { user_id: userId.sensus });

  // ...and one that DELIBERATELY crosses the threshold, matching the SPEC.md section 4 worked
  // example exactly: UPDKS hasil = 6,5 ekor/pelepah (13 ulat / 2 pelepah), threshold BERAT = >5
  // -> kategori BERAT -> creates INCIDENT + ALERT + NOTIFICATION end-to-end.
  const alertDemo = ingestSensus(
    {
      blok_id: bloks.B01.id,
      jenis_sensus: 'UPDKS',
      species_id: speciesId.SA,
      tanggal: TODAY,
      hasil_json: { ulat_hidup_total: 13, jumlah_pelepah_diamati: 2 },
      catatan: 'Demo data: contoh persis dari SPEC.md - memicu EWS ALERT kategori BERAT',
      gps_lat: -2.1003,
      gps_lng: 101.4999,
      source: 'MOBILE',
      device_id: 'device-sensus-01',
    },
    { user_id: userId.sensus }
  );
  console.log(
    `Demo alert-crossing sensus created: sensus.id=${alertDemo.row.id}, kategori=${alertDemo.row.kategori}, incident=${alertDemo.engineResult.incident ? alertDemo.engineResult.incident.incident_code : null}, alert.id=${alertDemo.engineResult.alert ? alertDemo.engineResult.alert.id : null}`
  );

  // A Tikus detection in B03 (TM) crossing SEDANG for a second, different-HPT incident example.
  const tikusDemo = ingestSensus(
    {
      blok_id: bloks.B03.id,
      jenis_sensus: 'TIKUS',
      tanggal: TODAY,
      hasil_json: { serangan_baru: 5, serangan_lama: 2, jumlah_sampel: 100 },
      catatan: 'Demo data: serangan tikus kategori SEDANG',
      gps_lat: -2.1103,
      gps_lng: 101.5099,
      source: 'MOBILE',
      device_id: 'device-sensus-02',
    },
    { user_id: userId.sensus }
  );
  console.log(`Demo Tikus sensus: kategori=${tikusDemo.row.kategori}, incident=${tikusDemo.engineResult.incident ? tikusDemo.engineResult.incident.incident_code : null}`);

  // BRD V3 EWS Dictionary (31 EWS_ID rows) -- depends on the hpt codes just seeded above
  // (TIKUS/UPDKS/ORYCTES/RAYAP/GANODERMA/PARTENOCARPI/WATER_MANAGEMENT/BAHAN_ORGANIK/
  // TBM_VEGETATIF/DEFISIENSI_HARA), so it must run after them, not from db.js's require-time
  // (see seedEwsDictionaryV3.js's header comment). Idempotent -- safe even if already seeded.
  const { seedEwsDictionaryV3 } = require('./seedEwsDictionaryV3');
  const ewsDictResult = seedEwsDictionaryV3(db);
  if (!ewsDictResult.skipped) console.log(`EWS Dictionary V3 seeded: ${ewsDictResult.committed} EWS_ID rows.`);

  // BRD V3.1 Assessment Mapping Dictionary + EWS-01..EWS-31 alias -- must run after
  // seedEwsDictionaryV3 above (see seedAssessmentMappingV31.js's header comment).
  const { seedAssessmentMappingV31 } = require('./seedAssessmentMappingV31');
  const asmResult = seedAssessmentMappingV31(db);
  if (!asmResult.skipped) console.log(`Assessment Mapping V3.1 seeded: ${asmResult.mappingRows} rows, ${asmResult.aliased} EWS aliases.`);

  console.log('\nSeed complete.');
  console.log('Demo login credentials (password for all: password123):');
  for (const u of userDefs) console.log(`  ${u.email}  (${roles.find((r) => roleId[r[0]] === u.role_id)[0]})`);
}

main();

// Give the mock notification provider's fire-and-forget promises a beat to flush their DB
// writes before the process exits.
setTimeout(() => process.exit(0), 300);
