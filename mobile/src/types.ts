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
export interface Estate {
  id: number;
  code: string;
  name: string;
  map_file_ref: string | null;
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
  entity_type: 'DETECTION' | 'SENSUS' | 'TREATMENT' | 'MORTALITY';
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
}

export interface SyncItemStatus {
  kind: FieldRecordKind;
  local_id: string;
  label: string;
  status: SyncStatus;
  error: string | null;
  updated_at: string;
}
