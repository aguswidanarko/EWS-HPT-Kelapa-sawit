// Read-only local cache of GET /api/master-ews-dictionary (see schema.ts's `ews_dictionary_cache`
// table comment). Replaced wholesale on every sync, same pattern as masterRepo.ts's
// saveThresholds/saveSchedules.

import { getDb, withTransaction } from '../database';
import type { EwsDictionaryRow } from '../../types';

export async function saveEwsDictionary(rows: EwsDictionaryRow[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM ews_dictionary_cache');
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO ews_dictionary_cache (
          ews_id, scope, hpt_id, hpt_code, hpt_name, planting_stage,
          threshold_display_text, inspection_interval, recommendation, status
        ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          r.ews_id, r.scope, r.hpt_id, r.hpt_code, r.hpt_name, r.planting_stage,
          r.threshold_display_text, r.inspection_interval, r.recommendation, r.status,
        ]
      );
    }
  });
}

export async function getEwsDictionary(): Promise<EwsDictionaryRow[]> {
  const db = await getDb();
  return db.getAllAsync<EwsDictionaryRow>("SELECT * FROM ews_dictionary_cache WHERE status = 'ACTIVE' ORDER BY ews_id");
}

export async function getEwsDictionaryEntry(ewsId: string): Promise<EwsDictionaryRow | null> {
  const db = await getDb();
  return (await db.getFirstAsync<EwsDictionaryRow>('SELECT * FROM ews_dictionary_cache WHERE ews_id = ?', [ewsId])) ?? null;
}
