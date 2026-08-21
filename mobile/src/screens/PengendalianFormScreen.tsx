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
import { useBlok, useHptList } from '../hooks/useMasterData';
import { checkLocationWarning } from '../domain/geo';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import type { CapturedPhoto } from '../domain/photo';
import { insertTreatment } from '../db/repo/treatmentRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { getCachedIncidents } from '../db/repo/masterRepo';
import { uuid } from '../utils/uuid';
import { nowIso, todayDateStr } from '../utils/format';
import { getDeviceId } from '../utils/device';
import type { CachedIncident, GpsCapture } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Pengendalian'>;

// SPEC.md section 6: "metode (drone spraying, fogging, manual, racun tikus, lainnya dari master)".
// The backend has no dedicated metode-pengendalian master table/endpoint (see README.md "Backend
// gaps") - metode_pengendalian is stored as free text on TREATMENT, so this fixed list matches the
// BRD's own examples, with "Lainnya" revealing free text for anything not listed.
const METODE_OPTIONS = ['Drone spraying', 'Fogging', 'Manual', 'Racun tikus', 'Lainnya'];

export default function PengendalianFormScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [hptId, setHptId] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<CachedIncident[]>([]);
  const [incidentId, setIncidentId] = useState<number | null>(null);
  const [manualIncident, setManualIncident] = useState('');
  const [luasSerangan, setLuasSerangan] = useState('');
  const [metode, setMetode] = useState<string | null>(null);
  const [metodeLainnya, setMetodeLainnya] = useState('');
  const [tanggalMulai, setTanggalMulai] = useState(todayDateStr());
  const [tanggalSelesai, setTanggalSelesai] = useState('');
  const [jumlahPokok, setJumlahPokok] = useState('');
  const [hk, setHk] = useState('');
  const [material, setMaterial] = useState('');
  const [jumlahMaterial, setJumlahMaterial] = useState('');
  const [alat, setAlat] = useState('');
  const [pic, setPic] = useState(user?.name ?? '');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
    getCachedIncidents().then(setIncidents);
  }, []);

  const relevantIncidents = useMemo(
    () => incidents.filter((i) => (!location.blok_id || i.blok_id === location.blok_id) && (!hptId || i.hpt_id === hptId)),
    [incidents, location.blok_id, hptId]
  );

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hptId) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const activity_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();
      const resolvedIncident = incidentId ?? (manualIncident.trim() ? Number(manualIncident.trim()) : null);
      const finalMetode = metode === 'Lainnya' ? metodeLainnya || 'Lainnya' : metode;

      await insertTreatment({
        local_id,
        server_id: null,
        server_row_id: null,
        activity_id,
        incident_id: Number.isFinite(resolvedIncident) ? resolvedIncident : null,
        user_id: user?.id ?? null,
        device_id,
        created_at: now,
        updated_at: now,
        sync_status: 'READY_TO_SYNC',
        sync_attempt: 0,
        sync_error: null,
        source: 'MOBILE',
        hpt_id: hptId,
        estate_id: location.estate_id,
        afdeling_id: location.afdeling_id,
        blok_id: blok.id,
        luas_serangan: luasSerangan ? Number(luasSerangan) : null,
        metode_pengendalian: finalMetode,
        tanggal_mulai: tanggalMulai || null,
        tanggal_selesai: tanggalSelesai || null,
        jumlah_pokok: jumlahPokok ? Number(jumlahPokok) : null,
        hk: hk ? Number(hk) : null,
        material: material || null,
        jumlah_material: jumlahMaterial || null,
        alat: alat || null,
        pic: pic || null,
        catatan: catatan || null,
        foto_local_id: photo ? local_id : null,
        gps_lat: gps.gps_lat,
        gps_lng: gps.gps_lng,
        gps_accuracy: gps.gps_accuracy,
        gps_timestamp: gps.gps_timestamp,
        status: tanggalSelesai ? 'SELESAI' : 'BERJALAN',
      });

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: 'TREATMENT',
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
      Alert.alert('Pengendalian tersimpan', 'Data pengendalian berhasil disimpan lokal dan siap disinkronkan.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!location.blok_id || !hptId) return Alert.alert('Lengkapi data', 'Blok dan HPT wajib dipilih.');
    if (!metode) return Alert.alert('Lengkapi data', 'Metode pengendalian wajib dipilih.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Kasus & Lokasi">
        <SelectField
          label="Hama/Penyakit (HPT)"
          required
          value={hptId}
          options={hptList.map((h) => ({ label: h.name, value: h.id }))}
          onChange={setHptId}
        />
        <LocationCascade value={location} onChange={setLocation} />
        <SelectField
          label="Incident terkait (jika ada)"
          value={incidentId}
          options={relevantIncidents.map((i) => ({ label: `${i.incident_code} - ${i.severity}`, value: i.id }))}
          onChange={setIncidentId}
          placeholder={relevantIncidents.length ? 'Pilih incident' : 'Tidak ada incident tersimpan - isi manual di bawah'}
          disabled={relevantIncidents.length === 0}
        />
        {!incidentId && (
          <FormField
            label="Incident ID manual (opsional)"
            value={manualIncident}
            onChangeText={setManualIncident}
            keyboardType="number-pad"
            hint="Kosongkan jika tidak tahu - server akan menautkan otomatis ke incident terbuka pada blok/HPT ini."
          />
        )}
      </SectionCard>

      <SectionCard title="Detail Pengendalian">
        <FormField label="Luas serangan (ha)" value={luasSerangan} onChangeText={setLuasSerangan} keyboardType="decimal-pad" />
        <SelectField label="Metode" required value={metode} options={METODE_OPTIONS.map((m) => ({ label: m, value: m }))} onChange={setMetode} />
        {metode === 'Lainnya' && <FormField label="Sebutkan metode lain" value={metodeLainnya} onChangeText={setMetodeLainnya} />}
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Tanggal mulai" value={tanggalMulai} onChangeText={setTanggalMulai} placeholder="YYYY-MM-DD" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Tanggal selesai" value={tanggalSelesai} onChangeText={setTanggalSelesai} placeholder="YYYY-MM-DD (opsional)" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Jumlah pokok" value={jumlahPokok} onChangeText={setJumlahPokok} keyboardType="number-pad" />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="HK (hari kerja)" value={hk} onChangeText={setHk} keyboardType="decimal-pad" />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <FormField label="Material" value={material} onChangeText={setMaterial} />
          </View>
          <View style={{ width: spacing.md }} />
          <View style={styles.flex1}>
            <FormField label="Jumlah material" value={jumlahMaterial} onChangeText={setJumlahMaterial} placeholder="cth. 5 liter" />
          </View>
        </View>
        <FormField label="Alat" value={alat} onChangeText={setAlat} />
        <FormField label="PIC" value={pic} onChangeText={setPic} />
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Pengendalian'} onPress={handleSubmit} loading={submitting} />

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
});
