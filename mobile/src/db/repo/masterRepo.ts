import { getDb, withTransaction } from '../database';
import type { Afdeling, BisnisUnit, Blok, Estate, Hpt, Region, Species, ThresholdRow, ScheduleItem, CachedIncident, SamplingRuleRow } from '../../types';
import type { MasterDownload } from '../../api/sync';

// ---------------------------------------------------------------- master (region/bisnis_unit/estate/afdeling/blok/hpt/species)
export async function saveMasterData(data: MasterDownload): Promise<void> {
  await withTransaction(async (db) => {
    // V3.2: regions/bisnis_units are optional in older backends (pre-V3.2) -- default to []
    // rather than crashing offline-first devices that haven't upgraded their server yet.
    await db.runAsync('DELETE FROM regions');
    for (const r of data.regions || []) {
      await db.runAsync('INSERT INTO regions (id, code, name) VALUES (?, ?, ?)', [r.id, r.code, r.name]);
    }
    await db.runAsync('DELETE FROM bisnis_units');
    for (const bu of data.bisnis_units || []) {
      await db.runAsync('INSERT INTO bisnis_units (id, region_id, code, name) VALUES (?, ?, ?, ?)', [
        bu.id,
        bu.region_id,
        bu.code,
        bu.name,
      ]);
    }
    await db.runAsync('DELETE FROM estates');
    for (const e of data.estates) {
      await db.runAsync('INSERT INTO estates (id, code, name, map_file_ref, region_id, bisnis_unit_id) VALUES (?, ?, ?, ?, ?, ?)', [
        e.id,
        e.code,
        e.name,
        e.map_file_ref,
        e.region_id ?? null,
        e.bisnis_unit_id ?? null,
      ]);
    }
    await db.runAsync('DELETE FROM afdelings');
    for (const a of data.afdelings) {
      await db.runAsync('INSERT INTO afdelings (id, estate_id, code, name, map_file_ref) VALUES (?, ?, ?, ?, ?)', [
        a.id,
        a.estate_id,
        a.code,
        a.name,
        a.map_file_ref,
      ]);
    }
    await db.runAsync('DELETE FROM bloks');
    for (const b of data.bloks) {
      await db.runAsync(
        `INSERT INTO bloks (id, afdeling_id, code, name, luas, tahun_tanam, status_tanaman, referensi_polygon, jumlah_baris, parameter_sampling_json, jumlah_pokok)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          b.id,
          b.afdeling_id,
          b.code,
          b.name,
          b.luas,
          b.tahun_tanam,
          b.status_tanaman,
          b.referensi_polygon,
          b.jumlah_baris,
          b.parameter_sampling_json,
          b.jumlah_pokok ?? null,
        ]
      );
    }
    await db.runAsync('DELETE FROM hpt');
    for (const h of data.hpt) {
      await db.runAsync(
        `INSERT INTO hpt (id, code, name, nama_lokal, kategori, status_aktif, deskripsi, gejala, metode_deteksi, metode_sensus, satuan, threshold_default, panduan_md)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          h.id,
          h.code,
          h.name,
          h.nama_lokal,
          h.kategori,
          h.status_aktif,
          h.deskripsi,
          h.gejala,
          h.metode_deteksi,
          h.metode_sensus,
          h.satuan,
          h.threshold_default,
          h.panduan_md,
        ]
      );
    }
    await db.runAsync('DELETE FROM species');
    for (const s of data.species) {
      await db.runAsync('INSERT INTO species (id, hpt_id, code, name, group_name) VALUES (?, ?, ?, ?, ?)', [
        s.id,
        s.hpt_id,
        s.code,
        s.name,
        s.group_name,
      ]);
    }
  });
}

export async function getRegions(): Promise<Region[]> {
  const db = await getDb();
  return db.getAllAsync<Region>('SELECT * FROM regions ORDER BY name');
}

export async function getBisnisUnits(regionId?: number): Promise<BisnisUnit[]> {
  const db = await getDb();
  if (regionId) return db.getAllAsync<BisnisUnit>('SELECT * FROM bisnis_units WHERE region_id = ? ORDER BY name', [regionId]);
  return db.getAllAsync<BisnisUnit>('SELECT * FROM bisnis_units ORDER BY name');
}

export async function getEstates(bisnisUnitId?: number): Promise<Estate[]> {
  const db = await getDb();
  if (bisnisUnitId) return db.getAllAsync<Estate>('SELECT * FROM estates WHERE bisnis_unit_id = ? ORDER BY name', [bisnisUnitId]);
  return db.getAllAsync<Estate>('SELECT * FROM estates ORDER BY name');
}

export async function getAfdelings(estateId?: number): Promise<Afdeling[]> {
  const db = await getDb();
  if (estateId) return db.getAllAsync<Afdeling>('SELECT * FROM afdelings WHERE estate_id = ? ORDER BY name', [estateId]);
  return db.getAllAsync<Afdeling>('SELECT * FROM afdelings ORDER BY name');
}

export async function getBloks(afdelingId?: number): Promise<Blok[]> {
  const db = await getDb();
  if (afdelingId) return db.getAllAsync<Blok>('SELECT * FROM bloks WHERE afdeling_id = ? ORDER BY code', [afdelingId]);
  return db.getAllAsync<Blok>('SELECT * FROM bloks ORDER BY code');
}

export async function getBlokById(id: number): Promise<Blok | null> {
  const db = await getDb();
  return (await db.getFirstAsync<Blok>('SELECT * FROM bloks WHERE id = ?', [id])) ?? null;
}

export async function getHptList(): Promise<Hpt[]> {
  const db = await getDb();
  return db.getAllAsync<Hpt>('SELECT * FROM hpt WHERE status_aktif = 1 ORDER BY name');
}

export async function getHptById(id: number): Promise<Hpt | null> {
  const db = await getDb();
  return (await db.getFirstAsync<Hpt>('SELECT * FROM hpt WHERE id = ?', [id])) ?? null;
}

export async function getSpeciesByHpt(hptId: number): Promise<Species[]> {
  const db = await getDb();
  return db.getAllAsync<Species>('SELECT * FROM species WHERE hpt_id = ? ORDER BY name', [hptId]);
}

export async function getAllSpecies(): Promise<Species[]> {
  const db = await getDb();
  return db.getAllAsync<Species>('SELECT * FROM species');
}

export async function masterDataCounts(): Promise<{ estates: number; afdelings: number; bloks: number; hpt: number }> {
  const db = await getDb();
  const [e, a, b, h] = await Promise.all([
    db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM estates'),
    db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM afdelings'),
    db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM bloks'),
    db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM hpt'),
  ]);
  return { estates: e?.c ?? 0, afdelings: a?.c ?? 0, bloks: b?.c ?? 0, hpt: h?.c ?? 0 };
}

// ---------------------------------------------------------------- thresholds
export async function saveThresholds(rows: ThresholdRow[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM thresholds');
    for (const t of rows) {
      await db.runAsync(
        `INSERT INTO thresholds (id, hpt_id, species_id, fase_tanaman, kategori, nilai_min, nilai_max, satuan, tindakan, severity, effective_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id,
          t.hpt_id,
          t.species_id,
          t.fase_tanaman,
          t.kategori,
          t.nilai_min,
          t.nilai_max,
          t.satuan,
          t.tindakan,
          t.severity,
          t.effective_date,
          t.status,
        ]
      );
    }
  });
}

export async function getThresholds(): Promise<ThresholdRow[]> {
  const db = await getDb();
  return db.getAllAsync<ThresholdRow>('SELECT * FROM thresholds');
}

// ---------------------------------------------------------------- schedule
export async function saveSchedules(rows: ScheduleItem[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM schedules');
    for (const s of rows) {
      await db.runAsync(
        `INSERT INTO schedules (id, user_id, estate_id, afdeling_id, blok_id, jenis_kegiatan, hpt_id, tanggal_rencana, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [s.id, s.user_id, s.estate_id, s.afdeling_id, s.blok_id, s.jenis_kegiatan, s.hpt_id, s.tanggal_rencana, s.status]
      );
    }
  });
}

export async function getSchedules(): Promise<ScheduleItem[]> {
  const db = await getDb();
  return db.getAllAsync<ScheduleItem>('SELECT * FROM schedules ORDER BY tanggal_rencana');
}

export async function countTodayTasks(todayIso: string): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ c: number }>(
    "SELECT COUNT(*) as c FROM schedules WHERE tanggal_rencana = ? AND status != 'SELESAI'",
    [todayIso]
  );
  return row?.c ?? 0;
}

// ---------------------------------------------------------------- cached incidents (for offline linking)
export async function saveCachedIncidents(rows: CachedIncident[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM cached_incidents');
    for (const i of rows) {
      await db.runAsync(
        `INSERT INTO cached_incidents (id, incident_code, hpt_id, hpt_name, estate_id, afdeling_id, blok_id, blok_code, status, severity, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          i.id,
          i.incident_code,
          i.hpt_id,
          i.hpt_name,
          i.estate_id,
          i.afdeling_id,
          i.blok_id,
          i.blok_code,
          i.status,
          i.severity,
          i.opened_at,
        ]
      );
    }
  });
}

// ---------------------------------------------------------------- sampling_rule (SPEC_V2.md
// section 4 Mobile "Sampling Assistant: generalize supaya baca sampling_rule")
export async function saveSamplingRules(rows: SamplingRuleRow[]): Promise<void> {
  await withTransaction(async (db) => {
    await db.runAsync('DELETE FROM sampling_rules');
    for (const r of rows) {
      await db.runAsync(
        `INSERT INTO sampling_rules (id, hpt_id, method, row_start, row_interval, plant_start, plant_interval, minimum_sample, unit_scope, description, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [r.id, r.hpt_id, r.method, r.row_start, r.row_interval, r.plant_start, r.plant_interval, r.minimum_sample, r.unit_scope, r.description, r.active]
      );
    }
  });
}
export async function getSamplingRuleByHptId(hptId: number): Promise<SamplingRuleRow | null> {
  const db = await getDb();
  return (
    (await db.getFirstAsync<SamplingRuleRow>('SELECT * FROM sampling_rules WHERE hpt_id = ? AND active = 1 ORDER BY id DESC', [hptId])) ?? null
  );
}

export async function getCachedIncidents(blokId?: number): Promise<CachedIncident[]> {
  const db = await getDb();
  if (blokId) {
    return db.getAllAsync<CachedIncident>('SELECT * FROM cached_incidents WHERE blok_id = ? ORDER BY opened_at DESC', [blokId]);
  }
  return db.getAllAsync<CachedIncident>('SELECT * FROM cached_incidents ORDER BY opened_at DESC');
}
