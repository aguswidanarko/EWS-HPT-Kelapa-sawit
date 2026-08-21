import axios from 'axios';

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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
