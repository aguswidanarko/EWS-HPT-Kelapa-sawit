import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from '../config';
import { clearTokens, getAccessToken, getRefreshToken, setAccessToken } from './tokenStore';
import { getDeviceId } from '../utils/device';

export const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 20000,
});

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

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
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
        return http(original);
      }
      await clearTokens();
      authFailureListener?.();
    }
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

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: string } | undefined;
    if (data?.error) return data.error;
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
