import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import ScreenContainer from '../../components/ScreenContainer';
import SectionCard from '../../components/SectionCard';
import FormField from '../../components/FormField';
import LocationCascade, { type LocationValue } from '../../components/LocationCascade';
import GpsField from '../../components/GpsField';
import PhotoField from '../../components/PhotoField';
import Button from '../../components/Button';
import OutOfAreaModal from '../../components/OutOfAreaModal';
import { useAuth } from '../../state/AuthContext';
import { useSync } from '../../state/SyncContext';
import { useBlok } from '../../hooks/useMasterData';
import { checkLocationWarning } from '../../domain/geo';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import type { CapturedPhoto } from '../../domain/photo';
import { insertWaterManagement } from '../../db/repo/yieldRepo';
import { insertPhoto } from '../../db/repo/photoRepo';
import { uuid } from '../../utils/uuid';
import { nowIso, todayDateStr, toNumberOrNull } from '../../utils/format';
import { getDeviceId } from '../../utils/device';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'WaterManagement'>;

/** Water Management (SPEC_V2.md section 2/5): FR target normal 40-60cm below ground, alert if
 * <40cm; sensus level air paling lambat tgl 25/bulan, per titik parit. Server computes
 * kategori/ews_alert (THRESHOLD formula on water_level_cm); this form only records the observation. */
export default function WaterManagementFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [titikParit, setTitikParit] = useState('');
  const [waterLevelCm, setWaterLevelCm] = useState('');
  const [flooding, setFlooding] = useState(false);
  const [floodingDurationHari, setFloodingDurationHari] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertWaterManagement({
        local_id,
        server_id: null,
        server_row_id: null,
        incident_id: null,
        user_id: user?.id ?? null,
        device_id,
        created_at: now,
        updated_at: now,
        sync_status: 'READY_TO_SYNC',
        sync_attempt: 0,
        sync_error: null,
        source: 'MOBILE',
        estate_id: location.estate_id,
        afdeling_id: location.afdeling_id,
        blok_id: blok.id,
        titik_parit: titikParit || null,
        tanggal,
        water_level_cm: toNumberOrNull(waterLevelCm),
        flooding: flooding ? 1 : 0,
        flooding_duration_hari: toNumberOrNull(floodingDurationHari),
        kategori_lokal: null,
        ews_alert_lokal: 0,
        gps_lat: gps.gps_lat,
        gps_lng: gps.gps_lng,
        gps_accuracy: gps.gps_accuracy,
        gps_timestamp: gps.gps_timestamp,
        location_warning: locationWarning ? 1 : 0,
        foto_local_id: photo ? local_id : null,
        catatan: catatan || null,
      });

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: 'WATER_MANAGEMENT',
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
      Alert.alert('Water Management tersimpan', 'Data tersimpan lokal dan siap disinkronkan.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!location.blok_id) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    if (!titikParit.trim()) return Alert.alert('Lengkapi data', 'Titik parit wajib diisi.');
    if (!waterLevelCm) return Alert.alert('Lengkapi data', 'Level air wajib diisi.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi & Titik Parit">
        <LocationCascade value={location} onChange={setLocation} />
        <FormField label="Titik parit" value={titikParit} onChangeText={setTitikParit} placeholder="cth. Parit A-3" required />
        <FormField label="Tanggal" value={tanggal} editable={false} />
      </SectionCard>

      <SectionCard title="Level Air" subtitle="Target normal: 40-60 cm di bawah permukaan tanah (FR)">
        <FormField label="Level air (cm)" value={waterLevelCm} onChangeText={setWaterLevelCm} keyboardType="decimal-pad" required />
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Ada genangan?</Text>
          <Switch value={flooding} onValueChange={setFlooding} />
        </View>
        {flooding && (
          <FormField
            label="Lama genangan (hari)"
            value={floodingDurationHari}
            onChangeText={setFloodingDurationHari}
            keyboardType="number-pad"
            hint="FR: genangan > 20 hari perlu evaluasi water management segera."
          />
        )}
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Water Management'} onPress={handleSubmit} loading={submitting} />

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
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  switchLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
});
