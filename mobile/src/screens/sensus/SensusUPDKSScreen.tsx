import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import ScreenContainer from '../../components/ScreenContainer';
import SectionCard from '../../components/SectionCard';
import FormField from '../../components/FormField';
import SelectField from '../../components/SelectField';
import LocationCascade, { type LocationValue } from '../../components/LocationCascade';
import GpsField from '../../components/GpsField';
import PhotoField from '../../components/PhotoField';
import Button from '../../components/Button';
import KategoriBadge from '../../components/KategoriBadge';
import OutOfAreaModal from '../../components/OutOfAreaModal';
import { useAuth } from '../../state/AuthContext';
import { useSync } from '../../state/SyncContext';
import { useAllSpecies, useBlok, useHptList, useSpeciesByHpt, useThresholds } from '../../hooks/useMasterData';
import { buildSamplingPlan } from '../../domain/sensusEngines';
import { checkLocationWarning } from '../../domain/geo';
import { runLocalThresholdEngine } from '../../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { saveSensusRecord } from '../../domain/sensusSubmit';
import type { CapturedPhoto } from '../../domain/photo';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { round, toNumberOrNull } from '../../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusUPDKS'>;

interface BarisRow {
  baris: number;
  jumlah_pelepah_diamati: string;
  telur: string;
  ulat_kecil: string;
  ulat_sedang: string;
  ulat_besar: string;
  ulat_mati: string;
  kepompong: string;
}

function emptyRow(baris: number): BarisRow {
  return { baris, jumlah_pelepah_diamati: '', telur: '', ulat_kecil: '', ulat_sedang: '', ulat_besar: '', ulat_mati: '', kepompong: '' };
}

/** UPDKS sensus (SPEC.md section 5): baris sampel generated from Blok.parameter_sampling_json
 * (never hard-coded), per-baris counts of telur/ulat kecil-sedang-besar/mati/kepompong, kategori =
 * ulat_hidup_total / jumlah_pelepah_diamati vs species-group-aware threshold (Ulat Api vs Ulat
 * Kantong). "Ulat hidup" here = ulat_kecil + ulat_sedang + ulat_besar (live larval stages) -
 * telur (eggs), kepompong (pupae) and ulat_mati (dead) are recorded but excluded from the ratio,
 * matching the BRD's "hitung ulat hidup per pelepah" wording. */
export default function SensusUPDKSScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === 'UPDKS') || null;
  const species = useSpeciesByHpt(hpt?.id ?? null);

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [speciesId, setSpeciesId] = useState<number | null>(null);
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
    const plan = buildSamplingPlan(blok, 'BARIS_SAMPEL');
    setRows((plan.baris || []).map(emptyRow));
  }, [blok?.id]);

  const updateRow = (idx: number, field: keyof BarisRow, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const totals = useMemo(() => {
    let ulatHidup = 0;
    let pelepah = 0;
    for (const r of rows) {
      ulatHidup += (Number(r.ulat_kecil) || 0) + (Number(r.ulat_sedang) || 0) + (Number(r.ulat_besar) || 0);
      pelepah += Number(r.jumlah_pelepah_diamati) || 0;
    }
    return { ulatHidup, pelepah };
  }, [rows]);

  const engineResult = useMemo(() => {
    if (!blok || !hpt || totals.pelepah <= 0) return null;
    const hasil = totals.ulatHidup / totals.pelepah;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: speciesId, nilai_hasil: hasil });
  }, [blok, hpt, speciesId, totals, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt) return;
    setSubmitting(true);
    try {
      const hasil = {
        spesies_code: species.find((s) => s.id === speciesId)?.code ?? null,
        ulat_hidup_total: totals.ulatHidup,
        jumlah_pelepah_diamati: totals.pelepah,
        per_baris: rows.map((r) => ({
          baris: r.baris,
          jumlah_pelepah_diamati: Number(r.jumlah_pelepah_diamati) || 0,
          telur: Number(r.telur) || 0,
          ulat_kecil: Number(r.ulat_kecil) || 0,
          ulat_sedang: Number(r.ulat_sedang) || 0,
          ulat_besar: Number(r.ulat_besar) || 0,
          ulat_mati: Number(r.ulat_mati) || 0,
          kepompong: Number(r.kepompong) || 0,
        })),
      };
      await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: 'UPDKS',
        speciesId,
        hasil,
        hasilHitung: totals.pelepah > 0 ? totals.ulatHidup / totals.pelepah : 0,
        jalurBaris: rows.map((r) => r.baris),
        catatan,
        photo,
        gps,
        engineResult,
      });
      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: kategori ${engineResult.kategori}.` : '';
      Alert.alert('Sensus UPDKS tersimpan', `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [
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
    if (!speciesId) return Alert.alert('Lengkapi data', 'Spesies wajib dipilih agar threshold spesies-aware dapat dihitung.');
    if (rows.length === 0) return Alert.alert('Tidak ada baris sampel', 'Blok ini belum memiliki jumlah_baris/parameter_sampling yang valid.');
    if (totals.pelepah <= 0) return Alert.alert('Lengkapi data', 'Isi jumlah pelepah diamati minimal pada satu baris.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
        <SelectField
          label="Spesies (kelompok Ulat Api / Ulat Kantong)"
          required
          value={speciesId}
          options={species.map((s) => ({ label: `${s.name} (${s.group_name})`, value: s.id }))}
          onChange={setSpeciesId}
        />
      </SectionCard>

      {blok && (
        <SectionCard title={`Baris sampel (${rows.length} baris)`} subtitle="Dihasilkan otomatis dari parameter sampling Blok">
          {rows.map((row, idx) => (
            <View key={row.baris} style={styles.rowCard}>
              <Text style={styles.rowTitle}>Baris {row.baris}</Text>
              <View style={styles.grid}>
                <MiniField label="Pelepah diamati" value={row.jumlah_pelepah_diamati} onChangeText={(v) => updateRow(idx, 'jumlah_pelepah_diamati', v)} />
                <MiniField label="Telur" value={row.telur} onChangeText={(v) => updateRow(idx, 'telur', v)} />
                <MiniField label="Ulat kecil" value={row.ulat_kecil} onChangeText={(v) => updateRow(idx, 'ulat_kecil', v)} />
                <MiniField label="Ulat sedang" value={row.ulat_sedang} onChangeText={(v) => updateRow(idx, 'ulat_sedang', v)} />
                <MiniField label="Ulat besar" value={row.ulat_besar} onChangeText={(v) => updateRow(idx, 'ulat_besar', v)} />
                <MiniField label="Ulat mati" value={row.ulat_mati} onChangeText={(v) => updateRow(idx, 'ulat_mati', v)} />
                <MiniField label="Kepompong" value={row.kepompong} onChangeText={(v) => updateRow(idx, 'kepompong', v)} />
              </View>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>
              Ulat hidup total: {totals.ulatHidup} - Pelepah diamati: {totals.pelepah}
            </Text>
            <Text style={styles.totalsText}>
              Hasil: {totals.pelepah > 0 ? round(totals.ulatHidup / totals.pelepah, 2) : '-'} ekor/pelepah
            </Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus UPDKS'} onPress={handleSubmit} loading={submitting} />

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
