import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { getCachedActionPlans } from '../db/repo/actionPlanRepo';
import { colors, spacing } from '../theme';
import { formatDate } from '../utils/format';
import type { CachedActionPlan } from '../types';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ActionPlan'>;

const STATUS_META: Record<string, { emoji: string; color: string }> = {
  OPEN: { emoji: '⚪', color: colors.textMuted },
  PLANNED: { emoji: '🔵', color: colors.primary },
  IN_PROGRESS: { emoji: '🟠', color: colors.warning },
  COMPLETED: { emoji: '🟢', color: colors.success },
  VERIFIED: { emoji: '✅', color: colors.success },
  CLOSED: { emoji: '⚫', color: colors.textMuted },
};

/** SPEC_V2.md section 4 Mobile: "list task assigned to this user (PIC)". action_plan itself is
 * created on the dashboard by Admin/Askep/Manager/RND (routes/actionPlans.js CREATE_ROLES) - this
 * screen only lists what's assigned (cached_action_plans, downloaded in sync/engine.ts
 * downloadAll() filtered by pic_user_id=self) and opens ActionPlanDetailScreen to record progress. */
export default function ActionPlanScreen({ navigation }: Props) {
  const [plans, setPlans] = useState<CachedActionPlan[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'OPEN_ONLY' | 'OVERDUE'>('OPEN_ONLY');

  const load = useCallback(() => {
    getCachedActionPlans().then(setPlans);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filtered = plans.filter((p) => {
    if (filter === 'OVERDUE') return !!p.overdue;
    if (filter === 'OPEN_ONLY') return !['CLOSED', 'VERIFIED'].includes(p.status);
    return true;
  });

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.filterRow}>
        {([
          { key: 'OPEN_ONLY', label: 'Aktif' },
          { key: 'OVERDUE', label: 'Overdue' },
          { key: 'ALL', label: 'Semua' },
        ] as const).map((f) => (
          <TouchableOpacity key={f.key} style={[styles.chip, filter === f.key ? styles.chipActive : undefined]} onPress={() => setFilter(f.key)}>
            <Text style={[styles.chipText, filter === f.key ? styles.chipTextActive : undefined]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => String(p.id)}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Belum ada Action Plan yang ditugaskan ke Anda. Jalankan sinkronisasi untuk mengunduh yang terbaru.
          </Text>
        }
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status] || STATUS_META.OPEN;
          return (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ActionPlanDetail', { id: item.id })}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {item.problem || `Action Plan #${item.id}`}
                </Text>
                {!!item.overdue && <Text style={styles.overdueMark}>⏰ Overdue</Text>}
              </View>
              {item.recommendation ? (
                <Text style={styles.cardSub} numberOfLines={2}>
                  {item.recommendation}
                </Text>
              ) : null}
              <View style={styles.cardFooter}>
                <Text style={styles.cardDate}>Due: {item.due_date ? formatDate(item.due_date) : '-'}</Text>
                <Text style={[styles.statusLabel, { color: meta.color }]}>
                  {meta.emoji} {item.status}
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
  filterRow: { flexDirection: 'row', paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  chip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text, flex: 1, marginRight: spacing.sm },
  overdueMark: { fontSize: 11, fontWeight: '700', color: colors.danger },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  cardDate: { fontSize: 11, color: colors.textMuted },
  statusLabel: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.lg },
});
