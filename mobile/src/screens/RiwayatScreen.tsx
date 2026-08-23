import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { getRiwayat, type RiwayatItem } from '../db/repo/riwayatRepo';
import { useSync } from '../state/SyncContext';
import { colors, severityColor, spacing } from '../theme';
import { formatDateTime } from '../utils/format';
import type { RootStackParamList } from '../navigation/types';

interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList>;
}

const KIND_FILTERS: { label: string; value: RiwayatItem['kind'] | null }[] = [
  { label: 'Semua', value: null },
  { label: 'Deteksi', value: 'DETEKSI' },
  { label: 'Sensus', value: 'SENSUS' },
  { label: 'Pengendalian', value: 'TREATMENT' },
  { label: 'Mortalitas', value: 'MORTALITAS' },
  { label: 'Partenocarpi', value: 'PARTENOCARPI' },
  { label: 'Water Mgmt', value: 'WATER_MANAGEMENT' },
  { label: 'Bahan Organik', value: 'BAHAN_ORGANIK' },
  { label: 'TBM Vegetatif', value: 'TBM_VEGETATIF' },
  { label: 'Defisiensi Hara', value: 'DEFISIENSI_HARA' },
  { label: 'Action Plan', value: 'ACTION_PLAN' },
];

const SYNC_META: Record<string, { emoji: string; label: string; color: string }> = {
  DRAFT: { emoji: '⚪', label: 'Draft', color: colors.textMuted },
  READY_TO_SYNC: { emoji: '⏳', label: 'Belum terkirim', color: colors.warning },
  SYNCING: { emoji: '🟠', label: 'Mengirim...', color: colors.warning },
  SYNCED: { emoji: '✅', label: 'Tersinkron', color: colors.success },
  FAILED: { emoji: '❌', label: 'Gagal', color: colors.danger },
};

/** SPEC.md "Riwayat": kegiatan hari ini & sebelumnya (deteksi/sensus/treatment/mortalitas) dengan
 * status sync per item, filterable. */
export default function RiwayatScreen({ navigation }: Props) {
  const { pendingTotal } = useSync();
  const [items, setItems] = useState<RiwayatItem[]>([]);
  const [kindFilter, setKindFilter] = useState<RiwayatItem['kind'] | null>(null);
  const [onlyPending, setOnlyPending] = useState(false);

  const load = useCallback(() => {
    getRiwayat().then(setItems);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (kindFilter && it.kind !== kindFilter) return false;
      if (onlyPending && !['READY_TO_SYNC', 'FAILED', 'SYNCING'].includes(it.sync_status)) return false;
      return true;
    });
  }, [items, kindFilter, onlyPending]);

  const kindToRoute = (kind: RiwayatItem['kind']): RootStackParamList['RiwayatDetail']['kind'] => {
    switch (kind) {
      case 'DETEKSI':
        return 'deteksi';
      case 'SENSUS':
        return 'sensus';
      case 'TREATMENT':
        return 'treatment';
      case 'PARTENOCARPI':
        return 'partenocarpi';
      case 'WATER_MANAGEMENT':
        return 'water_management';
      case 'BAHAN_ORGANIK':
        return 'bahan_organik';
      case 'TBM_VEGETATIF':
        return 'tbm_vegetatif';
      case 'DEFISIENSI_HARA':
        return 'defisiensi_hara';
      case 'ACTION_PLAN':
        return 'action_plan';
      default:
        return 'mortalitas';
    }
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={KIND_FILTERS}
          keyExtractor={(f) => f.label}
          renderItem={({ item }) => {
            const active = kindFilter === item.value;
            return (
              <TouchableOpacity style={[styles.chip, active ? styles.chipActive : undefined]} onPress={() => setKindFilter(item.value)}>
                <Text style={[styles.chipText, active ? styles.chipTextActive : undefined]}>{item.label}</Text>
              </TouchableOpacity>
            );
          }}
          ListFooterComponent={
            <TouchableOpacity
              style={[styles.chip, onlyPending ? styles.chipWarnActive : undefined]}
              onPress={() => setOnlyPending((v) => !v)}
            >
              <Text style={[styles.chipText, onlyPending ? styles.chipTextActive : undefined]}>
                Belum sinkron {pendingTotal > 0 ? `(${pendingTotal})` : ''}
              </Text>
            </TouchableOpacity>
          }
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => `${it.kind}-${it.local_id}`}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.empty}>Belum ada kegiatan yang tercatat.</Text>}
        renderItem={({ item }) => {
          const sync = SYNC_META[item.sync_status] || SYNC_META.DRAFT;
          return (
            <TouchableOpacity
              style={styles.card}
              onPress={() => navigation.navigate('RiwayatDetail', { kind: kindToRoute(item.kind), localId: item.local_id })}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                {!!item.ews_alert && <Text style={styles.alertMark}>🔴</Text>}
              </View>
              <Text style={styles.cardSub}>{item.subtitle}</Text>
              <View style={styles.cardFooter}>
                <Text style={styles.cardDate}>{formatDateTime(item.created_at)}</Text>
                {item.kategori && (
                  <View style={[styles.kategoriDot, { backgroundColor: severityColor[item.kategori] || '#999' }]} />
                )}
                <Text style={[styles.syncLabel, { color: sync.color }]}>
                  {sync.emoji} {sync.label}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterRow: { paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  chip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: colors.primary },
  chipWarnActive: { backgroundColor: colors.warning },
  chipText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text, flexShrink: 1 },
  alertMark: { fontSize: 14 },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  cardDate: { fontSize: 11, color: colors.textMuted, flex: 1 },
  kategoriDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  syncLabel: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.lg },
});
