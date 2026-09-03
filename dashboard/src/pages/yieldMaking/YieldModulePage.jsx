import { useEffect, useMemo, useState } from 'react';
import { useMasterData } from '../../context/MasterDataContext';
import { Loading, ErrorBox, Field } from '../../components/Common';
import DataTable from '../../components/DataTable';
import Modal from '../../components/Modal';
import { SeverityBadge } from '../../components/Badges';
import { fmtDate, fmtNum } from '../../utils/format';
import LocationFilterFields from '../../components/LocationFilterFields';

const SEVERITY_OPTIONS = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];

/**
 * Shared list + detail + create-form shell for the 4 Yield Making sub-modules (SPEC_V2.md
 * section 2/4): Partenocarpi, Water Management, Bahan Organik, TBM Vegetatif. Mirrors the
 * list+detail-modal pattern of pages/Deteksi.jsx & pages/Sensus.jsx, plus a create form (this
 * task's requirement that dashboard users, not just mobile, can enter Yield Making data).
 *
 * `fields`: [{ key, label, type: 'text'|'number'|'checkbox'|'select'|'textarea', options?, wide? }]
 * describing the module-specific columns (beyond estate/afdeling/blok/tanggal/kategori/catatan
 * which are handled generically here).
 */
export default function YieldModulePage({ title, description, api, fields, listExtraKeys, canCreate, thresholdNote }) {
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [filters, setFilters] = useState({ estate_id: '', afdeling_id: '', blok_id: '', kategori: '', from: '', to: '' });

  function load() {
    setLoading(true);
    const params = { ...filters };
    Object.keys(params).forEach((k) => { if (!params[k]) delete params[k]; });
    api.list(params).then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [filters.estate_id, filters.afdeling_id, filters.blok_id, filters.kategori, filters.from, filters.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const listFields = useMemo(() => fields.filter((f) => (listExtraKeys || fields.map((x) => x.key)).includes(f.key)), [fields, listExtraKeys]);

  const columns = useMemo(() => [
    { key: 'tanggal', header: 'Tanggal', render: (r) => fmtDate(r.tanggal) },
    { key: 'blok', header: 'PT / Afdeling / Blok', render: (r) => `${md.estateName(r.estate_id)} / ${md.afdelingName(r.afdeling_id)} / ${md.blokName(r.blok_id)}` },
    ...listFields.map((f) => ({
      key: f.key,
      header: f.label,
      render: (r) => (f.type === 'checkbox' ? (r[f.key] ? 'Ya' : 'Tidak') : (r[f.key] ?? '-')),
    })),
    { key: 'kategori', header: 'Kategori', render: (r) => (r.kategori ? <SeverityBadge severity={r.kategori} /> : <span className="small-muted">Belum diklasifikasi</span>) },
    { key: 'ews_alert', header: 'EWS Alert', render: (r) => (r.ews_alert ? '🔴 Ya' : 'Tidak') },
    { key: 'petugas', header: 'Petugas', render: (r) => md.userName(r.user_id) },
    { key: 'source', header: 'Sumber', render: (r) => <span className="chip">{r.source}</span> },
  ], [md, listFields]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>+ Input Data</button>}
      </div>

      {thresholdNote && <div className="small-muted" style={{ marginBottom: 14 }}>{thresholdNote}</div>}

      <div className="toolbar">
        <LocationFilterFields filters={filters} setFilters={setFilters} md={md} />
        <Field label="Kategori">
          <select value={filters.kategori} onChange={(e) => setFilters((f) => ({ ...f, kategori: e.target.value }))}>
            <option value="">Semua</option>
            {SEVERITY_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Dari"><input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></Field>
        <Field label="Sampai"><input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : (
        <DataTable columns={columns} rows={rows} onRowClick={setSelected} emptyLabel="Belum ada data untuk filter ini." />
      )}

      {selected && (
        <Modal title={`${title} #${selected.id}`} onClose={() => setSelected(null)}>
          <div className="detail-grid">
            <div className="detail-item"><div className="dl">Tanggal</div><div className="dv">{fmtDate(selected.tanggal)}</div></div>
            <div className="detail-item"><div className="dl">PT</div><div className="dv">{md.estateName(selected.estate_id)}</div></div>
            <div className="detail-item"><div className="dl">Afdeling</div><div className="dv">{md.afdelingName(selected.afdeling_id)}</div></div>
            <div className="detail-item"><div className="dl">Blok</div><div className="dv">{md.blokName(selected.blok_id)}</div></div>
            {fields.map((f) => (
              <div className="detail-item" key={f.key}>
                <div className="dl">{f.label}</div>
                <div className="dv">{f.type === 'checkbox' ? (selected[f.key] ? 'Ya' : 'Tidak') : f.type === 'number' ? fmtNum(selected[f.key]) : (selected[f.key] ?? '-')}</div>
              </div>
            ))}
            <div className="detail-item"><div className="dl">Kategori</div><div className="dv">{selected.kategori ? <SeverityBadge severity={selected.kategori} /> : 'Belum diklasifikasi'}</div></div>
            <div className="detail-item"><div className="dl">EWS Alert</div><div className="dv">{selected.ews_alert ? 'Ya' : 'Tidak'}</div></div>
            <div className="detail-item"><div className="dl">Petugas</div><div className="dv">{md.userName(selected.user_id)}</div></div>
            <div className="detail-item"><div className="dl">GPS</div><div className="dv">{selected.gps_lat ?? '-'}, {selected.gps_lng ?? '-'}</div></div>
            <div className="detail-item"><div className="dl">Location Warning</div><div className="dv">{selected.location_warning ? 'Ya — di luar blok' : 'Tidak'}</div></div>
            <div className="detail-item"><div className="dl">Incident</div><div className="dv">{selected.incident_id ? `#${selected.incident_id}` : '-'}</div></div>
            <div className="detail-item"><div className="dl">Sumber</div><div className="dv">{selected.source}</div></div>
          </div>
          <div className="section-title">Catatan</div>
          <div className="small-muted">{selected.catatan || '-'}</div>
        </Modal>
      )}

      {creating && (
        <CreateModal
          title={title}
          api={api}
          md={md}
          fields={fields}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateModal({ title, api, md, fields, onClose, onCreated }) {
  const blank = { estate_id: '', afdeling_id: '', blok_id: '', tanggal: new Date().toISOString().slice(0, 10), catatan: '', gps_lat: '', gps_lng: '' };
  fields.forEach((f) => { blank[f.key] = f.type === 'checkbox' ? false : ''; });
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const afdelingOptions = form.estate_id ? md.afdelingsByEstate(form.estate_id) : md.afdelings;
  const blokOptions = form.afdeling_id ? md.bloksByAfdeling(form.afdeling_id) : md.bloks;

  async function handleSave(e) {
    e.preventDefault();
    if (!form.blok_id || !form.tanggal) {
      setError('Blok dan tanggal wajib diisi.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        blok_id: form.blok_id,
        afdeling_id: form.afdeling_id || undefined,
        estate_id: form.estate_id || undefined,
        tanggal: form.tanggal,
        catatan: form.catatan || undefined,
        gps_lat: form.gps_lat || undefined,
        gps_lng: form.gps_lng || undefined,
        source: 'WEB',
      };
      fields.forEach((f) => {
        let v = form[f.key];
        if (f.type === 'checkbox') v = v ? 1 : 0;
        if (f.type === 'number' && v === '') v = undefined;
        payload[f.key] = v;
      });
      const res = await api.create(payload);
      setResult(res);
      setTimeout(() => onCreated(), 900);
    } catch (err) {
      setError(err?.response?.data?.error || 'Gagal menyimpan data.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Input Data — ${title}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Batal</button>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
        </>
      }
    >
      <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="field">
          <label>PT</label>
          <select value={form.estate_id} onChange={(e) => setForm((v) => ({ ...v, estate_id: e.target.value, afdeling_id: '', blok_id: '' }))}>
            <option value="">-</option>
            {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Afdeling</label>
          <select value={form.afdeling_id} onChange={(e) => setForm((v) => ({ ...v, afdeling_id: e.target.value, blok_id: '' }))}>
            <option value="">-</option>
            {afdelingOptions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Blok *</label>
          <select required value={form.blok_id} onChange={(e) => setForm((v) => ({ ...v, blok_id: e.target.value }))}>
            <option value="">-</option>
            {blokOptions.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Tanggal *</label>
          <input type="date" required value={form.tanggal} onChange={(e) => setForm((v) => ({ ...v, tanggal: e.target.value }))} />
        </div>

        {fields.map((f) => (
          <div className="field" key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
            <label>{f.label}</label>
            {f.type === 'select' ? (
              <select value={form[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))}>
                <option value="">-</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === 'textarea' ? (
              <textarea rows={2} value={form[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))} />
            ) : f.type === 'checkbox' ? (
              <input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.checked }))} style={{ width: 18, height: 18 }} />
            ) : (
              <input type={f.type || 'text'} step={f.type === 'number' ? 'any' : undefined} value={form[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))} />
            )}
          </div>
        ))}

        <div className="field"><label>GPS Lat</label><input value={form.gps_lat} onChange={(e) => setForm((v) => ({ ...v, gps_lat: e.target.value }))} /></div>
        <div className="field"><label>GPS Lng</label><input value={form.gps_lng} onChange={(e) => setForm((v) => ({ ...v, gps_lng: e.target.value }))} /></div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label>Catatan</label>
          <textarea rows={2} value={form.catatan} onChange={(e) => setForm((v) => ({ ...v, catatan: e.target.value }))} />
        </div>
      </form>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
      {result && (
        <div className="small-muted" style={{ marginTop: 10 }}>
          Tersimpan. Klasifikasi: <strong>{result.classification?.kategori || 'belum ada rule aktif'}</strong>
          {result.classification?.ews_alert ? ' — 🔴 EWS Alert dibuat.' : ''}
          {result.location_warning ? ' — ⚠️ lokasi di luar blok.' : ''}
        </div>
      )}
    </Modal>
  );
}
