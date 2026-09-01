// Builds the exact JSON shapes backend/src/services/ingestion.js's ingestDetection/ingestSensus/
// ingestTreatment/ingestMortality expect (verified directly against that source file - see
// README.md "Backend contract notes"). Deliberately omits fields the server always (re)computes
// itself (kategori, ews_alert, location_warning, incident linkage beyond an explicit incident_id)
// so there is never a chance of the mobile app's local-only estimate overriding server truth.

import type {
  AssessmentTreeDraft,
  LocalAgroObservation,
  LocalAssessment,
  LocalBahanOrganik,
  LocalDefisiensiHaraTemuan,
  LocalDetection,
  LocalMortality,
  LocalSensus,
  LocalTbmVegetatif,
  LocalTreatment,
  LocalWaterManagement,
  LocalYieldPartenocarpi,
} from '../types';
import { safeParseJson } from '../utils/format';

export function buildDetectionPayload(row: LocalDetection): Record<string, unknown> {
  return {
    local_id: row.local_id,
    activity_id: row.activity_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    baris: row.baris,
    posisi: row.posisi,
    tanggal: row.tanggal,
    waktu: row.waktu,
    hpt_id: row.hpt_id,
    species_id: row.species_id,
    gejala: row.gejala,
    kondisi_indikator: row.kondisi_indikator,
    jumlah_indikasi: row.jumlah_indikasi,
    catatan: row.catatan,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    gps_timestamp: row.gps_timestamp,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildSensusPayload(row: LocalSensus): Record<string, unknown> {
  return {
    local_id: row.local_id,
    activity_id: row.activity_id,
    incident_id: row.incident_id ?? undefined,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    jenis_sensus: row.jenis_sensus,
    species_id: row.species_id,
    jalur_baris: safeParseJson(row.jalur_baris_json, null),
    hasil_json: safeParseJson<Record<string, unknown>>(row.hasil_json, {}),
    catatan: row.catatan,
    tanggal: row.tanggal,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildTreatmentPayload(row: LocalTreatment): Record<string, unknown> {
  return {
    local_id: row.local_id,
    activity_id: row.activity_id,
    incident_id: row.incident_id ?? undefined,
    hpt_id: row.hpt_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    luas_serangan: row.luas_serangan,
    metode_pengendalian: row.metode_pengendalian,
    tanggal_mulai: row.tanggal_mulai,
    tanggal_selesai: row.tanggal_selesai,
    jumlah_pokok: row.jumlah_pokok,
    hk: row.hk,
    material: row.material,
    jumlah_material: row.jumlah_material,
    alat: row.alat,
    pic: row.pic,
    catatan: row.catatan,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    status: row.status,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

// ================================================================== V2 (SPEC_V2.md) payloads
// Unlike V1's separate "upload record, then link photo back by entity_id" flow, the V2 create
// routes (routes/yieldMaking.js / routes/defisiensiHara.js) take the photo's server id directly on
// the CREATE body (`foto_id` / `evidence_photo_id`) - so the photo must be uploaded first, and its
// resulting server photo id is threaded into these payloads by sync/engine.ts.

export function buildYieldPartenocarpiPayload(row: LocalYieldPartenocarpi, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    tanggal: row.tanggal,
    periode: row.periode,
    rainfall_mm: row.rainfall_mm,
    indikator_hujan_pagi: row.indikator_hujan_pagi,
    total_bunch: row.total_bunch,
    abnormal_bunch: row.abnormal_bunch,
    abnormal_bunch_pct: row.abnormal_bunch_pct,
    populasi_ek: row.populasi_ek,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    foto_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildWaterManagementPayload(row: LocalWaterManagement, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    tanggal: row.tanggal,
    titik_parit: row.titik_parit,
    water_level_cm: row.water_level_cm,
    flooding: row.flooding,
    flooding_duration_hari: row.flooding_duration_hari,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    foto_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildBahanOrganikPayload(row: LocalBahanOrganik, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    tanggal: row.tanggal,
    area_type: row.area_type,
    total_sample: row.total_sample,
    yellowing_count: row.yellowing_count,
    yellowing_pct: row.yellowing_pct,
    vegetative_condition: row.vegetative_condition,
    baseline_tbm_normal: row.baseline_tbm_normal,
    comparison_result: row.comparison_result,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    foto_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildTbmVegetatifPayload(row: LocalTbmVegetatif, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    tanggal: row.tanggal,
    umur_bulan: row.umur_bulan,
    panjang_pelepah_cm: row.panjang_pelepah_cm,
    jumlah_pelepah: row.jumlah_pelepah,
    lai: row.lai,
    target_produksi_ton_ha: row.target_produksi_ton_ha,
    hasil_evaluasi: row.hasil_evaluasi,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    foto_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

export function buildDefisiensiHaraTemuanPayload(row: LocalDefisiensiHaraTemuan, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    leaf_analysis_id: row.leaf_analysis_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    tanggal: row.tanggal,
    unsur_hara: row.unsur_hara,
    temuan_lapangan: row.temuan_lapangan,
    severity: row.severity,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    evidence_photo_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    source: 'MOBILE',
  };
}

// V3 Dynamic Form Engine (routes/agroObservation.js's ingestAgroObservation() expects blok_id,
// hpt_id, ews_id, tanggal as required fields - see domain/ewsFormSchema.ts).
export function buildAgroObservationPayload(row: LocalAgroObservation, fotoServerId: number | null): Record<string, unknown> {
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    hpt_id: row.hpt_id,
    ews_id: row.ews_id,
    tanggal: row.tanggal,
    nilai_ukur: row.nilai_ukur,
    kategori: row.kategori,
    petugas: row.petugas,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    foto_id: fotoServerId,
    catatan: row.catatan,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}

// V3.1 Universal Assessment Form (routes/assessment.js's ingestAssessment() - see
// services/assessmentEngine.js). `treesWithPhotoIds` is the trees array from row.trees_json with
// each tree's foto_local_id already resolved to a server photo id by sync/engine.ts's
// uploadAssessments() (mirrors ensurePhotoUploaded's photo-before-record ordering, just looped
// per tree instead of once per record). Never sends kategori/percentage/threshold - only raw
// counts/flags, exactly like every other V2/V3 payload.
export function buildAssessmentPayload(
  row: LocalAssessment,
  treesWithPhotoIds: (AssessmentTreeDraft & { foto_id: number | null })[]
): Record<string, unknown> {
  const area = safeParseJson<Record<string, unknown> | null>(row.area_json, null);
  const water = safeParseJson<Record<string, unknown> | null>(row.water_json, null);
  return {
    local_id: row.local_id,
    blok_id: row.blok_id,
    afdeling_id: row.afdeling_id,
    estate_id: row.estate_id,
    planting_stage: row.planting_stage,
    baris: row.baris,
    sampling_method: row.sampling_method,
    tanggal: row.tanggal,
    waktu_mulai: row.waktu_mulai,
    waktu_selesai: row.waktu_selesai,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    gps_accuracy: row.gps_accuracy,
    catatan: row.catatan,
    petugas: row.petugas,
    device_id: row.device_id,
    created_at: row.created_at,
    source: 'MOBILE',
    trees: treesWithPhotoIds.map((t) => ({
      pokok_index: t.pokok_index,
      status_pokok: t.status_pokok,
      kondisi: t.kondisi,
      pruning: t.pruning,
      susunan_pelepah: t.susunan_pelepah,
      piringan: t.piringan,
      gulma_piringan: t.gulma_piringan,
      defisiensi: t.defisiensi,
      hama: t.hama,
      foto_id: t.foto_id,
      gps_lat: t.gps_lat,
      gps_lng: t.gps_lng,
      catatan: t.catatan,
    })),
    area: area || undefined,
    water: water || undefined,
  };
}

export function buildMortalityPayload(row: LocalMortality, resolvedTreatmentServerId: number): Record<string, unknown> {
  return {
    local_id: row.local_id,
    activity_id: row.activity_id,
    incident_id: row.incident_id ?? undefined,
    treatment_id: resolvedTreatmentServerId,
    tanggal: row.tanggal,
    blok_id: row.blok_id,
    sampel: row.sampel,
    jumlah_hidup: row.jumlah_hidup,
    jumlah_mati: row.jumlah_mati,
    kondisi: row.kondisi,
    gps_lat: row.gps_lat,
    gps_lng: row.gps_lng,
    status: row.status,
    created_at: row.created_at,
    source: 'MOBILE',
  };
}
