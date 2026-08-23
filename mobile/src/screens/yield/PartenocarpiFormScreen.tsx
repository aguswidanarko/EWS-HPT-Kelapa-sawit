import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
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
import { useBlok, useHptList } from '../../hooks/useMasterData';
import { checkLocationWarning } from '../../domain/geo';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { checkMinimumSample } from '../../domain/samplingAssistant';
import type { CapturedPhoto } from '../../domain/photo';
import { insertYieldPartenocarpi } from '../../db/repo/yieldRepo';
import { insertPhoto } from '../../db/repo/photoRepo';
import { uuid } from '../../utils/uuid';
import { nowIso, todayDateStr, toNumberOrNull, round } from '../../utils/format';
import { getDeviceId } from '../../utils/device';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Partenocarpi'>;

/** Partenocarpi / Elaeidobius (SPEC_V2.md section 2/5): kategori/ews_alert are computed by the
 * server's generic rule engine (services/ruleEngine.js, AND_OR formula over populasi_ek/rainfall_mm/
 * indikator_hujan_pagi/abnormal_bunch_pct) - there is no local mirror of that engine here (judgment
 * call, see final report), so this form shows "menunggu sinkronisasi" until the record syncs and the
 * server's classification is written back locally. */
export default function PartenocarpiFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const hpt = hptList.find((h) => h.code === 'PARTENOCARPI') || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [periode, setPeriode] = useState(todayDateStr().slice(0, 7)); // YYYY-MM
  const [barisDisensus, setBarisDisensus] = useState('');
  const [rainfallMm, setRainfallMm] = useState('');
  const [indikatorHujanPagi, setIndikatorHujanPagi] = useState('');
  const [totalBunch, setTotalBunch] = useState('');
  const [abnormalBunch, setAbnormalBunch] = useState('');
  const [populasiEk, setPopulasiEk] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const [minSample, setMinSample] = useState<{ minimum: number | null; belowMinimum: boolean }>({ minimum: 6, belowMinimum: false });

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  useEffect(() => {
    checkMinimumSample(hpt?.id ?? null, 'PARTENOCARPI', Number(barisDisensus) || 0).then((r) =>
      setMinSample({ minimum: r.minimum, belowMinimum: r.belowMinimum })
    );
  }, [hpt?.id, barisDisensus]);

  const abnormalBunchPct = useMemo(() => {
    const total = Number(totalBunch) || 0;
    const abnormal = Number(abnormalBunch) || 0;
    if (total <= 0) return null;
    return round((abnormal / total) * 100, 2);
  }, [totalBunch, abnormalBunch]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertYieldPartenocarpi({
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
        tanggal,
        periode: periode || null,
        rainfall_mm: toNumberOrNull(rainfallMm),
        indikator_hujan_pagi: toNumberOrNull(indikatorHujanPagi),
        total_bunch: toNumberOrNull(totalBunch),
        abnormal_bunch: toNumberOrNull(abnormalBunch),
        abnormal_bunch_pct: abnormalBunchPct,
        populasi_ek: toNumberOrNull(populasiEk),
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
          entity_type: 'YIELD_PARTENOCARPI',
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
      Alert.alert('Partenocarpi tersimpan', 'Data tersimpan lokal dan siap disinkronkan. Kategori/alert akan dihitung server saat sinkron.', [
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
    if (!totalBunch) return Alert.alert('Lengkapi data', 'Total bunch wajib diisi.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi & Periode">
        <LocationCascade value={location} onChange={setLocation} />
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Tanggal" value={tanggal} editable={false} />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Periode" value={periode} onChangeText={setPeriode} placeholder="YYYY-MM" />
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Sampling Assistant" subtitle="Sesuai sampling_rule Partenocarpi (baca dari server, fallback FR jika belum sinkron)">
        <FormField
          label="Jumlah baris yang disensus"
          value={barisDisensus}
          onChangeText={setBarisDisensus}
          keyboardType="number-pad"
          hint={minSample.minimum !== null ? `Minimal ${minSample.minimum} baris sensus/blok.` : undefined}
        />
        {minSample.belowMinimum && (
          <Text style={styles.warnText}>⚠️ Baris yang disensus di bawah minimum ({minSample.minimum} baris) - hasil mungkin kurang representatif.</Text>
        )}
      </SectionCard>

      <SectionCard title="Curah Hujan">
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Curah hujan (mm/bulan)" value={rainfallMm} onChangeText={setRainfallMm} keyboardType="decimal-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField
              label="Hujan periode pagi-siang (mm)"
              value={indikatorHujanPagi}
              onChangeText={setIndikatorHujanPagi}
              keyboardType="decimal-pad"
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Fruit Set & Populasi EK">
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Total bunch" value={totalBunch} onChangeText={setTotalBunch} keyboardType="number-pad" required />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Abnormal bunch" value={abnormalBunch} onChangeText={setAbnormalBunch} keyboardType="number-pad" />
          </View>
        </View>
        <FormField label="Abnormal bunch (%) - dihitung otomatis" value={abnormalBunchPct !== null ? String(abnormalBunchPct) : '-'} editable={false} />
        <FormField label="Populasi Elaeidobius kamerunicus (ekor/ha)" value={populasiEk} onChangeText={setPopulasiEk} keyboardType="number-pad" />
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Partenocarpi'} onPress={handleSubmit} loading={submitting} />

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
  warnText: { color: colors.warning, fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: spacing.sm },
});
