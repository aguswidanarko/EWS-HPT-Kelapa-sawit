import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSync } from '../state/SyncContext';
import { colors } from '../theme';

/** BRD EWS HPT V3.2.1 section 10 (Mobile Connectivity Status): the pill now reflects actual
 * backend reachability (GET /health via NetContext), not just device network state - see
 * SyncContext.tsx's pillStatus derivation. Labels/emoji match section 10.1-10.3 and section 13's
 * Sync Center mock-up exactly ("🔴 OFFLINE", "🟠 SERVER TIDAK TERHUBUNG", "🟢 SERVER TERHUBUNG"). */
export default function ConnectionPill() {
  const { pillStatus, pendingTotal } = useSync();

  const config = {
    OFFLINE: { emoji: '🔴', label: 'Offline', color: colors.offline },
    CHECKING: { emoji: '⚪', label: 'Memeriksa server...', color: colors.textMuted },
    SERVER_UNREACHABLE: { emoji: '🟠', label: 'Server Tidak Terhubung', color: colors.syncing },
    SYNCING: { emoji: '🟠', label: 'Sinkronisasi...', color: colors.syncing },
    SERVER_CONNECTED: { emoji: '🟢', label: 'Server Terhubung', color: colors.online },
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
