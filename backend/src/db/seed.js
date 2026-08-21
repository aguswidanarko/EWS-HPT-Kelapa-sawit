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
  const roles = [
    ['ADMIN', 'Administrator'],
    ['RND_FOD', 'R&D / FOD'],
    ['MANAGER', 'Manager'],
    ['ASKEP_ASISTEN', 'Askep / Asisten'],
    ['PETUGAS_DETEKSI', 'Petugas Deteksi'],
    ['PETUGAS_SENSUS', 'Petugas Sensus'],
    ['PETUGAS_PENGENDALIAN', 'Petugas Pengendalian'],
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

  console.log('\nSeed complete.');
  console.log('Demo login credentials (password for all: password123):');
  for (const u of userDefs) console.log(`  ${u.email}  (${roles.find((r) => roleId[r[0]] === u.role_id)[0]})`);
}

main();

// Give the mock notification provider's fire-and-forget promises a beat to flush their DB
// writes before the process exits.
setTimeout(() => process.exit(0), 300);
