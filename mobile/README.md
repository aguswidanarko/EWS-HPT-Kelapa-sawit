# EWS HPT Mobile

Offline-first React Native (Expo) app for field officers (Petugas Deteksi / Sensus / Pengendalian)
of the oil palm pest & disease Early Warning System. Implements `docs/SPEC.md` section 6 ("Modul
Mobile") end to end against the backend in `../backend`.

- **Runtime**: Expo SDK 57, React Native 0.86, React 19, TypeScript (strict)
- **Local database**: `expo-sqlite` (async API) - see `src/db/schema.ts`
- **Navigation**: React Navigation (native-stack + bottom-tabs)
- **Auth storage**: `expo-secure-store` for JWT tokens; the synced user profile is cached in
  SQLite (`session_user` table) so role/estate/hak_akses gating works fully offline

## 1. Install & run

```bash
cd mobile
npm install
cp .env.example .env   # then edit EXPO_PUBLIC_API_URL - see section 2
npx expo start
```

Scan the QR code with the **Expo Go** app on an Android device, or press `a` to launch an Android
emulator (if you have Android Studio's AVD set up locally - not available in this sandbox, see
"Known limitations" below).

To sanity-check the project without a device:

```bash
npm run typecheck    # tsc --noEmit - must print nothing / exit 0
npm run doctor       # expo-doctor - project/config/dependency sanity
npm run test:engines # runs scripts/engineSmokeTest.ts against a LIVE backend (needs it running -
                      # see ../backend/README.md) - exercises the ported threshold/sensus engines
                      # (src/domain/*) with real master/threshold data and asserts against
                      # SPEC.md's worked examples (e.g. UPDKS 6.5 ekor/pelepah -> BERAT, Rayap's
                      # ambang ekonomi 0% override, real GeoJSON point-in-polygon). This is how the
                      # engine logic in this app was verified to behave identically to the backend
                      # without an Android emulator available in this environment.
```

## 2. Configuring `EXPO_PUBLIC_API_URL`

The backend URL is read from the `EXPO_PUBLIC_API_URL` environment variable at bundle time (Expo's
[`EXPO_PUBLIC_` convention](https://docs.expo.dev/guides/environment-variables/) - see
`src/config.ts`). Put it in `mobile/.env` (copy `.env.example`):

```
EXPO_PUBLIC_API_URL=http://192.168.1.23:4000/api
```

**This must NOT be `localhost` when testing on a real device or emulator.** `localhost` on the
phone/emulator refers to the phone/emulator itself, not your development machine running the
backend. Use instead:

| Where the app runs | What to put in `EXPO_PUBLIC_API_URL` |
|---|---|
| Android emulator (AVD) on the same machine as the backend | `http://10.0.2.2:4000/api` (the emulator's special alias for the host machine) |
| Physical Android phone via Expo Go, backend on your dev machine | `http://<your-machine-LAN-IP>:4000/api`, e.g. `http://192.168.1.23:4000/api`. Find your LAN IP with `ipconfig getifaddr en0` (macOS), `hostname -I` (Linux), or `ipconfig` (Windows, look for IPv4 Address). Phone and dev machine must be on the **same Wi-Fi network**. |
| Backend deployed somewhere reachable (staging server, tunnel, etc.) | that server's URL, e.g. `https://ews-api.example.com/api` |

After changing `.env`, restart `expo start` (env vars are baked in at bundle build time, not
hot-reloaded).

Start the backend first (`cd ../backend && npm install && npm run seed && npm start`) - see
`../backend/README.md`.

## 3. Demo login credentials

Password for every seeded account is **`password123`**. For testing the mobile field flows, use a
`PETUGAS_DETEKSI` / `PETUGAS_SENSUS` / `PETUGAS_PENGENDALIAN` account (the Login screen pre-fills
`deteksi@ews.local` as a starting point):

| Email | Role |
|---|---|
| deteksi@ews.local | Petugas Deteksi |
| sensus@ews.local | Petugas Sensus |
| pengendalian@ews.local | Petugas Pengendalian |
| admin@ews.local / rnd@ews.local / manager@ews.local / askep@ews.local | office/monitoring roles (mobile app still works, but field-record CREATE routes are restricted server-side to the petugas roles + ADMIN) |

Login is **online-only** the first time (SPEC.md: "online-only pertama kali, session/token
tersimpan aman untuk pemakaian offline berikutnya"). After a successful login the access+refresh
JWTs (in `expo-secure-store`) and the user profile (in SQLite) let the app reopen fully offline on
every subsequent launch - the Login screen is only shown again if there is no cached session, or if
the refresh token itself is later rejected by the server (expired/revoked).

**First-run flow**: Login -> go to the **Sinkronisasi** tab -> tap **"Sinkronkan Sekarang"** (or
"Hanya unduh data master") once while online to populate Estate/Afdeling/Blok/HPT/Species/
Threshold/Knowledge Base/Jadwal locally. Every other screen depends on this local cache and will
show empty pickers until it's run at least once.

## 4. Feature checklist (SPEC.md section 6 -> screens/files)

| SPEC.md section 6 item | Implementation |
|---|---|
| Local SQLite schema (master + field records + sync envelope) | `src/db/schema.ts`, `src/db/database.ts` |
| Login (online-only first time, secure offline session) | `src/screens/LoginScreen.tsx`, `src/state/AuthContext.tsx`, `src/api/tokenStore.ts` |
| Header connection status (🟢/🟠/🔴) | `src/components/ConnectionPill.tsx` (rendered by `ScreenContainer` on every screen), driven by `src/state/NetContext.tsx` + `src/state/SyncContext.tsx` |
| Download data offline + "Sinkronisasi terakhir" | `src/screens/SyncCenterScreen.tsx`, `src/sync/engine.ts` (`downloadAll`) |
| Home / Dashboard Mobile | `src/screens/HomeScreen.tsx` |
| Modul Deteksi (3 pertanyaan dasar, threshold check) | `src/screens/DeteksiFormScreen.tsx` |
| GPS out-of-area warning | `src/components/OutOfAreaModal.tsx`, `src/domain/geo.ts` (real point-in-polygon against `blok.referensi_polygon`, not just proximity - see limitations) |
| Modul Sensus - engine picker | `src/screens/SensusMenuScreen.tsx` |
| Sensus UPDKS | `src/screens/sensus/SensusUPDKSScreen.tsx` |
| Sensus Tikus | `src/screens/sensus/SensusTikusScreen.tsx` |
| Sensus Oryctes | `src/screens/sensus/SensusOryctesScreen.tsx` |
| Sensus Rayap (grid, ambang ekonomi 0%) | `src/screens/sensus/SensusRayapScreen.tsx` |
| Sensus Ganoderma (kualitatif) | `src/screens/sensus/SensusGanodermaScreen.tsx` |
| `generateBarisSampel` / `generateGrid` (parameterized, not hard-coded) | `src/domain/sensusEngines.ts` |
| Threshold/incident classification engine (client mirror) | `src/domain/thresholdEngine.ts` |
| Modul Pengendalian | `src/screens/PengendalianFormScreen.tsx` |
| Sensus Mortalitas (+ efficacy/"perlu service" hint) | `src/screens/MortalitasFormScreen.tsx`, `src/domain/mortalityEval.ts` |
| Local WARNING / 🔴 ALERT HPT flag | `src/components/KategoriBadge.tsx`, `ews_alert_lokal` column on every field-record table |
| Sinkronisasi / Sync Center | `src/screens/SyncCenterScreen.tsx`, `src/sync/engine.ts`, `src/sync/payloads.ts` |
| Knowledge Base offline viewer (Panduan) | `src/screens/PanduanListScreen.tsx`, `src/screens/PanduanDetailScreen.tsx` |
| Riwayat (filterable, sync status per item) | `src/screens/RiwayatScreen.tsx`, `src/screens/RiwayatDetailScreen.tsx`, `src/db/repo/riwayatRepo.ts` |
| Photo capture + compression | `src/domain/photo.ts` (`expo-image-picker` -> `expo-image-manipulator` resize+JPEG compress -> copied into permanent app storage before any DB row references it) |
| One-shot (non-continuous) GPS | `src/domain/gpsCapture.ts` (`expo-location` `getCurrentPositionAsync`, never `watchPositionAsync`) |
| Reliability: SQLite transactions | `src/db/database.ts` (`withTransaction`), used by every master-data replace + implicitly per-statement by every field-record insert; nothing is held only in React state before being committed to SQLite |

## 5. Architecture notes

### Local SQLite schema

`src/db/schema.ts` mirrors the backend's read-only reference tables (`estates`, `afdelings`,
`bloks`, `hpt`, `species`, `thresholds`, `knowledge_base`, `schedules`, plus a bonus
`cached_incidents` table - see below) and four field-record tables (`detections`, `sensus`,
`treatments`, `mortalities`) that each carry the full BRD 01 section 8 sync envelope: `local_id`
(primary key, a UUID), `server_id`, `server_row_id` (see next paragraph), `activity_id`,
`incident_id`, `user_id`, `device_id`, `created_at`, `updated_at`, `sync_status` (`DRAFT` /
`READY_TO_SYNC` / `SYNCING` / `SYNCED` / `FAILED`), `sync_attempt`, `sync_error`, `source`
(always `'MOBILE'` here).

**`server_row_id` addition**: the backend's field-record tables have both a `server_id` (a UUID
assigned by the ingestion service) *and* an integer primary key `id`. The batch sync response
(`POST /api/sync/upload/*`) echoes both back per item. Photo upload
(`POST /api/sync/upload/foto`) needs the **integer** id as `entity_id` to link a photo to its
parent record server-side (`UPDATE detection SET foto_id=? WHERE id=?`). So each local table has an
extra `server_row_id INTEGER` column (not part of the BRD's literal envelope list, but necessary
plumbing for the photo-linking flow to work at all) - see `src/sync/engine.ts`'s `uploadPhotos()`.

### Threshold/sensus engine parity with the backend

`src/domain/thresholdEngine.ts` and `src/domain/sensusEngines.ts` are deliberate line-by-line ports
of `backend/src/services/thresholdEngine.js` and `backend/src/services/sensusEngines.js`
(`classify()`, `getActiveThresholds()`, `generateBarisSampel()`, `generateGrid()`,
`computeUPDKS/Tikus/Oryctes/Rayap/Ganoderma()`), verified against that source directly. Sampling
plans are always generated from the selected Blok's `parameter_sampling_json` - nothing is
hard-coded. The client-side engine only **classifies** (for instant field feedback); it never
creates Incidents/Alerts/Notifications - those remain server-authoritative and are (re)computed the
moment a record syncs, exactly matching backend behaviour bit-for-bit since the same threshold rows
and the same formulas are used on both sides.

### Sync engine

`src/sync/engine.ts` has two independent halves:

- `downloadAll()` - pulls Estate/Afdeling/Blok/HPT/Species (`/sync/master`), Threshold
  (`/sync/threshold`), Knowledge Base (`/sync/knowledge-base`), Jadwal (`/sync/jadwal`), and (as a
  bonus, beyond the BRD's literal list) currently-open Incidents (`/incidents`) so Pengendalian/
  Mortalitas can link `incident_id` even while offline afterwards. Each dataset replace runs inside
  a SQLite transaction (`db/repo/masterRepo.ts`, `db/repo/kbRepo.ts`).
- `uploadAll()` - uploads every `READY_TO_SYNC`/`FAILED` Deteksi, then Sensus, then Treatment, then
  Mortalitas, in that order, batched (`SYNC_BATCH_SIZE` = 20 per request), then uploads any photo
  whose parent record now has a `server_row_id`. **Mortalitas dependency resolution**: a Mortalitas
  record referencing a Treatment via `treatment_local_id` can only be sent once that Treatment has
  actually synced (the backend needs the Treatment's real integer id) - if it hasn't yet, the
  Mortalitas item is left `READY_TO_SYNC` with a `sync_error` note ("Menunggu data Treatment
  tersinkron") and is retried automatically on the next sync run, without being flagged `FAILED`
  or counted against retry limits.
- Every batch failure (network drop mid-request) reverts just-`SYNCING` items in that batch back to
  `FAILED` so nothing is stuck; a fresh sync run always picks up `READY_TO_SYNC` **and** `FAILED`
  rows, which is the "retry" mechanism (see "Known limitations" re: backoff).
- The **Sync Center** screen (`SyncCenterScreen.tsx`) shows the "N data belum terkirim - Deteksi X,
  Sensus Y, ..." summary, per-item status list, and the "Sinkronkan Sekarang" button; it's disabled
  automatically when offline via `useNet()`.

### Reliability (BRD non-functional requirement)

Every write to SQLite happens through a normal parameterized statement or, for multi-row master
data replaces, inside `db/database.ts`'s `withTransaction()` wrapper (`db.withTransactionAsync`).
Field records are written directly to SQLite the moment "Simpan" is pressed - **not** held only in
React state - so an app kill, device reboot, or lost connection immediately afterwards cannot lose
data; the worst case is a record stuck at `READY_TO_SYNC`, which the next sync run picks up
automatically.

## 6. Backend contract notes (verified directly against `../backend/src`)

- Payload shapes (`src/sync/payloads.ts`) were built by reading
  `backend/src/services/ingestion.js`'s `ingestDetection/ingestSensus/ingestTreatment/
  ingestMortality` directly, not just the README - e.g. Sensus's `jalur_baris` is sent as a
  parsed array/object (`JSON.stringify`'d server-side), not a JSON string; `hasil_json` can be sent
  as an object.
- The batch upload response (`POST /api/sync/upload/*`) does **not** include the server-created
  `incident_id` per item (only `local_id`/`server_id`/`id`/`status`) even though the ingestion
  service computes one. To let Pengendalian/Mortalitas reference the right incident later while
  offline, the mobile app does a best-effort follow-up `GET /api/detections/:id` or
  `GET /api/sensus/:id` right after a successful sync of that item, to read back `incident_id`
  (see `fetchRecordDetail` in `src/api/sync.ts` and its use in `src/sync/engine.ts`). This is
  non-blocking and never fails the sync run if it errors.
- There is no dedicated "metode pengendalian" master data table/endpoint in the backend (Treatment
  stores `metode_pengendalian` as free text). `PengendalianFormScreen.tsx` uses a fixed option list
  taken from the BRD's own examples (drone spraying / fogging / manual / racun tikus / lainnya)
  with an free-text "Lainnya" fallback, rather than pulling from a non-existent master endpoint.
- `GET /api/incidents` (used to cache open incidents for offline linking) is not technically part
  of the documented Mobile Sync API (`/api/sync/*`), but is reachable by any authenticated role, so
  it was used as a convenience addition - clearly marked as such in `src/sync/engine.ts`.
- Everything else (`/api/sync/master`, `/threshold`, `/knowledge-base`, `/jadwal`, the four
  `/upload/*` batch endpoints, `/upload/foto`, `/status`) matches the README's documented shapes
  exactly, confirmed with live `curl` calls against the running backend during development
  (login, `/sync/master`, `/sync/threshold`, `/sync/knowledge-base`, `/sync/jadwal`).
- No gaps were found that block any SPEC.md section 6 requirement - the notes above are all things
  the mobile app worked around/extended, not missing backend functionality.

## 7. Known limitations

- **No Android emulator/device in this sandbox.** This app was built and statically verified
  (`npm run typecheck` - clean; `npm run doctor` - 19/21 checks pass, the 2 failures are
  network calls to Expo's remote services blocked by this sandbox's egress policy, not project
  issues; the SDK-version-compatibility check that runs *locally* passed) but was never actually
  run on a device/emulator or visually inspected. Every native API used (`expo-sqlite`,
  `expo-location`, `expo-image-picker`, `expo-image-manipulator`, `expo-file-system`,
  `expo-secure-store`, `expo-crypto`) was implemented against the exact SDK 57 API reference
  fetched from `docs.expo.dev` during development (not from possibly-stale training knowledge), but
  a first real run on hardware is still recommended before field deployment.
- **Blok boundary check** (`src/domain/geo.ts`): the seeded backend's `blok.referensi_polygon` is
  an actual GeoJSON `Polygon`, so this is implemented as a genuine point-in-polygon check (a direct
  port of the backend's own ray-casting algorithm in `geo.js`), not merely a proximity heuristic.
  It degrades gracefully to "cannot determine, don't warn" for any Blok without a cached polygon.
- **Rayap/Ganoderma "foto/GPS per point"**: implemented as truly per-point capture (each grid
  point / pokok entry has its own optional 📷/📍 buttons), but the *session-level* GPS (captured
  once when the form opens) is used as a fallback for the out-of-area check and for any point the
  officer didn't individually re-capture, to avoid forcing dozens of GPS fixes per sensus round.
- **Ganoderma sampling**: the backend's `metode_sensus` for Ganoderma is `SELURUH_POKOK`, which
  `buildSamplingPlan()` deliberately returns as "no generated point list" (every tree is meant to be
  inspected, not sampled). The screen therefore uses a manual "+ Tambah pokok" add-as-you-go list
  rather than a pre-generated grid, and reports the **worst** status found in the session as the
  record's overall classification (documented in the file's header comment).
- **"Ulat hidup" definition for UPDKS**: SPEC.md says "hitung ulat hidup per pelepah" without
  enumerating exactly which larval-stage columns count as "hidup". This app defines it as
  `ulat_kecil + ulat_sedang + ulat_besar` (excluding telur/eggs, kepompong/pupae, and ulat_mati/dead
  ones), which is the standard field definition and matches the backend's generic
  `computeUPDKS({ulat_hidup_total, jumlah_pelepah_diamati})` contract.
- **PDF/DOC/XLS Knowledge Base rendering**: intentionally not implemented in-app (explicitly called
  out as optional/nice-to-have in the task brief). `PanduanDetailScreen.tsx` shows full metadata and
  an "Open / download file" button that hands off to the OS via `Linking.openURL` when online.
  Text/markdown entries (`text/plain`, `text/markdown`) *are* fully cached and rendered offline as
  plain text (no rich Markdown formatting/parsing - headings/bold/etc. render as raw `#`/`**`
  characters).
- **Sync retry has no exponential backoff timer.** Sync only ever runs when the user taps
  "Sinkronkan Sekarang" (or "Hanya unduh data master") - there's no background service in this app,
  so a literal timed backoff wouldn't do much. Instead, every sync run automatically retries all
  `FAILED` items alongside new `READY_TO_SYNC` ones (see `src/sync/engine.ts`), and `sync_attempt`
  is tracked per record so a future background-sync feature could add real backoff without a schema
  change.
- **Metode Pengendalian options are a fixed list**, not sourced from a backend master table - see
  section 6 above (no such table exists in the current backend).
- No push notifications are implemented (the backend's `/sync/push-register` is itself documented
  as a stub with no real FCM/APNs wiring), and Sensus Mortalitas cannot reference a Treatment that
  hasn't synced yet by design (see "Mortalitas dependency resolution" above) - this is a deliberate
  data-integrity choice, not a bug.

## 8. Project layout

```
mobile/
  App.tsx                    entry: DB init -> Net/Auth/Sync providers -> RootNavigator
  src/
    api/                      axios client (token refresh interceptor), auth, sync, knowledge-base
    config.ts                 EXPO_PUBLIC_API_URL and tunables
    types.ts                  shared domain types (mirrors backend/src/db/schema.sql)
    db/
      schema.ts, database.ts   SQLite schema + connection/transaction helpers
      repo/                    one repo module per table/concern
    domain/                    thresholdEngine, sensusEngines, geo, photo, gpsCapture, mortalityEval
    sync/                      engine.ts (download/upload orchestration), payloads.ts (backend shapes)
    state/                     AuthContext, NetContext, SyncContext (React contexts)
    hooks/                     useMasterData.ts (cached-master-data hooks for pickers)
    components/                shared UI: ConnectionPill, FormField, SelectField, GpsField,
                                PhotoField, OutOfAreaModal, KategoriBadge, LocationCascade, ...
    navigation/                RootNavigator (stack) + MainTabs (bottom tabs) + route types
    screens/                   one file per screen (see feature checklist above)
```
