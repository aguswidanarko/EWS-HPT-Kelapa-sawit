import { useEffect, useMemo, useState } from 'react';
import { mortalityApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../components/Common';
import DataTable from '../components/DataTable';
import Modal from '../components/Modal';
import { StatusBadge } from '../components/Badges';
import { fmtDate, fmtNum } from '../utils/format';

export default function Mortalitas() {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({ service_required: '', hasil_efektivitas: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    mortalityApi.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.service_required, filters.hasil_efektivitas]);

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'Blok', render: (r) => r.blok_id ? md.blokName(r.blok_id) : (r.blok || '-') },
    { key: 'sampel', header: 'Sampel' },
    { key: 'jumlah_hidup', header: 'Hidup' },
    { key: 'jumlah_mati', header: 'Mati' },
    { key: 'hasil_efektivitas', header: 'Efektivitas', render: (r) => <StatusBadge status={r.hasil_efektivitas} /> },
    { key: 'service_required', header: 'Perlu Service', render: (r) => r.service_required ? '⚠ Ya' : 'Tidak' },
    { key: 'status', header: 'Status' },
  ], [md]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Mortalitas</h1>
          <p>Sensus mortalitas pasca-treatment — evaluasi efektivitas pengendalian dan kebutuhan service ulang.</p>
        </div>
      </div>

      <div className="toolbar">
        <Field label="Perlu Service">
          <select value={filters.service_required} onChange={(e) => setFilters((f) => ({ ...f, service_required: e.target.value }))}>
            <option value="">Semua</option>
            <option value="1">Ya</option>
            <option value="0">Tidak</option>
          </select>
        </Field>
        <Field label="Efektivitas">
          <select value={filters.hasil_efektivitas} onChange={(e) => setFilters((f) => ({ ...f, hasil_efektivitas: e.target.value }))}>
            <option value="">Semua</option>
            <option value="EFEKTIF">EFEKTIF</option>
            <option value="TIDAK_EFEKTIF">TIDAK_EFEKTIF</option>
          </select>
        </Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : (
        <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Belum ada data mortalitas." />
      )}

      {selected && (
        <Modal title={`Mortalitas #${selected.id}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{selected.incident_id ? `#${selected.incident_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">Treatment</div><div className="dv">{selected.treatment_id ? `#${selected.treatment_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">Tanggal</div><div className="dv">{fmtDate(selected.tanggal)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{selected.blok_id ? md.blokName(selected.blok_id) : (selected.blok || '-')}</div></div>
            <div className="detail-item"><div className="dl">Sampel</div><div className="dv">{fmtNum(selected.sampel)}</div></div>
            <div className="detail-item"><div className="dl">Jumlah Hidup</div><div className="dv">{fmtNum(selected.jumlah_hidup)}</div></div>
            <div className="detail-item"><div className="dl">Jumlah Mati</div><div className="dv">{fmtNum(selected.jumlah_mati)}</div></div>
            <div className="detail-item"><div className="dl">Kondisi</div><div className="dv">{selected.kondisi || '-'}</div></div>
            <div className="detail-item"><div className="dl">Hasil Efektivitas</div><div className="dv"><StatusBadge status={selected.hasil_efektivitas} /></div></div>
            <div className="detail-item"><div className="dl">Perlu Service</div><div className="dv">{selected.service_required ? 'Ya' : 'Tidak'}</div></div>
            <div className="detail-item"><div className="dl">Status</div><div className="dv">{selected.status}</div></div>
            <div className="detail-item"><div className="dl">Sumber</div><div className="dv">{selected.source}</div></div>
          </div>
        </Modal>
      )}
    </div>
  );
}
