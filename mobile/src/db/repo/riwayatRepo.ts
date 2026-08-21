import { getDb } from '../database';
import type { SyncStatus } from '../../types';

export interface RiwayatItem {
  kind: 'DETEKSI' | 'SENSUS' | 'TREATMENT' | 'MORTALITAS';
  local_id: string;
  title: string;
  subtitle: string;
  tanggal: string;
  created_at: string;
  sync_status: SyncStatus;
  kategori: string | null;
  ews_alert: 0 | 1;
}

/** Combined feed for the Riwayat tab (SPEC.md "Riwayat": kegiatan hari ini & sebelumnya, semua
 * jenis, + status sync). A single UNION query keeps the four record kinds displayed consistently
 * sorted, instead of merging four separate arrays in JS. */
export async function getRiwayat(limit = 300): Promise<RiwayatItem[]> {
  const db = await getDb();
  return db.getAllAsync<RiwayatItem>(
    `SELECT * FROM (
       SELECT 'DETEKSI' as kind, d.local_id, h.name as title,
              ('Blok #' || d.blok_id || CASE WHEN d.gejala IS NOT NULL THEN ' - ' || d.gejala ELSE '' END) as subtitle,
              d.tanggal, d.created_at, d.sync_status, d.kategori_lokal as kategori, d.ews_alert_lokal as ews_alert
         FROM detections d LEFT JOIN hpt h ON h.id = d.hpt_id
       UNION ALL
       SELECT 'SENSUS' as kind, s.local_id, ('Sensus ' || s.jenis_sensus) as title,
              ('Blok #' || s.blok_id || ' - hasil ' || COALESCE(ROUND(s.hasil_hitung, 2), '-')) as subtitle,
              s.tanggal, s.created_at, s.sync_status, s.kategori_lokal as kategori, s.ews_alert_lokal as ews_alert
         FROM sensus s
       UNION ALL
       SELECT 'TREATMENT' as kind, t.local_id, ('Pengendalian - ' || COALESCE(t.metode_pengendalian,'-')) as title,
              ('Blok #' || t.blok_id) as subtitle,
              COALESCE(t.tanggal_mulai, substr(t.created_at,1,10)) as tanggal, t.created_at, t.sync_status, NULL as kategori, 0 as ews_alert
         FROM treatments t
       UNION ALL
       SELECT 'MORTALITAS' as kind, m.local_id, 'Sensus Mortalitas' as title,
              (CASE WHEN m.service_required_lokal = 1 THEN 'Perlu service' ELSE COALESCE(m.hasil_efektivitas_lokal, '-') END) as subtitle,
              m.tanggal, m.created_at, m.sync_status, m.hasil_efektivitas_lokal as kategori, m.service_required_lokal as ews_alert
         FROM mortalities m
     ) ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}
