import { useEffect, useState } from 'react';
import { importApi } from '../api/resources';
import client from '../api/client';
import { useAuth, canImport } from '../context/AuthContext';
import { Empty, ErrorBox } from '../components/Common';
import { fmtDateTime } from '../utils/format';
import ImportPisp1 from './ImportPisp1';

const ENTITIES = [
  { key: 'detection', label: 'Deteksi' },
  { key: 'sensus', label: 'Sensus' },
  { key: 'treatment', label: 'Pengendalian' },
  { key: 'mortality', label: 'Mortalitas' },
];

const MODES = [
  { key: 'flat', label: 'Import Flat (per Baris = 1 Data)' },
  { key: 'pisp1', label: 'Import Rekap Bulanan (Format PISP1)' },
];

export default function ImportData() {
  const { user } = useAuth();
  const [mode, setMode] = useState('flat');
  const [entity, setEntity] = useState('detection');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [log, setLog] = useState([]);
  const [logError, setLogError] = useState(null);

  function loadLog() {
    importApi.log().then(setLog).catch(setLogError);
  }
  useEffect(() => { loadLog(); }, []);

  if (!canImport(user)) {
    return (
      <div>
        <div className="page-header"><div><h1>Import Data</h1></div></div>
        <div className="error-state">Role Anda ({user?.role_name}) tidak memiliki akses ke Import Data. Hanya Administrator dan R&amp;D/FOD.</div>
      </div>
    );
  }

  async function downloadTemplate() {
    try {
      const res = await client.get(`/import/template/${entity}`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `template_${entity}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      alert('Gagal mengunduh template.');
    }
  }

  async function handlePreview() {
    if (!file) { setMsg('Pilih file Excel terlebih dahulu.'); return; }
    setBusy(true);
    setMsg(null);
    setCommitted(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await importApi.preview(entity, fd);
      setPreview(res.data);
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Preview gagal.');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!preview) return;
    if (!window.confirm(`Konfirmasi import ${preview.valid} baris valid untuk ${entity}? Baris error (${preview.error}) akan dilewati.`)) return;
    setBusy(true);
    try {
      const res = await importApi.commit(entity, { import_log_id: preview.import_log_id, file_path: preview.file_path, confirm: true });
      setCommitted(res.data);
      setPreview(null);
      setFile(null);
      loadLog();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Commit gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Import Data</h1>
          <p>Import Excel untuk Deteksi/Sensus/Pengendalian/Mortalitas, atau rekap bulanan format kebun (PISP1). Preview wajib sebelum commit — tidak ada partial import tanpa konfirmasi eksplisit.</p>
        </div>
      </div>

      <div className="tabs">
        {MODES.map((m) => (
          <button
            key={m.key}
            className={'tab-btn' + (mode === m.key ? ' active' : '')}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'pisp1' ? (
        <ImportPisp1 onCommitted={loadLog} />
      ) : (
        <>
      <div className="tabs">
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            className={'tab-btn' + (entity === e.key ? ' active' : '')}
            onClick={() => { setEntity(e.key); setPreview(null); setCommitted(null); setFile(null); setMsg(null); }}
          >
            {e.label}
          </button>
        ))}
      </div>

      <div className="card card-pad" style={{ marginBottom: 18 }}>
        <div className="toolbar">
          <button className="btn" onClick={downloadTemplate}>⬇ Download Template ({ENTITIES.find((e) => e.key === entity)?.label})</button>
          <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
          <button className="btn btn-primary" disabled={busy} onClick={handlePreview}>{busy ? 'Memproses…' : 'Preview'}</button>
        </div>
        {msg && <div className="small-muted">{msg}</div>}

        {preview && (
          <div style={{ marginTop: 14 }}>
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="kpi-card"><div className="kpi-label">Total Baris</div><div className="kpi-value">{preview.total}</div></div>
              <div className="kpi-card" style={{ borderLeftColor: 'var(--normal)' }}><div className="kpi-label">Valid</div><div className="kpi-value">{preview.valid}</div></div>
              <div className="kpi-card" style={{ borderLeftColor: 'var(--berat)' }}><div className="kpi-label">Error</div><div className="kpi-value">{preview.error}</div></div>
            </div>
            {preview.errors && preview.errors.length > 0 && (
              <div className="table-wrap" style={{ marginBottom: 12 }}>
                <table className="data-table">
                  <thead><tr><th>Baris</th><th>Error</th></tr></thead>
                  <tbody>
                    {preview.errors.map((e, idx) => (
                      <tr key={idx}><td>{e.row}</td><td>{e.errors.join('; ')}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="btn btn-primary" disabled={busy || preview.valid === 0} onClick={handleCommit}>
              {busy ? 'Mengimpor…' : `Konfirmasi Import ${preview.valid} Baris Valid`}
            </button>
          </div>
        )}

        {committed && (
          <div className="error-state" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', marginTop: 12 }}>
            Import selesai: {committed.committed} baris berhasil diimport{committed.failed ? `, ${committed.failed} gagal.` : '.'}
          </div>
        )}
      </div>
        </>
      )}

      <div className="section-title mt-0">Riwayat Import</div>
      {logError && <ErrorBox error={logError} />}
      {log.length === 0 ? <Empty label="Belum ada riwayat import." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Waktu</th><th>Entity</th><th>File</th><th>Total</th><th>Valid</th><th>Error</th><th>Status</th></tr></thead>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td>{fmtDateTime(l.created_at)}</td>
                  <td>{l.entity_type}</td>
                  <td>{l.filename}</td>
                  <td>{l.total_rows}</td>
                  <td>{l.valid_rows}</td>
                  <td>{l.error_rows}</td>
                  <td>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
