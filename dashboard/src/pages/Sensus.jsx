import { useEffect, useMemo, useState } from 'react';
import { sensusApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { SeverityBadge } from '../components/Badges';
import { fmtDate, fmtNum, safeJsonParse } from '../utils/format';
import LocationFilterFields from '../components/LocationFilterFields';

const JENIS_SENSUS = ['UPDKS', 'TIKUS', 'ORYCTES', 'RAYAP', 'GANODERMA'];

export default function Sensus() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ estate_id: '', afdeling_id: '', blok_id: '', jenis_sensus: '', kategori: '', from: '', to: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    sensusApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.estate_id, filters.afdeling_id, filters.blok_id, filters.jenis_sensus, filters.kategori, filters.from, filters.to]);

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'Estate / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
    { key: 'jenis_sensus', header: 'Jenis Sensus (HPT)' },
    { key: 'hasil_hitung', header: 'Hasil', render: (r) => fmtNum(r.hasil_hitung) },
    { key: 'kategori', header: 'Kategori', render: (r) => <SeverityBadge severity={r.kategori} /> },
    { key: 'ews_alert', header: 'EWS Alert', render: (r) => r.ews_alert ? '🔴 Ya' : 'Tidak' },
    { key: 'petugas', header: 'Petugas', render: (r) => md.userName(r.user_id) },
    { key: 'source', header: 'Sumber', render: (r) => <span className="chip">{r.source}</span> },
  ], [md]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Sensus</h1>
          <p>Hasil sensus per metode HPT (baris sampel / grid / seluruh pokok), lengkap dengan kategori hasil klasifikasi threshold.</p>
        </div>
      </div>

      <div className="toolbar">
        <LocationFilterFields filters={filters} setFilters={setFilters} md={md} />
        <Field label="Jenis Sensus (HPT)">
          <select value={filters.jenis_sensus} onChange={(e) => setFilters((f) => ({ ...f, jenis_sensus: e.target.value }))}>
            <option value="">Semua</option>
            {JENIS_SENSUS.map((j) => <option key={j} value={j}>{j}</option>)}
          </select>
        </Field>
        <Field label="Kategori">
          <select value={filters.kategori} onChange={(e) => setFilters((f) => ({ ...f, kategori: e.target.value }))}>
            <option value="">Semua</option>
            {['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Dari"><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></Field>
        <Field label="Sampai"><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : (
        <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Tidak ada data sensus untuk filter ini." />
      )}

      {selected && (
        <Modal title={`Sensus #${selected.id} — ${selected.jenis_sensus}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Tanggal</div><div className="dv">{fmtDate(selected.tanggal)}</div></div>
            <div className="detail-item"><div className="dl">Estate</div><div className="dv">{md.estateName(selected.estate_id)}</div></div>
            <div className="detail-item"><div className="dl">Afdeling</div><div className="dv">{md.afdelingName(selected.afdeling_id)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(selected.blok_id)}</div></div>
            <div className="detail-item"><div className="dl">Jenis Sensus</div><div className="dv">{selected.jenis_sensus}</div></div>
            <div className="detail-item"><div className="dl">Spesies</div><div className="dv">{selected.species_id ? md.speciesName(selected.species_id) : '-'}</div></div>
            <div className="detail-item"><div className="dl">Hasil Hitung</div><div className="dv">{fmtNum(selected.hasil_hitung)}</div></div>
            <div className="detail-item"><div className="dl">Kategori</div><div className="dv"><SeverityBadge severity={selected.kategori} /></div></div>
            <div className="detail-item"><div className="dl">EWS Alert</div><div className="dv">{selected.ews_alert ? 'Ya' : 'Tidak'}</div></div>
            <div className="detail-item"><div className="dl">Petugas</div><div className="dv">{md.userName(selected.user_id)}</div></div>
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{selected.incident_id ? `#${selected.incident_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">Sumber</div><div className="dv">{selected.source}</div></div>
          </div>
          <div className="section-title">Sampel / Metode (raw hasil)</div>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                {Object.entries(safeJsonParse(selected.hasil_json, {}) || {}).map(([k, v]) => (
                  <tr key={k}><td style={{ fontWeight: 600 }}>{k}</td><td>{String(v)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="section-title">Saran Pengendalian</div>
          <div className="small-muted">{selected.saran_pengendalian || '-'}</div>
          <div className="section-title">Catatan</div>
          <div className="small-muted">{selected.catatan || '-'}</div>
        </Modal>
      )}
    </div>
  );
}
