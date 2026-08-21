import { useEffect, useState } from 'react';
import { notificationRulesApi } from '../api/resources';
import { useMasterData } from '../context/MasterDataContext';
import { useAuth, canManageNotificationRules } from '../context/AuthContext';
import { Loading, ErrorBox, Empty, Field } from '../components/Common';
import { StatusBadge } from '../components/Badges';
import { fmtDateTime } from '../utils/format';
import MasterCrud from '../components/MasterCrud';

const TRIGGER_TYPES = [
  { value: 'THRESHOLD_EXCEEDED', label: 'Threshold Terlampaui (semua kategori)' },
  { value: 'KATEGORI_SEDANG', label: 'Kategori Sedang' },
  { value: 'KATEGORI_BERAT', label: 'Kategori Berat' },
  { value: 'KATEGORI_CRITICAL', label: 'Kategori Critical' },
  { value: 'SERVICE_REQUIRED', label: 'Mortalitas Perlu Service (tidak efektif)' },
];

const ROLE_OPTIONS = ['ADMIN', 'RND_FOD', 'MANAGER', 'ASKEP_ASISTEN', 'PETUGAS_DETEKSI', 'PETUGAS_SENSUS', 'PETUGAS_PENGENDALIAN'];

export default function Notification() {
  const { user } = useAuth();
  const md = useMasterData();
  const [tab, setTab] = useState('Rules');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Notification</h1>
          <p>Aturan notifikasi (trigger × recipient × channel) dan log pengiriman per alert.</p>
        </div>
      </div>

      <div className="tabs">
        <button className={'tab-btn' + (tab === 'Rules' ? ' active' : '')} onClick={() => setTab('Rules')}>Notification Rules</button>
        <button className={'tab-btn' + (tab === 'Log' ? ' active' : '')} onClick={() => setTab('Log')}>Notification Log</button>
      </div>

      {tab === 'Rules' && (
        <MasterCrud
          title="Notification Rules"
          canWrite={canManageNotificationRules(user)}
          api={notificationRulesApi}
          columns={[
            { key: 'trigger_type', header: 'Trigger', render: (r) => TRIGGER_TYPES.find((t) => t.value === r.trigger_type)?.label || r.trigger_type },
            { key: 'recipient_role', header: 'Role Penerima', render: (r) => r.recipient_role || '-' },
            { key: 'recipient_user_id', header: 'User Tertentu', render: (r) => r.recipient_user_id ? md.userName(r.recipient_user_id) : '-' },
            { key: 'recipient_pic', header: 'PIC Blok', render: (r) => r.recipient_pic ? 'Ya' : 'Tidak' },
            { key: 'channel', header: 'Channel' },
            { key: 'active', header: 'Aktif', render: (r) => r.active ? 'Ya' : 'Tidak' },
          ]}
          fields={[
            { key: 'trigger_type', label: 'Trigger', type: 'select', required: true, options: TRIGGER_TYPES },
            { key: 'recipient_role', label: 'Role Penerima', type: 'select', options: ROLE_OPTIONS.map((r) => ({ value: r, label: r })) },
            { key: 'recipient_user_id', label: 'User Tertentu', type: 'select', options: md.users.map((u) => ({ value: u.id, label: u.name })) },
            { key: 'recipient_pic', label: 'Kirim ke PIC Blok', type: 'checkbox' },
            { key: 'channel', label: 'Channel', type: 'select', required: true, options: [{ value: 'DASHBOARD', label: 'Dashboard' }, { value: 'EMAIL', label: 'Email' }, { value: 'WHATSAPP', label: 'WhatsApp' }] },
            { key: 'active', label: 'Aktif', type: 'checkbox' },
          ]}
        />
      )}

      {tab === 'Log' && <NotificationLog />}
    </div>
  );
}

function NotificationLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    notificationRulesApi.log(statusFilter ? { status: statusFilter } : undefined).then(setRows).catch(setError).finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <div>
      <div className="toolbar">
        <Field label="Status">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">Semua</option>
            {['PENDING', 'SENT', 'DELIVERED', 'FAILED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      {error && <ErrorBox error={error} />}
      {loading ? <Loading /> : rows.length === 0 ? <Empty label="Belum ada log notifikasi." /> : (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Alert</th><th>Channel</th><th>Penerima</th><th>Waktu Kirim</th><th>Status</th><th>Provider</th><th>Error</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>#{r.alert_id}</td>
                  <td>{r.channel}</td>
                  <td>{r.recipient}</td>
                  <td>{fmtDateTime(r.sent_at)}</td>
                  <td><StatusBadge status={r.status} /></td>
                  <td>{r.response_provider || '-'}</td>
                  <td>{r.error || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
