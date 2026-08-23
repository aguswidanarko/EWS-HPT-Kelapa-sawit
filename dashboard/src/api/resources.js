import client, { API_URL } from './client';

export const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

export function fileUrl(filePath) {
  if (!filePath) return '';
  if (/^https?:\/\//.test(filePath)) return filePath;
  const clean = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  return `${API_ORIGIN}/${clean}`;
}

const unwrap = (p) => p.then((r) => r.data.data !== undefined ? r.data.data : r.data);
const qs = (params) => {
  if (!params) return '';
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

// ---- Auth ----
export const authApi = {
  login: (email, password) => client.post('/auth/login', { email, password }).then((r) => r.data),
  me: () => unwrap(client.get('/auth/me')),
};

// ---- Dashboard ----
export const dashboardApi = {
  kpi: () => unwrap(client.get('/dashboard/kpi')),
};

// ---- Alerts ----
export const alertsApi = {
  list: (params) => unwrap(client.get(`/alerts${qs(params)}`)),
  get: (id) => unwrap(client.get(`/alerts/${id}`)),
  setStatus: (id, status) => client.put(`/alerts/${id}/status`, { status }).then((r) => r.data),
};

// ---- Incidents ----
export const incidentsApi = {
  list: (params) => unwrap(client.get(`/incidents${qs(params)}`)),
  get: (id) => unwrap(client.get(`/incidents/${id}`)),
};

// ---- GIS ----
export const gisApi = {
  bloks: (params) => unwrap(client.get(`/gis/bloks${qs(params)}`)),
  blok: (id) => unwrap(client.get(`/gis/bloks/${id}`)),
  heatmap: (params) => unwrap(client.get(`/gis/heatmap${qs(params)}`)),
  layers: () => unwrap(client.get('/gis/layers')),
  uploadLayer: (formData) => client.post('/gis/layers/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  previewLayer: (id) => unwrap(client.get(`/gis/layers/${id}/preview`)),
  publishLayer: (id) => client.post(`/gis/layers/${id}/publish`).then((r) => r.data),
};

// ---- Field data ----
export const detectionsApi = {
  list: (params) => unwrap(client.get(`/detections${qs(params)}`)),
  get: (id) => unwrap(client.get(`/detections/${id}`)),
  create: (data) => client.post('/detections', data).then((r) => r.data),
};

export const sensusApi = {
  list: (params) => unwrap(client.get(`/sensus${qs(params)}`)),
  get: (id) => unwrap(client.get(`/sensus/${id}`)),
  plan: (params) => unwrap(client.get(`/sensus/plan${qs(params)}`)),
  create: (data) => client.post('/sensus', data).then((r) => r.data),
};

export const treatmentApi = {
  list: (params) => unwrap(client.get(`/treatment${qs(params)}`)),
  get: (id) => unwrap(client.get(`/treatment/${id}`)),
  create: (data) => client.post('/treatment', data).then((r) => r.data),
  update: (id, data) => client.put(`/treatment/${id}`, data).then((r) => r.data),
};

export const mortalityApi = {
  list: (params) => unwrap(client.get(`/mortality${qs(params)}`)),
  get: (id) => unwrap(client.get(`/mortality/${id}`)),
  create: (data) => client.post('/mortality', data).then((r) => r.data),
};

export const photosApi = {
  list: (params) => unwrap(client.get(`/photos${qs(params)}`)),
  upload: (formData) => client.post('/photos', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
};

// ---- Master data ----
export const masterApi = {
  estates: {
    list: () => unwrap(client.get('/master/estates')),
    create: (d) => client.post('/master/estates', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/estates/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/estates/${id}`).then((r) => r.data),
  },
  afdelings: {
    list: () => unwrap(client.get('/master/afdelings')),
    create: (d) => client.post('/master/afdelings', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/afdelings/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/afdelings/${id}`).then((r) => r.data),
  },
  bloks: {
    list: () => unwrap(client.get('/master/bloks')),
    create: (d) => client.post('/master/bloks', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/bloks/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/bloks/${id}`).then((r) => r.data),
    samplingPlan: (id, metode) => unwrap(client.get(`/master/bloks/${id}/sampling-plan${qs({ metode })}`)),
  },
  hpt: {
    list: () => unwrap(client.get('/master/hpt')),
    create: (d) => client.post('/master/hpt', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/hpt/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/hpt/${id}`).then((r) => r.data),
  },
  species: {
    list: () => unwrap(client.get('/master/species')),
    create: (d) => client.post('/master/species', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/species/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/species/${id}`).then((r) => r.data),
  },
  thresholds: {
    list: (params) => unwrap(client.get(`/master/thresholds${qs(params)}`)),
    create: (d) => client.post('/master/thresholds', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/thresholds/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/thresholds/${id}`).then((r) => r.data),
    active: (params) => unwrap(client.get(`/master/thresholds-active${qs(params)}`)),
  },
  // V2 (SPEC_V2.md section 2): ews_category — umbrella for HPT/YIELD_MAKING/AGRONOMY/DEFISIENSI_HARA.
  ewsCategories: {
    list: () => unwrap(client.get('/master/ews-categories')),
    create: (d) => client.post('/master/ews-categories', d).then((r) => r.data),
    update: (id, d) => client.put(`/master/ews-categories/${id}`, d).then((r) => r.data),
    remove: (id) => client.delete(`/master/ews-categories/${id}`).then((r) => r.data),
  },
};

// ---- V2: Action Plan (SPEC_V2.md section 2 / section 4 Dashboard) ----
export const actionPlansApi = {
  list: (params) => unwrap(client.get(`/action-plans${qs(params)}`)),
  get: (id) => unwrap(client.get(`/action-plans/${id}`)),
  create: (d) => client.post('/action-plans', d).then((r) => r.data),
  update: (id, d) => client.put(`/action-plans/${id}`, d).then((r) => r.data),
  verify: (id, d) => client.put(`/action-plans/${id}/verify`, d).then((r) => r.data),
};

// ---- V2: Yield Making (SPEC_V2.md section 2) ----
function yieldSubApi(path) {
  return {
    list: (params) => unwrap(client.get(`/yield-making/${path}${qs(params)}`)),
    get: (id) => unwrap(client.get(`/yield-making/${path}/${id}`)),
    create: (d) => client.post(`/yield-making/${path}`, d).then((r) => r.data),
  };
}
export const yieldMakingApi = {
  partenocarpi: yieldSubApi('partenocarpi'),
  waterManagement: yieldSubApi('water-management'),
  bahanOrganik: yieldSubApi('bahan-organik'),
  tbmVegetatif: yieldSubApi('tbm-vegetatif'),
};

// ---- V2: Leaf Analysis (Riset) + Defisiensi Hara field findings (SPEC_V2.md section 2) ----
export const leafAnalysisApi = {
  list: (params) => unwrap(client.get(`/leaf-analysis${qs(params)}`)),
  get: (id) => unwrap(client.get(`/leaf-analysis/${id}`)),
  create: (d) => client.post('/leaf-analysis', d).then((r) => r.data),
  update: (id, d) => client.put(`/leaf-analysis/${id}`, d).then((r) => r.data),
};

export const defisiensiHaraApi = {
  list: (params) => unwrap(client.get(`/defisiensi-hara${qs(params)}`)),
  get: (id) => unwrap(client.get(`/defisiensi-hara/${id}`)),
  create: (d) => client.post('/defisiensi-hara', d).then((r) => r.data),
  update: (id, d) => client.put(`/defisiensi-hara/${id}`, d).then((r) => r.data),
};

// ---- V2: Scoring / KPI — SKELETON, always carries placeholder:true + disclaimer from backend
// (SPEC_V2.md section 1 + section 6 acceptance criteria). Do not present as final. ----
export const scoringApi = {
  criteria: {
    list: (params) => client.get(`/scoring/criteria${qs(params)}`).then((r) => r.data),
    create: (d) => client.post('/scoring/criteria', d).then((r) => r.data),
    update: (id, d) => client.put(`/scoring/criteria/${id}`, d).then((r) => r.data),
  },
  entries: {
    list: (params) => client.get(`/scoring/entries${qs(params)}`).then((r) => r.data),
    create: (d) => client.post('/scoring/entries', d).then((r) => r.data),
  },
  summary: (params) => client.get(`/scoring/summary${qs(params)}`).then((r) => r.data),
};

// ---- V2: Rule & Parameter Management — formula + sampling_rule (SPEC_V2.md section 4 Backend) ----
export const formulasApi = {
  list: (params) => unwrap(client.get(`/formulas${qs(params)}`)),
  get: (id) => unwrap(client.get(`/formulas/${id}`)),
  create: (d) => client.post('/formulas', d).then((r) => r.data),
  update: (id, d) => client.put(`/formulas/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/formulas/${id}`).then((r) => r.data),
  preview: (id, payload) => client.post(`/formulas/${id}/preview`, { payload }).then((r) => r.data),
};

export const samplingRulesApi = {
  list: (params) => unwrap(client.get(`/formulas/sampling-rules${qs(params)}`)),
  create: (d) => client.post('/formulas/sampling-rules', d).then((r) => r.data),
  update: (id, d) => client.put(`/formulas/sampling-rules/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/formulas/sampling-rules/${id}`).then((r) => r.data),
};

// ---- V2: Scheduling Rule CRUD + generate (SPEC_V2.md section 1 item 5) ----
export const schedulingRulesApi = {
  list: (params) => unwrap(client.get(`/scheduling-rules${qs(params)}`)),
  create: (d) => client.post('/scheduling-rules', d).then((r) => r.data),
  update: (id, d) => client.put(`/scheduling-rules/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/scheduling-rules/${id}`).then((r) => r.data),
  generateAll: (body) => unwrap(client.post('/scheduling-rules/generate', body || {})),
  generateOne: (id, body) => unwrap(client.post(`/scheduling-rules/${id}/generate`, body || {})),
  overdue: (params) => unwrap(client.get(`/scheduling-rules/overdue${qs(params)}`)),
};

// ---- Knowledge base ----
export const kbApi = {
  list: (params) => unwrap(client.get(`/knowledge-base${qs(params)}`)),
  get: (id) => unwrap(client.get(`/knowledge-base/${id}`)),
  fileUrl: (id) => `${client.defaults.baseURL}/knowledge-base/${id}/file`,
  upload: (formData) => client.post('/knowledge-base', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  newVersion: (id, formData) => client.post(`/knowledge-base/${id}/new-version`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  update: (id, d) => client.put(`/knowledge-base/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/knowledge-base/${id}`).then((r) => r.data),
};

// ---- Users / PIC ----
export const usersApi = {
  roles: () => unwrap(client.get('/users/roles')),
  list: () => unwrap(client.get('/users')),
  create: (d) => client.post('/users', d).then((r) => r.data),
  update: (id, d) => client.put(`/users/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/users/${id}`).then((r) => r.data),
  pic: {
    list: () => unwrap(client.get('/users/pic')),
    create: (d) => client.post('/users/pic', d).then((r) => r.data),
    remove: (id) => client.delete(`/users/pic/${id}`).then((r) => r.data),
  },
};

// ---- Schedule ----
export const scheduleApi = {
  list: (params) => unwrap(client.get(`/schedule${qs(params)}`)),
  create: (d) => client.post('/schedule', d).then((r) => r.data),
  update: (id, d) => client.put(`/schedule/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/schedule/${id}`).then((r) => r.data),
};

// ---- Import ----
export const importApi = {
  templateUrl: (entity) => `${client.defaults.baseURL}/import/template/${entity}`,
  preview: (entity, formData) => client.post(`/import/preview/${entity}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  commit: (entity, body) => client.post(`/import/commit/${entity}`, body).then((r) => r.data),
  log: () => unwrap(client.get('/import/log')),
};

// ---- Import Data: PISP1 monthly recap workbook (pivot-per-Blok format) ----
export const importPisp1Api = {
  preview: (formData) => client.post('/import/pisp1/preview', formData, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data),
  commit: (body) => client.post('/import/pisp1/commit', body).then((r) => r.data),
};

// ---- Reports ----
export const reportsApi = {
  daily: (params) => unwrap(client.get(`/reports/daily${qs(params)}`)),
  monthly: (params) => unwrap(client.get(`/reports/monthly${qs(params)}`)),
  byBlok: (params) => unwrap(client.get(`/reports/by-blok${qs(params)}`)),
  byAfdeling: (params) => unwrap(client.get(`/reports/by-afdeling${qs(params)}`)),
  byEstate: (params) => unwrap(client.get(`/reports/by-estate${qs(params)}`)),
  byHpt: (params) => unwrap(client.get(`/reports/by-hpt${qs(params)}`)),
  trend: (params) => unwrap(client.get(`/reports/trend${qs(params)}`)),
  treatmentService: (params) => unwrap(client.get(`/reports/treatment-service${qs(params)}`)),
  exportUrl: (endpoint, params) => `${client.defaults.baseURL}/reports/${endpoint}${qs(params)}`,
};

// ---- Data quality / sync monitoring / notification rules / audit log ----
export const dataQualityApi = {
  get: () => unwrap(client.get('/data-quality')),
};

export const syncMonitoringApi = {
  summary: () => unwrap(client.get('/sync-monitoring')),
  logs: (params) => unwrap(client.get(`/sync-monitoring/logs${qs(params)}`)),
};

export const notificationRulesApi = {
  list: () => unwrap(client.get('/notification-rules')),
  create: (d) => client.post('/notification-rules', d).then((r) => r.data),
  update: (id, d) => client.put(`/notification-rules/${id}`, d).then((r) => r.data),
  remove: (id) => client.delete(`/notification-rules/${id}`).then((r) => r.data),
  log: (params) => unwrap(client.get(`/notification-rules/log${qs(params)}`)),
};

export const auditLogApi = {
  list: (params) => unwrap(client.get(`/audit-log${qs(params)}`)),
};
