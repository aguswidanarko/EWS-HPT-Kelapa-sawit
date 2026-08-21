import * as SQLite from 'expo-sqlite';
import { SCHEMA_SQL } from './schema';

const DB_NAME = 'ews_hpt.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Opens (once) and memoizes the single app database connection. expo-sqlite serializes
 * statements internally so sharing one connection across repos/screens is safe. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME);
  }
  return dbPromise;
}

let initPromise: Promise<void> | null = null;

/** Creates all tables if they don't exist yet. Idempotent - safe to call on every app start.
 * Must be awaited before any screen touches the database (see App.tsx). */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDb();
      await db.execAsync(SCHEMA_SQL);
    })();
  }
  return initPromise;
}

/** Runs `fn` inside a SQLite transaction so partial writes never survive a crash/interrupt
 * (BRD 01 non-functional requirement: data must not be lost on app close / device restart /
 * connection loss / sync failure). */
export async function withTransaction<T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const db = await getDb();
  let result: T;
  await db.withTransactionAsync(async () => {
    result = await fn(db);
  });
  // @ts-expect-error assigned synchronously inside the transaction callback above, before it resolves
  return result;
}
