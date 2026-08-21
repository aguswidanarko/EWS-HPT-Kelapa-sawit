// One-shot GPS capture (SPEC.md section 6 "GPS tidak boleh aktif terus-menerus - aktifkan hanya
// saat form dibuka/submit"). No watchPositionAsync/background location anywhere in this app -
// every capture is a single getCurrentPositionAsync call triggered explicitly by the user.

import * as Location from 'expo-location';
import { GPS_CAPTURE_TIMEOUT_MS } from '../config';
import type { GpsCapture } from '../types';

export type GpsResult = { ok: true; data: GpsCapture } | { ok: false; error: string };

export async function captureGps(): Promise<GpsResult> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') {
      return { ok: false, error: 'Izin lokasi ditolak. GPS wajib untuk mencatat titik kegiatan.' };
    }
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Waktu tunggu GPS habis')), GPS_CAPTURE_TIMEOUT_MS)),
    ]);
    return {
      ok: true,
      data: {
        gps_lat: position.coords.latitude,
        gps_lng: position.coords.longitude,
        gps_accuracy: position.coords.accuracy,
        gps_timestamp: new Date(position.timestamp).toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Gagal mengambil lokasi GPS' };
  }
}

export const EMPTY_GPS: GpsCapture = { gps_lat: null, gps_lng: null, gps_accuracy: null, gps_timestamp: null };
