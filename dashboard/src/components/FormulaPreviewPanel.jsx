import { useState } from 'react';
import { formulasApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';

/** Dry-run tester for POST /api/formulas/:id/preview (routes/formulas.js) — lets a Rule &
 * Parameter Management admin sanity-check a formula's expression_json against sample input
 * before relying on it in production, without writing any data. */
export default function FormulaPreviewPanel() {
  const md = useMasterData();
  const [formulaId, setFormulaId] = useState('');
  const [payload, setPayload] = useState('{\n  \n}');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handlePreview() {
    if (!formulaId) { setError('Pilih formula terlebih dahulu.'); return; }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw new Error('Payload uji harus JSON valid.');
      }
      const res = await formulasApi.preview(formulaId, parsed);
      setResult(res.data);
    } catch (err) {
      setError(err?.response?.data?.error || err.message || 'Gagal menguji formula.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginTop: 16 }}>
      <div className="section-title mt-0">Uji Formula (Dry-run, tanpa menyimpan data)</div>
      <div className="toolbar">
        <div className="field">
          <label>Formula ID</label>
          <input type="number" value={formulaId} onChange={(e) => setFormulaId(e.target.value)} placeholder="mis. 1" style={{ width: 100 }} />
        </div>
        <div style={{ paddingTop: 18 }}>
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={handlePreview}>{busy ? 'Menguji…' : 'Uji Formula'}</button>
        </div>
      </div>
      <div className="field">
        <label>Payload Uji (JSON, field sesuai expression_json formula)</label>
        <textarea rows={4} value={payload} onChange={(e) => setPayload(e.target.value)} />
      </div>
      {error && <div className="error-state" style={{ marginTop: 10 }}>{error}</div>}
      {result && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="data-table">
            <tbody>
              {Object.entries(result).map(([k, v]) => (
                <tr key={k}><td style={{ fontWeight: 600 }}>{k}</td><td>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="small-muted" style={{ marginTop: 8 }}>Referensi indikator: {md.hpt.map((h) => `${h.id}=${h.code}`).join(', ')}</div>
    </div>
  );
}
