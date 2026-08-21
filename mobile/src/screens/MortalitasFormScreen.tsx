import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import FormField from '../components/FormField';
import SelectField from '../components/SelectField';
import LocationCascade, { type LocationValue } from '../components/LocationCascade';
import GpsField from '../components/GpsField';
import PhotoField from '../components/PhotoField';
import Button from '../components/Button';
import OutOfAreaModal from '../components/OutOfAreaModal';
import { useAuth } from '../state/AuthContext';
import { useSync } from '../state/SyncContext';
import { useBlok, useThresholds } from '../hooks/useMasterData';
import { checkLocationWarning } from '../domain/geo';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import { evaluateEffectivenessLocal } from '../domain/mortalityEval';
import type { CapturedPhoto } from '../domain/photo';
import { insertMortality } from '../db/repo/mortalityRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { listTreatments } from '../db/repo/treatmentRepo';
import { getCachedIncidents } from '../db/repo/masterRepo';
import { uuid } from '../utils/uuid';
import { nowIso, todayDateStr } from '../utils/format';
import { getDeviceId } from '../utils/device';
import type { CachedIncident, GpsCapture, LocalTreatment } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Mortalitas'>;

const SYNC_LABEL: Record<string, string> = {
  DRAFT: 'draft',
  READY_TO_SYNC: 'belum terkirim',
  SYNCING: 'mengirim...',
  SYNCED: 'tersinkron',
  FAILED: 'gagal',
};

export default function MortalitasFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const thresholds = useThresholds();

  const [treatments, setTreatments] = useState<LocalTreatment[]>([]);
  const [incidents, setIncidents] = useState<CachedIncident[]>([]);
  const [treatmentLocalId, setTreatmentLocalId] = useState<string | null>(null);
  const [incidentId, setIncidentId] = useState<number | null>(null);
  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const [tanggal, setTanggal] = useState(todayDateStr());
  const [sampel, setSampel] = useState('');
  const [jumlahHidup, setJumlahHidup] = useState('');
  const [jumlahMati, setJumlahMati] = useState('');
  const [kondisi, setKondisi] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  const blok = useBlok(location.blok_id);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
    listTreatments(100).then(setTreatments);
    getCachedIncidents().then(setIncidents);
  }, []);

  const selectedTreatment = treatments.find((t) => t.local_id === treatmentLocalId) || null;

  // Selecting a treatment auto-fills blok + incident, matching "Sensus Mortalitas: setelah
  // treatment" (SPEC.md section 6).
  useEffect(() => {
    if (!selectedTreatment) return;
    setLocation((prev) => ({
      estate_id: selectedTreatment.estate_id ?? prev.estate_id,
      afdeling_id: selectedTreatment.afdeling_id ?? prev.afdeling_id,
      blok_id: selectedTreatment.blok_id,
    }));
    if (selectedTreatment.incident_id) setIncidentId(selectedTreatment.incident_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treatmentLocalId]);

  const effectiveness = useMemo(() => {
    const hptId = selectedTreatment?.hpt_id ?? null;
    return evaluateEffectivenessLocal({
      thresholds,
      hpt_id: hptId,
      jumlah_hidup: jumlahHidup ? Number(jumlahHidup) : null,
      sampel: sampel ? Number(sampel) : null,
    });
  }, [thresholds, selectedTreatment, jumlahHidup, sampel]);

  const doSave = async (locationWarning: boolean) => {
    if (!tanggal) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const activity_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertMortality({
        local_id,
        server_id: null,
        server_row_id: null,
        activity_id,
        incident_id: incidentId,
        user_id: user?.id ?? null,
        device_id,
        created_at: now,
        updated_at: now,
        sync_status: 'READY_TO_SYNC',
        sync_attempt: 0,
        sync_error: null,
        source: 'MOBILE',
        treatment_local_id: treatmentLocalId,
        tanggal,
        blok_id: location.blok_id,
        sampel: sampel ? Number(sampel) : null,
        jumlah_hidup: jumlahHidup ? Number(jumlahHidup) : null,
        jumlah_mati: jumlahMati ? Number(jumlahMati) : null,
        kondisi: kondisi || null,
        foto_local_id: photo ? local_id : null,
        gps_lat: gps.gps_lat,
        gps_lng: gps.gps_lng,
        gps_accuracy: gps.gps_accuracy,
        gps_timestamp: gps.gps_timestamp,
        hasil_efektivitas_lokal: effectiveness.hasil_efektivitas,
        service_required_lokal: effectiveness.service_required ? 1 : 0,
        status: 'SELESAI',
      });

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: 'MORTALITY',
          entity_local_id: local_id,
          file_uri: photo.uri,
          gps_lat: gps.gps_lat,
          gps_lng: gps.gps_lng,
          timestamp: now,
          user_id: user?.id ?? null,
          compressed_size: photo.size,
          uploaded: 0,
          server_photo_id: null,
        });
      }

      notifyDataChanged();
      const serviceMsg = effectiveness.service_required
        ? '\n\n⚠️ Treatment TIDAK EFEKTIF - perlu SERVICE (pengendalian ulang).'
        : '';
      const deferMsg =
        treatmentLocalId && selectedTreatment?.sync_status !== 'SYNCED'
          ? '\n\nCatatan: data ini akan menunggu Treatment terkait selesai tersinkron sebelum ikut terkirim.'
          : '';
      Alert.alert('Sensus Mortalitas tersimpan', `Data tersimpan lokal, siap disinkronkan.${serviceMsg}${deferMsg}`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!tanggal) return Alert.alert('Lengkapi data', 'Tanggal wajib diisi.');
    if (!location.blok_id) return Alert.alert('Lengkapi data', 'Blok wajib dipilih (pilih Treatment atau isi manual).');
    if (!sampel) return Alert.alert('Lengkapi data', 'Jumlah sampel wajib diisi.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Treatment Terkait">
        <SelectField
          label="Treatment (Pengendalian sebelumnya)"
          value={treatmentLocalId}
          options={treatments.map((t) => ({
            label: `${t.metode_pengendalian || 'Pengendalian'} - Blok #${t.blok_id} - ${t.tanggal_mulai || t.created_at.slice(0, 10)} (${SYNC_LABEL[t.sync_status]})`,
            value: t.local_id,
          }))}
          onChange={setTreatmentLocalId}
          placeholder={treatments.length ? 'Pilih treatment' : 'Belum ada data Pengendalian tersimpan'}
        />
        <SelectField
          label="Incident terkait"
          value={incidentId}
          options={incidents.map((i) => ({ label: `${i.incident_code} - ${i.severity}`, value: i.id }))}
          onChange={setIncidentId}
          placeholder="Opsional"
        />
      </SectionCard>

      <SectionCard title="Lokasi & Tanggal">
        <LocationCascade value={location} onChange={setLocation} />
        <FormField label="Tanggal" value={tanggal} onChangeText={setTanggal} placeholder="YYYY-MM-DD" required />
      </SectionCard>

      <SectionCard title="Hasil Pengamatan">
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Jumlah sampel" value={sampel} onChangeText={setSampel} keyboardType="number-pad" required />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Jumlah hidup" value={jumlahHidup} onChangeText={setJumlahHidup} keyboardType="number-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Jumlah mati" value={jumlahMati} onChangeText={setJumlahMati} keyboardType="number-pad" />
          </View>
        </View>
        <FormField label="Kondisi" value={kondisi} onChangeText={setKondisi} placeholder="Deskripsi kondisi pokok/serangan" />
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />

        {effectiveness.hasil_efektivitas !== 'TIDAK_DIKETAHUI' && (
          <View
            style={[
              styles.effBox,
              { borderColor: effectiveness.service_required ? colors.danger : colors.success, backgroundColor: effectiveness.service_required ? '#FBE7E4' : '#E7F5EC' },
            ]}
          >
            <Text style={[styles.effText, { color: effectiveness.service_required ? colors.danger : colors.success }]}>
              {effectiveness.service_required
                ? `⚠️ Perlu SERVICE - rasio hidup ${effectiveness.rate?.toFixed(2)} melewati ambang efektivitas`
                : `✅ Efektif - rasio hidup ${effectiveness.rate?.toFixed(2)}`}
            </Text>
          </View>
        )}
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus Mortalitas'} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal
        visible={showOutOfArea}
        blokLabel={blok?.code || '-'}
        onKembali={() => setShowOutOfArea(false)}
        onTetapSimpan={() => {
          setShowOutOfArea(false);
          doSave(true);
        }}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  effBox: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 4 },
  effText: { fontSize: 12, fontWeight: '700' },
});
