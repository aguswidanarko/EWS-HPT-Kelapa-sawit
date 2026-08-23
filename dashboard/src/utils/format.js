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

// V2 (SPEC_V2.md section 1 item 6): alert/incident status flow expanded from 6 to 7 states.
// Migration mapping applied server-side once: CONTROLLED->COMPLETED, MONITORING->VERIFIED.
export const ALERT_STATUS_FLOW = ['NEW', 'ACKNOWLEDGED', 'ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];

export const ALERT_STATUS_LABELS = {
  NEW: 'Baru',
  ACKNOWLEDGED: 'Diketahui',
  ACTION_REQUIRED: 'Perlu Tindakan',
  IN_PROGRESS: 'Diproses',
  COMPLETED: 'Selesai',
  VERIFIED: 'Terverifikasi',
  CLOSED: 'Ditutup',
  // Legacy V1 values, kept only as a harmless display fallback for any stray unmigrated record.
  CONTROLLED: 'Terkendali (lama)',
  MONITORING: 'Monitoring (lama)',
  // Shared with StatusBadge for other status vocabularies used across the app (Action Plan,
  // Schedule) so labels read in Indonesian instead of falling back to the raw enum value.
  OPEN: 'Terbuka',
  PLANNED: 'Direncanakan',
  RENCANA: 'Rencana',
  BERJALAN: 'Berjalan',
  SELESAI: 'Selesai',
  DIBATALKAN: 'Dibatalkan',
};

export function nextAlertStatus(current) {
  const idx = ALERT_STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx === ALERT_STATUS_FLOW.length - 1) return null;
  return ALERT_STATUS_FLOW[idx + 1];
}

// Action Plan status flow (SPEC_V2.md section 2) -- deliberately separate from the Alert 7-state
// flow above; do not conflate the two (mobile module note in SPEC_V2.md section 4).
export const ACTION_PLAN_STATUS_FLOW = ['OPEN', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];

export const ACTION_PLAN_STATUS_LABELS = {
  OPEN: 'Terbuka',
  PLANNED: 'Direncanakan',
  IN_PROGRESS: 'Diproses',
  COMPLETED: 'Selesai',
  VERIFIED: 'Terverifikasi',
  CLOSED: 'Ditutup',
};

export function nextActionPlanStatus(current) {
  const idx = ACTION_PLAN_STATUS_FLOW.indexOf(current);
  if (idx === -1 || idx === ACTION_PLAN_STATUS_FLOW.length - 1) return null;
  return ACTION_PLAN_STATUS_FLOW[idx + 1];
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
