import { useEffect, useMemo, useState } from 'react';
import { scoringApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageScoringCriteria, canEnterScoring } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field, WarningBanner } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import MasterCrud from '../components/MasterCrud';

const SIDE_OPTIONS = ['RND', 'TIM_OPERASIONAL', 'BONUS'];
const TABS = ['Kriteria', 'Entri Poin', 'Rekap'];

export default function ScoringKpi() {
  const { user } = useAuth();
  const [tab, setTab] = useState('Kriteria');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Scoring / KPI</h1>
          <p>Kerangka data scoring generik untuk R&amp;D dan Tim Operasional Kebun — kriteria editable dari sini, rekap dihitung read-model per periode.</p>
        </div>
      </div>

      <WarningBanner title="Kriteria penilaian belum final — menunggu konfirmasi">
        Rincian resmi 5 kriteria R&amp;D dan 5 kriteria Tim Operasional (+ bonus) belum tersedia di dokumen manapun (BRD/FR) yang diberikan.
        Baris di bawah ini adalah <strong>PLACEHOLDER/TBD</strong> agar struktur data siap dipakai — jangan diperlakukan sebagai rubrik final sampai kriteria asli dikonfirmasi oleh pemilik proses bisnis.
      </WarningBanner>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Kriteria' && <KriteriaTab user={user} />}
      {tab === 'Entri Poin' && <EntriTab user={user} />}
      {tab === 'Rekap' && <RekapTab />}
    </div>
  );
}

function KriteriaTab({ user }) {
  return (
    <MasterCrud
      title="Scoring Criteria (Placeholder)"
      description="side: RND | TIM_OPERASIONAL | BONUS — target bentuk akhir 5 RND @poin + 5 TIM_OPERASIONAL @poin + BONUS maks 10 (SPEC_V2.md section 2), belum diisi kriteria asli."
      canWrite={canManageScoringCriteria(user)}
      api={{
        list: () => scoringApi.criteria.list().then((r) => r.data),
        create: scoringApi.criteria.create,
        update: scoringApi.criteria.update,
        remove: () => Promise.reject({ response: { data: { error: 'Penghapusan kriteria scoring belum didukung backend — nonaktifkan lewat Edit > Aktif = tidak, bukan hapus.' } } }),
      }}
      columns={[
        { key: 'side', header: 'Side' },
        { key: 'code', header: 'Kode' },
        { key: 'name', header: 'Nama (placeholder)' },
        { key: 'max_poin', header: 'Max Poin' },
        { key: 'active', header: 'Aktif', render: (r) => (r.active ? 'Ya' : 'Tidak') },
      ]}
      fields={[
        { key: 'side', label: 'Side', type: 'select', required: true, options: SIDE_OPTIONS.map((s) => ({ value: s, label: s })) },
        { key: 'code', label: 'Kode', required: true },
        { key: 'name', label: 'Nama (placeholder — belum final)', required: true },
        { key: 'max_poin', label: 'Max Poin', type: 'number', required: true },
        { key: 'description', label: 'Deskripsi', type: 'textarea', wide: true },
        { key: 'active', label: 'Aktif', type: 'checkbox' },
      ]}
    />
  );
}

function EntriTab({ user }) {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [criteria, setCriteria] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ period_month: '', estate_id: '' });
  const [creating, setCreating] = useState(false);

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    Promise.all([scoringApi.entries.list(params), scoringApi.criteria.list()])
      .then(([e, c]) => { setRows(e.data || []); setCriteria(c.data || []); })
      .catch(setError)
      .finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [filters.period_month, filters.estate_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const criteriaById = useMemo(() => Object.fromEntries(criteria.map((c) => [c.id, c])), [criteria]);

  const columns = useMemo(() => [
    { key: 'period_month', header: 'Periode' },
    { key: 'estate_id', header: 'PT', render: (r) => (r.estate_id ? md.estateName(r.estate_id) : 'Semua') },
    { key: 'afdeling_id', header: 'Afdeling', render: (r) => (r.afdeling_id ? md.afdelingName(r.afdeling_id) : 'Semua') },
    { key: 'hpt_id', header: 'Indikator', render: (r) => (r.hpt_id ? md.hptName(r.hpt_id) : '-') },
    { key: 'criteria_id', header: 'Kriteria', render: (r) => criteriaById[r.criteria_id]?.name || `#${r.criteria_id}` },
    { key: 'poin_diberikan', header: 'Poin', render: (r) => `${r.poin_diberikan} / ${criteriaById[r.criteria_id]?.max_poin ?? '?'}` },
    { key: 'created_by_user_id', header: 'Dicatat oleh', render: (r) => md.userName(r.created_by_user_id) },
  ], [md, criteriaById]);

  return (
    <div>
      <div className="toolbar">
        <Field label="Periode (YYYY-MM)"><input placeholder="2026-08" value={filters.period_month} onChange={(e) => setFilters((f) => ({ ...f, period_month: e.target.value }))} /></Field>
        <Field label="PT">
          <select value={filters.estate_id} onChange={(e) => setFilters((f) => ({ ...f, estate_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
          </select>
        </Field>
        <div style={{ flex: 1 }} />
        {canEnterScoring(user) && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Entri Poin</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : <DataTable columns={columns} rows={rows} emptyLabel="Belum ada entri poin." />}
      {creating && (
        <EntryCreateModal md={md} criteria={criteria} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
      )}
    </div>
  );
}

function EntryCreateModal({ md, criteria, onClose, onCreated }) {
  const [form, setForm] = useState({ hpt_id: '', estate_id: '', afdeling_id: '', period_month: new Date().toISOString().slice(0, 7), criteria_id: '', poin_diberikan: '', catatan: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const selectedCriteria = criteria.find((c) => String(c.id) === String(form.criteria_id));

  async function handleSave(e) {
    e.preventDefault();
    if (!form.period_month || !form.criteria_id || form.poin_diberikan === '') { setError('Periode, kriteria, dan poin wajib diisi.'); return; }
    setSaving(true);
    setError(null);
    try {
      await scoringApi.entries.create({
        hpt_id: form.hpt_id || undefined,
        estate_id: form.estate_id || undefined,
        afdeling_id: form.afdeling_id || undefined,
        period_month: form.period_month,
        criteria_id: form.criteria_id,
        poin_diberikan: Number(form.poin_diberikan),
        catatan: form.catatan || undefined,
      });
      onCreated();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Entri Poin Baru (Placeholder)"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>Periode (YYYY-MM) *</label>
          <input required placeholder="2026-08" value={form.period_month} onChange={(e) => setForm((v) => ({ ...v, period_month: e.target.value }))} />
        </div>
        <div className="field">
          <label>Kriteria *</label>
          <select required value={form.criteria_id} onChange={(e) => setForm((v) => ({ ...v, criteria_id: e.target.value }))}>
            <option value="">-</option>
            {criteria.map((c) => <option key={c.id} value={c.id}>{c.side} — {c.name} (maks {c.max_poin})</option>)}
          </select>
        </div>
        <div className="field">
          <label>Poin Diberikan * {selectedCriteria ? `(maks ${selectedCriteria.max_poin})` : ''}</label>
          <input required type="number" step="any" value={form.poin_diberikan} onChange={(e) => setForm((v) => ({ ...v, poin_diberikan: e.target.value }))} />
        </div>
        <div className="field">
          <label>PT</label>
          <select value={form.estate_id} onChange={(e) => setForm((v) => ({ ...v, estate_id: e.target.value }))}>
            <option value="">-</option>
            {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Afdeling</label>
          <select value={form.afdeling_id} onChange={(e) => setForm((v) => ({ ...v, afdeling_id: e.target.value }))}>
            <option value="">-</option>
            {md.afdelings.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Indikator</label>
          <select value={form.hpt_id} onChange={(e) => setForm((v) => ({ ...v, hpt_id: e.target.value }))}>
            <option value="">-</option>
            {md.hpt.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
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

function levelLabel(level) {
  return { 1: 'Level 1', 2: 'Level 2', 3: 'Level 3', 4: 'Level 4' }[level] || `Level ${level}`;
}

function RekapTab() {
  const md = useMasterData();
  const [periodMonth, setPeriodMonth] = useState(new Date().toISOString().slice(0, 7));
  const [estateId, setEstateId] = useState('');
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadSummary() {
    if (!periodMonth) return;
    setBusy(true);
    setError(null);
    try {
      const res = await scoringApi.summary({ period_month: periodMonth, estate_id: estateId || undefined });
      setSummary(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal memuat rekap.');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { loadSummary(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div className="toolbar">
        <Field label="Periode (YYYY-MM)"><input value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} /></Field>
        <Field label="PT">
          <select value={estateId} onChange={(e) => setEstateId(e.target.value)}>
            <option value="">Semua</option>
            {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
          </select>
        </Field>
        <div style={{ paddingTop: 18 }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={loadSummary}>{busy ? 'Memuat…' : 'Tampilkan Rekap'}</button>
        </div>
      </div>

      {error && <ErrorBox error={error} />}
      {!summary ? <Empty label="Pilih periode untuk melihat rekap." /> : (
        <div className="grid-2">
          <div className="card card-pad">
            <div className="section-title mt-0">Total per Side</div>
            {(summary.by_side || []).length === 0 ? <Empty label="Belum ada entri untuk periode ini." /> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Side</th><th>Total Poin</th><th>Max Poin</th><th>Jumlah Entri</th></tr></thead>
                  <tbody>
                    {summary.by_side.map((s) => (
                      <tr key={s.side}>
                        <td>{s.side}</td>
                        <td>{s.total_poin}</td>
                        <td>{summary.max_by_side?.[s.side] ?? '-'}</td>
                        <td>{s.entry_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="small-muted" style={{ marginBottom: 8 }}>Total Poin (skala placeholder /{summary.denom})</div>
            <div style={{ fontSize: 40, fontWeight: 800, color: 'var(--primary)' }}>{summary.total_poin} <span style={{ fontSize: 18, color: 'var(--text-muted)' }}>/ {summary.denom}</span></div>
            <span className="badge" style={{ marginTop: 10, background: 'var(--primary-light)', color: 'var(--primary-dark)', fontSize: 13, padding: '4px 14px' }}>{levelLabel(summary.level)}</span>
            <div className="small-muted" style={{ marginTop: 12, textAlign: 'center' }}>Denominator /110 dan badge Level 1–4 bersifat sementara (placeholder) sampai kriteria &amp; max_poin resmi dikonfirmasi.</div>
          </div>
        </div>
      )}
    </div>
  );
}
