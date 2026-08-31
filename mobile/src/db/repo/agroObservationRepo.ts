// Agro Observation field records (V3 Dynamic Form Engine, AGR-005..014). Same insert/list/get/
// getReady shape as yieldRepo.ts's four sub-tables - kept in its own file since it's a distinct
// generic table, not a sibling of any single yield_making entity.

import { getDb } from '../database';
import type { LocalAgroObservation } from '../../types';

export async function insertAgroObservation(row: LocalAgroObservation): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO agro_observations (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, hpt_id, ews_id, tanggal,
      nilai_ukur, kategori, kategori_lokal, ews_alert_lokal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, petugas, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.hpt_id, row.ews_id, row.tanggal,
      row.nilai_ukur, row.kategori, row.kategori_lokal, row.ews_alert_lokal,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.petugas, row.catatan,
    ]
  );
}

export async function listAgroObservations(limit = 200): Promise<LocalAgroObservation[]> {
  const db = await getDb();
  return db.getAllAsync<LocalAgroObservation>('SELECT * FROM agro_observations ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getAgroObservationByLocalId(localId: string): Promise<LocalAgroObservation | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalAgroObservation>('SELECT * FROM agro_observations WHERE local_id = ?', [localId])) ?? null;
}

export async function getReadyAgroObservations(): Promise<LocalAgroObservation[]> {
  const db = await getDb();
  return db.getAllAsync<LocalAgroObservation>("SELECT * FROM agro_observations WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

export async function countTodayAgroObservations(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM agro_observations WHERE tanggal = ?', [todayIso]);
  return row?.c ?? 0;
}
