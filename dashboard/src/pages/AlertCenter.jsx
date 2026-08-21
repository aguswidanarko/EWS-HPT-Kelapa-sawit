import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { alertsApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDateTime } from '../utils/format';

const STATUS_OPTIONS = ['NEW', 'ACKNOWLEDGED', 'IN_PROGRESS', 'CONTROLLED', 'MONITORING', 'CLOSED'];
const SEVERITY_OPTIONS = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];

export default function AlertCenter() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: '', kategori: '', hpt_id: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    alertsApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.status, filters.kategori, filters.hpt_id]);

  const counts = useMemo(() => {
    const c = {};
    SEVERITY_OPTIONS.forEach((s) => { c[s] = rows.filter((r) => r.kategori === s).length; });
    return c;
  }, [rows]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>EWS Alert Center</h1>
          <p>Fitur inti EWS: setiap kejadian melewati threshold muncul sebagai alert action-oriented, bukan sekadar laporan.</p>
        </div>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {SEVERITY_OPTIONS.map((s) => (
          <div className="kpi-card" key={s} style={{ borderLeftColor: { NORMAL: '#22a55a', RINGAN: '#eab308', SEDANG: '#f97316', BERAT: '#dc2626', CRITICAL: '#991b1b' }[s] }}>
            <div className="kpi-label">{s}</div>
            <div className="kpi-value">{counts[s]}</div>
          </div>
        ))}
      </div>

      <div className="toolbar">
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Semua</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Severity">
          <select value={filters.kategori} onChange={(e) => setFilters((f) => ({ ...f, kategori: e.target.value }))}>
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
      {loading ? <Loading /> : rows.length === 0 ? <Empty label="Tidak ada alert untuk filter ini." /> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {rows.map((a) => (
            <Link to={`/alerts/${a.id}`} key={a.id} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className="card card-pad" style={{ borderLeft: `4px solid ${{ NORMAL: '#22a55a', RINGAN: '#eab308', SEDANG: '#f97316', BERAT: '#dc2626', CRITICAL: '#991b1b' }[a.kategori] || '#94a3b8'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <SeverityBadge severity={a.kategori} />
                  <StatusBadge status={a.status} />
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{a.hpt_name} — Blok {a.blok_code}</div>
                <div className="small-muted" style={{ marginBottom: 6 }}>{a.estate_name} / {a.afdeling_name}</div>
                <div style={{ fontSize: 12.5 }}>Hasil <strong>{a.hasil}</strong> · {a.threshold_ref}</div>
                <div className="small-muted" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>{a.incident_code}</span>
                  <span>{fmtDateTime(a.created_at)}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
