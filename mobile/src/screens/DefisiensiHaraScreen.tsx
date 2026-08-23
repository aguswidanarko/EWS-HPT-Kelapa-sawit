import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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
import { useBlok } from '../hooks/useMasterData';
import { checkLocationWarning } from '../domain/geo';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import type { CapturedPhoto } from '../domain/photo';
import { getCachedLeafAnalysis, insertDefisiensiHaraTemuan } from '../db/repo/defisiensiHaraRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { uuid } from '../utils/uuid';
import { nowIso, todayDateStr, formatDate } from '../utils/format';
import { getDeviceId } from '../utils/device';
import type { CachedLeafAnalysis, GpsCapture } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, severityColor, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'DefisiensiHara'>;

const SEVERITY_OPTIONS = ['TIDAK_ADA', 'RINGAN', 'SEDANG', 'BERAT'];

/** SPEC_V2.md section 4 Mobile + BRD Mobile section 16: shows the blok defisiensi list from
 * leaf_analysis (Riset's lab reference, read-only, cached by sync/engine.ts downloadAll()) and lets
 * the field officer record a defisiensi_hara_temuan against it (or standalone if Riset hasn't
 * flagged that blok yet - leaf_analysis_id is optional on the temuan). */
export default function DefisiensiHaraScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();

  const [leafAnalysisList, setLeafAnalysisList] = useState<CachedLeafAnalysis[]>([]);
  const [selectedLeaf, setSelectedLeaf] = useState<CachedLeafAnalysis | null>(null);

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [unsurHara, setUnsurHara] = useState('');
  const [temuanLapangan, setTemuanLapangan] = useState('');
  const [severity, setSeverity] = useState<string | null>(null);
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  const loadLeafAnalysis = useCallback(() => {
    getCachedLeafAnalysis().then(setLeafAnalysisList);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadLeafAnalysis();
    }, [loadLeafAnalysis])
  );

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  const pickLeaf = (leaf: CachedLeafAnalysis) => {
    setSelectedLeaf(leaf);
    setUnsurHara(leaf.unsur_hara);
    if (leaf.blok_id) setLocation((prev) => ({ ...prev, blok_id: leaf.blok_id }));
  };

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertDefisiensiHaraTemuan({
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
        leaf_analysis_id: selectedLeaf?.id ?? null,
        estate_id: location.estate_id,
        afdeling_id: location.afdeling_id,
        blok_id: blok.id,
        tanggal,
        unsur_hara: unsurHara || null,
        temuan_lapangan: temuanLapangan || null,
        severity,
        status: 'OPEN',
        action_plan_id: null,
        evidence_photo_id: null,
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
          entity_type: 'DEFISIENSI_HARA_TEMUAN',
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
      Alert.alert('Temuan defisiensi hara tersimpan', 'Data tersimpan lokal dan siap disinkronkan.', [
        {
          text: 'OK',
          onPress: () => {
            setSelectedLeaf(null);
            setUnsurHara('');
            setTemuanLapangan('');
            setSeverity(null);
            setCatatan('');
            setPhoto(null);
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
    if (!location.blok_id) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    if (!unsurHara.trim()) return Alert.alert('Lengkapi data', 'Unsur hara wajib diisi.');
    if (!severity) return Alert.alert('Lengkapi data', 'Severity wajib dipilih.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Blok Defisiensi (dari Riset)" subtitle="Referensi leaf_analysis - hanya-baca, tersinkron dari server">
        {leafAnalysisList.length === 0 ? (
          <Text style={styles.empty}>Belum ada data leaf_analysis tersinkron. Jalankan sinkronisasi terlebih dahulu.</Text>
        ) : (
          leafAnalysisList.map((leaf) => (
            <TouchableOpacity
              key={leaf.id}
              style={[styles.leafRow, selectedLeaf?.id === leaf.id ? styles.leafRowActive : undefined]}
              onPress={() => pickLeaf(leaf)}
            >
              <View style={[styles.dot, { backgroundColor: severityColor[leaf.severity || ''] || '#999' }]} />
              <View style={styles.flex1}>
                <Text style={styles.leafTitle}>
                  Blok #{leaf.blok_id ?? '-'} - {leaf.unsur_hara} {leaf.severity ? `(${leaf.severity})` : ''}
                </Text>
                <Text style={styles.leafSub}>
                  {formatDate(leaf.tanggal)} - {leaf.hasil || '-'} - status {leaf.status}
                </Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </SectionCard>

      <SectionCard title="Input Temuan Lapangan">
        <LocationCascade value={location} onChange={setLocation} />
        <FormField label="Tanggal" value={tanggal} editable={false} />
        <FormField
          label="Unsur hara"
          value={unsurHara}
          onChangeText={setUnsurHara}
          placeholder="cth. N, P, K, Mg, B, ..."
          hint="Free text - mengikuti master unsur hara dari Riset (SPEC_V2.md)."
          required
        />
        <FormField
          label="Temuan lapangan"
          value={temuanLapangan}
          onChangeText={setTemuanLapangan}
          multiline
          numberOfLines={3}
          placeholder="Deskripsi gejala visual yang ditemukan di lapangan"
        />
        <SelectField label="Severity" required value={severity} options={SEVERITY_OPTIONS.map((s) => ({ label: s, value: s }))} onChange={setSeverity} />
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Temuan'} onPress={handleSubmit} loading={submitting} />

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
  empty: { fontSize: 12, color: colors.textMuted, paddingVertical: spacing.sm },
  leafRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  leafRowActive: { backgroundColor: colors.chip, borderRadius: 8, paddingHorizontal: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  flex1: { flex: 1 },
  leafTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  leafSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
