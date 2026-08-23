import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { actionPlansApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canCreateActionPlan } from '../context/AuthContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { StatusBadge } from '../components/Badges';
import { fmtDate } from '../utils/format';

const STATUS_OPTIONS = ['OPEN', 'PLANNED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'CLOSED'];

export default function ActionPlanList() {
  const md = useMasterData();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: '', pic_user_id: '', overdue: '' });
  const [creating, setCreating] = useState(!!(params.get('incident_id') || params.get('alert_id')));

  function load() {
    setLoading(true);
    const q = { ...filters };
    Object.keys(q).forEach((k) => { if (!q[k]) delete q[k]; });
    actionPlansApi.list(q).then(setRows).catch(setError).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [filters.status, filters.pic_user_id, filters.overdue]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    open: rows.filter((r) => ['OPEN', 'PLANNED', 'IN_PROGRESS'].includes(r.status)).length,
    overdue: rows.filter((r) => r.overdue).length,
    escalated: rows.filter((r) => r.escalated).length,
    closed: rows.filter((r) => r.status === 'CLOSED' || r.status === 'VERIFIED').length,
  }), [rows]);

  const columns = useMemo(() => [
    { key: 'id', header: 'ID', render: (r) => <Link to={`/action-plans/${r.id}`}>#{r.id}</Link> },
    { key: 'problem', header: 'Masalah', render: (r) => <span title={r.problem}>{(r.problem || '-').slice(0, 60)}{(r.problem || '').length > 60 ? '…' : ''}</span> },
    { key: 'incident_id', header: 'Incident', render: (r) => r.incident_id ? <Link to={`/incidents/${r.incident_id}`}>#{r.incident_id}</Link> : '-' },
    { key: 'alert_id', header: 'Alert', render: (r) => r.alert_id ? <Link to={`/alerts/${r.alert_id}`}>#{r.alert_id}</Link> : '-' },
    { key: 'pic_user_id', header: 'PIC', render: (r) => r.pic_user_id ? md.userName(r.pic_user_id) : '-' },
    { key: 'due_date', header: 'Jatuh Tempo', render: (r) => fmtDate(r.due_date) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'overdue', header: 'Overdue', render: (r) => r.overdue ? <span className="overdue-flag">⚠ Overdue</span> : '-' },
    { key: 'escalated', header: 'Escalated', render: (r) => r.escalated ? <span className="escalated-flag">🚨 Escalated</span> : '-' },
  ], [md]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Action Plan</h1>
          <p>Modul tindak lanjut formal: OPEN → PLANNED → IN_PROGRESS → COMPLETED → VERIFIED → CLOSED. Overdue &amp; escalation dihitung otomatis dari due_date.</p>
        </div>
        {canCreateActionPlan(user) && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Action Plan Baru</button>}
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="kpi-card"><div className="kpi-label">Aktif (Open/Planned/In Progress)</div><div className="kpi-value">{counts.open}</div></div>
        <div className="kpi-card" style={{ borderLeftColor: 'var(--berat)' }}><div className="kpi-label">Overdue</div><div className="kpi-value">{counts.overdue}</div></div>
        <div className="kpi-card" style={{ borderLeftColor: 'var(--critical)' }}><div className="kpi-label">Escalated</div><div className="kpi-value">{counts.escalated}</div></div>
        <div className="kpi-card" style={{ borderLeftColor: 'var(--normal)' }}><div className="kpi-label">Verified / Closed</div><div className="kpi-value">{counts.closed}</div></div>
      </div>

      <div className="toolbar">
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Semua</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="PIC">
          <select value={filters.pic_user_id} onChange={(e) => setFilters((f) => ({ ...f, pic_user_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Overdue">
          <select value={filters.overdue} onChange={(e) => setFilters((f) => ({ ...f, overdue: e.target.value }))}>
            <option value="">Semua</option>
            <option value="1">Ya</option>
            <option value="0">Tidak</option>
          </select>
        </Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : <DataTable columns={columns} rows={rows} emptyLabel="Belum ada action plan." />}

      {creating && (
        <CreateModal
          md={md}
          defaultIncidentId={params.get('incident_id') || ''}
          defaultAlertId={params.get('alert_id') || ''}
          onClose={() => { setCreating(false); setSearchParams({}); }}
          onCreated={(row) => { setCreating(false); setSearchParams({}); navigate(`/action-plans/${row.id}`); }}
        />
      )}
    </div>
  );
}

function CreateModal({ md, defaultIncidentId, defaultAlertId, onClose, onCreated }) {
  const [form, setForm] = useState({
    incident_id: defaultIncidentId,
    alert_id: defaultAlertId,
    problem: '',
    recommendation: '',
    pic_user_id: '',
    due_date: '',
    related_leaf_analysis_id: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        incident_id: form.incident_id || undefined,
        alert_id: form.alert_id || undefined,
        problem: form.problem || undefined,
        recommendation: form.recommendation || undefined,
        pic_user_id: form.pic_user_id || undefined,
        due_date: form.due_date || undefined,
        related_leaf_analysis_id: form.related_leaf_analysis_id || undefined,
      };
      const res = await actionPlansApi.create(payload);
      onCreated(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Action Plan Baru"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field"><label>Incident ID (opsional)</label><input type="number" value={form.incident_id} onChange={(e) => setForm((v) => ({ ...v, incident_id: e.target.value }))} /></div>
        <div className="field"><label>Alert ID (opsional)</label><input type="number" value={form.alert_id} onChange={(e) => setForm((v) => ({ ...v, alert_id: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Masalah</label><textarea rows={2} value={form.problem} onChange={(e) => setForm((v) => ({ ...v, problem: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Rekomendasi</label><textarea rows={2} value={form.recommendation} onChange={(e) => setForm((v) => ({ ...v, recommendation: e.target.value }))} /></div>
        <div className="field">
          <label>PIC</label>
          <select value={form.pic_user_id} onChange={(e) => setForm((v) => ({ ...v, pic_user_id: e.target.value }))}>
            <option value="">-</option>
            {md.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Jatuh Tempo</label><input type="date" value={form.due_date} onChange={(e) => setForm((v) => ({ ...v, due_date: e.target.value }))} /></div>
        <div className="field"><label>Leaf Analysis Terkait (ID, opsional)</label><input type="number" value={form.related_leaf_analysis_id} onChange={(e) => setForm((v) => ({ ...v, related_leaf_analysis_id: e.target.value }))} /></div>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
