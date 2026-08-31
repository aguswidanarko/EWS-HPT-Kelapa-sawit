import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import { EWS_FORM_SCHEMA, EwsFormEntry, listEwsFormIds } from '../domain/ewsFormSchema';
import { getEwsDictionary } from '../db/repo/ewsDictionaryRepo';
import type { EwsDictionaryRow } from '../types';
import { colors, spacing } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'EwsPicker'>;

// EWS Dynamic Form Engine entry point (BRD_V3_Mobile_Offline.docx section 3): replaces the old
// SensusMenuScreen/YieldMakingMenuScreen/DefisiensiHaraScreen Home tiles with ONE picker covering
// all 32 EWS_IDs from domain/ewsFormSchema.ts, grouped by scope (matches the EWS Dictionary's own
// "Scope" column: HPT/Yield Making/Agro/WM). Display names come from the synced ews_dictionary_cache
// when available (best-effort, may be empty before first sync) and fall back to the bundled
// hpt_code so the picker still works fully offline on a fresh install.
const SCOPE_ORDER: EwsFormEntry['scope'][] = ['HPT', 'Yield Making', 'Agro', 'WM'];
const SCOPE_LABEL: Record<EwsFormEntry['scope'], { title: string; emoji: string; subtitle: string }> = {
  HPT: { title: 'Sensus HPT', emoji: '📊', subtitle: 'Tikus, UPDKS, Oryctes, Rayap, Ganoderma' },
  'Yield Making': { title: 'Yield Making', emoji: '🌴', subtitle: 'Partenocarpi / Elaeidobius' },
  Agro: { title: 'Agro Observation', emoji: '🌱', subtitle: 'Bahan Organik, TBM Vegetatif, Defisiensi Hara, indikator agronomi lainnya' },
  WM: { title: 'Water Management', emoji: '💧', subtitle: 'Level air & genangan parit' },
};

export default function EwsPickerScreen({ navigation, route }: Props) {
  const initialScope = route.params?.scope;
  const [dict, setDict] = useState<Record<string, EwsDictionaryRow>>({});

  useFocusEffect(
    useCallback(() => {
      getEwsDictionary().then((rows) => {
        const map: Record<string, EwsDictionaryRow> = {};
        for (const r of rows) map[r.ews_id] = r;
        setDict(map);
      });
    }, [])
  );

  const openForm = (ews_id: string) => navigation.navigate('EwsForm', { ews_id });

  const scopes = initialScope ? [initialScope] : SCOPE_ORDER;

  return (
    <ScreenContainer>
      {scopes.map((scope) => {
        const meta = SCOPE_LABEL[scope];
        const ids = listEwsFormIds(scope);
        return (
          <SectionCard key={scope} title={`${meta.emoji} ${meta.title}`} subtitle={meta.subtitle}>
            {ids.map((ews_id) => {
              const entry = EWS_FORM_SCHEMA[ews_id];
              const d = dict[ews_id];
              return (
                <TouchableOpacity key={ews_id} style={styles.item} onPress={() => openForm(ews_id)}>
                  <View style={styles.flex1}>
                    <Text style={styles.label}>{d?.hpt_name || entry.hpt_code}</Text>
                    <Text style={styles.sub}>
                      {ews_id}
                      {d?.planting_stage ? ` · Fase: ${d.planting_stage}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            })}
          </SectionCard>
        );
      })}
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
  flex1: { flex: 1 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  chevron: { fontSize: 22, color: colors.textMuted },
});
