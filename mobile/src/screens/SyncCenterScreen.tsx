import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import Button from '../components/Button';
import { useSync } from '../state/SyncContext';
import { useNet } from '../state/NetContext';
import { getRiwayat, type RiwayatItem } from '../db/repo/riwayatRepo';
import { colors, spacing } from '../theme';
import { formatDateTime } from '../utils/format';

const KIND_LABEL: Record<RiwayatItem['kind'], string> = {
  DETEKSI: 'Deteksi',
  SENSUS: 'Sensus',
  TREATMENT: 'Pengendalian',
  MORTALITAS: 'Mortalitas',
};

const SYNC_META: Record<string, { emoji: string; label: string; color: string }> = {
  DRAFT: { emoji: '⚪', label: 'Draft', color: colors.textMuted },
  READY_TO_SYNC: { emoji: '⏳', label: 'Belum terkirim', color: colors.warning },
  SYNCING: { emoji: '🟠', label: 'Sedang dikirim', color: colors.warning },
  SYNCED: { emoji: '✅', label: 'Berhasil', color: colors.success },
  FAILED: { emoji: '❌', label: 'Gagal / error', color: colors.danger },
};

/** SPEC.md "Sync Center": ringkasan ("17 data belum terkirim - Deteksi 10, Sensus 5, Treatment
 * 2"), tombol "Sinkronkan Sekarang", per-item status (belum terkirim/sedang dikirim/berhasil/
 * gagal/error). Safe when offline (button disabled, pill shows 🔴) and safe to interrupt - every
 * write goes through a SQLite transaction (see sync/engine.ts + db/database.ts withTransaction). */
export default function SyncCenterScreen() {
  const { isOnline } = useNet();
  const { pending, pendingTotal, isSyncing, lastDownload, lastUpload, lastSyncAt, syncError, runDownload, runUpload, runFullSync } = useSync();
  const [pendingItems, setPendingItems] = useState<RiwayatItem[]>([]);

  const loadItems = useCallback(async () => {
    const all = await getRiwayat(500);
    setPendingItems(all.filter((it) => it.sync_status !== 'SYNCED' && it.sync_status !== 'DRAFT'));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadItems();
    }, [loadItems])
  );

  const handleSyncNow = async () => {
    await runFullSync();
    await loadItems();
  };

  const handleDownloadOnly = async () => {
    await runDownload();
    await loadItems();
  };

  return (
    <ScreenContainer scroll={false}>
      <View style={{ paddingHorizontal: spacing.md }}>
        <SectionCard title="Ringkasan">
          {pendingTotal > 0 ? (
            <>
              <Text style={styles.summaryHeadline}>{pendingTotal} data belum terkirim</Text>
              <Text style={styles.summaryBreakdown}>
                Deteksi {pending.deteksi} - Sensus {pending.sensus} - Pengendalian {pending.treatment} - Mortalitas {pending.mortalitas}
              </Text>
            </>
          ) : (
            <Text style={styles.summaryHeadline}>✅ Semua data sudah tersinkron</Text>
          )}
          <Text style={styles.lastSync}>
            Sinkronisasi terakhir: {lastSyncAt ? formatDateTime(lastSyncAt) : 'Belum pernah'}
          </Text>
          {!isOnline && <Text style={styles.offlineNote}>🔴 Offline - sinkronisasi tidak tersedia sampai tersambung kembali.</Text>}
          {syncError && <Text style={styles.errorNote}>{syncError}</Text>}

          <Button
            title={isSyncing ? 'Menyinkronkan...' : 'Sinkronkan Sekarang'}
            onPress={handleSyncNow}
            loading={isSyncing}
            disabled={!isOnline}
          />
          <Button title="Hanya unduh data master" onPress={handleDownloadOnly} loading={isSyncing} disabled={!isOnline} variant="secondary" />

          {lastDownload && (
            <Text style={styles.detailText}>
              Master: {lastDownload.bloks} blok, {lastDownload.hpt} HPT, {lastDownload.thresholds} threshold, {lastDownload.knowledgeBase} panduan,{' '}
              {lastDownload.jadwal} jadwal, {lastDownload.incidents} incident terbuka.
            </Text>
          )}
          {lastUpload && (
            <Text style={styles.detailText}>
              Upload terakhir: {lastUpload.success} berhasil, {lastUpload.failed} gagal, {lastUpload.deferred} menunggu dependensi,{' '}
              {lastUpload.photosUploaded} foto terkirim.
            </Text>
          )}
        </SectionCard>
      </View>

      <FlatList
        data={pendingItems}
        keyExtractor={(it) => `${it.kind}-${it.local_id}`}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={pendingItems.length > 0 ? <Text style={styles.listHeader}>Rincian per item</Text> : null}
        ListEmptyComponent={<Text style={styles.empty}>Tidak ada data yang menunggu sinkronisasi.</Text>}
        renderItem={({ item }) => {
          const sync = SYNC_META[item.sync_status] || SYNC_META.DRAFT;
          return (
            <View style={styles.itemRow}>
              <View style={styles.flex1}>
                <Text style={styles.itemTitle}>
                  {KIND_LABEL[item.kind]} - {item.title}
                </Text>
                <Text style={styles.itemSub}>{item.subtitle}</Text>
                {item.sync_status === 'FAILED' && <Text style={styles.itemError}>Akan dicoba lagi otomatis saat "Sinkronkan Sekarang" ditekan.</Text>}
              </View>
              <Text style={[styles.itemStatus, { color: sync.color }]}>
                {sync.emoji} {sync.label}
              </Text>
            </View>
          );
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  summaryHeadline: { fontSize: 16, fontWeight: '800', color: colors.text },
  summaryBreakdown: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  lastSync: { fontSize: 11, color: colors.textMuted, marginTop: 8 },
  offlineNote: { fontSize: 12, color: colors.danger, marginTop: 6, fontWeight: '600' },
  errorNote: { fontSize: 12, color: colors.danger, marginTop: 6 },
  detailText: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  listContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  listHeader: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.xs,
  },
  flex1: { flex: 1, paddingRight: spacing.sm },
  itemTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  itemSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  itemError: { fontSize: 10, color: colors.danger, marginTop: 2 },
  itemStatus: { fontSize: 11, fontWeight: '700' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.lg },
});
