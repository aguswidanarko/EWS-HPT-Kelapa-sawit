/**
 * App-wide configuration.
 *
 * EXPO_PUBLIC_API_URL is baked into the JS bundle at build/start time (Expo's `EXPO_PUBLIC_`
 * env var convention - see https://docs.expo.dev/guides/environment-variables/). BRD EWS HPT
 * V3.2.1 section 3/4.1: Mobile talks to the Nginx gateway (e.g.
 * https://ews-hpt-dashboard.first-resources.com/api), never straight to the backend's :4000 - the
 * reverse proxy is what makes that origin reachable in the first place. On a real Android
 * device/emulator this also MUST be a real, resolvable hostname/IP, never `localhost` - see
 * README.md for details.
 *
 * MUST be `https://`, not `http://`: this host is now fronted by Cloudflare on the public
 * internet, which redirects plain HTTP to HTTPS. A browser follows that redirect transparently,
 * but the app's networking stack does not reliably re-send a POST body across it - login would
 * intermittently fail with a bare network error instead of a clear "wrong password". Requesting
 * https:// directly avoids depending on that redirect at all.
 *
 * normalizeApiBaseUrl guards against the two malformed shapes BRD section 9 calls out
 * (`/api/api` from a value that already ends in `/api` plus an accidental extra one, and `//api`
 * from a stray slash) so a slightly-off EXPO_PUBLIC_API_URL doesn't silently 404 every request.
 */
export function normalizeApiBaseUrl(raw: string | undefined): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  // Split off "http(s)://" before collapsing slashes, so we never touch the "//" that's supposed
  // to be there - e.g. "http://host//api/api" -> protocol "http://", rest "host/api".
  const match = trimmed.match(/^(https?:\/\/)(.*)$/i);
  const protocol = match ? match[1] : '';
  let rest = (match ? match[2] : trimmed).replace(/\/{2,}/g, '/');
  // Collapse a duplicated /api/api.../api suffix down to a single /api (BRD section 9).
  rest = rest.replace(/(\/api)+$/i, '');
  return `${protocol}${rest}/api`;
}

/** BRD EWS HPT V3.2.1 section 28 (Environment Management): production now runs against the
 * internet-facing dashboard/gateway host (https://ews-hpt-dashboard.first-resources.com,
 * Cloudflare-fronted) - so the fallback below matches EXPO_PUBLIC_API_URL's expected value rather
 * than `localhost`, which BRD section 4.1 explicitly says not to rely on (on a real Android
 * device `localhost` resolves to the device itself, never the server). Still fully overridable
 * via EXPO_PUBLIC_API_URL for anyone who does need a different target (e.g. a developer's own LAN
 * server or emulator host) - note a plain-HTTP LAN override only reaches this server directly
 * while on the office network (see README.md); it will not work once off-site since the LAN
 * origin has no TLS listener of its own.
 */
export const API_BASE_URL =
  normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_URL) || 'https://ews-hpt-dashboard.first-resources.com/api';

export const APP_NAME = 'EWS HPT Mobile';

/** How many items are sent per sync batch upload request. */
export const SYNC_BATCH_SIZE = 20;

/** Max automatic retry attempts for a failed sync item before giving up (still visible/retriable manually). */
export const SYNC_MAX_AUTO_RETRY = 5;

/** Photo compression target (see domain/photo.ts). */
export const PHOTO_MAX_DIMENSION = 1280;
export const PHOTO_COMPRESS_QUALITY = 0.6;

/** GPS accuracy option used only at the moment a form captures a point (never continuous tracking). */
export const GPS_CAPTURE_TIMEOUT_MS = 15000;
