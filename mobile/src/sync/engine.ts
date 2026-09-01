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
//
// ---------------------------------------------------------------------------------------------
// Backend sync contract note (SPEC_V2.md section 4 Mobile task: "check src/routes/sync.js ...
// verify, don't assume"): routes/sync.js's batch upload endpoints are HARD-CODED to
// TABLE_BY_KIND = {deteksi, sensus, treatment, mortalitas} - it was NOT generalized for the six
// new V2 entities. The V2 backend instead exposes ordinary per-entity REST resources
// (routes/yieldMaking.js, routes/defisiensiHara.js, routes/actionPlans.js) with a single-record
// POST/PUT, not a batch endpoint. So every V2 kind below uploads one record at a time via
// src/api/v2.ts instead of masterApi.uploadBatch - still queued/retried locally with the exact
// same DRAFT->READY_TO_SYNC->SYNCING->SYNCED/FAILED envelope as every V1 kind. See the final
// report for why this wasn't "fixed" here (mobile-only task; flagged back instead).

import * as masterApi from '../api/sync';
import * as v2Api from '../api/v2';
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
import * as yieldRepo from '../db/repo/yieldRepo';
import * as defisiensiHaraRepo from '../db/repo/defisiensiHaraRepo';
import * as actionPlanRepo from '../db/repo/actionPlanRepo';
import * as agroObservationRepo from '../db/repo/agroObservationRepo';
import * as assessmentRepo from '../db/repo/assessmentRepo';
import * as ewsDictionaryRepo from '../db/repo/ewsDictionaryRepo';
import {
  countByStatus,
  markDeferred,
  markFailed,
  markSynced,
  markSyncing,
  updateClassification,
  updateIncidentId,
  type FieldTable,
} from '../db/repo/syncCommon';
import {
  buildAgroObservationPayload,
  buildAssessmentPayload,
  buildBahanOrganikPayload,
  buildDefisiensiHaraTemuanPayload,
  buildDetectionPayload,
  buildMortalityPayload,
  buildSensusPayload,
  buildTbmVegetatifPayload,
  buildTreatmentPayload,
  buildWaterManagementPayload,
  buildYieldPartenocarpiPayload,
} from './payloads';
import type {
  AssessmentTreeDraft,
  CalculationResultSummary,
  LocalBahanOrganik,
  LocalDefisiensiHaraTemuan,
  LocalMortality,
  LocalPhoto,
  LocalTbmVegetatif,
  LocalWaterManagement,
  LocalYieldPartenocarpi,
  SyncCounts,
} from '../types';
import { nowIso, safeParseJson } from '../utils/format';

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
  /** V2 additions - all best-effort (non-critical), same pattern as `incidents` above. */
  samplingRules: number;
  leafAnalysis: number;
  actionPlans: number;
  /** V3 Dynamic Form Engine addition - also best-effort (see below): the picker/help-text still
   * works from EWS_FORM_SCHEMA (bundled, offline) if this never lands. */
  ewsDictionary: number;
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

  // ---- V2 (SPEC_V2.md section 4 Mobile) additions, all best-effort like `incidents` above ----
  let samplingRuleCount = 0;
  try {
    const samplingRules = await v2Api.downloadSamplingRules();
    await masterRepo.saveSamplingRules(samplingRules);
    samplingRuleCount = samplingRules.length;
  } catch {
    /* non-critical */
  }

  let leafAnalysisCount = 0;
  try {
    const leafAnalysis = await v2Api.downloadLeafAnalysis();
    await defisiensiHaraRepo.saveCachedLeafAnalysis(leafAnalysis);
    leafAnalysisCount = leafAnalysis.length;
  } catch {
    /* non-critical */
  }

  let actionPlanCount = 0;
  try {
    const profile = await metaRepo.loadUserProfile();
    if (profile) {
      const plans = await v2Api.downloadAssignedActionPlans(profile.id);
      await actionPlanRepo.saveCachedActionPlans(plans);
      actionPlanCount = plans.length;
    }
  } catch {
    /* non-critical */
  }

  // ---- V3 (BRD_V3_Mobile_Offline.docx section 3 "Dynamic Form") addition ----------------------
  let ewsDictionaryCount = 0;
  try {
    const dict = await v2Api.downloadEwsDictionary();
    await ewsDictionaryRepo.saveEwsDictionary(dict);
    ewsDictionaryCount = dict.length;
  } catch {
    /* non-critical - EwsPickerScreen/EwsFormScreen still work offline from the bundled
       domain/ewsFormSchema.ts, they just show a generic label instead of the admin-edited
       threshold/recommendation text until the next successful sync. */
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
    samplingRules: samplingRuleCount,
    leafAnalysis: leafAnalysisCount,
    actionPlans: actionPlanCount,
    ewsDictionary: ewsDictionaryCount,
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

// ================================================================== V2 (SPEC_V2.md) uploads
// See the "Backend sync contract note" at the top of this file: these post one record at a time
// to their own REST endpoint (src/api/v2.ts) instead of masterApi.uploadBatch.

/** Uploads (if needed) the single photo attached to a V2 record and returns its server-side numeric
 * id, or null if there's no photo / it hasn't made it to the server yet. Unlike V1 (photo uploads
 * AFTER its parent syncs, then links back by entity_id), V2's create endpoints take the photo's
 * server id directly on the create/update body (routes/yieldMaking.js and routes/defisiensiHara.js
 * have no PUT for attaching a photo after the fact) - so the photo must go first, with entity_id
 * left null since the parent record doesn't have a server id yet either. */
async function ensurePhotoUploaded(fotoLocalId: string | null, entityType: LocalPhoto['entity_type']): Promise<number | null> {
  if (!fotoLocalId) return null;
  const photos = await photoRepo.getPhotosByEntity(entityType, fotoLocalId);
  const photo = photos[0];
  if (!photo) return null;
  if (photo.uploaded && photo.server_photo_id) return photo.server_photo_id;
  try {
    const result = await masterApi.uploadPhoto({
      fileUri: photo.file_uri,
      fileName: `${photo.local_id}.jpg`,
      mimeType: 'image/jpeg',
      entity_type: entityType,
      entity_id: null,
      gps_lat: photo.gps_lat,
      gps_lng: photo.gps_lng,
      timestamp: photo.timestamp,
    });
    await photoRepo.markPhotoUploaded(photo.local_id, result.id);
    return result.id;
  } catch {
    return null; // offline / failed this run - caller defers the whole record, retried next run
  }
}

type YieldTable = 'yield_partenocarpi' | 'water_management' | 'bahan_organik' | 'tbm_vegetatif';
interface YieldUploadResult {
  success: number;
  failed: number;
  deferred: number;
  errors: string[];
}

async function uploadYieldPartenocarpi(): Promise<YieldUploadResult> {
  return uploadYieldGeneric<LocalYieldPartenocarpi>('yield_partenocarpi', 'YIELD_PARTENOCARPI', 'partenocarpi', yieldRepo.getReadyYieldPartenocarpi, buildYieldPartenocarpiPayload);
}
async function uploadWaterManagement(): Promise<YieldUploadResult> {
  return uploadYieldGeneric<LocalWaterManagement>('water_management', 'WATER_MANAGEMENT', 'water-management', yieldRepo.getReadyWaterManagement, buildWaterManagementPayload);
}
async function uploadBahanOrganik(): Promise<YieldUploadResult> {
  return uploadYieldGeneric<LocalBahanOrganik>('bahan_organik', 'BAHAN_ORGANIK', 'bahan-organik', yieldRepo.getReadyBahanOrganik, buildBahanOrganikPayload);
}
async function uploadTbmVegetatif(): Promise<YieldUploadResult> {
  return uploadYieldGeneric<LocalTbmVegetatif>('tbm_vegetatif', 'TBM_VEGETATIF', 'tbm-vegetatif', yieldRepo.getReadyTbmVegetatif, buildTbmVegetatifPayload);
}

async function uploadYieldGeneric<T extends { local_id: string; foto_local_id: string | null }>(
  table: YieldTable,
  entityType: LocalPhoto['entity_type'],
  subpath: v2Api.YieldMakingSubpath,
  getReady: () => Promise<T[]>,
  buildPayload: (row: T, fotoServerId: number | null) => Record<string, unknown>
): Promise<YieldUploadResult> {
  const rows = await getReady();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const fotoServerId = await ensurePhotoUploaded(row.foto_local_id, entityType);
    if (row.foto_local_id && !fotoServerId) {
      deferred++;
      await markDeferred(table, row.local_id, 'Menunggu foto terunggah');
      continue;
    }
    await markSyncing(table, row.local_id);
    try {
      const res = await v2Api.createYieldMakingRecord(subpath, buildPayload(row, fotoServerId));
      await markSynced(table, row.local_id, res.data.server_id, res.data.id ?? null, null);
      await updateClassification(table, row.local_id, res.classification.kategori, res.classification.ews_alert);
      success++;
    } catch (e) {
      const msg = apiErrorMessage(e);
      failed++;
      errors.push(`${row.local_id}: ${msg}`);
      await markFailed(table, row.local_id, msg);
      if (isNetworkError(e)) break; // just went offline mid-run - stop this kind, retry next sync
    }
  }
  return { success, failed, deferred, errors };
}

async function uploadDefisiensiHara(): Promise<{ success: number; failed: number; deferred: number; errors: string[] }> {
  const rows = await defisiensiHaraRepo.getReadyDefisiensiHaraTemuan();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const fotoServerId = await ensurePhotoUploaded(row.foto_local_id, 'DEFISIENSI_HARA_TEMUAN');
    if (row.foto_local_id && !fotoServerId) {
      deferred++;
      await markDeferred('defisiensi_hara_temuan', row.local_id, 'Menunggu foto terunggah');
      continue;
    }
    await markSyncing('defisiensi_hara_temuan', row.local_id);
    try {
      const res = await v2Api.createDefisiensiHaraTemuan(buildDefisiensiHaraTemuanPayload(row, fotoServerId));
      await markSynced('defisiensi_hara_temuan', row.local_id, res.data.server_id, res.data.id ?? null, null);
      success++;
    } catch (e) {
      const msg = apiErrorMessage(e);
      failed++;
      errors.push(`${row.local_id}: ${msg}`);
      await markFailed('defisiensi_hara_temuan', row.local_id, msg);
      if (isNetworkError(e)) break;
    }
  }
  return { success, failed, deferred, errors };
}

// V3 Dynamic Form Engine (AGR-005..014) - same single-record-REST-with-photo-first shape as
// uploadYieldGeneric above, targeting the new POST /api/agro-observation instead.
async function uploadAgroObservations(): Promise<{ success: number; failed: number; deferred: number; errors: string[] }> {
  const rows = await agroObservationRepo.getReadyAgroObservations();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const fotoServerId = await ensurePhotoUploaded(row.foto_local_id, 'AGRO_OBSERVATION');
    if (row.foto_local_id && !fotoServerId) {
      deferred++;
      await markDeferred('agro_observations', row.local_id, 'Menunggu foto terunggah');
      continue;
    }
    await markSyncing('agro_observations', row.local_id);
    try {
      const res = await v2Api.createAgroObservationRecord(buildAgroObservationPayload(row, fotoServerId));
      await markSynced('agro_observations', row.local_id, res.data.server_id, (res.data.id as number) ?? null, null);
      await updateClassification('agro_observations', row.local_id, res.classification.kategori, res.classification.ews_alert);
      success++;
    } catch (e) {
      const msg = apiErrorMessage(e);
      failed++;
      errors.push(`${row.local_id}: ${msg}`);
      await markFailed('agro_observations', row.local_id, msg);
      if (isNetworkError(e)) break;
    }
  }
  return { success, failed, deferred, errors };
}

// V3.1 Universal Assessment Form - one visit = one POST /api/assessment carrying trees[] inline
// (not N per-tree calls, since routes/sync.js's batch endpoint only covers the 4 V1 kinds and
// inventing a second new batch endpoint for a single new entity wasn't worth it - the whole visit
// is one JSON body either way). Photos are per-tree (0..N), so this loops ensurePhotoUploaded
// once per tree needing one BEFORE building the payload, same ordering rule as every other V2/V3
// upload (photo first, defer the whole record if any required photo can't be resolved yet).
async function uploadAssessments(): Promise<{ success: number; failed: number; deferred: number; errors: string[] }> {
  const rows = await assessmentRepo.getReadyAssessments();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const trees = safeParseJson<AssessmentTreeDraft[]>(row.trees_json, []);
    let blockedOnPhoto = false;
    const treesWithPhotoIds: (AssessmentTreeDraft & { foto_id: number | null })[] = [];
    for (const t of trees) {
      const fotoServerId = await ensurePhotoUploaded(t.foto_local_id, 'ASSESSMENT_TREE');
      if (t.foto_local_id && !fotoServerId) {
        blockedOnPhoto = true;
        break;
      }
      treesWithPhotoIds.push({ ...t, foto_id: fotoServerId });
    }
    if (blockedOnPhoto) {
      deferred++;
      await assessmentRepo.markDeferred(row.local_id, 'Menunggu foto pokok terunggah');
      continue;
    }
    await assessmentRepo.markSyncing(row.local_id);
    try {
      const res = await v2Api.createAssessmentRecord(buildAssessmentPayload(row, treesWithPhotoIds));
      const summary: CalculationResultSummary[] = res.calculation_results.map((r) => ({
        ews_id: r.ews_id,
        kategori: r.kategori,
        ews_alert: !!r.ews_alert,
        requiresManualSensus: !!r.requires_manual_sensus,
      }));
      await assessmentRepo.markSynced(row.local_id, res.data.server_id, (res.data.id as number) ?? null, res.data.assessment_code ?? null, summary);
      success++;
    } catch (e) {
      const msg = apiErrorMessage(e);
      failed++;
      errors.push(`${row.local_id}: ${msg}`);
      await assessmentRepo.markFailed(row.local_id, msg);
      if (isNetworkError(e)) break;
    }
  }
  return { success, failed, deferred, errors };
}

/** action_plan_updates targets an EXISTING server-side action_plan row (PUT, not POST) - see
 * types.ts LocalActionPlanUpdate. Its status transitions live in db/repo/actionPlanRepo.ts since it
 * doesn't fit db/repo/syncCommon.ts's FieldTable contract (no server_id/server_row_id of its own). */
async function uploadActionPlanUpdates(): Promise<{ success: number; failed: number; deferred: number; errors: string[] }> {
  const rows = await actionPlanRepo.getReadyActionPlanUpdates();
  let success = 0;
  let failed = 0;
  let deferred = 0;
  const errors: string[] = [];
  for (const row of rows) {
    const fotoServerId = await ensurePhotoUploaded(row.foto_local_id, 'ACTION_PLAN');
    if (row.foto_local_id && !fotoServerId) {
      deferred++;
      continue; // left READY_TO_SYNC as-is, retried once the photo makes it up next run
    }
    await actionPlanRepo.markActionPlanUpdateSyncing(row.local_id);
    try {
      const payload: v2Api.ActionPlanUpdatePayload = {};
      if (row.status) payload.status = row.status;
      if (row.actual_action) payload.actual_action = row.actual_action;
      if (fotoServerId) payload.evidence_photo_id = fotoServerId;
      const res = await v2Api.updateActionPlan(row.action_plan_id, payload);
      await actionPlanRepo.markActionPlanUpdateSynced(row.local_id);
      await actionPlanRepo.patchCachedActionPlan(row.action_plan_id, { status: res.data.status, actual_action: res.data.actual_action });
      success++;
    } catch (e) {
      const msg = apiErrorMessage(e);
      failed++;
      errors.push(`${row.local_id}: ${msg}`);
      await actionPlanRepo.markActionPlanUpdateFailed(row.local_id, msg);
      if (isNetworkError(e)) break;
    }
  }
  return { success, failed, deferred, errors };
}

/** Uploads every pending field record + photo, in dependency order (Mortalitas last, since it may
 * depend on a Treatment synced earlier in the SAME run). Safe to call while offline - each network
 * call fails fast and the record is simply left/reset to retry later. */
export async function uploadAll(onProgress?: ProgressListener): Promise<UploadSummary> {
  const det = await uploadKind('detections', onProgress);
  const sen = await uploadKind('sensus', onProgress);
  const trt = await uploadKind('treatments', onProgress);
  const mor = await uploadMortalities(onProgress);
  const parteno = await uploadYieldPartenocarpi();
  const water = await uploadWaterManagement();
  const organik = await uploadBahanOrganik();
  const tbm = await uploadTbmVegetatif();
  const defHara = await uploadDefisiensiHara();
  const agro = await uploadAgroObservations();
  const assessment = await uploadAssessments();
  const actionPlan = await uploadActionPlanUpdates();
  const photos = await uploadPhotos();

  const v2Kinds = [parteno, water, organik, tbm, defHara, agro, assessment, actionPlan];
  const v2Success = v2Kinds.reduce((sum, k) => sum + k.success, 0);
  const v2Failed = v2Kinds.reduce((sum, k) => sum + k.failed, 0);
  const v2Deferred = v2Kinds.reduce((sum, k) => sum + k.deferred, 0);
  const v2Errors = v2Kinds.flatMap((k) => k.errors);

  return {
    totalAttempted:
      det.success + det.failed + sen.success + sen.failed + trt.success + trt.failed + mor.success + mor.failed + v2Success + v2Failed,
    success: det.success + sen.success + trt.success + mor.success + v2Success,
    failed: det.failed + sen.failed + trt.failed + mor.failed + v2Failed,
    deferred: mor.deferred + v2Deferred,
    photosUploaded: photos.uploaded,
    photosFailed: photos.failed,
    errors: [...det.errors, ...sen.errors, ...trt.errors, ...mor.errors, ...v2Errors],
  };
}

export async function getPendingCounts(): Promise<SyncCounts> {
  const [d, s, t, m, yp, wm, bo, tv, dh, ap, agro, assessment] = await Promise.all([
    countByStatus('detections'),
    countByStatus('sensus'),
    countByStatus('treatments'),
    countByStatus('mortalities'),
    countByStatus('yield_partenocarpi'),
    countByStatus('water_management'),
    countByStatus('bahan_organik'),
    countByStatus('tbm_vegetatif'),
    countByStatus('defisiensi_hara_temuan'),
    actionPlanRepo.countPendingActionPlanUpdates(),
    countByStatus('agro_observations'),
    assessmentRepo.countPendingAssessments(),
  ]);
  const pending = (c: Record<string, number>) => (c.READY_TO_SYNC ?? 0) + (c.FAILED ?? 0);
  return {
    deteksi: pending(d),
    sensus: pending(s),
    treatment: pending(t),
    mortalitas: pending(m),
    yieldMaking: pending(yp) + pending(wm) + pending(bo) + pending(tv),
    defisiensiHara: pending(dh),
    actionPlan: ap,
    agroObservation: pending(agro),
    assessment,
  };
}

export { SYNC_MAX_AUTO_RETRY };
