import { useEffect, useState } from 'react';
import { usersApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageUsers } from '../context/AuthContext';
import { Loading, ErrorBox, Empty } from '../components/Common';
import Modal from '../components/Modal';
import MasterCrud from '../components/MasterCrud';
import MasterUserMobileImport from '../components/MasterUserMobileImport';

export default function PicUser() {
  const { user } = useAuth();
  const md = useMasterData();
  const [tab, setTab] = useState('Users');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>PIC / User</h1>
          <p>Master pengguna (role, wilayah kerja) dan penugasan PIC per estate/afdeling/blok/HPT dengan channel notifikasi.</p>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab-btn' + (tab === 'Users' ? ' active' : '')} onClick={() => setTab('Users')}>Users</button>
        <button className={'tab-btn' + (tab === 'PIC' ? ' active' : '')} onClick={() => setTab('PIC')}>PIC Assignment</button>
        <button className={'tab-btn' + (tab === 'Master User Mobile' ? ' active' : '')} onClick={() => setTab('Master User Mobile')}>Master User Mobile (Upload)</button>
      </div>

      {tab === 'Users' && <UsersTab canWrite={canManageUsers(user)} md={md} />}
      {tab === 'Master User Mobile' && (
        canManageUsers(user)
          ? <MasterUserMobileImport />
          : <p className="small-muted">Hanya Admin yang bisa mengubah Master User Mobile.</p>
      )}
      {tab === 'PIC' && (
        <MasterCrud
          title="PIC Assignment"
          canWrite={canManageUsers(user)}
          api={usersApi.pic}
          columns={[
            { key: 'user_name', header: 'User' },
            { key: 'estate_id', header: 'PT', render: (r) => r.estate_id ? md.estateName(r.estate_id) : 'Semua' },
            { key: 'afdeling_id', header: 'Afdeling', render: (r) => r.afdeling_id ? md.afdelingName(r.afdeling_id) : 'Semua' },
            { key: 'blok_id', header: 'Blok', render: (r) => r.blok_id ? md.blokName(r.blok_id) : 'Semua' },
            { key: 'jenis_aktivitas', header: 'Jenis Aktivitas' },
            { key: 'hpt_id', header: 'HPT', render: (r) => r.hpt_id ? md.hptName(r.hpt_id) : 'Semua' },
            { key: 'notification_channel', header: 'Channel Notifikasi' },
          ]}
          fields={[
            { key: 'user_id', label: 'User', type: 'select', required: true, options: md.users.map((u) => ({ value: u.id, label: `${u.name} (${u.role_code})` })) },
            { key: 'estate_id', label: 'PT (kosongkan = semua)', type: 'select', options: md.estates.map((e) => ({ value: e.id, label: e.name })) },
            { key: 'afdeling_id', label: 'Afdeling (kosongkan = semua)', type: 'select', options: md.afdelings.map((a) => ({ value: a.id, label: a.name })) },
            { key: 'blok_id', label: 'Blok (kosongkan = semua)', type: 'select', options: md.bloks.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) },
            { key: 'jenis_aktivitas', label: 'Jenis Aktivitas', type: 'select', options: [
              { value: 'ALL', label: 'Semua' }, { value: 'DETEKSI', label: 'Deteksi' }, { value: 'SENSUS', label: 'Sensus' }, { value: 'PENGENDALIAN', label: 'Pengendalian' },
            ] },
            { key: 'hpt_id', label: 'HPT (kosongkan = semua)', type: 'select', options: md.hpt.map((h) => ({ value: h.id, label: h.name })) },
            { key: 'notification_channel', label: 'Channel Notifikasi', type: 'select', required: true, options: [
              { value: 'DASHBOARD', label: 'Dashboard' }, { value: 'EMAIL', label: 'Email' }, { value: 'WHATSAPP', label: 'WhatsApp' },
            ] },
          ]}
        />
      )}
    </div>
  );
}

const ROLE_OPTIONS = [
  'ADMIN', 'SUPER_ADMIN', 'RND_FOD', 'MANAGER', 'ASKEP_ASISTEN',
  'PETUGAS_DETEKSI', 'PETUGAS_SENSUS', 'PETUGAS_PENGENDALIAN', 'PETUGAS_LAPANGAN',
  'RISET', 'VIEWER_MANAGEMENT',
];

function UsersTab({ canWrite, md }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);

  function load() {
    setLoading(true);
    usersApi.list().then(setRows).catch(setError).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, []);

  function openNew() {
    setEditing({ name: '', email: '', password: '', role_code: 'PETUGAS_DETEKSI', estate_id: '', afdeling_id: '', area_kerja: '', phone: '', is_active: true });
    setFormError(null);
  }
  function openEdit(row) {
    setEditing({ ...row, password: '' });
    setFormError(null);
  }
  async function handleDeactivate(row) {
    if (!window.confirm(`Nonaktifkan user ${row.name}?`)) return;
    try {
      await usersApi.remove(row.id);
      load();
    } catch (err) {
      alert(err?.response?.data?.error || 'Gagal.');
    }
  }
  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      if (editing.id) {
        const payload = { name: editing.name, phone: editing.phone, estate_id: editing.estate_id || null, afdeling_id: editing.afdeling_id || null, area_kerja: editing.area_kerja, is_active: editing.is_active ? 1 : 0, role_code: editing.role_code };
        if (editing.password) payload.password = editing.password;
        await usersApi.update(editing.id, payload);
      } else {
        await usersApi.create({ name: editing.name, email: editing.email, password: editing.password, role_code: editing.role_code, estate_id: editing.estate_id || null, afdeling_id: editing.afdeling_id || null, area_kerja: editing.area_kerja, phone: editing.phone });
      }
      setEditing(null);
      load();
    } catch (err) {
      setFormError(err?.response?.data?.error || 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="toolbar" style={{ justifyContent: 'flex-end' }}>
        {canWrite && <button className="btn btn-primary btn-sm" onClick={openNew}>+ Tambah User</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Wilayah</th><th>Status</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.email}</td>
                  <td><span className="chip">{r.role_name}</span></td>
                  <td>{r.area_kerja || (r.estate_id ? md.estateName(r.estate_id) : '-')}</td>
                  <td>{r.is_active ? 'Aktif' : 'Nonaktif'}</td>
                  {canWrite && (
                    <td>
                      <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>{' '}
                      {r.is_active === 1 && <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(r)}>Nonaktifkan</button>}
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
          title={editing.id ? 'Edit User' : 'Tambah User'}
          onClose={() => setEditing(null)}
          footer={<>
            <button className="btn" onClick={() => setEditing(null)}>Batal</button>
            <button className="btn btn-primary" disabled={saving} onClick={handleSave}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
          </>}
        >
          <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field"><label>Nama *</label><input required value={editing.name} onChange={(e) => setEditing((v) => ({ ...v, name: e.target.value }))} /></div>
            <div className="field"><label>Email *</label><input type="email" required disabled={!!editing.id} value={editing.email} onChange={(e) => setEditing((v) => ({ ...v, email: e.target.value }))} /></div>
            <div className="field"><label>Password {editing.id ? '(kosongkan jika tidak diubah)' : '*'}</label><input type="password" required={!editing.id} value={editing.password} onChange={(e) => setEditing((v) => ({ ...v, password: e.target.value }))} /></div>
            <div className="field"><label>Role *</label>
              <select required value={editing.role_code} onChange={(e) => setEditing((v) => ({ ...v, role_code: e.target.value }))}>
                {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="field"><label>PT</label>
              <select value={editing.estate_id || ''} onChange={(e) => setEditing((v) => ({ ...v, estate_id: e.target.value }))}>
                <option value="">-</option>
                {md.estates.map((es) => <option key={es.id} value={es.id}>{es.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Afdeling</label>
              <select value={editing.afdeling_id || ''} onChange={(e) => setEditing((v) => ({ ...v, afdeling_id: e.target.value }))}>
                <option value="">-</option>
                {md.afdelings.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field"><label>Area Kerja</label><input value={editing.area_kerja || ''} onChange={(e) => setEditing((v) => ({ ...v, area_kerja: e.target.value }))} /></div>
            <div className="field"><label>Telepon</label><input value={editing.phone || ''} onChange={(e) => setEditing((v) => ({ ...v, phone: e.target.value }))} /></div>
            {editing.id && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                <input type="checkbox" checked={!!editing.is_active} onChange={(e) => setEditing((v) => ({ ...v, is_active: e.target.checked }))} /> Aktif
              </label>
            )}
          </form>
          {formError && <div className="error-state" style={{ marginTop: 10 }}>{formError}</div>}
        </Modal>
      )}
    </div>
  );
}
