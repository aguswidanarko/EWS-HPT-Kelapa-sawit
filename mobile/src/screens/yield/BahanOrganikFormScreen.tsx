import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import ScreenContainer from '../../components/ScreenContainer';
import SectionCard from '../../components/SectionCard';
import FormField from '../../components/FormField';
import SelectField from '../../components/SelectField';
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
import { insertBahanOrganik } from '../../db/repo/yieldRepo';
import { insertPhoto } from '../../db/repo/photoRepo';
import { uuid } from '../../utils/uuid';
import { nowIso, todayDateStr, toNumberOrNull, round } from '../../utils/format';
import { getDeviceId } from '../../utils/device';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BahanOrganik'>;

const AREA_TYPE_OPTIONS = ['PASIR', 'NON_PASIR'];

/** Bahan Organik / Area Pasir (SPEC_V2.md section 2/5): FR ambang daun menguning >5% (TM) ->
 * evaluasi bahan organik/pemupukan. Perbandingan TBM ke baseline tetap kualitatif/manual (tidak ada
 * formula otomatis untuk comparison_result - lihat db/seed.js catatan formula BAHAN_ORGANIK). */
export default function BahanOrganikFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [areaType, setAreaType] = useState<string | null>('PASIR');
  const [totalSample, setTotalSample] = useState('');
  const [yellowingCount, setYellowingCount] = useState('');
  const [vegetativeCondition, setVegetativeCondition] = useState('');
  const [baselineTbmNormal, setBaselineTbmNormal] = useState('');
  const [comparisonResult, setComparisonResult] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  const yellowingPct = useMemo(() => {
    const total = Number(totalSample) || 0;
    const yellow = Number(yellowingCount) || 0;
    if (total <= 0) return null;
    return round((yellow / total) * 100, 2);
  }, [totalSample, yellowingCount]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertBahanOrganik({
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
        area_type: areaType,
        tanggal,
        total_sample: toNumberOrNull(totalSample),
        yellowing_count: toNumberOrNull(yellowingCount),
        yellowing_pct: yellowingPct,
        vegetative_condition: vegetativeCondition || null,
        baseline_tbm_normal: baselineTbmNormal || null,
        comparison_result: comparisonResult || null,
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
          entity_type: 'BAHAN_ORGANIK',
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
      Alert.alert('Bahan Organik tersimpan', 'Data tersimpan lokal dan siap disinkronkan.', [
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
    if (!totalSample) return Alert.alert('Lengkapi data', 'Total sampel wajib diisi.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi & Area">
        <LocationCascade value={location} onChange={setLocation} />
        <SelectField label="Tipe area" value={areaType} options={AREA_TYPE_OPTIONS.map((a) => ({ label: a, value: a }))} onChange={setAreaType} />
        <FormField label="Tanggal" value={tanggal} editable={false} />
      </SectionCard>

      <SectionCard title="Daun Menguning" subtitle="FR: daun menguning > 5% (TM) -> evaluasi bahan organik/pemupukan">
        <FormField label="Total sampel" value={totalSample} onChangeText={setTotalSample} keyboardType="number-pad" required />
        <FormField label="Jumlah daun menguning" value={yellowingCount} onChangeText={setYellowingCount} keyboardType="number-pad" />
        <FormField label="Persentase menguning (%) - dihitung otomatis" value={yellowingPct !== null ? String(yellowingPct) : '-'} editable={false} />
      </SectionCard>

      <SectionCard title="Perbandingan TBM (kualitatif)" subtitle="Perbandingan ke baseline TBM normal tetap penilaian manual petugas (FR)">
        <FormField label="Kondisi vegetatif" value={vegetativeCondition} onChangeText={setVegetativeCondition} placeholder="cth. Normal / Kurang subur" />
        <FormField label="Baseline TBM normal (acuan)" value={baselineTbmNormal} onChangeText={setBaselineTbmNormal} placeholder="cth. deskripsi/angka acuan blok pembanding" />
        <FormField label="Hasil perbandingan" value={comparisonResult} onChangeText={setComparisonResult} placeholder="cth. Sesuai baseline / Di bawah baseline" />
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Bahan Organik'} onPress={handleSubmit} loading={submitting} />

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
