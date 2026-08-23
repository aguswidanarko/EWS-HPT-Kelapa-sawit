// Sensus formulas + baris-sampel/grid generators (SPEC.md section 5 + section 9 decision #4).
// Nothing in here hard-codes sampling numbers: every generator takes its start/step/total from
// BLOK.parameter_sampling_json so admins can retune sampling density per blok without a code change.

const DEFAULT_PARAMS = {
  baris_sampel: { start: 3, step: 10 },
  grid: { baris_start: 3, baris_step: 20, posisi_start: 3, posisi_step: 10 },
};

function parseParams(blok) {
  if (!blok) return DEFAULT_PARAMS;
  try {
    const parsed = blok.parameter_sampling_json ? JSON.parse(blok.parameter_sampling_json) : {};
    return {
      baris_sampel: { ...DEFAULT_PARAMS.baris_sampel, ...(parsed.baris_sampel || {}) },
      grid: { ...DEFAULT_PARAMS.grid, ...(parsed.grid || {}) },
      posisi_per_baris: parsed.posisi_per_baris || null,
    };
  } catch (e) {
    return DEFAULT_PARAMS;
  }
}

/**
 * Baris sampel generator: start, start+step, start+2*step, ... <= totalBaris
 * e.g. start=3, step=10 -> 3,13,23,33,...
 */
function generateBarisSampel(start, step, totalBaris) {
  const out = [];
  if (!totalBaris || totalBaris <= 0) return out;
  for (let b = start; b <= totalBaris; b += step) out.push(b);
  return out;
}

/**
 * Grid generator for whole-block engines that still sample a grid of trees rather than
 * literally every tree (used as the default "seluruh pokok" sampling grid, e.g. Rayap):
 * baris 3,23,43,63.. x posisi 3,13,23,33..
 */
function generateGrid(barisStart, barisStep, posisiStart, posisiStep, totalBaris, posisiPerBaris) {
  const barisList = generateBarisSampel(barisStart, barisStep, totalBaris);
  const posisiList = generateBarisSampel(posisiStart, posisiStep, posisiPerBaris || totalBaris);
  const grid = [];
  for (const baris of barisList) {
    for (const posisi of posisiList) grid.push({ baris, posisi });
  }
  return grid;
}

/** Build the sampling plan for a given blok + HPT metode_sensus. Used by GET /sensus/plan. */
function buildSamplingPlan(blok, metodeSensus) {
  const p = parseParams(blok);
  const totalBaris = blok ? blok.jumlah_baris : null;
  if (metodeSensus === 'GRID') {
    return {
      metode: 'GRID',
      params: p.grid,
      points: generateGrid(
        p.grid.baris_start,
        p.grid.baris_step,
        p.grid.posisi_start,
        p.grid.posisi_step,
        totalBaris,
        p.posisi_per_baris
      ),
    };
  }
  if (metodeSensus === 'SELURUH_POKOK') {
    return { metode: 'SELURUH_POKOK', params: {}, points: null, note: 'Setiap pokok pada blok diperiksa (tidak disampling).' };
  }
  // default: BARIS_SAMPEL
  return {
    metode: 'BARIS_SAMPEL',
    params: p.baris_sampel,
    baris: generateBarisSampel(p.baris_sampel.start, p.baris_sampel.step, totalBaris),
  };
}

// ---------------------------------------------------------------------------
// Formulas per HPT (SPEC.md section 5). Each returns { hasil_hitung, kategori_input }
// where kategori_input is the raw numeric/qualitative value the threshold engine will
// classify against THRESHOLD rows (never a hard-coded category here).
// ---------------------------------------------------------------------------

/** UPDKS: ulat_hidup_total / jumlah_pelepah_diamati -> ekor/pelepah */
function computeUPDKS({ ulat_hidup_total, jumlah_pelepah_diamati }) {
  const total = Number(ulat_hidup_total) || 0;
  const pelepah = Number(jumlah_pelepah_diamati) || 0;
  if (pelepah <= 0) throw new Error('jumlah_pelepah_diamati harus > 0');
  return { hasil_hitung: total / pelepah, satuan: 'ekor/pelepah' };
}

/** Tikus: (serangan_baru + serangan_lama) / jumlah_sampel * 100% */
function computeTikus({ serangan_baru, serangan_lama, jumlah_sampel }) {
  const baru = Number(serangan_baru) || 0;
  const lama = Number(serangan_lama) || 0;
  const sampel = Number(jumlah_sampel) || 0;
  if (sampel <= 0) throw new Error('jumlah_sampel harus > 0');
  return { hasil_hitung: ((baru + lama) / sampel) * 100, satuan: '%' };
}

/** Oryctes: jumlah_pokok_terserang / jumlah_pokok_diamati * 100% */
function computeOryctes({ jumlah_pokok_terserang, jumlah_pokok_diamati }) {
  const terserang = Number(jumlah_pokok_terserang) || 0;
  const diamati = Number(jumlah_pokok_diamati) || 0;
  if (diamati <= 0) throw new Error('jumlah_pokok_diamati harus > 0');
  return { hasil_hitung: (terserang / diamati) * 100, satuan: '%' };
}

/**
 * Rayap: ambang ekonomi = 0% -> setiap pokok terserang otomatis kandidat pengendalian.
 * hasil_hitung dilaporkan sebagai % serangan (konsisten dgn engine lain) tapi klasifikasinya
 * hanya bergantung pada apakah jumlah_pokok_terserang > 0 (ambang ekonomi 0%).
 */
function computeRayap({ jumlah_pokok_terserang, jumlah_pokok_diamati }) {
  const terserang = Number(jumlah_pokok_terserang) || 0;
  const diamati = Number(jumlah_pokok_diamati) || 0;
  const pct = diamati > 0 ? (terserang / diamati) * 100 : terserang > 0 ? 100 : 0;
  return {
    hasil_hitung: pct,
    satuan: '%',
    forced_kandidat_pengendalian: terserang > 0, // ambang ekonomi 0% - flagged regardless of threshold table
  };
}

/**
 * Ganoderma: kualitatif, tidak ada rumus numerik. status_serangan datang dari petugas
 * (mis. TIDAK_ADA / INDIKASI_AWAL / TERINFEKSI_RINGAN / TERINFEKSI_SEDANG / TERINFEKSI_BERAT).
 * hasil_hitung dikodekan ke skala ordinal (0-4) hanya supaya bisa disimpan & dibandingkan pada
 * kolom numerik/threshold yang sama seperti engine lain; kategori sesungguhnya tetap berasal
 * dari tabel THRESHOLD (kategori = status_serangan, nilai_min=nilai_max=kode ordinal).
 */
const GANODERMA_SCALE = {
  TIDAK_ADA: 0,
  INDIKASI_AWAL: 1,
  TERINFEKSI_RINGAN: 2,
  TERINFEKSI_SEDANG: 3,
  TERINFEKSI_BERAT: 4,
};
function computeGanoderma({ status_serangan, indikasi }) {
  const key = (status_serangan || indikasi || 'TIDAK_ADA').toUpperCase();
  const code = GANODERMA_SCALE.hasOwnProperty(key) ? GANODERMA_SCALE[key] : 0;
  return { hasil_hitung: code, satuan: 'skala', status_serangan: key };
}

const ENGINES = {
  UPDKS: computeUPDKS,
  TIKUS: computeTikus,
  ORYCTES: computeOryctes,
  RAYAP: computeRayap,
  GANODERMA: computeGanoderma,
};

// ---------------------------------------------------------------------------------------------
// SPEC_V2.md section 3: "V2 WAJIB refactor jadi generic" -- computeByHptCode now prefers the
// data-driven `formula` table (via services/ruleEngine.js) over the hard-coded functions above.
// Regression safety: db/seed.js seeds `formula` rows for these 5 HPT whose expression_json is
// mathematically identical to the JS functions above (verified by re-running the PISP1 import
// regression before/after this refactor -- see backend README / task report for the exact
// before/after counts). If no `formula` row exists yet for a given HPT (e.g. schema loaded but
// seed not run), this transparently falls back to the legacy hard-coded function so nothing ever
// breaks -- the fallback is a safety net, not the primary path once seeded.
// ---------------------------------------------------------------------------------------------
function computeByHptCode(hptCode, payload) {
  const legacyFn = ENGINES[hptCode];
  try {
    // eslint-disable-next-line global-require
    const { getActiveFormula, evaluateFormula } = require('./ruleEngine');
    // eslint-disable-next-line global-require
    const db = require('../db/db');
    const hpt = db.prepare('SELECT * FROM hpt WHERE code=?').get(hptCode);
    if (hpt) {
      const formulaRow = getActiveFormula(hpt.id, 'SENSUS');
      if (formulaRow) {
        const result = evaluateFormula(formulaRow, payload);
        // Preserve the exact return shape legacy callers (ingestion.js) expect.
        const out = { hasil_hitung: result.hasil_hitung, satuan: result.satuan };
        if (result.forced_kandidat_pengendalian !== undefined) out.forced_kandidat_pengendalian = result.forced_kandidat_pengendalian;
        if (result.meta && result.meta.key) out.status_serangan = result.meta.key; // GANODERMA parity
        return out;
      }
    }
  } catch (e) {
    if (!legacyFn) throw e; // no fallback available -> surface the real error
    // else: fall through to legacy function below (defensive -- formula table not seeded yet, etc).
  }
  if (!legacyFn) throw new Error(`Tidak ada sensus engine untuk HPT code=${hptCode}`);
  return legacyFn(payload);
}

module.exports = {
  generateBarisSampel,
  generateGrid,
  buildSamplingPlan,
  computeUPDKS,
  computeTikus,
  computeOryctes,
  computeRayap,
  computeGanoderma,
  computeByHptCode,
  GANODERMA_SCALE,
};
