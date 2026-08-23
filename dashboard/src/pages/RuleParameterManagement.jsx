import { useState } from 'react';
import { formulasApi, samplingRulesApi, schedulingRulesApi, masterApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageRules } from '../context/AuthContext';
import MasterCrud from '../components/MasterCrud';
import FormulaPreviewPanel from '../components/FormulaPreviewPanel';

const TABS = ['Formula', 'Threshold', 'Sampling Rule', 'Scheduling Rule'];
const FORMULA_TYPES = ['COUNT_TOTAL', 'PERCENTAGE', 'THRESHOLD', 'DURATION', 'DATE_INTERVAL', 'RAINFALL_ACCUMULATION', 'MINIMUM_SAMPLE', 'CATEGORICAL_CONDITION', 'AND_OR'];
const UNIT_SCOPE = ['BARIS_SAMPEL', 'GRID', 'SELURUH_POKOK', 'GAWANGAN', 'KUALITATIF'];
const JENIS_KEGIATAN = ['DETEKSI', 'SENSUS'];
const INTERVAL_TYPE = ['DAILY', 'BIWEEKLY', 'MONTHLY', 'CUSTOM'];
const INTERVAL_UNIT = ['DAY', 'WEEK', 'MONTH'];
const BASED_ON = ['LAST_INSPECTION', 'FIXED_DATE'];

export default function RuleParameterManagement() {
  const { user } = useAuth();
  const md = useMasterData();
  const [tab, setTab] = useState('Formula');
  const canWrite = canManageRules(user);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Rule &amp; Parameter Management</h1>
          <p>Konfigurasi generik pengganti hard-code V1: Formula, Threshold, Sampling Rule, dan Scheduling Rule — semua data-driven, tanpa redeploy.</p>
        </div>
      </div>

      <div className="small-muted" style={{ marginBottom: 14 }}>
        Versi rule dilacak otomatis lewat ledger <code>rule_version</code> setiap kali sebuah hasil (deteksi/sensus/yield making) diklasifikasi — snapshot itu tersimpan sebagai <code>rule_version_id</code> pada data lapangan terkait, bukan sebagai halaman CRUD tersendiri. Kolom <em>effective_date</em> / <em>diperbarui</em> di bawah adalah acuan versi konfigurasi saat ini.
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button key={t} className={'tab-btn' + (tab === t ? ' active' : '')} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Formula' && (
        <>
          <MasterCrud
            title="Formula"
            description="Definisi rumus generik per indikator (formula_type + expression_json), menggantikan hard-code V1. Satu hpt_id bisa punya >1 formula dibedakan lewat context (mis. DETEKSI vs SENSUS)."
            canWrite={canWrite}
            api={formulasApi}
            columns={[
              { key: 'hpt_id', header: 'Indikator', render: (r) => md.hptName(r.hpt_id) },
              { key: 'formula_type', header: 'Tipe' },
              { key: 'context', header: 'Konteks' },
              { key: 'unit', header: 'Satuan' },
              { key: 'active', header: 'Aktif', render: (r) => (r.active ? 'Ya' : 'Tidak') },
              { key: 'updated_at', header: 'Diperbarui' },
            ]}
            fields={[
              { key: 'hpt_id', label: 'Indikator', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: `${h.name} (${h.indicator_type || 'HPT'})` })) },
              { key: 'formula_type', label: 'Tipe Formula', type: 'select', required: true, options: FORMULA_TYPES.map((t) => ({ value: t, label: t })) },
              { key: 'context', label: 'Konteks', type: 'select', options: [{ value: 'DETEKSI', label: 'Deteksi' }, { value: 'SENSUS', label: 'Sensus' }] },
              { key: 'expression_json', label: 'Expression (JSON)', type: 'textarea', required: true, wide: true },
              { key: 'unit', label: 'Satuan' },
              { key: 'description', label: 'Deskripsi', type: 'textarea', wide: true },
              { key: 'active', label: 'Aktif', type: 'checkbox' },
            ]}
          />
          <FormulaPreviewPanel />
        </>
      )}

      {tab === 'Threshold' && (
        <MasterCrud
          title="Threshold"
          description="Configurable per HPT/spesies/fase tanaman/kategori — sumber tunggal klasifikasi & incident engine (V1, dipakai bersama seluruh indikator V2)."
          canWrite={canWrite}
          api={masterApi.thresholds}
          onChanged={md.reload}
          columns={[
            { key: 'hpt_id', header: 'Indikator', render: (r) => md.hptName(r.hpt_id) },
            { key: 'species_id', header: 'Species', render: (r) => (r.species_id ? md.speciesName(r.species_id) : 'Semua') },
            { key: 'fase_tanaman', header: 'Fase' },
            { key: 'kategori', header: 'Kategori' },
            { key: 'nilai_min', header: 'Min' },
            { key: 'nilai_max', header: 'Max' },
            { key: 'severity', header: 'Severity' },
            { key: 'effective_date', header: 'Berlaku Sejak' },
            { key: 'status', header: 'Status' },
          ]}
          fields={[
            { key: 'hpt_id', label: 'Indikator', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
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

      {tab === 'Sampling Rule' && (
        <MasterCrud
          title="Sampling Rule"
          description="Master metode sensus per indikator (baris sampel/grid/seluruh pokok/gawangan/kualitatif), melengkapi blok.parameter_sampling_json."
          canWrite={canWrite}
          api={samplingRulesApi}
          columns={[
            { key: 'hpt_id', header: 'Indikator', render: (r) => md.hptName(r.hpt_id) },
            { key: 'method', header: 'Metode' },
            { key: 'unit_scope', header: 'Unit Scope' },
            { key: 'row_start', header: 'Baris Mulai' },
            { key: 'row_interval', header: 'Interval Baris' },
            { key: 'plant_start', header: 'Pokok Mulai' },
            { key: 'plant_interval', header: 'Interval Pokok' },
            { key: 'minimum_sample', header: 'Min. Sampel' },
            { key: 'active', header: 'Aktif', render: (r) => (r.active ? 'Ya' : 'Tidak') },
          ]}
          fields={[
            { key: 'hpt_id', label: 'Indikator', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
            { key: 'method', label: 'Metode', type: 'select', options: UNIT_SCOPE.map((u) => ({ value: u, label: u })) },
            { key: 'unit_scope', label: 'Unit Scope', type: 'select', options: UNIT_SCOPE.map((u) => ({ value: u, label: u })) },
            { key: 'row_start', label: 'Baris Mulai', type: 'number' },
            { key: 'row_interval', label: 'Interval Baris', type: 'number' },
            { key: 'plant_start', label: 'Pokok Mulai', type: 'number' },
            { key: 'plant_interval', label: 'Interval Pokok', type: 'number' },
            { key: 'minimum_sample', label: 'Minimum Sampel', type: 'number' },
            { key: 'description', label: 'Deskripsi', type: 'textarea', wide: true },
            { key: 'active', label: 'Aktif', type: 'checkbox' },
          ]}
        />
      )}

      {tab === 'Scheduling Rule' && (
        <MasterCrud
          title="Scheduling Rule"
          description="Interval jadwal generik per indikator (mis. Deteksi HPT 2 minggu, UPDKS sensus bulanan, Rayap 2 bulan, Ganoderma semester) — dipakai Monitoring Schedule untuk generate jadwal."
          canWrite={canWrite}
          api={schedulingRulesApi}
          columns={[
            { key: 'hpt_id', header: 'Indikator', render: (r) => md.hptName(r.hpt_id) },
            { key: 'jenis_kegiatan', header: 'Jenis Kegiatan' },
            { key: 'interval_type', header: 'Tipe Interval' },
            { key: 'interval_value', header: 'Nilai' },
            { key: 'interval_unit', header: 'Unit (CUSTOM)' },
            { key: 'based_on', header: 'Berdasarkan' },
            { key: 'active', header: 'Aktif', render: (r) => (r.active ? 'Ya' : 'Tidak') },
          ]}
          fields={[
            { key: 'hpt_id', label: 'Indikator', type: 'select', required: true, options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
            { key: 'jenis_kegiatan', label: 'Jenis Kegiatan', type: 'select', options: JENIS_KEGIATAN.map((j) => ({ value: j, label: j })) },
            { key: 'interval_type', label: 'Tipe Interval', type: 'select', required: true, options: INTERVAL_TYPE.map((t) => ({ value: t, label: t })) },
            { key: 'interval_value', label: 'Nilai Interval', type: 'number' },
            { key: 'interval_unit', label: 'Unit (jika CUSTOM)', type: 'select', options: INTERVAL_UNIT.map((u) => ({ value: u, label: u })) },
            { key: 'based_on', label: 'Berdasarkan', type: 'select', options: BASED_ON.map((b) => ({ value: b, label: b })) },
            { key: 'active', label: 'Aktif', type: 'checkbox' },
          ]}
        />
      )}
    </div>
  );
}
