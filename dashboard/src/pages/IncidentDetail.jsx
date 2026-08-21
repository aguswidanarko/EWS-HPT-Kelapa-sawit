import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { incidentsApi } from '../api/resources';
import { Loading, ErrorBox, Empty } from '../components/Common';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDateTime } from '../utils/format';
import IncidentTimeline from '../components/IncidentTimeline';

export default function IncidentDetail() {
  const { id } = useParams();
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    incidentsApi.get(id).then(setIncident).catch(setError).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!incident) return <Empty label="Insiden tidak ditemukan." />;

  return (
    <div>
      <div className="page-header">
        <div>
          <p style={{ marginBottom: 4 }}><Link to="/incidents">← Kembali ke Incident Management</Link></p>
          <h1>{incident.incident_code}</h1>
          <p>{incident.hpt_name} · Blok {incident.blok_code} · {incident.estate_name} / {incident.afdeling_name}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
      </div>

      <div className="detail-grid card card-pad" style={{ marginBottom: 16 }}>
        <div className="detail-item"><div className="dl">Dibuka</div><div className="dv">{fmtDateTime(incident.opened_at)}</div></div>
        <div className="detail-item"><div className="dl">Ditutup</div><div className="dv">{incident.closed_at ? fmtDateTime(incident.closed_at) : '-'}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Deteksi</div><div className="dv">{incident.detections?.length || 0}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Sensus</div><div className="dv">{incident.sensuses?.length || 0}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Treatment</div><div className="dv">{incident.treatments?.length || 0}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Mortalitas</div><div className="dv">{incident.mortalities?.length || 0}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Alert</div><div className="dv">{incident.alerts?.length || 0}</div></div>
      </div>

      <div className="card card-pad">
        <div className="section-title mt-0">Timeline Lengkap (Deteksi → Warning → Sensus → Treatment → Mortalitas)</div>
        <IncidentTimeline incident={incident} />
      </div>
    </div>
  );
}
