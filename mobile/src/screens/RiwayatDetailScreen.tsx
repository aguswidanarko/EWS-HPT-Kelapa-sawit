import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import KategoriBadge from '../components/KategoriBadge';
import { getDetectionByLocalId } from '../db/repo/detectionRepo';
import { getSensusByLocalId } from '../db/repo/sensusRepo';
import { getTreatmentByLocalId } from '../db/repo/treatmentRepo';
import { getMortalityByLocalId } from '../db/repo/mortalityRepo';
import { getPhotosByEntity } from '../db/repo/photoRepo';
import type { LocalDetection, LocalMortality, LocalPhoto, LocalSensus, LocalTreatment } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';
import { formatDateTime, safeParseJson } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'RiwayatDetail'>;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function SyncInfo({ status, error, attempt, serverId }: { status: string; error: string | null; attempt: number; serverId: string | null }) {
  return (
    <SectionCard title="Status Sinkronisasi">
      <Row label="Status" value={status} />
      <Row label="Percobaan" value={attempt} />
      <Row label="Server ID" value={serverId} />
      {error ? <Row label="Pesan error" value={error} /> : null}
    </SectionCard>
  );
}

function PhotoGallery({ photos }: { photos: LocalPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <SectionCard title={`Foto (${photos.length})`}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {photos.map((p) => (
          <Image key={p.local_id} source={{ uri: p.file_uri }} style={styles.thumb} />
        ))}
      </ScrollView>
    </SectionCard>
  );
}

export default function RiwayatDetailScreen({ route }: Props) {
  const { kind, localId } = route.params;
  const [detection, setDetection] = useState<LocalDetection | null>(null);
  const [sensus, setSensus] = useState<LocalSensus | null>(null);
  const [treatment, setTreatment] = useState<LocalTreatment | null>(null);
  const [mortality, setMortality] = useState<LocalMortality | null>(null);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);

  useEffect(() => {
    (async () => {
      if (kind === 'deteksi') {
        const row = await getDetectionByLocalId(localId);
        setDetection(row);
        setPhotos(await getPhotosByEntity('DETECTION', localId));
      } else if (kind === 'sensus') {
        const row = await getSensusByLocalId(localId);
        setSensus(row);
        setPhotos(await getPhotosByEntity('SENSUS', localId));
      } else if (kind === 'treatment') {
        const row = await getTreatmentByLocalId(localId);
        setTreatment(row);
        setPhotos(await getPhotosByEntity('TREATMENT', localId));
      } else if (kind === 'mortalitas') {
        const row = await getMortalityByLocalId(localId);
        setMortality(row);
        setPhotos(await getPhotosByEntity('MORTALITY', localId));
      }
    })();
  }, [kind, localId]);

  return (
    <ScreenContainer>
      {kind === 'deteksi' && detection && (
        <>
          <SectionCard title="Deteksi HPT">
            <Row label="Tanggal" value={detection.tanggal} />
            <Row label="Waktu" value={detection.waktu} />
            <Row label="Blok" value={`#${detection.blok_id}`} />
            <Row label="Baris / Posisi" value={[detection.baris, detection.posisi].filter((v) => v !== null).join(' / ')} />
            <Row label="Gejala" value={detection.gejala} />
            <Row label="Kondisi/indikator" value={detection.kondisi_indikator} />
            <Row label="Jumlah/tingkat indikasi" value={detection.jumlah_indikasi} />
            <Row label="Catatan" value={detection.catatan} />
            {detection.kategori_lokal && <KategoriBadge kategori={detection.kategori_lokal} alert={!!detection.ews_alert_lokal} />}
            {!!detection.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <SectionCard title="GPS">
            <Row label="Latitude" value={detection.gps_lat} />
            <Row label="Longitude" value={detection.gps_lng} />
            <Row label="Akurasi (m)" value={detection.gps_accuracy} />
            <Row label="Waktu GPS" value={formatDateTime(detection.gps_timestamp)} />
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={detection.sync_status} error={detection.sync_error} attempt={detection.sync_attempt} serverId={detection.server_id} />
        </>
      )}

      {kind === 'sensus' && sensus && (
        <>
          <SectionCard title={`Sensus ${sensus.jenis_sensus}`}>
            <Row label="Tanggal" value={sensus.tanggal} />
            <Row label="Blok" value={`#${sensus.blok_id}`} />
            <Row label="Hasil hitung" value={sensus.hasil_hitung !== null ? sensus.hasil_hitung.toFixed(2) : '-'} />
            <Row label="Saran pengendalian" value={sensus.saran_pengendalian} />
            <Row label="Catatan" value={sensus.catatan} />
            {sensus.kategori_lokal && <KategoriBadge kategori={sensus.kategori_lokal} alert={!!sensus.ews_alert_lokal} />}
          </SectionCard>
          <SectionCard title="Detail Hasil (raw)">
            <Text style={styles.mono}>{JSON.stringify(safeParseJson(sensus.hasil_json, {}), null, 2)}</Text>
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={sensus.sync_status} error={sensus.sync_error} attempt={sensus.sync_attempt} serverId={sensus.server_id} />
        </>
      )}

      {kind === 'treatment' && treatment && (
        <>
          <SectionCard title="Pengendalian">
            <Row label="Metode" value={treatment.metode_pengendalian} />
            <Row label="Blok" value={`#${treatment.blok_id}`} />
            <Row label="Luas serangan (ha)" value={treatment.luas_serangan} />
            <Row label="Tanggal mulai" value={treatment.tanggal_mulai} />
            <Row label="Tanggal selesai" value={treatment.tanggal_selesai} />
            <Row label="Jumlah pokok" value={treatment.jumlah_pokok} />
            <Row label="HK" value={treatment.hk} />
            <Row label="Material" value={treatment.material} />
            <Row label="Jumlah material" value={treatment.jumlah_material} />
            <Row label="Alat" value={treatment.alat} />
            <Row label="PIC" value={treatment.pic} />
            <Row label="Status" value={treatment.status} />
            <Row label="Catatan" value={treatment.catatan} />
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={treatment.sync_status} error={treatment.sync_error} attempt={treatment.sync_attempt} serverId={treatment.server_id} />
        </>
      )}

      {kind === 'mortalitas' && mortality && (
        <>
          <SectionCard title="Sensus Mortalitas">
            <Row label="Tanggal" value={mortality.tanggal} />
            <Row label="Blok" value={mortality.blok_id ? `#${mortality.blok_id}` : '-'} />
            <Row label="Sampel" value={mortality.sampel} />
            <Row label="Jumlah hidup" value={mortality.jumlah_hidup} />
            <Row label="Jumlah mati" value={mortality.jumlah_mati} />
            <Row label="Kondisi" value={mortality.kondisi} />
            <Row label="Hasil efektivitas" value={mortality.hasil_efektivitas_lokal} />
            {!!mortality.service_required_lokal && <Text style={styles.warn}>⚠️ Perlu SERVICE (pengendalian ulang)</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={mortality.sync_status} error={mortality.sync_error} attempt={mortality.sync_attempt} serverId={mortality.server_id} />
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  rowLabel: { width: 150, fontSize: 12, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  warn: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 6 },
  mono: { fontSize: 11, color: colors.text, fontFamily: 'monospace' },
  thumb: { width: 120, height: 120, borderRadius: 8, marginRight: 8, backgroundColor: '#eee' },
});
