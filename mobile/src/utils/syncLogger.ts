// BRD EWS HPT V3.2.1 section 21 (Logging Mobile): "untuk troubleshooting, Sync Engine harus
// mencatat: timestamp, operation, endpoint, record_id, status, HTTP status, error code, retry
// count, duration". Wired in at the HTTP layer (api/client.ts's interceptors) rather than inside
// every individual sync/engine.ts upload* function, so every request the sync engine makes is
// covered by one instrumentation point instead of ~15 call sites each needing the same
// boilerplate. `retry_count` here is the sync engine's per-request 401-refresh retry (see
// client.ts's `_retry` flag), which is different from (and does not replace) the per-record
// `sync_attempt` counter already persisted in SQLite (db/schema.ts) and shown in Sync Center.
//
// Logs to the console (visible via `adb logcat` / Metro/Flipper) rather than a new file or remote
// sink - this is a stabilization release, not an observability-infra change; a future release can
// swap `console.log` here for a real log file / remote log shipper without touching call sites.

export type SyncOperation = 'DOWNLOAD' | 'UPLOAD' | 'AUTH' | 'OTHER';
export type SyncLogStatus = 'SUCCESS' | 'ERROR';

export interface SyncLogEntry {
  timestamp: string;
  operation: SyncOperation;
  endpoint: string;
  record_id?: string | number | null;
  status: SyncLogStatus;
  http_status?: number | null;
  error_code?: string | null;
  retry_count?: number;
  duration_ms: number;
}

export function operationForRequest(method: string | undefined, url: string | undefined): SyncOperation {
  const path = url || '';
  if (path.includes('/auth/')) return 'AUTH';
  if (/^get$/i.test(method || '') && path.includes('/sync/')) return 'DOWNLOAD';
  if (/^post$/i.test(method || '') && path.includes('/sync/upload')) return 'UPLOAD';
  return 'OTHER';
}

/** Tries to pull a record id out of a typical `{ data: { id, server_id, ... } }` or `{ data: [...
 * {id}] }` response shape, purely best-effort for the log line - never throws. */
export function extractRecordId(responseData: unknown): string | number | null {
  try {
    const data = (responseData as { data?: unknown } | undefined)?.data;
    if (Array.isArray(data)) {
      const ids = data.map((d) => (d as { server_id?: string; id?: number })?.server_id ?? (d as { id?: number })?.id).filter(Boolean);
      return ids.length ? String(ids.length) + ' items' : null;
    }
    const single = data as { server_id?: string; id?: number } | undefined;
    return single?.server_id ?? single?.id ?? null;
  } catch {
    return null;
  }
}

export function logSyncEntry(entry: SyncLogEntry) {
  // eslint-disable-next-line no-console
  console.log(`[sync] ${JSON.stringify(entry)}`);
}
