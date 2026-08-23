import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { actionPlansApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canUpdateActionPlan, canVerifyActionPlan } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { StatusBadge } from '../components/Badges';
import { fmtDate, fmtDateTime, ACTION_PLAN_STATUS_FLOW, ACTION_PLAN_STATUS_LABELS, nextActionPlanStatus } from '../utils/format';
import Modal from '../components/Modal';

export default function ActionPlanDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const md = useMasterData();
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [verifying, setVerifying] = useState(false);

  function load() {
    setLoading(true);
    actionPlansApi.get(id).then(setPlan).catch(setError).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeStatus(status) {
    setBusy(true);
    try {
      await actionPlansApi.update(id, { status });
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!plan) return <Empty label="Action plan tidak ditemukan." />;

  const next = nextActionPlanStatus(plan.status);
  const canEdit = canUpdateActionPlan(user);
  const canVerify = canVerifyActionPlan(user) && plan.status !== 'VERIFIED' && plan.status !== 'CLOSED';

  return (
    <div>
      <div className="page-header">
        <div>
          <p style={{ marginBottom: 4 }}><Link to="/action-plans">← Kembali ke Action Plan</Link></p>
          <h1>Action Plan #{plan.id}</h1>
          <p>{plan.problem || 'Tanpa deskripsi masalah.'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {plan.overdue ? <span className="overdue-flag">⚠ Overdue</span> : null}
          {plan.escalated ? <span className="escalated-flag">🚨 Escalated</span> : null}
          <StatusBadge status={plan.status} />
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title mt-0">Status (OPEN → PLANNED → IN_PROGRESS → COMPLETED → VERIFIED → CLOSED)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {ACTION_PLAN_STATUS_FLOW.map((s) => (
            <span key={s} className="chip" style={s === plan.status ? { background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', fontWeight: 600 } : {}}>
              {ACTION_PLAN_STATUS_LABELS[s]}
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canEdit && plan.status !== 'CLOSED' && next && (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => changeStatus(next)}>
              Ubah status → {ACTION_PLAN_STATUS_LABELS[next]}
            </button>
          )}
          {canEdit && <button className="btn btn-sm" onClick={() => setEditing(true)}>Edit Detail / Actual Action</button>}
          {canVerify && <button className="btn btn-sm" onClick={() => setVerifying(true)}>Verifikasi</button>}
          {!canEdit && !canVerify && <span className="small-muted">Role Anda tidak memiliki akses untuk mengubah action plan ini.</span>}
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="section-title mt-0">Info</div>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{plan.incident_id ? <Link to={`/incidents/${plan.incident_id}`}>#{plan.incident_id}</Link> : '-'}</div></div>
            <div className="detail-item"><div className="dl">Alert</div><div className="dv">{plan.alert_id ? <Link to={`/alerts/${plan.alert_id}`}>#{plan.alert_id}</Link> : '-'}</div></div>
            <div className="detail-item"><div className="dl">Leaf Analysis Terkait</div><div className="dv">{plan.related_leaf_analysis_id ? `#${plan.related_leaf_analysis_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">PIC</div><div className="dv">{plan.pic_user_id ? md.userName(plan.pic_user_id) : '-'}</div></div>
            <div className="detail-item"><div className="dl">Jatuh Tempo</div><div className="dv">{fmtDate(plan.due_date)}</div></div>
            <div className="detail-item"><div className="dl">Dibuat</div><div className="dv">{fmtDateTime(plan.created_at)}</div></div>
            <div className="detail-item"><div className="dl">Diperbarui</div><div className="dv">{fmtDateTime(plan.updated_at)}</div></div>
          </div>

          <div className="section-title">Masalah</div>
          <div className="small-muted">{plan.problem || '-'}</div>
          <div className="section-title">Rekomendasi</div>
          <div className="small-muted">{plan.recommendation || '-'}</div>
          <div className="section-title">Actual Action</div>
          <div className="small-muted">{plan.actual_action || '-'}</div>
        </div>

        <div className="card card-pad">
          <div className="section-title mt-0">Verifikasi</div>
          {plan.verified_at ? (
            <div className="detail-grid">
              <div className="detail-item"><div className="dl">Diverifikasi oleh</div><div className="dv">{md.userName(plan.verified_by_user_id)}</div></div>
              <div className="detail-item"><div className="dl">Waktu</div><div className="dv">{fmtDateTime(plan.verified_at)}</div></div>
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}><div className="dl">Catatan Verifikasi</div><div className="dv">{plan.verification_note || '-'}</div></div>
            </div>
          ) : (
            <Empty label="Belum diverifikasi." />
          )}

          <div className="section-title">Bukti</div>
          <div className="small-muted">{plan.evidence_photo_id ? `Foto #${plan.evidence_photo_id}` : 'Belum ada bukti foto terlampir.'}</div>
        </div>
      </div>

      {editing && (
        <EditModal plan={plan} md={md} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />
      )}
      {verifying && (
        <VerifyModal onClose={() => setVerifying(false)} onSaved={() => { setVerifying(false); load(); }} planId={plan.id} />
      )}
    </div>
  );
}

function EditModal({ plan, md, onClose, onSaved }) {
  const [form, setForm] = useState({
    problem: plan.problem || '',
    recommendation: plan.recommendation || '',
    actual_action: plan.actual_action || '',
    pic_user_id: plan.pic_user_id || '',
    due_date: plan.due_date || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await actionPlansApi.update(plan.id, {
        problem: form.problem || null,
        recommendation: form.recommendation || null,
        actual_action: form.actual_action || null,
        pic_user_id: form.pic_user_id || null,
        due_date: form.due_date || null,
      });
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Edit Action Plan #${plan.id}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
      </>}
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Masalah</label><textarea rows={2} value={form.problem} onChange={(e) => setForm((v) => ({ ...v, problem: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Rekomendasi</label><textarea rows={2} value={form.recommendation} onChange={(e) => setForm((v) => ({ ...v, recommendation: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}><label>Actual Action</label><textarea rows={2} value={form.actual_action} onChange={(e) => setForm((v) => ({ ...v, actual_action: e.target.value }))} /></div>
        <Field label="PIC">
          <select value={form.pic_user_id} onChange={(e) => setForm((v) => ({ ...v, pic_user_id: e.target.value }))}>
            <option value="">-</option>
            {md.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="Jatuh Tempo">
          <input type="date" value={form.due_date} onChange={(e) => setForm((v) => ({ ...v, due_date: e.target.value }))} />
        </Field>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}

function VerifyModal({ planId, onClose, onSaved }) {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleVerify(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await actionPlansApi.verify(planId, { verification_note: note || null });
      onSaved();
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal verifikasi.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Verifikasi Action Plan"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Batal</button>
        <button className="btn btn-primary" disabled={saving} onClick={handleVerify}>{saving ? 'Memverifikasi…' : 'Verifikasi (status → VERIFIED)'}</button>
      </>}
    >
      <form onSubmit={handleVerify}>
        <div className="field">
          <label>Catatan Verifikasi</label>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
    </Modal>
  );
}
