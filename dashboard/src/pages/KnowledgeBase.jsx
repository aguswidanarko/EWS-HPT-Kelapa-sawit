import { useEffect, useMemo, useState } from 'react';
import { kbApi } from '../api/resources';
import client from '../api/client';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageKb } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { fmtDate } from '../utils/format';

const KATEGORI_OPTIONS = ['SOP', 'Deteksi', 'Sensus', 'Pengendalian', 'Mortalitas', 'Threshold', 'Gejala', 'Foto', 'Materi Pelatihan'];

export default function KnowledgeBase() {
  const { user } = useAuth();
  const md = useMasterData();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [kategoriFilter, setKategoriFilter] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [downloading, setDownloading] = useState(null);

  function load() {
    setLoading(true);
    kbApi.list().then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const grouped = useMemo(() => {
    const filtered = kategoriFilter ? rows.filter((r) => r.kategori === kategoriFilter) : rows;
    const g = {};
    filtered.forEach((r) => {
      const k = r.kategori || 'Lainnya';
      g[k] = g[k] || [];
      g[k].push(r);
    });
    return g;
  }, [rows, kategoriFilter]);

  async function handleDownload(row) {
    setDownloading(row.id);
    try {
      const res = await client.get(`/knowledge-base/${row.id}/file`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      window.open(url, '_blank');
    } catch (err) {
      alert('Gagal mengunduh file: ' + (err?.response?.data?.error || err.message));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Knowledge Base</h1>
          <p>SOP, panduan deteksi/sensus/pengendalian, gejala, threshold — tersinkron ke aplikasi mobile setelah dipublish.</p>
        </div>
        {canManageKb(user) && <button className="btn btn-primary" onClick={() => setShowUpload((v) => !v)}>{showUpload ? 'Tutup Form' : '+ Upload Dokumen'}</button>}
      </div>

      {showUpload && <UploadForm hptList={md.hpt} onDone={() => { setShowUpload(false); load(); }} />}

      <div className="toolbar">
        <Field label="Kategori">
          <select value={kategoriFilter} onChange={(e) => setKategoriFilter(e.target.value)}>
            <option value="">Semua</option>
            {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : Object.keys(grouped).length === 0 ? <Empty label="Belum ada dokumen." /> : (
        Object.entries(grouped).map(([kategori, docs]) => (
          <div key={kategori} style={{ marginBottom: 22 }}>
            <div className="section-title mt-0">{kategori}</div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th>Judul</th><th>HPT</th><th>Versi</th><th>Berlaku</th><th>Status</th><th>Tipe File</th><th></th></tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id}>
                      <td>{d.judul}</td>
                      <td>{d.hpt_id ? md.hptName(d.hpt_id) : '-'}</td>
                      <td>v{d.versi}</td>
                      <td>{fmtDate(d.tanggal_berlaku)}</td>
                      <td>{d.status_aktif ? <span className="chip" style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}>Aktif / Published</span> : <span className="chip">Nonaktif</span>}</td>
                      <td>{d.file_type || '-'}</td>
                      <td><button className="btn btn-sm" disabled={downloading === d.id} onClick={() => handleDownload(d)}>{downloading === d.id ? '...' : 'Unduh'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function UploadForm({ hptList, onDone }) {
  const [form, setForm] = useState({ judul: '', kategori: 'SOP', hpt_id: '', versi: '1.0', tanggal_berlaku: '', status_aktif: true });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, k === 'status_aktif' ? (v ? '1' : '0') : v));
      if (file) fd.append('file', file);
      await kbApi.upload(fd);
      setMsg('Dokumen berhasil diupload & dipublish.');
      onDone();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Upload gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card card-pad" style={{ marginBottom: 16 }} onSubmit={submit}>
      <div className="section-title mt-0">Upload Dokumen Baru</div>
      <div className="toolbar">
        <Field label="Judul">
          <input required value={form.judul} onChange={(e) => setForm((f) => ({ ...f, judul: e.target.value }))} />
        </Field>
        <Field label="Kategori">
          <select value={form.kategori} onChange={(e) => setForm((f) => ({ ...f, kategori: e.target.value }))}>
            {KATEGORI_OPTIONS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </Field>
        <Field label="HPT">
          <select value={form.hpt_id} onChange={(e) => setForm((f) => ({ ...f, hpt_id: e.target.value }))}>
            <option value="">- Umum -</option>
            {hptList.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </Field>
        <Field label="Versi">
          <input value={form.versi} onChange={(e) => setForm((f) => ({ ...f, versi: e.target.value }))} />
        </Field>
        <Field label="Tanggal Berlaku">
          <input type="date" value={form.tanggal_berlaku} onChange={(e) => setForm((f) => ({ ...f, tanggal_berlaku: e.target.value }))} />
        </Field>
        <Field label="File (PDF/DOC/DOCX/XLS/XLSX/gambar)">
          <input type="file" onChange={(e) => setFile(e.target.files[0])} />
        </Field>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginBottom: 10 }}>
        <input type="checkbox" checked={form.status_aktif} onChange={(e) => setForm((f) => ({ ...f, status_aktif: e.target.checked }))} />
        Status Aktif (Publish langsung)
      </label>
      {msg && <div className="small-muted" style={{ marginBottom: 8 }}>{msg}</div>}
      <button className="btn btn-primary" disabled={busy} type="submit">{busy ? 'Mengunggah…' : 'Publish'}</button>
    </form>
  );
}
