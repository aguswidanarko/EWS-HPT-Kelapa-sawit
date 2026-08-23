// Defisiensi Hara field findings (SPEC_V2.md section 2/4): defisiensi_hara_temuan (offline-authored
// by Mandor/Petugas) + cached_leaf_analysis (read-only reference synced from Riset's lab findings).

import { getDb, withTransaction } from '../database';
import type { CachedLeafAnalysis, LocalDefisiensiHaraTemuan } from '../../types';

// ---------------------------------------------------------------- defisiensi_hara_temuan (field)
export async function insertDefisiensiHaraTemuan(row: LocalDefisiensiHaraTemuan): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO defisiensi_hara_temuan (
      local_id, server_id, server_row_id, incident_id, user_id, device_id, created_at, updated_at,
      sync_status, sync_attempt, sync_error, source,
      leaf_analysis_id, estate_id, afdeling_id, blok_id, tanggal,
      unsur_hara, temuan_lapangan, severity, status, action_plan_id, evidence_photo_id,
      gps_lat, gps_lng, gps_accuracy, gps_timestamp, location_warning, foto_local_id, catatan
    ) VALUES (?,?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?)`,
    [
      row.local_id, row.server_id, row.server_row_id, row.incident_id, row.user_id, row.device_id, row.created_at, row.updated_at,
      row.sync_status, row.sync_attempt, row.sync_error, row.source,
      row.leaf_analysis_id, row.estate_id, row.afdeling_id, row.blok_id, row.tanggal,
      row.unsur_hara, row.temuan_lapangan, row.severity, row.status, row.action_plan_id, row.evidence_photo_id,
      row.gps_lat, row.gps_lng, row.gps_accuracy, row.gps_timestamp, row.location_warning, row.foto_local_id, row.catatan,
    ]
  );
}
export async function listDefisiensiHaraTemuan(limit = 200): Promise<LocalDefisiensiHaraTemuan[]> {
  const db = await getDb();
  return db.getAllAsync<LocalDefisiensiHaraTemuan>('SELECT * FROM defisiensi_hara_temuan ORDER BY created_at DESC LIMIT ?', [limit]);
}
export async function getDefisiensiHaraTemuanByLocalId(localId: string): Promise<LocalDefisiensiHaraTemuan | null> {
  const db = await getDb();
  return (await db.getFirstAsync<LocalDefisiensiHaraTemuan>('SELECT * FROM defisiensi_hara_temuan WHERE local_id = ?', [localId])) ?? null;
}
export async function getReadyDefisiensiHaraTemuan(): Promise<LocalDefisiensiHaraTemuan[]> {
  const db = await getDb();
  return db.getAllAsync<LocalDefisiensiHaraTemuan>(
    "SELECT * FROM defisiensi_hara_temuan WHERE sync_status IN ('READY_TO_SYNC','FAILED') ORDER BY created_at"
  );
}

// ---------------------------------------------------------------- cached leaf_analysis (Riset reference)
export async function saveCachedLeafAnalysis(rows: CachedLeafAnalysis[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM cached_leaf_analysis');
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO cached_leaf_analysis (id, blok_id, tanggal, unsur_hara, hasil, severity, status, input_by_role, user_id, catatan, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.blok_id, r.tanggal, r.unsur_hara, r.hasil, r.severity, r.status, r.input_by_role, r.user_id, r.catatan, r.created_at, r.updated_at]
      );
    }
  });
}
export async function getCachedLeafAnalysis(blokId?: number): Promise<CachedLeafAnalysis[]> {
  const db = await getDb();
  if (blokId) {
    return db.getAllAsync<CachedLeafAnalysis>('SELECT * FROM cached_leaf_analysis WHERE blok_id = ? ORDER BY tanggal DESC', [blokId]);
  }
  return db.getAllAsync<CachedLeafAnalysis>('SELECT * FROM cached_leaf_analysis ORDER BY tanggal DESC');
}
