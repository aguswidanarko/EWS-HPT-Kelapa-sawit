import axios from 'axios';

// BRD EWS HPT V3.2.1 section 8 (Dashboard API Configuration) + section 9 (API URL
// Normalization): production must not depend on a localhost/: 4000 fallback, and the base URL
// must not end up as `/api/api` or `//api` if VITE_API_URL is set with (or without) a trailing
// `/api` already.
export function normalizeApiBaseUrl(raw) {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  const match = trimmed.match(/^(https?:\/\/)(.*)$/i);
  const protocol = match ? match[1] : '';
  let rest = (match ? match[2] : trimmed).replace(/\/{2,}/g, '/');
  rest = rest.replace(/(\/api)+$/i, '');
  return `${protocol}${rest}/api`;
}

// BRD section 28 (Environment Management): dashboard dev and LAN production both point at the
// same shared server (10.110.1.9) in this org's workflow - so the fallback matches that instead
// of `localhost:4000`, which section 8 explicitly says production must not rely on. Still fully
// overridable via VITE_API_URL (e.g. for the eventual https://api.domain.com/api deployment).
export const API_URL = normalizeApiBaseUrl(import.meta.env.VITE_API_URL) || 'http://10.110.1.9/api';

const client = axios.create({ baseURL: API_URL });

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('ews_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing = null;

async function doRefresh() {
  const refresh_token = localStorage.getItem('ews_refresh_token');
  if (!refresh_token) throw new Error('no refresh token');
  const res = await axios.post(`${API_URL}/auth/refresh`, { refresh_token });
  const { access_token } = res.data;
  localStorage.setItem('ews_access_token', access_token);
  return access_token;
}

client.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response && error.response.status === 401 && !original._retry && !original.url.includes('/auth/')) {
      original._retry = true;
      try {
        if (!refreshing) refreshing = doRefresh();
        const token = await refreshing;
        refreshing = null;
        original.headers.Authorization = `Bearer ${token}`;
        return client(original);
      } catch {
        refreshing = null;
        localStorage.removeItem('ews_access_token');
        localStorage.removeItem('ews_refresh_token');
        localStorage.removeItem('ews_user');
        window.location.href = '/login';
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export default client;
