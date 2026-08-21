import { useEffect, useState } from 'react';
import { auditLogApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canViewAuditLog } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import Modal from '../components/Modal';
import { fmtDateTime, safeJsonParse } from '../utils/format';

export default function AuditLog() {
  const { user } = useAuth();
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ user_id: '', aktivitas: '', device_source: '', from: '', to: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    auditLogApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { if (canViewAuditLog(user)) load(); }, [filters.user_id, filters.aktivitas, filters.device_source, filters.from, filters.to]);

  if (!canViewAuditLog(user)) {
    return (
      <div>
        <div className="page-header"><div><h1>Audit Log</h1></div></div>
        <div className="error-state">Role Anda ({user?.role_name}) tidak memiliki akses ke Audit Log. Hanya Administrator, R&amp;D/FOD, dan Manager.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Jejak audit: user, aktivitas, waktu, data sebelum/sesudah, sumber perangkat.</p>
        </div>
      </div>

      <div className="toolbar">
        <Field label="User">
          <select value={filters.user_id} onChange={(e) => setFilters((f) => ({ ...f, user_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Aktivitas (cari)">
          <input value={filters.aktivitas} onChange={(e) => setFilters((f) => ({ ...f, aktivitas: e.target.value }))} placeholder="mis. LOGIN, CREATE_..." />
        </Field>
        <Field label="Sumber">
          <select value={filters.device_source} onChange={(e) => setFilters((f) => ({ ...f, device_source: e.target.value }))}>
            <option value="">Semua</option>
            {['MOBILE', 'EXCEL', 'WEB', 'API'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Dari"><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></Field>
        <Field label="Sampai"><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty label="Tidak ada log untuk filter ini." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Waktu</th><th>User</th><th>Aktivitas</th><th>Sumber</th><th>IP/Session</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setSelected(r)}>
                  <td>{fmtDateTime(r.waktu)}</td>
                  <td>{r.user_id ? md.userName(r.user_id) : '-'}</td>
                  <td><span className="chip">{r.aktivitas}</span></td>
                  <td>{r.device_source || '-'}</td>
                  <td>{r.ip_session || '-'}</td>
                  <td><button className="btn btn-sm">Detail</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <Modal title={`Audit #${selected.id} — ${selected.aktivitas}`} onClose={() => setSelected(null)} wide>
          <div className="grid-2">
            <div>
              <div className="section-title mt-0">Data Sebelum</div>
              <pre style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', background: 'var(--surface-alt)', padding: 10, borderRadius: 6, maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(safeJsonParse(selected.data_sebelum_json, null), null, 2) || '(kosong)'}
              </pre>
            </div>
            <div>
              <div className="section-title mt-0">Data Sesudah</div>
              <pre style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', background: 'var(--surface-alt)', padding: 10, borderRadius: 6, maxHeight: 300, overflow: 'auto' }}>
                {JSON.stringify(safeJsonParse(selected.data_sesudah_json, null), null, 2) || '(kosong)'}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
