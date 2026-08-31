import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
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
import { useAllSpecies, useBlok, useHptList, useThresholds } from '../hooks/useMasterData';
import {
  EwsFormEntry,
  EwsValueField,
  aggregateRowsForEngine,
  getEwsFormEntry,
} from '../domain/ewsFormSchema';
import { buildSamplingPlan, computeByHptCode, GANODERMA_SCALE, type GridPoint } from '../domain/sensusEngines';
import { checkLocationWarning } from '../domain/geo';
import { runLocalThresholdEngine, type LocalEngineResult } from '../domain/thresholdEngine';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import { takePhoto, type CapturedPhoto } from '../domain/photo';
import { saveSensusRecord } from '../domain/sensusSubmit';
import { insertPhoto } from '../db/repo/photoRepo';
import { insertYieldPartenocarpi, insertWaterManagement, insertBahanOrganik, insertTbmVegetatif } from '../db/repo/yieldRepo';
import { insertDefisiensiHaraTemuan } from '../db/repo/defisiensiHaraRepo';
import { insertAgroObservation } from '../db/repo/agroObservationRepo';
import { getEwsDictionaryEntry } from '../db/repo/ewsDictionaryRepo';
import { uuid } from '../utils/uuid';
import { getDeviceId } from '../utils/device';
import { nowIso, todayDateStr, toNumberOrNull, round } from '../utils/format';
import type { EwsDictionaryRow, GpsCapture } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'EwsForm'>;

// EWS Dynamic Form Engine (BRD_V3_Mobile_Offline.docx section 3): ONE screen for all 32 EWS_IDs,
// driven entirely by domain/ewsFormSchema.ts - no per-indicator hard-coded screen. It dispatches
// to one of 4 body renderers by `entry.layout`; each body was ported 1:1 from the hand-built
// screen it replaces (SensusTikusScreen/SensusUPDKSScreen/SensusOryctesScreen for ROW_SAMPLING,
// SensusRayapScreen for GRID_SAMPLING, SensusGanodermaScreen for QUALITATIVE_POINTS,
// BahanOrganikFormScreen/PartenocarpiFormScreen/WaterManagementFormScreen/TbmVegetatifFormScreen/
// DefisiensiHaraScreen for SIMPLE_FIELDS) so behavior/classification stays identical, only the
// per-EWS_ID field set now comes from the schema instead of being typed out per screen.
//
// Known simplifications vs. the screens this replaces (documented rather than silently dropped):
//   - Partenocarpi/TBM Vegetatif's "Sampling Assistant" minimum-sample warning
//     (domain/samplingAssistant.ts) is not wired into the generic SIMPLE_FIELDS body.
//   - TBM Vegetatif's auto-suggested target_produksi_ton_ha (from Blok.status_tanaman) is not
//     ported - the field is a plain manual number here.
//   - Defisiensi Hara's "pilih dari Leaf Analysis Riset" quick-fill is not ported - unsur_hara is
//     always typed manually here (DefisiensiHaraScreen.tsx is kept in the codebase, unregistered
//     from Home, for anyone who wants that convenience back).
export default function EwsFormScreen({ route, navigation }: Props) {
  const { ews_id } = route.params;
  const entry = getEwsFormEntry(ews_id);
  const [dict, setDict] = useState<EwsDictionaryRow | null>(null);

  useEffect(() => {
    getEwsDictionaryEntry(ews_id).then(setDict);
  }, [ews_id]);

  if (!entry) {
    return (
      <ScreenContainer>
        <SectionCard title="EWS_ID tidak dikenal">
          <Text style={styles.errText}>Formulir untuk {ews_id} belum terdaftar di aplikasi ini.</Text>
        </SectionCard>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <DictionaryHeader entry={entry} dict={dict} />
      {entry.layout === 'ROW_SAMPLING' && <RowSamplingBody entry={entry} navigation={navigation} />}
      {entry.layout === 'GRID_SAMPLING' && <GridSamplingBody entry={entry} navigation={navigation} />}
      {entry.layout === 'QUALITATIVE_POINTS' && <QualitativePointsBody entry={entry} navigation={navigation} />}
      {entry.layout === 'SIMPLE_FIELDS' && <SimpleFieldsBody entry={entry} navigation={navigation} />}
    </ScreenContainer>
  );
}

function DictionaryHeader({ entry, dict }: { entry: EwsFormEntry; dict: EwsDictionaryRow | null }) {
  return (
    <SectionCard title={`${entry.ews_id} - ${dict?.hpt_name || entry.hpt_code}`} subtitle={dict?.planting_stage ? `Fase: ${dict.planting_stage}` : undefined}>
      {dict?.threshold_display_text && <Text style={styles.dictLine}>Ambang batas: {dict.threshold_display_text}</Text>}
      {dict?.inspection_interval && <Text style={styles.dictLine}>Interval inspeksi: {dict.inspection_interval}</Text>}
      {dict?.recommendation && <Text style={styles.dictLine}>Rekomendasi: {dict.recommendation}</Text>}
    </SectionCard>
  );
}

// =================================================================================================
// ROW_SAMPLING - Tikus/UPDKS/Oryctes (HPT-001..009): row grid generated from Blok's BARIS_SAMPEL
// parameters, mini numeric fields per row from entry.valueFields, aggregated then classified.
// =================================================================================================
function RowSamplingBody({ entry, navigation }: { entry: EwsFormEntry; navigation: Props['navigation'] }) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === entry.hpt_code) || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
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
    setRows((plan.baris || []).map(() => emptyRowValues(entry.valueFields)));
  }, [blok?.id]);

  const updateRow = (idx: number, field: string, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const totalSampel = rows.reduce((s, r) => s + (Number(r.jumlah_sampel) || 0), 0);

  const engineInput = useMemo(() => aggregateRowsForEngine(entry.hpt_code, rows), [entry.hpt_code, rows]);
  const computed = useMemo(() => {
    try {
      return totalSampel > 0 || entry.hpt_code === 'UPDKS' ? computeByHptCode(entry.hpt_code, engineInput) : null;
    } catch {
      return null;
    }
  }, [engineInput, totalSampel, entry.hpt_code]);

  const engineResult = useMemo(() => {
    if (!blok || !hpt || !computed) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: computed.hasil_hitung });
  }, [blok, hpt, computed, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt || !computed) return;
    setSubmitting(true);
    try {
      const hasil = { ...engineInput, per_baris: rows };
      await saveSensusRecord({
        user,
        blok,
        afdelingId: location.afdeling_id,
        estateId: location.estate_id,
        jenisSensus: entry.hpt_code,
        speciesId: null,
        hasil,
        hasilHitung: computed.hasil_hitung,
        jalurBaris: rows.map((_, i) => i + 1),
        catatan,
        photo,
        gps,
        engineResult,
      });
      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: kategori ${engineResult.kategori}.` : '';
      Alert.alert(`${entry.ews_id} tersimpan`, `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!blok || !hpt) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    if (rows.length === 0) return Alert.alert('Tidak ada baris sampel', 'Blok ini belum memiliki parameter sampling yang valid.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
        {blok && <Text style={styles.faseInfo}>Fase tanaman blok: {blok.status_tanaman}</Text>}
      </SectionCard>

      {blok && (
        <SectionCard title={`Baris sampel (${rows.length} baris)`} subtitle="Dihasilkan otomatis dari parameter sampling Blok">
          {rows.map((row, idx) => (
            <View key={idx} style={styles.rowCard}>
              <Text style={styles.rowTitle}>Baris {idx + 1}</Text>
              <View style={styles.grid}>
                {entry.valueFields.map((f) => (
                  <View key={f.field} style={styles.miniField}>
                    <Text style={styles.miniLabel}>{f.label}</Text>
                    <FormField label="" value={row[f.field]} onChangeText={(v) => updateRow(idx, f.field, v)} keyboardType="number-pad" placeholder="0" style={styles.miniInput} />
                  </View>
                ))}
              </View>
            </View>
          ))}
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>Hasil: {computed ? round(computed.hasil_hitung, 2) : '-'} {computed?.satuan || ''}</Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : `Simpan ${entry.ews_id}`} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal visible={showOutOfArea} blokLabel={blok?.code || '-'} onKembali={() => setShowOutOfArea(false)} onTetapSimpan={() => { setShowOutOfArea(false); doSave(true); }} />
    </>
  );
}

function emptyRowValues(fields: EwsValueField[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (const f of fields) o[f.field] = '';
  return o;
}

// =================================================================================================
// GRID_SAMPLING - Rayap (HPT-010..012): baris x posisi grid auto-generated, boolean per point.
// =================================================================================================
function GridSamplingBody({ entry, navigation }: { entry: EwsFormEntry; navigation: Props['navigation'] }) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === entry.hpt_code) || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [points, setPoints] = useState<(GridPoint & { ada_rayap: boolean; kondisi_alur_tanah: string; photo: CapturedPhoto | null; gps: GpsCapture | null; capturingGps: boolean; capturingPhoto: boolean })[]>([]);
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
    setPoints((plan.points || []).map((pt) => ({ ...pt, ada_rayap: false, kondisi_alur_tanah: '', photo: null, gps: null, capturingGps: false, capturingPhoto: false })));
  }, [blok?.id]);

  const updatePoint = (idx: number, patch: Partial<(typeof points)[number]>) => {
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

  const totals = useMemo(() => ({ terserang: points.filter((p) => p.ada_rayap).length, diamati: points.length }), [points]);
  const computed = totals.diamati > 0 ? computeByHptCode(entry.hpt_code, { jumlah_pokok_terserang: totals.terserang, jumlah_pokok_diamati: totals.diamati }) : null;
  const forcedKandidat = (computed as { forced_kandidat_pengendalian?: boolean } | null)?.forced_kandidat_pengendalian;

  const engineResult = useMemo(() => {
    if (!blok || !hpt || !computed) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: computed.hasil_hitung, forced_kandidat_pengendalian: forcedKandidat });
  }, [blok, hpt, computed, forcedKandidat, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt || !computed) return;
    setSubmitting(true);
    try {
      const hasil = {
        jumlah_pokok_terserang: totals.terserang,
        jumlah_pokok_diamati: totals.diamati,
        points: points.map((p) => ({ baris: p.baris, posisi: p.posisi, ada_rayap: p.ada_rayap, kondisi_alur_tanah: p.kondisi_alur_tanah || null, gps_lat: p.gps?.gps_lat ?? null, gps_lng: p.gps?.gps_lng ?? null })),
      };
      const { local_id } = await saveSensusRecord({
        user, blok, afdelingId: location.afdeling_id, estateId: location.estate_id,
        jenisSensus: entry.hpt_code, speciesId: null, hasil, hasilHitung: computed.hasil_hitung,
        jalurBaris: points.map((p) => ({ baris: p.baris, posisi: p.posisi })), catatan, photo: null, gps: sessionGps, engineResult,
      });
      const now = new Date().toISOString();
      for (const p of points) {
        if (!p.photo) continue;
        await insertPhoto({ local_id: `${local_id}-b${p.baris}p${p.posisi}`, entity_type: 'SENSUS', entity_local_id: local_id, file_uri: p.photo.uri, gps_lat: p.gps?.gps_lat ?? sessionGps.gps_lat, gps_lng: p.gps?.gps_lng ?? sessionGps.gps_lng, timestamp: now, user_id: user?.id ?? null, compressed_size: p.photo.size, uploaded: 0, server_photo_id: null });
      }
      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: ${totals.terserang} titik terserang.` : '';
      Alert.alert(`${entry.ews_id} tersimpan`, `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
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
    <>
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
                  <Text style={[styles.adaText, p.ada_rayap ? styles.adaTextOn : undefined]}>{p.ada_rayap ? 'Ya' : 'Tidak'}</Text>
                  <Switch value={p.ada_rayap} onValueChange={(v) => updatePoint(idx, { ada_rayap: v })} />
                </View>
              </View>
              <FormField label="Kondisi alur tanah" value={p.kondisi_alur_tanah} onChangeText={(v) => updatePoint(idx, { kondisi_alur_tanah: v })} placeholder="opsional" style={styles.smallInput} />
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
            <Text style={styles.totalsText}>Titik terserang: {totals.terserang} / diamati: {totals.diamati}</Text>
            <Text style={styles.totalsText}>Hasil: {computed ? round(computed.hasil_hitung, 2) : '-'} %</Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan (sesi)">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <GpsField value={sessionGps} onChange={setSessionGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : `Simpan ${entry.ews_id}`} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal visible={showOutOfArea} blokLabel={blok?.code || '-'} onKembali={() => setShowOutOfArea(false)} onTetapSimpan={() => { setShowOutOfArea(false); doSave(true); }} />
    </>
  );
}

// =================================================================================================
// QUALITATIVE_POINTS - Ganoderma (HPT-013..015): manually add points as symptoms are found across
// the whole blok, worst-of scoring.
// =================================================================================================
function QualitativePointsBody({ entry, navigation }: { entry: EwsFormEntry; navigation: Props['navigation'] }) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const allSpecies = useAllSpecies();
  const thresholds = useThresholds();
  const hpt = hptList.find((h) => h.code === entry.hpt_code) || null;
  const enumField = entry.valueFields.find((f) => f.type === 'enum') || entry.valueFields[0];

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [entries, setEntries] = useState<{ key: string; baris: string; posisi: string; value: string; catatan: string; photo: CapturedPhoto | null; gps: GpsCapture | null; capturingGps: boolean; capturingPhoto: boolean }[]>([]);
  const [catatan, setCatatan] = useState('');
  const [sessionGps, setSessionGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setSessionGps(r.data));
  }, []);

  const update = (key: string, patch: Partial<(typeof entries)[number]>) => setEntries((prev) => prev.map((e) => (e.key === key ? { ...e, ...patch } : e)));
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

  const worstValue = useMemo(() => {
    if (entries.length === 0) return enumField?.options?.[0] || '';
    let worst = enumField?.options?.[0] || '';
    let worstCode = -1;
    for (const e of entries) {
      const code = GANODERMA_SCALE[e.value] ?? 0;
      if (code > worstCode) {
        worstCode = code;
        worst = e.value;
      }
    }
    return worst;
  }, [entries, enumField]);

  const computed = computeByHptCode(entry.hpt_code, { status_serangan: worstValue });

  const engineResult = useMemo(() => {
    if (!blok || !hpt) return null;
    return runLocalThresholdEngine({ thresholds, species: allSpecies, blok, hpt_id: hpt.id, species_id: null, nilai_hasil: computed.hasil_hitung });
  }, [blok, hpt, computed.hasil_hitung, thresholds, allSpecies]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok || !hpt) return;
    setSubmitting(true);
    try {
      const hasil = {
        [enumField.field]: worstValue,
        points: entries.map((e) => ({ baris: e.baris ? Number(e.baris) : null, posisi: e.posisi ? Number(e.posisi) : null, [enumField.field]: e.value, catatan: e.catatan || null, gps_lat: e.gps?.gps_lat ?? null, gps_lng: e.gps?.gps_lng ?? null })),
      };
      const { local_id } = await saveSensusRecord({
        user, blok, afdelingId: location.afdeling_id, estateId: location.estate_id,
        jenisSensus: entry.hpt_code, speciesId: null, hasil, hasilHitung: computed.hasil_hitung,
        jalurBaris: entries.map((e) => ({ baris: e.baris, posisi: e.posisi })), catatan, photo: null, gps: sessionGps, engineResult,
      });
      const now = new Date().toISOString();
      for (const e of entries) {
        if (!e.photo) continue;
        await insertPhoto({ local_id: `${local_id}-${e.key}`, entity_type: 'SENSUS', entity_local_id: local_id, file_uri: e.photo.uri, gps_lat: e.gps?.gps_lat ?? sessionGps.gps_lat, gps_lng: e.gps?.gps_lng ?? sessionGps.gps_lng, timestamp: now, user_id: user?.id ?? null, compressed_size: e.photo.size, uploaded: 0, server_photo_id: null });
      }
      notifyDataChanged();
      const alertMsg = engineResult?.ews_alert ? `\n\n🔴 ALERT HPT: kategori ${engineResult.kategori}.` : '';
      Alert.alert(`${entry.ews_id} tersimpan`, `Data tersimpan lokal, siap disinkronkan.${alertMsg}`, [{ text: 'OK', onPress: () => navigation.goBack() }]);
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
    <>
      <SectionCard title="Lokasi">
        <LocationCascade value={location} onChange={setLocation} />
      </SectionCard>

      {blok && (
        <SectionCard title={`Titik bergejala (${entries.length})`} subtitle="Tambahkan setiap titik yang menunjukkan indikasi saat menyisir blok">
          {entries.map((e) => (
            <View key={e.key} style={styles.pointCard}>
              <View style={styles.pointHeader}>
                <Text style={styles.pointTitle}>Titik</Text>
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
              <SelectField label={enumField.label} required value={e.value} options={(enumField.options || []).map((o) => ({ label: o, value: o }))} onChange={(v) => v && update(e.key, { value: v })} />
              <FormField label="Catatan" value={e.catatan} onChangeText={(v) => update(e.key, { catatan: v })} placeholder="opsional" />
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
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setEntries((prev) => [...prev, { key: uuid(), baris: '', posisi: '', value: enumField.options?.[0] || '', catatan: '', photo: null, gps: null, capturingGps: false, capturingPhoto: false }])}
          >
            <Text style={styles.addBtnText}>+ Tambah titik</Text>
          </TouchableOpacity>
          <View style={styles.totalsBox}>
            <Text style={styles.totalsText}>Status terburuk sesi: {worstValue} (skala {computed.hasil_hitung})</Text>
          </View>
          {engineResult && <KategoriBadge kategori={engineResult.kategori} alert={engineResult.ews_alert} />}
        </SectionCard>
      )}

      <SectionCard title="Bukti Lapangan (sesi)">
        <FormField label="Catatan umum" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <GpsField value={sessionGps} onChange={setSessionGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : `Simpan ${entry.ews_id}`} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal visible={showOutOfArea} blokLabel={blok?.code || '-'} onKembali={() => setShowOutOfArea(false)} onTetapSimpan={() => { setShowOutOfArea(false); doSave(true); }} />
    </>
  );
}

// =================================================================================================
// SIMPLE_FIELDS - Yield Making (YM-001, AGR-001..003, WM-001/002), Defisiensi Hara (AGR-004), and
// the new generic Agro Observation (AGR-005..014): one set of entry.valueFields, no rows/points.
// =================================================================================================
function SimpleFieldsBody({ entry, navigation }: { entry: EwsFormEntry; navigation: Props['navigation'] }) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();
  const hptList = useHptList();
  const hpt = hptList.find((h) => h.code === entry.hpt_code) || null;

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [tanggal] = useState(todayDateStr());
  const [values, setValues] = useState<Record<string, string>>(() => emptyRowValues(entry.valueFields));
  const [petugas, setPetugas] = useState(user?.name || '');
  const [catatan, setCatatan] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  const setField = (field: string, v: string) => setValues((prev) => ({ ...prev, [field]: v }));

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();
      const common = {
        local_id, server_id: null, server_row_id: null, incident_id: null,
        user_id: user?.id ?? null, device_id, created_at: now, updated_at: now,
        sync_status: 'READY_TO_SYNC' as const, sync_attempt: 0, sync_error: null, source: 'MOBILE' as const,
        estate_id: location.estate_id, afdeling_id: location.afdeling_id, blok_id: blok.id, tanggal,
        gps_lat: gps.gps_lat, gps_lng: gps.gps_lng, gps_accuracy: gps.gps_accuracy, gps_timestamp: gps.gps_timestamp,
        location_warning: (locationWarning ? 1 : 0) as 0 | 1,
        foto_local_id: photo ? local_id : null,
        catatan: catatan || null,
      };

      if (entry.submit.kind === 'YIELD_MAKING') {
        await saveYieldMaking(entry.submit.subpath, common, values);
      } else if (entry.submit.kind === 'DEFISIENSI_HARA') {
        await insertDefisiensiHaraTemuan({
          ...common,
          leaf_analysis_id: null,
          unsur_hara: values.unsur_hara || null,
          temuan_lapangan: values.temuan_lapangan || null,
          severity: values.severity || null,
          status: 'OPEN',
          action_plan_id: null,
          evidence_photo_id: null,
        });
      } else if (entry.submit.kind === 'AGRO_OBSERVATION') {
        if (!hpt) throw new Error(`Indikator ${entry.hpt_code} belum tersedia di master data lokal - sinkronkan data master terlebih dahulu.`);
        await insertAgroObservation({
          ...common,
          hpt_id: hpt.id,
          ews_id: entry.ews_id,
          nilai_ukur: values.nilai_ukur !== undefined ? toNumberOrNull(values.nilai_ukur) : null,
          kategori: values.kategori || null,
          kategori_lokal: null,
          ews_alert_lokal: 0,
          petugas: petugas || null,
        });
      }

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: entry.submit.kind === 'AGRO_OBSERVATION' ? 'AGRO_OBSERVATION' : entry.submit.kind === 'DEFISIENSI_HARA' ? 'DEFISIENSI_HARA_TEMUAN' : yieldEntityType(entry.submit.kind === 'YIELD_MAKING' ? entry.submit.subpath : 'partenocarpi'),
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
      Alert.alert(`${entry.ews_id} tersimpan`, 'Data tersimpan lokal, siap disinkronkan.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!location.blok_id) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    const missing = entry.valueFields.find((f) => f.required && !values[f.field]);
    if (missing) return Alert.alert('Lengkapi data', `${missing.label} wajib diisi.`);
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <>
      <SectionCard title="Lokasi & Tanggal">
        <LocationCascade value={location} onChange={setLocation} />
        <FormField label="Tanggal" value={tanggal} editable={false} />
        {entry.submit.kind === 'AGRO_OBSERVATION' && <FormField label="Petugas" value={petugas} onChangeText={setPetugas} placeholder="Nama petugas" />}
      </SectionCard>

      <SectionCard title="Data">
        {entry.valueFields.map((f) => (
          <DynamicField key={f.field} field={f} value={values[f.field]} onChange={(v) => setField(f.field, v)} />
        ))}
      </SectionCard>

      <SectionCard title="Bukti Lapangan">
        <FormField label="Catatan" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
        <PhotoField photo={photo} onChange={setPhoto} />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : `Simpan ${entry.ews_id}`} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal visible={showOutOfArea} blokLabel={blok?.code || '-'} onKembali={() => setShowOutOfArea(false)} onTetapSimpan={() => { setShowOutOfArea(false); doSave(true); }} />
    </>
  );
}

function DynamicField({ field, value, onChange }: { field: EwsValueField; value: string; onChange: (v: string) => void }) {
  if (field.type === 'enum') {
    return (
      <SelectField
        label={field.label}
        required={field.required}
        value={value || null}
        options={(field.options || []).map((o) => ({ label: o, value: o }))}
        onChange={(v) => onChange(v || '')}
      />
    );
  }
  if (field.type === 'boolean') {
    return (
      <View style={styles.boolRow}>
        <Text style={styles.boolLabel}>{field.label}{field.required ? ' *' : ''}</Text>
        <Switch value={value === '1'} onValueChange={(v) => onChange(v ? '1' : '0')} />
      </View>
    );
  }
  return (
    <FormField
      label={field.unit ? `${field.label} (${field.unit})` : field.label}
      required={field.required}
      value={value}
      onChangeText={onChange}
      keyboardType={field.type === 'number' ? 'decimal-pad' : 'default'}
    />
  );
}

function yieldEntityType(subpath: 'partenocarpi' | 'water-management' | 'bahan-organik' | 'tbm-vegetatif') {
  switch (subpath) {
    case 'partenocarpi':
      return 'YIELD_PARTENOCARPI' as const;
    case 'water-management':
      return 'WATER_MANAGEMENT' as const;
    case 'bahan-organik':
      return 'BAHAN_ORGANIK' as const;
    case 'tbm-vegetatif':
      return 'TBM_VEGETATIF' as const;
  }
}

// Maps the generic `values` bag (schema field names, all strings from TextInput) onto the exact
// strongly-typed Local{X} row shape each yield table's insert function expects. The field-name
// sets were verified 1:1 against each original screen (yieldFormSchema.ts header) before writing
// this, so a plain lookup by `field` name is safe here - the `as any` on each insert call exists
// only because TS can't statically prove a Record<string,string>-derived object satisfies the
// exact Local{X} interface; the values themselves are the same shape the original screens built
// field-by-field.
async function saveYieldMaking(
  subpath: 'partenocarpi' | 'water-management' | 'bahan-organik' | 'tbm-vegetatif',
  common: {
    local_id: string; server_id: null; server_row_id: null; incident_id: null; user_id: number | null;
    device_id: string; created_at: string; updated_at: string; sync_status: 'READY_TO_SYNC'; sync_attempt: number;
    sync_error: null; source: 'MOBILE'; estate_id: number | null; afdeling_id: number | null; blok_id: number;
    tanggal: string; gps_lat: number | null; gps_lng: number | null; gps_accuracy: number | null; gps_timestamp: string | null;
    location_warning: 0 | 1; foto_local_id: string | null; catatan: string | null;
  },
  values: Record<string, string>
): Promise<void> {
  const base = { ...common, kategori_lokal: null, ews_alert_lokal: 0 as const };
  if (subpath === 'partenocarpi') {
    const totalBunch = toNumberOrNull(values.total_bunch);
    const abnormalBunch = toNumberOrNull(values.abnormal_bunch);
    const abnormalBunchPct = totalBunch && totalBunch > 0 && abnormalBunch !== null ? round((abnormalBunch / totalBunch) * 100, 2) : null;
    await insertYieldPartenocarpi({
      ...base,
      periode: tanggalToPeriode(common.tanggal),
      rainfall_mm: toNumberOrNull(values.rainfall_mm),
      indikator_hujan_pagi: toNumberOrNull(values.indikator_hujan_pagi),
      total_bunch: totalBunch,
      abnormal_bunch: abnormalBunch,
      abnormal_bunch_pct: abnormalBunchPct,
      populasi_ek: toNumberOrNull(values.populasi_ek),
    });
  } else if (subpath === 'water-management') {
    await insertWaterManagement({
      ...base,
      titik_parit: values.titik_parit || null,
      water_level_cm: toNumberOrNull(values.water_level_cm),
      flooding: values.flooding === '1' ? 1 : 0,
      flooding_duration_hari: toNumberOrNull(values.flooding_duration_hari),
    });
  } else if (subpath === 'bahan-organik') {
    const totalSample = toNumberOrNull(values.total_sample);
    const yellowingCount = toNumberOrNull(values.yellowing_count);
    const yellowingPct = totalSample && totalSample > 0 && yellowingCount !== null ? round((yellowingCount / totalSample) * 100, 2) : null;
    await insertBahanOrganik({
      ...base,
      area_type: values.area_type || null,
      total_sample: totalSample,
      yellowing_count: yellowingCount,
      yellowing_pct: yellowingPct,
      vegetative_condition: values.vegetative_condition || null,
      baseline_tbm_normal: values.baseline_tbm_normal || null,
      comparison_result: values.comparison_result || null,
    });
  } else {
    await insertTbmVegetatif({
      ...base,
      umur_bulan: toNumberOrNull(values.umur_bulan),
      panjang_pelepah_cm: toNumberOrNull(values.panjang_pelepah_cm),
      jumlah_pelepah: toNumberOrNull(values.jumlah_pelepah),
      lai: toNumberOrNull(values.lai),
      target_produksi_ton_ha: toNumberOrNull(values.target_produksi_ton_ha),
      hasil_evaluasi: values.hasil_evaluasi || null,
    });
  }
}

function tanggalToPeriode(tanggal: string): string {
  return tanggal.slice(0, 7);
}

const styles = StyleSheet.create({
  errText: { color: colors.danger, fontSize: 14 },
  dictLine: { fontSize: 12, color: colors.primaryDark, marginTop: 2 },
  faseInfo: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  rowCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  rowTitle: { fontWeight: '700', color: colors.primaryDark, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  miniField: { width: '50%', paddingHorizontal: 4 },
  miniLabel: { fontSize: 10, color: colors.textMuted },
  miniInput: { paddingVertical: 6, marginBottom: 0 },
  totalsBox: { backgroundColor: colors.chip, borderRadius: 8, padding: 10, marginTop: spacing.sm },
  totalsText: { fontSize: 12, color: colors.primaryDark, fontWeight: '600' },
  pointCard: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
  pointHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pointTitle: { fontWeight: '700', color: colors.primaryDark },
  removeText: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row' },
  flex1: { flex: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  adaText: { fontSize: 11, color: colors.textMuted, marginRight: 6 },
  adaTextOn: { color: colors.danger, fontWeight: '700' },
  smallInput: { marginBottom: 6 },
  pointActions: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  pointBtn: { backgroundColor: colors.chip, borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  pointBtnText: { fontSize: 11, color: colors.primaryDark, fontWeight: '600' },
  addBtn: { borderWidth: 1, borderColor: colors.primary, borderStyle: 'dashed', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: spacing.sm },
  addBtnText: { color: colors.primaryDark, fontWeight: '700' },
  boolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  boolLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
});
