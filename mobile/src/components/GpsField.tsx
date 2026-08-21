import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { captureGps } from '../domain/gpsCapture';
import type { GpsCapture } from '../types';
import { colors, spacing } from '../theme';

interface Props {
  value: GpsCapture;
  onChange: (v: GpsCapture) => void;
  /** Called right after a successful capture, with the fresh coordinates - used by forms to run
   * the out-of-blok-boundary check immediately (SPEC.md "GPS": capture on submit/open, not
   * continuously). */
  onCaptured?: (v: GpsCapture) => void;
}

/** One-shot GPS capture button - never subscribes to continuous location updates (battery-saving
 * requirement in SPEC.md section 6). */
export default function GpsField({ value, onChange, onCaptured }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const capture = async () => {
    setBusy(true);
    setError(null);
    const result = await captureGps();
    setBusy(false);
    if (result.ok) {
      onChange(result.data);
      onCaptured?.(result.data);
    } else {
      setError(result.error);
    }
  };

  const hasFix = value.gps_lat !== null && value.gps_lng !== null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Lokasi GPS</Text>
      {hasFix ? (
        <View style={styles.fixBox}>
          <Text style={styles.fixText}>
            {value.gps_lat?.toFixed(6)}, {value.gps_lng?.toFixed(6)}
          </Text>
          <Text style={styles.fixSub}>
            Akurasi ±{value.gps_accuracy ? Math.round(value.gps_accuracy) : '?'} m
          </Text>
        </View>
      ) : null}
      <TouchableOpacity style={styles.btn} onPress={capture} disabled={busy}>
        {busy ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.btnText}>{hasFix ? '📍 Ambil ulang lokasi' : '📍 Ambil lokasi GPS'}</Text>}
      </TouchableOpacity>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  fixBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginBottom: 8 },
  fixText: { fontWeight: '700', color: colors.primaryDark },
  fixSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  btn: { borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  btnText: { color: colors.primaryDark, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 12, marginTop: 6 },
});
