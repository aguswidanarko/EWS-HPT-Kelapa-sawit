// "Import Rekap Bulanan (Format PISP1)" -- pivot-per-Blok monthly recap workbook (see
// docs/IMPORT_FORMAT_PISP1.md). Upload -> preview grouped per sheet/HPT -> explicit confirm-to-commit,
// consistent with the flat-import UI in ImportData.jsx (same upload/preview/commit shape, same
// "no partial import without confirm" discipline).

import { useState } from 'react';
import { importPisp1Api } from '../api/resources';

export default function ImportPisp1({ onCommitted }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [committed, setCommitted] = useState(null);
  const [showAssumptions, setShowAssumptions] = useState(false);

  async function handlePreview() {
    if (!file) { setMsg('Pilih file Excel rekap (format PISP1) terlebih dahulu.'); return; }
    setBusy(true);
    setMsg(null);
    setCommitted(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await importPisp1Api.preview(fd);
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
    const total = preview.totals.records_valid;
    if (!window.confirm(
      `Konfirmasi import ${total} record valid (Sensus/Pengendalian) dari ${preview.sheets.length} sheet?\n`
      + `Blok baru yang akan dibuat: ${preview.totals.blocks_new}. Sel kosong/nol (${preview.totals.rows_skipped_empty}) akan dilewati.`
    )) return;
    setBusy(true);
    try {
      const res = await importPisp1Api.commit({ import_log_id: preview.import_log_id, file_path: preview.file_path, confirm: true });
      setCommitted(res.data);
      setPreview(null);
      setFile(null);
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
        Untuk file rekap bulanan asli kebun: satu baris = satu Blok, kolom-kolom = bulan/rotasi (bukan format flat
        satu-baris-satu-observasi). Header dibaca otomatis dari label kolom (Afdeling/Blok/Jan.../TGL SENSUS/...),
        jadi tetap berfungsi walau offset baris/kolom sedikit berbeda antar periode. Sheet yang didukung: REKAP SNS UPDKS,
        REKAP SNS TIKUS, SNSS ORYCTES, SNSS RAYAP, SNS GANODERMA, REKAP PENGENDALIAN TIKUS.
      </p>

      <div className="toolbar">
        <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files[0])} />
        <button className="btn btn-primary" disabled={busy} onClick={handlePreview}>{busy ? 'Memproses…' : 'Preview'}</button>
      </div>
      {msg && <div className="small-muted">{msg}</div>}

      {preview && (
        <div style={{ marginTop: 14 }}>
          <div className="small-muted" style={{ marginBottom: 8 }}>
            Estate terdeteksi: <strong>{preview.estate.name}</strong> (kode <code>{preview.estate.code}</code>)
            {preview.estate.exists ? ' — sudah ada di Master Data.' : ' — BELUM ada, akan dibuat otomatis saat commit.'}
          </div>

          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="kpi-card"><div className="kpi-label">Baris Blok Terbaca</div><div className="kpi-value">{preview.totals.rows_read}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--normal)' }}><div className="kpi-label">Record Valid</div><div className="kpi-value">{preview.totals.records_valid}</div></div>
            <div className="kpi-card"><div className="kpi-label">Dilewati (Kosong/Nol)</div><div className="kpi-value">{preview.totals.rows_skipped_empty}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--sedang)' }}><div className="kpi-label">Blok Baru</div><div className="kpi-value">{preview.totals.blocks_new}</div></div>
            <div className="kpi-card" style={{ borderLeftColor: 'var(--berat)' }}><div className="kpi-label">Error</div><div className="kpi-value">{preview.totals.errors}</div></div>
          </div>

          <div className="table-wrap" style={{ marginTop: 14, marginBottom: 12 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Sheet</th><th>HPT</th><th>Tipe</th><th>Baris Dibaca</th><th>Record Valid</th>
                  <th>Dilewati</th><th>Blok Baru</th><th>Blok Sudah Ada</th><th>Error</th>
                </tr>
              </thead>
              <tbody>
                {preview.sheets.map((s) => (
                  <tr key={s.sheet}>
                    <td>{s.sheet}</td>
                    <td>{s.hpt || '-'}</td>
                    <td>{s.record_type === 'TREATMENT' ? 'Pengendalian' : 'Sensus'}</td>
                    <td>{s.rows_read}</td>
                    <td>{s.records_valid}</td>
                    <td>{s.rows_skipped_empty}</td>
                    <td>{s.blocks_new}</td>
                    <td>{s.blocks_existing}</td>
                    <td>{s.errors && s.errors.length > 0 ? (
                      <span style={{ color: 'var(--berat)' }}>{s.errors.length} — {s.errors.map((e) => e.message).join('; ')}</span>
                    ) : 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.out_of_scope && preview.out_of_scope.length > 0 && (
            <div className="error-state" style={{ background: 'var(--sedang-light, #fff7e6)', borderColor: 'var(--sedang)', marginBottom: 12 }}>
              <strong>Sheet di luar cakupan (tidak diimport):</strong>
              <ul style={{ margin: '6px 0 0 18px' }}>
                {preview.out_of_scope.map((o) => (
                  <li key={o.sheet}><strong>{o.sheet}</strong> — {o.note}</li>
                ))}
              </ul>
            </div>
          )}

          <button className="btn" style={{ marginBottom: 12 }} onClick={() => setShowAssumptions((v) => !v)}>
            {showAssumptions ? 'Sembunyikan' : 'Lihat'} asumsi konversi data ({preview.assumptions.length})
          </button>
          {showAssumptions && (
            <ul className="small-muted" style={{ marginTop: 0, marginBottom: 12 }}>
              {preview.assumptions.map((a, i) => <li key={i} style={{ marginBottom: 6 }}>{a}</li>)}
            </ul>
          )}

          <button className="btn btn-primary" disabled={busy || preview.totals.records_valid === 0} onClick={handleCommit}>
            {busy ? 'Mengimpor…' : `Konfirmasi Import ${preview.totals.records_valid} Record Valid`}
          </button>
        </div>
      )}

      {committed && (
        <div className="error-state" style={{ background: 'var(--primary-light)', color: 'var(--primary-dark)', borderColor: 'var(--primary)', marginTop: 12 }}>
          <div style={{ marginBottom: 8 }}>
            Import selesai: <strong>{committed.totals.committed}</strong> record berhasil ({committed.totals.ews_alert_count} memicu EWS alert)
            {committed.totals.failed ? `, ${committed.totals.failed} gagal.` : '.'}
            {' '}Estate <strong>{committed.estate.name}</strong>{committed.estate.created ? ' (baru dibuat)' : ''},
            {' '}{committed.afdelings_created} afdeling baru, {committed.bloks_created} blok baru.
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Sheet</th><th>Committed</th><th>Gagal</th><th>EWS Alert</th></tr></thead>
              <tbody>
                {committed.sheets.map((s) => (
                  <tr key={s.sheet}>
                    <td>{s.sheet}</td><td>{s.committed}</td><td>{s.failed}</td><td>{s.ews_alert_count}</td>
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
