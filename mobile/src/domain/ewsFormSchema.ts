// EWS Dynamic Form Engine schema (BRD_V3_Mobile_Offline.docx section 3: "Form dibentuk dari EWS
// Dictionary/Input Schema sehingga seluruh 32 EWS dapat digunakan tanpa hard-code 31/32 form
// terpisah"). This is a hand-mirrored TypeScript copy of backend/src/services/ewsRegistry.js's
// EWS_REGISTRY (same 32 EWS_ID -> {scope, hpt_code, valueFields} mapping, kept in sync manually
// since this app is OFFLINE-first: fetching the schema over the network on every form open would
// defeat the point of a "Mobile Offline" BRD, so the shape is bundled with the app build instead
// of downloaded like ews_dictionary_cache's display text is). Only ONE screen (EwsFormScreen.tsx)
// and ONE picker (EwsPickerScreen.tsx) read this file - neither hard-codes a per-indicator layout.
//
// What's added here beyond ewsRegistry.js's valueFields (which back Import/Export Center's Excel
// templates, not full mobile UI):
//   - `layout`: which of the 4 UI patterns the existing hand-built screens actually used
//     (verified screen-by-screen before writing this file - see the mobile audit this schema
//     replaces). Not present in ewsRegistry.js because Import/Export Center only ever deals with
//     one already-aggregated row per submission, never the raw per-row/per-point capture UI.
//   - a couple of UI-only fields the real screens collect that ewsRegistry.js's valueFields (built
//     for Excel templates) omits, e.g. Tikus's `normal` counter - flagged inline below.
//   - `submit`: which local table + which upload path (existing V1 sensus, existing V2 per-entity
//     REST, or the new V3 agro_observation REST) a filled form goes to.

export type FieldType = 'number' | 'text' | 'enum' | 'boolean';

export interface EwsValueField {
  field: string;
  label: string;
  required: boolean;
  type: FieldType;
  options?: string[];
  unit?: string;
}

export type EwsLayout =
  | 'ROW_SAMPLING' // Blok.jumlah_baris-derived row grid (BARIS_SAMPEL), one small numeric field set per row, aggregated to a total before classification. Tikus/UPDKS/Oryctes.
  | 'GRID_SAMPLING' // Blok-derived baris x posisi grid (GRID), one boolean/qualitative capture per point, auto-generated (not manually added). Rayap.
  | 'QUALITATIVE_POINTS' // manually add-as-found points across the whole blok (SELURUH_POKOK), each point carrying its own valueFields + optional photo/GPS, worst-of scoring. Ganoderma.
  | 'SIMPLE_FIELDS'; // one set of valueFields, no rows/points. Yield Making, Defisiensi Hara, Agro Observation.

export type EwsSubmitTarget =
  | { kind: 'SENSUS'; hptCode: string } // saveSensusRecord() + existing V1 batch upload (sync/engine.ts uploadKind('sensus'))
  | { kind: 'YIELD_MAKING'; subpath: 'partenocarpi' | 'water-management' | 'bahan-organik' | 'tbm-vegetatif' }
  | { kind: 'DEFISIENSI_HARA' }
  | { kind: 'AGRO_OBSERVATION'; hptCode: string };

export interface EwsFormEntry {
  ews_id: string;
  scope: 'HPT' | 'Yield Making' | 'Agro' | 'WM';
  hpt_code: string;
  layout: EwsLayout;
  valueFields: EwsValueField[];
  submit: EwsSubmitTarget;
}

const SEVERITY_VALUE_FIELDS: EwsValueField[] = [
  { field: 'kategori', label: 'Kategori', required: true, type: 'enum', options: ['RINGAN', 'SEDANG', 'BERAT'] },
];

// ---------------------------------------------------------------------------------------------
// HPT (sensus) - ROW_SAMPLING (Tikus/UPDKS/Oryctes), GRID_SAMPLING (Rayap), QUALITATIVE_POINTS
// (Ganoderma). valueFields here are the mini-fields rendered per row/point, matching each real
// screen's `interface BarisRow`/`PointRow`/`PointEntry` exactly (not just ewsRegistry.js's
// Excel-template subset) - see file header for what's added vs. the backend registry:
//   - Tikus adds `normal` (screen has it, ewsRegistry.js's Excel template doesn't).
//   - UPDKS uses the screen's actual 6 sub-counts (telur/ulat_kecil/ulat_sedang/ulat_besar/
//     ulat_mati/kepompong -> aggregated to ulat_hidup_total = kecil+sedang+besar), not
//     ewsRegistry.js's already-aggregated ulat_hidup_total/jumlah_pelepah_diamati pair.
//   - Oryctes adds the screen's normal/stagnan/recovery/mati extra counters.
// ---------------------------------------------------------------------------------------------
const TIKUS_FIELDS: EwsValueField[] = [
  { field: 'serangan_baru', label: 'Serangan Baru', required: true, type: 'number' },
  { field: 'serangan_lama', label: 'Serangan Lama', required: true, type: 'number' },
  { field: 'normal', label: 'Normal', required: false, type: 'number' },
  { field: 'jumlah_sampel', label: 'Jumlah Sampel', required: true, type: 'number' },
];
const UPDKS_FIELDS: EwsValueField[] = [
  { field: 'jumlah_pelepah_diamati', label: 'Jumlah Pelepah Diamati', required: true, type: 'number' },
  { field: 'telur', label: 'Telur', required: false, type: 'number' },
  { field: 'ulat_kecil', label: 'Ulat Kecil', required: false, type: 'number' },
  { field: 'ulat_sedang', label: 'Ulat Sedang', required: false, type: 'number' },
  { field: 'ulat_besar', label: 'Ulat Besar', required: false, type: 'number' },
  { field: 'ulat_mati', label: 'Ulat Mati', required: false, type: 'number' },
  { field: 'kepompong', label: 'Kepompong', required: false, type: 'number' },
];
const ORYCTES_FIELDS: EwsValueField[] = [
  { field: 'serangan_baru', label: 'Serangan Baru', required: true, type: 'number' },
  { field: 'serangan_lama', label: 'Serangan Lama', required: true, type: 'number' },
  { field: 'normal', label: 'Normal', required: false, type: 'number' },
  { field: 'stagnan', label: 'Stagnan', required: false, type: 'number' },
  { field: 'recovery', label: 'Recovery', required: false, type: 'number' },
  { field: 'mati', label: 'Mati', required: false, type: 'number' },
  { field: 'jumlah_sampel', label: 'Jumlah Sampel', required: true, type: 'number' },
];
const RAYAP_FIELDS: EwsValueField[] = [
  { field: 'ada_rayap', label: 'Ada rayap?', required: true, type: 'boolean' },
  { field: 'kondisi_alur_tanah', label: 'Kondisi alur tanah', required: false, type: 'text' },
];
const GANODERMA_FIELDS: EwsValueField[] = [
  {
    field: 'status_serangan',
    label: 'Status Serangan',
    required: true,
    type: 'enum',
    options: ['TIDAK_ADA', 'INDIKASI_AWAL', 'TERINFEKSI_RINGAN', 'TERINFEKSI_SEDANG', 'TERINFEKSI_BERAT'],
  },
];

function hptEntry(ews_id: string, hpt_code: string, layout: EwsLayout, valueFields: EwsValueField[]): EwsFormEntry {
  return { ews_id, scope: 'HPT', hpt_code, layout, valueFields, submit: { kind: 'SENSUS', hptCode: hpt_code } };
}

// ---------------------------------------------------------------------------------------------
// Yield Making / Agro (existing V2 tables) - SIMPLE_FIELDS, submits via the existing single-record
// REST endpoints (api/v2.ts, already wired in sync/engine.ts's uploadYieldGeneric).
// ---------------------------------------------------------------------------------------------
const PARTENOCARPI_FIELDS: EwsValueField[] = [
  { field: 'rainfall_mm', label: 'Curah Hujan (mm)', required: false, type: 'number' },
  { field: 'indikator_hujan_pagi', label: 'Curah Hujan Pagi-Siang (mm)', required: false, type: 'number' },
  { field: 'total_bunch', label: 'Total Tandan', required: true, type: 'number' },
  { field: 'abnormal_bunch', label: 'Tandan Abnormal', required: true, type: 'number' },
  { field: 'populasi_ek', label: 'Populasi Elaeidobius kamerunicus (ekor/ha)', required: false, type: 'number' },
];
const WM001_FIELDS: EwsValueField[] = [
  { field: 'titik_parit', label: 'Titik Parit', required: false, type: 'text' },
  { field: 'water_level_cm', label: 'Muka Air (cm di bawah permukaan tanah)', required: true, type: 'number' },
];
const WM002_FIELDS: EwsValueField[] = [
  { field: 'titik_parit', label: 'Titik Parit', required: false, type: 'text' },
  { field: 'flooding', label: 'Tergenang?', required: true, type: 'boolean' },
  { field: 'flooding_duration_hari', label: 'Lama Genangan (hari)', required: false, type: 'number' },
];
const BAHAN_ORGANIK_FIELDS: EwsValueField[] = [
  { field: 'area_type', label: 'Tipe Area', required: false, type: 'enum', options: ['PASIR', 'NON_PASIR'] },
  { field: 'total_sample', label: 'Total Sampel', required: true, type: 'number' },
  { field: 'yellowing_count', label: 'Jumlah Daun Menguning', required: false, type: 'number' },
  { field: 'vegetative_condition', label: 'Kondisi Vegetatif', required: false, type: 'text' },
  { field: 'baseline_tbm_normal', label: 'Baseline TBM Normal (acuan)', required: false, type: 'text' },
  { field: 'comparison_result', label: 'Hasil Perbandingan', required: false, type: 'text' },
];
const TBM_VEGETATIF_FIELDS: EwsValueField[] = [
  { field: 'umur_bulan', label: 'Umur (bulan)', required: false, type: 'number' },
  { field: 'panjang_pelepah_cm', label: 'Panjang Pelepah (cm)', required: false, type: 'number' },
  { field: 'jumlah_pelepah', label: 'Jumlah Pelepah', required: false, type: 'number' },
  { field: 'lai', label: 'LAI (Leaf Area Index)', required: false, type: 'number' },
  { field: 'target_produksi_ton_ha', label: 'Target Produksi (ton/ha)', required: false, type: 'number' },
  {
    field: 'hasil_evaluasi',
    label: 'Hasil Evaluasi',
    required: true,
    type: 'enum',
    options: ['SESUAI_STANDAR', 'DI_BAWAH_STANDAR'],
  },
];
const DEFISIENSI_HARA_FIELDS: EwsValueField[] = [
  { field: 'unsur_hara', label: 'Unsur Hara', required: true, type: 'text' },
  { field: 'temuan_lapangan', label: 'Temuan Lapangan', required: false, type: 'text' },
  { field: 'severity', label: 'Severity', required: true, type: 'enum', options: ['RINGAN', 'SEDANG', 'BERAT'] },
];

// ---------------------------------------------------------------------------------------------
// New V3 generic Agro Observation (AGR-005..014) - SIMPLE_FIELDS, submits to the new
// POST /api/agro-observation (routes/agroObservation.js).
// ---------------------------------------------------------------------------------------------
function agroEntry(ews_id: string, hpt_code: string, valueFields: EwsValueField[]): EwsFormEntry {
  return {
    ews_id,
    scope: 'Agro',
    hpt_code,
    layout: 'SIMPLE_FIELDS',
    valueFields,
    submit: { kind: 'AGRO_OBSERVATION', hptCode: hpt_code },
  };
}

export const EWS_FORM_SCHEMA: Record<string, EwsFormEntry> = {
  // ------------------------------------------------------------------------------------- HPT
  'HPT-001': hptEntry('HPT-001', 'TIKUS', 'ROW_SAMPLING', TIKUS_FIELDS),
  'HPT-002': hptEntry('HPT-002', 'TIKUS', 'ROW_SAMPLING', TIKUS_FIELDS),
  'HPT-003': hptEntry('HPT-003', 'TIKUS', 'ROW_SAMPLING', TIKUS_FIELDS),
  'HPT-004': hptEntry('HPT-004', 'UPDKS', 'ROW_SAMPLING', UPDKS_FIELDS),
  'HPT-005': hptEntry('HPT-005', 'UPDKS', 'ROW_SAMPLING', UPDKS_FIELDS),
  'HPT-006': hptEntry('HPT-006', 'UPDKS', 'ROW_SAMPLING', UPDKS_FIELDS),
  'HPT-007': hptEntry('HPT-007', 'ORYCTES', 'ROW_SAMPLING', ORYCTES_FIELDS),
  'HPT-008': hptEntry('HPT-008', 'ORYCTES', 'ROW_SAMPLING', ORYCTES_FIELDS),
  'HPT-009': hptEntry('HPT-009', 'ORYCTES', 'ROW_SAMPLING', ORYCTES_FIELDS),
  'HPT-010': hptEntry('HPT-010', 'RAYAP', 'GRID_SAMPLING', RAYAP_FIELDS),
  'HPT-011': hptEntry('HPT-011', 'RAYAP', 'GRID_SAMPLING', RAYAP_FIELDS),
  'HPT-012': hptEntry('HPT-012', 'RAYAP', 'GRID_SAMPLING', RAYAP_FIELDS),
  'HPT-013': hptEntry('HPT-013', 'GANODERMA', 'QUALITATIVE_POINTS', GANODERMA_FIELDS),
  'HPT-014': hptEntry('HPT-014', 'GANODERMA', 'QUALITATIVE_POINTS', GANODERMA_FIELDS),
  'HPT-015': hptEntry('HPT-015', 'GANODERMA', 'QUALITATIVE_POINTS', GANODERMA_FIELDS),

  // --------------------------------------------------------------------------- Yield Making
  'YM-001': {
    ews_id: 'YM-001',
    scope: 'Yield Making',
    hpt_code: 'PARTENOCARPI',
    layout: 'SIMPLE_FIELDS',
    valueFields: PARTENOCARPI_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'partenocarpi' },
  },

  // ----------------------------------------------------------- Agro (existing V2 tables)
  'AGR-001': {
    ews_id: 'AGR-001',
    scope: 'Agro',
    hpt_code: 'BAHAN_ORGANIK',
    layout: 'SIMPLE_FIELDS',
    valueFields: BAHAN_ORGANIK_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'bahan-organik' },
  },
  'AGR-002': {
    ews_id: 'AGR-002',
    scope: 'Agro',
    hpt_code: 'TBM_VEGETATIF',
    layout: 'SIMPLE_FIELDS',
    valueFields: TBM_VEGETATIF_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'tbm-vegetatif' },
  },
  'AGR-003': {
    ews_id: 'AGR-003',
    scope: 'Agro',
    hpt_code: 'TBM_VEGETATIF',
    layout: 'SIMPLE_FIELDS',
    valueFields: TBM_VEGETATIF_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'tbm-vegetatif' },
  },
  'AGR-004': {
    ews_id: 'AGR-004',
    scope: 'Agro',
    hpt_code: 'DEFISIENSI_HARA',
    layout: 'SIMPLE_FIELDS',
    valueFields: DEFISIENSI_HARA_FIELDS,
    submit: { kind: 'DEFISIENSI_HARA' },
  },

  // -------------------------------------------------- Agro (new V3 generic agro_observation)
  'AGR-005': agroEntry('AGR-005', 'ETIOLASI', SEVERITY_VALUE_FIELDS),
  'AGR-006': agroEntry('AGR-006', 'POKOK_DOYONG', [{ field: 'nilai_ukur', label: 'Derajat Kemiringan', required: true, type: 'number', unit: 'derajat' }]),
  'AGR-007': agroEntry('AGR-007', 'AREAL_TANPA_TERAS', [{ field: 'nilai_ukur', label: 'Kemiringan', required: true, type: 'number', unit: '%' }]),
  'AGR-008': agroEntry('AGR-008', 'OVERPRUNING', SEVERITY_VALUE_FIELDS),
  'AGR-009': agroEntry('AGR-009', 'SUSUNAN_PELEPAH', SEVERITY_VALUE_FIELDS),
  'AGR-010': agroEntry('AGR-010', 'GROUND_COVER', SEVERITY_VALUE_FIELDS),
  'AGR-011': agroEntry('AGR-011', 'POKOK_KERDIL', SEVERITY_VALUE_FIELDS),
  'AGR-012': agroEntry('AGR-012', 'ABNORMAL', SEVERITY_VALUE_FIELDS),
  'AGR-013': agroEntry('AGR-013', 'POKOK_SISIPAN', SEVERITY_VALUE_FIELDS),
  'AGR-014': agroEntry('AGR-014', 'POKOK_MATI', SEVERITY_VALUE_FIELDS),

  // ----------------------------------------------------------------------- Water Management
  'WM-001': {
    ews_id: 'WM-001',
    scope: 'WM',
    hpt_code: 'WATER_MANAGEMENT',
    layout: 'SIMPLE_FIELDS',
    valueFields: WM001_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'water-management' },
  },
  'WM-002': {
    ews_id: 'WM-002',
    scope: 'WM',
    hpt_code: 'WATER_MANAGEMENT',
    layout: 'SIMPLE_FIELDS',
    valueFields: WM002_FIELDS,
    submit: { kind: 'YIELD_MAKING', subpath: 'water-management' },
  },
};

export function getEwsFormEntry(ewsId: string): EwsFormEntry | null {
  return EWS_FORM_SCHEMA[ewsId] || null;
}

export function listEwsFormIds(scope?: EwsFormEntry['scope']): string[] {
  const ids = Object.keys(EWS_FORM_SCHEMA);
  return scope ? ids.filter((id) => EWS_FORM_SCHEMA[id].scope === scope) : ids;
}

// ---------------------------------------------------------------------------------------------
// ROW_SAMPLING aggregation: maps a filled-in row grid (this schema's field names, see
// TIKUS_FIELDS/UPDKS_FIELDS/ORYCTES_FIELDS above) to the exact input shape
// domain/sensusEngines.ts's computeByHptCode(hptCode, payload) expects for that hpt code -
// verified 1:1 against each original hand-built screen's aggregation logic before this file was
// written (Tikus: sums serangan_baru/serangan_lama/jumlah_sampel directly; UPDKS: derives
// ulat_hidup_total from kecil+sedang+besar per SensusUPDKSScreen, jumlah_pelepah_diamati summed;
// Oryctes: derives jumlah_pokok_terserang from serangan_baru+serangan_lama, jumlah_pokok_diamati
// from jumlah_sampel, per SensusOryctesScreen).
export function aggregateRowsForEngine(hptCode: string, rows: Record<string, string>[]): Record<string, number> {
  const sum = (key: string) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  switch (hptCode) {
    case 'TIKUS':
      return { serangan_baru: sum('serangan_baru'), serangan_lama: sum('serangan_lama'), jumlah_sampel: sum('jumlah_sampel') };
    case 'UPDKS':
      return {
        ulat_hidup_total: sum('ulat_kecil') + sum('ulat_sedang') + sum('ulat_besar'),
        jumlah_pelepah_diamati: sum('jumlah_pelepah_diamati'),
      };
    case 'ORYCTES':
      return {
        jumlah_pokok_terserang: sum('serangan_baru') + sum('serangan_lama'),
        jumlah_pokok_diamati: sum('jumlah_sampel'),
      };
    default:
      return {};
  }
}
