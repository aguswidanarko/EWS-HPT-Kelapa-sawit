import { useState } from 'react';
import { masterApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canWriteMaster, canWriteMasterHptThreshold } from '../context/AuthContext';
import MasterCrud from '../components/MasterCrud';

const TABS = ['Estate', 'Afdeling', 'Blok', 'Indikator', 'Kategori Indikator', 'Species', 'Threshold'];
const INDICATOR_TYPES = ['HPT', 'YIELD_MAKING', 'AGRONOMY', 'DEFISIENSI_HARA'];

export default function MasterData() {
  const { user } = useAuth();
  const md = useMasterData();
  const [tab, setTab] = useState('Estate');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Master Data</h1>
          <p>Estate, Afdeling, Blok, HPT, Species, dan Threshold — semua configurable, tidak hard-coded di aplikasi.</p>
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Estate' && (
        <MasterCrud
          title="Estate"
          canWrite={canWriteMaster(user)}
          api={masterApi.estates}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
          ]}
          fields={[
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
          ]}
        />
      )}

      {tab === 'Afdeling' && (
        <MasterCrud
          title="Afdeling"
          canWrite={canWriteMaster(user)}
          api={masterApi.afdelings}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
            { key: 'estate_id', header: 'Estate', render: (r) => md.estateName(r.estate_id) },
          ]}
          fields={[
            { key: 'estate_id', label: 'Estate', type: 'select', required: true, options: md.estates.map((e) => ({ value: e.id, label: e.name })) },
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
          ]}
        />
      )}

      {tab === 'Blok' && (
        <MasterCrud
          title="Blok"
          canWrite={canWriteMaster(user)}
          api={masterApi.bloks}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
            { key: 'afdeling_id', header: 'Afdeling', render: (r) => md.afdelingName(r.afdeling_id) },
            { key: 'luas', header: 'Luas (ha)' },
            { key: 'tahun_tanam', header: 'Tahun Tanam' },
            { key: 'status_tanaman', header: 'Status Tanaman' },
            { key: 'jumlah_baris', header: 'Jml Baris' },
          ]}
          fields={[
            { key: 'afdeling_id', label: 'Afdeling', type: 'select', required: true, options: md.afdelings.map((a) => ({ value: a.id, label: a.name })) },
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
            { key: 'luas', label: 'Luas (ha)', type: 'number' },
            { key: 'tahun_tanam', label: 'Tahun Tanam', type: 'number' },
            { key: 'status_tanaman', label: 'Status Tanaman', type: 'select', options: [
              { value: 'TBM1', label: 'TBM1' }, { value: 'TBM2', label: 'TBM2' }, { value: 'TBM3', label: 'TBM3' }, { value: 'TM', label: 'TM' },
            ] },
            { key: 'jumlah_baris', label: 'Jumlah Baris', type: 'number' },
            { key: 'referensi_polygon', label: 'Referensi Polygon (GeoJSON geometry)', type: 'textarea', wide: true },
            { key: 'parameter_sampling_json', label: 'Parameter Sampling (JSON)', type: 'textarea', wide: true },
          ]}
        />
      )}

      {tab === 'Indikator' && (
        <MasterCrud
          title="Indikator"
          description="Generalisasi dari 'Master HPT' V1 (SPEC_V2.md section 2): tabel hpt dipakai ulang sebagai tabel indikator EWS generik lewat kolom indicator_type + category_id, mencakup HPT, Yield Making, Agronomy, dan Defisiensi Hara."
          canWrite={canWriteMasterHptThreshold(user)}
          api={masterApi.hpt}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
            { key: 'indicator_type', header: 'Tipe Indikator', render: (r) => r.indicator_type || 'HPT' },
            { key: 'category_id', header: 'Kategori', render: (r) => (r.category_id ? md.ewsCategoryName(r.category_id) : '-') },
            { key: 'kategori', header: 'Kategori HPT' },
            { key: 'satuan', header: 'Satuan' },
            { key: 'status_aktif', header: 'Aktif', render: (r) => r.status_aktif ? 'Ya' : 'Tidak' },
          ]}
          fields={[
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
            { key: 'nama_lokal', label: 'Nama Lokal' },
            { key: 'indicator_type', label: 'Tipe Indikator', type: 'select', options: INDICATOR_TYPES.map((t) => ({ value: t, label: t })) },
            { key: 'category_id', label: 'Kategori Indikator', type: 'select', options: md.ewsCategories.map((c) => ({ value: c.id, label: c.name })) },
            { key: 'kategori', label: 'Kategori HPT (Hama/Penyakit — khusus indicator_type=HPT)', type: 'select', options: [{ value: 'HAMA', label: 'Hama' }, { value: 'PENYAKIT', label: 'Penyakit' }] },
            { key: 'status_aktif', label: 'Status Aktif', type: 'checkbox' },
            { key: 'satuan', label: 'Satuan' },
            { key: 'metode_deteksi', label: 'Metode Deteksi' },
            { key: 'metode_sensus', label: 'Metode Sensus', type: 'select', options: [{ value: 'BARIS_SAMPEL', label: 'Baris Sampel' }, { value: 'GRID', label: 'Grid' }, { value: 'SELURUH_POKOK', label: 'Seluruh Pokok' }] },
            { key: 'deskripsi', label: 'Deskripsi', type: 'textarea', wide: true },
            { key: 'gejala', label: 'Gejala', type: 'textarea', wide: true },
            { key: 'threshold_default', label: 'Threshold Default (ket.)', type: 'textarea', wide: true },
            { key: 'panduan_md', label: 'Panduan (Markdown)', type: 'textarea', wide: true },
          ]}
        />
      )}

      {tab === 'Kategori Indikator' && (
        <MasterCrud
          title="Kategori Indikator (ews_category)"
          description="Payung kategori indikator EWS: HPT, YIELD_MAKING, AGRONOMY, DEFISIENSI_HARA (SPEC_V2.md section 2)."
          canWrite={canWriteMasterHptThreshold(user)}
          api={masterApi.ewsCategories}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
          ]}
          fields={[
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
          ]}
        />
      )}

      {tab === 'Species' && (
        <MasterCrud
          title="Species"
          description="Identifikasi spesies untuk HPT tertentu, mis. kelompok Ulat Api vs Ulat Kantong pada UPDKS."
          canWrite={canWriteMasterHptThreshold(user)}
          api={masterApi.species}
          onChanged={md.reload}
          columns={[
            { key: 'code', header: 'Kode' },
            { key: 'name', header: 'Nama' },
            { key: 'hpt_id', header: 'HPT', render: (r) => md.hptName(r.hpt_id) },
            { key: 'group_name', header: 'Group' },
          ]}
          fields={[
            { key: 'hpt_id', label: 'HPT', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
            { key: 'code', label: 'Kode', required: true },
            { key: 'name', label: 'Nama', required: true },
            { key: 'group_name', label: 'Group Name' },
          ]}
        />
      )}

      {tab === 'Threshold' && (
        <MasterCrud
          title="Threshold"
          description="Configurable per HPT/spesies/fase tanaman/kategori — sumber tunggal untuk klasifikasi & incident engine."
          canWrite={canWriteMasterHptThreshold(user)}
          api={masterApi.thresholds}
          onChanged={md.reload}
          columns={[
            { key: 'hpt_id', header: 'HPT', render: (r) => md.hptName(r.hpt_id) },
            { key: 'species_id', header: 'Species', render: (r) => r.species_id ? md.speciesName(r.species_id) : 'Semua' },
            { key: 'fase_tanaman', header: 'Fase' },
            { key: 'kategori', header: 'Kategori' },
            { key: 'nilai_min', header: 'Min' },
            { key: 'nilai_max', header: 'Max' },
            { key: 'severity', header: 'Severity' },
            { key: 'effective_date', header: 'Berlaku' },
            { key: 'status', header: 'Status' },
          ]}
          fields={[
            { key: 'hpt_id', label: 'HPT', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
            { key: 'species_id', label: 'Species (kosongkan = semua)', type: 'select', options: md.species.map((s) => ({ value: s.id, label: s.name })) },
            { key: 'fase_tanaman', label: 'Fase Tanaman', type: 'select', options: [
              { value: 'SEMUA', label: 'Semua' }, { value: 'TBM1', label: 'TBM1' }, { value: 'TBM2', label: 'TBM2' }, { value: 'TBM3', label: 'TBM3' }, { value: 'TM', label: 'TM' },
            ] },
            { key: 'kategori', label: 'Kategori', required: true },
            { key: 'nilai_min', label: 'Nilai Min', type: 'number' },
            { key: 'nilai_max', label: 'Nilai Max', type: 'number' },
            { key: 'satuan', label: 'Satuan' },
            { key: 'tindakan', label: 'Tindakan', type: 'textarea', wide: true },
            { key: 'severity', label: 'Severity', type: 'select', required: true, options: ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'].map((s) => ({ value: s, label: s })) },
            { key: 'effective_date', label: 'Tanggal Berlaku', type: 'date', required: true },
            { key: 'status', label: 'Status', type: 'select', options: [{ value: 'AKTIF', label: 'Aktif' }, { value: 'NONAKTIF', label: 'Nonaktif' }] },
          ]}
        />
      )}
    </div>
  );
}
