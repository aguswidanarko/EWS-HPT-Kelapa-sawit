import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'YieldMakingMenu'>;

// SPEC_V2.md section 4 Mobile: PartenocarpiFormScreen/WaterManagementFormScreen/
// BahanOrganikFormScreen/TbmVegetatifFormScreen grouped under one "Yield Making" menu entry
// (judgment call, see final report - matches the existing SensusMenuScreen pattern of one Home
// tile fanning out to several engine-specific forms, rather than 4 separate Home tiles).
const MODULES: { label: string; sub: string; screen: keyof RootStackParamList; emoji: string }[] = [
  { label: 'Partenocarpi / Elaeidobius', sub: 'Fruit set, populasi EK, curah hujan - bulanan', screen: 'Partenocarpi', emoji: '🌴' },
  { label: 'Water Management', sub: 'Level air parit per titik - paling lambat tgl 25/bulan', screen: 'WaterManagement', emoji: '💧' },
  { label: 'Bahan Organik', sub: 'Daun menguning area pasir vs baseline TBM', screen: 'BahanOrganik', emoji: '🌱' },
  { label: 'TBM Vegetatif', sub: 'Standar pertumbuhan TBM - minimal 3 bulan', screen: 'TbmVegetatif', emoji: '📏' },
];

export default function YieldMakingMenuScreen({ navigation }: Props) {
  return (
    <ScreenContainer>
      <SectionCard title="Yield Making" subtitle="Pilih modul indikator yield making (SPEC_V2.md bagian 2 & 5)">
        {MODULES.map((m) => (
          <TouchableOpacity key={m.screen} style={styles.item} onPress={() => navigation.navigate(m.screen as never)}>
            <Text style={styles.emoji}>{m.emoji}</Text>
            <View style={styles.flex1}>
              <Text style={styles.label}>{m.label}</Text>
              <Text style={styles.sub}>{m.sub}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        ))}
      </SectionCard>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  emoji: { fontSize: 24, marginRight: spacing.md },
  flex1: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
});
