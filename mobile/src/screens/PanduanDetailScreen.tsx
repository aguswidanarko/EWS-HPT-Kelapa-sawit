import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import Button from '../components/Button';
import { fetchKbFileText, kbFileFullUrl } from '../api/knowledgeBase';
import { getKnowledgeBaseById, setKbCachedText } from '../db/repo/kbRepo';
import { useNet } from '../state/NetContext';
import type { KnowledgeBaseEntry } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'PanduanDetail'>;

const TEXT_TYPES = ['text/markdown', 'text/plain', 'text/x-markdown'];

/** SPEC.md "Knowledge base offline": openable without internet. Text/markdown entries are
 * downloaded once (while online) and cached in SQLite so they render fully offline afterwards.
 * PDF/DOC/XLS entries show metadata + an "open externally" action (in-app rendering intentionally
 * out of scope for v1 - see README.md "Known limitations"). */
export default function PanduanDetailScreen({ route }: Props) {
  const { isOnline } = useNet();
  const [entry, setEntry] = useState<KnowledgeBaseEntry | null>(null);
  const [loadingText, setLoadingText] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const row = await getKnowledgeBaseById(route.params.id);
    setEntry(row);
    return row;
  }, [route.params.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    (async () => {
      const row = await load();
      if (!row) return;
      const isText = row.file_type ? TEXT_TYPES.includes(row.file_type) : false;
      if (isText && !row.cached_text && isOnline) {
        setLoadingText(true);
        setError(null);
        try {
          const text = await fetchKbFileText(row.id);
          await setKbCachedText(row.id, text);
          await load();
        } catch {
          setError('Gagal mengunduh konten panduan. Coba lagi saat online.');
        } finally {
          setLoadingText(false);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  if (!entry) {
    return (
      <ScreenContainer>
        <Text style={styles.notFound}>Panduan tidak ditemukan di penyimpanan lokal.</Text>
      </ScreenContainer>
    );
  }

  const isText = entry.file_type ? TEXT_TYPES.includes(entry.file_type) : false;

  const openExternally = async () => {
    if (!entry.download_url) return;
    const url = kbFileFullUrl(entry.download_url);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Gagal membuka', 'Tidak dapat membuka file ini di perangkat Anda.');
    }
  };

  return (
    <ScreenContainer>
      <SectionCard>
        <Text style={styles.title}>{entry.judul}</Text>
        <Text style={styles.meta}>
          {entry.kategori} - versi {entry.versi || '1.0'} {entry.tanggal_berlaku ? `- berlaku ${entry.tanggal_berlaku}` : ''}
        </Text>
        <Text style={styles.metaSmall}>Tipe file: {entry.file_type || 'tidak diketahui'}</Text>
      </SectionCard>

      {isText ? (
        <SectionCard title="Isi Panduan">
          {loadingText ? (
            <ActivityIndicator color={colors.primary} />
          ) : entry.cached_text ? (
            <Text style={styles.body}>{entry.cached_text}</Text>
          ) : (
            <Text style={styles.notFound}>
              {isOnline ? 'Belum tersedia.' : '🔴 Belum diunduh & sedang offline. Sambungkan ke internet lalu buka lagi.'}
            </Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </SectionCard>
      ) : (
        <SectionCard title="Berkas">
          <Text style={styles.body}>
            File ini berformat {entry.file_type || 'dokumen'} (PDF/DOC/XLS) - pratinjau di dalam aplikasi belum didukung pada
            v1. Metadata sudah tersedia offline; buka file dengan aplikasi eksternal saat perangkat online.
          </Text>
          <View style={{ height: spacing.sm }} />
          <Button title="Buka / unduh file" onPress={openExternally} disabled={!isOnline} variant="secondary" />
          {!isOnline && <Text style={styles.metaSmall}>Sambungkan ke internet untuk membuka berkas ini.</Text>}
        </SectionCard>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '800', color: colors.text },
  meta: { fontSize: 12, color: colors.primaryDark, fontWeight: '600', marginTop: 4 },
  metaSmall: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
  body: { fontSize: 13, color: colors.text, lineHeight: 20 },
  notFound: { color: colors.textMuted, fontSize: 13, textAlign: 'center', padding: spacing.lg },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.sm },
});
