import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import { useAuth } from '../state/AuthContext';
import { useSync } from '../state/SyncContext';
import { colors, severityColor, spacing } from '../theme';
import { todayDateStr } from '../utils/format';
import * as detectionRepo from '../db/repo/detectionRepo';
import * as sensusRepo from '../db/repo/sensusRepo';
import * as treatmentRepo from '../db/repo/treatmentRepo';
import * as mortalityRepo from '../db/repo/mortalityRepo';
import * as masterRepo from '../db/repo/masterRepo';
import * as alertRepo from '../db/repo/alertRepo';
import * as yieldRepo from '../db/repo/yieldRepo';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Main'>;

interface Counts {
  deteksi: number;
  sensus: number;
  treatment: number;
  mortalitas: number;
  yieldMaking: number;
  tugasHariIni: number;
}

type MenuKey =
  | 'Deteksi'
  | 'SensusMenu'
  | 'Pengendalian'
  | 'Mortalitas'
  | 'YieldMakingMenu'
  | 'DefisiensiHara'
  | 'ActionPlan'
  | 'Panduan'
  | 'Riwayat'
  | 'Sinkronisasi';

// SPEC_V2.md section 4 Mobile: "HomeScreen menu grid: tambah entri Yield Making, Defisiensi Hara,
// Action Plan." Yield Making groups its 4 forms behind one tile (see YieldMakingMenuScreen) rather
// than 4 separate Home tiles - judgment call to keep this grid's density in line with V1's (10
// tiles vs the 7 that were here before; a 4-way fan-out would have pushed it to 13).
const MENU_ITEMS: { key: MenuKey; label: string; emoji: string }[] = [
  { key: 'Deteksi', label: 'Deteksi', emoji: '🔍' },
  { key: 'SensusMenu', label: 'Sensus', emoji: '📊' },
  { key: 'Pengendalian', label: 'Pengendalian', emoji: '🧪' },
  { key: 'Mortalitas', label: 'Mortalitas', emoji: '💀' },
  { key: 'YieldMakingMenu', label: 'Yield Making', emoji: '🌴' },
  { key: 'DefisiensiHara', label: 'Defisiensi Hara', emoji: '🍃' },
  { key: 'ActionPlan', label: 'Action Plan', emoji: '📋' },
  { key: 'Panduan', label: 'Panduan', emoji: '📘' },
  { key: 'Riwayat', label: 'Riwayat', emoji: '🕓' },
  { key: 'Sinkronisasi', label: 'Sinkronisasi', emoji: '🔄' },
];

export default function HomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { pendingTotal, pending, lastSyncAt } = useSync();
  const [counts, setCounts] = useState<Counts>({ deteksi: 0, sensus: 0, treatment: 0, mortalitas: 0, yieldMaking: 0, tugasHariIni: 0 });
  const [alerts, setAlerts] = useState<alertRepo.LocalAlertRow[]>([]);

  const load = useCallback(async () => {
    const today = todayDateStr();
    const [d, s, t, m, y, tugas, alertRows] = await Promise.all([
      detectionRepo.countTodayDetections(today),
      sensusRepo.countTodaySensus(today),
      treatmentRepo.countTodayTreatments(today),
      mortalityRepo.countTodayMortalities(today),
      yieldRepo.countTodayYieldMaking(today),
      masterRepo.countTodayTasks(today),
      alertRepo.getRecentLocalAlerts(5),
    ]);
    setCounts({ deteksi: d, sensus: s, treatment: t, mortalitas: m, yieldMaking: y, tugasHariIni: tugas });
    setAlerts(alertRows);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const goTo = (key: MenuKey) => {
    switch (key) {
      case 'Deteksi':
        return navigation.navigate('Deteksi');
      case 'SensusMenu':
        return navigation.navigate('SensusMenu');
      case 'Pengendalian':
        return navigation.navigate('Pengendalian');
      case 'Mortalitas':
        return navigation.navigate('Mortalitas');
      case 'YieldMakingMenu':
        return navigation.navigate('YieldMakingMenu');
      case 'DefisiensiHara':
        return navigation.navigate('DefisiensiHara');
      case 'ActionPlan':
        return navigation.navigate('ActionPlan');
      case 'Panduan':
        return navigation.navigate('Main', { screen: 'Panduan' });
      case 'Riwayat':
        return navigation.navigate('Main', { screen: 'Riwayat' });
      case 'Sinkronisasi':
        return navigation.navigate('Main', { screen: 'Sinkronisasi' });
    }
  };

  return (
    <ScreenContainer>
      <Text style={styles.greeting}>Halo, {user?.name || 'Petugas'}</Text>
      <Text style={styles.role}>
        {user?.role_name} - {user?.estate_name || '-'} {user?.afdeling_name ? `/ ${user.afdeling_name}` : ''}
      </Text>

      <SectionCard title={`Ringkasan hari ini (${todayDateStr()})`}>
        <View style={styles.statsGrid}>
          <StatTile label="Tugas hari ini" value={counts.tugasHariIni} />
          <StatTile label="Deteksi" value={counts.deteksi} />
          <StatTile label="Sensus" value={counts.sensus} />
          <StatTile label="Pengendalian" value={counts.treatment} />
          <StatTile label="Mortalitas" value={counts.mortalitas} />
          <StatTile label="Yield Making" value={counts.yieldMaking} />
          <StatTile label="Belum tersinkron" value={pendingTotal} emphasize={pendingTotal > 0} />
        </View>
        <Text style={styles.lastSync}>
          Sinkronisasi terakhir: {lastSyncAt ? new Date(lastSyncAt).toLocaleString('id-ID') : 'Belum pernah'}
        </Text>
        {pendingTotal > 0 && (
          <Text style={styles.pendingBreakdown}>
            Deteksi {pending.deteksi} - Sensus {pending.sensus} - Pengendalian {pending.treatment} - Mortalitas{' '}
            {pending.mortalitas}
          </Text>
        )}
      </SectionCard>

      <SectionCard title="Menu">
        <View style={styles.menuGrid}>
          {MENU_ITEMS.map((item) => (
            <TouchableOpacity key={item.key} style={styles.menuItem} onPress={() => goTo(item.key)}>
              <Text style={styles.menuEmoji}>{item.emoji}</Text>
              <Text style={styles.menuLabel}>{item.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </SectionCard>

      {alerts.length > 0 && (
        <SectionCard title="🔴 Alert HPT lokal" subtitle="Data yang melewati ambang batas (perlu tindak lanjut)">
          {alerts.map((a) => (
            <View key={a.local_id} style={styles.alertRow}>
              <View style={[styles.alertDot, { backgroundColor: severityColor[a.kategori || ''] || '#999' }]} />
              <View style={styles.flex}>
                <Text style={styles.alertTitle}>
                  {a.kind} - {a.hpt_label || '-'} - {a.kategori}
                </Text>
                <Text style={styles.alertSub}>Blok #{a.blok_id} - {a.tanggal}</Text>
              </View>
            </View>
          ))}
        </SectionCard>
      )}
    </ScreenContainer>
  );
}

function StatTile({ label, value, emphasize }: { label: string; value: number; emphasize?: boolean }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileValue, emphasize ? styles.tileValueWarn : undefined]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  greeting: { fontSize: 18, fontWeight: '800', color: colors.text },
  role: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  tile: { width: '33.33%', paddingHorizontal: 4, marginBottom: spacing.sm },
  tileValue: { fontSize: 22, fontWeight: '800', color: colors.primaryDark },
  tileValueWarn: { color: colors.warning },
  tileLabel: { fontSize: 11, color: colors.textMuted },
  lastSync: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  pendingBreakdown: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  menuGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  menuItem: {
    width: '33.33%',
    paddingHorizontal: 4,
    marginBottom: spacing.md,
    alignItems: 'center',
  },
  menuEmoji: { fontSize: 26 },
  menuLabel: { fontSize: 12, color: colors.text, marginTop: 4, fontWeight: '600', textAlign: 'center' },
  alertRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  alertDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  flex: { flex: 1 },
  alertTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  alertSub: { fontSize: 11, color: colors.textMuted },
});
