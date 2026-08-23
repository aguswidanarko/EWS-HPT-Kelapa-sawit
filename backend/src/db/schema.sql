-- EWS HPT backend schema (SQLite via better-sqlite3)
-- Loaded idempotently on startup (CREATE TABLE IF NOT EXISTS everywhere).
-- See SPEC.md section 3 for the canonical data model this file implements.

PRAGMA foreign_keys = ON;

-- ===================== IDENTITY / RBAC =====================

CREATE TABLE IF NOT EXISTS role (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, -- ADMIN, RND_FOD, MANAGER, ASKEP_ASISTEN, PETUGAS_DETEKSI, PETUGAS_SENSUS, PETUGAS_PENGENDALIAN
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES role(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  area_kerja TEXT, -- free text describing assigned working area (blok list etc.)
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== LOCATION MASTER =====================

CREATE TABLE IF NOT EXISTS estate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  map_file_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS afdeling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estate(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  map_file_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(estate_id, code)
);

CREATE TABLE IF NOT EXISTS blok (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  afdeling_id INTEGER NOT NULL REFERENCES afdeling(id),
  code TEXT NOT NULL,
  name TEXT,
  luas REAL, -- hectares
  tahun_tanam INTEGER,
  status_tanaman TEXT, -- TBM1, TBM2, TBM3, TM (fase tanaman used by threshold engine)
  referensi_polygon TEXT, -- optional GeoJSON geometry (string) for this blok
  jumlah_baris INTEGER,
  parameter_sampling_json TEXT, -- JSON: {"baris_sampel": {"start":3,"step":10}, "grid": {"baris_start":3,"baris_step":20,"posisi_start":3,"posisi_step":10}, "posisi_per_baris": 40}
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(afdeling_id, code)
);

CREATE TABLE IF NOT EXISTS baris (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  nomor INTEGER NOT NULL,
  UNIQUE(blok_id, nomor)
);

-- ===================== HPT / SPECIES / THRESHOLD / KB =====================

CREATE TABLE IF NOT EXISTS hpt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL, -- e.g. UPDKS, TIKUS, ORYCTES, RAYAP, GANODERMA
  name TEXT NOT NULL,
  nama_lokal TEXT,
  kategori TEXT, -- HAMA / PENYAKIT
  status_aktif INTEGER NOT NULL DEFAULT 1,
  deskripsi TEXT,
  gejala TEXT,
  metode_deteksi TEXT,
  metode_sensus TEXT, -- BARIS_SAMPEL | GRID | SELURUH_POKOK | KUALITATIF
  satuan TEXT,
  threshold_default TEXT, -- human readable fallback text only, engine always reads THRESHOLD table
  panduan_md TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS species (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  group_name TEXT, -- e.g. ULAT_API, ULAT_KANTONG (used to share thresholds across a species group)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(hpt_id, code)
);

CREATE TABLE IF NOT EXISTS threshold (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  species_id INTEGER REFERENCES species(id), -- NULL = applies to all species of this HPT
  fase_tanaman TEXT NOT NULL, -- TBM1, TBM2, TBM3, TM, SEMUA
  kategori TEXT NOT NULL, -- NORMAL, RINGAN, SEDANG, BERAT, CRITICAL
  nilai_min REAL, -- NULL = -infinity
  nilai_max REAL, -- NULL = +infinity
  satuan TEXT,
  tindakan TEXT,
  severity TEXT, -- mirrors kategori, kept separate per spec field list
  effective_date TEXT NOT NULL, -- ISO date; latest effective_date <= today wins
  status TEXT NOT NULL DEFAULT 'AKTIF', -- AKTIF / NONAKTIF
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_threshold_lookup ON threshold(hpt_id, fase_tanaman, status, effective_date);

CREATE TABLE IF NOT EXISTS knowledge_base (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER REFERENCES hpt(id),
  kategori TEXT, -- SOP/Deteksi/Sensus/Pengendalian/Mortalitas/Threshold/Gejala/Foto/Materi pelatihan
  judul TEXT NOT NULL,
  versi TEXT,
  tanggal_berlaku TEXT,
  status_aktif INTEGER NOT NULL DEFAULT 1,
  file_path TEXT,
  file_type TEXT,
  uploaded_by INTEGER REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES user(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  jenis_kegiatan TEXT, -- DETEKSI/SENSUS/PENGENDALIAN/MORTALITAS
  hpt_id INTEGER REFERENCES hpt(id),
  tanggal_rencana TEXT,
  status TEXT NOT NULL DEFAULT 'RENCANA', -- RENCANA/BERJALAN/SELESAI/DIBATALKAN (operational status, no approval gate)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== FIELD DATA (mobile-collected, sync-aware) =====================
-- Every field-collected table carries the sync envelope required by BRD 01 section 8:
-- local_id, server_id, activity_id, incident_id, user_id, device_id, created_at, updated_at,
-- sync_status (DRAFT|READY_TO_SYNC|SYNCING|SYNCED|FAILED), sync_attempt, sync_error, source
-- (MOBILE|EXCEL|WEB|API).

CREATE TABLE IF NOT EXISTS detection (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  activity_id TEXT,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  baris INTEGER,
  posisi INTEGER,
  tanggal TEXT,
  waktu TEXT,
  hpt_id INTEGER REFERENCES hpt(id),
  species_id INTEGER REFERENCES species(id),
  gejala TEXT,
  kondisi_indikator TEXT,
  jumlah_indikasi REAL,
  catatan TEXT,
  foto_id INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  gps_timestamp TEXT,
  location_warning INTEGER NOT NULL DEFAULT 0,
  kategori TEXT, -- classification result from threshold engine
  ews_alert INTEGER NOT NULL DEFAULT 0,
  is_duplicate_suspect INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_detection_blok ON detection(blok_id);
CREATE INDEX IF NOT EXISTS idx_detection_incident ON detection(incident_id);
CREATE INDEX IF NOT EXISTS idx_detection_tanggal ON detection(tanggal);

CREATE TABLE IF NOT EXISTS sensus (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  activity_id TEXT,
  incident_id INTEGER REFERENCES incident(id),
  jenis_sensus TEXT, -- HPT code, drives which engine/formula is used
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  species_id INTEGER REFERENCES species(id),
  jalur_baris TEXT, -- JSON array of sampled baris/grid points actually walked
  hasil_json TEXT, -- raw per-sample-point input JSON
  hasil_hitung REAL, -- computed numeric result (ekor/pelepah, %, count, ...)
  kategori TEXT,
  saran_pengendalian TEXT,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  foto_id INTEGER,
  catatan TEXT,
  tanggal TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  is_duplicate_suspect INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sensus_blok ON sensus(blok_id);
CREATE INDEX IF NOT EXISTS idx_sensus_incident ON sensus(incident_id);
CREATE INDEX IF NOT EXISTS idx_sensus_tanggal ON sensus(tanggal);

CREATE TABLE IF NOT EXISTS treatment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  activity_id TEXT,
  incident_id INTEGER REFERENCES incident(id),
  hpt_id INTEGER REFERENCES hpt(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  luas_serangan REAL,
  metode_pengendalian TEXT, -- drone spraying/fogging/manual/racun tikus/lainnya (master-driven, free text v1)
  tanggal_mulai TEXT,
  tanggal_selesai TEXT,
  jumlah_pokok INTEGER,
  hk REAL, -- hari kerja
  material TEXT,
  jumlah_material REAL,
  alat TEXT,
  pic TEXT,
  catatan TEXT,
  foto_id INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  status TEXT NOT NULL DEFAULT 'BERJALAN', -- BERJALAN/SELESAI (operational, no approval)
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_treatment_incident ON treatment(incident_id);

CREATE TABLE IF NOT EXISTS mortality (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  activity_id TEXT,
  incident_id INTEGER REFERENCES incident(id),
  treatment_id INTEGER REFERENCES treatment(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  tanggal TEXT,
  blok TEXT,
  blok_id INTEGER REFERENCES blok(id),
  sampel INTEGER,
  jumlah_hidup INTEGER,
  jumlah_mati INTEGER,
  kondisi TEXT,
  foto_id INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  hasil_efektivitas TEXT, -- EFEKTIF / TIDAK_EFEKTIF (derived vs effectiveness threshold)
  service_required INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'SELESAI',
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mortality_incident ON mortality(incident_id);

-- ===================== EWS CORE: INCIDENT / ALERT / NOTIFICATION =====================

CREATE TABLE IF NOT EXISTS incident (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_code TEXT UNIQUE NOT NULL, -- EWS-YYYYMMDD-XXXX
  hpt_id INTEGER REFERENCES hpt(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  detection_id INTEGER REFERENCES detection(id),
  sensus_id INTEGER REFERENCES sensus(id),
  treatment_id INTEGER REFERENCES treatment(id),
  mortality_id INTEGER REFERENCES mortality(id),
  status TEXT NOT NULL DEFAULT 'NEW', -- NEW->ACKNOWLEDGED->IN_PROGRESS->CONTROLLED->MONITORING->CLOSED
  severity TEXT NOT NULL, -- NORMAL/RINGAN/SEDANG/BERAT/CRITICAL
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_incident_blok ON incident(blok_id);
CREATE INDEX IF NOT EXISTS idx_incident_status ON incident(status);

CREATE TABLE IF NOT EXISTS alert (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_id INTEGER NOT NULL REFERENCES incident(id),
  hpt_id INTEGER REFERENCES hpt(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  hasil REAL, -- the numeric/qualitative result that triggered the alert
  threshold_ref TEXT, -- human readable snapshot of the threshold row used, e.g. ">5 ekor/pelepah"
  kategori TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW', -- NEW->ACKNOWLEDGED->IN_PROGRESS->CONTROLLED->MONITORING->CLOSED
  source_type TEXT, -- DETECTION / SENSUS / MORTALITY
  source_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alert_status ON alert(status);
CREATE INDEX IF NOT EXISTS idx_alert_incident ON alert(incident_id);

CREATE TABLE IF NOT EXISTS notification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER NOT NULL REFERENCES alert(id),
  channel TEXT NOT NULL, -- DASHBOARD/EMAIL/WHATSAPP
  recipient TEXT,
  sent_at TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING/SENT/DELIVERED/FAILED
  response_provider TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notification_alert ON notification(alert_id);

CREATE TABLE IF NOT EXISTS notification_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL, -- THRESHOLD_EXCEEDED / KATEGORI_SEDANG / KATEGORI_BERAT / KATEGORI_CRITICAL / MORTALITAS_TIDAK_EFEKTIF / SERVICE_REQUIRED
  recipient_role TEXT, -- role code, or NULL if recipient_user_id set
  recipient_user_id INTEGER REFERENCES user(id),
  recipient_pic INTEGER NOT NULL DEFAULT 0, -- 1 = also notify PIC of the affected blok
  channel TEXT NOT NULL DEFAULT 'DASHBOARD', -- DASHBOARD/EMAIL/WHATSAPP
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ===================== PIC / PHOTO / GPS =====================

CREATE TABLE IF NOT EXISTS pic (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES user(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER REFERENCES blok(id),
  jenis_aktivitas TEXT, -- DETEKSI/SENSUS/PENGENDALIAN/MORTALITAS/ALL
  hpt_id INTEGER REFERENCES hpt(id),
  notification_channel TEXT, -- DASHBOARD/EMAIL/WHATSAPP/ALL
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- DETECTION/SENSUS/TREATMENT/MORTALITY
  entity_id INTEGER,
  file_path TEXT NOT NULL,
  gps_lat REAL,
  gps_lng REAL,
  timestamp TEXT,
  user_id INTEGER REFERENCES user(id),
  compressed_size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  lat REAL,
  lng REAL,
  accuracy REAL,
  timestamp TEXT
);

-- ===================== AUDIT / SYNC =====================

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES user(id),
  aktivitas TEXT NOT NULL, -- e.g. CREATE_DETECTION, UPDATE_THRESHOLD, ALERT_STATUS_CHANGE, SYNC_CONFLICT
  waktu TEXT NOT NULL DEFAULT (datetime('now')),
  data_sebelum_json TEXT,
  data_sesudah_json TEXT,
  device_source TEXT, -- MOBILE/EXCEL/WEB/API
  ip_session TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_waktu ON audit_log(waktu);

CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  jumlah_data INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RUNNING' -- RUNNING/COMPLETED/FAILED
);
CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, device_id);

-- ===================== GIS LAYERS =====================

CREATE TABLE IF NOT EXISTS geojson_layer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- ESTATE / AFDELING
  entity_id INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  source_file_path TEXT NOT NULL, -- original uploaded GeoJSON, untouched
  layer_file_path TEXT, -- validated/published file actually served to the map app
  status TEXT NOT NULL DEFAULT 'UPLOADED', -- UPLOADED/VALIDATED/PUBLISHED/ARCHIVED
  feature_count INTEGER,
  validation_errors TEXT,
  uploaded_by INTEGER REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_geojson_entity ON geojson_layer(entity_type, entity_id);

-- ===================== IMPORT (EXCEL) LOG =====================

CREATE TABLE IF NOT EXISTS import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES user(id),
  entity_type TEXT NOT NULL, -- DETECTION/SENSUS/TREATMENT/MORTALITY (flat Excel import), or PISP1 (pivot monthly recap import, see services/importPisp1.js -- spans multiple entities/sheets in one row here)
  filename TEXT,
  total_rows INTEGER,
  valid_rows INTEGER,
  error_rows INTEGER,
  errors_json TEXT,
  status TEXT NOT NULL DEFAULT 'PREVIEWED', -- PREVIEWED/COMMITTED/CANCELLED
  committed_count INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================================
-- ===================== V2 EXTENSIONS (SPEC_V2.md section 2) =========================
-- =====================================================================================
-- Everything below is ADDITIVE. No V1 table above this line is dropped, renamed, or has
-- its meaning changed. Two V1 tables (hpt, knowledge_base) grow new columns via the
-- idempotent ALTER TABLE migration runner in db.js (SQLite has no ADD COLUMN IF NOT
-- EXISTS), not here, since CREATE TABLE IF NOT EXISTS cannot add columns to an existing
-- table.

-- Category umbrella for the generalized "hpt" (now: EWS indicator) table: HPT / YIELD_MAKING /
-- AGRONOMY / DEFISIENSI_HARA.
CREATE TABLE IF NOT EXISTS ews_category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

-- Rule versioning ledger. Every computed rule result (formula + threshold combo actually used)
-- gets snapshotted here so that changing a threshold/formula later never rewrites the meaning of
-- past history (SPEC_V2.md section 1 item 3).
CREATE TABLE IF NOT EXISTS rule_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- FORMULA | THRESHOLD | SAMPLING_RULE | SCHEDULING_RULE
  entity_id INTEGER NOT NULL,
  version_no INTEGER NOT NULL DEFAULT 1,
  effective_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AKTIF', -- AKTIF / NONAKTIF
  changed_by_user_id INTEGER REFERENCES user(id),
  change_note TEXT,
  snapshot_json TEXT, -- full snapshot of the row(s) that produced a computed result, for traceability
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rule_version_entity ON rule_version(entity_type, entity_id);

-- Generic formula definitions, replacing the V1 hard-coded per-HPT arithmetic with data. See
-- services/ruleEngine.js for the evaluator and SPEC_V2.md section 3 for the contract.
CREATE TABLE IF NOT EXISTS formula (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  formula_type TEXT NOT NULL, -- COUNT_TOTAL|PERCENTAGE|THRESHOLD|DURATION|DATE_INTERVAL|RAINFALL_ACCUMULATION|MINIMUM_SAMPLE|CATEGORICAL_CONDITION|AND_OR
  context TEXT NOT NULL DEFAULT 'SENSUS', -- which workflow this formula applies to, e.g. DETEKSI vs SENSUS (SPEC_V2.md section 5 ambiguity note: a hpt_id can have >1 formula row distinguished by context)
  expression_json TEXT NOT NULL,
  unit TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_formula_hpt ON formula(hpt_id, active);

-- Generic sampling rule, complementing blok.parameter_sampling_json with a per-indicator master
-- (SPEC_V2.md section 2).
CREATE TABLE IF NOT EXISTS sampling_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  method TEXT, -- BARIS_SAMPEL | GRID | SELURUH_POKOK | GAWANGAN | KUALITATIF (mirrors unit_scope)
  row_start INTEGER,
  row_interval INTEGER,
  plant_start INTEGER,
  plant_interval INTEGER,
  minimum_sample REAL,
  unit_scope TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sampling_rule_hpt ON sampling_rule(hpt_id, active);

-- Generic scheduling rule (BRD V2 Backend section 7): drives services/schedulingEngine.js.
CREATE TABLE IF NOT EXISTS scheduling_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  jenis_kegiatan TEXT NOT NULL DEFAULT 'SENSUS', -- DETEKSI | SENSUS -- lets one hpt_id carry both a
    -- biweekly "deteksi awal" cadence and a separate sensus/mitigasi cadence (SPEC_V2.md section 5:
    -- "Deteksi HPT ... 2 minggu" vs e.g. "UPDKS (mitigasi/sensus) ... 1 bulan")
  interval_type TEXT NOT NULL, -- DAILY | BIWEEKLY | MONTHLY | CUSTOM
  interval_value INTEGER NOT NULL DEFAULT 1, -- multiplier; with CUSTOM, count of interval_unit
  interval_unit TEXT NOT NULL DEFAULT 'DAY', -- DAY|WEEK|MONTH, used when interval_type='CUSTOM'
  based_on TEXT NOT NULL DEFAULT 'LAST_INSPECTION', -- LAST_INSPECTION | FIXED_DATE
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scheduling_rule_hpt ON scheduling_rule(hpt_id, active);

-- Action Plan: formal follow-up module (SPEC_V2.md section 2/section 4 Dashboard section 4.7).
-- Status flow OPEN->PLANNED->IN_PROGRESS->COMPLETED->VERIFIED->CLOSED -- distinct from the Alert
-- 7-state flow (mobile module note, SPEC_V2.md section 4 Mobile). Carries the same sync envelope
-- as detection/sensus so it flows through the one Sync Center on mobile.
CREATE TABLE IF NOT EXISTS action_plan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  alert_id INTEGER REFERENCES alert(id),
  problem TEXT,
  recommendation TEXT,
  actual_action TEXT,
  pic_user_id INTEGER REFERENCES user(id),
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN|PLANNED|IN_PROGRESS|COMPLETED|VERIFIED|CLOSED
  evidence_photo_id INTEGER,
  verification_note TEXT,
  verified_by_user_id INTEGER REFERENCES user(id),
  verified_at TEXT,
  overdue INTEGER NOT NULL DEFAULT 0, -- recomputed from due_date vs status, see services/actionPlanEngine helpers in routes/actionPlans.js
  escalated INTEGER NOT NULL DEFAULT 0,
  related_leaf_analysis_id INTEGER REFERENCES leaf_analysis(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_action_plan_incident ON action_plan(incident_id);
CREATE INDEX IF NOT EXISTS idx_action_plan_status ON action_plan(status);
CREATE INDEX IF NOT EXISTS idx_action_plan_due ON action_plan(due_date);

-- ===================== YIELD MAKING modules =====================
-- Same sync envelope as detection/sensus V1: local_id, server_id, device_id, user_id,
-- sync_status, sync_attempt, sync_error, source (SPEC_V2.md section 2 closing note).

CREATE TABLE IF NOT EXISTS yield_partenocarpi (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  tanggal TEXT NOT NULL,
  periode TEXT, -- e.g. 'YYYY-MM'
  rainfall_mm REAL,
  indikator_hujan_pagi REAL, -- mm curah hujan periode pagi-siang
  total_bunch INTEGER,
  abnormal_bunch INTEGER,
  abnormal_bunch_pct REAL,
  populasi_ek REAL, -- Elaeidobius kamerunicus, ekor/ha
  kategori TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  foto_id INTEGER,
  catatan TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_yield_partenocarpi_blok ON yield_partenocarpi(blok_id);
CREATE INDEX IF NOT EXISTS idx_yield_partenocarpi_tanggal ON yield_partenocarpi(tanggal);

CREATE TABLE IF NOT EXISTS water_management (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  titik_parit TEXT,
  tanggal TEXT NOT NULL,
  water_level_cm REAL, -- kedalaman muka air di bawah permukaan tanah
  flooding INTEGER NOT NULL DEFAULT 0,
  flooding_duration_hari REAL,
  kategori TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  foto_id INTEGER,
  catatan TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_water_management_blok ON water_management(blok_id);
CREATE INDEX IF NOT EXISTS idx_water_management_tanggal ON water_management(tanggal);

CREATE TABLE IF NOT EXISTS bahan_organik (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  area_type TEXT, -- e.g. AREA_PASIR
  tanggal TEXT NOT NULL,
  total_sample INTEGER,
  yellowing_count INTEGER,
  yellowing_pct REAL,
  vegetative_condition TEXT, -- qualitative note for TBM comparison
  baseline_tbm_normal TEXT, -- reference baseline used for comparison (free text / JSON snapshot)
  comparison_result TEXT, -- SESUAI_BASELINE / DI_BAWAH_BASELINE / ...
  kategori TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  foto_id INTEGER,
  catatan TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bahan_organik_blok ON bahan_organik(blok_id);
CREATE INDEX IF NOT EXISTS idx_bahan_organik_tanggal ON bahan_organik(tanggal);

CREATE TABLE IF NOT EXISTS tbm_vegetatif (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  tanggal TEXT NOT NULL,
  umur_bulan INTEGER,
  panjang_pelepah_cm REAL,
  jumlah_pelepah INTEGER,
  lai REAL, -- Leaf Area Index
  target_produksi_ton_ha REAL, -- reference goal (TBM2=10, TBM3=20, TM1=30, TM3=40), not an alert threshold
  hasil_evaluasi TEXT, -- SESUAI_STANDAR / DI_BAWAH_STANDAR + rekomendasi perbaikan (free text)
  kategori TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  foto_id INTEGER,
  catatan TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tbm_vegetatif_blok ON tbm_vegetatif(blok_id);
CREATE INDEX IF NOT EXISTS idx_tbm_vegetatif_tanggal ON tbm_vegetatif(tanggal);

-- ===================== DEFISIENSI HARA =====================

CREATE TABLE IF NOT EXISTS leaf_analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  blok_id INTEGER REFERENCES blok(id),
  tanggal TEXT NOT NULL,
  unsur_hara TEXT NOT NULL, -- N/P/K/Mg/dst, free text, master-driven from knowledge_base/notes
  hasil REAL,
  severity TEXT, -- RINGAN/SEDANG/BERAT (qualitative call from leaf analysis)
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN/FOLLOWED_UP/CLOSED (operational, no approval gate)
  input_by_role TEXT NOT NULL DEFAULT 'RISET', -- always RISET by business rule
  user_id INTEGER REFERENCES user(id),
  catatan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_leaf_analysis_blok ON leaf_analysis(blok_id);

CREATE TABLE IF NOT EXISTS defisiensi_hara_temuan (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  leaf_analysis_id INTEGER REFERENCES leaf_analysis(id),
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  tanggal TEXT NOT NULL,
  unsur_hara TEXT,
  temuan_lapangan TEXT,
  severity TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN', -- OPEN/IN_PROGRESS/CLOSED
  action_plan_id INTEGER REFERENCES action_plan(id),
  evidence_photo_id INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_defisiensi_hara_temuan_blok ON defisiensi_hara_temuan(blok_id);

-- ===================== SCORING / KPI (SKELETON) =====================
-- Structure only -- the real 5 R&D + 5 Tim Operasional criteria are NOT available in any source
-- document (SPEC_V2.md section 1 closing note). Seeded rows are explicitly labeled placeholder/TBD
-- (see db/seed.js) so nobody mistakes them for the final rubric.

CREATE TABLE IF NOT EXISTS scoring_criteria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  side TEXT NOT NULL, -- RND | TIM_OPERASIONAL | BONUS
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  max_poin REAL NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scoring_entry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hpt_id INTEGER REFERENCES hpt(id),
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  period_month TEXT NOT NULL, -- 'YYYY-MM'
  criteria_id INTEGER NOT NULL REFERENCES scoring_criteria(id),
  poin_diberikan REAL NOT NULL,
  catatan TEXT,
  created_by_user_id INTEGER REFERENCES user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scoring_entry_period ON scoring_entry(period_month, estate_id);
