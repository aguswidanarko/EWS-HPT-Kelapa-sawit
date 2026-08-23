// Yield Making field records (SPEC_V2.md section 2/4): yield_partenocarpi/water_management/
// bahan_organik/tbm_vegetatif. One insert/list/get/getReady set per table, same shape as
// detectionRepo.ts/sensusRepo.ts - kept in a single file since all four are thin siblings of the
// same envelope (see types.ts SyncEnvelopeV2).

import { getDb } from '../database';
import type { LocalBahanOrganik, LocalTbmVegetatif, LocalWaterManagement, LocalYieldPartenocarpi } from '../../types';

// ---------------------------------------------------------------- partenocarpi
export async function insertYieldPartenocarpi(row: LocalYieldPartenocarpi): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO yield_partenocarpi (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, tanggal, periode,
      rainfall_mm, indikator_hujan_pagi, total_bunch, abnormal_bunch, abnormal_bunch_pct, populasi_ek,
      kategori_lokal, ews_alert_lokal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.tanggal, row.periode,
      row.rainfall_mm, row.indikator_hujan_pagi, row.total_bunch, row.abnormal_bunch, row.abnormal_bunch_pct, row.populasi_ek,
      row.kategori_lokal, row.ews_alert_lokal,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.catatan,
    ]
  );
}
export async function listYieldPartenocarpi(limit = 200): Promise<LocalYieldPartenocarpi[]> {
  const db = await getDb();
  return db.getAllAsync<LocalYieldPartenocarpi>('SELECT * FROM yield_partenocarpi ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getYieldPartenocarpiByLocalId(localId: string): Promise<LocalYieldPartenocarpi | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalYieldPartenocarpi>('SELECT * FROM yield_partenocarpi WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyYieldPartenocarpi(): Promise<LocalYieldPartenocarpi[]> {
  const db = await getDb();
  return db.getAllAsync<LocalYieldPartenocarpi>("SELECT * FROM yield_partenocarpi WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

// ---------------------------------------------------------------- water management
export async function insertWaterManagement(row: LocalWaterManagement): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO water_management (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, titik_parit, tanggal,
      water_level_cm, flooding, flooding_duration_hari,
      kategori_lokal, ews_alert_lokal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?, ?,?, ?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.titik_parit, row.tanggal,
      row.water_level_cm, row.flooding, row.flooding_duration_hari,
      row.kategori_lokal, row.ews_alert_lokal,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.catatan,
    ]
  );
}
export async function listWaterManagement(limit = 200): Promise<LocalWaterManagement[]> {
  const db = await getDb();
  return db.getAllAsync<LocalWaterManagement>('SELECT * FROM water_management ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getWaterManagementByLocalId(localId: string): Promise<LocalWaterManagement | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalWaterManagement>('SELECT * FROM water_management WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyWaterManagement(): Promise<LocalWaterManagement[]> {
  const db = await getDb();
  return db.getAllAsync<LocalWaterManagement>("SELECT * FROM water_management WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

// ---------------------------------------------------------------- bahan organik
export async function insertBahanOrganik(row: LocalBahanOrganik): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO bahan_organik (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, area_type, tanggal,
      total_sample, yellowing_count, yellowing_pct, vegetative_condition, baseline_tbm_normal, comparison_result,
      kategori_lokal, ews_alert_lokal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.area_type, row.tanggal,
      row.total_sample, row.yellowing_count, row.yellowing_pct, row.vegetative_condition, row.baseline_tbm_normal, row.comparison_result,
      row.kategori_lokal, row.ews_alert_lokal,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.catatan,
    ]
  );
}
export async function listBahanOrganik(limit = 200): Promise<LocalBahanOrganik[]> {
  const db = await getDb();
  return db.getAllAsync<LocalBahanOrganik>('SELECT * FROM bahan_organik ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getBahanOrganikByLocalId(localId: string): Promise<LocalBahanOrganik | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalBahanOrganik>('SELECT * FROM bahan_organik WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyBahanOrganik(): Promise<LocalBahanOrganik[]> {
  const db = await getDb();
  return db.getAllAsync<LocalBahanOrganik>("SELECT * FROM bahan_organik WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

// ---------------------------------------------------------------- tbm vegetatif
export async function insertTbmVegetatif(row: LocalTbmVegetatif): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO tbm_vegetatif (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      estate_id, afdeling_id, blok_id, tanggal, umur_bulan,
      panjang_pelepah_cm, jumlah_pelepah, lai, target_produksi_ton_ha, hasil_evaluasi,
      kategori_lokal, ews_alert_lokal,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?, ?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.estate_id, row.afdeling_id, row.blok_id, row.tanggal, row.umur_bulan,
      row.panjang_pelepah_cm, row.jumlah_pelepah, row.lai, row.target_produksi_ton_ha, row.hasil_evaluasi,
      row.kategori_lokal, row.ews_alert_lokal,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.catatan,
    ]
  );
}
export async function listTbmVegetatif(limit = 200): Promise<LocalTbmVegetatif[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTbmVegetatif>('SELECT * FROM tbm_vegetatif ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getTbmVegetatifByLocalId(localId: string): Promise<LocalTbmVegetatif | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalTbmVegetatif>('SELECT * FROM tbm_vegetatif WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyTbmVegetatif(): Promise<LocalTbmVegetatif[]> {
  const db = await getDb();
  return db.getAllAsync<LocalTbmVegetatif>("SELECT * FROM tbm_vegetatif WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at");
}

// ---------------------------------------------------------------- home/riwayat counters
export async function countTodayYieldMaking(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT
       (SELECT COUNT(*) FROM yield_partenocarpi WHERE tanggal = ?) +
       (SELECT COUNT(*) FROM water_management WHERE tanggal = ?) +
       (SELECT COUNT(*) FROM bahan_organik WHERE tanggal = ?) +
       (SELECT COUNT(*) FROM tbm_vegetatif WHERE tanggal = ?) as c`,
    [todayIso, todayIso, todayIso, todayIso]
  );
  return row?.c ?? 0;
}
