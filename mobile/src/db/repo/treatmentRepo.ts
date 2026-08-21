import { getDb } from '../database';
import type { LocalTreatment } from '../../types';

export async function insertTreatment(row: LocalTreatment): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO treatments (
      local_id, server_id, server_row_id, activity_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      hpt_id, estate_id, afdeling_id, blok_id, luas_serangan, metode_pengendalian, tanggal_mulai, tanggal_selesai,
      jumlah_pokok, hk, material, jumlah_material, alat, pic, catatan, foto_local_id,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, status
    ) VALUES (?,?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?)`,
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
      row.hpt_id,
      row.estate_id,
      row.afdeling_id,
      row.blok_id,
      row.luas_serangan,
      row.metode_pengendalian,
      row.tanggal_mulai,
      row.tanggal_selesai,
      row.jumlah_pokok,
      row.hk,
      row.material,
      row.jumlah_material,
      row.alat,
      row.pic,
      row.catatan,
      row.foto_local_id,
      row.gps_lat,
      row.gps_lng,
      row.gps_accuracy,
      row.gps_timestamp,
      row.status,
    ]
  );
}

export async function listTreatments(limit = 200): Promise<LocalTreatment[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTreatment>('SELECT * FROM treatments ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getTreatmentByLocalId(localId: string): Promise<LocalTreatment | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalTreatment>('SELECT * FROM treatments WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadyTreatments(): Promise<LocalTreatment[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTreatment>(
    "SELECT * FROM treatments WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at"
  );
}

/** Only SYNCED treatments have a real server_id a Mortalitas record can reference. */
export async function listSyncedTreatments(): Promise<LocalTreatment[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTreatment>("SELECT * FROM treatments WHERE sync_status = 'SYNCED' ORDER BY created_at DESC");
}

export async function countTodayTreatments(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM treatments WHERE tanggal_mulai = ? OR created_at LIKE ?',
    [todayIso, `${todayIso}%`]
  );
  return row?.c ?? 0;
}
