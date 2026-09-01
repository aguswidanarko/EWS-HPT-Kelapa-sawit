// V3.1 Universal Assessment Form local storage. Doesn't reuse db/repo/syncCommon.ts's FieldTable
// contract (like actionPlanRepo.ts's action_plan_updates) since the sync result shape is a whole
// array of calculation results, not one kategori/ews_alert pair - see types.ts's LocalAssessment.

import { getDb } from '../database';
import type { LocalAssessment, CalculationResultSummary } from '../../types';

export async function insertAssessment(row: LocalAssessment): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO assessments (
      local_id, server_id, server_row_id, assessment_code, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, planting_stage, baris, sampling_method, sample_count,
      tanggal, waktu_mulai, waktu_selesai,
      gps_lat, gps_lng, gps_accuracy, location_warning, catatan, petugas,
      trees_json, area_json, water_json, calc_summary_json
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?, ?,?,?, ?,?,?,?,?,?, ?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.assessment_code, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.planting_stage, row.baris, row.sampling_method, row.sample_count,
      row.tanggal, row.waktu_mulai, row.waktu_selesai,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.location_warning, row.catatan, row.petugas,
      row.trees_json, row.area_json, row.water_json, row.calc_summary_json,
    ]
  );
}

export async function listAssessments(limit = 200): Promise<LocalAssessment[]> {
  const db = await getDb();
  return db.getAllAsync<LocalAssessment>('SELECT * FROM assessments ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getAssessmentByLocalId(localId: string): Promise<LocalAssessment | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalAssessment>('SELECT * FROM assessments WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadyAssessments(): Promise<LocalAssessment[]> {
  const db = await getDb();
  return db.getAllAsync<LocalAssessment>("SELECT * FROM assessments WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

export async function countTodayAssessments(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM assessments WHERE tanggal = ?', [todayIso]);
  return row?.c ?? 0;
}

export async function markSyncing(localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE assessments SET sync_status = 'SYNCING' WHERE local_id = ?`, [localId]);
}

export async function markSynced(
  localId: string,
  serverId: string,
  serverRowId: number | null,
  assessmentCode: string | null,
  calcResults: CalculationResultSummary[]
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE assessments SET sync_status = 'SYNCED', server_id = ?, server_row_id = COALESCE(?, server_row_id),
     assessment_code = COALESCE(?, assessment_code), calc_summary_json = ?, sync_error = NULL, updated_at = ? WHERE local_id = ?`,
    [serverId, serverRowId, assessmentCode, JSON.stringify(calcResults), new Date().toISOString(), localId]
  );
}

export async function markDeferred(localId: string, note: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE assessments SET sync_status = 'READY_TO_SYNC', sync_error = ? WHERE local_id = ?`, [note, localId]);
}

export async function markFailed(localId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE assessments SET sync_status = 'FAILED', sync_attempt = sync_attempt + 1, sync_error = ?, updated_at = ? WHERE local_id = ?`,
    [error, new Date().toISOString(), localId]
  );
}

export async function countPendingAssessments(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM assessments WHERE sync_status IN ('READY_TO_SYNC','FAILED')`
  );
  return row?.c ?? 0;
}
