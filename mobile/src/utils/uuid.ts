import * as Crypto from 'expo-crypto';

/** Generates a v4 UUID, used for local_id/activity_id/device_id. */
export function uuid(): string {
  return Crypto.randomUUID();
}
