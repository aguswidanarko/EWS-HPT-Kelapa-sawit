import { getDb } from '../database';
import type { LocalSensus } from '../../types';

export async function insertSensus(row: LocalSensus): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sensus (
      local_id, server_id, server_row_id, activity_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      jenis_sensus, estate_id, afdeling_id, blok_id, species_id, jalur_baris_json, hasil_json, hasil_hitung,
      kategori_lokal, saran_pengendalian, foto_local_id, catatan, tanggal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, ews_alert_lokal
    ) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?)`,
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
      row.jenis_sensus,
      row.estate_id,
      row.afdeling_id,
      row.blok_id,
      row.species_id,
      row.jalur_baris_json,
      row.hasil_json,
      row.hasil_hitung,
      row.kategori_lokal,
      row.saran_pengendalian,
      row.foto_local_id,
      row.catatan,
      row.tanggal,
      row.gps_lat,
      row.gps_lng,
      row.gps_accuracy,
      row.gps_timestamp,
      row.ews_alert_lokal,
    ]
  );
}

export async function listSensus(limit = 200): Promise<LocalSensus[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSensus>('SELECT * FROM sensus ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getSensusByLocalId(localId: string): Promise<LocalSensus | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalSensus>('SELECT * FROM sensus WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadySensus(): Promise<LocalSensus[]> {
  const db = await getDb();
  return db.getAllAsync<LocalSensus>("SELECT * FROM sensus WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

export async function countTodaySensus(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM sensus WHERE tanggal = ?', [todayIso]);
  return row?.c ?? 0;
}

export async function countAlertSensus(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM sensus WHERE ews_alert_lokal = 1');
  return row?.c ?? 0;
}
