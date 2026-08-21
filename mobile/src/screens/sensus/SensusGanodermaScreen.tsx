import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../../components/ScreenContainer';
import SectionCard from '../../components/SectionCard';
import FormField from '../../components/FormField';
import SelectField from '../../components/SelectField';
import LocationCascade, { type LocationValue } from '../../components/LocationCascade';
import GpsField from '../../components/GpsField';
import Button from '../../components/Button';
import KategoriBadge from '../../components/KategoriBadge';
import OutOfAreaModal from '../../components/OutOfAreaModal';
import { useAuth } from '../../state/AuthContext';
import { useSync } from '../../state/SyncContext';
import { useAllSpecies, useBlok, useHptList, useThresholds } from '../../hooks/useMasterData';
import { computeGanoderma, GANODERMA_SCALE, GANODERMA_STATUS_OPTIONS } from '../../domain/sensusEngines';
import { checkLocationWarning } from '../../domain/geo';
import { runLocalThresholdEngine } from '../../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { takePhoto, type CapturedPhoto } from '../../domain/photo';
import { saveSensusRecord } from '../../domain/sensusSubmit';
import { insertPhoto } from '../../db/repo/photoRepo';
import { uuid } from '../../utils/uuid';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusGanoderma'>;

interface PokokEntry {
  key: string;
  baris: string;
  posisi: string;
  status_serangan: string;
  catatan: string;
  photo: CapturedPhoto | null;
  gps: GpsCapture | null;
  capturingGps: boolean;
  capturingPhoto: boolean;
}

function newEntry(): PokokEntry {
  return { key: uuid(), baris: '', posisi: '', status_serangan: 'INDIKASI_AWAL', catatan: '', photo: null, gps: null, capturingGps: false, capturingPhoto: false };
}

const STATUS_LABEL: Record<string, string> = {
  TIDAK_ADA: 'Tidak ada indikasi',
  INDIKASI_AWAL: 'Indikasi awal',
  TERINFEKSI_RINGAN: 'Terinfeksi ringan',
  TERINFEKSI_SEDANG: 'Terinfeksi sedang',
  TERINFEKSI_BERAT: 'Terinfeksi berat',
};

/** Ganoderma sensus (SPEC.md section 5): "seluruh pokok", tidak ada rumus numerik - hanya
 * indikasi/status_serangan kualitatif per pokok yang ditemukan. Blok.metode_sensus untuk
 * Ganoderma = SELURUH_POKOK, yang berarti tidak ada daftar titik yang digenerate otomatis (lihat
 * buildSamplingPlan) - petugas menambahkan pokok satu per satu saat ditemukan indikasi ("+ Tambah
 * pokok"), berjalan menyisir seluruh blok. Kategori sesi = status terburuk yang ditemukan (worst-
 * of), sesuai skala ordinal TIDAK_ADA..TERINFEKSI_BERAT yang dipakai backend. */
export default function SensusGanodermaScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === 'GANODERMA') || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [entries, setEntries] = useState<PokokEntry[]>([]);
  const [catatan, setCatatan] = useState('');
  const [sessionGps, setSessionGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setSessionGps(r.data));
  }, []);

  const update = (key: string, patch: Partial<PokokEntry>) => {
    setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
  };
  const remove = (key: string) => setEntries((prev) => prev.filter((e) => e.key !== key));

  const capturePointGps = async (key: string) => {
    update(key, { capturingGps: true });
    const r = await captureGps();
    update(key, { capturingGps: false, gps: r.ok ? r.data : null });
  };
  const capturePointPhoto = async (key: string) => {
    update(key, { capturingPhoto: true });
    try {
      const photo = await takePhoto();
      if (photo) update(key, { photo });
    } finally {
      update(key, { capturingPhoto: false });
    }
  };

  const worstStatus = useMemo(() => {
    if (entries.length === 0) return 'TIDAK_ADA';
    let worst = 'TIDAK_ADA';
    let worstCode = 0;
    for (const e of entries) {
      const code = GANODERMA_SCALE[e.status_serangan] ?? 0;
      if (code > worstCode) {
        worstCode = code;
        worst = e.status_serangan;
      }
    }
    return worst;
  }, [entries]);

  const computed = computeGanoderma({ status_serangan: worstStatus });

  const engineResult = useMemo(() => {
    if (!blok || !hpt) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: computed.hasil_hitung });
  }, [blok, hpt, computed.hasil_hitung, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt) return;
    setSubmitting(true);
    try {
      const hasil = {
        status_serangan: worstStatus,
        points: entries.map((e) => ({
          baris: e.baris ? Number(e.baris) : null,
          posisi: e.posisi ? Number(e.posisi) : null,
          status_serangan: e.status_serangan,
          catatan: e.catatan || null,
          gps_lat: e.gps?.gps_lat ?? null,
          gps_lng: e.gps?.gps_lng ?? null,
        })),
      };
      const { local_id } = await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: 'GANODERMA',
        speciesId: null,
        hasil,
        hasilHitung: computed.hasil_hitung,
        jalurBaris: entries.map((e) => ({ baris: e.baris, posisi: e.posisi })),
        catatan,
        photo: null,
        gps: sessionGps,
        engineResult,
      });

      const now = new Date().toISOString();
      for (const e of entries) {
        if (!e.photo) continue;
        await insertPhoto({
          local_id: `${local_id}-${e.key}`,
          entity_type: 'SENSUS',
          entity_local_id: local_id,
          file_uri: e.photo.uri,
          gps_lat: e.gps?.gps_lat ?? sessionGps.gps_lat,
          gps_lng: e.gps?.gps_lng ?? sessionGps.gps_lng,
          timestamp: now,
          user_id: user?.id ?? null,
          compressed_size: e.photo.size,
          uploaded: 0,
          server_photo_id: null,
        });
      }

      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: kategori ${engineResult.kategori} (${STATUS_LABEL[worstStatus]}).` : '';
      Alert.alert('Sensus Ganoderma tersimpan', `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!blok || !hpt) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    const warning = checkLocationWarning(blok, sessionGps.gps_lat, sessionGps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
      </SectionCard>

      {blok && (
        <SectionCard title={`Pokok bergejala (${entries.length})`} subtitle="Tambahkan setiap pokok yang menunjukkan indikasi saat menyisir blok">
          {entries.map((e) => (
            <View key={e.key} style={styles.pointCard}>
              <View style={styles.pointHeader}>
                <Text style={styles.pointTitle}>Pokok</Text>
                <TouchableOpacity onPress={() => remove(e.key)}>
                  <Text style={styles.removeText}>Hapus</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.row}>
                <View style={styles.flex1}>
                  <FormField label="Baris" value={e.baris} onChangeText={(v) => update(e.key, { baris: v })} keyboardType="number-pad" />
                </View>
                <View style={{ width: spacing.sm }} />
                <View style={styles.flex1}>
                  <FormField label="Posisi" value={e.posisi} onChangeText={(v) => update(e.key, { posisi: v })} keyboardType="number-pad" />
                </View>
              </View>
              <SelectField
                label="Status serangan"
                required
                value={e.status_serangan}
                options={GANODERMA_STATUS_OPTIONS.map((s) => ({ label: STATUS_LABEL[s] || s, value: s }))}
                onChange={(v) => v && update(e.key, { status_serangan: v })}
              />
              <FormField label="Catatan pokok" value={e.catatan} onChangeText={(v) => update(e.key, { catatan: v })} placeholder="opsional" />
              <View style={styles.pointActions}>
                <TouchableOpacity style={styles.pointBtn} onPress={() => capturePointPhoto(e.key)} disabled={e.capturingPhoto}>
                  {e.capturingPhoto ? <ActivityIndicator size="small" /> : <Text style={styles.pointBtnText}>{e.photo ? '📷 Foto ✓' : '📷 Foto'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.pointBtn} onPress={() => capturePointGps(e.key)} disabled={e.capturingGps}>
                  {e.capturingGps ? <ActivityIndicator size="small" /> : <Text style={styles.pointBtnText}>{e.gps ? '📍 GPS ✓' : '📍 GPS'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <TouchableOpacity style={styles.addBtn} onPress={() => setEntries((prev) => [...prev, newEntry()])}>
            <Text style={styles.addBtnText}>+ Tambah pokok</Text>
          </TouchableOpacity>

          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>
              Status terburuk sesi: {STATUS_LABEL[worstStatus]} (skala {computed.hasil_hitung})
            </Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan (sesi)">
        <FormField label="Catatan umum" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <GpsField value={sessionGps} onChange={setSessionGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus Ganoderma'} onPress={handleSubmit} loading={submitting} />

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
  pointCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  pointHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pointTitle: { fontWeight: '700', color: colors.primaryDark },
  removeText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  pointActions: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  pointBtn: { backgroundColor: colors.chip, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  pointBtnText: { fontSize: 11, color: colors.primaryDark, fontWeight: '600' },
  addBtn: { borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  addBtnText: { color: colors.primaryDark, fontWeight: '700' },
  totalsBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginTop: spacing.sm },
  totalsText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
});
