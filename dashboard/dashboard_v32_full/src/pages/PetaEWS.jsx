import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Popup, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { gisApi, masterApi, yieldMakingApi, defisiensiHaraApi } from '../api/resources';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { SeverityBadge } from '../components/Badges';
import { COLOR_NAME_MAP, fmtDate, fmtNum, safeJsonParse } from '../utils/format';
import { useAuth, canWriteMasterHptThreshold } from '../context/AuthContext';

// V2 (SPEC_V2.md section 4 Dashboard: "Peta EWS: tambah layer Defisiensi Hara, Water Management,
// Yield Making"). The backend GIS heatmap endpoint (routes/gis.js GET /heatmap) still only reads
// from the `detection` table and was not extended for the new modules, so rather than a backend
// change this pulls each Yield Making sub-module + Defisiensi Hara field findings directly from
// their own list endpoints (each already carries gps_lat/gps_lng/kategori) and renders them as
// additional client-side point layers, reusing the same CircleMarker approach as the existing
// detection heatmap.
const YIELD_LAYER_DEFS = [
  { key: 'partenocarpi', label: 'Partenocarpi', api: yieldMakingApi.partenocarpi, color: '#8b5cf6' },
  { key: 'waterManagement', label: 'Water Management', api: yieldMakingApi.waterManagement, color: '#0ea5e9' },
  { key: 'bahanOrganik', label: 'Bahan Organik', api: yieldMakingApi.bahanOrganik, color: '#a16207' },
  { key: 'tbmVegetatif', label: 'TBM Vegetatif', api: yieldMakingApi.tbmVegetatif, color: '#16a34a' },
];

function polygonLatLngs(referensiPolygon) {
  const geo = safeJsonParse(referensiPolygon);
  if (!geo || !geo.coordinates) return null;
  try {
    if (geo.type === 'Polygon') {
      return geo.coordinates.map((ring) => ring.map(([lng, lat]) => [lat, lng]));
    }
    if (geo.type === 'MultiPolygon') {
      return geo.coordinates.flatMap((poly) => poly.map((ring) => ring.map(([lng, lat]) => [lat, lng])));
    }
  } catch {
    return null;
  }
  return null;
}

function FitBounds({ bloks }) {
  const map = useMap();
  useEffect(() => {
    const allPts = [];
    bloks.forEach((b) => {
      const rings = polygonLatLngs(b.referensi_polygon);
      if (rings) rings.forEach((r) => allPts.push(...r));
    });
    if (allPts.length) {
      try {
        map.fitBounds(allPts, { padding: [30, 30] });
      } catch {
        /* ignore */
      }
    }
  }, [bloks, map]);
  return null;
}

export default function PetaEWS() {
  const { user } = useAuth();
  const [bloks, setBloks] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [hptList, setHptList] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showYieldLayer, setShowYieldLayer] = useState(false);
  const [showDefisiensiLayer, setShowDefisiensiLayer] = useState(false);
  const [yieldPoints, setYieldPoints] = useState([]);
  const [defisiensiPoints, setDefisiensiPoints] = useState([]);

  const [filters, setFilters] = useState({ severity: '', hpt_id: '', from: '', to: '' });

  useEffect(() => {
    Promise.all([gisApi.bloks(), masterApi.hpt.list()])
      .then(([b, h]) => {
        setBloks(b || []);
        setHptList(h || []);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!showHeatmap) return;
    gisApi.heatmap({ severity: filters.severity, hpt_id: filters.hpt_id, from: filters.from, to: filters.to })
      .then(setHeatmap)
      .catch(() => setHeatmap([]));
  }, [showHeatmap, filters]);

  useEffect(() => {
    if (!showYieldLayer) return;
    const params = { from: filters.from, to: filters.to };
    Promise.all(YIELD_LAYER_DEFS.map((d) => d.api.list(params).catch(() => [])))
      .then((results) => {
        const points = [];
        results.forEach((rows, idx) => {
          const def = YIELD_LAYER_DEFS[idx];
          (rows || []).forEach((r) => {
            if (r.gps_lat != null && r.gps_lng != null) points.push({ ...r, _layer: def.label, _color: def.color });
          });
        });
        setYieldPoints(points);
      })
      .catch(() => setYieldPoints([]));
  }, [showYieldLayer, filters.from, filters.to]);

  useEffect(() => {
    if (!showDefisiensiLayer) return;
    defisiensiHaraApi.list({}).then((rows) => {
      setDefisiensiPoints((rows || []).filter((r) => r.gps_lat != null && r.gps_lng != null));
    }).catch(() => setDefisiensiPoints([]));
  }, [showDefisiensiLayer]);

  const filteredBloks = useMemo(() => {
    return bloks.filter((b) => {
      if (filters.severity && b.severity !== filters.severity) return false;
      return true;
    });
  }, [bloks, filters.severity]);

  function selectBlok(id) {
    setSelectedId(id);
    setDetail(null);
    setDetailLoading(true);
    gisApi.blok(id).then(setDetail).catch(setError).finally(() => setDetailLoading(false));
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const center = [-2.11, 101.51];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Peta EWS</h1>
          <p>Blok berwarna sesuai severity: hijau=normal, kuning=ringan, oranye=sedang, merah=berat/critical.</p>
        </div>
        {canWriteMasterHptThreshold(user) && (
          <button className="btn" onClick={() => setUploadOpen((v) => !v)}>
            {uploadOpen ? 'Tutup Upload GeoJSON' : 'Upload Peta PT/Afdeling'}
          </button>
        )}
      </div>

      <div className="toolbar">
        <Field label="Severity">
          <select value={filters.severity} onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value }))}>
            <option value="">Semua</option>
            <option value="NORMAL">Normal</option>
            <option value="RINGAN">Ringan</option>
            <option value="SEDANG">Sedang</option>
            <option value="BERAT">Berat</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </Field>
        <Field label="HPT (heatmap)">
          <select value={filters.hpt_id} onChange={(e) => setFilters((f) => ({ ...f, hpt_id: e.target.value }))}>
            <option value="">Semua HPT</option>
            {hptList.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label="Dari tanggal">
          <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} />
        </Field>
        <Field label="Sampai tanggal">
          <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} />
        </Field>
        <Field label=" ">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 400, paddingTop: 6 }}>
            <input type="checkbox" checked={showHeatmap} onChange={(e) => setShowHeatmap(e.target.checked)} />
            Tampilkan heatmap deteksi
          </label>
        </Field>
        <Field label=" ">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 400, paddingTop: 6 }}>
            <input type="checkbox" checked={showYieldLayer} onChange={(e) => setShowYieldLayer(e.target.checked)} />
            Layer Yield Making
          </label>
        </Field>
        <Field label=" ">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 400, paddingTop: 6 }}>
            <input type="checkbox" checked={showDefisiensiLayer} onChange={(e) => setShowDefisiensiLayer(e.target.checked)} />
            Layer Defisiensi Hara
          </label>
        </Field>
      </div>

      {uploadOpen && <GeoJsonUploadPanel onDone={() => setUploadOpen(false)} />}

      <div className="legend" style={{ marginBottom: 12 }}>
        {Object.entries({ hijau: 'Normal', kuning: 'Ringan', oranye: 'Sedang', merah: 'Berat / Critical' }).map(([k, v]) => (
          <span className="legend-item" key={k}>
            <span className="legend-dot" style={{ background: COLOR_NAME_MAP[k] }} />
            {v}
          </span>
        ))}
        {showYieldLayer && YIELD_LAYER_DEFS.map((d) => (
          <span className="legend-item" key={d.key}>
            <span className="legend-dot" style={{ background: d.color }} />
            {d.label}
          </span>
        ))}
        {showDefisiensiLayer && (
          <span className="legend-item">
            <span className="legend-dot" style={{ background: '#db2777' }} />
            Defisiensi Hara
          </span>
        )}
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: selectedId ? '1.6fr 1fr' : '1fr' }}>
        <div className="map-wrap">
          <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; OpenStreetMap contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <FitBounds bloks={filteredBloks} />
            {filteredBloks.map((b) => {
              const rings = polygonLatLngs(b.referensi_polygon);
              if (!rings) return null;
              const color = COLOR_NAME_MAP[b.color] || '#94a3b8';
              return (
                <Polygon
                  key={b.id}
                  positions={rings}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: selectedId === b.id ? 0.6 : 0.38,
                    weight: selectedId === b.id ? 3 : 1.5,
                  }}
                  eventHandlers={{ click: () => selectBlok(b.id) }}
                >
                  <Popup>
                    <strong>{b.name}</strong> ({b.code})<br />
                    {b.afdeling_name} — {b.estate_name}<br />
                    Severity: {b.severity}<br />
                    <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => selectBlok(b.id)}>Detail</button>
                  </Popup>
                </Polygon>
              );
            })}
            {showHeatmap && heatmap.map((p, idx) => (
              <CircleMarker
                key={idx}
                center={[p.lat, p.lng]}
                radius={6}
                pathOptions={{ color: COLOR_NAME_MAP[{ NORMAL: 'hijau', RINGAN: 'kuning', SEDANG: 'oranye', BERAT: 'merah', CRITICAL: 'merah' }[p.kategori] || 'hijau'], fillOpacity: 0.7 }}
              />
            ))}
            {showYieldLayer && yieldPoints.map((p, idx) => (
              <CircleMarker
                key={`yp-${idx}`}
                center={[p.gps_lat, p.gps_lng]}
                radius={5}
                pathOptions={{ color: p._color, fillColor: p._color, fillOpacity: 0.75, weight: 1 }}
              >
                <Popup>
                  <strong>{p._layer}</strong><br />
                  {fmtDate(p.tanggal)} — {p.kategori || 'belum diklasifikasi'}<br />
                  Blok #{p.blok_id}
                </Popup>
              </CircleMarker>
            ))}
            {showDefisiensiLayer && defisiensiPoints.map((p, idx) => (
              <CircleMarker
                key={`dh-${idx}`}
                center={[p.gps_lat, p.gps_lng]}
                radius={5}
                pathOptions={{ color: '#db2777', fillColor: '#db2777', fillOpacity: 0.75, weight: 1 }}
              >
                <Popup>
                  <strong>Defisiensi Hara — {p.unsur_hara || '-'}</strong><br />
                  {fmtDate(p.tanggal)} — {p.severity || '-'}<br />
                  Blok #{p.blok_id}
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>

        {selectedId && (
          <div className="card card-pad" style={{ maxHeight: 560, overflowY: 'auto' }}>
            {detailLoading && <Loading />}
            {detail && <BlokDetailPanel detail={detail} onClose={() => setSelectedId(null)} />}
          </div>
        )}
      </div>
    </div>
  );
}

function BlokDetailPanel({ detail, onClose }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h3 style={{ margin: '0 0 2px' }}>{detail.name} ({detail.code})</h3>
        <button className="close-x" onClick={onClose}>&times;</button>
      </div>
      <div className="small-muted" style={{ marginBottom: 10 }}>
        {detail.afdeling?.name} — PT #{detail.afdeling?.estate_id}
      </div>
      <div className="detail-grid">
        <div className="detail-item"><div className="dl">Luas</div><div className="dv">{fmtNum(detail.luas)} ha</div></div>
        <div className="detail-item"><div className="dl">Tahun Tanam</div><div className="dv">{detail.tahun_tanam}</div></div>
        <div className="detail-item"><div className="dl">Status Tanaman</div><div className="dv">{detail.status_tanaman}</div></div>
        <div className="detail-item"><div className="dl">Jumlah Baris</div><div className="dv">{detail.jumlah_baris}</div></div>
        <div className="detail-item"><div className="dl">HPT Dominan</div><div className="dv">{detail.hpt_dominan || '-'}</div></div>
      </div>

      <div className="section-title">Insiden Terbuka</div>
      {(!detail.open_incidents || detail.open_incidents.length === 0) ? <Empty label="Tidak ada insiden terbuka." /> : (
        detail.open_incidents.map((inc) => (
          <div className="stat-line" key={inc.id}>
            <span>{inc.incident_code}</span>
            <SeverityBadge severity={inc.severity} />
          </div>
        ))
      )}

      <div className="section-title">PIC</div>
      {(!detail.pics || detail.pics.length === 0) ? <Empty label="Belum ada PIC ditugaskan." /> : (
        detail.pics.map((p) => (
          <div className="stat-line" key={p.id}>
            <span>{p.user_name}</span>
            <span className="chip">{p.jenis_aktivitas}</span>
          </div>
        ))
      )}

      <div className="section-title">Riwayat Deteksi Terbaru</div>
      {(!detail.recent_detections || detail.recent_detections.length === 0) ? <Empty label="Belum ada deteksi." /> : (
        detail.recent_detections.slice(0, 5).map((d) => (
          <div className="stat-line" key={d.id}>
            <span>{fmtDate(d.tanggal)}</span>
            <span>{d.kategori || 'NORMAL'}</span>
          </div>
        ))
      )}

      <div className="section-title">Riwayat Sensus Terbaru</div>
      {(!detail.recent_sensus || detail.recent_sensus.length === 0) ? <Empty label="Belum ada sensus." /> : (
        detail.recent_sensus.slice(0, 5).map((d) => (
          <div className="stat-line" key={d.id}>
            <span>{fmtDate(d.tanggal)} — {d.jenis_sensus}</span>
            <SeverityBadge severity={d.kategori} />
          </div>
        ))
      )}

      <div className="section-title">Riwayat Pengendalian</div>
      {(!detail.recent_treatment || detail.recent_treatment.length === 0) ? <Empty label="Belum ada pengendalian." /> : (
        detail.recent_treatment.slice(0, 5).map((d) => (
          <div className="stat-line" key={d.id}>
            <span>{fmtDate(d.tanggal_mulai)} — {d.metode_pengendalian}</span>
            <span className="chip">{d.status}</span>
          </div>
        ))
      )}
    </div>
  );
}

function GeoJsonUploadPanel({ onDone }) {
  const [estates, setEstates] = useState([]);
  const [afdelings, setAfdelings] = useState([]);
  const [entityType, setEntityType] = useState('ESTATE');
  const [entityId, setEntityId] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [uploaded, setUploaded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    masterApi.estates.list().then(setEstates).catch(() => {});
    masterApi.afdelings.list().then(setAfdelings).catch(() => {});
  }, []);

  const options = entityType === 'ESTATE' ? estates : afdelings;

  async function handleUpload() {
    if (!file || !entityId) { setMsg('Pilih entity dan file GeoJSON terlebih dahulu.'); return; }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('entity_type', entityType);
      fd.append('entity_id', entityId);
      const res = await gisApi.uploadLayer(fd);
      setUploaded(res.data);
      const p = await gisApi.previewLayer(res.data.id);
      setPreview(p);
      setMsg(res.validation?.valid ? 'File valid. Silakan tinjau preview lalu Publish.' : `File memiliki error: ${(res.validation?.errors || []).join('; ')}`);
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Upload gagal.');
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!uploaded) return;
    setBusy(true);
    try {
      await gisApi.publishLayer(uploaded.id);
      setMsg('Layer berhasil dipublish.');
      onDone();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Publish gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <div className="section-title mt-0">Upload Peta PT/Afdeling (GeoJSON)</div>
      <div className="toolbar">
        <Field label="Tipe Entity">
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setEntityId(''); }}>
            <option value="ESTATE">PT</option>
            <option value="AFDELING">Afdeling</option>
          </select>
        </Field>
        <Field label="Entity">
          <select value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">Pilih...</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
        <Field label="File GeoJSON">
          <input type="file" accept=".json,.geojson,application/geo+json,application/json" onChange={(e) => setFile(e.target.files[0])} />
        </Field>
        <div style={{ paddingTop: 18 }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleUpload}>Upload &amp; Validasi</button>
        </div>
      </div>
      {msg && <div className="small-muted" style={{ marginBottom: 8 }}>{msg}</div>}
      {preview && (
        <div style={{ marginBottom: 10 }}>
          <div className="small-muted">Preview: {preview.geojson?.features?.length ?? (preview.geojson?.type ? 1 : 0)} feature(s), status layer: {preview.layer?.status}</div>
        </div>
      )}
      {uploaded && !uploaded.validation_errors && (
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={handlePublish}>Publish Layer</button>
      )}
    </div>
  );
}
