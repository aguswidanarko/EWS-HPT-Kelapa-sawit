import { getDb } from '../database';
import type { LocalDetection } from '../../types';

export async function insertDetection(row: LocalDetection): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO detections (
      local_id, server_id, server_row_id, activity_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, baris, posisi, tanggal, waktu, hpt_id, species_id,
      gejala, kondisi_indikator, jumlah_indikasi, catatan, foto_local_id,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning,
      kategori_lokal, ews_alert_lokal
    ) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?)`,
    [
      row.local_id,
      row.server_id,
      row.server_row_id,
      row.activity_id,
      row.incident_id,
      row.user_id,
      row.device_id,
      row.created_at,
      row.updated_at,
      row.sync_status,
      row.sync_attempt,
      row.sync_error,
      row.source,
      row.estate_id,
      row.afdeling_id,
      row.blok_id,
      row.baris,
      row.posisi,
      row.tanggal,
      row.waktu,
      row.hpt_id,
      row.species_id,
      row.gejala,
      row.kondisi_indikator,
      row.jumlah_indikasi,
      row.catatan,
      row.foto_local_id,
      row.gps_lat,
      row.gps_lng,
      row.gps_accuracy,
      row.gps_timestamp,
      row.location_warning,
      row.kategori_lokal,
      row.ews_alert_lokal,
    ]
  );
}

export async function listDetections(limit = 200): Promise<LocalDetection[]> {
  const db = await getDb();
  return db.getAllAsync<LocalDetection>('SELECT * FROM detections ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getDetectionByLocalId(localId: string): Promise<LocalDetection | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalDetection>('SELECT * FROM detections WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadyDetections(): Promise<LocalDetection[]> {
  const db = await getDb();
  return db.getAllAsync<LocalDetection>(
    "SELECT * FROM detections WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at"
  );
}

export async function countTodayDetections(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM detections WHERE tanggal = ?', [todayIso]);
  return row?.c ?? 0;
}

export async function countAlertDetections(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM detections WHERE ews_alert_lokal = 1');
  return row?.c ?? 0;
}
