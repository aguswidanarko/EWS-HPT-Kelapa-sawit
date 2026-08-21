import { useEffect, useState } from 'react';
import * as masterRepo from '../db/repo/masterRepo';
import type { Afdeling, Blok, Estate, Hpt, Species, ThresholdRow } from '../types';

export function useEstates(): Estate[] {
  const [rows, setRows] = useState<Estate[]>([]);
  useEffect(() => {
    masterRepo.getEstates().then(setRows);
  }, []);
  return rows;
}

export function useAfdelings(estateId: number | null): Afdeling[] {
  const [rows, setRows] = useState<Afdeling[]>([]);
  useEffect(() => {
    if (!estateId) {
      setRows([]);
      return;
    }
    masterRepo.getAfdelings(estateId).then(setRows);
  }, [estateId]);
  return rows;
}

export function useBloks(afdelingId: number | null): Blok[] {
  const [rows, setRows] = useState<Blok[]>([]);
  useEffect(() => {
    if (!afdelingId) {
      setRows([]);
      return;
    }
    masterRepo.getBloks(afdelingId).then(setRows);
  }, [afdelingId]);
  return rows;
}

export function useBlok(blokId: number | null): Blok | null {
  const [row, setRow] = useState<Blok | null>(null);
  useEffect(() => {
    if (!blokId) {
      setRow(null);
      return;
    }
    masterRepo.getBlokById(blokId).then(setRow);
  }, [blokId]);
  return row;
}

export function useHptList(): Hpt[] {
  const [rows, setRows] = useState<Hpt[]>([]);
  useEffect(() => {
    masterRepo.getHptList().then(setRows);
  }, []);
  return rows;
}

export function useSpeciesByHpt(hptId: number | null): Species[] {
  const [rows, setRows] = useState<Species[]>([]);
  useEffect(() => {
    if (!hptId) {
      setRows([]);
      return;
    }
    masterRepo.getSpeciesByHpt(hptId).then(setRows);
  }, [hptId]);
  return rows;
}

export function useAllSpecies(): Species[] {
  const [rows, setRows] = useState<Species[]>([]);
  useEffect(() => {
    masterRepo.getAllSpecies().then(setRows);
  }, []);
  return rows;
}

export function useThresholds(): ThresholdRow[] {
  const [rows, setRows] = useState<ThresholdRow[]>([]);
  useEffect(() => {
    masterRepo.getThresholds().then(setRows);
  }, []);
  return rows;
}
