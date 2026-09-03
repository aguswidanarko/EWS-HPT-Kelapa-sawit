// V3.2: "Master Blok (Upload)" -- single source of truth for Region/Bisnis Unit/PT/Afdeling/Blok,
// replacing scattered/inconsistent manual entry (the root cause of mobile sync failures on
// mismatched blok codes). Upload -> Preview (parse + validate only) -> Commit (upserts by natural
// key, NEVER deletes) -> Prune (separate explicit step, only removes rows with zero remaining
// historical references -- rows still referenced by field data are safely kept and reported).
// Admin-only: gated by canWriteMaster in the parent (MasterData.jsx) AND server-side
// (backend/src/routes/masterBlokImport.js requireRole('ADMIN')).
//
// UI shape follows ImportPisp1.jsx (upload -> preview KPI cards + error list -> confirm -> commit
// summary), extended with a third "Bersihkan data lama" (prune) step.

import { useEffect, useState } from 'react';
import { masterBlokImportApi } from '../api/resources';

export default function MasterBlokImport({ onCommitted }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [pruned, setPruned] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [log, setLog] = useState([]);

  function loadLog() {
    masterBlokImportApi.log().then(setLog).catch(() => {});
  }
  useEffect(() => { loadLog(); }, []);

  async function handlePreview() {
    if (!file) { setMsg('Pilih file Master Blok (.xlsx, 3 sheet: MASTER_PT/MASTER_AFD/MASTER_BLOK) terlebih dahulu.'); return; }
    setBusy(true);
    setMsg(null);
    setCommitted(null);
    setPruned(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await masterBlokImportApi.preview(fd);
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
      `Konfirmasi terapkan Master Blok?\n\nPT: ${preview.summary.pt_count}, Afdeling: ${preview.summary.afdeling_count}, Blok: ${preview.summary.blok_count}.\n\n`
      + `Data lama TIDAK akan langsung dihapus (aman untuk riwayat data lapangan) -- gunakan tombol "Bersihkan Data Lama" setelah ini jika ingin merapikan data yang sudah tidak dipakai.`
    )) return;
    setBusy(true);
    try {
      const res = await masterBlokImportApi.commit({ import_log_id: preview.import_log_id, file_path: preview.file_path, confirm: true });
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

  async function handlePrune() {
    if (!committed) return;
    if (!window.confirm(
      'Bersihkan Region/Bisnis Unit/PT/Afdeling/Blok LAMA yang sudah tidak ada di file yang baru saja diupload?\n\n'
      + 'Baris yang MASIH dipakai oleh data lapangan (deteksi/sensus/dsb) TIDAK akan dihapus -- akan dilaporkan sebagai "masih dipakai" supaya bisa ditindaklanjuti dulu (lihat dokumen migrasi data lama).'
    )) return;
    setBusy(true);
    try {
      const res = await masterBlokImportApi.prune({ import_log_id: committed.import_log_id, confirm: true });
      setPruned(res.data);
      if (onCommitted) onCommitted();
    } catch (err) {
      setMsg(err?.response?.data?.error || 'Bersihkan data gagal.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 18 }}>
      <p className="small-muted" style={{ marginTop: 0 }}>
        Upload file Master Blok terpusat (3 sheet: <strong>MASTER_PT</strong> kolom Region/Kode PT/Nama PT,{' '}
        <strong>MASTER_AFD</strong> kolom Kode PT/Afdeling, <strong>MASTER_BLOK</strong> kolom Kode PT/Afdeling/Blok/Tahun
        Tanam/Luas (Ha)/Jumlah Pokok). "Nama PT" wajib mengikuti format <code>"&lt;Bisnis Unit&gt; - &lt;nama kebun&gt;"</code>{' '}
        (mis. "KTBM - Kebun Sei Besar") -- Bisnis Unit otomatis diambil dari awalan ini. Hanya Admin yang bisa mengubah Master Blok.
      </p>

      <div className="toolbar">
        <a className="btn" href={masterBlokImportApi.templateUrl()}>Unduh Template</a>
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn-primary" disabled={busy} onClick={handlePreview}>{busy ? 'Memproses…' : 'Preview'}</button>
      </div>
      {msg && <div className="small-muted" style={{ color: 'var(--berat)' }}>{msg}</div>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-label">Region</div><div className="kpi-value">{preview.summary.region_count}</div></div>
            <div className="kpi-card"><div className="kpi-label">Bisnis Unit</div><div className="kpi-value">{preview.summary.bisnis_unit_count}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--normal)' }}><div className="kpi-label">PT</div><div className="kpi-value">{preview.summary.pt_count}</div></div>
            <div className="kpi-card"><div className="kpi-label">Afdeling</div><div className="kpi-value">{preview.summary.afdeling_count}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--sedang)' }}><div className="kpi-label">Blok</div><div className="kpi-value">{preview.summary.blok_count}</div></div>
          </div>

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

          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={busy} onClick={handleCommit}>
            {busy ? 'Menerapkan…' : `Terapkan Master Blok (${preview.summary.blok_count} blok)`}
          </button>
        </div>
      )}

      {committed && (
        <div className="error-state" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            Master Blok diterapkan: Region {committed.stats.region.created} baru/{committed.stats.region.updated} update,
            {' '}Bisnis Unit {committed.stats.bisnis_unit.created}/{committed.stats.bisnis_unit.updated},
            {' '}PT {committed.stats.estate.created}/{committed.stats.estate.updated},
            {' '}Afdeling {committed.stats.afdeling.created}/{committed.stats.afdeling.updated},
            {' '}Blok {committed.stats.blok.created}/{committed.stats.blok.updated} (baru/update).
            {committed.failed ? ` ${committed.failed} baris gagal diterapkan.` : ''}
          </div>
          <div className="small-muted" style={{ marginBottom: 10 }}>
            Data lama (Region/Bisnis Unit/PT/Afdeling/Blok yang tidak ada di file ini) belum dihapus. Klik tombol di
            bawah untuk membersihkannya -- baris yang masih dipakai data lapangan otomatis akan dilewati/aman.
          </div>
          <button className="btn" disabled={busy} onClick={handlePrune}>
            {busy ? 'Membersihkan…' : 'Bersihkan Data Lama'}
          </button>
        </div>
      )}

      {pruned && (
        <div className="error-state" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', marginTop: 12 }}>
          Dihapus: {pruned.removed.blok.length} blok, {pruned.removed.afdeling.length} afdeling, {pruned.removed.estate.length} PT,{' '}
          {pruned.removed.bisnis_unit.length} bisnis unit, {pruned.removed.region.length} region.
          <br />
          Masih dipakai data lapangan (tidak dihapus): {pruned.skipped_still_in_use.blok} blok,{' '}
          {pruned.skipped_still_in_use.afdeling} afdeling, {pruned.skipped_still_in_use.estate} PT.
        </div>
      )}

      {log.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="small-muted" style={{ marginBottom: 6, fontWeight: 600 }}>Riwayat Upload Master Blok</div>
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
