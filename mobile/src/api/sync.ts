// Thin wrappers around the backend's Mobile Sync API (BRD 02 section 49 / backend/README.md
// section 10 "Mobile Sync API"). Kept free of any local-DB knowledge - the sync engine
// (state/syncEngine.ts) is responsible for turning these responses into SQLite writes.

import { http } from './client';
import { getDeviceId } from '../utils/device';
import type {
  Afdeling,
  Blok,
  CachedIncident,
  Estate,
  Hpt,
  KnowledgeBaseEntry,
  ScheduleItem,
  Species,
  ThresholdRow,
} from '../types';

export interface MasterDownload {
  estates: Estate[];
  afdelings: Afdeling[];
  bloks: Blok[];
  hpt: Hpt[];
  species: Species[];
}

export async function downloadMaster(): Promise<MasterDownload> {
  const res = await http.get<{ data: MasterDownload; synced_at: string }>('/sync/master');
  return res.data.data;
}

export async function downloadThreshold(): Promise<ThresholdRow[]> {
  const res = await http.get<{ data: ThresholdRow[] }>('/sync/threshold');
  return res.data.data;
}

export async function downloadKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  const res = await http.get<{ data: KnowledgeBaseEntry[] }>('/sync/knowledge-base');
  return res.data.data;
}

export async function downloadJadwal(): Promise<ScheduleItem[]> {
  const res = await http.get<{ data: ScheduleItem[] }>('/sync/jadwal');
  return res.data.data;
}

/** Not in the mobile sync namespace per se, but any authenticated user may read it - used to
 * cache open incidents locally so Pengendalian/Mortalitas can link incident_id even offline. */
export async function downloadOpenIncidents(): Promise<CachedIncident[]> {
  const res = await http.get<{ data: (CachedIncident & { hpt_name?: string; blok_code?: string })[] }>(
    '/incidents',
    { params: { status: undefined } }
  );
  return res.data.data.filter((i) => i.status !== 'CLOSED');
}

export interface BatchUploadResultItem {
  local_id: string;
  server_id?: string;
  id?: number;
  status: 'SYNCED' | 'VERSIONED_UPDATE' | 'FAILED';
  conflict?: boolean;
  error?: string;
}
export interface BatchUploadResponse {
  data: BatchUploadResultItem[];
  summary: { total: number; success: number; failed: number };
  sync_log_id: number;
}

export type UploadKind = 'deteksi' | 'sensus' | 'treatment' | 'mortalitas';

export async function uploadBatch(kind: UploadKind, items: Record<string, unknown>[]): Promise<BatchUploadResponse> {
  const device_id = await getDeviceId();
  const res = await http.post<BatchUploadResponse>(`/sync/upload/${kind}`, { device_id, items });
  return res.data;
}

export interface UploadPhotoParams {
  fileUri: string;
  fileName: string;
  mimeType: string;
  entity_type: 'DETECTION' | 'SENSUS' | 'TREATMENT' | 'MORTALITY';
  entity_id: number; // server-side numeric id (only upload once the parent record has synced)
  gps_lat?: number | null;
  gps_lng?: number | null;
  timestamp?: string;
}

export async function uploadPhoto(params: UploadPhotoParams): Promise<{ id: number }> {
  const form = new FormData();
  // React Native's FormData accepts this {uri,name,type} shape for file fields.
  form.append('file', { uri: params.fileUri, name: params.fileName, type: params.mimeType } as unknown as Blob);
  form.append('entity_type', params.entity_type);
  form.append('entity_id', String(params.entity_id));
  if (params.gps_lat !== undefined && params.gps_lat !== null) form.append('gps_lat', String(params.gps_lat));
  if (params.gps_lng !== undefined && params.gps_lng !== null) form.append('gps_lng', String(params.gps_lng));
  if (params.timestamp) form.append('timestamp', params.timestamp);
  const res = await http.post<{ data: { id: number } }>('/sync/upload/foto', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

/** Best-effort post-sync enrichment: the batch upload response doesn't include the server-created
 * incident_id (see backend/src/routes/sync.js makeBatchHandler - it only echoes local_id/server_id/
 * status/id), so once a Deteksi/Sensus item is SYNCED we fetch its detail once to learn the real
 * (server-authoritative) incident_id + kategori, so Pengendalian/Mortalitas can link to it later
 * even while offline. Never blocks/fails the sync run if this call errors. */
export async function fetchRecordDetail(
  kind: 'deteksi' | 'sensus',
  id: number
): Promise<{ incident_id: number | null; kategori: string | null; ews_alert: number } | null> {
  const path = kind === 'deteksi' ? `/detections/${id}` : `/sensus/${id}`;
  const res = await http.get<{ data: { incident_id: number | null; kategori: string | null; ews_alert: number } }>(path);
  return res.data.data;
}

export interface SyncStatusResponse {
  last_sync: { started_at: string; finished_at: string | null; success_count: number; failed_count: number } | null;
  pending: { deteksi: number; sensus: number; treatment: number; mortalitas: number };
  pending_total: number;
}

export async function fetchSyncStatus(): Promise<SyncStatusResponse> {
  const device_id = await getDeviceId();
  const res = await http.get<{ data: SyncStatusResponse }>('/sync/status', { params: { device_id } });
  return res.data.data;
}
