import { getDb, withTransaction } from '../database';
import type { KnowledgeBaseEntry } from '../../types';

/** Replaces the KB index from the server but preserves any already-cached local file/text so a
 * re-sync doesn't force re-downloading content that's already available offline. */
export async function saveKnowledgeBase(rows: KnowledgeBaseEntry[]): Promise<void> {
  await withTransaction(async (db) => {
    const existing = await db.getAllAsync<{ id: number; cached_local_path: string | null; cached_text: string | null }>(
      'SELECT id, cached_local_path, cached_text FROM knowledge_base'
    );
    const cacheById = new Map(existing.map((e) => [e.id, e]));
    await db.runAsync('DELETE FROM knowledge_base');
    for (const k of rows) {
      const prior = cacheById.get(k.id);
      await db.runAsync(
        `INSERT INTO knowledge_base (id, hpt_id, kategori, judul, versi, tanggal_berlaku, status_aktif, file_path, file_type, download_url, cached_local_path, cached_text)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id,
          k.hpt_id,
          k.kategori,
          k.judul,
          k.versi,
          k.tanggal_berlaku,
          k.status_aktif,
          k.file_path,
          k.file_type,
          k.download_url,
          prior?.cached_local_path ?? null,
          prior?.cached_text ?? null,
        ]
      );
    }
  });
}

export async function getKnowledgeBase(): Promise<KnowledgeBaseEntry[]> {
  const db = await getDb();
  return db.getAllAsync<KnowledgeBaseEntry>('SELECT * FROM knowledge_base ORDER BY kategori, judul');
}

export async function getKnowledgeBaseById(id: number): Promise<KnowledgeBaseEntry | null> {
  const db = await getDb();
  return (await db.getFirstAsync<KnowledgeBaseEntry>('SELECT * FROM knowledge_base WHERE id = ?', [id])) ?? null;
}

export async function setKbCachedText(id: number, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE knowledge_base SET cached_text = ? WHERE id = ?', [text, id]);
}

export async function setKbCachedLocalPath(id: number, path: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE knowledge_base SET cached_local_path = ? WHERE id = ?', [path, id]);
}
