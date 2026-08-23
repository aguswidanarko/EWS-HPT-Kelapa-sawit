import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
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
import { useBlok, useHptList } from '../../hooks/useMasterData';
import { checkLocationWarning } from '../../domain/geo';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { checkMinimumSample } from '../../domain/samplingAssistant';
import type { CapturedPhoto } from '../../domain/photo';
import { insertTbmVegetatif } from '../../db/repo/yieldRepo';
import { insertPhoto } from '../../db/repo/photoRepo';
import { uuid } from '../../utils/uuid';
import { nowIso, todayDateStr, toNumberOrNull } from '../../utils/format';
import { getDeviceId } from '../../utils/device';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'TbmVegetatif'>;

// SPEC_V2.md section 5 "Target produksi" table (acuan Goal, bukan threshold alert).
const TARGET_PRODUKSI_BY_FASE: Record<string, number> = { TBM2: 10, TBM3: 20, TM: 30 };

// Matches services/ruleEngine.js's CATEGORICAL_CONDITION scale for TBM_VEGETATIF exactly
// (db/seed.js: { SESUAI_STANDAR: 0, DI_BAWAH_STANDAR: 1 }) - the labels here must equal those keys.
const HASIL_EVALUASI_OPTIONS = ['SESUAI_STANDAR', 'DI_BAWAH_STANDAR'];

/** TBM Sehat / Standar Vegetatif (SPEC_V2.md section 2/5): FR gives no numeric growth standard per
 * age, so classification uses the qualitative `hasil_evaluasi` field rather than deriving from
 * panjang_pelepah_cm/jumlah_pelepah/lai directly (judgment call, matches db/seed.js's formula
 * comment for TBM_VEGETATIF - not invented here). Minimum sampel 1% dari populasi (FR "sampel pokok
 * 1%") is surfaced via the Sampling Assistant just like Partenocarpi. */
export default function TbmVegetatifFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const hpt = hptList.find((h) => h.code === 'TBM_VEGETATIF') || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [umurBulan, setUmurBulan] = useState('');
  const [pokokDiamati, setPokokDiamati] = useState('');
  const [panjangPelepahCm, setPanjangPelepahCm] = useState('');
  const [jumlahPelepah, setJumlahPelepah] = useState('');
  const [lai, setLai] = useState('');
  const [targetProduksi, setTargetProduksi] = useState('');
  const [hasilEvaluasi, setHasilEvaluasi] = useState<string | null>(null);
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);
  const [minSample, setMinSample] = useState<{ minimum: number | null; belowMinimum: boolean }>({ minimum: null, belowMinimum: false });

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  useEffect(() => {
    checkMinimumSample(hpt?.id ?? null, 'TBM_VEGETATIF', Number(pokokDiamati) || 0).then((r) =>
      setMinSample({ minimum: r.minimum, belowMinimum: r.belowMinimum })
    );
  }, [hpt?.id, pokokDiamati]);

  // Auto-suggest the target produksi reference once the fase is known - user can still override.
  useEffect(() => {
    if (!blok?.status_tanaman) return;
    const suggestion = TARGET_PRODUKSI_BY_FASE[blok.status_tanaman];
    if (suggestion !== undefined && !targetProduksi) setTargetProduksi(String(suggestion));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blok?.status_tanaman]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertTbmVegetatif({
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
        umur_bulan: toNumberOrNull(umurBulan),
        panjang_pelepah_cm: toNumberOrNull(panjangPelepahCm),
        jumlah_pelepah: toNumberOrNull(jumlahPelepah),
        lai: toNumberOrNull(lai),
        target_produksi_ton_ha: toNumberOrNull(targetProduksi),
        hasil_evaluasi: hasilEvaluasi,
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
          entity_type: 'TBM_VEGETATIF',
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
      Alert.alert('TBM Vegetatif tersimpan', 'Data tersimpan lokal dan siap disinkronkan.', [
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
    if (!hasilEvaluasi) return Alert.alert('Lengkapi data', 'Hasil evaluasi wajib dipilih.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi & Umur Tanaman">
        <LocationCascade value={location} onChange={setLocation} />
        <FormField label="Tanggal" value={tanggal} editable={false} />
        <FormField label="Umur (bulan)" value={umurBulan} onChangeText={setUmurBulan} keyboardType="number-pad" />
      </SectionCard>

      <SectionCard title="Sampling Assistant" subtitle="FR: setiap blok terdeteksi, sampel pokok 1%">
        <FormField
          label="Jumlah pokok diamati"
          value={pokokDiamati}
          onChangeText={setPokokDiamati}
          keyboardType="number-pad"
          hint={minSample.minimum !== null ? `Minimal ${minSample.minimum}% dari populasi blok (sampling_rule).` : undefined}
        />
      </SectionCard>

      <SectionCard title="Pengukuran Vegetatif">
        <FormField label="Panjang pelepah (cm)" value={panjangPelepahCm} onChangeText={setPanjangPelepahCm} keyboardType="decimal-pad" />
        <FormField label="Jumlah pelepah" value={jumlahPelepah} onChangeText={setJumlahPelepah} keyboardType="number-pad" />
        <FormField label="LAI (Leaf Area Index)" value={lai} onChangeText={setLai} keyboardType="decimal-pad" />
        <FormField
          label="Target produksi (ton/Ha)"
          value={targetProduksi}
          onChangeText={setTargetProduksi}
          keyboardType="decimal-pad"
          hint="Acuan Goal (bukan threshold alert): TBM2=10, TBM3=20, TM1=30, TM3=40 ton/Ha."
        />
        <SelectField
          label="Hasil evaluasi"
          required
          value={hasilEvaluasi}
          options={HASIL_EVALUASI_OPTIONS.map((o) => ({ label: o.replace(/_/g, ' '), value: o }))}
          onChange={setHasilEvaluasi}
        />
        {hasilEvaluasi === 'DI_BAWAH_STANDAR' && (
          <Text style={styles.warnText}>⚠️ Pertumbuhan di bawah standar umur - rekomendasi perbaikan diperlukan (FR).</Text>
        )}
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan TBM Vegetatif'} onPress={handleSubmit} loading={submitting} />

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
  warnText: { color: colors.warning, fontSize: 12, fontWeight: '600', marginTop: -4, marginBottom: 12 },
});
