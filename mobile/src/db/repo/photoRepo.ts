import { getDb } from '../database';
import type { LocalPhoto } from '../../types';

export async function insertPhoto(photo: LocalPhoto): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO photos (local_id, entity_type, entity_local_id, file_uri, gps_lat, gps_lng, timestamp, user_id, compressed_size, uploaded, server_photo_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      photo.local_id,
      photo.entity_type,
      photo.entity_local_id,
      photo.file_uri,
      photo.gps_lat,
      photo.gps_lng,
      photo.timestamp,
      photo.user_id,
      photo.compressed_size,
      photo.uploaded,
      photo.server_photo_id,
    ]
  );
}

export async function getPhotosByEntity(entityType: LocalPhoto['entity_type'], entityLocalId: string): Promise<LocalPhoto[]> {
  const db = await getDb();
  return db.getAllAsync<LocalPhoto>('SELECT * FROM photos WHERE entity_type = ? AND entity_local_id = ?', [
    entityType,
    entityLocalId,
  ]);
}

export async function getUnuploadedPhotos(): Promise<LocalPhoto[]> {
  const db = await getDb();
  return db.getAllAsync<LocalPhoto>('SELECT * FROM photos WHERE uploaded = 0');
}

export async function markPhotoUploaded(localId: string, serverPhotoId: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE photos SET uploaded = 1, server_photo_id = ? WHERE local_id = ?', [serverPhotoId, localId]);
}

export async function countUnuploadedPhotos(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM photos WHERE uploaded = 0');
  return row?.c ?? 0;
}
