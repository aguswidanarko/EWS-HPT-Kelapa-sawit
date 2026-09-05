# EWS HPT Backend

REST API + SQLite backend for the oil palm pest/disease early warning system (EWS HPT). This is
the single source of truth used by **both** the React web dashboard (`../dashboard`) and the
React Native offline-first mobile app (`../mobile`). Implements everything specified in
`../docs/SPEC.md`.

- **Runtime**: Node.js + Express
- **Database**: SQLite via `better-sqlite3` (file `ews.db` in this folder) — no external DB
  server required (SPEC.md section 9, decision #1)
- **Module system**: CommonJS throughout (`require`/`module.exports`)
- **Port**: `4000` by default (override with `PORT` env var)

## 1. Install & run

```bash
cd backend
npm install
npm run seed     # wipes and re-populates demo data (safe to re-run)
npm start         # listens on http://0.0.0.0:4000 (HOST/PORT env vars to override)
```

Health check: `GET /health` (no auth required; works from the server itself and, for LAN
diagnosis, from Mobile too - BRD EWS HPT V3.2.1 section 6).

Environment variables (all optional, sane dev defaults baked in - see `.env.example`):

| Var | Default | Purpose |
|---|---|---|
| `HOST` | `0.0.0.0` | Bind address. Must stay `0.0.0.0` (all interfaces) in production so Nginx (same host, reverse-proxying `/api` on :80 - see section 12 below) can reach it; only narrow this for a setup that truly needs a restricted bind address |
| `PORT` | `4000` | HTTP port. BRD section 26: keep this **internal-only** in the firewall (`4000 INTERNAL ONLY`, not open to the LAN/internet) - Nginx is the only public door |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | dev secrets in code | **Change in production** |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRES_IN` | `30d` | Refresh token lifetime (supports "session aman dipakai offline") |
| `EWS_DB_PATH` | `./ews.db` | SQLite file location |
| `EWS_UPLOAD_ROOT` | `./uploads` | Photos / knowledge base / maps / import files |

## 2. Demo login credentials

Password for every seeded account: **`password123`**

| Email | Role |
|---|---|
| admin@ews.local | ADMIN |
| rnd@ews.local | RND_FOD (R&D / FOD) |
| manager@ews.local | MANAGER |
| askep@ews.local | ASKEP_ASISTEN |
| deteksi@ews.local | PETUGAS_DETEKSI |
| sensus@ews.local | PETUGAS_SENSUS |
| pengendalian@ews.local | PETUGAS_PENGENDALIAN |

Seed data: 1 Estate ("Estate Sungai Lembu"), 3 Afdeling, 6 Blok (mix of TM/TBM1/TBM2), the 5 HPT
from SPEC.md (UPDKS with 12 species across the Ulat Api / Ulat Kantong groups, Tikus, Oryctes,
Rayap, Ganoderma) each with full threshold tables, 3 Knowledge Base entries, a few routine
Deteksi/Sensus records, and **two records that deliberately cross a threshold** to demonstrate the
alert engine end-to-end (one is the exact worked example from SPEC.md section 4: UPDKS 13 ulat /
2 pelepah = 6,5 ekor/pelepah → BERAT).

## 3. Module system

CommonJS (`require`) everywhere — `package.json` sets `"type": "commonjs"` explicitly.

## 4. Project layout

```
backend/
  src/
    db/            schema.sql, db.js (connection + idempotent migration loader), seed.js
    middleware/     auth.js (JWT+RBAC), upload.js (multer), errorHandler.js
    services/       thresholdEngine.js, sensusEngines.js, incidentCode.js, notificationProvider.js,
                    duplicateDetection.js, geo.js, ingestion.js (shared by direct routes + sync),
                    audit.js, permissions.js
    routes/         one file per resource (see route table below)
    app.js          Express app wiring
    index.js        entry point
  uploads/          photos/ knowledge-base/ maps/ imports/  (gitignored, created on demand)
  backups/          output of scripts/backup.js
  scripts/backup.js
```

## 5. How the Threshold / Incident / Alert engine works

Implemented in `src/services/thresholdEngine.js`, invoked from `src/services/ingestion.js` for
every Deteksi/Sensus/Mortality submission (whichever door it comes through — direct API, mobile
sync batch upload, or Excel import all funnel through the same `ingest*()` functions, so the
engine behaves identically regardless of `source`).

Pipeline (SPEC.md section 4), literally implemented as this sequence of function calls:

1. **VALIDASI** — blok/hpt must exist.
2. **IDENTIFIKASI FASE TANAMAN** — read `blok.status_tanaman` (`TBM1`/`TBM2`/`TBM3`/`TM`).
3. **AMBIL THRESHOLD** — query the `threshold` table for `(hpt_id, species_id or species-group,
   fase_tanaman OR 'SEMUA', status='AKTIF', latest effective_date <= today)`. **Threshold values
   are never hard-coded in application code** — this query is the only place classification
   numbers come from.
4. **HITUNG** — done just before calling the engine, by `src/services/sensusEngines.js` (one pure
   function per HPT formula from SPEC.md section 5).
5. **KLASIFIKASI** — `classify()` finds which `[nilai_min, nilai_max]` bucket the result falls
   into; ties broken by taking the highest-severity bucket.
6. **BUAT/UPDATE INCIDENT** — if kategori != `NORMAL`, reuse the blok's already-open incident
   (same `hpt_id`+`blok_id`, `status != CLOSED`) bumping severity if the new result is worse, or
   open a new one with `incident_code = EWS-YYYYMMDD-XXXX` (sequential per day, see
   `src/services/incidentCode.js`).
7. **BUAT ALERT** — one `alert` row per exceeding event (so the Alert Center shows every
   occurrence, not just one per incident).
8. **NOTIFIKASI** — a `DASHBOARD` notification is always logged. For kategori `SEDANG`/`BERAT`/
   `CRITICAL` (BRD 02 section 20 rule), `notification_rule` rows are resolved to recipients
   (by role, specific user, and/or the blok's PIC) and sent through the `NotificationProvider`
   adapter (see next section).

Species-group matching (Ulat Api vs Ulat Kantong for UPDKS): a `threshold` row can target one
specific `species_id`, or `NULL` (applies to the whole HPT), and the lookup also matches any
species sharing the same `species.group_name` — so seeding one threshold row against a
representative species (e.g. "SA") applies it to the entire Ulat Api group without hard-coding
group membership in the engine.

Rayap's "ambang ekonomi 0%" rule (any attacked tree is automatically a control candidate) is
implemented as a forced-override: if the raw percentage doesn't land in any configured bucket,
the engine still escalates to the worst configured non-NORMAL bucket whenever
`jumlah_pokok_terserang > 0`.

Ganoderma is qualitative — `computeGanoderma()` maps `status_serangan` text
(`TIDAK_ADA`/`INDIKASI_AWAL`/`TERINFEKSI_RINGAN`/`TERINFEKSI_SEDANG`/`TERINFEKSI_BERAT`) to an
ordinal 0–4 scale, and threshold rows for Ganoderma use that same ordinal scale as
`nilai_min=nilai_max=code` — so it flows through the exact same generic classify() function as
every numeric HPT, with no special-cased qualitative branch anywhere else in the app.

Mortality effectiveness (BRD example: "jika ulat hidup masih >2 ekor/pelepah → treatment perlu
service") is evaluated by `evaluateEffectiveness()` in `ingestion.js`: it first looks for a
`threshold` row with `kategori='TIDAK_EFEKTIF'` for the incident's HPT; if none is configured it
falls back to the documented BRD default (`jumlah_hidup/sampel > 2`). A `service_required=true`
mortality record files a `SERVICE_REQUIRED` alert against the incident.

## 6. Swapping the NotificationProvider for a real Email/WhatsApp integration

`src/services/notificationProvider.js` exports a single object, `provider`, with one method:

```js
provider.send({ channel, recipient, subject, message, meta })
  // -> { status: 'SENT'|'FAILED', response_provider: string, error: string|null }
```

Every other module (`thresholdEngine.js`, `ingestion.js`) calls only `provider.send(...)` — none
of them know or care whether it's a mock, SMTP, or a WhatsApp Business API client. The default
export, `MockLogProvider`, just logs to stdout and returns a synthetic `SENT` — good enough to
prove the pipeline end-to-end without production credentials, and it's exactly what the demo you
just ran used.

**To plug in a real provider**: implement a class with the same `async send(...)` contract (e.g.
call `nodemailer` for `channel==='EMAIL'`, or a WhatsApp Business API / Twilio client for
`channel==='WHATSAPP'`, and pass `DASHBOARD` straight through as a no-op/log), then change the
bottom of `notificationProvider.js`:

```js
// const provider = new MockLogProvider();
const provider = new RealNotificationProvider({ smtp: {...}, whatsapp: {...} });
```

No other file needs to change. `NOTIFY_KATEGORI` in `thresholdEngine.js` controls which
severities trigger Email/WhatsApp (currently `SEDANG`/`BERAT`/`CRITICAL`, per BRD 02 section 20);
recipients are configured at runtime via `notification_rule` CRUD
(`/api/notification-rules`), not hard-coded.

## 7. Mobile sync conflict policy

Server is the sole source of truth for master data (mobile only ever downloads
Estate/Afdeling/Blok/HPT/Species/Threshold/Knowledge-Base/Jadwal — see `/api/sync/master` etc; it
never writes master data). For field records (Deteksi/Sensus/Treatment/Mortalitas): a record that
already carries a `server_id` is **never silently overwritten** on re-upload. If the incoming
batch item's `server_id` matches an existing row, the row is left untouched, the payload is
inserted as a **new row** sharing the same `activity_id` (a versioned update), and the conflict is
written to `audit_log` (`aktivitas = SYNC_CONFLICT_<KIND>`) with before/after snapshots. See
`src/routes/sync.js` `makeBatchHandler()`.

## 8. Backup

```bash
npm run backup     # or: node scripts/backup.js
```

Copies `ews.db` (+ `-wal`/`-shm` sidecars), the entire `uploads/` tree (photos, knowledge base,
GeoJSON maps, Excel imports), and a JSON export of `audit_log`, into
`backups/backup-<ISO timestamp>/`. Wire it into cron for a production-like schedule, e.g. daily at
02:00:

```
0 2 * * * cd /path/to/backend && node scripts/backup.js
```

**Production note (BRD 02 section 54/56)**: this backend is designed to run behind a reverse
proxy (nginx/Caddy) terminating TLS — HTTPS itself is out of scope for local dev. JWT auth, RBAC,
input validation, file upload mime/size limits, and audit logging middleware are all implemented
and active by default.

## 9. GeoJSON / Shapefile note (SPEC.md section 9 decision #6)

v1 accepts **GeoJSON** uploads directly (`POST /api/gis/layers/upload`) — simplest to serve
straight to a Leaflet map. Shapefiles need converting to GeoJSON first (e.g. `ogr2ogr -f GeoJSON
out.geojson in.shp`) before uploading. Uploaded files are validated (`FeatureCollection`/`Feature`
with `Polygon`/`MultiPolygon` geometry) and kept as the untouched "source file"; publishing a
layer copies it to a separate "layer file" location actually served to the map app, and republishing
archives the previous published version — so source history and what's live are always distinct
and versioned.

## 10. Full API route list

All routes except `/health`, `POST /api/auth/login`, and `POST /api/auth/refresh` require
`Authorization: Bearer <access_token>`. "Write roles" always additionally allow `ADMIN`.

### Auth
| Method & Path | Auth | Description |
|---|---|---|
| POST /api/auth/login | none | email+password → access+refresh token, full user profile (role/estate/afdeling/area_kerja/hak_akses) |
| POST /api/auth/refresh | none (refresh token in body) | new access token |
| GET /api/auth/me | any | current user profile |

### Master data (`/api/master`) — read: any authenticated user; write: ADMIN (HPT/Species/Threshold also RND_FOD)
| Method & Path | Description |
|---|---|
| GET/POST /api/master/estates, /:id (PUT/DELETE) | Estate CRUD |
| GET/POST /api/master/afdelings, /:id | Afdeling CRUD |
| GET/POST /api/master/bloks, /:id | Blok CRUD (incl. `parameter_sampling_json`) |
| GET /api/master/bloks/:id/sampling-plan?metode= | generated baris-sampel/grid points for a blok |
| GET/POST /api/master/hpt, /:id | HPT CRUD |
| GET/POST /api/master/species, /:id | Species CRUD (incl. `group_name`) |
| GET/POST /api/master/thresholds, /:id | Threshold CRUD |
| GET /api/master/thresholds-active?hpt_id=&species_id=&fase_tanaman= | resolves currently-active thresholds the same way the engine does |

### Knowledge Base (`/api/knowledge-base`) — read: any; write: ADMIN/RND_FOD
| Method & Path | Description |
|---|---|
| GET / , /:id | list / detail |
| GET /:id/file | download underlying file |
| POST / (multipart `file`) | upload new entry |
| POST /:id/new-version (multipart `file`) | new version, archives old |
| PUT/DELETE /:id | update / delete |

### Users / PIC (`/api/users`) — ADMIN only for writes
| Method & Path | Description |
|---|---|
| GET /roles | list roles |
| GET / | list users (ADMIN/RND_FOD/MANAGER) |
| POST / , PUT /:id, DELETE /:id (soft-deactivate) | user management |
| GET/POST /pic , DELETE /pic/:id | PIC assignment CRUD |

### Schedule (`/api/schedule`) — read: any; write: ADMIN/ASKEP_ASISTEN/MANAGER/RND_FOD
| Method & Path | Description |
|---|---|
| GET / , POST / , PUT /:id , DELETE /:id | Jadwal CRUD (no approval gate — status is operational only) |

### Field data ingestion (dashboard-facing single-record routes)
| Method & Path | Auth | Description |
|---|---|---|
| GET /api/detections , GET /:id | any | list/detail |
| POST /api/detections | ADMIN/PETUGAS_DETEKSI/RND_FOD | create + runs threshold engine if `jumlah_indikasi` given |
| GET /api/sensus , GET /:id | any | list/detail |
| GET /api/sensus/plan?blok_id=&jenis_sensus= | any | sampling plan for that blok+HPT |
| POST /api/sensus | ADMIN/PETUGAS_SENSUS/RND_FOD | create; computes formula + runs threshold engine |
| GET /api/treatment , GET /:id | any | list/detail |
| POST /api/treatment | ADMIN/PETUGAS_PENGENDALIAN/ASKEP_ASISTEN | create |
| PUT /api/treatment/:id | ADMIN/PETUGAS_PENGENDALIAN/ASKEP_ASISTEN | update status/progress |
| GET /api/mortality , GET /:id | any | list/detail |
| POST /api/mortality | ADMIN/PETUGAS_PENGENDALIAN | create; evaluates effectiveness, may raise SERVICE_REQUIRED alert |
| POST /api/photos (multipart `file`) | any | upload photo, links to entity |
| GET /api/photos | any | list photos |

### Mobile Sync API (`/api/sync`) — BRD 02 section 49
| Method & Path | Description |
|---|---|
| GET /api/sync/master | Estate/Afdeling/Blok/HPT/Species |
| GET /api/sync/threshold | all active thresholds |
| GET /api/sync/knowledge-base | published KB entries + download URLs |
| GET /api/sync/jadwal?user_id= | schedule for a user (defaults to self) |
| POST /api/sync/upload/deteksi , /sensus , /treatment , /mortalitas | batch upload `{device_id, items:[...]}` — conflict-safe (see section 7 above) |
| POST /api/sync/upload/foto (multipart `file`) | photo upload |
| GET /api/sync/status?user_id=&device_id= | last sync + pending-record counts |
| POST /api/sync/push-register | push token registration stub (see note below) |

### Dashboard (`/api/dashboard`, `/api/alerts`, `/api/incidents`, `/api/gis`)
| Method & Path | Auth | Description |
|---|---|---|
| GET /api/dashboard/kpi | any | Dashboard Utama KPI summary |
| GET /api/alerts?status=&kategori=&... | any | EWS Alert Center list |
| GET /api/alerts/:id | any | Alert detail (info + evidence + notifications) |
| PUT /api/alerts/:id/status | ADMIN/MANAGER/ASKEP_ASISTEN/RND_FOD | NEW→ACKNOWLEDGED→IN_PROGRESS→CONTROLLED→MONITORING→CLOSED (no approval gate) |
| GET /api/incidents , GET /:id | any | Incident Management list / full timeline (Deteksi→Warning→Sensus→Treatment→Mortalitas) |
| GET /api/gis/bloks , /:id | any | Peta EWS blok list (severity color) / blok detail |
| GET /api/gis/heatmap?from=&to=&hpt_id=&severity=&... | any | heatmap points |
| GET /api/gis/layers | any | GeoJSON layer versions |
| POST /api/gis/layers/upload (multipart `file`) | ADMIN/RND_FOD | upload+validate GeoJSON |
| GET /api/gis/layers/:id/preview | any | preview parsed GeoJSON |
| POST /api/gis/layers/:id/publish | ADMIN/RND_FOD | publish (versioned, archives previous) |

### Import Data (`/api/import`) — ADMIN/RND_FOD
| Method & Path | Description |
|---|---|
| GET /api/import/template/:entity | download Excel template (`detection`/`sensus`/`treatment`/`mortality`) with data dictionary sheet |
| POST /api/import/preview/:entity (multipart `file`) | validate every row, return valid/error counts + error list |
| POST /api/import/commit/:entity | commit (requires `confirm:true`, never partial without it) |
| GET /api/import/log | import history |

### Import Data — "Rekap Bulanan PISP1" (`/api/import/pisp1`) — ADMIN/RND_FOD
A second import path for the real production monthly-recap workbook format used by the PISP1
estate (`docs/samples/REKAP_HPT_PISP1_2026.xlsx`, full analysis in `docs/IMPORT_FORMAT_PISP1.md`).
This is a **pivot** format (one row per Blok, columns per month/rotation) rather than the flat
"one row = one observation" templates above, so it needs its own parser:
`services/importPisp1.js`. It follows the exact same preview→confirm→commit discipline as
`/api/import/preview|commit/:entity` (no partial import without `confirm:true`), and internally
calls the same `services/ingestion.js` (`ingestSensus`/`ingestTreatment`) — which in turn calls
`services/sensusEngines.js` and `services/thresholdEngine.js` — so imported data is classified,
turned into incidents, and alerted on identically to mobile/manual-entry/flat-Excel data. Nothing
in `importPisp1.js` re-implements threshold/incident/alert logic.

| Method & Path | Description |
|---|---|
| POST /api/import/pisp1/preview (multipart `file`) | parse-only (no db writes); returns per-sheet summary (rows read, records that would be created per HPT, rows skipped as empty/zero, parse errors) + `assumptions` (documented conversions, see below) + `out_of_scope` (sheets present in the file that are intentionally not imported) |
| POST /api/import/pisp1/commit | commit (requires `import_log_id` + `file_path` from the preview response + `confirm:true`); resolves/creates Estate → Afdeling → Blok master rows as needed, then routes every parsed record through `ingestSensus`/`ingestTreatment` |

**In-scope sheets** (6, matching the 5 BRD HPT): `REKAP SNS UPDKS`, `REKAP SNS TIKUS`, `SNSS ORYCTES`,
`SNSS RAYAP`, `SNS GANODERMA`, `REKAP PENGENDALIAN TIKUS`. Headers are located dynamically by
label text (Afdeling/Blok/Jan.../TGL SENSUS/...), not hard-coded row/column numbers, so the parser
tolerates the header-row offset and month-column set varying between files/periods.

**Out-of-scope sheets** (present in the sample file, not built): `Rekap ESTATE UPDKS`,
`REKAP P UPDKS PERIODE JAN/MAR`, `REKAP ESTATE TIKUS` are derived report/aggregate views (dashboard's
own reporting already covers this, no need to import). `REKAP SNS KBH` / `REKAP SNS KBH (2)` /
`REKAP KBH` (beetle-trap "KBH" biocontrol monitoring) and `BENEFICIAL PLANT` (natural-enemy host
plant monitoring) are a **requirement gap**: these are monitoring categories outside the 5 HPT the
BRD covers, so the importer only reports them (with a note) rather than importing them — building
support would need new HPT/threshold entities out of the current BRD scope.

**Documented conventions** (also returned as `assumptions` in every preview/commit response):
- Empty or `0` cells are treated as "not yet surveyed" and **skipped**, never turned into a fake
  zero-reading record — this rekap format has no separate marker for "surveyed, result nil" vs
  "not filled in yet". Exception: `SNSS ORYCTES` has a real "Jumlah Sampel" column that acts as the
  actual "was this surveyed" signal, so an Oryctes month-block is only skipped when Jumlah Sampel
  itself is blank/zero (a genuine "0 attacked, N sampled" reading is NOT skipped there).
- `REKAP SNS UPDKS`/`REKAP SNS TIKUS` only give the final per-Blok-per-month average/percentage, not
  raw per-sample counts. To reuse the existing formulas in `sensusEngines.js` unchanged (rather than
  re-implementing them), the value is encoded into formula inputs that reproduce the exact same
  computed result (UPDKS: `ulat_hidup_total=nilai, jumlah_pelepah_diamati=1`; TIKUS:
  `serangan_baru=nilai, serangan_lama=0, jumlah_sampel=100`).
- `REKAP SNS UPDKS` has no species breakdown, but UPDKS thresholds are keyed per species group
  (Ulat Api vs Ulat Kantong) — imported UPDKS sensus defaults to species code `UA` ("Ulat Api
  lainnya"). This is an assumption worth confirming with the user.
- `SNS GANODERMA`'s S1–S4 columns are pokok *counts* per severity criterion, not one qualitative
  status per Blok; the imported record uses the highest criterion with count > 0 (S4 > S3 > S2 > S1)
  as the Blok's `status_serangan`, matching the ordinal `GANODERMA_SCALE` in `sensusEngines.js`.
- `SNSS ORYCTES`: `jumlah_pokok_terserang` = that month's "Serangan Baru" Jumlah column;
  `jumlah_pokok_diamati` = the row's "Jumlah Sampel" column (shared across both month blocks on a row).
- `REKAP PENGENDALIAN TIKUS`: every column group (Rotasi 1–5, Sensus Awal, Sensus Sesudah Kampanye —
  including the sample file's duplicate-labelled groups) becomes one TREATMENT record
  (`metode_pengendalian = "Racun Tikus"`) whenever that group's Tanggal cell is filled.
- Afdeling/Blok not already in Master Data are auto-created from Afdeling+Blok+Ha+Tahun
  Tanam/Luas/PKK (matched by afdeling code + blok code); an already-existing Blok is **never**
  modified by this importer.

**Verification**: run against the real sample file —
`curl -X POST http://localhost:4000/api/import/pisp1/preview -H "Authorization: Bearer $TOKEN" -F "file=@docs/samples/REKAP_HPT_PISP1_2026.xlsx"`
— parses all 6 in-scope sheets with 0 errors. To prove the threshold→incident→alert pipeline fires
on imported data end-to-end, make a **copy** of the sample file (never edit the original), set a
few cells above known thresholds (e.g. UPDKS > 5 ekor/pelepah per SPEC.md's worked example), then
preview+commit that copy and check `/api/incidents`/`/api/alerts` for the new records.

### Reporting (`/api/reports`) — any authenticated user; `format=json|csv|xlsx` on every endpoint
| Method & Path | Description |
|---|---|
| GET /api/reports/daily?date= | EWS Daily Report |
| GET /api/reports/monthly?year=&month= | EWS Monthly Report |
| GET /api/reports/by-blok , /by-afdeling , /by-estate , /by-hpt | per-dimension reports |
| GET /api/reports/trend?interval=day\|month | trend report |
| GET /api/reports/treatment-service | treatment + mortality/service outcomes |

(PDF export was intentionally not built for v1 per the task's time-boxing note — Excel/CSV export
is fully implemented on every report endpoint above.)

### Data Quality / Sync Monitoring / Notification Rules / Audit Log
| Method & Path | Auth | Description |
|---|---|---|
| GET /api/data-quality | any | incomplete data, missing/out-of-blok GPS, unknown HPT/blok, duplicates, import errors, unsynced counts |
| GET /api/sync-monitoring | ADMIN/RND_FOD/MANAGER/ASKEP_ASISTEN | last sync per user/device + counts |
| GET /api/sync-monitoring/logs | ADMIN/RND_FOD/MANAGER/ASKEP_ASISTEN | raw sync_log rows |
| GET/POST /api/notification-rules , PUT/DELETE /:id | write: ADMIN/RND_FOD | trigger × recipient rule CRUD |
| GET /api/notification-rules/log | any | notification send log (channel/recipient/status/response/error) |
| GET /api/audit-log?user_id=&aktivitas=&device_source=&from=&to= | ADMIN/RND_FOD/MANAGER | audit trail |

## 11. Smoke test (what was run to verify this build)

```bash
# 1. Login
curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ews.local","password":"password123"}'

# 2. Master data GET
curl -s http://localhost:4000/api/master/estates -H "Authorization: Bearer $TOKEN"

# 3. Threshold-crossing detection -> INCIDENT + ALERT created
curl -s -X POST http://localhost:4000/api/detections -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"blok_id":2,"hpt_id":3,"tanggal":"2026-08-21","jumlah_indikasi":15,
       "gejala":"Banyak pucuk terpotong huruf V","kondisi_indikator":"Berat"}'
# -> response includes threshold_engine.incident.incident_code (EWS-YYYYMMDD-XXXX)
#    and threshold_engine.alert.kategori = "BERAT"

# 4. Mobile sync: download master
curl -s http://localhost:4000/api/sync/master -H "Authorization: Bearer $TOKEN"
```

All four were run against a freshly seeded database during development and passed (see the
worked UPDKS example in `src/db/seed.js`, which reproduces SPEC.md section 4's 6,5 ekor/pelepah →
BERAT example on every `npm run seed`). Additional flows exercised: mobile batch sync upload with
a `server_id` conflict (versioned update + `AUDIT_LOG` entry, never overwritten), alert
status transitions, GIS blok severity coloring, GeoJSON layer upload/publish/versioning, Excel
import preview→commit (rejecting commit without `confirm:true`), RBAC (a `PETUGAS_DETEKSI` account
gets 403 on master-data writes but 201 on posting a detection), and the backup script.

## 12. Deployment - Nginx gateway (BRD EWS HPT V3.2.1 "Connectivity & Sync Stabilization")

As of V3.2.1, Nginx is the single public gateway on the production server (`10.110.1.9`) for
**both** the dashboard and the API - Mobile and the dashboard now hit the exact same origin
(`http://10.110.1.9/api`) instead of Mobile going straight to this backend's `:4000`. See BRD "EWS
HPT V3.2.1 - Connectivity, API Configuration & Synchronization Stabilization" sections 3 and 7 for
the full rationale and architecture diagram.

- This backend: `HOST=0.0.0.0 PORT=4000 npm start` (or `npm run render-start` on Render - see
  `package.json`). Port 4000 should be reachable from `127.0.0.1`/the LAN interface Nginx uses,
  but **not** opened to the wider LAN/internet in the firewall (section 25/26).
- Nginx: reverse-proxies `/api/` to `http://127.0.0.1:4000/api/` and serves the built dashboard
  (`../dashboard`'s `npm run build` output) at `/`. A starting-point config living outside this
  repo's runtime path is at `../deploy/nginx.ews-hpt.conf.example` - copy it into your server's
  Nginx sites config and adjust `server_name`/TLS/dashboard build path for your environment; it is
  a reference, not something this repo runs directly.
- Recommended rollout order (BRD section 35): backup DB → deploy this backend → verify `GET
  /health` → update/reload Nginx → verify `GET /api/...` through Nginx → deploy the dashboard
  build → verify the dashboard loads and shows "Backend Connected" → build & install the Mobile
  APK on one device → verify offline input, reconnect/sync, and the "Tes Koneksi Server"/"Tes API"
  buttons in Sync Center → pilot on 2-3 devices → roll out to the rest.
