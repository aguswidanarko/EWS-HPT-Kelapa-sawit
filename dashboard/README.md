# EWS HPT — Web Dashboard

React + Vite web dashboard for the oil palm pest/disease Early Warning System (EWS HPT). This is
one of three components in the monorepo — see `../docs/SPEC.md` for the full specification and
`../backend/README.md` for the REST API this dashboard talks to.

- **Stack**: React 19 + Vite + React Router 7 + Leaflet (`react-leaflet`) + Recharts + Axios
- **Module system**: plain JavaScript (JSX), no TypeScript
- **Backend**: expects the EWS HPT backend (`../backend`) running and reachable at `VITE_API_URL`

## 1. Install & run

```bash
cd dashboard
npm install
npm run dev        # http://localhost:5173, hot-reload dev server
# or
npm run build       # production build -> dist/
npm run preview     # serve the production build locally
```

The backend must be running first (from `../backend`):

```bash
cd ../backend
npm install
npm run seed        # only needed once / to reset demo data
npm start            # http://localhost:4000
```

## 2. Environment variables

| Var | Default | Purpose |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000/api` | Base URL of the backend REST API |

Copy `.env.example` to `.env` and adjust if the backend runs elsewhere. A `.env` with the default
value is already included so the app works out of the box against a locally-running backend.

## 3. Demo login credentials

Every seeded account uses password **`password123`** (see `../backend/README.md` section 2 for
the full list — also shown directly on the Login screen of this app):

| Email | Role |
|---|---|
| admin@ews.local | Administrator |
| rnd@ews.local | R&D / FOD |
| manager@ews.local | Manager |
| askep@ews.local | Askep / Asisten |
| deteksi@ews.local | Petugas Deteksi |
| sensus@ews.local | Petugas Sensus |
| pengendalian@ews.local | Petugas Pengendalian |

## 4. Auth & RBAC

- JWT access + refresh tokens are stored in `localStorage` (`ews_access_token`,
  `ews_refresh_token`, `ews_user`). An axios response interceptor (`src/api/client.js`) transparently
  refreshes an expired access token once via `POST /api/auth/refresh`, and logs the user out (redirect
  to `/login`) if the refresh also fails.
- `src/context/AuthContext.jsx` exposes role-check helpers (`isAdmin`, `canWriteMaster`,
  `canWriteMasterHptThreshold`, `canChangeAlertStatus`, `canImport`, `canManageUsers`,
  `canManageKb`, `canManageNotificationRules`, `canViewAuditLog`, …) mirroring the backend's RBAC
  rules (see backend README section 10, "Auth" column). The UI uses these to hide/disable
  admin-only actions (e.g. Master Data write buttons, Import Data page, Audit Log page) — the
  backend independently re-enforces every one of these with `requireRole(...)` middleware, so the
  frontend checks are a UX convenience, not the security boundary.
- `src/context/MasterDataContext.jsx` loads Estate/Afdeling/Blok/HPT/Species/Users once after
  login and exposes `id -> name` lookup helpers, since most field-data list endpoints
  (Deteksi/Sensus/Treatment/Mortality) return raw foreign keys without joined names.

## 5. SPEC.md §7 menu → route map

All 17 items from SPEC.md section 7 ("Modul Dashboard") are implemented. Sidebar grouping is
cosmetic; the table below is the authoritative mapping back to the spec's menu list.

| # | SPEC.md menu | Route | File |
|---|---|---|---|
| 1 | Login | `/login` | `src/pages/Login.jsx` |
| 2 | Dashboard Utama | `/` | `src/pages/DashboardUtama.jsx` |
| 3 | Peta EWS | `/peta` | `src/pages/PetaEWS.jsx` |
| 4 | Deteksi | `/deteksi` | `src/pages/Deteksi.jsx` |
| 5 | Sensus | `/sensus` | `src/pages/Sensus.jsx` |
| 6 | Pengendalian | `/pengendalian` | `src/pages/Pengendalian.jsx` |
| 7 | Mortalitas | `/mortalitas` | `src/pages/Mortalitas.jsx` |
| 8 | EWS Alert Center | `/alerts`, `/alerts/:id` | `src/pages/AlertCenter.jsx`, `AlertDetail.jsx` |
| 9 | Incident Management | `/incidents`, `/incidents/:id` | `src/pages/IncidentManagement.jsx`, `IncidentDetail.jsx` |
| 10 | Knowledge Base | `/knowledge-base` | `src/pages/KnowledgeBase.jsx` |
| 11 | Import Data | `/import` | `src/pages/ImportData.jsx` (mode tabs: flat Deteksi/Sensus/Pengendalian/Mortalitas templates, and `src/pages/ImportPisp1.jsx` — "Import Rekap Bulanan (Format PISP1)" for the real pivot-per-Blok recap workbook, `POST /api/import/pisp1/preview` + `/commit`, see `../backend/README.md`) |
| 12 | Master Data | `/master` | `src/pages/MasterData.jsx` (tabs: Estate/Afdeling/Blok/HPT/Species/Threshold) |
| 13 | PIC / User | `/pic-user` | `src/pages/PicUser.jsx` (tabs: Users / PIC Assignment) |
| 14 | Notification | `/notification` | `src/pages/Notification.jsx` (tabs: Rules / Log) |
| 15 | Report | `/report` | `src/pages/Report.jsx` |
| 16 | Audit Log | `/audit-log` | `src/pages/AuditLog.jsx` |
| 17 | System Settings | `/settings` | `src/pages/SystemSettings.jsx` (notification provider info, backup instructions, Data Quality Dashboard + Sync Monitoring summaries) |

Notes on scope decisions:

- **Data Quality Dashboard** and **Monitoring Synchronization** (SPEC.md §7) are surfaced inside
  **System Settings** rather than as separate top-level menu items, since SPEC.md's explicit list
  of "16 menu utama" does not name them individually and they are secondary/monitoring-only views.
- **Deteksi / Sensus / Pengendalian / Mortalitas** are list + filter + detail-view screens only (no
  create form) — SPEC.md §7 describes these as list/table/detail screens for the dashboard; data
  entry for these is the mobile app's job per SPEC.md §6, and Import Data covers bulk web-side
  entry.
- **Heatmap** (Peta EWS) and **Trend chart** (Report) are implemented per SPEC.md §8 Phase 3 scope
  ("dibangun sekarang" for Phase 1/2, Phase 3 items may be lighter — here both are functional, not
  just stubs, since the backend fully supports `/api/gis/heatmap` and `/api/reports/trend`).
- **PDF export** is not implemented on the Report page, matching the backend (`../backend/README.md`
  §10: "PDF export was intentionally not built for v1... Excel/CSV export is fully implemented").

## 6. How data flows / key implementation notes

- `src/api/client.js` — axios instance, attaches `Authorization: Bearer <token>`, auto-refreshes
  on 401.
- `src/api/resources.js` — one function group per backend resource (`authApi`, `dashboardApi`,
  `alertsApi`, `incidentsApi`, `gisApi`, `detectionsApi`, `sensusApi`, `treatmentApi`,
  `mortalityApi`, `photosApi`, `masterApi`, `kbApi`, `usersApi`, `scheduleApi`, `importApi`,
  `reportsApi`, `dataQualityApi`, `syncMonitoringApi`, `notificationRulesApi`, `auditLogApi`) —
  every function shape was verified against `../backend/README.md`'s route table and by curling
  the live backend (see summary in the delivery notes / commit message).
- File downloads (Knowledge Base file, Import template, Report export) all go through an
  authenticated `axios` GET with `responseType: 'blob'` rather than a plain `<a href>`, because
  those backend routes require a Bearer token that a bare browser link can't attach.
- `src/components/MasterCrud.jsx` — a generic table+modal-form CRUD component reused by every
  Master Data tab (Estate/Afdeling/Blok/HPT/Species/Threshold), PIC Assignment, and Notification
  Rules, since all of those map directly onto the backend's generic `crud(table, {...})` route
  factory (`../backend/src/routes/masterData.js`).
- `src/components/IncidentTimeline.jsx` — renders the `timeline` array returned by
  `GET /api/incidents/:id` (Deteksi → Warning/Alert → Sensus → Treatment → Mortalitas), reused by
  both the Alert Detail page and the Incident Detail page.
- Severity colors (`NORMAL`/`RINGAN`/`SEDANG`/`BERAT`/`CRITICAL` → green/yellow/orange/red/dark-red)
  are centralized in `src/utils/format.js` (`SEVERITY_COLORS`) and used consistently across KPI
  cards, the Peta EWS map/legend, and the Alert Center cards.

## 7. Backend gaps found while building this dashboard

None that blocked implementation. Two small clarifications worth noting for future reconciliation:

- Field-data list endpoints (`/api/detections`, `/api/sensus`, `/api/treatment`, `/api/mortality`)
  return raw rows without joined names (estate/afdeling/blok/HPT/user names) — this dashboard
  compensates client-side via `MasterDataContext`'s lookup maps rather than requiring a backend
  change, since the raw-row shape is reasonable for a REST list endpoint and matches what mobile
  sync also consumes.
- `GET /api/knowledge-base/:id/file` and `GET /api/import/template/:entity` and every
  `/api/reports/*?format=csv|xlsx` endpoint require the JWT bearer header (they're behind
  `requireAuth`), so they can't be linked to directly with a plain `<a href>` — this dashboard
  fetches them via authenticated `axios` blob requests and triggers the save client-side instead.
  Not a bug, just worth knowing if a future change wants plain download links.

## 8. Build verification performed

```bash
npm install     # clean install, no peer-dependency conflicts
npm run build   # vite build — succeeds, zero errors (one informational chunk-size warning)
npx oxlint src  # zero errors; ~40 stylistic warnings (react-hooks exhaustive-deps, fast-refresh
                # export shape) — none block build or indicate a runtime bug
npm run dev     # dev server boots cleanly; every page module transforms without error;
                # manually traced each page's fetch calls against live backend responses
                # (see section 7)
```
