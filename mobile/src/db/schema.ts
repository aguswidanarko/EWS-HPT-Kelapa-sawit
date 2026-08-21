// Local SQLite schema (SPEC.md section 3 + section 6). Every field-record table carries the full
// sync envelope (local_id, server_id, activity_id, incident_id, user_id, device_id, created_at,
// updated_at, sync_status, sync_attempt, sync_error, source) required by BRD 01 section 8.
//
// Master data tables mirror the backend's read-only reference tables (Estate/Afdeling/Blok/HPT/
// Species/Threshold/KnowledgeBase/Schedule) - the mobile app NEVER writes to these except via the
// "download data" sync flow, matching the server-is-source-of-truth-for-master policy.

export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------- app/session meta
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT
);

CREATE TABLE IF NOT EXISTS session_user (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_json TEXT NOT NULL
);

-- ---------------------------------------------------------------- master data (cached, read-only)
CREATE TABLE IF NOT EXISTS estates (
  id INTEGER PRIMARY KEY,
  code TEXT, name TEXT, map_file_ref TEXT
);

CREATE TABLE IF NOT EXISTS afdelings (
  id INTEGER PRIMARY KEY,
  estate_id INTEGER, code TEXT, name TEXT, map_file_ref TEXT
);

CREATE TABLE IF NOT EXISTS bloks (
  id INTEGER PRIMARY KEY,
  afdeling_id INTEGER, code TEXT, name TEXT, luas REAL, tahun_tanam INTEGER,
  status_tanaman TEXT, referensi_polygon TEXT, jumlah_baris INTEGER, parameter_sampling_json TEXT
);

CREATE TABLE IF NOT EXISTS hpt (
  id INTEGER PRIMARY KEY,
  code TEXT, name TEXT, nama_lokal TEXT, kategori TEXT, status_aktif INTEGER,
  deskripsi TEXT, gejala TEXT, metode_deteksi TEXT, metode_sensus TEXT, satuan TEXT,
  threshold_default TEXT, panduan_md TEXT
);

CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY,
  hpt_id INTEGER, code TEXT, name TEXT, group_name TEXT
);

CREATE TABLE IF NOT EXISTS thresholds (
  id INTEGER PRIMARY KEY,
  hpt_id INTEGER, species_id INTEGER, fase_tanaman TEXT, kategori TEXT,
  nilai_min REAL, nilai_max REAL, satuan TEXT, tindakan TEXT, severity TEXT,
  effective_date TEXT, status TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY,
  hpt_id INTEGER, kategori TEXT, judul TEXT, versi TEXT, tanggal_berlaku TEXT,
  status_aktif INTEGER, file_path TEXT, file_type TEXT, download_url TEXT,
  cached_local_path TEXT, cached_text TEXT
);

CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY,
  user_id INTEGER, estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER,
  jenis_kegiatan TEXT, hpt_id INTEGER, tanggal_rencana TEXT, status TEXT
);

CREATE TABLE IF NOT EXISTS cached_incidents (
  id INTEGER PRIMARY KEY,
  incident_code TEXT, hpt_id INTEGER, hpt_name TEXT, estate_id INTEGER, afdeling_id INTEGER,
  blok_id INTEGER, blok_code TEXT, status TEXT, severity TEXT, opened_at TEXT
);

-- ---------------------------------------------------------------- field records (offline-authored)
CREATE TABLE IF NOT EXISTS detections (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, activity_id TEXT NOT NULL, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL,
  baris INTEGER, posisi INTEGER, tanggal TEXT NOT NULL, waktu TEXT,
  hpt_id INTEGER NOT NULL, species_id INTEGER,
  gejala TEXT, kondisi_indikator TEXT, jumlah_indikasi REAL, catatan TEXT,
  foto_local_id TEXT,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_detections_sync ON detections(sync_status);

CREATE TABLE IF NOT EXISTS sensus (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, activity_id TEXT NOT NULL, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  jenis_sensus TEXT NOT NULL, estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL,
  species_id INTEGER, jalur_baris_json TEXT, hasil_json TEXT NOT NULL, hasil_hitung REAL,
  kategori_lokal TEXT, saran_pengendalian TEXT, foto_local_id TEXT, catatan TEXT, tanggal TEXT NOT NULL,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT,
  ews_alert_lokal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sensus_sync ON sensus(sync_status);

CREATE TABLE IF NOT EXISTS treatments (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, activity_id TEXT NOT NULL, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  hpt_id INTEGER NOT NULL, estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL,
  luas_serangan REAL, metode_pengendalian TEXT, tanggal_mulai TEXT, tanggal_selesai TEXT,
  jumlah_pokok INTEGER, hk REAL, material TEXT, jumlah_material TEXT, alat TEXT, pic TEXT, catatan TEXT,
  foto_local_id TEXT, gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT,
  status TEXT NOT NULL DEFAULT 'BERJALAN'
);
CREATE INDEX IF NOT EXISTS idx_treatments_sync ON treatments(sync_status);

CREATE TABLE IF NOT EXISTS mortalities (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, activity_id TEXT NOT NULL, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  treatment_local_id TEXT, tanggal TEXT NOT NULL, blok_id INTEGER,
  sampel INTEGER, jumlah_hidup REAL, jumlah_mati REAL, kondisi TEXT, foto_local_id TEXT,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT,
  hasil_efektivitas_lokal TEXT, service_required_lokal INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SELESAI'
);
CREATE INDEX IF NOT EXISTS idx_mortalities_sync ON mortalities(sync_status);

CREATE TABLE IF NOT EXISTS photos (
  local_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_local_id TEXT NOT NULL, file_uri TEXT NOT NULL,
  gps_lat REAL, gps_lng REAL, timestamp TEXT NOT NULL, user_id INTEGER, compressed_size INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0, server_photo_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_local_id);
`;

export const SCHEMA_VERSION = 1;
