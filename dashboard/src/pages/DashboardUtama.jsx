import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { dashboardApi, alertsApi } from '../api/resources';
import { Loading, ErrorBox, Empty } from '../components/Common';
import { SeverityBadge, StatusBadge } from '../components/Badges';
import { fmtDateTime, severityColor } from '../utils/format';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';

const KPI_DEFS = [
  ['total_deteksi', 'Total Deteksi'],
  ['deteksi_hari_ini', 'Deteksi Hari Ini'],
  ['total_sensus', 'Total Sensus'],
  ['blok_terindikasi', 'Blok Terindikasi'],
  ['blok_melewati_threshold', 'Blok Melewati Threshold'],
  ['pengendalian_berjalan', 'Pengendalian Berjalan'],
  ['mortalitas_pending', 'Mortalitas Pending'],
  ['kasus_perlu_service', 'Kasus Perlu Service'],
];

export default function DashboardUtama() {
  const [kpi, setKpi] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([dashboardApi.kpi(), alertsApi.list({ status: 'NEW' })])
      .then(([k, a]) => {
        setKpi(k);
        setAlerts((a || []).slice(0, 6));
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const severityChartData = (kpi?.incident_by_severity || []).map((r) => ({ name: r.severity, jumlah: r.c }));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Dashboard Utama</h1>
          <p>Ringkasan kondisi EWS HPT — Early Warning → Action → Monitoring.</p>
        </div>
      </div>

      <div className="kpi-grid">
        {KPI_DEFS.map(([key, label]) => (
          <div className="kpi-card" key={key}>
            <div className="kpi-label">{label}</div>
            <div className="kpi-value">{kpi?.[key] ?? 0}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div className="card card-pad">
          <div className="section-title mt-0">Insiden per Severity</div>
          {severityChartData.length === 0 ? (
            <Empty label="Belum ada insiden." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={severityChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="jumlah" radius={[4, 4, 0, 0]}>
                  {severityChartData.map((entry, idx) => (
                    <Cell key={idx} fill={severityColor(entry.name)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <div className="section-title">Insiden per Status</div>
          {(kpi?.incident_by_status || []).length === 0 ? (
            <Empty label="Belum ada insiden." />
          ) : (
            (kpi.incident_by_status || []).map((r) => (
              <div className="stat-line" key={r.status}>
                <span><StatusBadge status={r.status} /></span>
                <span>{r.c}</span>
              </div>
            ))
          )}
        </div>

        <div className="card card-pad">
          <div className="section-title mt-0" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Alert Terbaru (NEW)</span>
            <Link to="/alerts" style={{ fontSize: 12 }}>Lihat semua →</Link>
          </div>
          {alerts.length === 0 ? (
            <Empty label="Tidak ada alert baru." />
          ) : (
            <div>
              {alerts.map((a) => (
                <Link key={a.id} to={`/alerts/${a.id}`} style={{ display: 'block', textDecoration: 'none' }}>
                  <div style={{ padding: '10px 0', borderBottom: '1px dashed var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                      <SeverityBadge severity={a.kategori} />
                      <span className="small-muted">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                      {a.hpt_name} — Blok {a.blok_code} ({a.estate_name} / {a.afdeling_name})
                    </div>
                    <div className="small-muted">
                      Hasil {a.hasil} · {a.threshold_ref} · {a.incident_code}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
