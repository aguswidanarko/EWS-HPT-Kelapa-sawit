import { useEffect, useState } from 'react';
import { Loading, ErrorBox, Empty } from './Common';
import Modal from './Modal';

/**
 * Generic master-data CRUD table.
 * fields: [{ key, label, type: 'text'|'number'|'select'|'date'|'textarea'|'checkbox', options?: [{value,label}], required? }]
 */
export default function MasterCrud({ title, description, api, fields, columns, canWrite, keyField = 'id', onChanged }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, {...} = edit
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    setLoading(true);
    api.list().then(setRows).catch(setError).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  function openNew() {
    const blank = {};
    fields.forEach((f) => { blank[f.key] = f.type === 'checkbox' ? false : ''; });
    setEditing(blank);
    setFormError(null);
  }

  function openEdit(row) {
    setEditing({ ...row });
    setFormError(null);
  }

  async function handleDelete(row) {
    if (!window.confirm(`Hapus data ini?`)) return;
    try {
      await api.remove(row[keyField]);
      load();
      onChanged && onChanged();
    } catch (err) {
      alert(err?.response?.data?.error || 'Gagal menghapus.');
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = {};
      fields.forEach((f) => {
        let v = editing[f.key];
        if (f.type === 'number' && v === '') v = null;
        if (f.type === 'checkbox') v = v ? 1 : 0;
        payload[f.key] = v;
      });
      if (editing[keyField]) {
        await api.update(editing[keyField], payload);
      } else {
        await api.create(payload);
      }
      setEditing(null);
      load();
      onChanged && onChanged();
    } catch (err) {
      setFormError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 style={{ fontSize: 16, margin: '0 0 4px' }}>{title}</h2>
          {description && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-muted)' }}>{description}</p>}
        </div>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Tambah</button>}
      </div>

      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                {columns.map((c) => <th key={c.key}>{c.header}</th>)}
                {canWrite && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row[keyField]}>
                  {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : (row[c.key] ?? '-')}</td>)}
                  {canWrite && (
                    <td>
                      <button className="btn btn-sm" onClick={() => openEdit(row)}>Edit</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => handleDelete(row)}>Hapus</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <Modal
          title={editing[keyField] ? 'Edit Data' : 'Tambah Data'}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>Batal</button>
              <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
            </>
          }
        >
          <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {fields.map((f) => (
              <div className="field" key={f.key} style={f.wide ? { gridColumn: '1 / -1' } : undefined}>
                <label>{f.label}{f.required && ' *'}</label>
                {f.type === 'select' ? (
                  <select
                    required={f.required}
                    value={editing[f.key] ?? ''}
                    onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.value }))}
                  >
                    <option value="">-</option>
                    {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea
                    rows={3}
                    required={f.required}
                    value={editing[f.key] ?? ''}
                    onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : f.type === 'checkbox' ? (
                  <input
                    type="checkbox"
                    checked={!!editing[f.key]}
                    onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.checked }))}
                    style={{ width: 18, height: 18 }}
                  />
                ) : (
                  <input
                    type={f.type || 'text'}
                    step={f.type === 'number' ? 'any' : undefined}
                    required={f.required}
                    value={editing[f.key] ?? ''}
                    onChange={(e) => setEditing((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </div>
            ))}
          </form>
          {formError && <div className="error-state" style={{ marginTop: 10 }}>{formError}</div>}
        </Modal>
      )}
    </div>
  );
}
