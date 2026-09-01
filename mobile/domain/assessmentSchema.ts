// V3.1 Universal Assessment Form - static option lists / labels for AssessmentScreen.tsx.
// Mirrors backend/src/db/seedAssessmentMappingV31.js's ASM_ROWS (Assessment_Parameter values),
// kept as plain constants (not fetched) since the form's STRUCTURE is fixed by the BRD - only
// EWS Dictionary display text (threshold/rekomendasi) is server-driven, same "offline-first,
// bundled with the app" convention as domain/ewsFormSchema.ts.

import type {
  KondisiPokokTag,
  PruningStatus,
  GulmaTag,
  DefisiensiUnsur,
  DefisiensiSeverity,
  HamaJenis,
} from '../types';

export const KONDISI_POKOK_OPTIONS: { tag: KondisiPokokTag; label: string }[] = [
  { tag: 'KERDIL', label: 'Kerdil' },
  { tag: 'ETIOLASI', label: 'Etiolasi' },
  { tag: 'SISIPAN', label: 'Sisipan' },
  { tag: 'KASTRASI', label: 'Kastrasi' },
  { tag: 'SANITASI', label: 'Sanitasi' },
  { tag: 'TUMBANG', label: 'Tumbang' },
  { tag: 'KOSONG_MATI', label: 'Kosong / Mati' },
  { tag: 'ABNORMAL', label: 'Abnormal' },
];

export const PRUNING_OPTIONS: { value: PruningStatus; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'UNDER', label: 'Under pruning' },
  { value: 'OVER', label: 'Over pruning' },
];

export const GULMA_OPTIONS: { tag: GulmaTag; label: string }[] = [
  { tag: 'VOPS', label: 'VOPS' },
  { tag: 'BROAD_LEAF', label: 'Broad Leaf' },
  { tag: 'FERN', label: 'Fern (Pakis)' },
  { tag: 'WOODIES', label: 'Woodies' },
  { tag: 'GRASSES', label: 'Grasses (Rumput)' },
];

export const DEFISIENSI_UNSUR_OPTIONS: { value: DefisiensiUnsur; label: string }[] = [
  { value: 'N', label: 'N (Nitrogen)' },
  { value: 'P', label: 'P (Fosfor)' },
  { value: 'K', label: 'K (Kalium)' },
  { value: 'MG', label: 'Mg (Magnesium)' },
  { value: 'B', label: 'B (Boron)' },
  { value: 'CU', label: 'Cu (Tembaga)' },
  { value: 'ZN', label: 'Zn (Seng)' },
  { value: 'FE', label: 'Fe (Besi)' },
  { value: 'NK', label: 'N/K' },
];

export const DEFISIENSI_SEVERITY_OPTIONS: { value: DefisiensiSeverity; label: string }[] = [
  { value: 'RINGAN', label: 'Ringan' },
  { value: 'SEDANG', label: 'Sedang' },
  { value: 'BERAT', label: 'Berat' },
];

export const HAMA_OPTIONS: { jenis: HamaJenis; label: string }[] = [
  { jenis: 'ULAT', label: 'Ulat' },
  { jenis: 'TIKUS', label: 'Tikus' },
  { jenis: 'RAYAP', label: 'Rayap' },
  { jenis: 'KUMBANG', label: 'Kumbang (Oryctes)' },
  { jenis: 'TIRATHABA', label: 'Tirathaba' },
  { jenis: 'UPPER_STEM_ROOT', label: 'Upper Stem Root' },
  { jenis: 'BASAL_STEM_ROOT', label: 'Basal Stem Root (Ganoderma)' },
  { jenis: 'LAINNYA', label: 'Lainnya' },
];

export const EROSI_OPTIONS = [
  { value: 'TIDAK_ADA', label: 'Tidak ada' },
  { value: 'RINGAN', label: 'Ringan' },
  { value: 'SEDANG', label: 'Sedang' },
  { value: 'BERAT', label: 'Berat' },
] as const;

export const KONDISI_PARIT_OPTIONS = [
  { value: 'BAIK', label: 'Baik' },
  { value: 'RUSAK', label: 'Rusak' },
  { value: 'TERSUMBAT', label: 'Tersumbat' },
  { value: 'LAINNYA', label: 'Lainnya' },
] as const;

export const KBH_STATUS_OPTIONS = [
  { value: 'BAIK', label: 'Ada / Baik' },
  { value: 'TIDAK_ADA', label: 'Tidak Ada' },
  { value: 'TIDAK_BAIK', label: 'Ada, Tidak Baik' },
] as const;

export const BY_PRODUCT_OPTIONS = [
  { value: 'DDS', label: 'DDS' },
  { value: 'BA', label: 'BA' },
  { value: 'FIBER', label: 'Fiber' },
] as const;

/** Sensible default minimum sample size (BRD_Mobile_V3_1.docx section 15 "minimal 35 pokok
 * sesuai format sumber, tetapi jumlah sampling harus configurable"). Editable per visit. */
export const DEFAULT_SAMPLE_COUNT = 35;
