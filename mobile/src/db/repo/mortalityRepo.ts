import { getDb } from '../database';
import type { LocalMortality } from '../../types';

export async function insertMortality(row: LocalMortality): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO mortalities (
      local_id, server_id, server_row_id, activity_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      treatment_local_id, tanggal, blok_id, sampel, jumlah_hidup, jumlah_mati, kondisi, foto_local_id,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, hasil_efektivitas_lokal, service_required_lokal, status
    ) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?)`,
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
      row.treatment_local_id,
      row.tanggal,
      row.blok_id,
      row.sampel,
      row.jumlah_hidup,
      row.jumlah_mati,
      row.kondisi,
      row.foto_local_id,
      row.gps_lat,
      row.gps_lng,
      row.gps_accuracy,
      row.gps_timestamp,
      row.hasil_efektivitas_lokal,
      row.service_required_lokal,
      row.status,
    ]
  );
}

export async function listMortalities(limit = 200): Promise<LocalMortality[]> {
  const db = await getDb();
  return db.getAllAsync<LocalMortality>('SELECT * FROM mortalities ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getMortalityByLocalId(localId: string): Promise<LocalMortality | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalMortality>('SELECT * FROM mortalities WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadyMortalities(): Promise<LocalMortality[]> {
  const db = await getDb();
  return db.getAllAsync<LocalMortality>(
    "SELECT * FROM mortalities WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at"
  );
}

export async function countTodayMortalities(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM mortalities WHERE tanggal = ?', [todayIso]);
  return row?.c ?? 0;
}
