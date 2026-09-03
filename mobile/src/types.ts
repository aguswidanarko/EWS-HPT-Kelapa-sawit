// Shared domain types for the EWS HPT mobile app.
// Mirrors backend/src/db/schema.sql + SPEC.md section 3, adapted for local SQLite storage.

export type SyncStatus = 'DRAFT' | 'READY_TO_SYNC' | 'SYNCING' | 'SYNCED' | 'FAILED';
export type SourceTag = 'MOBILE';
export type FaseTanaman = 'TBM1' | 'TBM2' | 'TBM3' | 'TM' | 'SEMUA' | string;
export type Severity = 'NORMAL' | 'RINGAN' | 'SEDANG' | 'BERAT' | 'CRITICAL';

// ---------------------------------------------------------------- Auth / session
export interface UserProfile {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  area_kerja: string | null;
  estate_id: number | null;
  afdeling_id: number | null;
  role_code: string;
  role_name: string;
  estate_name: string | null;
  afdeling_name: string | null;
  hak_akses: string[];
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: string;
}

// ---------------------------------------------------------------- Master data (cached, read-only)
// V3.2: Region -> Bisnis Unit -> PT (Estate). See LocationCascade.tsx / masterRepo.ts.
export interface Region {
  id: number;
  code: string;
  name: string;
}

export interface BisnisUnit {
  id: number;
  region_id: number;
  code: string;
  name: string;
}

export interface Estate {
  id: number;
  code: string;
  name: string;
  map_file_ref: string | null;
  region_id: number | null;
  bisnis_unit_id: number | null;
}

export interface Afdeling {
  id: number;
  estate_id: number;
  code: string;
  name: string;
  map_file_ref: string | null;
}

export interface SamplingParams {
  baris_sampel?: { start: number; step: number };
  grid?: { baris_start: number; baris_step: number; posisi_start: number; posisi_step: number };
  posisi_per_baris?: number | null;
}

export interface Blok {
  id: number;
  afdeling_id: number;
  code: string;
  name: string;
  luas: number | null;
  tahun_tanam: number | null;
  status_tanaman: FaseTanaman;
  referensi_polygon: string | null; // GeoJSON string
  jumlah_baris: number | null;
  parameter_sampling_json: string | null; // JSON string -> SamplingParams
  jumlah_pokok: number | null; // V3.2: Total Stand, from Master Blok upload
}

export type MetodeSensus = 'BARIS_SAMPEL' | 'GRID' | 'SELURUH_POKOK';

export interface Hpt {
  id: number;
  code: string; // UPDKS | TIKUS | ORYCTES | RAYAP | GANODERMA | ...
  name: string;
  nama_lokal: string | null;
  kategori: string | null;
  status_aktif: number;
  deskripsi: string | null;
  gejala: string | null;
  metode_deteksi: string | null;
  metode_sensus: MetodeSensus | string | null;
  satuan: string | null;
  threshold_default: string | null;
  panduan_md: string | null;
}

export interface Species {
  id: number;
  hpt_id: number;
  code: string;
  name: string;
  group_name: string | null;
}

export interface ThresholdRow {
  id: number;
  hpt_id: number;
  species_id: number | null;
  fase_tanaman: FaseTanaman;
  kategori: string;
  nilai_min: number | null;
  nilai_max: number | null;
  satuan: string | null;
  tindakan: string | null;
  severity: Severity | string;
  effective_date: string;
  status: string;
}

export interface KnowledgeBaseEntry {
  id: number;
  hpt_id: number | null;
  kategori: string;
  judul: string;
  versi: string | null;
  tanggal_berlaku: string | null;
  status_aktif: number;
  file_path: string | null;
  file_type: string | null;
  download_url: string | null;
  cached_local_path: string | null;
  cached_text: string | null; // inline text/markdown cached for offline viewing
}

export interface ScheduleItem {
  id: number;
  user_id: number;
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  jenis_kegiatan: string;
  hpt_id: number | null;
  tanggal_rencana: string;
  status: string;
}

export interface CachedIncident {
  id: number;
  incident_code: string;
  hpt_id: number | null;
  hpt_name: string | null;
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number | null;
  blok_code: string | null;
  status: string;
  severity: Severity | string;
  opened_at: string;
}

// ---------------------------------------------------------------- Local field-record envelope
// SPEC.md section 3 / BRD 01 section 8: every field record needs these.
export interface SyncEnvelope {
  local_id: string;
  server_id: string | null;
  /** Backend row's integer primary key (distinct from the uuid `server_id`) - only known once
   * SYNCED. Needed to link photos via POST /sync/upload/foto's entity_id, which expects this PK. */
  server_row_id: number | null;
  activity_id: string;
  incident_id: number | null;
  user_id: number | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  sync_attempt: number;
  sync_error: string | null;
  source: SourceTag;
}

export interface GpsCapture {
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  gps_timestamp: string | null;
}

export interface LocalDetection extends SyncEnvelope, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  baris: number | null;
  posisi: number | null;
  tanggal: string;
  waktu: string | null;
  hpt_id: number;
  species_id: number | null;
  gejala: string | null;
  kondisi_indikator: string | null;
  jumlah_indikasi: number | null;
  catatan: string | null;
  foto_local_id: string | null;
  location_warning: 0 | 1;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
}

export interface LocalSensus extends SyncEnvelope, GpsCapture {
  jenis_sensus: string; // HPT code
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  species_id: number | null;
  jalur_baris_json: string | null;
  hasil_json: string; // JSON blob, engine-specific shape (see domain/sensusEngines.ts)
  hasil_hitung: number | null;
  kategori_lokal: string | null;
  saran_pengendalian: string | null;
  foto_local_id: string | null;
  catatan: string | null;
  tanggal: string;
  ews_alert_lokal: 0 | 1;
}

export interface LocalTreatment extends SyncEnvelope, GpsCapture {
  hpt_id: number;
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  luas_serangan: number | null;
  metode_pengendalian: string | null;
  tanggal_mulai: string | null;
  tanggal_selesai: string | null;
  jumlah_pokok: number | null;
  hk: number | null;
  material: string | null;
  jumlah_material: string | null;
  alat: string | null;
  pic: string | null;
  catatan: string | null;
  foto_local_id: string | null;
  status: string;
}

export interface LocalMortality extends SyncEnvelope, GpsCapture {
  treatment_local_id: string | null; // local FK - resolved to server treatment_id at sync time
  tanggal: string;
  blok_id: number | null;
  sampel: number | null;
  jumlah_hidup: number | null;
  jumlah_mati: number | null;
  kondisi: string | null;
  foto_local_id: string | null;
  hasil_efektivitas_lokal: string | null;
  service_required_lokal: 0 | 1;
  status: string;
}

export type FieldRecordKind = 'deteksi' | 'sensus' | 'treatment' | 'mortalitas';

export interface LocalPhoto {
  local_id: string;
  entity_type:
    | 'DETECTION'
    | 'SENSUS'
    | 'TREATMENT'
    | 'MORTALITY'
    | 'YIELD_PARTENOCARPI'
    | 'WATER_MANAGEMENT'
    | 'BAHAN_ORGANIK'
    | 'TBM_VEGETATIF'
    | 'DEFISIENSI_HARA_TEMUAN'
    | 'ACTION_PLAN'
    | 'AGRO_OBSERVATION'
    | 'ASSESSMENT_TREE';
  entity_local_id: string;
  file_uri: string;
  gps_lat: number | null;
  gps_lng: number | null;
  timestamp: string;
  user_id: number | null;
  compressed_size: number | null;
  uploaded: 0 | 1;
  server_photo_id: number | null;
}

// ---------------------------------------------------------------- Sync summary
export interface SyncCounts {
  deteksi: number;
  sensus: number;
  treatment: number;
  mortalitas: number;
  /** SPEC_V2.md section 4: combined count across the 4 yield_making tables (partenocarpi/water/
   * organik/tbm) - broken out per-table only where a screen needs it, summed everywhere else. */
  yieldMaking: number;
  defisiensiHara: number;
  actionPlan: number;
  agroObservation: number;
  assessment: number;
}

// ================================================================== V2 (SPEC_V2.md) additions
// Every V2 field-record table (yield_partenocarpi/water_management/bahan_organik/tbm_vegetatif/
// defisiensi_hara_temuan) carries the SAME sync envelope shape as V1 (local_id/server_id/
// server_row_id/incident_id/user_id/device_id/created_at/updated_at/sync_status/sync_attempt/
// sync_error/source - SPEC_V2.md section 2 closing note) EXCEPT it has no activity_id column
// (that's a V1-only concept absent from every V2 table definition).
export interface SyncEnvelopeV2 {
  local_id: string;
  server_id: string | null;
  server_row_id: number | null;
  incident_id: number | null;
  user_id: number | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  sync_attempt: number;
  sync_error: string | null;
  source: SourceTag;
}

export interface LocalYieldPartenocarpi extends SyncEnvelopeV2, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  tanggal: string;
  periode: string | null;
  rainfall_mm: number | null;
  indikator_hujan_pagi: number | null;
  total_bunch: number | null;
  abnormal_bunch: number | null;
  abnormal_bunch_pct: number | null;
  populasi_ek: number | null;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
  location_warning: 0 | 1;
  foto_local_id: string | null;
  catatan: string | null;
}

export interface LocalWaterManagement extends SyncEnvelopeV2, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  titik_parit: string | null;
  tanggal: string;
  water_level_cm: number | null;
  flooding: 0 | 1;
  flooding_duration_hari: number | null;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
  location_warning: 0 | 1;
  foto_local_id: string | null;
  catatan: string | null;
}

export interface LocalBahanOrganik extends SyncEnvelopeV2, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  area_type: string | null;
  tanggal: string;
  total_sample: number | null;
  yellowing_count: number | null;
  yellowing_pct: number | null;
  vegetative_condition: string | null;
  baseline_tbm_normal: string | null;
  comparison_result: string | null;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
  location_warning: 0 | 1;
  foto_local_id: string | null;
  catatan: string | null;
}

export interface LocalTbmVegetatif extends SyncEnvelopeV2, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  tanggal: string;
  umur_bulan: number | null;
  panjang_pelepah_cm: number | null;
  jumlah_pelepah: number | null;
  lai: number | null;
  target_produksi_ton_ha: number | null;
  hasil_evaluasi: string | null;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
  location_warning: 0 | 1;
  foto_local_id: string | null;
  catatan: string | null;
}

export type YieldMakingKind = 'PARTENOCARPI' | 'WATER_MANAGEMENT' | 'BAHAN_ORGANIK' | 'TBM_VEGETATIF';

// ================================================================== V3 Dynamic Form Engine
// AGR-005..014 (Etiolasi, Pokok doyong, Areal tanpa teras, Overpruning, Susunan pelepah, Ground
// cover management, Pokok kerdil, Abnormal, Pokok sisipan, Pokok mati) share ONE generic backend
// table (agro_observation, schema.sql "V3 EXTENSIONS") discriminated by hpt_id + ews_id rather
// than one table per indicator - see domain/ewsFormSchema.ts for why the mobile Dynamic Form
// Engine mirrors that same generic shape instead of adding 10 more hard-coded local tables.
export interface LocalAgroObservation extends SyncEnvelopeV2, GpsCapture {
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  hpt_id: number;
  ews_id: string;
  tanggal: string;
  nilai_ukur: number | null;
  kategori: string | null;
  kategori_lokal: string | null;
  ews_alert_lokal: 0 | 1;
  location_warning: 0 | 1;
  foto_local_id: string | null;
  petugas: string | null;
  catatan: string | null;
}

/** Local read-only cache of GET /api/master-ews-dictionary (schema.sql `ews_dictionary`) - the
 * 32-row EWS Dictionary the Dynamic Form Engine's picker/help-text reads offline. Mobile never
 * writes this table (admin-edited only, from the Dashboard). */
export interface EwsDictionaryRow {
  ews_id: string;
  scope: string; // HPT | Yield Making | Agro | WM
  hpt_id: number;
  hpt_code: string;
  hpt_name: string;
  planting_stage: string | null;
  threshold_display_text: string | null;
  inspection_interval: string | null;
  recommendation: string | null;
  status: string;
}

export interface LocalDefisiensiHaraTemuan extends SyncEnvelopeV2, GpsCapture {
  leaf_analysis_id: number | null;
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  tanggal: string;
  unsur_hara: string | null;
  temuan_lapangan: string | null;
  severity: string | null;
  status: string;
  action_plan_id: number | null;
  evidence_photo_id: number | null;
  foto_local_id: string | null;
  location_warning: 0 | 1;
  catatan: string | null;
}

/** Riset's lab-side foliar analysis (read-only reference data cached from GET /leaf-analysis - see
 * routes/leafAnalysis.js). Mobile never writes this; it only informs which bloks have a flagged
 * deficiency so the field officer knows where to record a defisiensi_hara_temuan. */
export interface CachedLeafAnalysis {
  id: number;
  blok_id: number | null;
  tanggal: string;
  unsur_hara: string;
  hasil: string | null;
  severity: string | null;
  status: string;
  input_by_role: string;
  user_id: number | null;
  catatan: string | null;
  created_at: string;
  updated_at: string;
}

/** Read-only cache of action_plan rows assigned to this user (pic_user_id) - downloaded like
 * cached_incidents, mirrors backend/src/routes/actionPlans.js's row shape. */
export interface CachedActionPlan {
  id: number;
  local_id: string | null;
  server_id: string | null;
  incident_id: number | null;
  alert_id: number | null;
  problem: string | null;
  recommendation: string | null;
  actual_action: string | null;
  pic_user_id: number | null;
  due_date: string | null;
  status: string;
  evidence_photo_id: number | null;
  verification_note: string | null;
  verified_by_user_id: number | null;
  verified_at: string | null;
  overdue: 0 | 1;
  escalated: 0 | 1;
  related_leaf_analysis_id: number | null;
  created_at: string;
  updated_at: string;
}

export const ACTION_PLAN_STATUSES = ['OPEN', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'] as const;
export type ActionPlanStatus = (typeof ACTION_PLAN_STATUSES)[number];

/** A queued offline edit to one action_plan (PUT /action-plans/:id: actual_action/status/
 * evidence_photo_id) - SPEC_V2.md section 4 Mobile: "form actual action/status/evidence". Uses the
 * same DRAFT->READY_TO_SYNC->SYNCING->SYNCED/FAILED envelope as every other field record, but
 * targets an EXISTING server row (action_plan_id) instead of creating a new one. */
export interface LocalActionPlanUpdate {
  local_id: string;
  action_plan_id: number;
  status: ActionPlanStatus | null;
  actual_action: string | null;
  foto_local_id: string | null;
  evidence_photo_id: number | null;
  user_id: number | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  sync_attempt: number;
  sync_error: string | null;
  source: SourceTag;
}

/** Local cache of `sampling_rule` (GET /api/formulas/sampling-rules) - SPEC_V2.md section 4 Mobile:
 * "Sampling Assistant: generalize supaya baca sampling_rule". */
export interface SamplingRuleRow {
  id: number;
  hpt_id: number;
  method: string | null;
  row_start: number | null;
  row_interval: number | null;
  plant_start: number | null;
  plant_interval: number | null;
  minimum_sample: number | null;
  unit_scope: string | null;
  description: string | null;
  active: number;
}

// ================================================================== V3.1 Universal Assessment Form
// BRD_Mobile_V3_1.docx: one field visit captures raw per-pokok observations across ALL 31 EWS
// indicators at once (instead of picking one of 32 EWS_ID and filling one form - see
// domain/assessmentSchema.ts). Backend fans this out into potentially many EWS results
// (services/assessmentEngine.js) - mobile only ever sends raw counts/flags, never a computed
// kategori/percentage, matching every other V2/V3 payload's "server is classification truth" rule.

export type KondisiPokokTag = 'KERDIL' | 'ETIOLASI' | 'SISIPAN' | 'KASTRASI' | 'SANITASI' | 'TUMBANG' | 'KOSONG_MATI' | 'ABNORMAL';
export type PruningStatus = 'NORMAL' | 'UNDER' | 'OVER';
export type BaikTidakBaik = 'BAIK' | 'TIDAK_BAIK';
export type SusunanPelepahStatus = 'NORMAL' | 'TIDAK_SESUAI';
export type GulmaTag = 'VOPS' | 'BROAD_LEAF' | 'FERN' | 'WOODIES' | 'GRASSES';
export type DefisiensiUnsur = 'N' | 'P' | 'K' | 'MG' | 'B' | 'CU' | 'ZN' | 'FE' | 'NK';
export type DefisiensiSeverity = 'RINGAN' | 'SEDANG' | 'BERAT';
export type HamaJenis = 'ULAT' | 'TIKUS' | 'RAYAP' | 'KUMBANG' | 'TIRATHABA' | 'UPPER_STEM_ROOT' | 'BASAL_STEM_ROOT' | 'LAINNYA';

export interface AssessmentDefisiensi {
  unsur: DefisiensiUnsur;
  severity: DefisiensiSeverity;
}
export interface AssessmentHama {
  jenis: HamaJenis;
  catatan?: string | null;
}

/** One pokok examined during a visit - normal-first/exception-only (BRD section 3 "Prinsip UX"):
 * kondisi/pruning/defisiensi/hama only carry entries when something was actually found. */
export interface AssessmentTreeDraft {
  pokok_index: number;
  status_pokok: 'NORMAL' | 'EXCEPTION';
  kondisi: KondisiPokokTag[];
  pruning: PruningStatus;
  susunan_pelepah: SusunanPelepahStatus | null;
  piringan: BaikTidakBaik | null;
  gulma_piringan: GulmaTag[];
  defisiensi: AssessmentDefisiensi[];
  hama: AssessmentHama[];
  foto_local_id: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  catatan: string | null;
}

export interface AssessmentAreaDraft {
  gawangan: BaikTidakBaik | null;
  gulma_gawangan: GulmaTag[];
  aplikasi_pupuk: boolean;
  jenis_pupuk: string | null;
  tanggal_pupuk: string | null;
  keterangan_pupuk: string | null;
  by_product: ('DDS' | 'BA' | 'FIBER')[];
  keterangan_by_product: string | null;
  erosi: 'TIDAK_ADA' | 'RINGAN' | 'SEDANG' | 'BERAT' | null;
  catatan: string | null;
  kbh: 'BAIK' | 'TIDAK_ADA' | 'TIDAK_BAIK' | null;
  beneficial_plants: 'BAIK' | 'TIDAK_ADA' | 'TIDAK_BAIK' | null;
}

export interface AssessmentWaterDraft {
  drainase: BaikTidakBaik | null;
  water_level_cm: number | null;
  water_weir: BaikTidakBaik | null;
  kondisi_parit: 'BAIK' | 'RUSAK' | 'TERSUMBAT' | 'LAINNYA' | null;
  lama_genangan_hari: number | null;
  catatan: string | null;
}

export interface CalculationResultSummary {
  ews_id: string;
  hpt_code?: string;
  kategori: string | null;
  ews_alert: boolean;
  requiresManualSensus?: boolean;
}

/** Local `assessments` table - trees/area/water stored as JSON blobs (same idiom as sensus'
 * hasil_json for row/grid-sampling layouts) since the whole visit syncs as ONE record in ONE
 * POST /api/assessment call, not N per-tree calls (see sync/engine.ts's uploadAssessments()). */
export interface LocalAssessment {
  local_id: string;
  server_id: string | null;
  server_row_id: number | null;
  assessment_code: string | null;
  user_id: number | null;
  device_id: string | null;
  created_at: string;
  updated_at: string;
  sync_status: SyncStatus;
  sync_attempt: number;
  sync_error: string | null;
  source: SourceTag;
  estate_id: number | null;
  afdeling_id: number | null;
  blok_id: number;
  planting_stage: string | null;
  baris: string | null;
  sampling_method: string | null;
  sample_count: number;
  tanggal: string;
  waktu_mulai: string | null;
  waktu_selesai: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  location_warning: 0 | 1;
  catatan: string | null;
  petugas: string | null;
  trees_json: string; // AssessmentTreeDraft[]
  area_json: string | null; // AssessmentAreaDraft
  water_json: string | null; // AssessmentWaterDraft
  calc_summary_json: string | null; // CalculationResultSummary[], backfilled after sync
}

export interface SyncItemStatus {
  kind: FieldRecordKind;
  local_id: string;
  label: string;
  status: SyncStatus;
  error: string | null;
  updated_at: string;
}
