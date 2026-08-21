// Shared plumbing for every Sensus sub-form's submit handler (UPDKS/Tikus/Oryctes/Rayap/
// Ganoderma) - inserts the sensus row + optional photo with the exact sync envelope, so the five
// screens don't each re-implement local_id/activity_id/timestamp bookkeeping slightly differently.

import { insertSensus } from '../db/repo/sensusRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { uuid } from '../utils/uuid';
import { nowIso } from '../utils/format';
import { getDeviceId } from '../utils/device';
import type { CapturedPhoto } from './photo';
import type { LocalEngineResult } from './thresholdEngine';
import type { Blok, GpsCapture, UserProfile } from '../types';

export interface SaveSensusParams {
  user: UserProfile | null;
  blok: Blok;
  afdelingId: number | null;
  estateId: number | null;
  jenisSensus: string; // HPT code
  speciesId: number | null;
  hasil: Record<string, unknown>;
  hasilHitung: number;
  jalurBaris: unknown;
  catatan: string;
  photo: CapturedPhoto | null;
  gps: GpsCapture;
  engineResult: LocalEngineResult | null;
}

export async function saveSensusRecord(p: SaveSensusParams): Promise<{ local_id: string }> {
  const local_id = uuid();
  const activity_id = uuid();
  const device_id = await getDeviceId();
  const now = nowIso();

  await insertSensus({
    local_id,
    server_id: null,
    server_row_id: null,
    activity_id,
    incident_id: null,
    user_id: p.user?.id ?? null,
    device_id,
    created_at: now,
    updated_at: now,
    sync_status: 'READY_TO_SYNC',
    sync_attempt: 0,
    sync_error: null,
    source: 'MOBILE',
    jenis_sensus: p.jenisSensus,
    estate_id: p.estateId,
    afdeling_id: p.afdelingId,
    blok_id: p.blok.id,
    species_id: p.speciesId,
    jalur_baris_json: p.jalurBaris ? JSON.stringify(p.jalurBaris) : null,
    hasil_json: JSON.stringify(p.hasil),
    hasil_hitung: p.hasilHitung,
    kategori_lokal: p.engineResult?.kategori ?? null,
    saran_pengendalian: p.engineResult?.thresholdRow?.tindakan ?? null,
    foto_local_id: p.photo ? local_id : null,
    catatan: p.catatan || null,
    tanggal: new Date().toISOString().slice(0, 10),
    gps_lat: p.gps.gps_lat,
    gps_lng: p.gps.gps_lng,
    gps_accuracy: p.gps.gps_accuracy,
    gps_timestamp: p.gps.gps_timestamp,
    ews_alert_lokal: p.engineResult?.ews_alert ? 1 : 0,
  });

  if (p.photo) {
    await insertPhoto({
      local_id,
      entity_type: 'SENSUS',
      entity_local_id: local_id,
      file_uri: p.photo.uri,
      gps_lat: p.gps.gps_lat,
      gps_lng: p.gps.gps_lng,
      timestamp: now,
      user_id: p.user?.id ?? null,
      compressed_size: p.photo.size,
      uploaded: 0,
      server_photo_id: null,
    });
  }

  return { local_id };
}
