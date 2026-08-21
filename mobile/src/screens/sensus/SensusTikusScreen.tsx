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
import { buildSamplingPlan, computeTikus } from '../../domain/sensusEngines';
import { checkLocationWarning } from '../../domain/geo';
import { runLocalThresholdEngine } from '../../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { saveSensusRecord } from '../../domain/sensusSubmit';
import type { CapturedPhoto } from '../../domain/photo';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { round } from '../../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusTikus'>;

interface BarisRow {
  baris: number;
  serangan_baru: string;
  serangan_lama: string;
  normal: string;
  jumlah_sampel: string;
}
function emptyRow(baris: number): BarisRow {
  return { baris, serangan_baru: '', serangan_lama: '', normal: '', jumlah_sampel: '' };
}

/** Tikus sensus (SPEC.md section 5): % serangan = (serangan_baru+serangan_lama)/jumlah_sampel x
 * 100%. Threshold differs by fase tanaman (TBM1/TBM2-3/TM), read from the selected Blok's cached
 * status_tanaman - never chosen manually in this form. */
export default function SensusTikusScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === 'TIKUS') || null;

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
    let baru = 0;
    let lama = 0;
    let sampel = 0;
    for (const r of rows) {
      baru += Number(r.serangan_baru) || 0;
      lama += Number(r.serangan_lama) || 0;
      sampel += Number(r.jumlah_sampel) || 0;
    }
    return { baru, lama, sampel };
  }, [rows]);

  const pctResult = totals.sampel > 0 ? computeTikus({ serangan_baru: totals.baru, serangan_lama: totals.lama, jumlah_sampel: totals.sampel }) : null;

  const engineResult = useMemo(() => {
    if (!blok || !hpt || !pctResult) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: pctResult.hasil_hitung });
  }, [blok, hpt, pctResult, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt || !pctResult) return;
    setSubmitting(true);
    try {
      const hasil = {
        serangan_baru: totals.baru,
        serangan_lama: totals.lama,
        normal: rows.reduce((s, r) => s + (Number(r.normal) || 0), 0),
        jumlah_sampel: totals.sampel,
        fase_tanaman: blok.status_tanaman,
        per_baris: rows.map((r) => ({
          baris: r.baris,
          serangan_baru: Number(r.serangan_baru) || 0,
          serangan_lama: Number(r.serangan_lama) || 0,
          normal: Number(r.normal) || 0,
          jumlah_sampel: Number(r.jumlah_sampel) || 0,
        })),
      };
      await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: 'TIKUS',
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
      Alert.alert('Sensus Tikus tersimpan', `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [
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
    if (totals.sampel <= 0) return Alert.alert('Lengkapi data', 'Isi jumlah sampel minimal pada satu baris.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
        {blok && <Text style={styles.faseInfo}>Fase tanaman blok: {blok.status_tanaman}</Text>}
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
                <MiniField label="Jumlah sampel" value={row.jumlah_sampel} onChangeText={(v) => updateRow(idx, 'jumlah_sampel', v)} />
              </View>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>
              Serangan baru+lama: {totals.baru + totals.lama} / sampel: {totals.sampel}
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

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus Tikus'} onPress={handleSubmit} loading={submitting} />

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
  faseInfo: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  rowCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  rowTitle: { fontWeight: '700', color: colors.primaryDark, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  miniField: { width: '50%', paddingHorizontal: 4 },
  miniLabel: { fontSize: 10, color: colors.textMuted },
  miniInput: { paddingVertical: 6, marginBottom: 0 },
  totalsBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginTop: spacing.sm },
  totalsText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
});
