// Database connection + idempotent schema loader.
// CommonJS module, single shared better-sqlite3 connection for the whole process.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.EWS_DB_PATH || path.join(__dirname, '..', '..', 'ews.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function loadSchema() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql); // every statement uses CREATE TABLE/INDEX IF NOT EXISTS -> safe to re-run on every boot
}

// ---------------------------------------------------------------------------------------------
// V2 migration runner (SPEC_V2.md section 1 item 10 / section 2 closing ALTER TABLE notes).
// SQLite has no "ADD COLUMN IF NOT EXISTS", so every ALTER TABLE is wrapped try/catch and any
// "duplicate column name" failure is swallowed -- safe to run on every process boot, exactly like
// the CREATE TABLE IF NOT EXISTS statements above.
// ---------------------------------------------------------------------------------------------

function tryAddColumn(table, columnDefSql) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDefSql}`);
  } catch (e) {
    if (!/duplicate column name/i.test(e.message)) throw e;
  }
}

function migrateV2Columns() {
  // hpt (V1) reused as the generic "EWS indicator" table (SPEC_V2.md section 2).
  tryAddColumn('hpt', `indicator_type TEXT DEFAULT 'HPT'`);
  tryAddColumn('hpt', `category_id INTEGER REFERENCES ews_category(id)`);
  // knowledge_base publish workflow (SPEC_V2.md section 1 item 8).
  tryAddColumn('knowledge_base', `publish_status TEXT DEFAULT 'PUBLISHED'`);
  tryAddColumn('knowledge_base', `checksum TEXT`);
}

/**
 * One-time alert/incident status value migration V1 -> V2 (SPEC_V2.md section 1 item 6 / section
 * 2 closing note): CONTROLLED -> COMPLETED, MONITORING -> VERIFIED. The UPDATE ... WHERE
 * status='CONTROLLED' predicate is itself the idempotency guard: once a row's status has been
 * rewritten to COMPLETED/VERIFIED it no longer matches the WHERE clause on a later boot, so
 * re-running this on every startup cannot re-migrate (or corrupt) already-migrated data. Both the
 * old 6-state names (CONTROLLED/MONITORING) are retired in V2 application code (routes/alerts.js,
 * services/ingestion.js), so no new write is expected to reintroduce them.
 */
function migrateAlertStatusV2() {
  db.exec(`UPDATE alert SET status='COMPLETED', updated_at=updated_at WHERE status='CONTROLLED'`);
  db.exec(`UPDATE alert SET status='VERIFIED', updated_at=updated_at WHERE status='MONITORING'`);
  db.exec(`UPDATE incident SET status='COMPLETED', updated_at=updated_at WHERE status='CONTROLLED'`);
  db.exec(`UPDATE incident SET status='VERIFIED', updated_at=updated_at WHERE status='MONITORING'`);
}

loadSchema();
migrateV2Columns();
migrateAlertStatusV2();

module.exports = db;
module.exports.DB_PATH = DB_PATH;
