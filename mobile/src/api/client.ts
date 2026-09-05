import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config';
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken } from './tokenStore';
import { getDeviceId } from '../utils/device';
import { extractRecordId, logSyncEntry, operationForRequest } from '../utils/syncLogger';

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

// BRD EWS HPT V3.2.1 section 21 (Logging Mobile): timestamp/operation/endpoint/duration for every
// request the sync engine makes - see utils/syncLogger.ts's header comment for why this lives at
// the interceptor level. Request start times are tracked by a WeakMap (rather than a custom field
// on AxiosRequestConfig, which would need a module augmentation) keyed by the config object
// itself, which axios guarantees is the same reference passed to both the request interceptor and
// the matching response/error interceptor.
type RequestConfigWithRetry = InternalAxiosRequestConfig & { _retry?: boolean };
const requestStartedAt = new WeakMap<object, number>();

/** Called when the refresh token itself is rejected (expired/invalid) - forces the user back to
 * the login screen. Wired up by AuthContext at app start. */
type AuthFailureListener = () => void;
let authFailureListener: AuthFailureListener | null = null;
export function onAuthFailure(listener: AuthFailureListener) {
  authFailureListener = listener;
}

http.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  const deviceId = await getDeviceId();
  config.headers.set('X-Device-Id', deviceId);
  config.headers.set('X-Source', 'MOBILE');
  requestStartedAt.set(config, Date.now());
  return config;
});

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh_token = await getRefreshToken();
  if (!refresh_token) return null;
  try {
    const res = await axios.post(`${API_BASE_URL}/auth/refresh`, { refresh_token }, { timeout: 20000 });
    const newAccess = res.data.access_token as string;
    await setAccessToken(newAccess);
    return newAccess;
  } catch {
    return null;
  }
}

/** BRD EWS HPT V3.2.1 section 21: emits one [sync] log line per finished request (success or
 * error) - see utils/syncLogger.ts. Reads the start time stamped by the request interceptor;
 * silently skips logging if that's missing for any reason (never let logging break a request). */
function logRequestOutcome(config: InternalAxiosRequestConfig | undefined, opts: {
  status: 'SUCCESS' | 'ERROR';
  httpStatus?: number | null;
  errorCode?: string | null;
  responseData?: unknown;
  retryCount?: number;
}) {
  if (!config) return;
  const startedAt = requestStartedAt.get(config);
  if (startedAt === undefined) return;
  requestStartedAt.delete(config);
  logSyncEntry({
    timestamp: new Date().toISOString(),
    operation: operationForRequest(config.method, config.url),
    endpoint: config.url || '',
    record_id: extractRecordId(opts.responseData),
    status: opts.status,
    http_status: opts.httpStatus ?? null,
    error_code: opts.errorCode ?? null,
    retry_count: opts.retryCount ?? 0,
    duration_ms: Date.now() - startedAt,
  });
}

http.interceptors.response.use(
  (res) => {
    logRequestOutcome(res.config, { status: 'SUCCESS', httpStatus: res.status, responseData: res.data });
    return res;
  },
  async (error: AxiosError) => {
    const original = error.config as RequestConfigWithRetry | undefined;
    if (error.response?.status === 401 && original && !original._retry && !original.url?.includes('/auth/')) {
      original._retry = true;
      if (!refreshInFlight) {
        refreshInFlight = refreshAccessToken().finally(() => {
          refreshInFlight = null;
        });
      }
      const newToken = await refreshInFlight;
      if (newToken) {
        original.headers = original.headers ?? ({} as InternalAxiosRequestConfig['headers']);
        original.headers.set('Authorization', `Bearer ${newToken}`);
        logRequestOutcome(original, { status: 'ERROR', httpStatus: error.response?.status, errorCode: 'AUTH_ERROR', retryCount: 1 });
        return http(original);
      }
      await clearTokens();
      authFailureListener?.();
    }
    logRequestOutcome(original, {
      status: 'ERROR',
      httpStatus: error.response?.status ?? null,
      errorCode: getErrorCategory(error),
      retryCount: original?._retry ? 1 : 0,
    });
    return Promise.reject(error);
  }
);

/** True if `error` looks like "no network" rather than an authenticated-but-rejected request -
 * used by the sync engine to decide whether to flip the connection pill to Offline vs report a
 * per-item FAILED sync error. */
export function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response;
}

/** BRD EWS HPT V3.2.1 section 19 (API Error Standardization) category codes, plus the
 * client-only NETWORK_ERROR (the backend can never emit this one - if it responded at all, the
 * network worked). See backend/src/middleware/errorHandler.js's header comment for why the
 * backend still sends `error` as a plain string (not the BRD's literal `{code,message}` object)
 * alongside the new `error_code` field this reads. */
export type ErrorCategory =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'DUPLICATE_ERROR'
  | 'SERVER_ERROR'
  | 'DATABASE_ERROR'
  | 'UNKNOWN';

/** Categorizes an error the same way section 19/20 do, for callers that need to branch on it
 * (e.g. choosing whether "Coba Lagi" should retry immediately vs prompt the user to check their
 * network first). */
export function getErrorCategory(error: unknown): ErrorCategory {
  if (isNetworkError(error)) return 'NETWORK_ERROR';
  if (axios.isAxiosError(error)) {
    const code = (error.response?.data as { error_code?: string } | undefined)?.error_code;
    if (code) return code as ErrorCategory;
    const status = error.response?.status;
    if (status === 401 || status === 403) return 'AUTH_ERROR';
    if (status === 404) return 'NOT_FOUND';
    if (status === 409) return 'DUPLICATE_ERROR';
    if (status && status >= 500) return 'SERVER_ERROR';
    if (status && status >= 400) return 'VALIDATION_ERROR';
  }
  return 'UNKNOWN';
}

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/** BRD EWS HPT V3.2.1 section 20 (Error Message Mobile): a raw "Network request failed" (or
 * similarly technical Express/axios message) must never be the only thing shown to a field
 * officer. Maps the error category to the exact Indonesian copy BRD section 20 specifies;
 * falls back to the technical message for categories BRD didn't script one for, so nothing is
 * ever silently hidden. */
export function friendlyErrorMessage(error: unknown): string {
  const category = getErrorCategory(error);
  switch (category) {
    case 'NETWORK_ERROR':
      return 'Server tidak dapat dihubungi.\n\nPeriksa:\n1. Koneksi WiFi\n2. Pastikan berada pada jaringan EWS HPT\n3. Pastikan server aktif';
    case 'AUTH_ERROR':
      return apiErrorMessage(error) || 'Login gagal.\n\nUsername atau password tidak valid.';
    case 'SERVER_ERROR':
    case 'DATABASE_ERROR':
      return 'Server EWS HPT tidak dapat dihubungi.';
    default:
      return apiErrorMessage(error);
  }
}
