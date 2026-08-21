// Client-side mirror of backend/src/services/thresholdEngine.js's classification steps
// (AMBIL THRESHOLD -> KLASIFIKASI). Deliberately does NOT create Incident/Alert/Notification rows
// - those are server-authoritative (SPEC.md "server = source of truth"). This exists purely to
// give the field officer an immediate ALERT HPT signal offline; the server re-runs the real
// engine (and is authoritative) the moment the record syncs.

import type { Blok, Species, ThresholdRow } from '../types';

export const SEVERITY_ORDER = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];

export function severityRank(k: string | null | undefined): number {
  if (!k) return -1;
  const i = SEVERITY_ORDER.indexOf(k);
  return i;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Mirrors the SQL in getActiveThresholds(): same hpt, active, effective <= today, fase matches
 * (or 'SEMUA'), and species matches exactly OR shares the same group_name OR threshold row has no
 * species restriction. Then keeps only the latest-effective row per kategori. */
export function getActiveThresholds(params: {
  thresholds: ThresholdRow[];
  species: Species[];
  hpt_id: number;
  species_id: number | null;
  faseTanaman: string;
  asOfDate?: string;
}): ThresholdRow[] {
  const { thresholds, species, hpt_id, species_id, faseTanaman } = params;
  const asOfDate = params.asOfDate || todayISO();
  const selfSpecies = species_id ? species.find((s) => s.id === species_id) : undefined;
  const groupMates = new Set(
    selfSpecies?.group_name ? species.filter((s) => s.group_name === selfSpecies.group_name).map((s) => s.id) : []
  );

  const rows = thresholds
    .filter((t) => t.hpt_id === hpt_id)
    .filter((t) => t.status === 'AKTIF')
    .filter((t) => t.effective_date <= asOfDate)
    .filter((t) => t.fase_tanaman === faseTanaman || t.fase_tanaman === 'SEMUA')
    .filter((t) => t.species_id === null || t.species_id === species_id || groupMates.has(t.species_id))
    .sort((a, b) => {
      // fase exact match first, then latest effective_date
      const faseA = a.fase_tanaman === faseTanaman ? 1 : 0;
      const faseB = b.fase_tanaman === faseTanaman ? 1 : 0;
      if (faseA !== faseB) return faseB - faseA;
      return b.effective_date.localeCompare(a.effective_date);
    });

  const latestByKategori = new Map<string, ThresholdRow>();
  for (const r of rows) {
    if (!latestByKategori.has(r.kategori)) latestByKategori.set(r.kategori, r);
  }
  return Array.from(latestByKategori.values());
}

/** Mirrors classify(): finds which [nilai_min, nilai_max] bucket `value` falls into, ties broken
 * by highest severity. */
export function classify(thresholdRows: ThresholdRow[], value: number): ThresholdRow | null {
  const matches = thresholdRows.filter((r) => {
    const min = r.nilai_min === null || r.nilai_min === undefined ? -Infinity : r.nilai_min;
    const max = r.nilai_max === null || r.nilai_max === undefined ? Infinity : r.nilai_max;
    return value >= min && value <= max;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => severityRank(b.kategori) - severityRank(a.kategori));
  return matches[0];
}

export interface LocalEngineResult {
  kategori: string;
  ews_alert: boolean;
  thresholdRow: ThresholdRow | null;
  faseTanaman: string;
}

/** Full client-side classification pass (VALIDASI -> IDENTIFIKASI FASE TANAMAN -> AMBIL THRESHOLD
 * -> KLASIFIKASI), matching runThresholdEngine()'s classification logic exactly - minus the
 * incident/alert/notification side effects, which only the server performs. */
export function runLocalThresholdEngine(params: {
  thresholds: ThresholdRow[];
  species: Species[];
  blok: Blok;
  hpt_id: number;
  species_id: number | null;
  nilai_hasil: number;
  forced_kandidat_pengendalian?: boolean;
}): LocalEngineResult {
  const faseTanaman = params.blok.status_tanaman || 'SEMUA';
  const thresholds = getActiveThresholds({
    thresholds: params.thresholds,
    species: params.species,
    hpt_id: params.hpt_id,
    species_id: params.species_id,
    faseTanaman,
  });

  let matched = classify(thresholds, params.nilai_hasil);
  if (!matched && params.forced_kandidat_pengendalian) {
    matched =
      thresholds
        .filter((t) => t.kategori !== 'NORMAL')
        .sort((a, b) => severityRank(a.kategori) - severityRank(b.kategori))[0] || null;
  }
  const kategori = matched ? matched.kategori : 'NORMAL';
  return { kategori, ews_alert: kategori !== 'NORMAL', thresholdRow: matched, faseTanaman };
}
