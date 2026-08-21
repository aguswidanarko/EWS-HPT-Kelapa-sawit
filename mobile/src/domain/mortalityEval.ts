// 1:1 port of backend/src/services/ingestion.js's evaluateEffectiveness() so the mobile app can
// show the "perlu service" hint immediately, offline (SPEC.md section 6 Sensus Mortalitas: "jika
// ulat hidup masih >2 ekor/pelepah -> treatment perlu service"). The server re-evaluates
// authoritatively on sync using the exact same rule.

import type { ThresholdRow } from '../types';

export interface EffectivenessResult {
  hasil_efektivitas: 'EFEKTIF' | 'TIDAK_EFEKTIF' | 'TIDAK_DIKETAHUI';
  service_required: boolean;
  rate: number | null;
}

export function evaluateEffectivenessLocal(params: {
  thresholds: ThresholdRow[];
  hpt_id: number | null;
  jumlah_hidup: number | null;
  sampel: number | null;
}): EffectivenessResult {
  const { thresholds, hpt_id, jumlah_hidup, sampel } = params;
  if (!sampel || sampel <= 0) return { hasil_efektivitas: 'TIDAK_DIKETAHUI', service_required: false, rate: null };
  const rate = Number(jumlah_hidup ?? 0) / Number(sampel);

  if (hpt_id) {
    const candidates = thresholds
      .filter((t) => t.hpt_id === hpt_id && t.kategori === 'TIDAK_EFEKTIF' && t.status === 'AKTIF')
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date));
    const thr = candidates[0];
    if (thr && thr.nilai_min !== null && thr.nilai_min !== undefined) {
      const service_required = rate >= thr.nilai_min;
      return { hasil_efektivitas: service_required ? 'TIDAK_EFEKTIF' : 'EFEKTIF', service_required, rate };
    }
  }
  // Documented BRD default fallback: masih >2 ekor hidup / sampel -> perlu service.
  const service_required = rate > 2;
  return { hasil_efektivitas: service_required ? 'TIDAK_EFEKTIF' : 'EFEKTIF', service_required, rate };
}
