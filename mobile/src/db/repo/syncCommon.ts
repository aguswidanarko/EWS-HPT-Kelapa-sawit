// Shared sync-envelope operations for the four field-record tables (detections/sensus/treatments/
// mortalities). They all carry the exact same envelope columns (local_id, server_id, activity_id,
// incident_id, user_id, device_id, created_at, updated_at, sync_status, sync_attempt, sync_error,
// source - BRD 01 section 8), so the status-transition logic lives here once instead of 4x.

import { getDb } from '../database';
import type { SyncStatus } from '../../types';

// V2 (SPEC_V2.md section 2 closing note) tables reuse this exact same envelope shape (server_id/
// server_row_id/incident_id/sync_status/sync_attempt/sync_error/updated_at), so every function
// below works unmodified for them too - no separate V2 sync-common module needed.
export type FieldTable =
  | 'detections'
  | 'sensus'
  | 'treatments'
  | 'mortalities'
  | 'yield_partenocarpi'
  | 'water_management'
  | 'bahan_organik'
  | 'tbm_vegetatif'
  | 'defisiensi_hara_temuan'
  | 'agro_observations';

export async function markSyncing(table: FieldTable, localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE ${table} SET sync_status = 'SYNCING' WHERE local_id = ?`, [localId]);
}

export async function markSynced(
  table: FieldTable,
  localId: string,
  serverId: string,
  serverRowId: number | null,
  incidentId: number | null
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE ${table} SET sync_status = 'SYNCED', server_id = ?, server_row_id = COALESCE(?, server_row_id), incident_id = COALESCE(?, incident_id), sync_error = NULL, updated_at = ? WHERE local_id = ?`,
    [serverId, serverRowId, incidentId, new Date().toISOString(), localId]
  );
}

export async function updateIncidentId(table: FieldTable, localId: string, incidentId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE ${table} SET incident_id = ? WHERE local_id = ?`, [incidentId, localId]);
}

/** Marks a record as still-pending-but-blocked (e.g. Mortalitas waiting on its Treatment's server
 * id) without incrementing sync_attempt or flipping status away from READY_TO_SYNC - it's not a
 * failure, just a dependency that will resolve on a later sync run. */
export async function markDeferred(table: FieldTable, localId: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE ${table} SET sync_status = 'READY_TO_SYNC', sync_error = ? WHERE local_id = ?`, [note, localId]);
}

export async function markFailed(table: FieldTable, localId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE ${table} SET sync_status = 'FAILED', sync_attempt = sync_attempt + 1, sync_error = ?, updated_at = ? WHERE local_id = ?`,
    [error, new Date().toISOString(), localId]
  );
}

/** Re-queues a FAILED (or DRAFT) record for another sync attempt without resetting its history. */
export async function requeue(table: FieldTable, localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE ${table} SET sync_status = 'READY_TO_SYNC', sync_error = NULL WHERE local_id = ?`, [localId]);
}

export async function countByStatus(table: FieldTable): Promise<Record<SyncStatus, number>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ sync_status: SyncStatus; c: number }>(
    `SELECT sync_status, COUNT(*) as c FROM ${table} GROUP BY sync_status`
  );
  const out: Record<SyncStatus, number> = { DRAFT: 0, READY_TO_SYNC: 0, SYNCING: 0, SYNCED: 0, FAILED: 0 };
  for (const r of rows) out[r.sync_status] = r.c;
  return out;
}

export async function countPending(table: FieldTable): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM ${table} WHERE sync_status IN ('READY_TO_SYNC','FAILED')`
  );
  return row?.c ?? 0;
}

/** V2 yield-making tables don't carry a local formula engine (SPEC_V2.md's generic rule engine
 * lives server-side only - see services/ruleEngine.js), so kategori_lokal/ews_alert_lokal start
 * NULL/0 at insert time and are back-filled from the server's `classification` response once the
 * record actually syncs, purely for the Riwayat/local-alert list to have something to show. */
export async function updateClassification(
  table: 'yield_partenocarpi' | 'water_management' | 'bahan_organik' | 'tbm_vegetatif' | 'agro_observations',
  localId: string,
  kategori: string | null,
  ewsAlert: boolean
): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE ${table} SET kategori_lokal = ?, ews_alert_lokal = ? WHERE local_id = ?`, [
    kategori,
    ewsAlert ? 1 : 0,
    localId,
  ]);
}
