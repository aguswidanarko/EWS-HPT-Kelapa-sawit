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
-- V3.2: Region -> Bisnis Unit -> PT (estates table, unchanged name/columns below -- only the
-- LocationCascade UI label changed from "Estate" to "PT") -> Afdeling -> Blok. estates.region_id/
-- estates.bisnis_unit_id are added via migrateV32Columns() in database.ts (ALTER TABLE, not here)
-- so upgrading an existing install is safe -- see that function's header comment.
CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY,
  code TEXT, name TEXT
);

CREATE TABLE IF NOT EXISTS bisnis_units (
  id INTEGER PRIMARY KEY,
  region_id INTEGER, code TEXT, name TEXT
);

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

-- ---------------------------------------------------------------- V2 (SPEC_V2.md) master cache
CREATE TABLE IF NOT EXISTS sampling_rules (
  id INTEGER PRIMARY KEY,
  hpt_id INTEGER, method TEXT, row_start INTEGER, row_interval INTEGER,
  plant_start INTEGER, plant_interval INTEGER, minimum_sample REAL, unit_scope TEXT,
  description TEXT, active INTEGER
);

CREATE TABLE IF NOT EXISTS cached_leaf_analysis (
  id INTEGER PRIMARY KEY,
  blok_id INTEGER, tanggal TEXT, unsur_hara TEXT, hasil TEXT, severity TEXT, status TEXT,
  input_by_role TEXT, user_id INTEGER, catatan TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS cached_action_plans (
  id INTEGER PRIMARY KEY,
  local_id TEXT, server_id TEXT, incident_id INTEGER, alert_id INTEGER,
  problem TEXT, recommendation TEXT, actual_action TEXT, pic_user_id INTEGER, due_date TEXT,
  status TEXT, evidence_photo_id INTEGER, verification_note TEXT, verified_by_user_id INTEGER,
  verified_at TEXT, overdue INTEGER, escalated INTEGER, related_leaf_analysis_id INTEGER,
  created_at TEXT, updated_at TEXT
);

-- ---------------------------------------------------------------- V2 field records (offline-authored)
-- Every table below shares the exact SPEC_V2.md-mandated envelope (local_id/server_id/
-- server_row_id/incident_id/user_id/device_id/created_at/updated_at/sync_status/sync_attempt/
-- sync_error/source) so db/repo/syncCommon.ts's generic FieldTable helpers work unmodified -
-- there is deliberately no activity_id column (V2 tables don't have one, see types.ts SyncEnvelopeV2).
CREATE TABLE IF NOT EXISTS yield_partenocarpi (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL, tanggal TEXT NOT NULL, periode TEXT,
  rainfall_mm REAL, indikator_hujan_pagi REAL, total_bunch REAL, abnormal_bunch REAL, abnormal_bunch_pct REAL,
  populasi_ek REAL, kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_yield_partenocarpi_sync ON yield_partenocarpi(sync_status);

CREATE TABLE IF NOT EXISTS water_management (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL, titik_parit TEXT, tanggal TEXT NOT NULL,
  water_level_cm REAL, flooding INTEGER NOT NULL DEFAULT 0, flooding_duration_hari REAL,
  kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_water_management_sync ON water_management(sync_status);

CREATE TABLE IF NOT EXISTS bahan_organik (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL, area_type TEXT, tanggal TEXT NOT NULL,
  total_sample REAL, yellowing_count REAL, yellowing_pct REAL, vegetative_condition TEXT,
  baseline_tbm_normal TEXT, comparison_result TEXT,
  kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_bahan_organik_sync ON bahan_organik(sync_status);

CREATE TABLE IF NOT EXISTS tbm_vegetatif (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL, tanggal TEXT NOT NULL, umur_bulan REAL,
  panjang_pelepah_cm REAL, jumlah_pelepah REAL, lai REAL, target_produksi_ton_ha REAL, hasil_evaluasi TEXT,
  kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_tbm_vegetatif_sync ON tbm_vegetatif(sync_status);

CREATE TABLE IF NOT EXISTS defisiensi_hara_temuan (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  leaf_analysis_id INTEGER, estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL, tanggal TEXT NOT NULL,
  unsur_hara TEXT, temuan_lapangan TEXT, severity TEXT, status TEXT NOT NULL DEFAULT 'OPEN',
  action_plan_id INTEGER, evidence_photo_id INTEGER,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_defisiensi_hara_temuan_sync ON defisiensi_hara_temuan(sync_status);

-- action_plan is NOT authored on mobile (it's created by Admin/Askep/Manager/RND on the dashboard) -
-- this table only queues EDITS (actual_action/status/evidence) against an existing server row, see
-- types.ts LocalActionPlanUpdate. No activity/incident/gps columns because it targets an existing
-- record rather than describing a new field observation.
CREATE TABLE IF NOT EXISTS action_plan_updates (
  local_id TEXT PRIMARY KEY,
  action_plan_id INTEGER NOT NULL,
  status TEXT, actual_action TEXT, foto_local_id TEXT, evidence_photo_id INTEGER,
  user_id INTEGER, device_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE'
);
CREATE INDEX IF NOT EXISTS idx_action_plan_updates_sync ON action_plan_updates(sync_status);

CREATE TABLE IF NOT EXISTS photos (
  local_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_local_id TEXT NOT NULL, file_uri TEXT NOT NULL,
  gps_lat REAL, gps_lng REAL, timestamp TEXT NOT NULL, user_id INTEGER, compressed_size INTEGER,
  uploaded INTEGER NOT NULL DEFAULT 0, server_photo_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_photos_entity ON photos(entity_type, entity_local_id);

-- ================================================================== V3 Dynamic Form Engine
-- Generic capture table for AGR-005..014 (Etiolasi, Pokok doyong, Areal tanpa teras, Overpruning,
-- Susunan pelepah, Ground cover management, Pokok kerdil, Abnormal, Pokok sisipan, Pokok mati) -
-- mirrors backend/src/db/schema.sql's agro_observation table 1:1 (same reason the backend used
-- one generic table instead of 10: no dedicated formula/UI per indicator, only a
-- severity-or-single-measurement shape - see domain/ewsFormSchema.ts).
CREATE TABLE IF NOT EXISTS agro_observations (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, incident_id INTEGER, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL,
  hpt_id INTEGER NOT NULL, ews_id TEXT NOT NULL, tanggal TEXT NOT NULL,
  nilai_ukur REAL, kategori TEXT,
  kategori_lokal TEXT, ews_alert_lokal INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, gps_timestamp TEXT, location_warning INTEGER NOT NULL DEFAULT 0,
  foto_local_id TEXT, petugas TEXT, catatan TEXT
);
CREATE INDEX IF NOT EXISTS idx_agro_observations_sync ON agro_observations(sync_status);
CREATE INDEX IF NOT EXISTS idx_agro_observations_ews ON agro_observations(ews_id);

-- V3.1 Universal Assessment Form (BRD_Mobile_V3_1.docx) - one row per field visit. trees/area/
-- water are stored as JSON blobs (same idiom as sensus.hasil_json) since the whole visit syncs
-- as ONE record in ONE POST /api/assessment call - see types.ts's LocalAssessment and
-- sync/engine.ts's uploadAssessments(). Replaces the per-EWS_ID picker as the PRIMARY entry
-- point for the 29 of 31 EWS indicators the Assessment Mapping Dictionary covers; Observasi EWS
-- (EwsPickerScreen) stays available for the remainder (Yield Making, Pokok Doyong) and as a
-- manual per-indicator fallback.
CREATE TABLE IF NOT EXISTS assessments (
  local_id TEXT PRIMARY KEY,
  server_id TEXT, server_row_id INTEGER, assessment_code TEXT, user_id INTEGER, device_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'DRAFT', sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT, source TEXT NOT NULL DEFAULT 'MOBILE',
  estate_id INTEGER, afdeling_id INTEGER, blok_id INTEGER NOT NULL,
  planting_stage TEXT, baris TEXT, sampling_method TEXT, sample_count INTEGER NOT NULL DEFAULT 0,
  tanggal TEXT NOT NULL, waktu_mulai TEXT, waktu_selesai TEXT,
  gps_lat REAL, gps_lng REAL, gps_accuracy REAL, location_warning INTEGER NOT NULL DEFAULT 0,
  catatan TEXT, petugas TEXT,
  trees_json TEXT NOT NULL, area_json TEXT, water_json TEXT, calc_summary_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_assessments_sync ON assessments(sync_status);

-- Read-only local cache of GET /api/master-ews-dictionary (BRD_V3_Mobile_Offline.docx section 3
-- "Dynamic Form ... dibentuk dari EWS Dictionary"): the 32-row registry the Dynamic Form Engine's
-- EwsPickerScreen/EwsFormScreen read for display text (threshold, rekomendasi, interval) offline.
-- Replaced wholesale on every sync (server is source of truth), same pattern as hpt/thresholds.
CREATE TABLE IF NOT EXISTS ews_dictionary_cache (
  ews_id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  hpt_id INTEGER NOT NULL,
  hpt_code TEXT,
  hpt_name TEXT,
  planting_stage TEXT,
  threshold_display_text TEXT,
  inspection_interval TEXT,
  recommendation TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);
`;

export const SCHEMA_VERSION = 1;
