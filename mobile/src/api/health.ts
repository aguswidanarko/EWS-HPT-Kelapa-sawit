// BRD EWS HPT V3.2.1 sections 10-12 (Mobile Connectivity Status / Server Connectivity Test / API
// Diagnostic Test). Deliberately separate from api/client.ts's `http` instance:
// - GET /health lives OUTSIDE /api (see backend/src/app.js), so it needs the origin, not
//   API_BASE_URL (which already has /api appended).
// - Both checks use a short, fixed timeout and never go through the auth-refresh interceptor -
//   a connectivity test must fail fast and must not itself trigger a token refresh loop.

import axios from 'axios';
import { API_BASE_URL } from '../config';

/** API_BASE_URL is e.g. "http://10.110.1.9/api" - health lives at "http://10.110.1.9/health". */
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/i, '');

const HEALTH_TIMEOUT_MS = 8000;

export interface ServerHealthResult {
  ok: boolean;
  status?: string;
  service?: string;
  time?: string;
  /** Round-trip time in ms, useful for the "Response: OK (312ms)" style detail BRD section 11
   * shows. */
  latencyMs?: number;
  error?: string;
}

/** BRD section 11 "Tes Koneksi Server": GET /health, no auth required. Used both for the
 * user-triggered connectivity test button and for the background tri-state connectivity check
 * (see state/NetContext.tsx). */
export async function checkServerHealth(): Promise<ServerHealthResult> {
  const startedAt = Date.now();
  try {
    const res = await axios.get(`${API_ORIGIN}/health`, { timeout: HEALTH_TIMEOUT_MS });
    return {
      ok: res.data?.status === 'ok',
      status: res.data?.status,
      service: res.data?.service,
      time: res.data?.time,
      latencyMs: Date.now() - startedAt,
    };
  } catch (e) {
    const message = axios.isAxiosError(e) ? e.message : e instanceof Error ? e.message : String(e);
    return { ok: false, error: message, latencyMs: Date.now() - startedAt };
  }
}

export interface ApiDiagnosticResult {
  backendReachable: boolean;
  apiOk: boolean;
  databaseOk: boolean;
  authOk: boolean | 'N/A';
  error?: string;
}

/** BRD section 12 "Tes API": distinguishes "server is up" (checkServerHealth/GET /health) from
 * "the application API actually works" (GET /api/sync/status, which touches the DB and - since
 * it's behind requireAuth - also proves the caller's token is valid). Callers pass the
 * authenticated axios instance (api/client.ts's `http`) so this reuses the current session. */
export async function checkApiDiagnostic(http: { get: (url: string, config?: any) => Promise<{ data: unknown }> }): Promise<ApiDiagnosticResult> {
  const health = await checkServerHealth();
  if (!health.ok) {
    return { backendReachable: false, apiOk: false, databaseOk: false, authOk: 'N/A', error: health.error };
  }
  try {
    await http.get('/sync/status');
    return { backendReachable: true, apiOk: true, databaseOk: true, authOk: true };
  } catch (e) {
    const status = axios.isAxiosError(e) ? e.response?.status : undefined;
    if (status === 401) {
      // Server + API + DB all fine - only auth failed, which is exactly the distinction BRD
      // section 12 asks for ("Authentication sesuai kebutuhan").
      return { backendReachable: true, apiOk: true, databaseOk: true, authOk: false };
    }
    const message = axios.isAxiosError(e) ? e.message : e instanceof Error ? e.message : String(e);
    return { backendReachable: true, apiOk: false, databaseOk: false, authOk: 'N/A', error: message };
  }
}
