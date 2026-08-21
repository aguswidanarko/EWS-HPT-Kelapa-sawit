export const SEVERITY_COLORS = {
  NORMAL: '#22a55a',
  RINGAN: '#eab308',
  SEDANG: '#f97316',
  BERAT: '#dc2626',
  CRITICAL: '#991b1b',
};

export const SEVERITY_LABELS = {
  NORMAL: 'Normal',
  RINGAN: 'Ringan',
  SEDANG: 'Sedang',
  BERAT: 'Berat',
  CRITICAL: 'Critical',
};

export const COLOR_NAME_MAP = {
  hijau: '#22a55a',
  kuning: '#eab308',
  oranye: '#f97316',
  merah: '#dc2626',
};

export function severityColor(sev) {
  return SEVERITY_COLORS[sev] || '#94a3b8';
}

export function severityLabel(sev) {
  return SEVERITY_LABELS[sev] || sev || '-';
}

export const ALERT_STATUS_FLOW = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'CONTROLLED', 'MONITORING', 'CLOSED'];

export const ALERT_STATUS_LABELS = {
  NEW: 'Baru',
  ACKNOWLEDGED: 'Diketahui',
  IN_PROGRESS: 'Diproses',
  CONTROLLED: 'Terkendali',
  MONITORING: 'Monitoring',
  CLOSED: 'Selesai',
};

export function nextAlertStatus(current) {
  const idx = ALERT_STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx === ALERT_STATUS_FLOW.length - 1) return null;
  return ALERT_STATUS_FLOW[idx + 1];
}

export function fmtDate(d) {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d).slice(0, 10);
    return dt.toLocaleDateString('id-ID', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch {
    return String(d);
  }
}

export function fmtDateTime(d) {
  if (!d) return '-';
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return String(d);
    return dt.toLocaleString('id-ID', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(d);
  }
}

export function fmtNum(n, digits = 2) {
  if (n === null || n === undefined || n === '') return '-';
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return Number.isInteger(num) ? String(num) : num.toFixed(digits);
}

export function safeJsonParse(v, fallback = null) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}
