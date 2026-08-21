// Standalone smoke test (not part of the app bundle) verifying the ported domain engines
// (src/domain/thresholdEngine.ts, src/domain/sensusEngines.ts) against REAL data pulled live from
// the running backend, reproducing SPEC.md section 4's worked example: UPDKS 13 ulat / 2 pelepah =
// 6.5 ekor/pelepah -> BERAT. Run with: npx tsx scripts/engineSmokeTest.ts
import { computeUPDKS, computeTikus, computeOryctes, computeRayap, computeGanoderma, generateBarisSampel, generateGrid, buildSamplingPlan } from '../src/domain/sensusEngines';
import { runLocalThresholdEngine } from '../src/domain/thresholdEngine';
import { checkLocationWarning } from '../src/domain/geo';
import type { Blok, Species, ThresholdRow } from '../src/types';

const API = process.env.API_BASE_URL || 'http://localhost:4000/api';

async function main() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@ews.local', password: 'password123' }),
  }).then((r) => r.json());
  const token = login.access_token;
  const auth = { Authorization: `Bearer ${token}` };

  const master = await fetch(`${API}/sync/master`, { headers: auth }).then((r) => r.json());
  const thresholdRes = await fetch(`${API}/sync/threshold`, { headers: auth }).then((r) => r.json());
  const thresholds: ThresholdRow[] = thresholdRes.data;
  const species: Species[] = master.data.species;
  const bloks: Blok[] = master.data.bloks;
  const blokTM = bloks.find((b) => b.status_tanaman === 'TM')!;

  let failures = 0;
  function check(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? 'PASS' : 'FAIL'} - ${label}: got ${JSON.stringify(actual)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`);
    if (!ok) failures++;
  }

  // 1. SPEC.md worked example: UPDKS 13 ulat / 2 pelepah = 6.5 ekor/pelepah -> BERAT
  const updks = computeUPDKS({ ulat_hidup_total: 13, jumlah_pelepah_diamati: 2 });
  check('computeUPDKS hasil_hitung', updks.hasil_hitung, 6.5);
  const speciesSA = species.find((s) => s.code === 'SA')!;
  const hptUPDKS = master.data.hpt.find((h: { code: string }) => h.code === 'UPDKS');
  const engineResult = runLocalThresholdEngine({
    thresholds,
    species,
    blok: blokTM,
    hpt_id: hptUPDKS.id,
    species_id: speciesSA.id,
    nilai_hasil: updks.hasil_hitung,
  });
  check('UPDKS 6.5 ekor/pelepah kategori', engineResult.kategori, 'BERAT');
  check('UPDKS 6.5 ews_alert', engineResult.ews_alert, true);

  // 2. Tikus formula
  const tikus = computeTikus({ serangan_baru: 2, serangan_lama: 1, jumlah_sampel: 30 });
  check('computeTikus hasil_hitung', Number(tikus.hasil_hitung.toFixed(4)), Number(((3 / 30) * 100).toFixed(4)));

  // 3. Oryctes formula
  const oryctes = computeOryctes({ jumlah_pokok_terserang: 5, jumlah_pokok_diamati: 40 });
  check('computeOryctes hasil_hitung', oryctes.hasil_hitung, 12.5);

  // 4. Rayap ambang ekonomi 0% - any attacked tree forces a non-NORMAL bucket
  const rayap = computeRayap({ jumlah_pokok_terserang: 1, jumlah_pokok_diamati: 8 });
  check('computeRayap forced_kandidat_pengendalian', rayap.forced_kandidat_pengendalian, true);
  const hptRayap = master.data.hpt.find((h: { code: string }) => h.code === 'RAYAP');
  const rayapEngine = runLocalThresholdEngine({
    thresholds,
    species,
    blok: blokTM,
    hpt_id: hptRayap.id,
    species_id: null,
    nilai_hasil: rayap.hasil_hitung,
    forced_kandidat_pengendalian: rayap.forced_kandidat_pengendalian,
  });
  check('Rayap 1 titik terserang -> non-NORMAL', rayapEngine.kategori !== 'NORMAL', true);

  // 5. Ganoderma qualitative scale
  const gano = computeGanoderma({ status_serangan: 'TERINFEKSI_SEDANG' });
  check('computeGanoderma ordinal', gano.hasil_hitung, 3);

  // 6. generateBarisSampel matches BRD example "3,13,23,33,..."
  check('generateBarisSampel(3,10,40)', generateBarisSampel(3, 10, 40), [3, 13, 23, 33]);

  // 7. generateGrid + buildSamplingPlan reads Blok.parameter_sampling_json (not hard-coded)
  const plan = buildSamplingPlan(blokTM, 'GRID');
  console.log('GRID plan for blok', blokTM.code, JSON.stringify(plan.points));
  check('grid plan has points', Array.isArray(plan.points) && plan.points!.length > 0, true);

  // 8. GPS point-in-polygon against the blok's real GeoJSON polygon
  const geom = JSON.parse(blokTM.referensi_polygon!);
  const [lng0, lat0] = geom.coordinates[0][0];
  const insideWarning = checkLocationWarning(blokTM, lat0 + 0.0001, lng0 + 0.0001);
  const outsideWarning = checkLocationWarning(blokTM, lat0 - 5, lng0 - 5);
  check('point near polygon corner -> inside (no warning)', insideWarning, false);
  check('point far outside polygon -> warning', outsideWarning, true);

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
