// Builds the exact JSON shapes backend/src/services/ingestion.js's ingestDetection/ingestSensus/
// ingestTreatment/ingestMortality expect (verified directly against that source file - see
// README.md "Backend contract notes"). Deliberately omits fields the server always (re)computes
// itself (kategori, ews_alert, location_warning, incident linkage beyond an explicit incident_id)
// so there is never a chance of the mobile app's local-only estimate overriding server truth.

import type { LocalDetection, LocalMortality, LocalSensus, LocalTreatment } from '../types';
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
