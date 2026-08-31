// EWS_ID Routing Registry (BRD V3 "Master EWS Dictionary" -- backend/docs/brd_v3/Master_EWS_Dictionary_V3.xlsx).
//
// Static, code-level map from every EWS_ID (HPT-001.., YM-001, AGR-001.., WM-001..) to the
// concrete backing table + write path already implemented for it. This is the "generic per-EWS_ID
// import/export" layer's lookup table (Task #26): given an EWS_ID, a caller can find which table
// to read for Export Center, which columns an Excel template needs, and which function/route
// ingests a new row for Import Center -- without hard-coding a switch/case per indicator.
//
// Why a *registry* instead of one more generic table: 22 of the 32 EWS_IDs already have a
// purpose-built table+route from V1/V2 (sensus/detection, yield_making's 4 sub-tables,
// defisiensi_hara_temuan) with their own validation/columns; only the 10 new Agro severity
// indicators (AGR-005..014) share the single generic `agro_observation` table added for V3
// (schema.sql, seedEwsDictionaryV3.js). Rather than migrating the 22 existing tables onto the
// generic shape (high-risk churn on already-live production data), this registry just points at
// whichever table/entry-point each EWS_ID already uses -- additive, matches this codebase's
// "don't touch what already works" migration idiom.
//
// NOTE: BRD V3 prose says "31 EWS rule records"; the real Master_EWS_Dictionary_V3.xlsx has 32
// data rows (verified via openpyxl). This registry and seedEwsDictionaryV3.js both reflect the
// real 32-row file, not the prose count -- see seedEwsDictionaryV3.js header for the same note.

const COMMON_TEMPLATE_COLUMNS = [
  { field: 'blok_code', label: 'Kode Blok', required: true },
  { field: 'tanggal', label: 'Tanggal (YYYY-MM-DD)', required: true },
  { field: 'petugas', label: 'Petugas', required: false },
  { field: 'catatan', label: 'Catatan', required: false },
  { field: 'gps_lat', label: 'GPS Lat', required: false },
  { field: 'gps_lng', label: 'GPS Lng', required: false },
];

// value fields shared by every CATEGORICAL_CONDITION-type Agro indicator seeded in
// seedEwsDictionaryV3.js (AGR-005, 008..014): petugas picks RINGAN/SEDANG/BERAT directly, there is
// no numeric formula in the dictionary for these (judgment call, documented in
// seedEwsDictionaryV3.js next to each formula row).
const SEVERITY_VALUE_FIELDS = [
  { field: 'kategori', label: 'Kategori (RINGAN/SEDANG/BERAT)', required: true, type: 'enum', options: ['RINGAN', 'SEDANG', 'BERAT'] },
];

function sensusEntry(hptCode, planting_stage, valueFields) {
  return {
    table: 'sensus',
    entryPoint: { type: 'service', module: 'services/ingestion.js', fn: 'ingestSensus' },
    route: 'POST /api/sensus',
    keyField: 'jenis_sensus',
    keyValue: hptCode,
    hpt_code: hptCode, // duplicated as hpt_code too so every registry entry exposes hpt_code uniformly (Task #26 generic dispatcher keys off this)
    planting_stage,
    // sensus rows store raw counts in hasil_json (services/sensusEngines.js computeByHptCode does
    // the %/ratio math) -- valueFields here are that JSON's inner keys, not top-level columns.
    valueFields,
    valueShape: 'hasil_json',
  };
}

function yieldMakingEntry(table, subRoute, valueFields, fieldDefaults) {
  return {
    table,
    entryPoint: { type: 'route', module: 'routes/yieldMaking.js' },
    route: `POST /api/yield-making/${subRoute}`,
    keyField: null, // one table = one hptCode in yieldMaking.js's makeSubRouter, no discriminator column needed
    valueFields,
    valueShape: 'columns',
    fieldDefaults: fieldDefaults || {},
  };
}

function agroObservationEntry(hptCode, valueFields) {
  return {
    table: 'agro_observation',
    entryPoint: { type: 'service', module: 'services/ingestion.js', fn: 'ingestAgroObservation' },
    route: 'POST /api/agro-observation',
    keyField: 'ews_id', // agro_observation rows are discriminated by ews_id (denormalized) + hpt_id, not by table
    hpt_code: hptCode,
    valueFields,
    valueShape: 'columns',
  };
}

const EWS_REGISTRY = {
  // ---------------------------------------------------------------------------- HPT (sensus)
  'HPT-001': { scope: 'HPT', ...sensusEntry('TIKUS', 'TM', [{ field: 'serangan_baru', label: 'Serangan Baru', required: true, type: 'number' }, { field: 'serangan_lama', label: 'Serangan Lama', required: true, type: 'number' }, { field: 'jumlah_sampel', label: 'Jumlah Sampel', required: true, type: 'number' }]) },
  'HPT-002': { scope: 'HPT', ...sensusEntry('TIKUS', 'TBM', [{ field: 'serangan_baru', label: 'Serangan Baru', required: true, type: 'number' }, { field: 'serangan_lama', label: 'Serangan Lama', required: true, type: 'number' }, { field: 'jumlah_sampel', label: 'Jumlah Sampel', required: true, type: 'number' }]) },
  'HPT-003': { scope: 'HPT', ...sensusEntry('TIKUS', 'TB-0', [{ field: 'serangan_baru', label: 'Serangan Baru', required: true, type: 'number' }, { field: 'serangan_lama', label: 'Serangan Lama', required: true, type: 'number' }, { field: 'jumlah_sampel', label: 'Jumlah Sampel', required: true, type: 'number' }]) },
  'HPT-004': { scope: 'HPT', ...sensusEntry('UPDKS', 'TM', [{ field: 'ulat_hidup_total', label: 'Ulat Hidup Total', required: true, type: 'number' }, { field: 'jumlah_pelepah_diamati', label: 'Jumlah Pelepah Diamati', required: true, type: 'number' }]) },
  'HPT-005': { scope: 'HPT', ...sensusEntry('UPDKS', 'TBM', [{ field: 'ulat_hidup_total', label: 'Ulat Hidup Total', required: true, type: 'number' }, { field: 'jumlah_pelepah_diamati', label: 'Jumlah Pelepah Diamati', required: true, type: 'number' }]) },
  'HPT-006': { scope: 'HPT', ...sensusEntry('UPDKS', 'TB-0', [{ field: 'ulat_hidup_total', label: 'Ulat Hidup Total', required: true, type: 'number' }, { field: 'jumlah_pelepah_diamati', label: 'Jumlah Pelepah Diamati', required: true, type: 'number' }]) },
  'HPT-007': { scope: 'HPT', ...sensusEntry('ORYCTES', 'TM', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-008': { scope: 'HPT', ...sensusEntry('ORYCTES', 'TBM', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-009': { scope: 'HPT', ...sensusEntry('ORYCTES', 'TB-0', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-010': { scope: 'HPT', ...sensusEntry('RAYAP', 'TM', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-011': { scope: 'HPT', ...sensusEntry('RAYAP', 'TBM', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-012': { scope: 'HPT', ...sensusEntry('RAYAP', 'TB-0', [{ field: 'jumlah_pokok_terserang', label: 'Jumlah Pokok Terserang', required: true, type: 'number' }, { field: 'jumlah_pokok_diamati', label: 'Jumlah Pokok Diamati', required: true, type: 'number' }]) },
  'HPT-013': { scope: 'HPT', ...sensusEntry('GANODERMA', 'TM', [{ field: 'status_serangan', label: 'Status Serangan (TIDAK_ADA/INDIKASI_AWAL/TERINFEKSI_RINGAN/TERINFEKSI_SEDANG/TERINFEKSI_BERAT)', required: true, type: 'enum' }]) },
  'HPT-014': { scope: 'HPT', ...sensusEntry('GANODERMA', 'TBM', [{ field: 'status_serangan', label: 'Status Serangan (TIDAK_ADA/INDIKASI_AWAL/TERINFEKSI_RINGAN/TERINFEKSI_SEDANG/TERINFEKSI_BERAT)', required: true, type: 'enum' }]) },
  'HPT-015': { scope: 'HPT', ...sensusEntry('GANODERMA', 'TB-0', [{ field: 'status_serangan', label: 'Status Serangan (TIDAK_ADA/INDIKASI_AWAL/TERINFEKSI_RINGAN/TERINFEKSI_SEDANG/TERINFEKSI_BERAT)', required: true, type: 'enum' }]) },

  // ---------------------------------------------------------------------------- Yield Making
  'YM-001': {
    scope: 'Yield Making',
    planting_stage: 'TM',
    hpt_code: 'PARTENOCARPI',
    ...yieldMakingEntry('yield_partenocarpi', 'partenocarpi', [
      { field: 'periode', label: 'Periode (YYYY-MM)', required: false },
      { field: 'rainfall_mm', label: 'Curah Hujan (mm)', required: false, type: 'number' },
      { field: 'indikator_hujan_pagi', label: 'Curah Hujan Pagi-Siang (mm)', required: false, type: 'number' },
      { field: 'total_bunch', label: 'Total Tandan', required: true, type: 'number' },
      { field: 'abnormal_bunch', label: 'Tandan Abnormal', required: true, type: 'number' },
      { field: 'populasi_ek', label: 'Populasi Elaeidobius kamerunicus (ekor/ha)', required: false, type: 'number' },
    ]),
  },

  // ---------------------------------------------------------------------------- Agro (existing V2 tables)
  'AGR-001': {
    scope: 'Agro',
    planting_stage: 'TM',
    hpt_code: 'BAHAN_ORGANIK',
    ...yieldMakingEntry('bahan_organik', 'bahan-organik', [
      { field: 'area_type', label: 'Tipe Area', required: false },
      { field: 'total_sample', label: 'Total Sample', required: true, type: 'number' },
      { field: 'yellowing_count', label: 'Jumlah Menguning', required: true, type: 'number' },
      { field: 'vegetative_condition', label: 'Kondisi Vegetatif', required: false },
      { field: 'comparison_result', label: 'Hasil Perbandingan Baseline', required: false },
    ]),
  },
  'AGR-002': {
    scope: 'Agro',
    planting_stage: 'TBM',
    hpt_code: 'TBM_VEGETATIF',
    ...yieldMakingEntry('tbm_vegetatif', 'tbm-vegetatif', [
      { field: 'umur_bulan', label: 'Umur (bulan)', required: true, type: 'number' },
      { field: 'panjang_pelepah_cm', label: 'Panjang Pelepah (cm)', required: false, type: 'number' },
      { field: 'jumlah_pelepah', label: 'Jumlah Pelepah', required: false, type: 'number' },
      { field: 'lai', label: 'LAI (Leaf Area Index)', required: false, type: 'number' },
    ]),
  },
  // AGR-003 is the same indicator/table/route as AGR-002 (both TBM_VEGETATIF) -- the dictionary
  // xlsx splits it into two rows only because "Bergantung umur tanaman" covers more than one
  // umur bracket; there is no second table/route to distinguish (judgment call, matches
  // seedEwsDictionaryV3.js's DICTIONARY array which also reuses the TBM_VEGETATIF hpt code here).
  'AGR-003': {
    scope: 'Agro',
    planting_stage: 'TBM',
    hpt_code: 'TBM_VEGETATIF',
    ...yieldMakingEntry('tbm_vegetatif', 'tbm-vegetatif', [
      { field: 'umur_bulan', label: 'Umur (bulan)', required: true, type: 'number' },
      { field: 'panjang_pelepah_cm', label: 'Panjang Pelepah (cm)', required: false, type: 'number' },
      { field: 'jumlah_pelepah', label: 'Jumlah Pelepah', required: false, type: 'number' },
      { field: 'lai', label: 'LAI (Leaf Area Index)', required: false, type: 'number' },
    ]),
  },
  'AGR-004': {
    scope: 'Agro',
    planting_stage: 'TBM/TM',
    hpt_code: 'DEFISIENSI_HARA',
    table: 'defisiensi_hara_temuan',
    entryPoint: { type: 'route', module: 'routes/defisiensiHara.js' },
    route: 'POST /api/defisiensi-hara',
    keyField: null,
    // no auto rule-engine classification here (pre-existing V2 behavior, not changed for V3):
    // severity is set directly by the petugas from Riset's leaf_analysis finding, not computed --
    // so there is no ews_alert/kategori pair to populate from a formula the way AGR-005..014 do.
    valueFields: [
      { field: 'unsur_hara', label: 'Unsur Hara', required: true },
      { field: 'temuan_lapangan', label: 'Temuan Lapangan', required: false },
      { field: 'severity', label: 'Severity (RINGAN/SEDANG/BERAT)', required: true, type: 'enum', options: ['RINGAN', 'SEDANG', 'BERAT'] },
    ],
    valueShape: 'columns',
  },

  // ---------------------------------------------------------------------------- Agro (new V3 generic agro_observation table)
  'AGR-005': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('ETIOLASI', SEVERITY_VALUE_FIELDS) },
  'AGR-006': {
    scope: 'Agro',
    planting_stage: 'TBM/TM',
    ...agroObservationEntry('POKOK_DOYONG', [{ field: 'nilai_ukur', label: 'Derajat Kemiringan', required: true, type: 'number' }]),
  },
  'AGR-007': {
    scope: 'Agro',
    planting_stage: 'TBM/TM',
    ...agroObservationEntry('AREAL_TANPA_TERAS', [{ field: 'nilai_ukur', label: 'Kemiringan (%)', required: true, type: 'number' }]),
  },
  'AGR-008': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('OVERPRUNING', SEVERITY_VALUE_FIELDS) },
  'AGR-009': { scope: 'Agro', planting_stage: 'TM', ...agroObservationEntry('SUSUNAN_PELEPAH', SEVERITY_VALUE_FIELDS) },
  'AGR-010': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('GROUND_COVER', SEVERITY_VALUE_FIELDS) },
  'AGR-011': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('POKOK_KERDIL', SEVERITY_VALUE_FIELDS) },
  'AGR-012': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('ABNORMAL', SEVERITY_VALUE_FIELDS) },
  'AGR-013': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('POKOK_SISIPAN', SEVERITY_VALUE_FIELDS) },
  'AGR-014': { scope: 'Agro', planting_stage: 'TBM/TM', ...agroObservationEntry('POKOK_MATI', SEVERITY_VALUE_FIELDS) },

  // ---------------------------------------------------------------------------- Water Management
  // WM-001 and WM-002 are the SAME hpt_code/table (WATER_MANAGEMENT / water_management) but two
  // DIFFERENT active formula rows distinguished only by `context` (see
  // seedEwsDictionaryV3.js/schema.sql comment on water_management's formula rows):
  //   WM-001 context=YIELD_MAKING, THRESHOLD on water_level_cm  (<40cm -> alert)
  //   WM-002 context=WM_GENANGAN,  DURATION  on flooding_duration_hari (>20 hari -> alert)
  // routes/yieldMaking.js's /water-management sub-router hard-codes context:'YIELD_MAKING' in its
  // tryClassify() call, so posting through that route only ever evaluates the WM-001 formula.
  // classifyContext below is what Task #26's generic per-EWS_ID import path must pass to
  // computeIndicatorResult() (via services/ruleEngine.js directly, bypassing the route's
  // tryClassify) so a WM-002-tagged import row is classified against the genangan/duration
  // formula instead -- this is a real gap in the current route, not just registry metadata,
  // flagged here rather than silently worked around.
  'WM-001': {
    scope: 'WM',
    planting_stage: 'TM/TBM/TB-0',
    hpt_code: 'WATER_MANAGEMENT',
    classifyContext: 'YIELD_MAKING',
    ...yieldMakingEntry('water_management', 'water-management', [
      { field: 'titik_parit', label: 'Titik Parit', required: false },
      { field: 'water_level_cm', label: 'Muka Air (cm di bawah permukaan tanah)', required: true, type: 'number' },
    ], { flooding: 0 }),
  },
  'WM-002': {
    scope: 'WM',
    planting_stage: 'TM/TBM/TB-0',
    hpt_code: 'WATER_MANAGEMENT',
    classifyContext: 'WM_GENANGAN',
    ...yieldMakingEntry('water_management', 'water-management', [
      { field: 'titik_parit', label: 'Titik Parit', required: false },
      { field: 'flooding', label: 'Tergenang? (0/1)', required: true, type: 'number' },
      { field: 'flooding_duration_hari', label: 'Lama Genangan (hari)', required: true, type: 'number' },
    ], { flooding: 0 }),
  },
};

/** Returns the registry entry for one EWS_ID, or null if unknown. */
function getEwsEntry(ews_id) {
  return EWS_REGISTRY[ews_id] || null;
}

/** Lists EWS_IDs, optionally filtered by scope (HPT | Yield Making | Agro | WM). */
function listEwsIds(scope) {
  const ids = Object.keys(EWS_REGISTRY);
  return scope ? ids.filter((id) => EWS_REGISTRY[id].scope === scope) : ids;
}

/** Excel template column list for one EWS_ID: common columns + this indicator's value fields. */
function getTemplateColumns(ews_id) {
  const entry = getEwsEntry(ews_id);
  if (!entry) return null;
  return [...COMMON_TEMPLATE_COLUMNS, ...entry.valueFields];
}

module.exports = { EWS_REGISTRY, getEwsEntry, listEwsIds, getTemplateColumns };
