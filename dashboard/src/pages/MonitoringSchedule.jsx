import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { scheduleApi, schedulingRulesApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canGenerateSchedule, canManageRules } from '../context/AuthContext';
import { Loading, ErrorBox, Empty } from '../components/Common';
import { StatusBadge } from '../components/Badges';
import { fmtDate } from '../utils/format';
import MasterCrud from '../components/MasterCrud';

const JENIS_KEGIATAN = ['DETEKSI', 'SENSUS', 'PENGENDALIAN', 'MORTALITAS'];
const SCHEDULE_STATUS = ['RENCANA', 'BERJALAN', 'SELESAI', 'DIBATALKAN'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function MonitoringSchedule() {
  const md = useMasterData();
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rules, setRules] = useState([]);
  const [genBusy, setGenBusy] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([scheduleApi.list(), schedulingRulesApi.list({ active: 1 })])
      .then(([s, r]) => { setRows(s || []); setRules(r || []); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  // "scheduled / due / completed / overdue / skipped" (SPEC_V2.md section 4 Dashboard bullet) --
  // derived client-side from schedule.status + tanggal_rencana vs today, since the `schedule`
  // table (V1 SPEC.md section 7) only carries a plain RENCANA/BERJALAN/SELESAI/DIBATALKAN status
  // with no dedicated skip-reason column. DIBATALKAN is treated as "skipped" here; there is no
  // backend field to capture a reason for it (frontend-only scope of this task -- see final report).
  const buckets = useMemo(() => {
    const today = todayISO();
    const scheduled = rows.filter((r) => r.status === 'RENCANA' && r.tanggal_rencana >= today);
    const due = rows.filter((r) => r.status === 'RENCANA' && r.tanggal_rencana === today);
    const overdue = rows.filter((r) => r.status === 'RENCANA' && r.tanggal_rencana && r.tanggal_rencana < today);
    const completed = rows.filter((r) => r.status === 'SELESAI');
    const skipped = rows.filter((r) => r.status === 'DIBATALKAN');
    return { scheduled, due, overdue, completed, skipped };
  }, [rows]);

  async function handleGenerate() {
    setGenBusy(true);
    setGenResult(null);
    try {
      const res = await schedulingRulesApi.generateAll({});
      const total = (res || []).reduce((a, r) => a + (r.created_count || 0), 0);
      setGenResult(`Berhasil membuat ${total} jadwal baru dari ${(res || []).length} rule aktif.`);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setGenResult(err?.response?.data?.error || 'Gagal generate jadwal.');
    } finally {
      setGenBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Monitoring Schedule</h1>
          <p>Jadwal kegiatan (deteksi/sensus/pengendalian/mortalitas) — status operasional scheduled/due/completed/overdue/skipped, digenerate dari Scheduling Rule per indikator.</p>
        </div>
        {canGenerateSchedule(user) && (
          <button className="btn btn-primary btn-sm" disabled={genBusy} onClick={handleGenerate}>
            {genBusy ? 'Generating…' : 'Generate Jadwal dari Rule'}
          </button>
        )}
      </div>

      {genResult && <div className="small-muted" style={{ marginBottom: 14 }}>{genResult}</div>}

      {loading ? <Loading /> : error ? <ErrorBox error={error} /> : (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-label">Scheduled</div><div className="kpi-value">{buckets.scheduled.length}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--ringan)' }}><div className="kpi-label">Due Hari Ini</div><div className="kpi-value">{buckets.due.length}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--normal)' }}><div className="kpi-label">Completed</div><div className="kpi-value">{buckets.completed.length}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--berat)' }}><div className="kpi-label">Overdue</div><div className="kpi-value">{buckets.overdue.length}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--text-faint)' }}><div className="kpi-label">Skipped (Dibatalkan)</div><div className="kpi-value">{buckets.skipped.length}</div></div>
          </div>

          <MasterCrud
            title="Jadwal"
            description="Jadwal per user/estate/afdeling/blok/jenis kegiatan/indikator. Status murni operasional, tanpa approval gate (SPEC.md prinsip #6)."
            canWrite={canGenerateSchedule(user)}
            api={{
              list: scheduleApi.list,
              create: scheduleApi.create,
              update: scheduleApi.update,
              remove: scheduleApi.remove,
            }}
            onChanged={() => setRefreshKey((k) => k + 1)}
            columns={[
              { key: 'tanggal_rencana', header: 'Tanggal Rencana', render: (r) => fmtDate(r.tanggal_rencana) },
              { key: 'jenis_kegiatan', header: 'Jenis Kegiatan' },
              { key: 'hpt_id', header: 'Indikator', render: (r) => (r.hpt_id ? md.hptName(r.hpt_id) : '-') },
              { key: 'blok', header: 'Estate / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
              { key: 'user_id', header: 'PIC', render: (r) => (r.user_id ? md.userName(r.user_id) : '-') },
              { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
              {
                key: 'overdue', header: 'Overdue', render: (r) => (r.status === 'RENCANA' && r.tanggal_rencana && r.tanggal_rencana < todayISO() ? <span className="overdue-flag">⚠ Overdue</span> : '-'),
              },
            ]}
            fields={[
              { key: 'estate_id', label: 'Estate', type: 'select', required: true, options: md.estates.map((e) => ({ value: e.id, label: e.name })) },
              { key: 'afdeling_id', label: 'Afdeling', type: 'select', required: true, options: md.afdelings.map((a) => ({ value: a.id, label: a.name })) },
              { key: 'blok_id', label: 'Blok', type: 'select', required: true, options: md.bloks.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) },
              { key: 'jenis_kegiatan', label: 'Jenis Kegiatan', type: 'select', required: true, options: JENIS_KEGIATAN.map((j) => ({ value: j, label: j })) },
              { key: 'hpt_id', label: 'Indikator (HPT/Yield Making/dst)', type: 'select', options: md.hpt.map((h) => ({ value: h.id, label: `${h.name} (${h.indicator_type || 'HPT'})` })) },
              { key: 'user_id', label: 'PIC (User)', type: 'select', options: md.users.map((u) => ({ value: u.id, label: u.name })) },
              { key: 'tanggal_rencana', label: 'Tanggal Rencana', type: 'date', required: true },
              { key: 'status', label: 'Status', type: 'select', options: SCHEDULE_STATUS.map((s) => ({ value: s, label: s })) },
            ]}
          />
        </>
      )}

      <div className="card card-pad" style={{ marginTop: 20 }}>
        <div className="section-title mt-0" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Rule Interval Aktif (ringkasan)</span>
          {canManageRules(user) && <Link className="btn btn-sm" to="/rules">Kelola Rule & Parameter →</Link>}
        </div>
        {rules.length === 0 ? <Empty label="Belum ada scheduling rule aktif." /> : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Indikator</th><th>Jenis Kegiatan</th><th>Interval</th><th>Berdasarkan</th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{md.hptName(r.hpt_id)}</td>
                    <td>{r.jenis_kegiatan}</td>
                    <td>{r.interval_type === 'CUSTOM' ? `${r.interval_value} ${r.interval_unit}` : r.interval_type}</td>
                    <td>{r.based_on}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
