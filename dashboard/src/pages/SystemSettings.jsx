import { useEffect, useState } from 'react';
import { dataQualityApi, syncMonitoringApi } from '../api/resources';
import { useAuth, isAdmin } from '../context/AuthContext';
import { Loading, ErrorBox, Empty } from '../components/Common';
import { fmtDateTime } from '../utils/format';

export default function SystemSettings() {
  const { user } = useAuth();
  const [dq, setDq] = useState(null);
  const [dqError, setDqError] = useState(null);
  const [sync, setSync] = useState([]);
  const [syncError, setSyncError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      dataQualityApi.get().then(setDq).catch(setDqError),
      syncMonitoringApi.summary().then(setSync).catch(setSyncError),
    ]).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>System Settings</h1>
          <p>Konfigurasi provider notifikasi, status backup, kualitas data, dan monitoring sinkronisasi mobile.</p>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <div className="section-title mt-0">Notification Provider</div>
          <div className="stat-line"><span>Provider aktif</span><span className="chip">mock-log-provider-v1</span></div>
          <div className="stat-line"><span>Channel didukung</span><span>DASHBOARD, EMAIL, WHATSAPP</span></div>
          <p className="small-muted" style={{ marginTop: 10 }}>
            Provider default log-only (aman untuk demo, tidak memerlukan kredensial produksi). Untuk mengaktifkan
            SMTP/WhatsApp Business API sungguhan, ganti implementasi di{' '}
            <code>backend/src/services/notificationProvider.js</code> — tidak ada perubahan lain yang diperlukan
            (lihat README backend bagian 6). Aturan penerima dikonfigurasi di menu <em>Notification</em>.
          </p>
        </div>

        <div className="card card-pad">
          <div className="section-title mt-0">Backup Database</div>
          <div className="stat-line"><span>Mekanisme</span><span>Script terjadwal (cron)</span></div>
          <div className="stat-line"><span>Cakupan</span><span>Database + uploads (foto/KB/peta) + audit log</span></div>
          <p className="small-muted" style={{ marginTop: 10 }}>
            Jalankan <code>npm run backup</code> di folder backend (atau jadwalkan via cron, mis.{' '}
            <code>0 2 * * *</code> setiap hari jam 02:00) untuk menyalin <code>ews.db</code>, folder{' '}
            <code>uploads/</code>, dan ekspor JSON <code>audit_log</code> ke <code>backend/backups/</code>.
            {!isAdmin(user) && ' Hanya Administrator yang dapat memicu backup dari server.'}
          </p>
        </div>
      </div>

      {loading ? <Loading /> : (
        <div className="grid-2">
          <div className="card card-pad">
            <div className="section-title mt-0">Data Quality Dashboard</div>
            {dqError && <ErrorBox error={dqError} />}
            {dq && (
              <div>
                <div className="stat-line"><span>Data belum lengkap</span><span>{dq.data_belum_lengkap}</span></div>
                <div className="stat-line"><span>GPS tidak tersedia</span><span>{dq.gps_tidak_tersedia}</span></div>
                <div className="stat-line"><span>GPS di luar blok</span><span>{dq.gps_di_luar_blok}</span></div>
                <div className="stat-line"><span>HPT tidak dikenal</span><span>{dq.hpt_tidak_dikenal}</span></div>
                <div className="stat-line"><span>Blok tidak dikenal</span><span>{dq.blok_tidak_dikenal}</span></div>
                <div className="stat-line"><span>Duplicate suspect (deteksi)</span><span>{dq.duplicate_suspect?.deteksi ?? 0}</span></div>
                <div className="stat-line"><span>Duplicate suspect (sensus)</span><span>{dq.duplicate_suspect?.sensus ?? 0}</span></div>
                <div className="stat-line"><span>Import errors</span><span>{dq.import_errors}</span></div>
                <div className="stat-line"><span>Data belum tersinkron (total)</span><span>{dq.data_belum_tersinkron?.total ?? 0}</span></div>
              </div>
            )}
          </div>

          <div className="card card-pad">
            <div className="section-title mt-0">Monitoring Synchronization (Mobile)</div>
            {syncError && <ErrorBox error={syncError} />}
            {sync.length === 0 ? <Empty label="Belum ada aktivitas sinkronisasi mobile tercatat." /> : (
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>User</th><th>Device</th><th>Last Sync</th><th>Sukses</th><th>Gagal</th></tr></thead>
                  <tbody>
                    {sync.map((s, i) => (
                      <tr key={i}>
                        <td>{s.user_id}</td>
                        <td>{s.device_id}</td>
                        <td>{fmtDateTime(s.finished_at || s.started_at)}</td>
                        <td>{s.success_count}</td>
                        <td>{s.failed_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
