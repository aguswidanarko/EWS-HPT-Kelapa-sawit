// Simple backup script (SPEC.md section 7 "Backup"): copies the SQLite DB file + uploads
// (photos/knowledge-base/maps/imports) + a fresh export of AUDIT_LOG to a timestamped folder.
// Usage: node scripts/backup.js  (or `npm run backup`)
// Suggested cron (daily at 2am): 0 2 * * * cd /path/to/backend && node scripts/backup.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.EWS_DB_PATH || path.join(ROOT, 'ews.db');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const BACKUPS_DIR = path.join(ROOT, 'backups');

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) copyRecursive(path.join(src, entry), path.join(dest, entry));
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = path.join(BACKUPS_DIR, `backup-${stamp}`);
  fs.mkdirSync(target, { recursive: true });

  // Database (+ WAL/SHM sidecar files if present, so an in-flight WAL isn't lost)
  for (const suffix of ['', '-wal', '-shm']) {
    const src = DB_PATH + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, path.basename(DB_PATH) + suffix));
  }

  // Uploads: photos, knowledge-base, maps, imports
  copyRecursive(UPLOADS_DIR, path.join(target, 'uploads'));

  // Audit log export (JSON) for quick inspection without opening the DB file.
  try {
    // eslint-disable-next-line global-require
    const db = require('../src/db/db');
    const auditLog = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
    fs.writeFileSync(path.join(target, 'audit_log_export.json'), JSON.stringify(auditLog, null, 2));
  } catch (e) {
    console.warn('Could not export audit_log (continuing backup):', e.message);
  }

  console.log(`Backup written to: ${target}`);
}

main();
