// One-time historical data seed runner (Knowledge Base batch 1+2 real production files).
// Each sibling module in this folder is independently self-guarding (checks its own import_log
// entity_type=COMMITTED marker before doing any work), so calling runAllSeedImports() on EVERY
// server boot is safe and cheap after the first successful run -- exactly the same "safe to
// re-run" discipline db.js already uses for loadSchema()/migrateV2Columns()/migrateAlertStatusV2().
//
// Each module only imports CLEAN/UNAMBIGUOUS rows from its source workbook (never fabricates a
// value) -- see each module's own header comment for its exact inclusion/exclusion rules, which
// were derived from a prior detailed data-gap analysis shown to and confirmed by the user.
//
// Modules are run SEQUENTIALLY (not in parallel) because several of them create/reuse shared
// master data (estate/afdeling/blok rows) and better-sqlite3 is synchronous anyway -- there is no
// concurrency benefit to parallelizing, and sequential keeps the boot log easy to read top-to-bottom.
//
// A single module throwing (e.g. a workbook that fails to parse) is caught and logged, but does
// NOT stop the other 5 modules from running, and does NOT stop the server from starting -- a
// broken historical-data seed must never take the live app down.

const seedDefisiensiHara = require('./defisiensiHara');
const seedWaterManagement = require('./waterManagement');
const seedTbmVegetatif = require('./tbmVegetatif');
const seedHptPsa = require('./hptPsa');
const seedSensusTikusKalbar = require('./sensusTikusKalbar');
const seedPengendalianTikus = require('./pengendalianTikus');

const SEEDS = [
  { name: 'Defisiensi Hara (leaf_analysis)', run: seedDefisiensiHara },
  { name: 'Water Management', run: seedWaterManagement },
  { name: 'TBM Vegetatif', run: seedTbmVegetatif },
  { name: 'HPT Multi-Pest PT PSA', run: seedHptPsa },
  { name: 'Sensus/Deteksi Tikus FR Kalbar', run: seedSensusTikusKalbar },
  { name: 'Pengendalian Racun Tikus', run: seedPengendalianTikus },
];

function runAllSeedImports(db) {
  const results = [];
  for (const seed of SEEDS) {
    const startedAt = Date.now();
    try {
      const result = seed.run(db);
      const ms = Date.now() - startedAt;
      results.push({ name: seed.name, ok: true, ms, ...result });
      if (result && result.skipped) {
        // eslint-disable-next-line no-console
        console.log(`[seedImports] ${seed.name}: already imported previously, skipped.`);
      } else {
        // eslint-disable-next-line no-console
        console.log(
          `[seedImports] ${seed.name}: committed=${result ? result.committed : '?'} failed=${result ? result.failed : '?'} (${ms}ms)`
        );
      }
    } catch (e) {
      const ms = Date.now() - startedAt;
      results.push({ name: seed.name, ok: false, ms, error: e.message });
      // eslint-disable-next-line no-console
      console.error(`[seedImports] ${seed.name}: FAILED - ${e.message}`);
      // eslint-disable-next-line no-console
      console.error(e.stack);
    }
  }
  return results;
}

module.exports = { runAllSeedImports, SEEDS };
