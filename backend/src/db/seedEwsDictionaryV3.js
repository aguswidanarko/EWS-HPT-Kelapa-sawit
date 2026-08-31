// BRD V3 EWS Dictionary seeder (Master_EWS_Dictionary_V3.xlsx, 31 EWS_ID rows).
//
// Pure schema/reference-data seeding -- no service/ruleEngine.js or services/ingestion.js
// dependency, so (unlike backend/src/db/seedImports/*.js, which seed historical TRANSACTION
// data and must be called from src/index.js to avoid a circular require) this is safe to call
// directly from db.js, right after loadSchema()/migrateV2Columns()/migrateAlertStatusV2().
//
// Idempotency: guarded by `SELECT COUNT(*) FROM ews_dictionary` -- once any row exists this is a
// no-op on every later boot, exactly like every other migration in db.js. Safe to run against the
// already-live production databases (Render + office server) without touching existing
// hpt/threshold/formula rows or any transaction data (detection/sensus/treatment/... untouched).
//
// Mapping judgment calls (documented here, also called out in the final report to the user):
//   - 21 of the 31 EWS_ID rows address an indicator that ALREADY has a hpt/formula/threshold row
//     (5 HPT pests x 3 planting stages = 15, YM-001, WM-001, AGR-001..004) -- these get ONLY a new
//     ews_dictionary registry row, no new hpt/formula/threshold rows.
//   - WM-002 ("Genangan air >20 hari") reuses the existing WATER_MANAGEMENT hpt_id but needed its
//     own formula row (DURATION on flooding_duration_hari, context='WM_GENANGAN') since the
//     existing WATER_MANAGEMENT formula only covers water_level_cm (context='YIELD_MAKING').
//   - The remaining 10 AGR-005..014 indicators (Etiolasi, Pokok doyong, Areal tanpa teras,
//     Overpruning, Susunan pelepah, Ground cover management, Pokok kerdil, Abnormal, Pokok
//     sisipan, Pokok mati) have NO existing table -- they are captured via the new generic
//     `agro_observation` table (see schema.sql V3 EXTENSIONS) and get brand-new hpt rows
//     (category AGRONOMY). Two of them (Pokok doyong ">15 derajat", Areal tanpa teras "kemiringan
//     >15%") have a clean numeric spec in the dictionary and are modeled as THRESHOLD formulas on
//     agro_observation.nilai_ukur. The other 8 are specified only as "Severity" (or a
//     non-numeric condition like Overpruning's age-conditional songgo count, or Susunan
//     pelepah's "U-shape" check) with no machine-checkable formula given anywhere in the BRD --
//     these are modeled as CATEGORICAL_CONDITION on agro_observation.kategori (petugas submits
//     RINGAN/SEDANG/BERAT directly, same idiom already used for TBM_VEGETATIF/Ganoderma/
//     Defisiensi Hara), NOT a fabricated numeric formula.

function seedEwsDictionaryV3(db) {
  const already = db.prepare('SELECT COUNT(*) AS n FROM ews_dictionary').get();
  if (already.n > 0) return { skipped: true };

  const categoryId = {};
  for (const row of db.prepare('SELECT id, code FROM ews_category').all()) categoryId[row.code] = row.id;

  const getHpt = db.prepare('SELECT * FROM hpt WHERE code=?');
  const insHpt = db.prepare(
    `INSERT INTO hpt (code, name, nama_lokal, kategori, status_aktif, deskripsi, gejala, metode_deteksi, metode_sensus, satuan, threshold_default, panduan_md, indicator_type, category_id)
     VALUES (@code, @name, @nama_lokal, @kategori, 1, @deskripsi, @gejala, @metode_deteksi, @metode_sensus, @satuan, @threshold_default, @panduan_md, 'AGRONOMY', @category_id)`
  );
  const insFormula = db.prepare(
    `INSERT INTO formula (hpt_id, formula_type, context, expression_json, unit, description, active)
     VALUES (@hpt_id, @formula_type, @context, @expression_json, @unit, @description, 1)`
  );
  const insThreshold = db.prepare(
    `INSERT INTO threshold (hpt_id, species_id, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan, severity, effective_date, status)
     VALUES (@hpt_id, NULL, @fase_tanaman, @kategori, @nilai_min, @nilai_max, @satuan, @tindakan, @kategori, date('now'), 'AKTIF')`
  );
  const insRuleVersion = db.prepare(
    `INSERT INTO rule_version (entity_type, entity_id, version_no, effective_date, status, change_note, snapshot_json)
     VALUES ('EWS_DICTIONARY', @entity_id, 1, date('now'), 'AKTIF', 'BRD V3 initial seed', @snapshot_json)`
  );
  const insDictionary = db.prepare(
    `INSERT INTO ews_dictionary (ews_id, scope, hpt_id, planting_stage, threshold_display_text, inspection_interval, recommendation, current_rule_version_id, status)
     VALUES (@ews_id, @scope, @hpt_id, @planting_stage, @threshold_display_text, @inspection_interval, @recommendation, NULL, 'ACTIVE')`
  );

  function ensureAgroHpt(code, name, satuan) {
    const existing = getHpt.get(code);
    if (existing) return existing.id;
    const info = insHpt.run({
      code,
      name,
      nama_lokal: name,
      kategori: 'AGRONOMI',
      deskripsi: `Indikator agronomi BRD V3: ${name}`,
      gejala: null,
      metode_deteksi: 'Pengamatan visual lapangan',
      metode_sensus: 'KUALITATIF',
      satuan: satuan || 'severity',
      threshold_default: null,
      panduan_md: null,
      category_id: categoryId.AGRONOMY || null,
    });
    return info.lastInsertRowid;
  }

  function ensureCategoricalFormulaAndThreshold(hpt_id, description) {
    // RINGAN/SEDANG/BERAT ordinal scale, same idiom as TBM_VEGETATIF/GANODERMA/DEFISIENSI_HARA.
    insFormula.run({
      hpt_id,
      formula_type: 'CATEGORICAL_CONDITION',
      context: 'AGRO_OBSERVATION',
      expression_json: JSON.stringify({
        field: 'kategori',
        default: 'NORMAL',
        unit: 'skala',
        scale: { NORMAL: 0, RINGAN: 1, SEDANG: 2, BERAT: 3 },
      }),
      unit: 'skala',
      description,
    });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'NORMAL', nilai_min: 0, nilai_max: 0, satuan: 'skala', tindakan: 'Pengamatan rutin' });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'RINGAN', nilai_min: 1, nilai_max: 1, satuan: 'skala', tindakan: 'Hubungi Riset' });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'SEDANG', nilai_min: 2, nilai_max: 2, satuan: 'skala', tindakan: 'Hubungi Riset' });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'BERAT', nilai_min: 3, nilai_max: 3, satuan: 'skala', tindakan: 'Hubungi Riset segera' });
  }

  function ensureThresholdFormula(hpt_id, unit, description, normalMax) {
    // Clean numeric spec (Pokok doyong >15 derajat, Areal tanpa teras kemiringan >15%).
    insFormula.run({
      hpt_id,
      formula_type: 'THRESHOLD',
      context: 'AGRO_OBSERVATION',
      expression_json: JSON.stringify({ field: 'nilai_ukur', unit }),
      unit,
      description,
    });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'NORMAL', nilai_min: 0, nilai_max: normalMax, satuan: unit, tindakan: 'Pengamatan rutin' });
    insThreshold.run({ hpt_id, fase_tanaman: 'SEMUA', kategori: 'BERAT', nilai_min: normalMax, nilai_max: null, satuan: unit, tindakan: 'Hubungi Riset' });
  }

  // ---- Ensure the 10 new AGR-005..014 hpt rows + formula + threshold exist -------------------
  const newAgro = {
    ETIOLASI: { name: 'Etiolasi', mode: 'CATEGORICAL' },
    POKOK_DOYONG: { name: 'Pokok doyong', mode: 'THRESHOLD', unit: 'derajat', normalMax: 15 },
    AREAL_TANPA_TERAS: { name: 'Areal tanpa teras', mode: 'THRESHOLD', unit: '%', normalMax: 15 },
    OVERPRUNING: { name: 'Overpruning', mode: 'CATEGORICAL' },
    SUSUNAN_PELEPAH: { name: 'Susunan pelepah', mode: 'CATEGORICAL' },
    GROUND_COVER: { name: 'Ground cover management', mode: 'CATEGORICAL' },
    POKOK_KERDIL: { name: 'Pokok kerdil', mode: 'CATEGORICAL' },
    ABNORMAL: { name: 'Abnormal', mode: 'CATEGORICAL' },
    POKOK_SISIPAN: { name: 'Pokok sisipan', mode: 'CATEGORICAL' },
    POKOK_MATI: { name: 'Pokok mati', mode: 'CATEGORICAL' },
  };
  const agroHptId = {};
  for (const [code, def] of Object.entries(newAgro)) {
    agroHptId[code] = ensureAgroHpt(code, def.name, def.mode === 'THRESHOLD' ? def.unit : 'severity');
    if (def.mode === 'THRESHOLD') {
      ensureThresholdFormula(agroHptId[code], def.unit, `BRD V3: ${def.name} (${def.unit === '%' ? 'kemiringan' : 'derajat'} >${def.normalMax} -> BERAT)`, def.normalMax);
    } else {
      ensureCategoricalFormulaAndThreshold(agroHptId[code], `BRD V3: ${def.name} -- dictionary hanya menyebut "Severity", tanpa formula numerik; petugas memilih kategori langsung (judgment call, lihat komentar di seedEwsDictionaryV3.js).`);
    }
  }

  // ---- WM-002 needs its own formula row alongside WATER_MANAGEMENT's existing water_level_cm one
  const waterMgmt = getHpt.get('WATER_MANAGEMENT');
  if (waterMgmt) {
    const hasGenangan = db.prepare(`SELECT COUNT(*) AS n FROM formula WHERE hpt_id=? AND context='WM_GENANGAN'`).get(waterMgmt.id);
    if (hasGenangan.n === 0) {
      insFormula.run({
        hpt_id: waterMgmt.id,
        formula_type: 'DURATION',
        context: 'WM_GENANGAN',
        expression_json: JSON.stringify({ field: 'flooding_duration_hari', unit: 'hari' }),
        unit: 'hari',
        description: 'BRD V3 WM-002: genangan air >20 hari',
      });
      insThreshold.run({ hpt_id: waterMgmt.id, fase_tanaman: 'SEMUA', kategori: 'NORMAL', nilai_min: 0, nilai_max: 20, satuan: 'hari', tindakan: 'Pengamatan rutin' });
      insThreshold.run({ hpt_id: waterMgmt.id, fase_tanaman: 'SEMUA', kategori: 'BERAT', nilai_min: 20, nilai_max: null, satuan: 'hari', tindakan: 'Upaya penurunan level air' });
    }
  }

  // ---- Build the hpt_id lookup for the 21 already-existing indicators -------------------------
  const existingCode = {};
  for (const code of ['UPDKS', 'TIKUS', 'ORYCTES', 'RAYAP', 'GANODERMA', 'PARTENOCARPI', 'WATER_MANAGEMENT', 'BAHAN_ORGANIK', 'TBM_VEGETATIF', 'DEFISIENSI_HARA']) {
    const row = getHpt.get(code);
    if (row) existingCode[code] = row.id;
  }

  // ---- The 31 EWS_ID rows from Master_EWS_Dictionary_V3.xlsx 'EWS Dictionary' sheet -----------
  const DICTIONARY = [
    ['HPT-001', 'HPT', 'TIKUS', 'TM', '>5%', '2 minggu', 'Lakukan Sensus Tikus'],
    ['HPT-002', 'HPT', 'TIKUS', 'TBM', '>2%', '2 minggu', 'Lakukan Sensus Tikus'],
    ['HPT-003', 'HPT', 'TIKUS', 'TB-0', '>2%', '2 minggu', 'Lakukan Sensus Tikus'],
    ['HPT-004', 'HPT', 'UPDKS', 'TM', '>5%', '2 minggu', 'Lakukan Sensus UPDKS'],
    ['HPT-005', 'HPT', 'UPDKS', 'TBM', '>2%', '2 minggu', 'Lakukan Sensus UPDKS'],
    ['HPT-006', 'HPT', 'UPDKS', 'TB-0', '>2%', '2 minggu', 'Lakukan Sensus UPDKS'],
    ['HPT-007', 'HPT', 'ORYCTES', 'TM', '>5%', '2 minggu', 'Lakukan Sensus Oryctes'],
    ['HPT-008', 'HPT', 'ORYCTES', 'TBM', '>2%', '2 minggu', 'Lakukan Sensus Oryctes'],
    ['HPT-009', 'HPT', 'ORYCTES', 'TB-0', '>2%', '2 minggu', 'Lakukan Sensus Oryctes'],
    ['HPT-010', 'HPT', 'RAYAP', 'TM', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['HPT-011', 'HPT', 'RAYAP', 'TBM', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['HPT-012', 'HPT', 'RAYAP', 'TB-0', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['HPT-013', 'HPT', 'GANODERMA', 'TM', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['HPT-014', 'HPT', 'GANODERMA', 'TBM', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['HPT-015', 'HPT', 'GANODERMA', 'TB-0', 'Ada gejala', '2 minggu', 'Sensus mata lima'],
    ['YM-001', 'Yield Making', 'PARTENOCARPI', 'TM', '>1% janjang abnormal', '2 minggu / sensus 1 bulan', 'Sensus bunga jantan & populasi Elaidibius'],
    ['AGR-001', 'Agro', 'BAHAN_ORGANIK', 'TM', '>5%', '2 bulan', 'Hubungi Riset'],
    ['AGR-002', 'Agro', 'TBM_VEGETATIF', 'TBM', 'Bergantung umur tanaman', '2 bulan', 'Hubungi Riset'],
    ['AGR-003', 'Agro', 'TBM_VEGETATIF', 'TBM', 'Bergantung umur tanaman', '2 bulan', 'Hubungi Riset'],
    ['AGR-004', 'Agro', 'DEFISIENSI_HARA', 'TBM/TM', 'Ringan/Sedang/Berat', '2 bulan', 'Hubungi Riset'],
    ['AGR-005', 'Agro', 'ETIOLASI', 'TBM/TM', 'Ringan/Sedang/Berat', '2 bulan', 'Hubungi Riset'],
    ['AGR-006', 'Agro', 'POKOK_DOYONG', 'TBM/TM', '>15 derajat / severity', '2 bulan', 'Hubungi Riset'],
    ['AGR-007', 'Agro', 'AREAL_TANPA_TERAS', 'TBM/TM', 'Kemiringan >15%', '2 bulan', 'Perlu dibuat teras atau tidak'],
    ['AGR-008', 'Agro', 'OVERPRUNING', 'TBM/TM', '>15 songgo umur >15; <15 songgo umur <15', '2 bulan', 'Hubungi Riset'],
    ['AGR-009', 'Agro', 'SUSUNAN_PELEPAH', 'TM', 'U-shape', '2 bulan', 'Hubungi Riset'],
    ['AGR-010', 'Agro', 'GROUND_COVER', 'TBM/TM', 'Severity', '2 bulan', 'Hubungi Riset'],
    ['AGR-011', 'Agro', 'POKOK_KERDIL', 'TBM/TM', 'Severity', '2 bulan', 'Hubungi Riset'],
    ['AGR-012', 'Agro', 'ABNORMAL', 'TBM/TM', 'Severity', '2 bulan', 'Hubungi Riset'],
    ['AGR-013', 'Agro', 'POKOK_SISIPAN', 'TBM/TM', 'Severity', '2 bulan', 'Hubungi Riset'],
    ['AGR-014', 'Agro', 'POKOK_MATI', 'TBM/TM', 'Severity', '2 bulan', 'Hubungi Riset'],
    ['WM-001', 'WM', 'WATER_MANAGEMENT', 'TM/TBM/TB-0', '<40 cm', '2 minggu / sensus 1 bulan', 'Upaya peningkatan level air'],
    ['WM-002', 'WM', 'WATER_MANAGEMENT', 'TM/TBM/TB-0', '>20 hari', 'By case / sensus 1 bulan', 'Upaya penurunan level air'],
  ];

  const insert = db.transaction((rows) => {
    let count = 0;
    for (const [ews_id, scope, code, planting_stage, threshold_display_text, inspection_interval, recommendation] of rows) {
      const hpt_id = existingCode[code] || agroHptId[code];
      if (!hpt_id) throw new Error(`seedEwsDictionaryV3: hpt code tidak ditemukan untuk ${ews_id}: ${code}`);
      // Insert ews_dictionary first (current_rule_version_id NULL) so rule_version.entity_id
      // (NOT NULL) can point at a real dictionary row id, then back-fill current_rule_version_id.
      const dictInfo = insDictionary.run({ ews_id, scope, hpt_id, planting_stage, threshold_display_text, inspection_interval, recommendation });
      const ruleVersionId = insRuleVersion.run({
        entity_id: dictInfo.lastInsertRowid,
        snapshot_json: JSON.stringify({ ews_id, scope, indicator_code: code, planting_stage, threshold_display_text, inspection_interval, recommendation }),
      }).lastInsertRowid;
      db.prepare('UPDATE ews_dictionary SET current_rule_version_id=? WHERE id=?').run(ruleVersionId, dictInfo.lastInsertRowid);
      count += 1;
    }
    return count;
  });

  const committed = insert(DICTIONARY);

  db.prepare(
    `INSERT INTO import_log (user_id, entity_type, filename, total_rows, valid_rows, error_rows, errors_json, status, committed_count)
     VALUES (NULL, 'EWS_MASTER_DICTIONARY', 'Master_EWS_Dictionary_V3.xlsx (seed)', ?, ?, 0, '[]', 'COMMITTED', ?)`
  ).run(DICTIONARY.length, DICTIONARY.length, committed);

  // eslint-disable-next-line no-console
  console.log(`[seedEwsDictionaryV3] committed=${committed} EWS_ID rows (10 new Agro hpt rows created)`);
  return { skipped: false, committed };
}

module.exports = { seedEwsDictionaryV3 };
