// Deploy-time bootstrap: after `npm run seed` has populated demo master data + users,
// this script additionally commits the real PISP1 sample workbook (docs/samples/...)
// so a freshly-deployed instance (e.g. Render free tier, which does not guarantee a
// persistent disk) always comes back up with the same rich, realistic dataset the
// user already reviewed locally (56 blok crossing threshold, 99 alerts, etc.)
// instead of an empty/minimal seed.
//
// Safe to run multiple times: importPisp1's commitFile resolves/creates Blok master
// rows idempotently and every sensus/treatment record it creates is a fresh, valid
// field record (not a duplicate-detection bypass) — running it twice just adds a
// second batch of the same real readings, which is fine for a demo environment.

const path = require('path');
const db = require('../src/db/db');
const { commitFile } = require('../src/services/importPisp1');

function main() {
  const admin = db.prepare(`SELECT u.id FROM user u JOIN role r ON r.id = u.role_id WHERE r.code = 'ADMIN' LIMIT 1`).get();
  if (!admin) {
    console.error('No ADMIN user found — did `npm run seed` run first? Skipping PISP1 import.');
    return;
  }
  const filePath = path.join(__dirname, '..', '..', 'docs', 'samples', 'REKAP_HPT_PISP1_2026.xlsx');
  console.log(`Importing real PISP1 sample workbook from ${filePath} ...`);
  const result = commitFile(filePath, { user_id: admin.id });
  console.log(
    `PISP1 import done: committed=${result.totals.committed} failed=${result.totals.failed} ` +
      `ews_alerts=${result.totals.ews_alert_count} afdelings_created=${result.afdelings_created} bloks_created=${result.bloks_created}`
  );
}

try {
  main();
} catch (err) {
  // Never block server startup on this best-effort demo-data bootstrap.
  console.error('PISP1 deploy-seed failed (continuing to start server anyway):', err.message);
}
