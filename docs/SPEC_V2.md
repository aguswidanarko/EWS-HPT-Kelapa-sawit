# SPESIFIKASI TEKNIS V2 — EWS Plantation (HPT + Yield Making + Agronomy)

Dokumen ini adalah **delta spec**: extend `docs/SPEC.md` (V1), tidak menggantikannya. Semua prinsip desain V1 (§1 SPEC.md) tetap berlaku. Sumber: BRD_V2_Backend, BRD_V2_Dashboard, BRD_V2_Mobile_Offline, dan `EWS_FR_Group_Lengkap_1.pdf` (FR — berisi angka threshold konkret & alur kerja R&D vs Tim Operasional Kebun per indikator).

Keputusan arsitektur yang sudah dikonfirmasi user (jangan tanya ulang):
- **Extend skema V1 yang ada** — tabel V1 dipertahankan, tabel baru ditambahkan di atasnya. Jangan drop/rename tabel V1 manapun.
- **Build semua sekaligus**, tidak dipecah fase dengan gerbang konfirmasi.
- **WhatsApp**: provider abstraction, mock/log-only dulu (pola sama seperti Email V1).
- **Threshold Yield Making baru**: pakai persis angka dari FR (lihat §5 di bawah), tapi tetap configurable lewat Rule & Parameter Management (bukan hard-code).
- **Modul Scoring/KPI**: bangun kerangka data (kriteria generik, editable dari Master Data) — rincian 5 kriteria R&D dan 5 kriteria Tim Operasional TIDAK tersedia di dokumen manapun, jangan diasumsikan/dikarang. Skeleton harus siap diisi kriteria asli nanti tanpa bongkar struktur.

## 1. Perubahan Konsep Utama V1 → V2

1. **Rule Engine jadi generik & data-driven.** V1: 5 formula HPT hard-coded di kode (UPDKS/Tikus/Oryctes/Rayap/Ganoderma). V2: formula didefinisikan sebagai data (`formula` table) dengan `formula_type` ∈ `COUNT_TOTAL, PERCENTAGE, THRESHOLD, DURATION, DATE_INTERVAL, RAINFALL_ACCUMULATION, MINIMUM_SAMPLE, CATEGORICAL_CONDITION, AND_OR`. Kode HPT lama tetap jalan (dipetakan ke formula_type yang sesuai), tapi engine baru harus bisa menangani indikator BARU (Partenocarpi, Water Management, Bahan Organik, TBM Vegetatif) tanpa nulis kode formula baru per indikator.
2. **Domain diperluas dari "HPT" ke "EWS Indicator"** — tabel `hpt` (V1) dipakai ulang sebagai tabel indikator generik (tidak di-rename, supaya kode V1 yang query `hpt_id` tetap valid), ditambah kolom `indicator_type` (`HPT` / `YIELD_MAKING` / `AGRONOMY` / `DEFISIENSI_HARA`) dan `category_id` (FK ke `ews_category` baru).
3. **Setiap perhitungan rule menyimpan rule_version.** Tabel baru `rule_version` — histori tidak boleh berubah makna kalau threshold diubah di kemudian hari.
4. **Action Plan jadi modul formal**, bukan sekadar field `saran_pengendalian` di sensus. Overdue & escalation dihitung dari `due_date` vs status.
5. **Scheduling Engine generik** — bukan cuma `schedule.tanggal_rencana` manual, tapi bisa digenerate dari `scheduling_rule` (interval per indikator: 2 minggu/bulan/2 bulan/semester sesuai FR, berdasarkan `last_inspection`).
6. **Alert status flow berubah** dari 6 state (V1: `NEW→ACKNOWLEDGED→IN_PROGRESS→CONTROLLED→MONITORING→CLOSED`) jadi 7 state (V2 BRD: `NEW→ACKNOWLEDGED→ACTION_REQUIRED→IN_PROGRESS→COMPLETED→VERIFIED→CLOSED`). Migrasi data lama: `CONTROLLED→COMPLETED`, `MONITORING→VERIFIED`, sisanya nama sama.
7. **RBAC diperluas.** V1 roles: `ADMIN, RND_FOD, MANAGER, ASKEP_ASISTEN, PETUGAS_DETEKSI, PETUGAS_SENSUS, PETUGAS_PENGENDALIAN`. V2 BRD sebut: `Super Admin, Admin EWS, Estate Manager, Askep/Asisten, Mandor/Petugas, Riset, Viewer/Management`. Reconciliation (tambah tanpa hapus role V1 yang masih dipakai):
   - `ADMIN` tetap ada, tambah `SUPER_ADMIN` (akses penuh + system config, di atas ADMIN).
   - `MANAGER` ≈ `ESTATE_MANAGER` — pakai code `MANAGER` yang sudah ada, jangan duplikasi.
   - `ASKEP_ASISTEN` tetap.
   - `RND_FOD` tetap dipakai untuk alur kerja HPT (sesuai FR: R&D bertanggung jawab controller/analisa/rekomendasi), tambah role baru `RISET` khusus untuk leaf analysis/defisiensi hara (BRD sebut "Riset" terpisah dari FOD dalam konteks Yield Making — FOD ada di Tim Operasional Kebun per FR, sedangkan "R&D" di FR mencakup Basic Research; jangan gabungkan paksa, buat `RISET` sebagai role baru, `RND_FOD` tetap untuk fungsi lapangan-analitis HPT/Yield Making yang sudah ada).
   - `PETUGAS_DETEKSI/SENSUS/PENGENDALIAN` tetap (V2 "Mandor/Petugas" adalah payung istilah, bukan pengganti granularitas V1).
   - Tambah `VIEWER_MANAGEMENT` (read-only, untuk CEO/Management — BRD §9 UI/UX: "CEO melihat ringkasan dan prioritas").
8. **Knowledge Base**: tambah `publish_status` (`DRAFT/PUBLISHED/ARCHIVED`) dan `checksum` — mobile HANYA terima `PUBLISHED`. `versi`/`tanggal_berlaku`/`status_aktif` V1 dipertahankan (status_aktif ≠ publish_status: status_aktif = masih berlaku secara bisnis, publish_status = tahap penerbitan dokumen).
9. **GIS containment check**: kalau `blok.referensi_polygon` (GeoJSON, sudah ada dari V1) terisi, backend WAJIB melakukan point-in-polygon check terhadap GPS yang masuk dari deteksi/sensus/yield making — bukan cuma bounding-box kasar. Kalau di luar polygon → `location_warning=1` (field sudah ada dari V1, generalisasi ke seluruh entity baru).
10. **Rebuild/Refactor**: SEMUA tabel baru pakai `CREATE TABLE IF NOT EXISTS` — jangan pernah `DROP TABLE`. Kolom baru pada tabel existing pakai pola "try ALTER TABLE ADD COLUMN, catch-ignore-if-exists" di `db.js` migration runner (SQLite tidak punya `ADD COLUMN IF NOT EXISTS`).

## 2. Tabel Baru (di atas skema V1 `backend/src/db/schema.sql`)

```sql
-- Kategori indikator EWS (payung HPT / Yield Making / Agronomy / Defisiensi Hara)
ews_category(id, code, name)  -- HPT, YIELD_MAKING, AGRONOMY, DEFISIENSI_HARA

-- hpt table (V1) DIPAKAI ULANG sebagai tabel indikator generik. Kolom baru:
--   ALTER TABLE hpt ADD COLUMN indicator_type TEXT DEFAULT 'HPT';
--   ALTER TABLE hpt ADD COLUMN category_id INTEGER REFERENCES ews_category(id);
-- 5 HPT existing (UPDKS/TIKUS/ORYCTES/RAYAP/GANODERMA) tetap indicator_type='HPT'.
-- Indikator baru V2 di-insert sebagai row baru di tabel hpt yang sama:
--   PARTENOCARPI (indicator_type=YIELD_MAKING), WATER_MANAGEMENT, BAHAN_ORGANIK,
--   TBM_VEGETATIF (semua YIELD_MAKING), DEFISIENSI_HARA (indicator_type=DEFISIENSI_HARA).

-- Rule versioning ledger — dirujuk dari detection/sensus/yield_* sbg rule_version_id snapshot
rule_version(id, entity_type, entity_id, version_no, effective_date, status, changed_by_user_id, change_note, snapshot_json, created_at)

-- Formula generik per indikator (menggantikan hard-code formula V1 di kode)
formula(id, hpt_id, formula_type, expression_json, unit, description, active, created_at, updated_at)
-- formula_type: COUNT_TOTAL | PERCENTAGE | THRESHOLD | DURATION | DATE_INTERVAL |
--               RAINFALL_ACCUMULATION | MINIMUM_SAMPLE | CATEGORICAL_CONDITION | AND_OR
-- expression_json bentuknya berbeda per type, contoh:
--   PERCENTAGE: {"numerator_field":"jumlah_serangan","denominator_field":"jumlah_sampel","multiply":100}
--   RAINFALL_ACCUMULATION: {"window_days":30,"operator":">","value":270,"unit":"mm"}
--   AND_OR: {"op":"AND","conditions":[{...},{...}]}

-- Sampling rule generik (melengkapi blok.parameter_sampling_json V1 dgn master per-indikator)
sampling_rule(id, hpt_id, method, row_start, row_interval, plant_start, plant_interval, minimum_sample, unit_scope, description, active)
-- unit_scope: BARIS_SAMPEL | GRID | SELURUH_POKOK | GAWANGAN | KUALITATIF

-- Scheduling rule generik (BRD V2 Backend §7: daily/biweekly/monthly/custom)
scheduling_rule(id, hpt_id, interval_type, interval_value, based_on, active, created_at, updated_at)
-- interval_type: DAILY | BIWEEKLY | MONTHLY | CUSTOM ; based_on: LAST_INSPECTION | FIXED_DATE

-- Action Plan formal (BRD V2 §10 Backend, §4.7 Dashboard, §17 Mobile)
action_plan(id, incident_id, alert_id, problem, recommendation, actual_action, pic_user_id,
  due_date, status, evidence_photo_id, verification_note, verified_by_user_id, verified_at,
  overdue, escalated, related_leaf_analysis_id, source, sync_status, local_id, server_id,
  created_at, updated_at)
-- status: OPEN | PLANNED | IN_PROGRESS | COMPLETED | VERIFIED | CLOSED

-- ===== YIELD MAKING modules (field data, sync envelope sama seperti detection/sensus V1) =====

yield_partenocarpi(id, local_id, server_id, incident_id, user_id, device_id,
  estate_id, afdeling_id, blok_id, tanggal, periode,
  rainfall_mm, indikator_hujan_pagi, total_bunch, abnormal_bunch, abnormal_bunch_pct,
  populasi_ek, kategori, ews_alert, gps_lat, gps_lng, gps_accuracy, location_warning,
  foto_id, catatan, sync_status, sync_attempt, sync_error, source, created_at, updated_at)

water_management(id, local_id, server_id, incident_id, user_id, device_id,
  estate_id, afdeling_id, blok_id, titik_parit, tanggal, water_level_cm,
  flooding, flooding_duration_hari, kategori, ews_alert,
  gps_lat, gps_lng, gps_accuracy, location_warning, foto_id, catatan,
  sync_status, sync_attempt, sync_error, source, created_at, updated_at)

bahan_organik(id, local_id, server_id, incident_id, user_id, device_id,
  estate_id, afdeling_id, blok_id, area_type, tanggal,
  total_sample, yellowing_count, yellowing_pct,
  vegetative_condition, baseline_tbm_normal, comparison_result,
  kategori, ews_alert, gps_lat, gps_lng, gps_accuracy, location_warning,
  foto_id, catatan, sync_status, sync_attempt, sync_error, source, created_at, updated_at)

tbm_vegetatif(id, local_id, server_id, incident_id, user_id, device_id,
  estate_id, afdeling_id, blok_id, tanggal, umur_bulan,
  panjang_pelepah_cm, jumlah_pelepah, lai, target_produksi_ton_ha, hasil_evaluasi,
  gps_lat, gps_lng, gps_accuracy, location_warning, foto_id, catatan,
  sync_status, sync_attempt, sync_error, source, created_at, updated_at)

-- ===== Defisiensi Hara =====

leaf_analysis(id, blok_id, tanggal, unsur_hara, hasil, severity, status,
  input_by_role, user_id, catatan, created_at, updated_at)
-- input_by_role selalu 'RISET' secara bisnis; unsur_hara: N/P/K/Mg/dst (free text master-driven)

defisiensi_hara_temuan(id, local_id, server_id, leaf_analysis_id, incident_id,
  user_id, device_id, estate_id, afdeling_id, blok_id, tanggal, unsur_hara,
  temuan_lapangan, severity, status, action_plan_id, evidence_photo_id,
  gps_lat, gps_lng, gps_accuracy, catatan,
  sync_status, sync_attempt, sync_error, source, created_at, updated_at)

-- ===== Scoring / KPI (SKELETON — kriteria asli belum tersedia, lihat catatan §1) =====

scoring_criteria(id, side, code, name, max_poin, description, active, created_at)
-- side: RND | TIM_OPERASIONAL | BONUS   (target: 5 RND @poin, 5 TIM_OPERASIONAL @poin, BONUS max 10)

scoring_entry(id, hpt_id, estate_id, afdeling_id, period_month, criteria_id,
  poin_diberikan, catatan, created_by_user_id, created_at)
-- period_month format 'YYYY-MM'. Rekap total/level dihitung read-model (SUM poin_diberikan per period+estate),
-- bukan disimpan redundant — lihat §6 endpoint /api/scoring/summary.

-- ===== Knowledge Base publish workflow (kolom baru di tabel V1) =====
--   ALTER TABLE knowledge_base ADD COLUMN publish_status TEXT DEFAULT 'PUBLISHED';
--   ALTER TABLE knowledge_base ADD COLUMN checksum TEXT;

-- ===== Alert status migration (V1 -> V2 value mapping, dijalankan sekali di migration) =====
--   UPDATE alert SET status='COMPLETED' WHERE status='CONTROLLED';
--   UPDATE alert SET status='VERIFIED' WHERE status='MONITORING';
--   UPDATE incident SET status='COMPLETED' WHERE status='CONTROLLED';
--   UPDATE incident SET status='VERIFIED' WHERE status='MONITORING';
```

Semua tabel field-data baru (`yield_partenocarpi`, `water_management`, `bahan_organik`, `tbm_vegetatif`, `defisiensi_hara_temuan`, `action_plan`) WAJIB pakai sync envelope yang sama persis dengan `detection`/`sensus` V1 (`local_id, server_id, device_id, user_id, sync_status, sync_attempt, sync_error, source`) — supaya masuk ke Sync Center mobile yang sama, bukan pipeline terpisah.

## 3. Rule Engine V2 — Kontrak

Backend V1 sudah punya `services/thresholdEngine.js` (atau setara) yang hard-code 5 formula. V2 WAJIB refactor jadi:

```
computeIndicatorResult(hpt_code, input_payload, blok) → { hasil, kategori, threshold_ref, rule_version_id, rekomendasi, next_action, alert_required }
```

Function ini baca `formula` table by `hpt_id` → jalankan sesuai `formula_type` → bandingkan ke `threshold` table (V1, sudah ada, generik by hpt_id+species_id+fase_tanaman+kategori+nilai_min/max) → catat `rule_version_id` dari `rule_version` ledger yang aktif saat itu. HPT lama (5 jenis) harus tetap menghasilkan angka IDENTIK dengan V1 (regression: jangan sampai UPDKS/Tikus/dst berubah hasil karena refactor) — validasi dengan re-run data seed PISP1 lama dan bandingkan hasil kategori/alert count sebelum-sesudah refactor.

## 4. Modul Baru per Layer

### Backend (`backend/src/`)
- `services/ruleEngine.js` — generic engine kontrak §3, ganti/refactor `thresholdEngine.js` lama (pertahankan public function signature yang dipakai importPisp1.js & routes lama supaya tidak break).
- `services/schedulingEngine.js` — generate `schedule` rows dari `scheduling_rule` + `last_inspection` per blok+hpt.
- `services/gisContainment.js` — point-in-polygon check (ray casting manual, tanpa dependency native — GeoJSON polygon sudah tersimpan sbg string di `blok.referensi_polygon`).
- `services/notificationProviders/whatsapp.js` — mock/log-only, interface sama seperti `email.js` V1.
- `routes/actionPlans.js`, `routes/yieldMaking.js` (partenocarpi/water/organik/tbm sub-routes atau 1 file dgn 4 sub-router), `routes/leafAnalysis.js`, `routes/defisiensiHara.js`, `routes/scoring.js`, `routes/schedulingRules.js`, `routes/formulas.js` (Rule & Parameter Management UI backing).
- `db/migrations/002_v2.sql` (atau extend `schema.sql` langsung dgn `CREATE TABLE IF NOT EXISTS` + migration runner utk `ALTER TABLE ADD COLUMN` yang idempotent lewat try/catch di `db.js`).
- `db/seed.js` — tambah seed: `ews_category` (4 rows), indikator baru di tabel `hpt`, `formula` rows utk 5 HPT lama (representasi ulang formula existing sbg data) + 4 indikator Yield Making baru, `threshold` rows dgn angka PERSIS dari FR (§5 di bawah), `sampling_rule`, `scheduling_rule` (interval sesuai FR: Deteksi HPT 2 minggu, UPDKS/Tikus/Oryctes sensus bulanan, Rayap 2 bulan, Ganoderma semester/tahun, Partenocarpi bulanan, TBM vegetatif min 3 bulan), `scoring_criteria` (skeleton, boleh 5+5+bonus dgn nama placeholder yang jelas ditandai "TBD — menunggu rincian dari user"), role baru (`SUPER_ADMIN`, `RISET`, `VIEWER_MANAGEMENT`).

### Dashboard (`dashboard/src/`)
- Menu baru: **Yield Making** (sub-tab Partenocarpi/Elaeidobius, Water Management, Bahan Organik, TBM Vegetatif), **Defisiensi Hara**, **Action Plan** (list+detail+verifikasi, terpisah dari Alert Detail), **Monitoring Schedule** (scheduled/due/completed/overdue/skipped+alasan), **Rule & Parameter Management** (CRUD `formula`+`threshold`+`sampling_rule`+`scheduling_rule`, dgn rule versioning visible), **Scoring/KPI** (skeleton: tabel kriteria + input poin per periode + rekap /110 + badge Level 1-4).
- Alert Center & Incident Detail: update status pill ke 7-state V2 flow.
- Master Data: tambah tab Indikator (generalized dari "Master HPT" V1), Scoring Criteria, Role baru.
- Peta EWS: tambah layer Defisiensi Hara, Water Management, Yield Making (sesuai BRD Dashboard §4.2).

### Mobile (`mobile/src/`)
- Screen baru: `PartenocarpiFormScreen`, `WaterManagementFormScreen`, `BahanOrganikFormScreen`, `TbmVegetatifFormScreen`, `DefisiensiHaraScreen` (lihat daftar blok defisiensi dari Riset + input temuan), `ActionPlanScreen` (list task + form actual action/status/evidence, status Open→Planned→In Progress→Completed→Verified→Closed — CATATAN: ini beda 6-state dari Alert 7-state, JANGAN disamakan).
- `db/schema` lokal (SQLite offline) + `sync/` queue: tambah entity type baru sesuai tabel §2, pola sama seperti `detection`/`sensus` yang sudah ada.
- `HomeScreen` menu grid: tambah entri Yield Making, Defisiensi Hara, Action Plan.
- Sampling Assistant: generalize supaya baca `sampling_rule` (bukan cuma hardcode UPDKS/Tikus/dst).

## 5. Threshold Default V2 (dari FR — SUDAH DIKONFIRMASI user, pakai persis ini sebagai seed)

| Indikator | Ambang batas ekonomis | Interval | Scope sensus |
|---|---|---|---|
| Deteksi HPT (semua jenis, tahap awal) | kualitatif — indikasi serangan baru (lihat gejala per HPT di FR) | 2 minggu | rotasi 2x/bulan, kebun non-endemik |
| UPDKS (mitigasi/sensus) | ≥ 5 ekor/pelepah | 1 bulan | setiap blok terdeteksi, sampel pokok 1% (baris & pokok sesuai SOP) |
| Tikus (mitigasi/sensus) | > 5 ekor/pelepah, gejala defoliasi awal | 1 bulan | setiap blok, ±24 pokok/blok |
| Oryctes (mitigasi/sensus) | ≥ 1% fresh damage, ada breeding site | 1 bulan | 12 gawangan/blok atau setiap 10 gawang |
| Rayap | ≥ 2 pokok/ha, endemik area gambut | 2 bulan | setiap blok, semua pokok |
| Ganoderma | 1 pokok/blok terserang, endemik area gambut | semester (endemik) / 1x/tahun (non-endemik) | setiap blok, semua pokok |
| Partenocarpi/Elaeidobius | bunga jantan antesis < 4 tandan/ha DAN populasi EK < 20.000 ekor/ha DAN curah hujan > 270 mm/bulan DAN > 20 mm/periode pagi-siang; abnormal bunch harian > 1% | 1 bulan | minimal 6 baris sensus/blok atau representasi total pokok/ha |
| Water Management | level air parit < 40 cm selama 1 bulan; genangan > 20 hari; target normal 40–60 cm di bawah permukaan tanah | sensus level air paling lambat tgl 25/bulan | per titik parit |
| Bahan Organik (area pasir) | daun menguning > 5% TM; TBM dibandingkan baseline TBM normal | — | per blok area pasir |
| TBM Sehat/Standar Vegetatif | pertumbuhan di bawah standar umur → rekomendasi perbaikan | minimal 3 bulan | setiap blok terdeteksi, sampel pokok 1% |

Target produksi (bukan threshold alert, tapi acuan Goal utk laporan/scoring): TBM2 = 10 ton/Ha, TBM3 = 20 ton/Ha, TM1 = 30 ton/Ha, TM3 = 40 ton/Ha.

**Catatan ambiguitas yang sudah diketahui dan diterima (bukan bug, dicatat supaya tidak dianggap salah build):** BRD Dashboard V2 §5 menyebut Tikus/UPDKS/Oryctes pakai threshold "TM >5%, TBM >2%, TB-0 >2%" (persentase serangan blok), sedangkan FR menyebut ambang "≥5 ekor/pelepah" (kepadatan populasi). Kedua ini disimpan sebagai DUA formula terpisah pada indikator yang sama (`formula` bisa >1 row per `hpt_id`, dibedakan lewat konteks pemakaian: satu untuk deteksi awal/skrining tingkat blok, satu untuk hasil sensus rinci per pelepah) — jangan dipaksa jadi satu angka.

## 6. Acceptance Criteria V2 (gabungan BRD Backend §21 + Dashboard §11 + Mobile §26, plus regression V1)

- Semua kriteria acceptance V1 (SPEC.md) tetap lulus — regression check via re-run PISP1 import & bandingkan jumlah incident/alert sebelum-sesudah.
- 5 formula HPT lama menghasilkan angka identik setelah dipindah ke `formula` table generik.
- Threshold baru Yield Making dapat diubah dari Rule & Parameter Management tanpa redeploy.
- Setiap hasil rule menyimpan `rule_version_id`.
- Action Plan dapat dimonitor OPEN→...→CLOSED, overdue terhitung otomatis dari `due_date`.
- Alert status pakai 7-state V2, data lama termigrasi.
- Scoring module: struktur data siap, UI menampilkan "kriteria belum final — placeholder" secara eksplisit (jangan pura-pura sudah final).
- Dashboard & mobile pakai API yang sama (tidak ada endpoint khusus salah satu platform untuk operasi yang sama).
- Semua entity baru punya audit_log & sync envelope yang konsisten dengan V1.
