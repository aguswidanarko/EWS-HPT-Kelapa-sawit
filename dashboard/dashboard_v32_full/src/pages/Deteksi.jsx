import { useEffect, useMemo, useState } from 'react';
import { detectionsApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { SeverityBadge } from '../components/Badges';
import { fmtDate, fmtNum } from '../utils/format';
import LocationFilterFields from '../components/LocationFilterFields';

export default function Deteksi() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ estate_id: '', afdeling_id: '', blok_id: '', hpt_id: '', kategori: '', from: '', to: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    detectionsApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.estate_id, filters.afdeling_id, filters.blok_id, filters.hpt_id, filters.kategori, filters.from, filters.to]);

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'PT / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
    { key: 'hpt', header: 'HPT', render: (r) => md.hptName(r.hpt_id) },
    { key: 'kondisi_indikator', header: 'Kondisi' },
    { key: 'jumlah_indikasi', header: 'Jumlah Indikasi', render: (r) => fmtNum(r.jumlah_indikasi) },
    { key: 'kategori', header: 'Severity', render: (r) => <SeverityBadge severity={r.kategori} /> },
    { key: 'petugas', header: 'Petugas', render: (r) => md.userName(r.user_id) },
    { key: 'source', header: 'Sumber', render: (r) => <span className="chip">{r.source}</span> },
  ], [md]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Deteksi</h1>
          <p>Data deteksi lapangan (3 pertanyaan dasar) dari petugas di seluruh estate. Input dilakukan lewat aplikasi mobile.</p>
        </div>
      </div>

      <div className="toolbar">
        <LocationFilterFields filters={filters} setFilters={setFilters} md={md} />
        <Field label="HPT">
          <select value={filters.hpt_id} onChange={(e) => setFilters((f) => ({ ...f, hpt_id: e.target.value }))}>
            <option value="">Semua</option>
            {md.hpt.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label="Severity">
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
        <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Tidak ada data deteksi untuk filter ini." />
      )}

      {selected && (
        <Modal title={`Deteksi #${selected.id}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Tanggal / Waktu</div><div className="dv">{fmtDate(selected.tanggal)} {selected.waktu || ''}</div></div>
            <div className="detail-item"><div className="dl">PT</div><div className="dv">{md.estateName(selected.estate_id)}</div></div>
            <div className="detail-item"><div className="dl">Afdeling</div><div className="dv">{md.afdelingName(selected.afdeling_id)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(selected.blok_id)}</div></div>
            <div className="detail-item"><div className="dl">Baris / Posisi</div><div className="dv">{selected.baris ?? '-'} / {selected.posisi ?? '-'}</div></div>
            <div className="detail-item"><div className="dl">HPT</div><div className="dv">{md.hptName(selected.hpt_id)}</div></div>
            <div className="detail-item"><div className="dl">Kondisi Indikator</div><div className="dv">{selected.kondisi_indikator || '-'}</div></div>
            <div className="detail-item"><div className="dl">Jumlah Indikasi</div><div className="dv">{fmtNum(selected.jumlah_indikasi)}</div></div>
            <div className="detail-item"><div className="dl">Severity</div><div className="dv"><SeverityBadge severity={selected.kategori} /></div></div>
            <div className="detail-item"><div className="dl">Petugas</div><div className="dv">{md.userName(selected.user_id)}</div></div>
            <div className="detail-item"><div className="dl">GPS</div><div className="dv">{selected.gps_lat}, {selected.gps_lng}</div></div>
            <div className="detail-item"><div className="dl">Location Warning</div><div className="dv">{selected.location_warning ? 'Ya — di luar blok' : 'Tidak'}</div></div>
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{selected.incident_id ? `#${selected.incident_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">Sumber</div><div className="dv">{selected.source}</div></div>
            <div className="detail-item"><div className="dl">Sync Status</div><div className="dv">{selected.sync_status}</div></div>
          </div>
          <div className="section-title">Gejala / Catatan</div>
          <div className="small-muted">{selected.gejala || '-'}</div>
          <div className="small-muted" style={{ marginTop: 6 }}>{selected.catatan || ''}</div>
        </Modal>
      )}
    </div>
  );
}
