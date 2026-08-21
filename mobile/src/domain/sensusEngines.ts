// Sensus formulas + baris-sampel/grid generators (SPEC.md section 5 + section 9 decision #4).
// Deliberate 1:1 port of backend/src/services/sensusEngines.js so mobile-side "instant feedback"
// classification matches what the server will compute on sync. Nothing here hard-codes sampling
// numbers - every generator reads start/step/total from Blok.parameter_sampling_json.

import type { Blok, MetodeSensus, SamplingParams } from '../types';
import { safeParseJson } from '../utils/format';

const DEFAULT_PARAMS: Required<Pick<SamplingParams, 'baris_sampel' | 'grid'>> = {
  baris_sampel: { start: 3, step: 10 },
  grid: { baris_start: 3, baris_step: 20, posisi_start: 3, posisi_step: 10 },
};

export function parseSamplingParams(blok: Blok | null | undefined): SamplingParams {
  if (!blok?.parameter_sampling_json) return DEFAULT_PARAMS;
  const parsed = safeParseJson<Partial<SamplingParams>>(blok.parameter_sampling_json, {});
  return {
    baris_sampel: { ...DEFAULT_PARAMS.baris_sampel, ...(parsed.baris_sampel || {}) },
    grid: { ...DEFAULT_PARAMS.grid, ...(parsed.grid || {}) },
    posisi_per_baris: parsed.posisi_per_baris ?? null,
  };
}

/** Baris sampel generator: start, start+step, start+2*step, ... <= totalBaris. e.g. 3,13,23,33,... */
export function generateBarisSampel(start: number, step: number, totalBaris: number | null | undefined): number[] {
  const out: number[] = [];
  if (!totalBaris || totalBaris <= 0 || !step || step <= 0) return out;
  for (let b = start; b <= totalBaris; b += step) out.push(b);
  return out;
}

export interface GridPoint {
  baris: number;
  posisi: number;
}

/** Whole-block sampling grid (e.g. Rayap): baris 3,23,43,63.. x posisi 3,13,23,33.. */
export function generateGrid(
  barisStart: number,
  barisStep: number,
  posisiStart: number,
  posisiStep: number,
  totalBaris: number | null | undefined,
  posisiPerBaris: number | null | undefined
): GridPoint[] {
  const barisList = generateBarisSampel(barisStart, barisStep, totalBaris);
  const posisiList = generateBarisSampel(posisiStart, posisiStep, posisiPerBaris || totalBaris);
  const grid: GridPoint[] = [];
  for (const baris of barisList) {
    for (const posisi of posisiList) grid.push({ baris, posisi });
  }
  return grid;
}

export interface SamplingPlan {
  metode: MetodeSensus | string;
  baris?: number[];
  points?: GridPoint[] | null;
  note?: string;
}

/** Build the sampling plan for a given blok + HPT metode_sensus - used to render the per-baris /
 * per-point input rows before the officer starts entering counts. */
export function buildSamplingPlan(blok: Blok | null | undefined, metodeSensus: string): SamplingPlan {
  const p = parseSamplingParams(blok);
  const totalBaris = blok ? blok.jumlah_baris : null;
  if (metodeSensus === 'GRID') {
    const grid = p.grid!;
    return {
      metode: 'GRID',
      points: generateGrid(grid.baris_start, grid.baris_step, grid.posisi_start, grid.posisi_step, totalBaris, p.posisi_per_baris),
    };
  }
  if (metodeSensus === 'SELURUH_POKOK') {
    return { metode: 'SELURUH_POKOK', points: null, note: 'Setiap pokok pada blok diperiksa (tidak disampling).' };
  }
  const bs = p.baris_sampel!;
  return { metode: 'BARIS_SAMPEL', baris: generateBarisSampel(bs.start, bs.step, totalBaris) };
}

// ---------------------------------------------------------------------------
// Formulas per HPT (SPEC.md section 5). Each returns { hasil_hitung, satuan, ...} - the raw
// numeric/qualitative value the threshold engine classifies against THRESHOLD rows.
// ---------------------------------------------------------------------------

export function computeUPDKS(input: { ulat_hidup_total: number; jumlah_pelepah_diamati: number }) {
  const total = Number(input.ulat_hidup_total) || 0;
  const pelepah = Number(input.jumlah_pelepah_diamati) || 0;
  if (pelepah <= 0) throw new Error('jumlah_pelepah_diamati harus > 0');
  return { hasil_hitung: total / pelepah, satuan: 'ekor/pelepah' };
}

export function computeTikus(input: { serangan_baru: number; serangan_lama: number; jumlah_sampel: number }) {
  const baru = Number(input.serangan_baru) || 0;
  const lama = Number(input.serangan_lama) || 0;
  const sampel = Number(input.jumlah_sampel) || 0;
  if (sampel <= 0) throw new Error('jumlah_sampel harus > 0');
  return { hasil_hitung: ((baru + lama) / sampel) * 100, satuan: '%' };
}

export function computeOryctes(input: { jumlah_pokok_terserang: number; jumlah_pokok_diamati: number }) {
  const terserang = Number(input.jumlah_pokok_terserang) || 0;
  const diamati = Number(input.jumlah_pokok_diamati) || 0;
  if (diamati <= 0) throw new Error('jumlah_pokok_diamati harus > 0');
  return { hasil_hitung: (terserang / diamati) * 100, satuan: '%' };
}

export function computeRayap(input: { jumlah_pokok_terserang: number; jumlah_pokok_diamati: number }) {
  const terserang = Number(input.jumlah_pokok_terserang) || 0;
  const diamati = Number(input.jumlah_pokok_diamati) || 0;
  const pct = diamati > 0 ? (terserang / diamati) * 100 : terserang > 0 ? 100 : 0;
  return { hasil_hitung: pct, satuan: '%', forced_kandidat_pengendalian: terserang > 0 };
}

export const GANODERMA_SCALE: Record<string, number> = {
  TIDAK_ADA: 0,
  INDIKASI_AWAL: 1,
  TERINFEKSI_RINGAN: 2,
  TERINFEKSI_SEDANG: 3,
  TERINFEKSI_BERAT: 4,
};
export const GANODERMA_STATUS_OPTIONS = Object.keys(GANODERMA_SCALE);

export function computeGanoderma(input: { status_serangan?: string; indikasi?: string }) {
  const key = (input.status_serangan || input.indikasi || 'TIDAK_ADA').toUpperCase();
  const code = key in GANODERMA_SCALE ? GANODERMA_SCALE[key] : 0;
  return { hasil_hitung: code, satuan: 'skala', status_serangan: key };
}

export function computeByHptCode(hptCode: string, payload: Record<string, unknown>) {
  switch (hptCode) {
    case 'UPDKS':
      return computeUPDKS(payload as { ulat_hidup_total: number; jumlah_pelepah_diamati: number });
    case 'TIKUS':
      return computeTikus(payload as { serangan_baru: number; serangan_lama: number; jumlah_sampel: number });
    case 'ORYCTES':
      return computeOryctes(payload as { jumlah_pokok_terserang: number; jumlah_pokok_diamati: number });
    case 'RAYAP':
      return computeRayap(payload as { jumlah_pokok_terserang: number; jumlah_pokok_diamati: number });
    case 'GANODERMA':
      return computeGanoderma(payload as { status_serangan?: string; indikasi?: string });
    default:
      throw new Error(`Tidak ada sensus engine untuk HPT code=${hptCode}`);
  }
}
