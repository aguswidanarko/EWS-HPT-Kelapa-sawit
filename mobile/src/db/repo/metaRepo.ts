import { getDb } from '../database';
import type { UserProfile } from '../../types';

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
    key,
    value,
  ]);
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export const META_KEYS = {
  LAST_SYNC_MASTER: 'last_sync_master',
  LAST_SYNC_THRESHOLD: 'last_sync_threshold',
  LAST_SYNC_KB: 'last_sync_kb',
  LAST_SYNC_JADWAL: 'last_sync_jadwal',
  LAST_SYNC_INCIDENTS: 'last_sync_incidents',
  LAST_UPLOAD: 'last_upload',
} as const;

// ---------------------------------------------------------------- session (logged-in) user
export async function saveUserProfile(profile: UserProfile): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT INTO session_user (id, profile_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET profile_json=excluded.profile_json', [
    JSON.stringify(profile),
  ]);
}

export async function loadUserProfile(): Promise<UserProfile | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ profile_json: string }>('SELECT profile_json FROM session_user WHERE id = 1');
  if (!row) return null;
  try {
    return JSON.parse(row.profile_json) as UserProfile;
  } catch {
    return null;
  }
}

export async function clearUserProfile(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM session_user WHERE id = 1');
}
