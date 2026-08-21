import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSync } from '../state/SyncContext';
import { colors } from '../theme';

/** SPEC.md "Header status koneksi": 🟢 Online / 🟠 Sinkronisasi / 🔴 Offline - a small persistent
 * banner/pill shown app-wide, driven by NetInfo + current sync state. */
export default function ConnectionPill() {
  const { pillStatus, pendingTotal } = useSync();

  const config = {
    ONLINE: { emoji: '🟢', label: 'Online', color: colors.online },
    SYNCING: { emoji: '🟠', label: 'Sinkronisasi...', color: colors.syncing },
    OFFLINE: { emoji: '🔴', label: 'Offline', color: colors.offline },
  }[pillStatus];

  return (
    <View style={[styles.pill, { borderColor: config.color }]}>
      <Text style={styles.emoji}>{config.emoji}</Text>
      <Text style={[styles.label, { color: config.color }]}>{config.label}</Text>
      {pendingTotal > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pendingTotal} belum sinkron</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  emoji: { fontSize: 12, marginRight: 4 },
  label: { fontSize: 12, fontWeight: '700' },
  badge: { marginLeft: 8, backgroundColor: '#FFF1E0', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  badgeText: { fontSize: 10, color: '#8A5A15', fontWeight: '600' },
});
