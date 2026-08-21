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
import KategoriBadge from '../../components/KategoriBadge';
import OutOfAreaModal from '../../components/OutOfAreaModal';
import { useAuth } from '../../state/AuthContext';
import { useSync } from '../../state/SyncContext';
import { useAllSpecies, useBlok, useHptList, useThresholds } from '../../hooks/useMasterData';
import { buildSamplingPlan, computeOryctes } from '../../domain/sensusEngines';
import { checkLocationWarning } from '../../domain/geo';
import { runLocalThresholdEngine } from '../../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { saveSensusRecord } from '../../domain/sensusSubmit';
import type { CapturedPhoto } from '../../domain/photo';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { round } from '../../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusOryctes'>;

interface BarisRow {
  baris: number;
  serangan_baru: string;
  serangan_lama: string;
  normal: string;
  stagnan: string;
  recovery: string;
  mati: string;
  jumlah_sampel: string;
}
function emptyRow(baris: number): BarisRow {
  return { baris, serangan_baru: '', serangan_lama: '', normal: '', stagnan: '', recovery: '', mati: '', jumlah_sampel: '' };
}

/** Oryctes sensus (SPEC.md section 5): % serangan = jumlah_pokok_terserang / jumlah_pokok_diamati
 * x 100%. "Pokok terserang" = serangan_baru + serangan_lama (active attack); normal/stagnan/
 * recovery/mati are recorded for condition tracking but don't feed the ratio itself. */
export default function SensusOryctesScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === 'ORYCTES') || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [rows, setRows] = useState<BarisRow[]>([]);
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  useEffect(() => {
    if (!blok) {
      setRows([]);
      return;
    }
    setRows((buildSamplingPlan(blok, 'BARIS_SAMPEL').baris || []).map(emptyRow));
  }, [blok?.id]);

  const updateRow = (idx: number, field: keyof BarisRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const totals = useMemo(() => {
    let terserang = 0;
    let diamati = 0;
    let normal = 0;
    let stagnan = 0;
    let recovery = 0;
    let mati = 0;
    for (const r of rows) {
      terserang += (Number(r.serangan_baru) || 0) + (Number(r.serangan_lama) || 0);
      diamati += Number(r.jumlah_sampel) || 0;
      normal += Number(r.normal) || 0;
      stagnan += Number(r.stagnan) || 0;
      recovery += Number(r.recovery) || 0;
      mati += Number(r.mati) || 0;
    }
    return { terserang, diamati, normal, stagnan, recovery, mati };
  }, [rows]);

  const pctResult = totals.diamati > 0 ? computeOryctes({ jumlah_pokok_terserang: totals.terserang, jumlah_pokok_diamati: totals.diamati }) : null;

  const engineResult = useMemo(() => {
    if (!blok || !hpt || !pctResult) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: pctResult.hasil_hitung });
  }, [blok, hpt, pctResult, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt || !pctResult) return;
    setSubmitting(true);
    try {
      const hasil = {
        jumlah_pokok_terserang: totals.terserang,
        jumlah_pokok_diamati: totals.diamati,
        normal: totals.normal,
        stagnan: totals.stagnan,
        recovery: totals.recovery,
        mati: totals.mati,
        per_baris: rows.map((r) => ({
          baris: r.baris,
          serangan_baru: Number(r.serangan_baru) || 0,
          serangan_lama: Number(r.serangan_lama) || 0,
          normal: Number(r.normal) || 0,
          stagnan: Number(r.stagnan) || 0,
          recovery: Number(r.recovery) || 0,
          mati: Number(r.mati) || 0,
          jumlah_sampel: Number(r.jumlah_sampel) || 0,
        })),
      };
      await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: 'ORYCTES',
        speciesId: null,
        hasil,
        hasilHitung: pctResult.hasil_hitung,
        jalurBaris: rows.map((r) => r.baris),
        catatan,
        photo,
        gps,
        engineResult,
      });
      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: kategori ${engineResult.kategori}.` : '';
      Alert.alert('Sensus Oryctes tersimpan', `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [
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
    if (rows.length === 0) return Alert.alert('Tidak ada baris sampel', 'Blok ini belum memiliki parameter sampling yang valid.');
    if (totals.diamati <= 0) return Alert.alert('Lengkapi data', 'Isi jumlah sampel minimal pada satu baris.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
      </SectionCard>

      {blok && (
        <SectionCard title={`Baris sampel (${rows.length} baris)`} subtitle="Dihasilkan otomatis dari parameter sampling Blok">
          {rows.map((row, idx) => (
            <View key={row.baris} style={styles.rowCard}>
              <Text style={styles.rowTitle}>Baris {row.baris}</Text>
              <View style={styles.grid}>
                <MiniField label="Serangan baru" value={row.serangan_baru} onChangeText={(v) => updateRow(idx, 'serangan_baru', v)} />
                <MiniField label="Serangan lama" value={row.serangan_lama} onChangeText={(v) => updateRow(idx, 'serangan_lama', v)} />
                <MiniField label="Normal" value={row.normal} onChangeText={(v) => updateRow(idx, 'normal', v)} />
                <MiniField label="Stagnan" value={row.stagnan} onChangeText={(v) => updateRow(idx, 'stagnan', v)} />
                <MiniField label="Recovery" value={row.recovery} onChangeText={(v) => updateRow(idx, 'recovery', v)} />
                <MiniField label="Mati" value={row.mati} onChangeText={(v) => updateRow(idx, 'mati', v)} />
                <MiniField label="Jumlah sampel" value={row.jumlah_sampel} onChangeText={(v) => updateRow(idx, 'jumlah_sampel', v)} />
              </View>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>
              Terserang: {totals.terserang} / diamati: {totals.diamati}
            </Text>
            <Text style={styles.totalsText}>Hasil: {pctResult ? round(pctResult.hasil_hitung, 2) : '-'} %</Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus Oryctes'} onPress={handleSubmit} loading={submitting} />

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

function MiniField({ label, value, onChangeText }: { label: string; value: string; onChangeText: (v: string) => void }) {
  return (
    <View style={styles.miniField}>
      <Text style={styles.miniLabel}>{label}</Text>
      <FormField label="" value={value} onChangeText={onChangeText} keyboardType="number-pad" placeholder="0" style={styles.miniInput} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  rowTitle: { fontWeight: '700', color: colors.primaryDark, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  miniField: { width: '33%', paddingHorizontal: 4 },
  miniLabel: { fontSize: 10, color: colors.textMuted },
  miniInput: { paddingVertical: 6, marginBottom: 0 },
  totalsBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginTop: spacing.sm },
  totalsText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
});
