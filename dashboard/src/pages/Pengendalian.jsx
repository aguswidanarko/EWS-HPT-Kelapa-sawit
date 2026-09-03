import { useEffect, useMemo, useState } from 'react';
import { treatmentApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { StatusBadge } from '../components/Badges';
import { fmtDate, fmtNum } from '../utils/format';
import LocationFilterFields from '../components/LocationFilterFields';

const STATUS_OPTIONS = ['ONGOING', 'COMPLETED', 'DIBATALKAN'];

export default function Pengendalian() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ estate_id: '', afdeling_id: '', blok_id: '', hpt_id: '', status: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    treatmentApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.estate_id, filters.afdeling_id, filters.blok_id, filters.hpt_id, filters.status]);

  const columns = useMemo(() => [
    { key: 'tanggal_mulai', header: 'Mulai', render: (r) => fmtDate(r.tanggal_mulai) },
    { key: 'tanggal_selesai', header: 'Selesai', render: (r) => fmtDate(r.tanggal_selesai) },
    { key: 'blok', header: 'PT / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
    { key: 'hpt', header: 'HPT', render: (r) => md.hptName(r.hpt_id) },
    { key: 'metode_pengendalian', header: 'Metode' },
    { key: 'luas_serangan', header: 'Luas Serangan', render: (r) => fmtNum(r.luas_serangan) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'pic', header: 'PIC' },
  ], [md]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Pengendalian</h1>
          <p>Kegiatan treatment (drone spraying, fogging, manual, racun tikus, dsb.) terkait insiden EWS.</p>
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
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Semua</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : (
        <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Belum ada data pengendalian." />
      )}

      {selected && (
        <Modal title={`Pengendalian #${selected.id}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{selected.incident_id ? `#${selected.incident_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">HPT</div><div className="dv">{md.hptName(selected.hpt_id)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(selected.blok_id)}</div></div>
            <div className="detail-item"><div className="dl">Luas Serangan</div><div className="dv">{fmtNum(selected.luas_serangan)} ha</div></div>
            <div className="detail-item"><div className="dl">Metode</div><div className="dv">{selected.metode_pengendalian}</div></div>
            <div className="detail-item"><div className="dl">Tanggal Mulai</div><div className="dv">{fmtDate(selected.tanggal_mulai)}</div></div>
            <div className="detail-item"><div className="dl">Tanggal Selesai</div><div className="dv">{fmtDate(selected.tanggal_selesai)}</div></div>
            <div className="detail-item"><div className="dl">Jumlah Pokok</div><div className="dv">{fmtNum(selected.jumlah_pokok)}</div></div>
            <div className="detail-item"><div className="dl">HK</div><div className="dv">{fmtNum(selected.hk)}</div></div>
            <div className="detail-item"><div className="dl">Material</div><div className="dv">{selected.material || '-'} ({fmtNum(selected.jumlah_material)})</div></div>
            <div className="detail-item"><div className="dl">Alat</div><div className="dv">{selected.alat || '-'}</div></div>
            <div className="detail-item"><div className="dl">PIC</div><div className="dv">{selected.pic || '-'}</div></div>
            <div className="detail-item"><div className="dl">Status</div><div className="dv"><StatusBadge status={selected.status} /></div></div>
            <div className="detail-item"><div className="dl">Sumber</div><div className="dv">{selected.source}</div></div>
          </div>
          <div className="section-title">Catatan</div>
          <div className="small-muted">{selected.catatan || '-'}</div>
        </Modal>
      )}
    </div>
  );
}
