// Thin wrappers for the SPEC_V2.md backend modules that talk directly to their own REST resources
// instead of the V1 batch Mobile Sync API (routes/sync.js) - see the "Backend sync contract" note
// in sync/engine.ts for WHY: routes/sync.js's /sync/upload/* is hard-coded to
// {deteksi,sensus,treatment,mortalitas} (TABLE_BY_KIND), it was not generalized for V2 entities.
// yieldMaking.js/defisiensiHara.js/actionPlans.js instead expose ordinary single-record REST
// endpoints (POST creates one row, PUT edits one row) - so each V2 upload in sync/engine.ts posts
// one record at a time here rather than batching, but is still queued/retried locally exactly like
// every V1 kind (DRAFT -> READY_TO_SYNC -> SYNCING -> SYNCED/FAILED).

import { http } from './client';
import type { CachedActionPlan, CachedLeafAnalysis, SamplingRuleRow } from '../types';

// ---------------------------------------------------------------- Yield Making (create)
export type YieldMakingSubpath = 'partenocarpi' | 'water-management' | 'bahan-organik' | 'tbm-vegetatif';

export interface YieldMakingCreateResult {
  data: Record<string, unknown> & { id: number; server_id: string };
  classification: { kategori: string | null; ews_alert: boolean; classify_note?: string | null };
  location_warning: boolean;
}

export async function createYieldMakingRecord(
  subpath: YieldMakingSubpath,
  payload: Record<string, unknown>
): Promise<YieldMakingCreateResult> {
  const res = await http.post<YieldMakingCreateResult>(`/yield-making/${subpath}`, payload);
  return res.data;
}

// ---------------------------------------------------------------- Defisiensi Hara
export interface DefisiensiHaraCreateResult {
  data: Record<string, unknown> & { id: number; server_id: string };
  location_warning: boolean;
}

export async function createDefisiensiHaraTemuan(payload: Record<string, unknown>): Promise<DefisiensiHaraCreateResult> {
  const res = await http.post<DefisiensiHaraCreateResult>('/defisiensi-hara', payload);
  return res.data;
}

/** Read-only reference list (Riset's lab findings) - see routes/leafAnalysis.js. Only ever GET'd,
 * mobile never writes to this. */
export async function downloadLeafAnalysis(): Promise<CachedLeafAnalysis[]> {
  const res = await http.get<{ data: CachedLeafAnalysis[] }>('/leaf-analysis');
  return res.data.data;
}

// ---------------------------------------------------------------- Action Plan
/** Only the plans where the logged-in user is PIC - matches SPEC_V2.md section 4 Mobile
 * "ActionPlanScreen: list task ... assigned to this user". */
export async function downloadAssignedActionPlans(picUserId: number): Promise<CachedActionPlan[]> {
  const res = await http.get<{ data: CachedActionPlan[] }>('/action-plans', { params: { pic_user_id: picUserId } });
  return res.data.data;
}

export interface ActionPlanUpdatePayload {
  status?: string;
  actual_action?: string;
  evidence_photo_id?: number;
}

export async function updateActionPlan(id: number, payload: ActionPlanUpdatePayload): Promise<{ data: CachedActionPlan }> {
  const res = await http.put<{ data: CachedActionPlan }>(`/action-plans/${id}`, payload);
  return res.data;
}

// ---------------------------------------------------------------- Sampling Rule (Sampling Assistant)
export async function downloadSamplingRules(): Promise<SamplingRuleRow[]> {
  const res = await http.get<{ data: SamplingRuleRow[] }>('/formulas/sampling-rules');
  return res.data.data;
}
