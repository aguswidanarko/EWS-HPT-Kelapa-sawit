/**
 * App-wide configuration.
 *
 * EXPO_PUBLIC_API_URL is baked into the JS bundle at build/start time (Expo's `EXPO_PUBLIC_`
 * env var convention - see https://docs.expo.dev/guides/environment-variables/). On a real
 * Android device/emulator this MUST be the host machine's LAN IP (e.g. http://192.168.1.23:4000/api),
 * never `localhost` - see README.md for details.
 */
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, '') || 'http://localhost:4000/api';

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
