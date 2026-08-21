import * as SecureStore from 'expo-secure-store';
import { uuid } from './uuid';

const DEVICE_ID_KEY = 'ews_device_id';
let cachedDeviceId: string | null = null;

/** A stable per-install device identifier, persisted in SecureStore, used for sync attribution
 * (SYNC_LOG.device_id, X-Device-Id header) and audit trail (device_source). */
export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = `android-${uuid()}`;
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  cachedDeviceId = id;
  return id;
}
