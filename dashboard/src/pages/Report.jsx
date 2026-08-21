import { useEffect, useMemo, useState } from 'react';
import { reportsApi } from '../api/resources';
import client from '../api/client';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';

const REPORT_TYPES = [
  { key: 'daily', label: 'EWS Daily Report', endpoint: 'daily' },
  { key: 'monthly', label: 'EWS Monthly Report', endpoint: 'monthly' },
  { key: 'by-blok', label: 'Laporan per Blok', endpoint: 'by-blok' },
  { key: 'by-afdeling', label: 'Laporan per Afdeling', endpoint: 'by-afdeling' },
  { key: 'by-estate', label: 'Laporan per Estate', endpoint: 'by-estate' },
  { key: 'by-hpt', label: 'Laporan per HPT', endpoint: 'by-hpt' },
  { key: 'trend', label: 'Trend Laporan (Deteksi)', endpoint: 'trend' },
  { key: 'treatment-service', label: 'Treatment & Service', endpoint: 'treatment-service' },
];

export default function Report() {
  const md = useMasterData();
  const [type, setType] = useState('daily');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [blokId, setBlokId] = useState('');
  const [interval, setInterval_] = useState('month');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [trendData, setTrendData] = useState([]);

  function buildParams() {
    if (type === 'daily') return { date };
    if (type === 'monthly') return { year, month };
    if (type === 'by-blok') return blokId ? { blok_id: blokId } : {};
    if (type === 'trend') return { interval };
    return {};
  }

  function load() {
    setLoading(true);
    setError(null);
    const fn = {
      daily: reportsApi.daily, monthly: reportsApi.monthly, 'by-blok': reportsApi.byBlok,
      'by-afdeling': reportsApi.byAfdeling, 'by-estate': reportsApi.byEstate, 'by-hpt': reportsApi.byHpt,
      trend: reportsApi.trend, 'treatment-service': reportsApi.treatmentService,
    }[type];
    fn(buildParams()).then(setData).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [type]);

  useEffect(() => {
    reportsApi.trend({ interval: 'month' }).then(setTrendData).catch(() => setTrendData([]));
  }, []);

  async function handleExport(format) {
    const endpoint = REPORT_TYPES.find((t) => t.key === type).endpoint;
    const params = { ...buildParams(), format };
    const qs = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    try {
      const res = await client.get(`/reports/${endpoint}?${qs}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ews_${endpoint}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      alert('Export gagal.');
    }
  }

  const rows = Array.isArray(data) ? data : null;
  const isObjectReport = data && !Array.isArray(data);

  const monthlyChartData = useMemo(() => (trendData || []).map((r) => ({ periode: r.periode, deteksi: r.jumlah_deteksi })), [trendData]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Report</h1>
          <p>Laporan Deteksi/Sensus/Pengendalian/Mortalitas/Alert/HPT per Blok/Afdeling/Estate, Trend, Treatment/Service, EWS Daily/Monthly Report.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title mt-0">Trend Jumlah Deteksi per Bulan</div>
        {monthlyChartData.length === 0 ? <Empty label="Belum ada data trend." /> : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={monthlyChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="periode" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Line type="monotone" dataKey="deteksi" stroke="#16693f" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="toolbar">
        <Field label="Jenis Laporan">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {REPORT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </Field>
        {type === 'daily' && (
          <Field label="Tanggal"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        )}
        {type === 'monthly' && (
          <>
            <Field label="Tahun"><input type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 90 }} /></Field>
            <Field label="Bulan">
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          </>
        )}
        {type === 'by-blok' && (
          <Field label="Blok (opsional)">
            <select value={blokId} onChange={(e) => setBlokId(e.target.value)}>
              <option value="">Semua Blok</option>
              {md.bloks.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
            </select>
          </Field>
        )}
        {type === 'trend' && (
          <Field label="Interval">
            <select value={interval} onChange={(e) => setInterval_(e.target.value)}>
              <option value="day">Harian</option>
              <option value="month">Bulanan</option>
            </select>
          </Field>
        )}
        <div style={{ paddingTop: 18 }}>
          <button className="btn btn-primary btn-sm" onClick={load}>Tampilkan</button>
        </div>
        <div style={{ paddingTop: 18, display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" onClick={() => handleExport('xlsx')}>⬇ Excel</button>
          <button className="btn btn-sm" onClick={() => handleExport('csv')}>⬇ CSV</button>
        </div>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : (
        <>
          {isObjectReport && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <ReportObjectView data={data} />
            </div>
          )}
          {rows && (
            rows.length === 0 ? <Empty label="Tidak ada data untuk laporan ini." /> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>{Object.keys(rows[0]).map((k) => <th key={k}>{k}</th>)}</tr>
                  </thead>
                  <tbody>
                    {rows.map((r, idx) => (
                      <tr key={idx}>{Object.keys(rows[0]).map((k) => <td key={k}>{String(r[k] ?? '-')}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}

function ReportObjectView({ data }) {
  if (Array.isArray(data.distribusi_hpt)) {
    // monthly report shape
    return (
      <div>
        <div className="detail-grid">
          <div className="detail-item"><div className="dl">Periode</div><div className="dv">{data.periode}</div></div>
          <div className="detail-item"><div className="dl">Total Deteksi</div><div className="dv">{data.total_deteksi}</div></div>
          <div className="detail-item"><div className="dl">Total Sensus</div><div className="dv">{data.total_sensus}</div></div>
          <div className="detail-item"><div className="dl">Treatment</div><div className="dv">{data.treatment}</div></div>
          <div className="detail-item"><div className="dl">Mortalitas</div><div className="dv">{data.mortalitas}</div></div>
          <div className="detail-item"><div className="dl">Perlu Service</div><div className="dv">{data.service_required}</div></div>
          <div className="detail-item"><div className="dl">Efektivitas Pengendalian</div><div className="dv">{data.efektivitas_pengendalian}</div></div>
        </div>
        <div className="section-title">Distribusi HPT</div>
        {data.distribusi_hpt.length === 0 ? <Empty /> : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.distribusi_hpt.map((r) => ({ hpt: r.hpt, jumlah: r.c }))}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="hpt" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="jumlah" fill="#16693f" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <div className="section-title">Blok Kritis</div>
        {data.blok_kritis.length === 0 ? <Empty /> : (
          data.blok_kritis.map((b, i) => <div key={i} className="stat-line"><span>{b.blok}</span><span>{b.c} insiden berat/critical</span></div>)
        )}
      </div>
    );
  }
  // daily report shape (array wrapped as single row actually — but handled by array branch normally)
  return <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>;
}
