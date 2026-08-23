import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { incidentsApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDateTime } from '../utils/format';

const STATUS_OPTIONS = ['NEW', 'ACKNOWLEDGED', 'ACTION_REQUIRED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];
const SEVERITY_OPTIONS = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];

export default function IncidentManagement() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: '', severity: '', hpt_id: '' });

  useEffect(() => {
    setLoading(true);
    incidentsApi.list().then(setRows).catch(setError).finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.severity && r.severity !== filters.severity) return false;
    if (filters.hpt_id && String(r.hpt_id) !== String(filters.hpt_id)) return false;
    return true;
  }), [rows, filters]);

  const columns = useMemo(() => [
    { key: 'incident_code', header: 'Incident Code', render: (r) => <Link to={`/incidents/${r.id}`}>{r.incident_code}</Link> },
    { key: 'hpt_name', header: 'HPT' },
    { key: 'blok', header: 'Estate / Afdeling / Blok', render: (r) => `${r.estate_name} / ${r.afdeling_name} / ${r.blok_code}` },
    { key: 'severity', header: 'Severity', render: (r) => <SeverityBadge severity={r.severity} /> },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'opened_at', header: 'Dibuka', render: (r) => fmtDateTime(r.opened_at) },
    { key: 'closed_at', header: 'Ditutup', render: (r) => r.closed_at ? fmtDateTime(r.closed_at) : '-' },
  ], []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Incident Management</h1>
          <p>Setiap kasus yang melewati threshold mendapat Incident ID (EWS-YYYYMMDD-XXXX) — satu insiden, satu riwayat utuh.</p>
        </div>
      </div>

      <div className="toolbar">
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Semua</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Severity">
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="">Semua</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="HPT">
          <select value={filters.hpt_id} onChange={(e) => setFilters((f) => ({ ...f, hpt_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.hpt.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : <DataTable columns={columns} rows={filtered} emptyLabel="Tidak ada insiden." />}
    </div>
  );
}
