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
import {
  getBahanOrganikByLocalId,
  getTbmVegetatifByLocalId,
  getWaterManagementByLocalId,
  getYieldPartenocarpiByLocalId,
} from '../db/repo/yieldRepo';
import { getDefisiensiHaraTemuanByLocalId } from '../db/repo/defisiensiHaraRepo';
import { getActionPlanUpdateByLocalId } from '../db/repo/actionPlanRepo';
import type {
  LocalBahanOrganik,
  LocalDefisiensiHaraTemuan,
  LocalDetection,
  LocalActionPlanUpdate,
  LocalMortality,
  LocalPhoto,
  LocalSensus,
  LocalTbmVegetatif,
  LocalTreatment,
  LocalWaterManagement,
  LocalYieldPartenocarpi,
} from '../types';
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
  const [parteno, setParteno] = useState<LocalYieldPartenocarpi | null>(null);
  const [waterMgmt, setWaterMgmt] = useState<LocalWaterManagement | null>(null);
  const [bahanOrganik, setBahanOrganik] = useState<LocalBahanOrganik | null>(null);
  const [tbmVegetatif, setTbmVegetatif] = useState<LocalTbmVegetatif | null>(null);
  const [defisiensiHara, setDefisiensiHara] = useState<LocalDefisiensiHaraTemuan | null>(null);
  const [actionPlanUpdate, setActionPlanUpdate] = useState<LocalActionPlanUpdate | null>(null);
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
      } else if (kind === 'partenocarpi') {
        const row = await getYieldPartenocarpiByLocalId(localId);
        setParteno(row);
        setPhotos(await getPhotosByEntity('YIELD_PARTENOCARPI', localId));
      } else if (kind === 'water_management') {
        const row = await getWaterManagementByLocalId(localId);
        setWaterMgmt(row);
        setPhotos(await getPhotosByEntity('WATER_MANAGEMENT', localId));
      } else if (kind === 'bahan_organik') {
        const row = await getBahanOrganikByLocalId(localId);
        setBahanOrganik(row);
        setPhotos(await getPhotosByEntity('BAHAN_ORGANIK', localId));
      } else if (kind === 'tbm_vegetatif') {
        const row = await getTbmVegetatifByLocalId(localId);
        setTbmVegetatif(row);
        setPhotos(await getPhotosByEntity('TBM_VEGETATIF', localId));
      } else if (kind === 'defisiensi_hara') {
        const row = await getDefisiensiHaraTemuanByLocalId(localId);
        setDefisiensiHara(row);
        setPhotos(await getPhotosByEntity('DEFISIENSI_HARA_TEMUAN', localId));
      } else if (kind === 'action_plan') {
        const row = await getActionPlanUpdateByLocalId(localId);
        setActionPlanUpdate(row);
        setPhotos(await getPhotosByEntity('ACTION_PLAN', localId));
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

      {kind === 'partenocarpi' && parteno && (
        <>
          <SectionCard title="Partenocarpi / Elaeidobius">
            <Row label="Tanggal" value={parteno.tanggal} />
            <Row label="Periode" value={parteno.periode} />
            <Row label="Blok" value={`#${parteno.blok_id}`} />
            <Row label="Curah hujan (mm)" value={parteno.rainfall_mm} />
            <Row label="Indikator hujan pagi (mm)" value={parteno.indikator_hujan_pagi} />
            <Row label="Total bunch" value={parteno.total_bunch} />
            <Row label="Abnormal bunch" value={parteno.abnormal_bunch} />
            <Row label="Abnormal bunch (%)" value={parteno.abnormal_bunch_pct} />
            <Row label="Populasi EK (ekor/ha)" value={parteno.populasi_ek} />
            <Row label="Catatan" value={parteno.catatan} />
            {parteno.kategori_lokal ? (
              <KategoriBadge kategori={parteno.kategori_lokal} alert={!!parteno.ews_alert_lokal} />
            ) : (
              <Text style={styles.pending}>Klasifikasi menunggu sinkronisasi ke server.</Text>
            )}
            {!!parteno.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={parteno.sync_status} error={parteno.sync_error} attempt={parteno.sync_attempt} serverId={parteno.server_id} />
        </>
      )}

      {kind === 'water_management' && waterMgmt && (
        <>
          <SectionCard title="Water Management">
            <Row label="Tanggal" value={waterMgmt.tanggal} />
            <Row label="Titik parit" value={waterMgmt.titik_parit} />
            <Row label="Blok" value={`#${waterMgmt.blok_id}`} />
            <Row label="Level air (cm)" value={waterMgmt.water_level_cm} />
            <Row label="Genangan" value={waterMgmt.flooding ? 'Ya' : 'Tidak'} />
            <Row label="Lama genangan (hari)" value={waterMgmt.flooding_duration_hari} />
            <Row label="Catatan" value={waterMgmt.catatan} />
            {waterMgmt.kategori_lokal ? (
              <KategoriBadge kategori={waterMgmt.kategori_lokal} alert={!!waterMgmt.ews_alert_lokal} />
            ) : (
              <Text style={styles.pending}>Klasifikasi menunggu sinkronisasi ke server.</Text>
            )}
            {!!waterMgmt.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={waterMgmt.sync_status} error={waterMgmt.sync_error} attempt={waterMgmt.sync_attempt} serverId={waterMgmt.server_id} />
        </>
      )}

      {kind === 'bahan_organik' && bahanOrganik && (
        <>
          <SectionCard title="Bahan Organik">
            <Row label="Tanggal" value={bahanOrganik.tanggal} />
            <Row label="Area" value={bahanOrganik.area_type} />
            <Row label="Blok" value={`#${bahanOrganik.blok_id}`} />
            <Row label="Total sampel" value={bahanOrganik.total_sample} />
            <Row label="Jumlah menguning" value={bahanOrganik.yellowing_count} />
            <Row label="Persentase menguning (%)" value={bahanOrganik.yellowing_pct} />
            <Row label="Kondisi vegetatif" value={bahanOrganik.vegetative_condition} />
            <Row label="Baseline TBM normal" value={bahanOrganik.baseline_tbm_normal} />
            <Row label="Hasil perbandingan" value={bahanOrganik.comparison_result} />
            <Row label="Catatan" value={bahanOrganik.catatan} />
            {bahanOrganik.kategori_lokal ? (
              <KategoriBadge kategori={bahanOrganik.kategori_lokal} alert={!!bahanOrganik.ews_alert_lokal} />
            ) : (
              <Text style={styles.pending}>Klasifikasi menunggu sinkronisasi ke server.</Text>
            )}
            {!!bahanOrganik.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={bahanOrganik.sync_status} error={bahanOrganik.sync_error} attempt={bahanOrganik.sync_attempt} serverId={bahanOrganik.server_id} />
        </>
      )}

      {kind === 'tbm_vegetatif' && tbmVegetatif && (
        <>
          <SectionCard title="TBM Vegetatif">
            <Row label="Tanggal" value={tbmVegetatif.tanggal} />
            <Row label="Blok" value={`#${tbmVegetatif.blok_id}`} />
            <Row label="Umur (bulan)" value={tbmVegetatif.umur_bulan} />
            <Row label="Panjang pelepah (cm)" value={tbmVegetatif.panjang_pelepah_cm} />
            <Row label="Jumlah pelepah" value={tbmVegetatif.jumlah_pelepah} />
            <Row label="LAI" value={tbmVegetatif.lai} />
            <Row label="Target produksi (ton/ha)" value={tbmVegetatif.target_produksi_ton_ha} />
            <Row label="Hasil evaluasi" value={tbmVegetatif.hasil_evaluasi} />
            <Row label="Catatan" value={tbmVegetatif.catatan} />
            {tbmVegetatif.kategori_lokal ? (
              <KategoriBadge kategori={tbmVegetatif.kategori_lokal} alert={!!tbmVegetatif.ews_alert_lokal} />
            ) : (
              <Text style={styles.pending}>Klasifikasi menunggu sinkronisasi ke server.</Text>
            )}
            {!!tbmVegetatif.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={tbmVegetatif.sync_status} error={tbmVegetatif.sync_error} attempt={tbmVegetatif.sync_attempt} serverId={tbmVegetatif.server_id} />
        </>
      )}

      {kind === 'defisiensi_hara' && defisiensiHara && (
        <>
          <SectionCard title="Temuan Defisiensi Hara">
            <Row label="Tanggal" value={defisiensiHara.tanggal} />
            <Row label="Blok" value={`#${defisiensiHara.blok_id}`} />
            <Row label="Unsur hara" value={defisiensiHara.unsur_hara} />
            <Row label="Temuan lapangan" value={defisiensiHara.temuan_lapangan} />
            <Row label="Severity" value={defisiensiHara.severity} />
            <Row label="Status" value={defisiensiHara.status} />
            <Row label="Catatan" value={defisiensiHara.catatan} />
            {!!defisiensiHara.location_warning && <Text style={styles.warn}>⚠️ Lokasi di luar area blok saat disimpan</Text>}
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo status={defisiensiHara.sync_status} error={defisiensiHara.sync_error} attempt={defisiensiHara.sync_attempt} serverId={defisiensiHara.server_id} />
        </>
      )}

      {kind === 'action_plan' && actionPlanUpdate && (
        <>
          <SectionCard title="Update Action Plan">
            <Row label="Action Plan" value={`#${actionPlanUpdate.action_plan_id}`} />
            <Row label="Status baru" value={actionPlanUpdate.status} />
            <Row label="Tindakan / catatan" value={actionPlanUpdate.actual_action} />
          </SectionCard>
          <PhotoGallery photos={photos} />
          <SyncInfo
            status={actionPlanUpdate.sync_status}
            error={actionPlanUpdate.sync_error}
            attempt={actionPlanUpdate.sync_attempt}
            serverId={null}
          />
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
  pending: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', marginTop: 6 },
  mono: { fontSize: 11, color: colors.text, fontFamily: 'monospace' },
  thumb: { width: 120, height: 120, borderRadius: 8, marginRight: 8, backgroundColor: '#eee' },
});
