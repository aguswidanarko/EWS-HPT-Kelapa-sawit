import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import ScreenContainer from '../../components/ScreenContainer';
import SectionCard from '../../components/SectionCard';
import FormField from '../../components/FormField';
import LocationCascade, { type LocationValue } from '../../components/LocationCascade';
import GpsField from '../../components/GpsField';
import Button from '../../components/Button';
import KategoriBadge from '../../components/KategoriBadge';
import OutOfAreaModal from '../../components/OutOfAreaModal';
import { useAuth } from '../../state/AuthContext';
import { useSync } from '../../state/SyncContext';
import { useAllSpecies, useBlok, useHptList, useThresholds } from '../../hooks/useMasterData';
import { buildSamplingPlan, computeRayap, type GridPoint } from '../../domain/sensusEngines';
import { checkLocationWarning } from '../../domain/geo';
import { runLocalThresholdEngine } from '../../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../../domain/gpsCapture';
import { takePhoto, type CapturedPhoto } from '../../domain/photo';
import { saveSensusRecord } from '../../domain/sensusSubmit';
import { insertPhoto } from '../../db/repo/photoRepo';
import type { GpsCapture } from '../../types';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { round } from '../../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'SensusRayap'>;

interface PointRow extends GridPoint {
  ada_rayap: boolean;
  kondisi_alur_tanah: string;
  photo: CapturedPhoto | null;
  gps: GpsCapture | null;
  capturingGps: boolean;
  capturingPhoto: boolean;
}

/** Rayap sensus (SPEC.md section 5): seluruh pokok sampled via a GRID (baris x posisi) generated
 * from Blok.parameter_sampling_json.grid - never hard-coded. Ambang ekonomi = 0%: ANY point with
 * ada_rayap=true is automatically a pengendalian candidate (mirrors backend computeRayap's
 * forced_kandidat_pengendalian). Each point can optionally carry its own photo/GPS; when a point
 * has none, the session-level GPS (captured once when the form opened) is used for it instead. */
export default function SensusRayapScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === 'RAYAP') || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [catatan, setCatatan] = useState('');
  const [sessionGps, setSessionGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setSessionGps(r.data));
  }, []);

  useEffect(() => {
    if (!blok) {
      setPoints([]);
      return;
    }
    const plan = buildSamplingPlan(blok, 'GRID');
    setPoints(
      (plan.points || []).map((pt) => ({
        ...pt,
        ada_rayap: false,
        kondisi_alur_tanah: '',
        photo: null,
        gps: null,
        capturingGps: false,
        capturingPhoto: false,
      }))
    );
  }, [blok?.id]);

  const updatePoint = (idx: number, patch: Partial<PointRow>) => {
    setPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const capturePointGps = async (idx: number) => {
    updatePoint(idx, { capturingGps: true });
    const r = await captureGps();
    updatePoint(idx, { capturingGps: false, gps: r.ok ? r.data : null });
  };

  const capturePointPhoto = async (idx: number) => {
    updatePoint(idx, { capturingPhoto: true });
    try {
      const photo = await takePhoto();
      if (photo) updatePoint(idx, { photo });
    } finally {
      updatePoint(idx, { capturingPhoto: false });
    }
  };

  const totals = useMemo(() => {
    const terserang = points.filter((p) => p.ada_rayap).length;
    const diamati = points.length;
    return { terserang, diamati };
  }, [points]);

  const pctResult = totals.diamati > 0 ? computeRayap({ jumlah_pokok_terserang: totals.terserang, jumlah_pokok_diamati: totals.diamati }) : null;

  const engineResult = useMemo(() => {
    if (!blok || !hpt || !pctResult) return null;
    return runLocalThresholdEngine({
      thresholds,
      species: allSpecies,
      blok,
      hpt_id: hpt.id,
      species_id: null,
      nilai_hasil: pctResult.hasil_hitung,
      forced_kandidat_pengendalian: pctResult.forced_kandidat_pengendalian,
    });
  }, [blok, hpt, pctResult, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt || !pctResult) return;
    setSubmitting(true);
    try {
      const hasil = {
        jumlah_pokok_terserang: totals.terserang,
        jumlah_pokok_diamati: totals.diamati,
        points: points.map((p) => ({
          baris: p.baris,
          posisi: p.posisi,
          ada_rayap: p.ada_rayap,
          kondisi_alur_tanah: p.kondisi_alur_tanah || null,
          gps_lat: p.gps?.gps_lat ?? null,
          gps_lng: p.gps?.gps_lng ?? null,
        })),
      };
      const { local_id } = await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: 'RAYAP',
        speciesId: null,
        hasil,
        hasilHitung: pctResult.hasil_hitung,
        jalurBaris: points.map((p) => ({ baris: p.baris, posisi: p.posisi })),
        catatan,
        photo: null,
        gps: sessionGps,
        engineResult,
      });

      const now = new Date().toISOString();
      for (const p of points) {
        if (!p.photo) continue;
        await insertPhoto({
          local_id: `${local_id}-b${p.baris}p${p.posisi}`,
          entity_type: 'SENSUS',
          entity_local_id: local_id,
          file_uri: p.photo.uri,
          gps_lat: p.gps?.gps_lat ?? sessionGps.gps_lat,
          gps_lng: p.gps?.gps_lng ?? sessionGps.gps_lng,
          timestamp: now,
          user_id: user?.id ?? null,
          compressed_size: p.photo.size,
          uploaded: 0,
          server_photo_id: null,
        });
      }

      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert
        ? `\n\n🔴 ALERT HPT: ${totals.terserang} titik terserang - ambang ekonomi Rayap = 0%, wajib dikendalikan.`
        : '';
      Alert.alert('Sensus Rayap tersimpan', `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [
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
    if (points.length === 0) return Alert.alert('Tidak ada titik grid', 'Blok ini belum memiliki parameter sampling grid yang valid.');
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
        <SectionCard title={`Titik grid (${points.length} titik)`} subtitle="baris x posisi, dihasilkan otomatis dari parameter sampling Blok">
          {points.map((p, idx) => (
            <View key={`${p.baris}-${p.posisi}`} style={styles.pointCard}>
              <View style={styles.pointHeader}>
                <Text style={styles.pointTitle}>Baris {p.baris} - Posisi {p.posisi}</Text>
                <View style={styles.switchRow}>
                  <Text style={[styles.adaText, p.ada_rayap ? styles.adaTextOn : undefined]}>
                    {p.ada_rayap ? 'Ada rayap' : 'Tidak ada'}
                  </Text>
                  <Switch value={p.ada_rayap} onValueChange={(v) => updatePoint(idx, { ada_rayap: v })} />
                </View>
              </View>
              <FormField
                label="Kondisi alur tanah"
                value={p.kondisi_alur_tanah}
                onChangeText={(v) => updatePoint(idx, { kondisi_alur_tanah: v })}
                placeholder="opsional"
                style={styles.smallInput}
              />
              <View style={styles.pointActions}>
                <TouchableOpacity style={styles.pointBtn} onPress={() => capturePointPhoto(idx)} disabled={p.capturingPhoto}>
                  {p.capturingPhoto ? <ActivityIndicator size="small" /> : <Text style={styles.pointBtnText}>{p.photo ? '📷 Foto ✓' : '📷 Foto'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.pointBtn} onPress={() => capturePointGps(idx)} disabled={p.capturingGps}>
                  {p.capturingGps ? <ActivityIndicator size="small" /> : <Text style={styles.pointBtnText}>{p.gps ? '📍 GPS ✓' : '📍 GPS'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>
              Titik terserang: {totals.terserang} / diamati: {totals.diamati}
            </Text>
            <Text style={styles.totalsText}>Hasil: {pctResult ? round(pctResult.hasil_hitung, 2) : '-'} %</Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan (sesi)">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <GpsField value={sessionGps} onChange={setSessionGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Sensus Rayap'} onPress={handleSubmit} loading={submitting} />

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
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  adaText: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  adaTextOn: { color: colors.danger, fontWeight: '700' },
  smallInput: { marginBottom: 6 },
  pointActions: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  pointBtn: { backgroundColor: colors.chip, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  pointBtnText: { fontSize: 11, color: colors.primaryDark, fontWeight: '600' },
  totalsBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginTop: spacing.sm },
  totalsText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
});
