import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { severityColor } from '../theme';

/** SPEC.md "Warning di mobile": 🔴 ALERT HPT when local classification crosses into
 * non-NORMAL territory. Shown right after a Deteksi/Sensus computation and again in Riwayat. */
export default function KategoriBadge({ kategori, alert }: { kategori: string | null; alert: boolean }) {
  if (!kategori) return null;
  const color = severityColor[kategori] || '#999';
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1A` }]}>
      {alert ? <Text style={styles.emoji}>🔴</Text> : null}
      <Text style={[styles.text, { color }]}>{alert ? `ALERT HPT - ${kategori}` : kategori}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginVertical: 6,
  },
  emoji: { marginRight: 4 },
  text: { fontWeight: '700', fontSize: 13 },
});
