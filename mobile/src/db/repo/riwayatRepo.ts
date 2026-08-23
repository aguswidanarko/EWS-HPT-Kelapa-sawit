import { getDb } from '../database';
import type { SyncStatus } from '../../types';

export interface RiwayatItem {
  kind:
    | 'DETEKSI'
    | 'SENSUS'
    | 'TREATMENT'
    | 'MORTALITAS'
    | 'PARTENOCARPI'
    | 'WATER_MANAGEMENT'
    | 'BAHAN_ORGANIK'
    | 'TBM_VEGETATIF'
    | 'DEFISIENSI_HARA'
    | 'ACTION_PLAN';
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
       UNION ALL
       SELECT 'PARTENOCARPI' as kind, y.local_id, 'Partenocarpi / Elaeidobius' as title,
              ('Blok #' || y.blok_id || CASE WHEN y.kategori_lokal IS NOT NULL THEN ' - ' || y.kategori_lokal ELSE '' END) as subtitle,
              y.tanggal, y.created_at, y.sync_status, y.kategori_lokal as kategori, y.ews_alert_lokal as ews_alert
         FROM yield_partenocarpi y
       UNION ALL
       SELECT 'WATER_MANAGEMENT' as kind, w.local_id, 'Water Management' as title,
              ('Titik ' || COALESCE(w.titik_parit,'-') || ' - Blok #' || w.blok_id) as subtitle,
              w.tanggal, w.created_at, w.sync_status, w.kategori_lokal as kategori, w.ews_alert_lokal as ews_alert
         FROM water_management w
       UNION ALL
       SELECT 'BAHAN_ORGANIK' as kind, o.local_id, 'Bahan Organik' as title,
              ('Blok #' || o.blok_id || CASE WHEN o.area_type IS NOT NULL THEN ' - ' || o.area_type ELSE '' END) as subtitle,
              o.tanggal, o.created_at, o.sync_status, o.kategori_lokal as kategori, o.ews_alert_lokal as ews_alert
         FROM bahan_organik o
       UNION ALL
       SELECT 'TBM_VEGETATIF' as kind, v.local_id, 'TBM Vegetatif' as title,
              ('Blok #' || v.blok_id || CASE WHEN v.umur_bulan IS NOT NULL THEN ' - umur ' || v.umur_bulan || ' bln' ELSE '' END) as subtitle,
              v.tanggal, v.created_at, v.sync_status, v.kategori_lokal as kategori, v.ews_alert_lokal as ews_alert
         FROM tbm_vegetatif v
       UNION ALL
       SELECT 'DEFISIENSI_HARA' as kind, dh.local_id, ('Defisiensi Hara - ' || COALESCE(dh.unsur_hara,'-')) as title,
              ('Blok #' || dh.blok_id || CASE WHEN dh.severity IS NOT NULL THEN ' - ' || dh.severity ELSE '' END) as subtitle,
              dh.tanggal, dh.created_at, dh.sync_status, dh.severity as kategori, 0 as ews_alert
         FROM defisiensi_hara_temuan dh
       UNION ALL
       SELECT 'ACTION_PLAN' as kind, u.local_id, ('Update Action Plan #' || u.action_plan_id) as title,
              ('Status baru: ' || COALESCE(u.status, '-')) as subtitle,
              substr(u.created_at,1,10) as tanggal, u.created_at, u.sync_status, NULL as kategori, 0 as ews_alert
         FROM action_plan_updates u
     ) ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}
