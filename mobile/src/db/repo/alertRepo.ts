import { getDb } from '../database';

export interface LocalAlertRow {
  kind: 'DETEKSI' | 'SENSUS';
  local_id: string;
  hpt_label: string | null;
  blok_id: number;
  kategori: string | null;
  tanggal: string;
  created_at: string;
}

/** Local alerts (SPEC.md Home "alert lokal") = any Deteksi/Sensus record whose client-side
 * threshold classification landed on a non-NORMAL category, most recent first. Purely a local
 * convenience view - the server re-derives its own authoritative alerts on sync. */
export async function getRecentLocalAlerts(limit = 20): Promise<LocalAlertRow[]> {
  const db = await getDb();
  return db.getAllAsync<LocalAlertRow>(
    `SELECT 'DETEKSI' as kind, d.local_id, h.name as hpt_label, d.blok_id, d.kategori_lokal as kategori, d.tanggal, d.created_at
       FROM detections d LEFT JOIN hpt h ON h.id = d.hpt_id
       WHERE d.ews_alert_lokal = 1
     UNION ALL
     SELECT 'SENSUS' as kind, s.local_id, h.name as hpt_label, s.blok_id, s.kategori_lokal as kategori, s.tanggal, s.created_at
       FROM sensus s LEFT JOIN hpt h ON h.code = s.jenis_sensus
       WHERE s.ews_alert_lokal = 1
     ORDER BY created_at DESC LIMIT ?`,
    [limit]
  );
}
