import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { leafAnalysisApi, defisiensiHaraApi, actionPlansApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageLeafAnalysis, canCreateDefisiensiHaraTemuan, canCreateActionPlan } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDate } from '../utils/format';
import LocationFilterFields from '../components/LocationFilterFields';

const SEVERITY_OPTIONS = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];
const LA_STATUS_OPTIONS = ['OPEN', 'REVIEWED', 'CLOSED'];

export default function DefisiensiHara() {
  const { user } = useAuth();
  const [tab, setTab] = useState('Leaf Analysis');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Defisiensi Hara</h1>
          <p>Analisis daun (leaf analysis) dari Riset, dan temuan lapangan Mandor/Petugas yang mengacu padanya — sesuai unsur hara, hasil, severity, status, dan tautan action plan.</p>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab-btn' + (tab === 'Leaf Analysis' ? ' active' : '')} onClick={() => setTab('Leaf Analysis')}>Leaf Analysis (Riset)</button>
        <button className={'tab-btn' + (tab === 'Temuan' ? ' active' : '')} onClick={() => setTab('Temuan')}>Temuan Lapangan</button>
      </div>

      {tab === 'Leaf Analysis' && <LeafAnalysisTab user={user} />}
      {tab === 'Temuan' && <TemuanTab user={user} />}
    </div>
  );
}

function LeafAnalysisTab({ user }) {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ blok_id: '', severity: '', status: '' });
  const [selected, setSelected] = useState(null);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    leafAnalysisApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [filters.blok_id, filters.severity, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function openDetail(row) {
    setSelected(row);
    setSelectedDetail(null);
    leafAnalysisApi.get(row.id).then(setSelectedDetail).catch(() => {});
  }

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'Blok', render: (r) => md.blokName(r.blok_id) },
    { key: 'unsur_hara', header: 'Unsur Hara' },
    { key: 'hasil', header: 'Hasil' },
    { key: 'severity', header: 'Severity', render: (r) => r.severity ? <SeverityBadge severity={r.severity} /> : '-' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'input_by_role', header: 'Diinput oleh', render: () => <span className="chip">RISET</span> },
  ], [md]);

  return (
    <div>
      <div className="toolbar">
        <Field label="Blok">
          <select value={filters.blok_id} onChange={(e) => setFilters((f) => ({ ...f, blok_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.bloks.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </Field>
        <Field label="Severity">
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="">Semua</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Semua</option>
            {LA_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div style={{ flex: 1 }} />
        {canManageLeafAnalysis(user) && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Leaf Analysis Baru</button>}
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : <DataTable columns={columns} rows={rows} onRowClick={openDetail} emptyLabel="Belum ada data leaf analysis." />}

      {selected && (
        <Modal title={`Leaf Analysis #${selected.id} — ${selected.unsur_hara}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Tanggal</div><div className="dv">{fmtDate(selected.tanggal)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(selected.blok_id)}</div></div>
            <div className="detail-item"><div className="dl">Unsur Hara</div><div className="dv">{selected.unsur_hara}</div></div>
            <div className="detail-item"><div className="dl">Hasil</div><div className="dv">{selected.hasil ?? '-'}</div></div>
            <div className="detail-item"><div className="dl">Severity</div><div className="dv">{selected.severity ? <SeverityBadge severity={selected.severity} /> : '-'}</div></div>
            <div className="detail-item"><div className="dl">Status</div><div className="dv"><StatusBadge status={selected.status} /></div></div>
            <div className="detail-item"><div className="dl">Diinput oleh</div><div className="dv">{md.userName(selected.user_id)} (RISET)</div></div>
          </div>
          <div className="section-title">Catatan</div>
          <div className="small-muted">{selected.catatan || '-'}</div>
          <div className="section-title">Temuan Lapangan Terkait</div>
          {!selectedDetail ? <Loading /> : (selectedDetail.temuan || []).length === 0 ? (
            <Empty label="Belum ada temuan lapangan yang mengacu pada leaf analysis ini." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Tanggal</th><th>Blok</th><th>Temuan</th><th>Severity</th><th>Status</th></tr></thead>
                <tbody>
                  {selectedDetail.temuan.map((t) => (
                    <tr key={t.id}>
                      <td>{fmtDate(t.tanggal)}</td>
                      <td>{md.blokName(t.blok_id)}</td>
                      <td>{t.temuan_lapangan || '-'}</td>
                      <td>{t.severity ? <SeverityBadge severity={t.severity} /> : '-'}</td>
                      <td><StatusBadge status={t.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {creating && (
        <LeafAnalysisCreateModal md={md} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
    </div>
  );
}

function LeafAnalysisCreateModal({ md, onClose, onCreated }) {
  const [form, setForm] = useState({ blok_id: '', tanggal: new Date().toISOString().slice(0, 10), unsur_hara: '', hasil: '', severity: '', catatan: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await leafAnalysisApi.create(form);
      onCreated();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Leaf Analysis Baru (Riset)"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Blok</label>
          <select value={form.blok_id} onChange={(e) => setForm((v) => ({ ...v, blok_id: e.target.value }))}>
            <option value="">-</option>
            {md.bloks.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Tanggal *</label><input type="date" required value={form.tanggal} onChange={(e) => setForm((v) => ({ ...v, tanggal: e.target.value }))} /></div>
        <div className="field"><label>Unsur Hara *</label><input required placeholder="mis. N, P, K, Mg" value={form.unsur_hara} onChange={(e) => setForm((v) => ({ ...v, unsur_hara: e.target.value }))} /></div>
        <div className="field"><label>Hasil</label><input value={form.hasil} onChange={(e) => setForm((v) => ({ ...v, hasil: e.target.value }))} /></div>
        <div className="field">
          <label>Severity</label>
          <select value={form.severity} onChange={(e) => setForm((v) => ({ ...v, severity: e.target.value }))}>
            <option value="">-</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea rows={2} value={form.catatan} onChange={(e) => setForm((v) => ({ ...v, catatan: e.target.value }))} />
        </div>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

function TemuanTab({ user }) {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ estate_id: '', afdeling_id: '', blok_id: '', severity: '' });
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    const params = { blok_id: filters.blok_id, severity: filters.severity };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    defisiensiHaraApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [filters.blok_id, filters.severity]); // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'Estate / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
    { key: 'unsur_hara', header: 'Unsur Hara' },
    { key: 'temuan_lapangan', header: 'Temuan Lapangan' },
    { key: 'severity', header: 'Severity', render: (r) => r.severity ? <SeverityBadge severity={r.severity} /> : '-' },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'action_plan_id', header: 'Action Plan', render: (r) => r.action_plan_id ? <Link to={`/action-plans/${r.action_plan_id}`} onClick={(e) => e.stopPropagation()}>#{r.action_plan_id}</Link> : <span className="small-muted">Belum ada</span> },
    { key: 'petugas', header: 'Petugas', render: (r) => md.userName(r.user_id) },
  ], [md]);

  return (
    <div>
      <div className="toolbar">
        <LocationFilterFields filters={filters} setFilters={setFilters} md={md} />
        <Field label="Severity">
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="">Semua</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <div style={{ flex: 1 }} />
        {canCreateDefisiensiHaraTemuan(user) && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Temuan Baru</button>}
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Belum ada temuan lapangan." />}

      {selected && (
        <TemuanDetailModal row={selected} md={md} user={user} onClose={() => setSelected(null)} onChanged={() => { setSelected(null); load(); }} />
      )}

      {creating && (
        <TemuanCreateModal md={md} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
    </div>
  );
}

function TemuanDetailModal({ row, md, user, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleCreateActionPlan() {
    setBusy(true);
    setError(null);
    try {
      const res = await actionPlansApi.create({
        related_leaf_analysis_id: row.leaf_analysis_id || undefined,
        problem: `Temuan defisiensi hara (${row.unsur_hara || '-'}) di blok ${md.blokName(row.blok_id)}: ${row.temuan_lapangan || '-'}`,
      });
      await defisiensiHaraApi.update(row.id, { action_plan_id: res.data.id });
      onChanged();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal membuat action plan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Temuan Defisiensi Hara #${row.id}`} onClose={onClose}>
      <div className="detail-grid">
        <div className="detail-item"><div className="dl">Tanggal</div><div className="dv">{fmtDate(row.tanggal)}</div></div>
        <div className="detail-item"><div className="dl">Estate</div><div className="dv">{md.estateName(row.estate_id)}</div></div>
        <div className="detail-item"><div className="dl">Afdeling</div><div className="dv">{md.afdelingName(row.afdeling_id)}</div></div>
        <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(row.blok_id)}</div></div>
        <div className="detail-item"><div className="dl">Unsur Hara</div><div className="dv">{row.unsur_hara || '-'}</div></div>
        <div className="detail-item"><div className="dl">Severity</div><div className="dv">{row.severity ? <SeverityBadge severity={row.severity} /> : '-'}</div></div>
        <div className="detail-item"><div className="dl">Status</div><div className="dv"><StatusBadge status={row.status} /></div></div>
        <div className="detail-item"><div className="dl">Petugas</div><div className="dv">{md.userName(row.user_id)}</div></div>
        <div className="detail-item"><div className="dl">GPS</div><div className="dv">{row.gps_lat ?? '-'}, {row.gps_lng ?? '-'}</div></div>
        <div className="detail-item"><div className="dl">Leaf Analysis Terkait</div><div className="dv">{row.leaf_analysis_id ? `#${row.leaf_analysis_id}` : '-'}</div></div>
      </div>
      <div className="section-title">Temuan Lapangan</div>
      <div className="small-muted">{row.temuan_lapangan || '-'}</div>
      <div className="section-title">Catatan</div>
      <div className="small-muted">{row.catatan || '-'}</div>

      <div className="section-title">Action Plan</div>
      {row.action_plan_id ? (
        <Link to={`/action-plans/${row.action_plan_id}`}>Lihat Action Plan #{row.action_plan_id} →</Link>
      ) : canCreateActionPlan(user) ? (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleCreateActionPlan}>
          {busy ? 'Membuat…' : '+ Buat Action Plan dari temuan ini'}
        </button>
      ) : (
        <div className="small-muted">Belum ada action plan untuk temuan ini.</div>
      )}
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

function TemuanCreateModal({ md, onClose, onCreated }) {
  const [form, setForm] = useState({ estate_id: '', afdeling_id: '', blok_id: '', tanggal: new Date().toISOString().slice(0, 10), unsur_hara: '', temuan_lapangan: '', severity: '', leaf_analysis_id: '', catatan: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const afdelingOptions = form.estate_id ? md.afdelingsByEstate(form.estate_id) : md.afdelings;
  const blokOptions = form.afdeling_id ? md.bloksByAfdeling(form.afdeling_id) : md.bloks;

  async function handleSave(e) {
    e.preventDefault();
    if (!form.blok_id || !form.tanggal) { setError('Blok dan tanggal wajib diisi.'); return; }
    setSaving(true);
    setError(null);
    try {
      await defisiensiHaraApi.create({ ...form, leaf_analysis_id: form.leaf_analysis_id || undefined, source: 'WEB' });
      onCreated();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Temuan Defisiensi Hara Baru"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Estate</label>
          <select value={form.estate_id} onChange={(e) => setForm((v) => ({ ...v, estate_id: e.target.value, afdeling_id: '', blok_id: '' }))}>
            <option value="">-</option>
            {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Afdeling</label>
          <select value={form.afdeling_id} onChange={(e) => setForm((v) => ({ ...v, afdeling_id: e.target.value, blok_id: '' }))}>
            <option value="">-</option>
            {afdelingOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Blok *</label>
          <select required value={form.blok_id} onChange={(e) => setForm((v) => ({ ...v, blok_id: e.target.value }))}>
            <option value="">-</option>
            {blokOptions.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div className="field"><label>Tanggal *</label><input type="date" required value={form.tanggal} onChange={(e) => setForm((v) => ({ ...v, tanggal: e.target.value }))} /></div>
        <div className="field"><label>Unsur Hara</label><input value={form.unsur_hara} onChange={(e) => setForm((v) => ({ ...v, unsur_hara: e.target.value }))} /></div>
        <div className="field">
          <label>Severity</label>
          <select value={form.severity} onChange={(e) => setForm((v) => ({ ...v, severity: e.target.value }))}>
            <option value="">-</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Leaf Analysis Terkait (ID, opsional)</label>
          <input type="number" value={form.leaf_analysis_id} onChange={(e) => setForm((v) => ({ ...v, leaf_analysis_id: e.target.value }))} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Temuan Lapangan</label>
          <textarea rows={2} value={form.temuan_lapangan} onChange={(e) => setForm((v) => ({ ...v, temuan_lapangan: e.target.value }))} />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea rows={2} value={form.catatan} onChange={(e) => setForm((v) => ({ ...v, catatan: e.target.value }))} />
        </div>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
