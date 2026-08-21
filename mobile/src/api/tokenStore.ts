import * as SecureStore from 'expo-secure-store';

const ACCESS_KEY = 'ews_access_token';
const REFRESH_KEY = 'ews_refresh_token';

/** JWT access+refresh tokens live in expo-secure-store (Android Keystore-backed), never in
 * SQLite/AsyncStorage, per BRD 01 section 9 "session aman dipakai offline" + non-functional
 * "secure local storage" requirement. The synced user PROFILE (non-secret) is cached in SQLite
 * instead - see db/repo/sessionRepo.ts - so role/estate/hak_akses gating works fully offline. */
export async function setTokens(access_token: string, refresh_token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access_token);
  await SecureStore.setItemAsync(REFRESH_KEY, refresh_token);
}

export async function setAccessToken(access_token: string): Promise<void> {
  await SecureStore.setItemAsync(ACCESS_KEY, access_token);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_KEY);
}

export async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_KEY);
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCESS_KEY);
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}
