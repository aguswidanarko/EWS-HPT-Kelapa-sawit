# SPESIFIKASI TEKNIS — Sistem EWS HPT Kelapa Sawit

Sumber: BRD 01 (Aplikasi Mobile EWS HPT — Offline First) v1.0 dan BRD 02 (Dashboard EWS HPT — Online) v1.0.

Dokumen ini adalah acuan implementasi untuk tiga komponen yang dibangun dalam satu monorepo:

- `backend/` — REST API + database, sumber kebenaran tunggal (Node.js + Express + better-sqlite3)
- `dashboard/` — Web dashboard online (React + Vite + Leaflet + Recharts)
- `mobile/` — Aplikasi mobile Android offline-first (React Native + Expo + expo-sqlite)

## 1. Prinsip Desain (BRD 02 §59, wajib dipegang semua komponen)

1. **OFFLINE FIRST** — petugas tidak boleh terhambat jaringan.
2. **CONFIGURABLE** — HPT, threshold, metode, knowledge base tidak boleh hard-coded; semua dari tabel master.
3. **GEOREFERENCED** — data lapangan selalu punya lokasi (lat/lng/accuracy/timestamp).
4. **TRACEABLE** — setiap kasus bisa ditelusuri dari deteksi sampai evaluasi lewat Incident ID.
5. **EVENT DRIVEN** — data yang melewati threshold menghasilkan event EWS (alert), bukan proses manual.
6. **NO APPROVAL BOTTLENECK** — tidak ada approval workflow untuk jadwal/sensus/treatment; status hanya menggambarkan kondisi operasional, bukan persetujuan.
7. **ACTION ORIENTED** — alert harus mengarah ke tindak lanjut, bukan berhenti di laporan.
8. **ONE INCIDENT — ONE HISTORY** — satu kasus = satu riwayat utuh dari deteksi sampai evaluasi.

## 2. Struktur Lokasi

`Estate → Afdeling → Blok → Baris → Posisi Pokok`

Tidak ada ID individu permanen per pohon. "Posisi" adalah posisi relatif dalam baris, bukan ID pohon.

Contoh: `Estate A / Afdeling 2 / Blok B12 / Baris 13 / Posisi 15`

## 3. Data Model (entitas utama, BRD 02 §50–51)

```
USER(id, name, email, password_hash, role_id, estate_id, afdeling_id, area_kerja, created_at)
ROLE(id, code, name)  -- ADMIN, RND_FOD, MANAGER, ASKEP_ASISTEN, PETUGAS_DETEKSI, PETUGAS_SENSUS, PETUGAS_PENGENDALIAN
ESTATE(id, code, name, map_file_ref)
AFDELING(id, estate_id, code, name, map_file_ref)
BLOK(id, afdeling_id, code, name, luas, tahun_tanam, status_tanaman, referensi_polygon, jumlah_baris, parameter_sampling_json)
BARIS(id, blok_id, nomor)  -- opsional, bisa derived dari parameter_sampling
HPT(id, code, name, nama_lokal, kategori, status_aktif, deskripsi, gejala, metode_deteksi, metode_sensus, satuan, threshold_default, panduan_md)
SPECIES(id, hpt_id, code, name)  -- misal UPDKS: Ulat Api (SA, SN, PL, DT, DD, UA), Ulat Kantong (MC, CT, HG, MP, PP, UK)
THRESHOLD(id, hpt_id, species_id, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan, severity, effective_date, status)
KNOWLEDGE_BASE(id, hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif, file_path, file_type)
SCHEDULE(id, user_id, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana, status)
DETECTION(id, local_id, server_id, activity_id, incident_id, user_id, device_id, estate_id, afdeling_id, blok_id, baris, posisi, tanggal, waktu, hpt_id, gejala, kondisi_indikator, jumlah_indikasi, catatan, foto_id, gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, sync_status, sync_attempt, sync_error, created_at, updated_at, source)
SENSUS(id, local_id, server_id, activity_id, incident_id, jenis_sensus, user_id, device_id, estate_id, afdeling_id, blok_id, jalur_baris, hasil_json, hasil_hitung, kategori, saran_pengendalian, gps_lat, gps_lng, gps_accuracy, foto_id, catatan, tanggal, sync_status, created_at, updated_at, source)
TREATMENT(id, local_id, server_id, incident_id, hpt_id, estate_id, afdeling_id, blok_id, luas_serangan, metode_pengendalian, tanggal_mulai, tanggal_selesai, jumlah_pokok, hk, material, jumlah_material, alat, pic, catatan, foto_id, gps_lat, gps_lng, status, sync_status, created_at, updated_at, source)
MORTALITY(id, local_id, server_id, incident_id, treatment_id, tanggal, blok, sampel, jumlah_hidup, jumlah_mati, kondisi, foto_id, gps_lat, gps_lng, hasil_efektivitas, service_required, status, sync_status, created_at, updated_at, source)
INCIDENT(id, incident_code /* EWS-YYYYMMDD-XXXX */, hpt_id, estate_id, afdeling_id, blok_id, detection_id, sensus_id, treatment_id, mortality_id, status /* NEW→ACKNOWLEDGED→IN_PROGRESS→CONTROLLED→MONITORING→CLOSED */, severity /* NORMAL/RINGAN/SEDANG/BERAT/CRITICAL */, opened_at, closed_at)
ALERT(id, incident_id, hpt_id, estate_id, afdeling_id, blok_id, hasil, threshold_ref, kategori, status, created_at)
NOTIFICATION(id, alert_id, channel /* DASHBOARD/EMAIL/WHATSAPP */, recipient, sent_at, status /* PENDING/SENT/DELIVERED/FAILED */, response_provider, error)
PIC(id, user_id, estate_id, afdeling_id, blok_id, jenis_aktivitas, hpt_id, notification_channel)
PHOTO(id, entity_type, entity_id, file_path, gps_lat, gps_lng, timestamp, user_id, compressed_size)
GPS(id, entity_type, entity_id, lat, lng, accuracy, timestamp)
AUDIT_LOG(id, user_id, aktivitas, waktu, data_sebelum_json, data_sesudah_json, device_source, ip_session)
SYNC_LOG(id, user_id, device_id, started_at, finished_at, jumlah_data, success_count, failed_count, status)
```

Semua record lapangan (DETECTION, SENSUS, TREATMENT, MORTALITY) wajib punya field minimal BRD 01 §8: `local_id, server_id, activity_id, incident_id, user_id, device_id, created_at, updated_at, sync_status, sync_attempt, sync_error`. `sync_status` ∈ `DRAFT, READY_TO_SYNC, SYNCING, SYNCED, FAILED`.

## 4. Threshold & Incident Engine (BRD 01 §16/26, BRD 02 §17/52)

```
DATA MASUK → VALIDASI → IDENTIFIKASI HPT → IDENTIFIKASI FASE TANAMAN → AMBIL THRESHOLD
  → HITUNG → KLASIFIKASI (NORMAL/RINGAN/SEDANG/BERAT/CRITICAL) → BUAT/UPDATE INCIDENT
  → jika kategori melewati threshold: BUAT ALERT → NOTIFIKASI (dashboard/email/whatsapp)
```

Contoh (BRD): UPDKS hasil = 6,5 ekor/pelepah, threshold BERAT = >5 → kategori BERAT, `EWS_ALERT = TRUE`.

Threshold TIDAK BOLEH hard-coded — selalu query dari tabel THRESHOLD berdasar (hpt_id, species_id?, fase_tanaman, effective_date terbaru, status aktif).

## 5. Rumus Sensus per HPT

- **UPDKS (baris sampel: 3,13,23,33,...)**: kategori = `ulat_hidup_total / jumlah_pelepah_diamati` dibandingkan threshold ringan/sedang/berat per kelompok spesies ulat (Ulat Api vs Ulat Kantong berbeda).
- **Tikus (baris sampel)**: `persentase_serangan = (serangan_baru+serangan_lama) / jumlah_sampel × 100%`; threshold berbeda untuk TBM1, TBM2-3, TM.
- **Oryctes (baris sampel)**: `% Serangan = jumlah_pokok_terserang / jumlah_pokok_diamati × 100%`.
- **Rayap (seluruh pokok, grid baris 3,23,43,63.. × pokok 3,13,23,33..)**: ambang ekonomi = 0% → pokok terserang = otomatis kandidat pengendalian.
- **Ganoderma (seluruh pokok)**: indikasi + status serangan (kualitatif), tidak ada rumus numerik — funsgi indikasi & status.

Baris sampel dan grid system harus digenerate otomatis dari `parameter_sampling_json` pada BLOK (jangan hard-code angka di kode aplikasi).

## 6. Modul Mobile (Android, offline-first) — BRD 01

**Login**: online-only pertama kali, session/token tersimpan aman untuk pemakaian offline berikutnya (kebijakan keamanan: token expiry + refresh saat online).

**Download data offline (saat online)**: master lokasi (Estate/Afdeling/Blok), HPT, threshold, panduan/knowledge base, jadwal, peta relevan. Tampilkan waktu "Sinkronisasi terakhir".

**Header status koneksi**: 🟢 Online / 🟠 Sinkronisasi / 🔴 Offline.

**Dashboard Mobile (home)**: status koneksi, jumlah tugas hari ini, ringkasan Deteksi/Sensus/Pengendalian/Mortalitas, data belum tersinkron, alert lokal, akses cepat Panduan. Menu: Deteksi, Sensus, Pengendalian, Mortalitas, Panduan, Riwayat, Sinkronisasi.

**Modul Deteksi**: 3 pertanyaan dasar (Apakah melihat hama/penyakit? Hama/penyakit apa? Di mana lokasinya?). Input: tanggal, waktu, estate, afdeling, blok, baris, posisi relatif (opsional), HPT (min UPDKS, Tikus, Oryctes, Rayap, Ganoderma + lainnya dari master), gejala, kondisi/indikator, jumlah/tingkat indikasi, catatan, foto, GPS. Threshold check otomatis jika parameter kuantitatif.

**Modul Sensus**: pilih engine sesuai HPT (baris sampel / grid / seluruh pokok), form spesifik per HPT sesuai §5 di atas, simpan offline, hitung kategori otomatis dari threshold cache lokal.

**GPS**: rekam lat/lng/accuracy/timestamp di setiap kegiatan. Jika di luar blok/area terpilih → tampilkan warning "⚠️ Lokasi Anda berada di luar area Blok B12" dengan pilihan [Kembali ke lokasi] / [Tetap simpan] (menyimpan tetap boleh, tapi flag `location_warning = TRUE`). GPS tidak boleh aktif terus-menerus (hemat baterai — aktifkan hanya saat form dibuka/submit).

**Foto**: dari kamera, metadata (timestamp, GPS, user, activity_id, incident_id, HPT, blok), dikompresi sebelum simpan/sync.

**Modul Pengendalian**: incident_id, HPT, lokasi, luas serangan, metode (drone spraying, fogging, manual, racun tikus, lainnya dari master), tanggal mulai/selesai, jumlah pokok, HK, material+jumlah, alat, PIC, catatan, foto, GPS.

**Sensus Mortalitas**: setelah treatment — incident_id, treatment_id, tanggal, blok, sampel, jumlah hidup/mati, kondisi, foto, GPS; sistem bandingkan dengan threshold efektivitas (contoh: jika ulat hidup masih >2 ekor/pelepah → treatment perlu service).

**Incident ID**: format `EWS-YYYYMMDD-XXXX`, menghubungkan Deteksi→Sensus→Treatment→Mortalitas.

**Warning di mobile**: 🔴 ALERT HPT ketika threshold terlampaui, data otomatis ditandai `WARNING` dan dikirim saat sinkronisasi.

**Sinkronisasi** (saat online): upload data baru+foto+GPS, download master/threshold/knowledge-base/jadwal terbaru, update status, retry otomatis untuk data gagal.

**Sync Center**: tampilkan ringkasan (mis. "17 data belum terkirim — Deteksi 10, Sensus 5, Treatment 2"), tombol "Sinkronkan Sekarang", per-item status (belum terkirim/sedang dikirim/berhasil/gagal/error).

**Konflik data**: server = source of truth untuk master. Data lapangan: jangan overwrite tanpa audit; record yang sudah sync diberi server_id; perubahan dicatat sebagai update baru; konflik dicatat di audit log.

**Knowledge base offline**: SOP, panduan deteksi/sensus/pengendalian, foto gejala, threshold, metode pengamatan — semua harus bisa dibuka tanpa internet setelah sinkron.

**Riwayat**: kegiatan hari ini & sebelumnya (deteksi/sensus/treatment/mortalitas) + status sync.

**Non-functional**: harus tetap berjalan penuh offline; form dibuka cepat tanpa perlu koneksi server; data tidak boleh hilang saat app ditutup/device restart/koneksi putus/sync gagal; security (auth, authorization, secure local storage, secure API, token expiration, audit trail); GPS hemat baterai; foto dikompresi & cache dikelola.

**Out of scope v1** (BRD 01 §3.2): approval manager/R&D, administrasi payroll, pengelolaan stok gudang penuh, procurement, AI diagnosis HPT.

## 7. Modul Dashboard (Web, online) — BRD 02

Konsep: **EARLY WARNING → ACTION → MONITORING**, bukan cuma DATA → REPORT.

Menu utama (16): Dashboard Utama, Peta EWS, Deteksi, Sensus, Pengendalian, Mortalitas, EWS Alert Center, Incident Management, Knowledge Base, Import Data, Master Data, PIC/User, Notification, Report, Audit Log, System Settings.

**Dashboard Utama (KPI)**: total deteksi, deteksi hari ini, total sensus, blok terindikasi, blok melewati threshold, pengendalian berjalan, mortalitas pending, kasus perlu service.

**EWS Alert Center**: fitur inti. Alert card contoh: 🔴 CRITICAL — UPDKS Blok B12, hasil 6,5 ekor/pelepah, threshold >5, status BERAT. Status alert: NEW→ACKNOWLEDGED→IN_PROGRESS→CONTROLLED→MONITORING→CLOSED (tanpa approval, murni status operasional).

**Alert Detail**: info (incident_id, HPT, estate/afdeling/blok/baris, petugas, waktu, GPS, hasil, threshold, kategori) + bukti (foto, data deteksi/sensus) + timeline (Deteksi→Warning→Sensus→Treatment→Mortalitas).

**Incident Management**: setiap kasus lewat threshold dapat Incident ID; menghubungkan seluruh siklus; bisa ditelusuri utuh.

**Peta EWS (GIS)**: layer Estate/Afdeling/Blok/Deteksi/Sensus/Treatment/Alert; warna status: Hijau=normal, Kuning=ringan, Oranye=sedang, Merah=berat/critical. Klik blok → detail (estate/afdeling/blok/luas/tahun tanam/deteksi/sensus/HPT dominan/tingkat serangan/treatment/mortalitas/PIC/riwayat). Upload peta Estate & Afdeling (format GIS umum: GeoJSON/Shapefile) dengan preview, validasi, publish, update, versioning; pisahkan file sumber vs layer yang dipakai aplikasi. Heatmap konsentrasi serangan dengan filter periode/HPT/severity/estate/afdeling/blok.

**Master Data**: Estate, Afdeling, Blok (luas, tahun tanam, status tanaman, referensi polygon, jumlah baris, parameter sampling — tanpa ID permanen per pokok), HPT (configurable, field lengkap termasuk metode deteksi/sensus, satuan, threshold, panduan), Species (untuk HPT yang butuh identifikasi spesies, mis. UPDKS), Threshold (configurable per HPT/spesies/fase tanaman/kategori/min/max/satuan/tindakan/severity/effective_date).

**Notification Engine**: channel Dashboard/Email/WhatsApp (provider WhatsApp configurable, tidak lock vendor). Rule: trigger (threshold terlampaui, kategori sedang/berat/critical, mortalitas tidak efektif, service diperlukan) × recipient (PIC blok, asisten, askep, manager, R&D/FOD, user tertentu). Template WhatsApp & Email sesuai contoh BRD §20–21. Notification log per alert (channel, recipient, waktu, status, response provider, error).

**Knowledge Base**: admin upload (PDF/DOC/DOCX/XLS/XLSX/gambar), kategori (SOP/Deteksi/Sensus/Pengendalian/Mortalitas/Threshold/Gejala/Foto/Materi pelatihan), versi, tanggal berlaku, status aktif, publish; sinkron ke mobile (tampilkan progres, contoh "Published v2.1, Mobile Sync 97%").

**Import Data (Excel)**: Deteksi, Sensus, Pengendalian (+opsional Mortalitas/Master/Histori). Sediakan Download Template (header + contoh data + data dictionary + format field + keterangan, mengikuti struktur DB). Validasi: kolom wajib, format tanggal, estate/afdeling/blok/HPT/spesies valid, angka valid, threshold, duplikasi, referensi master. Preview sebelum import (contoh: 1.245 record, 1.220 valid, 25 error, user bisa lihat error) — tidak boleh partial import tanpa konfirmasi eksplisit.

**Duplicate Detection**: kombinasi estate+afdeling+blok+tanggal+HPT+petugas+activity_type → tandai "Kemungkinan data duplikat", user bisa Batalkan/Lanjutkan/Tandai sebagai duplicate.

**Reporting**: Laporan Deteksi/Sensus/Pengendalian/Mortalitas/Alert/HPT per Blok/per Afdeling/per Estate/Trend/Treatment/Service; filter, export Excel & PDF. EWS Daily Report (ringkasan harian: deteksi, sensus, alert, critical, treatment, service). EWS Monthly Report (total, distribusi HPT, trend, blok kritis, treatment, mortalitas, service, efektivitas pengendalian).

**Data Quality Dashboard**: indikator data belum lengkap, GPS tidak tersedia/di luar blok, HPT/blok tidak dikenal, duplicate, import error, data belum tersinkron.

**Monitoring Synchronization**: last sync per mobile user/device, jumlah data, success/failed/pending.

**PIC / User / Role Management**: master PIC (user, role, estate, afdeling, blok, jenis aktivitas, HPT, notification channel). Role minimum: Administrator (semua akses), R&D/FOD (monitoring, analisis, knowledge base, threshold), Manager (monitoring wilayah), Askep/Asisten (monitoring operasional), Petugas (lihat data & kegiatan sesuai wilayah — role detail sesuai BRD 01 §4: Petugas Deteksi, Petugas Sensus, Petugas Pengendalian, Asisten/Askep).

**Audit Trail**: user, aktivitas, waktu, data sebelum/sesudah, device/source (mobile/excel/web/api), IP/session bila relevan.

**Data Source tagging**: setiap record diberi `source` ∈ MOBILE, EXCEL, WEB, API — penting membedakan data lapangan vs histori import.

**API untuk Mobile** (BRD 02 §49): login, download master/threshold/knowledge-base/jadwal, upload deteksi/sensus/treatment/mortalitas/foto, sync status, push notification.

**Security**: HTTPS, authentication, RBAC, session management, password policy, API authentication (JWT), file validation, upload restrictions, audit log, backup database.

**Backup**: database, knowledge base, foto, peta, audit log — perlu mekanisme backup & recovery (implementasikan sebagai script/cron, dijelaskan di README, bukan wajib infra produksi).

**Out of scope v1 (implikasi)**: approval workflow, AI image recognition, prediksi outbreak, integrasi GIS lanjutan/sistem perusahaan lain — ini masuk Phase 3/4 BRD, tidak dibangun di v1.

## 8. Prioritas Implementasi (BRD 02 §58) — dipakai untuk urutan build v1

- **Phase 1 (dibangun penuh sekarang)**: Login, Master data, Mobile offline, Deteksi, Sensus, GPS, Sync, Dashboard, Alert, Threshold.
- **Phase 2 (dibangun sekarang, prioritas kedua)**: Pengendalian, Mortalitas, Incident Management, Knowledge Base, Import Excel, Reporting.
- **Phase 3 (scaffold/stub + rencana jelas, tidak full)**: Heatmap, Trend analysis, Escalation, Advanced notification, Analitik prediktif.
- **Phase 4 (di luar scope v1, dicatat sebagai roadmap saja)**: AI image recognition, prediksi outbreak, integrasi GIS lanjutan, integrasi sistem perusahaan lain.

## 9. Rekomendasi tambahan (di luar BRD, keputusan desain build v1)

1. Backend pakai SQLite (file `ews.db`) via `better-sqlite3` supaya seluruh sistem bisa dijalankan tanpa dependency eksternal (server DB) — untuk produksi nyata, migrasi ke PostgreSQL + PostGIS sangat direkomendasikan (BRD menyebut kebutuhan GIS/polygon yang idealnya pakai PostGIS).
2. Autentikasi JWT dengan access token pendek + refresh token, sesuai kebutuhan "session aman dipakai offline" (BRD 01 §9).
3. Foto disimpan sebagai file di disk (`uploads/photos`), path direferensikan di DB; kompresi dilakukan di sisi mobile sebelum upload (BRD 01 §15) dan divalidasi ukuran di backend.
4. Baris sampel & grid system: disimpan sebagai fungsi generator (`generateBarisSampel(start, step, totalBaris)`, `generateGrid(...)`) dengan parameter dari `parameter_sampling_json` di BLOK — bukan hard-coded array.
5. WhatsApp/Email integration: dibangun sebagai adapter interface (`NotificationProvider`) dengan implementasi "log-only/mock" default (karena kredensial provider WhatsApp/SMTP produksi milik perusahaan) + dokumentasi cara colokkan provider asli.
6. Peta: BRD minta upload GeoJSON/Shapefile; v1 mendukung upload **GeoJSON** langsung (paling portable untuk web Leaflet) dengan catatan Shapefile perlu konversi (mis. `ogr2ogr`) sebelum upload — didokumentasikan di README.
