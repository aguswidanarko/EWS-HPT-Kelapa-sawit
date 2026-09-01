// Entry point.
const db = require('./db/db'); // ensures schema is loaded before the app starts handling requests
const app = require('./app');

// One-time historical data seed (Knowledge Base batch 1+2 real production files -> V1/V2 tables).
// Required here (not from db.js) to avoid a circular require: the seed modules pull in
// services/ingestion.js and services/ruleEngine.js, which themselves require db.js -- by the time
// this line runs, db.js's `module.exports = db` has already fully executed, so that circular
// require resolves to the real connection instead of an incomplete module.exports.
// Each seed module self-guards via its own import_log COMMITTED marker, so this is safe/cheap to
// run on every boot after the first successful import.
const { runAllSeedImports } = require('./db/seedImports');
runAllSeedImports(db);

// BRD V3 EWS Dictionary (31 EWS_ID rows) -- idempotent, no-op once ews_dictionary has rows. Called
// here (not from db.js) so it runs after db/seed.js has already populated the base hpt codes
// (TIKUS/UPDKS/...) it depends on -- see seedEwsDictionaryV3.js's header comment.
require('./db/seedEwsDictionaryV3').seedEwsDictionaryV3(db);

// BRD V3.1 Assessment Mapping Dictionary + EWS-01..EWS-31 alias -- idempotent, must run after
// seedEwsDictionaryV3 above (it updates ews_dictionary rows that seed creates). See
// seedAssessmentMappingV31.js's header comment.
require('./db/seedAssessmentMappingV31').seedAssessmentMappingV31(db);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`EWS HPT backend listening on http://localhost:${PORT}`);
});
