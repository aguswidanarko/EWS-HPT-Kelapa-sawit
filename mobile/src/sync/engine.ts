// The Sync Center engine (SPEC.md section 6 "Sinkronisasi" + "Sync Center"). Two independent
// halves:
//   downloadAll()  - pulls master/threshold/knowledge-base/jadwal/open-incidents, replaces the
//                    local cache in a transaction (server is source of truth for all of these).
//   uploadAll()    - pushes every READY_TO_SYNC/FAILED field record (batched, ordered so
//                    Mortalitas waits for its Treatment's server id), then uploads any photos
//                    attached to records that are now SYNCED.
//
// Every local write here goes through repo functions that use SQLite transactions, so an
// interrupted run (app closed, connection dropped mid-batch) leaves already-committed batches
// intact and simply resumes from whatever is still READY_TO_SYNC/FAILED on the next run - nothing
// is lost (BRD 01 non-functional reliability requirement).

import * as masterApi from '../api/sync';
import { apiErrorMessage, isNetworkError } from '../api/client';
import { SYNC_BATCH_SIZE, SYNC_MAX_AUTO_RETRY } from '../config';
import * as masterRepo from '../db/repo/masterRepo';
import * as kbRepo from '../db/repo/kbRepo';
import * as metaRepo from '../db/repo/metaRepo';
import * as detectionRepo from '../db/repo/detectionRepo';
import * as sensusRepo from '../db/repo/sensusRepo';
import * as treatmentRepo from '../db/repo/treatmentRepo';
import * as mortalityRepo from '../db/repo/mortalityRepo';
import * as photoRepo from '../db/repo/photoRepo';
import {
  countByStatus,
  markDeferred,
  markFailed,
  markSynced,
  markSyncing,
  updateIncidentId,
  type FieldTable,
} from '../db/repo/syncCommon';
import { buildDetectionPayload, buildMortalityPayload, buildSensusPayload, buildTreatmentPayload } from './payloads';
import type { LocalMortality, SyncCounts } from '../types';
import { nowIso } from '../utils/format';

export interface DownloadSummary {
  estates: number;
  afdelings: number;
  bloks: number;
  hpt: number;
  species: number;
  thresholds: number;
  knowledgeBase: number;
  jadwal: number;
  incidents: number;
  at: string;
}

export async function downloadAll(): Promise<DownloadSummary> {
  const master = await masterApi.downloadMaster();
  await masterRepo.saveMasterData(master);
  await metaRepo.setMeta(metaRepo.META_KEYS.LAST_SYNC_MASTER, nowIso());

  const thresholds = await masterApi.downloadThreshold();
  await masterRepo.saveThresholds(thresholds);
  await metaRepo.setMeta(metaRepo.META_KEYS.LAST_SYNC_THRESHOLD, nowIso());

  const kb = await masterApi.downloadKnowledgeBase();
  await kbRepo.saveKnowledgeBase(kb);
  await metaRepo.setMeta(metaRepo.META_KEYS.LAST_SYNC_KB, nowIso());

  const jadwal = await masterApi.downloadJadwal();
  await masterRepo.saveSchedules(jadwal);
  await metaRepo.setMeta(metaRepo.META_KEYS.LAST_SYNC_JADWAL, nowIso());

  // Best-effort extra (beyond the BRD's exact download list) so Pengendalian/Mortalitas can link
  // incident_id while offline. Never fails the whole download if this one call errors.
  let incidentCount = 0;
  try {
    const incidents = await masterApi.downloadOpenIncidents();
    await masterRepo.saveCachedIncidents(incidents);
    await metaRepo.setMeta(metaRepo.META_KEYS.LAST_SYNC_INCIDENTS, nowIso());
    incidentCount = incidents.length;
  } catch {
    /* non-critical */
  }

  return {
    estates: master.estates.length,
    afdelings: master.afdelings.length,
    bloks: master.bloks.length,
    hpt: master.hpt.length,
    species: master.species.length,
    thresholds: thresholds.length,
    knowledgeBase: kb.length,
    jadwal: jadwal.length,
    incidents: incidentCount,
    at: nowIso(),
  };
}

// ---------------------------------------------------------------- upload
export interface UploadProgress {
  kind: FieldTable;
  processed: number;
  total: number;
}
export type ProgressListener = (p: UploadProgress) => void;

export interface UploadSummary {
  totalAttempted: number;
  success: number;
  failed: number;
  deferred: number; // mortalitas waiting on a treatment that hasn't synced yet
  photosUploaded: number;
  photosFailed: number;
  errors: string[];
}

async function uploadKind(
  kind: FieldTable,
  onProgress?: ProgressListener
): Promise<{ success: number; failed: number; errors: string[] }> {
  let rows:
    | Awaited<ReturnType<typeof detectionRepo.getReadyDetections>>
    | Awaited<ReturnType<typeof sensusRepo.getReadySensus>>
    | Awaited<ReturnType<typeof treatmentRepo.getReadyTreatments>> = [];
  if (kind === 'detections') rows = await detectionRepo.getReadyDetections();
  else if (kind === 'sensus') rows = await sensusRepo.getReadySensus();
  else if (kind === 'treatments') rows = await treatmentRepo.getReadyTreatments();

  let success = 0;
  let failed = 0;
  const errors: string[] = [];
  const total = rows.length;
  const uploadKindKey = kind === 'detections' ? 'deteksi' : kind === 'sensus' ? 'sensus' : 'treatment';

  for (let i = 0; i < rows.length; i += SYNC_BATCH_SIZE) {
    const batch = rows.slice(i, i + SYNC_BATCH_SIZE);
    for (const r of batch) await markSyncing(kind, r.local_id);

    const payloadByLocalId = new Map<string, Record<string, unknown>>();
    for (const r of batch) {
      const payload =
        kind === 'detections'
          ? buildDetectionPayload(r as import('../types').LocalDetection)
          : kind === 'sensus'
          ? buildSensusPayload(r as import('../types').LocalSensus)
          : buildTreatmentPayload(r as import('../types').LocalTreatment);
      payloadByLocalId.set(r.local_id, payload);
    }

    try {
      const res = await masterApi.uploadBatch(uploadKindKey, Array.from(payloadByLocalId.values()));
      for (const item of res.data) {
        if (item.status === 'FAILED') {
          failed++;
          errors.push(`${item.local_id}: ${item.error || 'gagal'}`);
          await markFailed(kind, item.local_id, item.error || 'Gagal sinkron');
        } else {
          success++;
          await markSynced(kind, item.local_id, item.server_id || '', item.id ?? null, null);
          // Best-effort incident enrichment for detections/sensus (see api/sync.ts docstring).
          if ((kind === 'detections' || kind === 'sensus') && item.id) {
            try {
              const detail = await masterApi.fetchRecordDetail(kind === 'detections' ? 'deteksi' : 'sensus', item.id);
              if (detail?.incident_id) {
                await updateIncidentId(kind, item.local_id, detail.incident_id);
              }
            } catch {
              /* best effort only */
            }
          }
        }
      }
    } catch (e) {
      // Whole-batch network/server failure: revert every item in this batch to FAILED with the
      // shared error message so they're retried on the next sync run instead of stuck SYNCING.
      const msg = apiErrorMessage(e);
      for (const r of batch) {
        failed++;
        errors.push(`${r.local_id}: ${msg}`);
        await markFailed(kind, r.local_id, msg);
      }
      if (isNetworkError(e)) break; // stop this kind entirely if we just went offline mid-run
    }
    onProgress?.({ kind, processed: Math.min(i + batch.length, total), total });
  }
  return { success, failed, errors };
}

async function uploadMortalities(onProgress?: ProgressListener): Promise<{ success: number; failed: number; deferred: number; errors: string[] }> {
  const rows = await mortalityRepo.getReadyMortalities();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  const total = rows.length;

  const resolvable: { row: LocalMortality; treatmentServerId: number }[] = [];
  for (const row of rows) {
    if (!row.treatment_local_id) {
      // No linked treatment at all - mortality can still be submitted standalone if it carries an
      // incident_id (ingestMortality only requires `tanggal`).
      resolvable.push({ row, treatmentServerId: undefined as unknown as number });
      continue;
    }
    const treatment = await treatmentRepo.getTreatmentByLocalId(row.treatment_local_id);
    if (treatment?.sync_status === 'SYNCED' && treatment.server_row_id) {
      resolvable.push({ row, treatmentServerId: treatment.server_row_id });
    } else {
      deferred++;
      await markDeferred('mortalities', row.local_id, 'Menunggu data Treatment tersinkron');
    }
  }

  for (let i = 0; i < resolvable.length; i += SYNC_BATCH_SIZE) {
    const batch = resolvable.slice(i, i + SYNC_BATCH_SIZE);
    for (const { row } of batch) await markSyncing('mortalities', row.local_id);
    const payloads = batch.map(({ row, treatmentServerId }) => buildMortalityPayload(row, treatmentServerId));
    try {
      const res = await masterApi.uploadBatch('mortalitas', payloads);
      for (const item of res.data) {
        if (item.status === 'FAILED') {
          failed++;
          errors.push(`${item.local_id}: ${item.error || 'gagal'}`);
          await markFailed('mortalities', item.local_id, item.error || 'Gagal sinkron');
        } else {
          success++;
          await markSynced('mortalities', item.local_id, item.server_id || '', item.id ?? null, null);
        }
      }
    } catch (e) {
      const msg = apiErrorMessage(e);
      for (const { row } of batch) {
        failed++;
        errors.push(`${row.local_id}: ${msg}`);
        await markFailed('mortalities', row.local_id, msg);
      }
      if (isNetworkError(e)) break;
    }
    onProgress?.({ kind: 'mortalities', processed: Math.min(i + batch.length, total), total });
  }
  return { success, failed, deferred, errors };
}

async function uploadPhotos(): Promise<{ uploaded: number; failed: number }> {
  const pending = await photoRepo.getUnuploadedPhotos();
  let uploaded = 0;
  let failed = 0;
  for (const photo of pending) {
    // Resolve the parent record's server_row_id - photos can only upload once their parent synced.
    let entityId: number | null = null;
    if (photo.entity_type === 'DETECTION') {
      const parent = await detectionRepo.getDetectionByLocalId(photo.entity_local_id);
      entityId = parent?.server_row_id ?? null;
    } else if (photo.entity_type === 'SENSUS') {
      const parent = await sensusRepo.getSensusByLocalId(photo.entity_local_id);
      entityId = parent?.server_row_id ?? null;
    } else if (photo.entity_type === 'TREATMENT') {
      const parent = await treatmentRepo.getTreatmentByLocalId(photo.entity_local_id);
      entityId = parent?.server_row_id ?? null;
    } else if (photo.entity_type === 'MORTALITY') {
      const parent = await mortalityRepo.getMortalityByLocalId(photo.entity_local_id);
      entityId = parent?.server_row_id ?? null;
    }
    if (!entityId) continue; // parent not synced yet - try again next run

    try {
      const result = await masterApi.uploadPhoto({
        fileUri: photo.file_uri,
        fileName: `${photo.local_id}.jpg`,
        mimeType: 'image/jpeg',
        entity_type: photo.entity_type,
        entity_id: entityId,
        gps_lat: photo.gps_lat,
        gps_lng: photo.gps_lng,
        timestamp: photo.timestamp,
      });
      await photoRepo.markPhotoUploaded(photo.local_id, result.id);
      uploaded++;
    } catch {
      failed++;
    }
  }
  return { uploaded, failed };
}

/** Uploads every pending field record + photo, in dependency order (Mortalitas last, since it may
 * depend on a Treatment synced earlier in the SAME run). Safe to call while offline - each network
 * call fails fast and the record is simply left/reset to retry later. */
export async function uploadAll(onProgress?: ProgressListener): Promise<UploadSummary> {
  const det = await uploadKind('detections', onProgress);
  const sen = await uploadKind('sensus', onProgress);
  const trt = await uploadKind('treatments', onProgress);
  const mor = await uploadMortalities(onProgress);
  const photos = await uploadPhotos();

  return {
    totalAttempted: det.success + det.failed + sen.success + sen.failed + trt.success + trt.failed + mor.success + mor.failed,
    success: det.success + sen.success + trt.success + mor.success,
    failed: det.failed + sen.failed + trt.failed + mor.failed,
    deferred: mor.deferred,
    photosUploaded: photos.uploaded,
    photosFailed: photos.failed,
    errors: [...det.errors, ...sen.errors, ...trt.errors, ...mor.errors],
  };
}

export async function getPendingCounts(): Promise<SyncCounts> {
  const [d, s, t, m] = await Promise.all([
    countByStatus('detections'),
    countByStatus('sensus'),
    countByStatus('treatments'),
    countByStatus('mortalities'),
  ]);
  const pending = (c: Record<string, number>) => (c.READY_TO_SYNC ?? 0) + (c.FAILED ?? 0);
  return { deteksi: pending(d), sensus: pending(s), treatment: pending(t), mortalitas: pending(m) };
}

export { SYNC_MAX_AUTO_RETRY };
