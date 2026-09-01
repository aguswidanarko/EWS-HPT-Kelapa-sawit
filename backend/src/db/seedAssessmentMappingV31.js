// BRD V3.1 seeder: EWS_Assessment_Mapping_Dictionary_V3_1.xlsx ("EWS Assessment Mapping" +
// "EWS Master 31" sheets), supplied by the user 2026-09-01 alongside BRD_Mobile_V3_1.docx and
// BRD_Backend_Addendum_V3_1.docx.
//
// Two things happen here, both idempotent (guarded by `SELECT COUNT(*) FROM assessment_mapping`,
// a no-op on every later boot exactly like seedEwsDictionaryV3.js):
//
//   1. Populate ews_dictionary.alias_ews_id with the new EWS-01..EWS-31 numbering from the BRD's
//      "EWS Master 31" sheet. This is a pure alias over the EXISTING ews_id (HPT-001, AGR-004,
//      YM-001, WM-002, ...) -- nothing about the old codes, incident/alert history, or
//      Import/Export Center changes. The README that shipped with the BRD package flags an
//      important source note: the workbook's EWS sheet has 31 numbered rows, not 32, and
//      explicitly does not invent an "EWS-32". Cross-checking against seedEwsDictionaryV3.js's
//      own DICTIONARY array confirms why: AGR-002 and AGR-003 are byte-for-byte duplicate rows
//      (both ['Agro','TBM_VEGETATIF','TBM',...]) -- a pre-existing data-entry duplication in the
//      old 32-row set, not a real second indicator. EWS-01..EWS-31 = the old 32 rows minus that
//      one duplicate; every other row has a clean 1:1 correspondence (verified by stage and
//      threshold text against the BRD's "EWS Master 31" sheet). AGR-003 is therefore marked
//      NONAKTIF here (never deleted, matching this codebase's "an EWS_ID is never deleted" rule)
//      rather than given an alias.
//
//   2. Seed the `assessment_mapping` table (BRD Addendum V3.1 section 2/26 "EWS Assessment
//      Mapping Dictionary") -- one row per Assessment_Parameter (ASM-001..040) the mobile
//      Universal Assessment Form can capture, with the EWS_ID(s) it feeds (one-to-many, e.g.
//      Tikus -> EWS-01/02/03 by planting stage) or NULL if the BRD explicitly calls it
//      supporting/non-EWS data (Kastrasi, Sanitasi, Tirathaba, Upper stem root, Lainnya, KBH,
//      Beneficial Plants). This table is reference/documentation data read by the dashboard --
//      services/assessmentEngine.js's actual calculation calls computeIndicatorResult() against
//      the existing hpt/formula/threshold tables (see that file's header comment for exactly
//      which ASM rows are auto-calculated vs. flagged for a dedicated sensus vs. stored as
//      supporting data only, and why).

const ALIAS_MAP = [
  ['HPT-001', 'EWS-01'], ['HPT-002', 'EWS-02'], ['HPT-003', 'EWS-03'],
  ['HPT-004', 'EWS-04'], ['HPT-005', 'EWS-05'], ['HPT-006', 'EWS-06'],
  ['HPT-007', 'EWS-07'], ['HPT-008', 'EWS-08'], ['HPT-009', 'EWS-09'],
  ['HPT-010', 'EWS-10'], ['HPT-011', 'EWS-11'], ['HPT-012', 'EWS-12'],
  ['HPT-013', 'EWS-13'], ['HPT-014', 'EWS-14'], ['HPT-015', 'EWS-15'],
  ['YM-001', 'EWS-16'],
  ['AGR-001', 'EWS-17'], ['AGR-002', 'EWS-18'], // AGR-003 intentionally omitted (exact duplicate of AGR-002), deactivated below
  ['AGR-004', 'EWS-19'], ['AGR-005', 'EWS-20'], ['AGR-006', 'EWS-21'],
  ['AGR-007', 'EWS-22'], ['AGR-008', 'EWS-23'], ['AGR-009', 'EWS-24'],
  ['AGR-010', 'EWS-25'], ['AGR-011', 'EWS-26'], ['AGR-012', 'EWS-27'],
  ['AGR-013', 'EWS-28'], ['AGR-014', 'EWS-29'],
  ['WM-001', 'EWS-30'], ['WM-002', 'EWS-31'],
];

// [Assessment_ID, Category, Assessment_Parameter, Input_Type, EWS_ID(s)|null, EWS_Indicator,
//  Planting_Stage, Calculation_or_Use, Threshold_or_Status, Required, Capture_Level, Notes]
const ASM_ROWS = [
  ['ASM-001', 'Kondisi Pokok', 'Kerdil', 'Boolean', 'EWS-26', 'Pokok kerdil', 'TBM/TM', 'count affected / total sampled *100', 'Severity if applicable', 'Yes', 'Per pokok', 'EWS warning derived by backend'],
  ['ASM-002', 'Kondisi Pokok', 'Etiolasi', 'Boolean', 'EWS-20', 'Etiolasi', 'TBM/TM', 'count affected / total sampled *100', 'Ringan/Sedang/Berat', 'Yes', 'Per pokok', null],
  ['ASM-003', 'Kondisi Pokok', 'Sisipan', 'Boolean', 'EWS-28', 'Pkk sisipan', 'TBM/TM', 'count affected / total sampled *100', 'Ringan/Sedang/Berat', 'Yes', 'Per pokok', null],
  ['ASM-004', 'Kondisi Pokok', 'Kastrasi', 'Boolean', null, 'Data agronomi pendukung', 'TBM/TM', null, null, 'Yes', 'Per pokok', 'Tidak dipetakan sebagai EWS bernomor pada Sheet 1'],
  ['ASM-005', 'Kondisi Pokok', 'Sanitasi', 'Boolean', null, 'Data agronomi/IPM pendukung', 'TBM/TM', null, null, 'Yes', 'Per pokok', 'Tidak dipetakan sebagai EWS bernomor pada Sheet 1'],
  ['ASM-006', 'Kondisi Pokok', 'Tumbang', 'Boolean', 'EWS-29', 'Pkk mati/kondisi pokok', 'TBM/TM', 'count affected / total sampled *100', 'Ringan/Sedang/Berat', 'Yes', 'Per pokok', 'Source indicator is Pkk mati; tumbang is listed in assessment form'],
  ['ASM-007', 'Kondisi Pokok', 'Kosong/Mati', 'Boolean', 'EWS-29', 'Pkk mati', 'TBM/TM', 'count affected / total sampled *100', 'Ringan/Sedang/Berat', 'Yes', 'Per pokok', null],
  ['ASM-008', 'Kondisi Pokok', 'Abnormal/Steril', 'Boolean', 'EWS-27', 'Abnormal', 'TBM/TM', 'count affected per parameter / total sampled *100', 'Ringan/Sedang/Berat', 'Yes', 'Per pokok', null],
  ['ASM-009', 'Kondisi Pokok', 'Pruning', 'Enum', 'EWS-23', 'Overpruning', 'TBM/TM', 'actual frond count vs age standard', 'U/O', 'Yes', 'Per pokok', 'Sheet 1 specifically defines overpruning; U/O from assessment'],
  ['ASM-010', 'Gejala Defisiensi', 'N', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-011', 'Gejala Defisiensi', 'P', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-012', 'Gejala Defisiensi', 'K', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-013', 'Gejala Defisiensi', 'Mg', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-014', 'Gejala Defisiensi', 'B', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-015', 'Gejala Defisiensi', 'Cu', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-016', 'Gejala Defisiensi', 'Zn', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-017', 'Gejala Defisiensi', 'Fe', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-018', 'Gejala Defisiensi', 'N/K', 'Severity', 'EWS-19', 'Defisiensi Makro & Mikro', 'TBM/TM', 'affected / total sampled *100', 'R/S/B', 'Yes', 'Per pokok', null],
  ['ASM-019', 'Hama dan Penyakit', 'Ulat', 'Boolean', 'EWS-04/EWS-05/EWS-06', 'UPDKS', 'TM/TBM/TB-0', 'affected / sampled *100; minimum 50', 'Threshold by stage', 'Yes', 'Per pokok', 'Assessment symptom is a generic Ulat flag; detailed UPDKS census remains separate'],
  ['ASM-020', 'Hama dan Penyakit', 'Tikus', 'Boolean', 'EWS-01/EWS-02/EWS-03', 'Tikus', 'TM/TBM/TB-0', 'stage-specific formula', 'Threshold by stage', 'Yes', 'Per pokok/TPH', 'For TM source uses TBS cut at TPH; TBM/TB-0 uses affected plants'],
  ['ASM-021', 'Hama dan Penyakit', 'Rayap', 'Boolean', 'EWS-10/EWS-11/EWS-12', 'Rayap', 'TM/TBM/TB-0', 'affected / sampled *100', 'Direct census if symptom found', 'Yes', 'Per pokok', null],
  ['ASM-022', 'Hama dan Penyakit', 'Kumbang', 'Boolean', 'EWS-07/EWS-08/EWS-09', 'Oryctes', 'TM/TBM/TB-0', 'affected / sampled *100', '>5% TM; >2% TBM/TB-0', 'Yes', 'Per pokok', 'Assessment uses Kumbang; Sheet 1 uses Oryctes'],
  ['ASM-023', 'Hama dan Penyakit', 'Tirathaba', 'Boolean', null, 'HPT supporting observation', 'TBM/TM', null, null, 'Yes', 'Per pokok', 'No numbered EWS mapping explicitly present in Sheet 1'],
  ['ASM-024', 'Hama dan Penyakit', 'Upper stem root', 'Boolean', null, 'Disease supporting observation', 'TBM/TM', null, null, 'Yes', 'Per pokok', 'No numbered EWS mapping explicitly present in Sheet 1'],
  ['ASM-025', 'Hama dan Penyakit', 'Basal stem root', 'Boolean', 'EWS-13/EWS-14/EWS-15', 'Ganoderma', 'TM/TBM/TB-0', 'affected / sampled *100; minimum around 50', 'Direct census if symptom found', 'Yes', 'Per pokok', 'Assessment label differs from Sheet 1 symptom wording'],
  ['ASM-026', 'Hama dan Penyakit', 'Lainnya', 'Text/Enum', null, 'Other observation', 'All', null, null, 'No', 'Per pokok', 'Requires separate master if later mapped to EWS'],
  ['ASM-027', 'Kondisi Lapangan', 'Susunan pelepah', 'Boolean/Enum', 'EWS-24', 'Susunan pelepah', 'TM', 'standard U-shape / total sampled *100', 'U-shape standard', 'Yes', 'Per pokok', null],
  ['ASM-028', 'Kondisi Lapangan', 'Piringan', 'Boolean', 'EWS-25', 'Ground cover management', 'TBM/TM', 'ground-cover assessment', 'Severity', 'Yes', 'Per pokok/areal', null],
  ['ASM-029', 'Kondisi Lapangan', 'Jenis Gulma dominan (Piringan)', 'Multi-select', 'EWS-25', 'Ground cover management', 'TBM/TM', 'supporting classification', 'V/B/F/W/G', 'No', 'Per pokok/areal', 'V=VOPS, B=Broad Leaf, F=Fern, W=Woodies, G=Grasses'],
  ['ASM-030', 'Kondisi Lapangan', 'Gawangan', 'Boolean', 'EWS-25', 'Ground cover management', 'TBM/TM', 'ground-cover assessment', 'Severity', 'Yes', 'Areal', null],
  ['ASM-031', 'Kondisi Lapangan', 'Jenis Gulma dominan (Gawangan)', 'Multi-select', 'EWS-25', 'Ground cover management', 'TBM/TM', 'supporting classification', 'V/B/F/W/G', 'No', 'Areal', null],
  ['ASM-032', 'Kondisi Lapangan', 'Aplikasi Pupuk', 'Boolean', 'EWS-18', 'TBM vegetatif / agronomy support', 'TBM', 'supporting event data', 'Age-dependent', 'No', 'Blok', 'Sheet 1 does not explicitly make fertilizer application itself the threshold'],
  ['ASM-033', 'Kondisi Lapangan', 'Aplikasi by-product DDS / BA / Fiber', 'Multi-select', 'EWS-17', 'Bahan Organik', 'TM', 'supporting observation', 'Areal condition', 'No', 'Blok/areal', null],
  ['ASM-034', 'Kondisi Lapangan', 'Erosi', 'Boolean', 'EWS-22', 'Areal tanpa teras / land condition', 'TBM/TM', 'supporting land observation', 'Severity / slope', 'Yes', 'Areal', 'Sheet 1 focuses on slope >15% and terrace coverage'],
  ['ASM-035', 'Water management', 'Drainase', 'Boolean', 'EWS-30/EWS-31', 'Water Management', 'TM/TBM/TB-0', 'supporting water condition', 'Threshold from rule', 'Yes', 'Parit/blok', null],
  ['ASM-036', 'Water management', 'Water Level', 'Number', 'EWS-30', 'Water Management', 'TM/TBM/TB-0', 'water level and trend; source threshold <40 cm', '<40 cm', 'Yes', 'Pinggir parit', 'Mobile should capture actual cm, not only checkmark/cross'],
  ['ASM-037', 'Water management', 'Water Weir', 'Boolean', 'EWS-30/EWS-31', 'Water Management', 'TM/TBM/TB-0', 'supporting water condition', 'Condition', 'Yes', 'Parit', null],
  ['ASM-038', 'Water management', 'Kondisi parit (blok)', 'Enum', 'EWS-30/EWS-31', 'Water Management', 'TM/TBM/TB-0', 'supporting water condition', 'Condition/duration', 'Yes', 'Blok', null],
  ['ASM-039', 'IPM', 'KBH', 'Boolean', null, 'IPM supporting observation', 'TM/TBM/TB-0', null, null, 'No', 'Areal', 'Not explicitly defined as separate EWS threshold in Sheet 1'],
  ['ASM-040', 'IPM', 'Beneficial Plants', 'Boolean', null, 'IPM supporting observation', 'TM/TBM/TB-0', null, null, 'No', 'Areal', 'Not explicitly defined as separate EWS threshold in Sheet 1'],
];

function seedAssessmentMappingV31(db) {
  const already = db.prepare('SELECT COUNT(*) AS n FROM assessment_mapping').get();
  if (already.n > 0) return { skipped: true };

  const updateAlias = db.prepare(`UPDATE ews_dictionary SET alias_ews_id=?, updated_at=datetime('now') WHERE ews_id=?`);
  const tx1 = db.transaction((rows) => {
    for (const [ews_id, alias] of rows) updateAlias.run(alias, ews_id);
    // AGR-003 is a byte-for-byte duplicate of AGR-002 (both TBM_VEGETATIF/TBM) in the original
    // 32-row V3 dictionary -- see header comment. Deactivate rather than delete.
    db.prepare(`UPDATE ews_dictionary SET status='NONAKTIF', updated_at=datetime('now') WHERE ews_id='AGR-003'`).run();
  });
  tx1(ALIAS_MAP);

  const insertMapping = db.prepare(
    `INSERT INTO assessment_mapping (
      assessment_param_id, category, assessment_parameter, input_type, ews_id_list, ews_indicator,
      planting_stage, calculation_or_use, threshold_or_status, required, capture_level, notes
    ) VALUES (@assessment_param_id, @category, @assessment_parameter, @input_type, @ews_id_list, @ews_indicator,
      @planting_stage, @calculation_or_use, @threshold_or_status, @required, @capture_level, @notes)`
  );
  const tx2 = db.transaction((rows) => {
    for (const r of rows) {
      insertMapping.run({
        assessment_param_id: r[0], category: r[1], assessment_parameter: r[2], input_type: r[3],
        ews_id_list: r[4], ews_indicator: r[5], planting_stage: r[6], calculation_or_use: r[7],
        threshold_or_status: r[8], required: r[9], capture_level: r[10], notes: r[11],
      });
    }
  });
  tx2(ASM_ROWS);

  return { skipped: false, aliased: ALIAS_MAP.length, mappingRows: ASM_ROWS.length };
}

module.exports = { seedAssessmentMappingV31, ALIAS_MAP, ASM_ROWS };
