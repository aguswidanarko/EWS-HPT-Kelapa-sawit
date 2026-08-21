import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import { useHptList } from '../hooks/useMasterData';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusMenu'>;

// SPEC.md section 5: one engine per HPT, chosen up front, each with its own sub-form/flow.
const ENGINES: { code: string; label: string; metode: string; screen: keyof RootStackParamList; emoji: string }[] = [
  { code: 'UPDKS', label: 'UPDKS (Ulat Api / Ulat Kantong)', metode: 'Baris sampel', screen: 'SensusUPDKS', emoji: '🐛' },
  { code: 'TIKUS', label: 'Tikus', metode: 'Baris sampel', screen: 'SensusTikus', emoji: '🐀' },
  { code: 'ORYCTES', label: 'Oryctes (Kumbang Tanduk)', metode: 'Baris sampel', screen: 'SensusOryctes', emoji: '🪲' },
  { code: 'RAYAP', label: 'Rayap', metode: 'Grid (seluruh blok)', screen: 'SensusRayap', emoji: '🐜' },
  { code: 'GANODERMA', label: 'Ganoderma (Busuk Pangkal Batang)', metode: 'Seluruh pokok', screen: 'SensusGanoderma', emoji: '🍄' },
];

export default function SensusMenuScreen({ navigation }: Props) {
  const hptList = useHptList();

  return (
    <ScreenContainer>
      <SectionCard title="Pilih engine sensus" subtitle="Metode & formula mengikuti HPT yang dipilih (SPEC.md bagian 5)">
        {ENGINES.map((engine) => {
          const hpt = hptList.find((h) => h.code === engine.code);
          return (
            <TouchableOpacity
              key={engine.code}
              style={styles.item}
              onPress={() => navigation.navigate(engine.screen as never)}
            >
              <Text style={styles.emoji}>{engine.emoji}</Text>
              <View style={styles.flex1}>
                <Text style={styles.label}>{engine.label}</Text>
                <Text style={styles.sub}>
                  {engine.metode}
                  {hpt?.satuan ? ` - satuan: ${hpt.satuan}` : ''}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        })}
      </SectionCard>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  emoji: { fontSize: 24, marginRight: spacing.md },
  flex1: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
});
