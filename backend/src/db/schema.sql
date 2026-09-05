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
  context TEXT, -- V3.1: mirrors formula.context; NULL = applies regardless of context (legacy
                -- default, preserves every pre-V3.1 threshold row's behavior unchanged). Only
                -- needed when one hpt_id carries >1 formula measuring different quantities in
                -- the same value range (e.g. WATER_MANAGEMENT's water_level_cm vs
                -- flooding_duration_hari) -- see migrateV31Columns()'s backfill in db.js and
                -- thresholdEngine.js's getActiveThresholds() for why this was added.
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

-- =====================================================================================
-- ===================== V3 EXTENSIONS (BRD_V3_*.docx + Master_EWS_Dictionary_V3.xlsx) =
-- =====================================================================================
-- Everything below is ADDITIVE, same discipline as the V2 section above: no existing table
-- is dropped, renamed, or repurposed. BRD V3's "EWS Dictionary" (a literal EWS_ID such as
-- HPT-001/AGR-004/YM-001/WM-002, one per indicator x planting-stage combination) is a thin
-- registry layered on top of the already-generic `hpt` table (indicator) + `threshold`
-- table (per fase_tanaman classification) + `formula` table (per hpt_id calculation) +
-- `rule_version` table (versioning ledger) -- it does not replace them. Import/export
-- transaction batches reuse the existing `import_log` table via new entity_type values
-- (`EWS:<EWS_ID>` and `EWS_MASTER_DICTIONARY`) rather than a new log table, matching the
-- codebase's existing single-import-log convention.

-- Registry: maps each BRD V3 EWS_ID to the underlying generic indicator (hpt_id) and,
-- where relevant, a specific planting stage. One hpt_id can be addressed by more than one
-- EWS_ID (e.g. Tikus has HPT-001/002/003 for TM/TBM/TB-0 respectively, all pointing at the
-- same hpt_id='TIKUS' row, disambiguated here by planting_stage + selected via `threshold`
-- .fase_tanaman at classification time).
CREATE TABLE IF NOT EXISTS ews_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ews_id TEXT UNIQUE NOT NULL, -- e.g. HPT-001, AGR-004, YM-001, WM-002
  scope TEXT NOT NULL, -- HPT | Yield Making | Agro | WM (mirrors Master_EWS_Dictionary_V3.xlsx 'Scope')
  hpt_id INTEGER NOT NULL REFERENCES hpt(id),
  planting_stage TEXT, -- TM | TBM | TB-0 | TBM/TM | NULL = not stage-specific
  threshold_display_text TEXT, -- human-readable text from the dictionary; engine still reads threshold/formula
  inspection_interval TEXT,
  recommendation TEXT,
  current_rule_version_id INTEGER REFERENCES rule_version(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | NONAKTIF -- an EWS_ID is never deleted, only deactivated
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ews_dictionary_hpt ON ews_dictionary(hpt_id);
CREATE INDEX IF NOT EXISTS idx_ews_dictionary_scope ON ews_dictionary(scope, status);

-- Generic severity-based field capture for the Agro indicators that have no existing
-- dedicated table (Pokok doyong, Areal tanpa teras, Overpruning, Susunan pelepah, Ground
-- cover management, Pokok kerdil, Abnormal, Pokok sisipan, Pokok mati -- AGR-006..014, plus
-- AGR-005 Etiolasi). Same sync envelope + gps/photo shape as the other V2 field-data
-- tables so it behaves identically through Import Center / (future) mobile Sync Center.
CREATE TABLE IF NOT EXISTS agro_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  incident_id INTEGER REFERENCES incident(id),
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  hpt_id INTEGER NOT NULL REFERENCES hpt(id), -- which indicator (Pokok doyong, Overpruning, ...)
  ews_id TEXT NOT NULL, -- denormalized EWS_ID for direct filtering, matches ews_dictionary.ews_id
  tanggal TEXT NOT NULL,
  nilai_ukur REAL, -- optional numeric measurement when the indicator has one (e.g. derajat kemiringan, jumlah songgo)
  kategori TEXT, -- computed severity: RINGAN/SEDANG/BERAT, or a qualitative status text
  ews_alert INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  foto_id INTEGER,
  petugas TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agro_observation_blok ON agro_observation(blok_id);
CREATE INDEX IF NOT EXISTS idx_agro_observation_ews ON agro_observation(ews_id);
CREATE INDEX IF NOT EXISTS idx_agro_observation_tanggal ON agro_observation(tanggal);

-- =====================================================================================
-- ================= V3 ADDENDUM: EWS AI ASSISTANT (BRD Addendum PalmMind) =============
-- =====================================================================================
-- Audit ledger for every AI Assistant interaction (BRD Addendum section 25 "Audit AI" +
-- AI Governance Rule 5 "Semua AI interaction dapat diaudit"). Answers are produced by a
-- deterministic rule-based engine (services/aiAssistant.js) reading real EWS data --
-- there is no external LLM/RAG credential available in this deployment (no OpenAI key,
-- no Supabase/pgvector), so `engine` records which answer engine produced the row and
-- `context_json`/`citations_json` snapshot exactly what real data the answer was grounded
-- in, so nothing here is ever an invented/hallucinated number (Governance Rule 1 & 2).
-- `engine` is free text so a future real LLM integration (e.g. 'LLM:claude-...') can be
-- added later without a schema change, matching this codebase's additive-migration idiom.
CREATE TABLE IF NOT EXISTS ai_interaction (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES user(id),
  question TEXT NOT NULL,
  blok_id INTEGER REFERENCES blok(id), -- optional grounding context selected by the user
  ews_id TEXT, -- optional grounding context, matches ews_dictionary.ews_id
  incident_id INTEGER REFERENCES incident(id), -- optional grounding context
  intent TEXT, -- EXPLAIN_WARNING / SOP_LOOKUP / HISTORY / ACTION_PLAN_STATUS / GENERAL_KNOWLEDGE / UNKNOWN
  context_json TEXT, -- full EWS Context snapshot used to compose the answer (traceability)
  citations_json TEXT, -- list of {type, ref, label} sources the answer cited
  answer TEXT NOT NULL,
  rule_version_id INTEGER REFERENCES rule_version(id), -- set when the answer cited a specific formula/dictionary version
  engine TEXT NOT NULL DEFAULT 'RULE_BASED_V1',
  feedback TEXT, -- HELPFUL / NOT_HELPFUL / NULL (Governance -- Human Feedback)
  feedback_reason TEXT, -- Wrong/Incomplete/Not Relevant/Incorrect SOP/Incorrect Recommendation/Other
  feedback_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_user ON ai_interaction(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_blok ON ai_interaction(blok_id);
CREATE INDEX IF NOT EXISTS idx_ai_interaction_created ON ai_interaction(created_at);

-- =====================================================================================
-- ========== V3 ADDENDUM 2: MASTER WILAYAH (Region / PT / Rayon / Pemilik) ============
-- =====================================================================================
-- Source: "Data Per PT Afdeling & Rayon FR.xlsx" (Region, PT, BusinessUnit, Pemilik, Rayon,
-- AfdelingCode, AfdelingName). Adds a wilayah hierarchy ABOVE the existing estate/afdeling
-- tables: Region (Riau/Kalbar/Kaltim/...) groups Estate (PT/kebun, unchanged table -- PT code
-- maps to estate.code, BusinessUnit maps to estate.name); Rayon groups Afdeling within one
-- Estate (e.g. "Rayon A/B/C"). Both link back via ALTER TABLE-added nullable FK columns
-- (estate.region_id, afdeling.rayon_id/afdeling.pemilik -- see migrateV3AddendumColumns in
-- db.js, not here, since CREATE TABLE IF NOT EXISTS cannot add columns to an existing table),
-- so any estate/afdeling row created before this addendum keeps working unchanged.
CREATE TABLE IF NOT EXISTS region (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rayon (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estate_id INTEGER NOT NULL REFERENCES estate(id),
  code TEXT NOT NULL, -- e.g. "Rayon A" -- unique per estate, reused as a label across different estates
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(estate_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rayon_estate ON rayon(estate_id);

-- =====================================================================================
-- ==================== V3.2: MASTER BLOK TERPUSAT (Single Source of Truth) ============
-- =====================================================================================
-- Source: user-supplied "Master_Data_PT_Afd_Blok_EWS_Ok.xlsx" (sheets MASTER_PT / MASTER_AFD /
-- MASTER_BLOK). Adds ONE new hierarchy level, Bisnis Unit, that sits BETWEEN region and estate
-- (PT): a Bisnis Unit groups several PT that share the same name prefix in MASTER_PT's "Nama PT"
-- column (e.g. "KTBM - Kebun Sei Besar", "KTBM - Kebun Sei Jernih", ... all belong to Bisnis Unit
-- "KTBM"). This is a DIFFERENT concept from the V3 Addendum 2 "BusinessUnit" column in
-- masterWilayahImport.js, which was only ever a friendly display name stored on estate.name for a
-- single PT, not a level grouping multiple PTs -- that older usage is left untouched.
-- estate.bisnis_unit_id (nullable FK, added via migrateV32Columns in db.js since CREATE TABLE IF
-- NOT EXISTS cannot ALTER an existing table) links PT -> Bisnis Unit; estate.region_id (V3
-- Addendum 2) keeps working unchanged and is kept in sync with bisnis_unit.region_id by the
-- Master Blok upload endpoint so both direct (estate->region) and hierarchical
-- (estate->bisnis_unit->region) lookups agree.
CREATE TABLE IF NOT EXISTS bisnis_unit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES region(id),
  code TEXT NOT NULL, -- e.g. "KTBM", "CLP" -- the Nama PT prefix, unique per region
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, code)
);
CREATE INDEX IF NOT EXISTS idx_bisnis_unit_region ON bisnis_unit(region_id);

-- =====================================================================================
-- ============ V3 ADDENDUM 2: KOMENTAR PADA SEMUA MODUL DETAIL EWS ====================
-- =====================================================================================
-- Source: "Tambahan Fitur Komentar pada semua modul Detail EWS.pdf". Generic entity_type +
-- entity_id so the same table/API/UI component serves Alert Detail, Incident Detail, Action
-- Plan Detail, and the Blok detail panel on Peta EWS, matching the note's "semua modul Detail
-- EWS" (all EWS Detail modules) instruction without a separate table per module.
CREATE TABLE IF NOT EXISTS comment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL, -- ALERT / INCIDENT / ACTION_PLAN / BLOK
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES user(id),
  comment_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comment_entity ON comment(entity_type, entity_id);

-- =====================================================================================
-- ================= V4: KNOWLEDGE BASE RAG (SOP full-text retrieval) ==================
-- =====================================================================================
-- Extends the existing `knowledge_base` table (file library: PDF/DOC/DOCX/XLS/XLSX/TXT/
-- PPT/PPTX upload, versioning, publish workflow -- see routes/knowledgeBase.js) with actual
-- document *content*, so the EWS AI Assistant can ground answers in real SOP text instead of
-- matching on `judul` (title) alone. services/kbIndexer.js parses each uploaded file into
-- `kb_chunk` rows on upload; `kb_chunk_fts` is an FTS5 full-text index kept in sync via triggers
-- (standard SQLite "external content" pattern) so services/kbIndexer.js never has to maintain it
-- by hand. Governance: this is retrieval only -- chunk text is stored/returned verbatim, never
-- summarized or altered, so the same "never invent technical data" rule aiAssistant.js documents
-- still holds when SOP content is added to an answer's context.
CREATE TABLE IF NOT EXISTS kb_chunk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  knowledge_base_id INTEGER NOT NULL REFERENCES knowledge_base(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  page_number INTEGER,   -- PDF
  slide_number INTEGER,  -- PPT/PPTX
  sheet_name TEXT,       -- XLS/XLSX
  heading TEXT,          -- nearest heading/section title above this chunk (DOCX/PDF/PPTX)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_document ON kb_chunk(knowledge_base_id);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunk_fts USING fts5(
  content,
  content='kb_chunk',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS kb_chunk_ai AFTER INSERT ON kb_chunk BEGIN
  INSERT INTO kb_chunk_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunk_ad AFTER DELETE ON kb_chunk BEGIN
  INSERT INTO kb_chunk_fts(kb_chunk_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS kb_chunk_au AFTER UPDATE ON kb_chunk BEGIN
  INSERT INTO kb_chunk_fts(kb_chunk_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO kb_chunk_fts(rowid, content) VALUES (new.id, new.content);
END;

-- =====================================================================================
-- ============ V3.1: UNIVERSAL ASSESSMENT FORM + ASSESSMENT MAPPING ENGINE ============
-- =====================================================================================
-- BRD_Mobile_V3_1.docx + BRD_Backend_Addendum_V3_1.docx: one field visit (Universal
-- Assessment) captures raw per-pokok observations; the Assessment Mapping Engine (see
-- services/assessmentEngine.js) turns those raw observations into potentially many EWS
-- results by re-using the existing hpt/formula/threshold/rule_version/incident/alert
-- machinery (ruleEngine.js's computeIndicatorResult) instead of a parallel classification
-- engine. ews_dictionary.alias_ews_id (added via migrateV31Columns in db.js) carries the new
-- EWS-01..EWS-31 numbering from BRD V3.1's "EWS Master 31" sheet as a friendly alias over the
-- existing HPT-/AGR-/YM-/WM- codes -- old codes, incident/alert history and Import/Export
-- Center are untouched.

CREATE TABLE IF NOT EXISTS assessment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  local_id TEXT,
  server_id TEXT UNIQUE,
  assessment_code TEXT UNIQUE, -- ASMT-YYYYMMDD-XXXX
  user_id INTEGER REFERENCES user(id),
  device_id TEXT,
  estate_id INTEGER REFERENCES estate(id),
  afdeling_id INTEGER REFERENCES afdeling(id),
  blok_id INTEGER NOT NULL REFERENCES blok(id),
  planting_stage TEXT, -- TM/TBM/TB-0, snapshotted from blok.status_tanaman at capture time
  baris TEXT, -- jalur/baris sampel, free text (can be a list e.g. "3,13,23")
  sampling_method TEXT,
  sample_count INTEGER NOT NULL DEFAULT 0, -- how many pokok were actually recorded (denominator)
  tanggal TEXT NOT NULL,
  waktu_mulai TEXT,
  waktu_selesai TEXT,
  gps_lat REAL,
  gps_lng REAL,
  gps_accuracy REAL,
  location_warning INTEGER NOT NULL DEFAULT 0,
  catatan TEXT,
  status TEXT NOT NULL DEFAULT 'SUBMITTED', -- SUBMITTED | CALCULATED | FAILED
  petugas TEXT,
  sync_status TEXT NOT NULL DEFAULT 'SYNCED',
  sync_attempt INTEGER NOT NULL DEFAULT 0,
  sync_error TEXT,
  source TEXT NOT NULL DEFAULT 'API',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_blok ON assessment(blok_id);
CREATE INDEX IF NOT EXISTS idx_assessment_tanggal ON assessment(tanggal);

CREATE TABLE IF NOT EXISTS assessment_tree (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessment(id),
  pokok_index INTEGER NOT NULL, -- 1..N within this assessment, not a permanent pokok number
  status_pokok TEXT NOT NULL DEFAULT 'NORMAL', -- NORMAL | EXCEPTION
  kondisi_json TEXT, -- JSON array of tags: KERDIL/ETIOLASI/SISIPAN/KASTRASI/SANITASI/TUMBANG/KOSONG_MATI/ABNORMAL
  pruning TEXT DEFAULT 'NORMAL', -- NORMAL | UNDER | OVER
  susunan_pelepah TEXT, -- NORMAL | TIDAK_SESUAI (TM only)
  piringan TEXT, -- BAIK | TIDAK_BAIK
  gulma_piringan_json TEXT, -- JSON array: VOPS/BROAD_LEAF/FERN/WOODIES/GRASSES
  defisiensi_json TEXT, -- JSON array of {unsur, severity}
  hama_json TEXT, -- JSON array of {jenis, catatan?}
  foto_local_id TEXT,
  foto_id INTEGER,
  gps_lat REAL,
  gps_lng REAL,
  catatan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_assessment_tree_assessment ON assessment_tree(assessment_id);

CREATE TABLE IF NOT EXISTS assessment_area_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessment(id),
  gawangan TEXT, -- BAIK | TIDAK_BAIK
  gulma_gawangan_json TEXT,
  aplikasi_pupuk INTEGER NOT NULL DEFAULT 0,
  jenis_pupuk TEXT,
  tanggal_pupuk TEXT,
  keterangan_pupuk TEXT,
  by_product_json TEXT, -- JSON array: DDS/BA/FIBER
  keterangan_by_product TEXT,
  erosi TEXT, -- TIDAK_ADA | RINGAN | SEDANG | BERAT
  foto_id INTEGER,
  catatan TEXT,
  kbh TEXT, -- BAIK | TIDAK_ADA | TIDAK_BAIK
  beneficial_plants TEXT, -- BAIK | TIDAK_ADA | TIDAK_BAIK
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessment_water_observation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL UNIQUE REFERENCES assessment(id),
  drainase TEXT, -- BAIK | TIDAK_BAIK
  water_level_cm REAL,
  water_weir TEXT, -- BAIK | TIDAK_BAIK
  kondisi_parit TEXT, -- BAIK | RUSAK | TERSUMBAT | LAINNYA
  lama_genangan_hari REAL,
  catatan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Assessment Mapping Dictionary (EWS_Assessment_Mapping_Dictionary_V3_1.xlsx sheet "EWS
-- Assessment Mapping") -- reference/display data only. services/assessmentEngine.js calls
-- computeIndicatorResult() against the EXISTING hpt/formula/threshold tables rather than
-- reading this table at runtime, so it documents the mapping without being a second source of
-- calculation truth (BRD Addendum section 2 "mobile tidak menyimpan mapping hard-coded").
CREATE TABLE IF NOT EXISTS assessment_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_param_id TEXT UNIQUE NOT NULL, -- ASM-001..040
  category TEXT NOT NULL,
  assessment_parameter TEXT NOT NULL,
  input_type TEXT,
  ews_id_list TEXT, -- raw text, e.g. "EWS-04/EWS-05/EWS-06" or NULL if unmapped
  ews_indicator TEXT,
  planting_stage TEXT,
  calculation_or_use TEXT,
  threshold_or_status TEXT,
  required TEXT,
  capture_level TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Raw vs derived (BRD Addendum section 7): one row per EWS indicator actually computed from a
-- given assessment, keeping numerator/denominator/rate/threshold/rule_version for audit -- the
-- incident/alert rows themselves still live in incident/alert exactly like every other V1-V3
-- indicator, so Alert Center / dashboard need no V3.1-specific UI to see them.
CREATE TABLE IF NOT EXISTS calculation_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id INTEGER NOT NULL REFERENCES assessment(id),
  ews_id TEXT NOT NULL, -- alias EWS-xx code
  hpt_id INTEGER REFERENCES hpt(id),
  numerator REAL,
  denominator REAL,
  rate REAL,
  unit TEXT,
  kategori TEXT,
  ews_alert INTEGER NOT NULL DEFAULT 0,
  incident_id INTEGER REFERENCES incident(id),
  alert_id INTEGER REFERENCES alert(id),
  rule_version_id INTEGER REFERENCES rule_version(id),
  requires_manual_sensus INTEGER NOT NULL DEFAULT 0, -- Ulat/Ganoderma: symptom found -> recommend dedicated sensus, no direct classification
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_calculation_result_assessment ON calculation_result(assessment_id);
CREATE INDEX IF NOT EXISTS idx_calculation_result_ews ON calculation_result(ews_id);

-- BRD EWS HPT V3.2.1 section 16 (Duplicate Protection): routes/sync.js's batch upload handler
-- looks up an incoming record by local_id before inserting, so a retry that never received its
-- server_id back (e.g. the first upload's response timed out after the server had already
-- committed it) reuses the existing row instead of creating a second one. Non-unique (server_id
-- already has the UNIQUE constraint that guarantees no duplicate on the identifier the client DOES
-- receive back) -- this is a pure read-path speed-up, not a new data constraint.
CREATE INDEX IF NOT EXISTS idx_detection_local_id ON detection(local_id);
CREATE INDEX IF NOT EXISTS idx_sensus_local_id ON sensus(local_id);
CREATE INDEX IF NOT EXISTS idx_treatment_local_id ON treatment(local_id);
CREATE INDEX IF NOT EXISTS idx_mortality_local_id ON mortality(local_id);
