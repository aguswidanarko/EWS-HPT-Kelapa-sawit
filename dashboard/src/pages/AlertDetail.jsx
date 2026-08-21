import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { alertsApi, incidentsApi, fileUrl } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canChangeAlertStatus } from '../context/AuthContext';
import { Loading, ErrorBox, Empty } from '../components/Common';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDateTime, ALERT_STATUS_FLOW, ALERT_STATUS_LABELS, nextAlertStatus } from '../utils/format';
import IncidentTimeline from '../components/IncidentTimeline';

export default function AlertDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const md = useMasterData();
  const [alert, setAlert] = useState(null);
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    alertsApi.get(id)
      .then((a) => {
        setAlert(a);
        return incidentsApi.get(a.incident_id).catch(() => null);
      })
      .then(setIncident)
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);

  async function changeStatus(status) {
    setBusy(true);
    try {
      await alertsApi.setStatus(id, status);
      load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!alert) return <Empty label="Alert tidak ditemukan." />;

  const next = nextAlertStatus(alert.status);

  return (
    <div>
      <div className="page-header">
        <div>
          <p style={{ marginBottom: 4 }}><Link to="/alerts">← Kembali ke Alert Center</Link></p>
          <h1>Alert #{alert.id} — {alert.incident_code}</h1>
          <p>{alert.hpt_name} · Blok {alert.blok_code} · {alert.estate_name} / {alert.afdeling_name}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <SeverityBadge severity={alert.kategori} />
          <StatusBadge status={alert.status} />
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title mt-0">Status Alert (operasional, tanpa approval)</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {ALERT_STATUS_FLOW.map((s) => (
            <span key={s} className="chip" style={s === alert.status ? { background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', fontWeight: 600 } : {}}>
              {ALERT_STATUS_LABELS[s]}
            </span>
          ))}
        </div>
        {canChangeAlertStatus(user) ? (
          alert.status === 'CLOSED' ? (
            <div className="small-muted">Alert sudah CLOSED.</div>
          ) : next ? (
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => changeStatus(next)}>
              Ubah status → {ALERT_STATUS_LABELS[next]}
            </button>
          ) : null
        ) : (
          <div className="small-muted">Role Anda tidak memiliki akses untuk mengubah status alert.</div>
        )}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="section-title mt-0">Info</div>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{alert.incident_code}</div></div>
            <div className="detail-item"><div className="dl">HPT</div><div className="dv">{alert.hpt_name}</div></div>
            <div className="detail-item"><div className="dl">Estate</div><div className="dv">{alert.estate_name}</div></div>
            <div className="detail-item"><div className="dl">Afdeling</div><div className="dv">{alert.afdeling_name}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{alert.blok_code}</div></div>
            <div className="detail-item"><div className="dl">Hasil</div><div className="dv">{alert.hasil}</div></div>
            <div className="detail-item"><div className="dl">Threshold</div><div className="dv">{alert.threshold_ref}</div></div>
            <div className="detail-item"><div className="dl">Kategori</div><div className="dv"><SeverityBadge severity={alert.kategori} /></div></div>
            <div className="detail-item"><div className="dl">Sumber Data</div><div className="dv">{alert.source_type || '-'}</div></div>
            <div className="detail-item"><div className="dl">Waktu Dibuat</div><div className="dv">{fmtDateTime(alert.created_at)}</div></div>
            {alert.source && (
              <>
                <div className="detail-item"><div className="dl">Petugas</div><div className="dv">{md.userName(alert.source.user_id)}</div></div>
                <div className="detail-item"><div className="dl">GPS</div><div className="dv">{alert.source.gps_lat}, {alert.source.gps_lng}</div></div>
              </>
            )}
          </div>

          <div className="section-title">Bukti / Foto</div>
          {(!alert.photos || alert.photos.length === 0) ? <Empty label="Belum ada foto terlampir." /> : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {alert.photos.map((p) => (
                <a key={p.id} href={fileUrl(p.file_path)} target="_blank" rel="noreferrer" className="chip">Foto #{p.id}</a>
              ))}
            </div>
          )}

          <div className="section-title">Notifikasi Terkirim</div>
          {(!alert.notifications || alert.notifications.length === 0) ? <Empty label="Belum ada notifikasi." /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>Channel</th><th>Penerima</th><th>Waktu</th><th>Status</th></tr></thead>
                <tbody>
                  {alert.notifications.map((n) => (
                    <tr key={n.id}>
                      <td>{n.channel}</td>
                      <td>{n.recipient}</td>
                      <td>{fmtDateTime(n.sent_at)}</td>
                      <td><StatusBadge status={n.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="section-title mt-0">Timeline Insiden (Deteksi → Warning → Sensus → Treatment → Mortalitas)</div>
          {incident ? <IncidentTimeline incident={incident} /> : <Empty label="Timeline tidak tersedia." />}
        </div>
      </div>
    </div>
  );
}
