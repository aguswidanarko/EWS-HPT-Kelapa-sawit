import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import FormField from '../components/FormField';
import SelectField from '../components/SelectField';
import LocationCascade, { type LocationValue } from '../components/LocationCascade';
import GpsField from '../components/GpsField';
import PhotoField from '../components/PhotoField';
import Button from '../components/Button';
import KategoriBadge from '../components/KategoriBadge';
import OutOfAreaModal from '../components/OutOfAreaModal';
import { useAuth } from '../state/AuthContext';
import { useSync } from '../state/SyncContext';
import { useHptList, useSpeciesByHpt, useThresholds, useAllSpecies, useBlok } from '../hooks/useMasterData';
import { checkLocationWarning } from '../domain/geo';
import { runLocalThresholdEngine } from '../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import type { CapturedPhoto } from '../domain/photo';
import { insertDetection } from '../db/repo/detectionRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { uuid } from '../utils/uuid';
import { nowIso, nowTimeStr, todayDateStr, toNumberOrNull } from '../utils/format';
import { getDeviceId } from '../utils/device';
import type { GpsCapture } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Deteksi'>;

export default function DeteksiFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();

  const [terlihatIndikasi, setTerlihatIndikasi] = useState(true);
  const [tanggal] = useState(todayDateStr());
  const [waktu, setWaktu] = useState(nowTimeStr());
  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const [baris, setBaris] = useState('');
  const [posisi, setPosisi] = useState('');
  const [hptId, setHptId] = useState<number | null>(null);
  const [speciesId, setSpeciesId] = useState<number | null>(null);
  const [gejala, setGejala] = useState('');
  const [kondisiIndikator, setKondisiIndikator] = useState('');
  const [jumlahIndikasi, setJumlahIndikasi] = useState('');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  const blok = useBlok(location.blok_id);
  const speciesForHpt = useSpeciesByHpt(hptId);
  const selectedHpt = hptList.find((h) => h.id === hptId) || null;

  // One-shot capture triggered when the form opens (not continuous) - user can re-capture any time.
  useEffect(() => {
    captureGps().then((r) => {
      if (r.ok) setGps(r.data);
    });
  }, []);

  const localEngineResult = useMemo(() => {
    const jumlah = toNumberOrNull(jumlahIndikasi);
    if (jumlah === null || !hptId || !blok) return null;
    return runLocalThresholdEngine({
      thresholds,
      species: allSpecies,
      blok,
      hpt_id: hptId,
      species_id: speciesId,
      nilai_hasil: jumlah,
    });
  }, [jumlahIndikasi, hptId, speciesId, blok, thresholds, allSpecies]);

  const resetForm = () => {
    setTerlihatIndikasi(true);
    setBaris('');
    setPosisi('');
    setHptId(null);
    setSpeciesId(null);
    setGejala('');
    setKondisiIndikator('');
    setJumlahIndikasi('');
    setCatatan('');
    setPhoto(null);
    setWaktu(nowTimeStr());
  };

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const activity_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();
      const jumlah = toNumberOrNull(jumlahIndikasi);

      await insertDetection({
        local_id,
        server_id: null,
        server_row_id: null,
        activity_id,
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
        baris: baris ? Number(baris) : null,
        posisi: posisi ? Number(posisi) : null,
        tanggal,
        waktu,
        hpt_id: hptId as number,
        species_id: speciesId,
        gejala: terlihatIndikasi ? gejala || null : 'Tidak ada indikasi terlihat',
        kondisi_indikator: kondisiIndikator || null,
        jumlah_indikasi: jumlah,
        catatan: catatan || null,
        foto_local_id: photo ? local_id : null,
        gps_lat: gps.gps_lat,
        gps_lng: gps.gps_lng,
        gps_accuracy: gps.gps_accuracy,
        gps_timestamp: gps.gps_timestamp,
        location_warning: locationWarning ? 1 : 0,
        kategori_lokal: localEngineResult?.kategori ?? null,
        ews_alert_lokal: localEngineResult?.ews_alert ? 1 : 0,
      });

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: 'DETECTION',
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

      const alertMsg = localEngineResult?.ews_alert
        ? `\n\n🔴 ALERT HPT: kategori ${localEngineResult.kategori}. Data akan ditandai untuk ditinjau saat sinkron.`
        : '';
      Alert.alert('Deteksi tersimpan', `Data deteksi berhasil disimpan secara lokal dan siap disinkronkan.${alertMsg}`, [
        {
          text: 'OK',
          onPress: () => {
            resetForm();
            navigation.goBack();
          },
        },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!location.blok_id || !hptId || !tanggal) {
      Alert.alert('Lengkapi data', 'Estate/Afdeling/Blok dan Hama/Penyakit wajib dipilih.');
      return;
    }
    if (terlihatIndikasi && !gejala.trim()) {
      Alert.alert('Lengkapi data', 'Gejala wajib diisi jika Anda melihat indikasi hama/penyakit.');
      return;
    }
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) {
      setShowOutOfArea(true);
      return;
    }
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Pertanyaan Dasar">
        <Text style={styles.question}>1. Apakah Anda melihat indikasi hama/penyakit?</Text>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>{terlihatIndikasi ? 'Ya, ada indikasi' : 'Tidak ada indikasi'}</Text>
          <Switch value={terlihatIndikasi} onValueChange={setTerlihatIndikasi} />
        </View>

        <Text style={styles.question}>2. Hama/penyakit apa?</Text>
        <SelectField
          label="HPT"
          required
          value={hptId}
          options={hptList.map((h) => ({ label: `${h.name} (${h.code})`, value: h.id }))}
          onChange={(v) => {
            setHptId(v);
            setSpeciesId(null);
          }}
        />
        {selectedHpt && speciesForHpt.length > 0 && (
          <SelectField
            label="Spesies"
            value={speciesId}
            options={speciesForHpt.map((s) => ({ label: `${s.name} (${s.code})`, value: s.id }))}
            onChange={setSpeciesId}
            hint="Wajib dipilih agar klasifikasi threshold otomatis (spesies-aware) dapat dihitung."
          />
        )}

        <Text style={styles.question}>3. Di mana lokasinya?</Text>
        <LocationCascade value={location} onChange={setLocation} />
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Baris" value={baris} onChangeText={setBaris} keyboardType="number-pad" placeholder="cth. 13" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField
              label="Posisi relatif pokok"
              value={posisi}
              onChangeText={setPosisi}
              keyboardType="number-pad"
              placeholder="opsional"
            />
          </View>
        </View>
      </SectionCard>

      <SectionCard title="Detail Pengamatan">
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Tanggal" value={tanggal} editable={false} />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Waktu" value={waktu} onChangeText={setWaktu} placeholder="HH:MM" />
          </View>
        </View>
        <FormField
          label="Gejala"
          value={gejala}
          onChangeText={setGejala}
          multiline
          numberOfLines={3}
          placeholder="cth. Daun berlubang, pucuk terpotong huruf V, ..."
          required={terlihatIndikasi}
        />
        <FormField
          label="Kondisi / indikator"
          value={kondisiIndikator}
          onChangeText={setKondisiIndikator}
          placeholder="cth. Ringan / Sedang / Berat (deskriptif petugas)"
        />
        <FormField
          label={`Jumlah / tingkat indikasi ${selectedHpt?.satuan ? `(${selectedHpt.satuan})` : ''}`}
          value={jumlahIndikasi}
          onChangeText={setJumlahIndikasi}
          keyboardType="decimal-pad"
          placeholder="Angka kuantitatif jika ada"
          hint="Diisi jika parameter kuantitatif tersedia - threshold akan dihitung otomatis."
        />
        {localEngineResult && <KategoriBadge kategori={localEngineResult.kategori} alert={localEngineResult.ews_alert} />}
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Deteksi'} onPress={handleSubmit} loading={submitting} />

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
  question: { fontSize: 13, fontWeight: '700', color: colors.primaryDark, marginTop: spacing.sm, marginBottom: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  switchLabel: { fontSize: 13, color: colors.text },
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
});
