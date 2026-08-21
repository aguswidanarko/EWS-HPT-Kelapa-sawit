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

loadSchema();

module.exports = db;
module.exports.DB_PATH = DB_PATH;
