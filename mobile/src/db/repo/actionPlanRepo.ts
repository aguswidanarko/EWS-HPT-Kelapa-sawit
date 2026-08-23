// Action Plan (SPEC_V2.md section 2/4): cached_action_plans (read-only list assigned to this user
// as PIC, downloaded like cached_incidents) + action_plan_updates (offline-queued edits against an
// existing server row - see types.ts LocalActionPlanUpdate docstring for why this isn't a "create").

import { getDb, withTransaction } from '../database';
import type { CachedActionPlan, LocalActionPlanUpdate } from '../../types';

// ---------------------------------------------------------------- cached_action_plans
export async function saveCachedActionPlans(rows: CachedActionPlan[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM cached_action_plans');
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO cached_action_plans (
          id, local_id, server_id, incident_id, alert_id, problem, recommendation, actual_action,
          pic_user_id, due_date, status, evidence_photo_id, verification_note, verified_by_user_id,
          verified_at, overdue, escalated, related_leaf_analysis_id, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?)`,
        [
          r.id, r.local_id, r.server_id, r.incident_id, r.alert_id, r.problem, r.recommendation, r.actual_action,
          r.pic_user_id, r.due_date, r.status, r.evidence_photo_id, r.verification_note, r.verified_by_user_id,
          r.verified_at, r.overdue, r.escalated, r.related_leaf_analysis_id, r.created_at, r.updated_at,
        ]
      );
    }
  });
}
export async function getCachedActionPlans(): Promise<CachedActionPlan[]> {
  const db = await getDb();
  return db.getAllAsync<CachedActionPlan>('SELECT * FROM cached_action_plans ORDER BY due_date IS NULL, due_date, created_at DESC');
}
export async function getCachedActionPlanById(id: number): Promise<CachedActionPlan | null> {
  const db = await getDb();
  return (await db.getFirstAsync<CachedActionPlan>('SELECT * FROM cached_action_plans WHERE id = ?', [id])) ?? null;
}
/** Applies a synced/local update onto the cached row immediately, so the list reflects the change
 * without waiting for the next full download - mirrors how Riwayat shows READY_TO_SYNC items now. */
export async function patchCachedActionPlan(id: number, patch: { status?: string | null; actual_action?: string | null }): Promise<void> {
  const db = await getDb();
  const fields = Object.keys(patch) as (keyof typeof patch)[];
  if (!fields.length) return;
  const setSql = fields.map((f) => `${f} = ?`).join(', ');
  await db.runAsync(`UPDATE cached_action_plans SET ${setSql} WHERE id = ?`, [...fields.map((f) => patch[f] ?? null), id]);
}

// ---------------------------------------------------------------- action_plan_updates (offline queue)
export async function insertActionPlanUpdate(row: LocalActionPlanUpdate): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO action_plan_updates (
      local_id, action_plan_id, status, actual_action, foto_local_id, evidence_photo_id,
      user_id, device_id, created_at, updated_at, sync_status, sync_attempt, sync_error, source
    ) VALUES (?,?,?,?,?,?, ?,?,?,?,?,?,?,?)`,
    [
      row.local_id, row.action_plan_id, row.status, row.actual_action, row.foto_local_id, row.evidence_photo_id,
      row.user_id, row.device_id, row.created_at, row.updated_at, row.sync_status, row.sync_attempt, row.sync_error, row.source,
    ]
  );
}
export async function listActionPlanUpdates(limit = 200): Promise<LocalActionPlanUpdate[]> {
  const db = await getDb();
  return db.getAllAsync<LocalActionPlanUpdate>('SELECT * FROM action_plan_updates ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getActionPlanUpdateByLocalId(localId: string): Promise<LocalActionPlanUpdate | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalActionPlanUpdate>('SELECT * FROM action_plan_updates WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyActionPlanUpdates(): Promise<LocalActionPlanUpdate[]> {
  const db = await getDb();
  return db.getAllAsync<LocalActionPlanUpdate>(
    "SELECT * FROM action_plan_updates WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at"
  );
}
/** Latest pending/failed local update queued for a given action plan, if any - used so the form
 * shows "you already have an unsynced change queued" instead of silently stacking duplicates. */
export async function getLatestPendingUpdateFor(actionPlanId: number): Promise<LocalActionPlanUpdate | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<LocalActionPlanUpdate>(
      "SELECT * FROM action_plan_updates WHERE action_plan_id = ? AND sync_status IN ('READY_TO_SYNC','FAILED','SYNCING') ORDER BY created_at DESC",
      [actionPlanId]
    )) ?? null
  );
}

// ---------------------------------------------------------------- syncCommon-compatible helpers
// action_plan_updates doesn't fit db/repo/syncCommon.ts's FieldTable contract (it has no server_id/
// server_row_id/incident_id of its own - it targets an EXISTING action_plan row), so its handful of
// status transitions live here instead, following the exact same state semantics.
export async function markActionPlanUpdateSyncing(localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE action_plan_updates SET sync_status = 'SYNCING' WHERE local_id = ?`, [localId]);
}
export async function markActionPlanUpdateSynced(localId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE action_plan_updates SET sync_status = 'SYNCED', sync_error = NULL, updated_at = ? WHERE local_id = ?`,
    [new Date().toISOString(), localId]
  );
}
export async function markActionPlanUpdateFailed(localId: string, error: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE action_plan_updates SET sync_status = 'FAILED', sync_attempt = sync_attempt + 1, sync_error = ?, updated_at = ? WHERE local_id = ?`,
    [error, new Date().toISOString(), localId]
  );
}
export async function countPendingActionPlanUpdates(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM action_plan_updates WHERE sync_status IN ('READY_TO_SYNC','FAILED')"
  );
  return row?.c ?? 0;
}
