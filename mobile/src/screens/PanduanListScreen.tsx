import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import { getKnowledgeBase } from '../db/repo/kbRepo';
import type { KnowledgeBaseEntry } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

// Rendered inside the bottom Tab.Navigator (see navigation/MainTabs.tsx), but navigates into a
// screen ('PanduanDetail') that lives on the root Stack.Navigator - React Navigation resolves
// that automatically at runtime, so only the root navigation type is needed here.
interface Props {
  navigation: NativeStackNavigationProp<RootStackParamList>;
}

const CATEGORY_ORDER = ['SOP', 'Deteksi', 'Sensus', 'Pengendalian', 'Mortalitas', 'Threshold', 'Gejala', 'Foto', 'Materi pelatihan'];

/** SPEC.md "Knowledge base offline": openable without internet after at least one sync. List
 * grouped by kategori (SOP/Deteksi/Sensus/Pengendalian/Mortalitas/Threshold/Gejala/Foto/Materi
 * pelatihan), tap-through to PanduanDetailScreen. */
export default function PanduanListScreen({ navigation }: Props) {
  const [entries, setEntries] = useState<KnowledgeBaseEntry[]>([]);
  const [filter, setFilter] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      getKnowledgeBase().then(setEntries);
    }, [])
  );

  const categories = useMemo(() => {
    const set = new Set(entries.map((e) => e.kategori));
    return CATEGORY_ORDER.filter((c) => set.has(c)).concat(Array.from(set).filter((c) => !CATEGORY_ORDER.includes(c)));
  }, [entries]);

  const filtered = filter ? entries.filter((e) => e.kategori === filter) : entries;

  return (
    <ScreenContainer scroll={false}>
      <View style={styles.filterRow}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={['Semua', ...categories]}
          keyExtractor={(c) => c}
          renderItem={({ item }) => {
            const active = item === 'Semua' ? filter === null : filter === item;
            return (
              <TouchableOpacity
                style={[styles.chip, active ? styles.chipActive : undefined]}
                onPress={() => setFilter(item === 'Semua' ? null : item)}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : undefined]}>{item}</Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {entries.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            Belum ada panduan tersimpan. Jalankan "Sinkronkan Sekarang" di menu Sinkronisasi saat online untuk mengunduh
            Knowledge Base.
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('PanduanDetail', { id: item.id })}>
              <Text style={styles.cardTitle}>{item.judul}</Text>
              <Text style={styles.cardMeta}>
                {item.kategori} - v{item.versi || '1.0'} {item.cached_text ? '- 📥 tersedia offline' : ''}
              </Text>
            </TouchableOpacity>
          )}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterRow: { marginBottom: spacing.sm },
  chip: { backgroundColor: colors.chip, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  chipActive: { backgroundColor: colors.primary },
  chipText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  empty: { padding: spacing.lg },
  emptyText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
});
