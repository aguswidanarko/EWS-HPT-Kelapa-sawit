// V3.2: "Master User Mobile Apps per Afdeling" -- bulk-provisions ONE shared mobile-login user
// account (role PETUGAS_LAPANGAN) per Afdeling, so field staff can submit every field data type
// (Deteksi/Sensus/Pengendalian/Mortalitas/Yield Making/Assessment/Agro Observation/Defisiensi
// Hara) from a single afdeling-level account instead of juggling per-specialty logins.
//
// Requires Master Blok (Upload) to already be applied -- this import resolves each row's "Kode
// PT"/"Afdeling" against the current PT/Afdeling master data. Admin-only, gated by canManageUsers
// in the parent AND server-side (backend/src/routes/masterUserMobileImport.js requireRole('ADMIN')).
//
// UI shape follows MasterBlokImport.jsx (upload -> preview KPI + error list -> confirm -> commit
// summary), but with NO prune step: unlike location master data, a login missing from a re-upload
// is never auto-deleted/deactivated -- commit only ever upserts (create new / update existing by
// email). An admin who needs to deactivate an account does that by hand in the Users tab.

import { useEffect, useState } from 'react';
import { masterUserMobileImportApi } from '../api/resources';

export default function MasterUserMobileImport({ onCommitted }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [log, setLog] = useState([]);

  function loadLog() {
    masterUserMobileImportApi.log().then(setLog).catch(() => {});
  }
  useEffect(() => { loadLog(); }, []);

  async function handlePreview() {
    if (!file) { setMsg('Pilih file Master User Mobile (.xlsx, sheet MASTER_AFD: Kode PT/Afdeling/User Mobile/Password) terlebih dahulu.'); return; }
    setBusy(true);
    setMsg(null);
    setCommitted(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await masterUserMobileImportApi.preview(fd);
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
    if (!window.confirm(
      `Konfirmasi buat/perbarui ${preview.summary.account_count} akun mobile (${preview.summary.pt_count} PT)?\n\n`
      + `Akun yang sudah ada (email sama) akan diperbarui (password/wilayah kerja), akun yang belum ada akan dibuat baru. Tidak ada akun yang dihapus/dinonaktifkan.`
    )) return;
    setBusy(true);
    try {
      const res = await masterUserMobileImportApi.commit({ import_log_id: preview.import_log_id, file_path: preview.file_path, confirm: true });
      setCommitted(res.data);
      setPreview(null);
      setFile(null);
      loadLog();
      if (onCommitted) onCommitted();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Commit gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <p className="small-muted" style={{ marginTop: 0 }}>
        Upload file Master User Mobile (1 sheet <strong>MASTER_AFD</strong>, kolom Kode PT/Afdeling/User Mobile/Password) untuk
        membuat 1 akun login mobile per Afdeling secara massal (role <strong>Petugas Lapangan</strong>) -- akun ini bisa
        menginput semua jenis data lapangan (Deteksi/Sensus/Pengendalian/Mortalitas/Yield Making/Assessment/Agro
        Observation/Defisiensi Hara). Pastikan Master Blok (Upload) sudah diterapkan lebih dulu, karena Kode PT +
        Afdeling di file ini dicocokkan ke data tersebut. Hanya Admin yang bisa mengubah Master User Mobile.
      </p>

      <div className="toolbar">
        <a className="btn" href={masterUserMobileImportApi.templateUrl()}>Unduh Template</a>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn-primary" disabled={busy} onClick={handlePreview}>{busy ? 'Memproses…' : 'Preview'}</button>
      </div>
      {msg && <div className="small-muted" style={{ color: 'var(--berat)' }}>{msg}</div>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-label">Akun</div><div className="kpi-value">{preview.summary.account_count}</div></div>
            <div className="kpi-card"><div className="kpi-label">PT</div><div className="kpi-value">{preview.summary.pt_count}</div></div>
          </div>

          {preview.warnings && preview.warnings.length > 0 && (
            <div className="error-state" style={{ background: 'var(--sedang-light, #fff7e6)', borderColor: 'var(--sedang)', marginTop: 12 }}>
              {preview.warnings.map((w, i) => <div key={i}>{w}</div>)}
            </div>
          )}

          {preview.error_count > 0 && (
            <div className="error-state" style={{ background: 'var(--sedang-light, #fff7e6)', borderColor: 'var(--sedang)', marginTop: 12 }}>
              <strong>{preview.error_count} baris dilewati karena tidak valid</strong> (baris lain tetap akan diproses normal).
              {' '}
              <button className="btn" style={{ marginLeft: 8 }} onClick={() => setShowErrors((v) => !v)}>
                {showErrors ? 'Sembunyikan' : 'Lihat'} detail
              </button>
              {showErrors && (
                <ul className="small-muted" style={{ margin: '10px 0 0 18px', maxHeight: 300, overflowY: 'auto' }}>
                  {preview.errors.map((e, i) => <li key={i} style={{ marginBottom: 4 }}>{e}</li>)}
                </ul>
              )}
            </div>
          )}

          {preview.sample && preview.sample.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div className="small-muted" style={{ marginBottom: 6, fontWeight: 600 }}>Contoh akun yang akan dibuat (email login)</div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>Kode PT</th><th>Afdeling</th><th>Email Login</th></tr></thead>
                  <tbody>
                    {preview.sample.map((s, i) => (
                      <tr key={i}><td>{s.kodePt}</td><td>{s.afdeling}</td><td>{s.email}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={handleCommit}>
            {busy ? 'Menerapkan…' : `Buat/Perbarui ${preview.summary.account_count} Akun`}
          </button>
        </div>
      )}

      {committed && (
        <div className="error-state" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', marginTop: 12 }}>
          Akun mobile diterapkan: {committed.stats.created} baru, {committed.stats.updated} diperbarui.
          {committed.failed ? ` ${committed.failed} baris gagal diterapkan.` : ''}
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="small-muted" style={{ marginBottom: 6, fontWeight: 600 }}>Riwayat Upload Master User Mobile</div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Tanggal</th><th>File</th><th>Status</th><th>Total Baris</th><th>Valid</th><th>Error</th><th>Diterapkan</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.id}>
                    <td>{l.created_at}</td><td>{l.filename}</td><td>{l.status}</td>
                    <td>{l.total_rows}</td><td>{l.valid_rows}</td><td>{l.error_rows}</td><td>{l.committed_count ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
