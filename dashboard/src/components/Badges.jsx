import { severityColor, severityLabel, ALERT_STATUS_LABELS } from '../utils/format';

export function SeverityBadge({ severity }) {
  const color = severityColor(severity);
  return (
    <span className="badge" style={{ background: `${color}1a`, color }}>
      <span className="badge-dot" style={{ background: color }} />
      {severityLabel(severity)}
    </span>
  );
}

const STATUS_COLORS = {
  NEW: '#2563eb',
  ACKNOWLEDGED: '#7c3aed',
  ACTION_REQUIRED: '#eab308',
  IN_PROGRESS: '#f97316',
  CONTROLLED: '#0891b2',
  MONITORING: '#0d9488',
  VERIFIED: '#0d9488',
  CLOSED: '#22a55a',
  DRAFT: '#94a3b8',
  READY_TO_SYNC: '#eab308',
  SYNCING: '#2563eb',
  SYNCED: '#22a55a',
  FAILED: '#dc2626',
  PENDING: '#eab308',
  SENT: '#22a55a',
  DELIVERED: '#22a55a',
  ONGOING: '#f97316',
  SELESAI: '#22a55a',
  COMPLETED: '#22a55a',
  ACTIVE: '#22a55a',
  AKTIF: '#22a55a',
  NONAKTIF: '#94a3b8',
  // Action Plan status flow (SPEC_V2.md section 2)
  OPEN: '#2563eb',
  PLANNED: '#7c3aed',
  // Schedule operational status (V1 SPEC.md section 7)
  RENCANA: '#2563eb',
  BERJALAN: '#f97316',
  DIBATALKAN: '#94a3b8',
};

export function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#64748b';
  const label = ALERT_STATUS_LABELS[status] || status || '-';
  return (
    <span className="badge" style={{ background: `${color}1a`, color }}>
      <span className="badge-dot" style={{ background: color }} />
      {label}
    </span>
  );
}

export function SourceChip({ source }) {
  if (!source) return null;
  return <span className="chip">{source}</span>;
}
