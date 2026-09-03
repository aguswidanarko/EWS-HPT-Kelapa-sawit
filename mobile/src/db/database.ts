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

/** SQLite has no "ADD COLUMN IF NOT EXISTS" -- mirrors the backend's tryAddColumn idiom
 * (backend/src/db/db.js) so adding a column to a table that already has local rows (an existing
 * install upgrading to a new app version) is safe: the ALTER is attempted every boot and any
 * "duplicate column name" failure (meaning it already ran on a previous boot) is swallowed. */
async function tryAddColumn(db: SQLite.SQLiteDatabase, table: string, columnDefSql: string): Promise<void> {
  try {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${columnDefSql}`);
  } catch (e: any) {
    if (!/duplicate column name/i.test(e?.message || '')) throw e;
  }
}

/** V3.2: Region/Bisnis Unit added above the existing PT (estates) level, and Blok gained
 * jumlah_pokok (Total Stand) -- see schema.ts's "master data" block and
 * backend/src/db/schema.sql's "V3.2: MASTER BLOK TERPUSAT" comment for the full rationale. Column
 * additions only (the regions/bisnis_units tables themselves are created by SCHEMA_SQL above,
 * which is always safe via CREATE TABLE IF NOT EXISTS). */
async function migrateV32Columns(db: SQLite.SQLiteDatabase): Promise<void> {
  await tryAddColumn(db, 'estates', 'region_id INTEGER');
  await tryAddColumn(db, 'estates', 'bisnis_unit_id INTEGER');
  await tryAddColumn(db, 'bloks', 'jumlah_pokok INTEGER');
}

let initPromise: Promise<void> | null = null;

/** Creates all tables if they don't exist yet. Idempotent - safe to call on every app start.
 * Must be awaited before any screen touches the database (see App.tsx). */
export function initDatabase(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const db = await getDb();
      await db.execAsync(SCHEMA_SQL);
      await migrateV32Columns(db);
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
