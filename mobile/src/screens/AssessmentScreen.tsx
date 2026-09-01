import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
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
import {
  KONDISI_POKOK_OPTIONS,
  PRUNING_OPTIONS,
  GULMA_OPTIONS,
  DEFISIENSI_UNSUR_OPTIONS,
  DEFISIENSI_SEVERITY_OPTIONS,
  HAMA_OPTIONS,
  EROSI_OPTIONS,
  KONDISI_PARIT_OPTIONS,
  KBH_STATUS_OPTIONS,
  BY_PRODUCT_OPTIONS,
  DEFAULT_SAMPLE_COUNT,
} from '../domain/assessmentSchema';
import { checkLocationWarning } from '../domain/geo';
import { captureGps, EMPTY_GPS } from '../domain/gpsCapture';
import type { CapturedPhoto } from '../domain/photo';
import { insertAssessment } from '../db/repo/assessmentRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import { uuid } from '../utils/uuid';
import { getDeviceId } from '../utils/device';
import { nowIso, nowTimeStr, todayDateStr, toNumberOrNull } from '../utils/format';
import type {
  AssessmentAreaDraft,
  AssessmentTreeDraft,
  AssessmentWaterDraft,
  BaikTidakBaik,
  DefisiensiSeverity,
  DefisiensiUnsur,
  GpsCapture,
  GulmaTag,
  HamaJenis,
  KondisiPokokTag,
  LocalAssessment,
  MetodeSensus,
  PruningStatus,
  SusunanPelepahStatus,
} from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'Assessment'>;

// Option lists that aren't part of domain/assessmentSchema.ts because they're generic BAIK/TIDAK_
// BAIK-style toggles used in more than one place (Gawangan, Drainase, Water Weir, Piringan) rather
// than a domain-specific enumeration.
const BAIK_TIDAK_OPTIONS: { value: BaikTidakBaik; label: string }[] = [
  { value: 'BAIK', label: 'Baik' },
  { value: 'TIDAK_BAIK', label: 'Tidak Baik' },
];
const SUSUNAN_PELEPAH_OPTIONS: { value: SusunanPelepahStatus; label: string }[] = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'TIDAK_SESUAI', label: 'Tidak Sesuai' },
];
const SAMPLING_METHOD_OPTIONS: { value: MetodeSensus; label: string }[] = [
  { value: 'BARIS_SAMPEL', label: 'Baris Sampel' },
  { value: 'GRID', label: 'Grid' },
  { value: 'SELURUH_POKOK', label: 'Seluruh Pokok' },
];

function emptyTree(idx: number): AssessmentTreeDraft {
  return {
    pokok_index: idx,
    status_pokok: 'NORMAL',
    kondisi: [],
    pruning: 'NORMAL',
    susunan_pelepah: null,
    piringan: null,
    gulma_piringan: [],
    defisiensi: [],
    hama: [],
    foto_local_id: null,
    gps_lat: null,
    gps_lng: null,
    catatan: null,
  };
}

/** BRD "Prinsip UX - normal-first/exception-only": status_pokok is NEVER set directly by the user
 * - it is always derived from whether any exception field actually carries data, so an untouched
 * pokok stays NORMAL with zero taps and the photo requirement only switches on once something was
 * actually found. */
function deriveStatus(t: AssessmentTreeDraft): AssessmentTreeDraft {
  const isException =
    t.kondisi.length > 0 ||
    t.pruning !== 'NORMAL' ||
    t.susunan_pelepah === 'TIDAK_SESUAI' ||
    t.piringan === 'TIDAK_BAIK' ||
    t.defisiensi.length > 0 ||
    t.hama.length > 0;
  return { ...t, status_pokok: isException ? 'EXCEPTION' : 'NORMAL' };
}

function emptyArea(): AssessmentAreaDraft {
  return {
    gawangan: null,
    gulma_gawangan: [],
    aplikasi_pupuk: false,
    jenis_pupuk: null,
    tanggal_pupuk: null,
    keterangan_pupuk: null,
    by_product: [],
    keterangan_by_product: null,
    erosi: null,
    catatan: null,
    kbh: null,
    beneficial_plants: null,
  };
}

function emptyWater(): AssessmentWaterDraft {
  return { drainase: null, water_level_cm: null, water_weir: null, kondisi_parit: null, lama_genangan_hari: null, catatan: null };
}

// =================================================================================================
// V3.1 Universal Assessment Form (BRD_Mobile_V3_1.docx): PRIMARY entry point for 29 of the 31 EWS
// indicators - one field visit captures raw per-pokok observations for the whole sample at once,
// and the backend's Assessment Mapping Engine (services/assessmentEngine.js) fans this out into
// every relevant EWS classification automatically. This screen only ever sends raw counts/flags -
// never a computed kategori/percentage - matching the "server is classification truth" rule every
// other V2/V3 form on this app already follows.
// =================================================================================================
export default function AssessmentScreen({ navigation }: Props) {
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();

  const [location, setLocation] = useState<LocationValue>({
    estate_id: user?.estate_id ?? null,
    afdeling_id: user?.afdeling_id ?? null,
    blok_id: null,
  });
  const blok = useBlok(location.blok_id);
  const [baris, setBaris] = useState('');
  const [samplingMethod, setSamplingMethod] = useState<MetodeSensus | null>('BARIS_SAMPEL');
  const [sampleCountStr, setSampleCountStr] = useState(String(DEFAULT_SAMPLE_COUNT));
  const [petugas, setPetugas] = useState(user?.name || '');
  const [tanggal] = useState(todayDateStr());
  const [waktuMulai] = useState(nowTimeStr());
  const [gps, setGps] = useState<GpsCapture>(EMPTY_GPS);
  const [catatan, setCatatan] = useState('');

  const [trees, setTrees] = useState<AssessmentTreeDraft[]>(() =>
    Array.from({ length: DEFAULT_SAMPLE_COUNT }, (_, i) => emptyTree(i + 1))
  );
  const [treePhotos, setTreePhotos] = useState<(CapturedPhoto | null)[]>(() => Array(DEFAULT_SAMPLE_COUNT).fill(null));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const [area, setArea] = useState<AssessmentAreaDraft>(emptyArea);
  const [waterEnabled, setWaterEnabled] = useState(false);
  const [water, setWater] = useState<AssessmentWaterDraft>(emptyWater);

  const [submitting, setSubmitting] = useState(false);
  const [showOutOfArea, setShowOutOfArea] = useState(false);

  useEffect(() => {
    captureGps().then((r) => r.ok && setGps(r.data));
  }, []);

  // Resize trees/treePhotos whenever "Jumlah Pokok Sampel" changes, preserving already-entered
  // data for indices that still exist. Capped at 500 - a sane ceiling against a mistyped value
  // (SPEC has no hard max, but nothing in the BRD's field examples goes past ~50).
  useEffect(() => {
    const n = Math.max(0, Math.min(500, Number(sampleCountStr) || 0));
    setTrees((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      return [...prev, ...Array.from({ length: n - prev.length }, (_, i) => emptyTree(prev.length + i + 1))];
    });
    setTreePhotos((prev) => {
      if (n === prev.length) return prev;
      if (n < prev.length) return prev.slice(0, n);
      return [...prev, ...Array(n - prev.length).fill(null)];
    });
  }, [sampleCountStr]);

  const updateTreeAt = (idx: number, patch: Partial<AssessmentTreeDraft>) => {
    setTrees((prev) => prev.map((t, i) => (i === idx ? deriveStatus({ ...t, ...patch }) : t)));
  };

  const exceptionCount = useMemo(() => trees.filter((t) => t.status_pokok === 'EXCEPTION').length, [trees]);

  const doSave = async (locationWarning: boolean) => {
    if (!blok) return;
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();
      // Each tree that has a captured photo gets a foto_local_id unique to THAT tree (not the
      // record's local_id) - sync/engine.ts's uploadAssessments() resolves it per tree via
      // photoRepo.getPhotosByEntity('ASSESSMENT_TREE', foto_local_id), so it must match the
      // photo's own entity_local_id 1:1 or two trees' photos would collide.
      const treesToSave = trees.map((t, i) => ({
        ...t,
        foto_local_id: treePhotos[i] ? `${local_id}-t${t.pokok_index}` : null,
      }));
      const row: LocalAssessment = {
        local_id,
        server_id: null,
        server_row_id: null,
        assessment_code: null,
        user_id: user?.id ?? null,
        device_id,
        created_at: now,
        updated_at: now,
        sync_status: 'READY_TO_SYNC' as const,
        sync_attempt: 0,
        sync_error: null,
        source: 'MOBILE' as const,
        estate_id: location.estate_id,
        afdeling_id: location.afdeling_id,
        blok_id: blok.id,
        planting_stage: blok.status_tanaman || null,
        baris: baris || null,
        sampling_method: samplingMethod,
        sample_count: trees.length,
        tanggal,
        waktu_mulai: waktuMulai,
        waktu_selesai: nowTimeStr(),
        gps_lat: gps.gps_lat,
        gps_lng: gps.gps_lng,
        gps_accuracy: gps.gps_accuracy,
        location_warning: (locationWarning ? 1 : 0) as 0 | 1,
        catatan: catatan || null,
        petugas: petugas || null,
        trees_json: JSON.stringify(treesToSave),
        area_json: JSON.stringify(area),
        water_json: waterEnabled ? JSON.stringify(water) : null,
        calc_summary_json: null,
      };
      await insertAssessment(row);

      for (let i = 0; i < trees.length; i++) {
        const photo = treePhotos[i];
        if (!photo) continue;
        const photoId = `${local_id}-t${trees[i].pokok_index}`;
        await insertPhoto({
          local_id: photoId,
          entity_type: 'ASSESSMENT_TREE',
          entity_local_id: photoId,
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
      Alert.alert('Assessment tersimpan', `Data ${trees.length} pokok tersimpan lokal, siap disinkronkan.`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!blok) return Alert.alert('Lengkapi data', 'Blok wajib dipilih.');
    if (trees.length === 0) return Alert.alert('Lengkapi data', 'Jumlah pokok sampel harus lebih dari 0.');
    const warning = checkLocationWarning(blok, gps.gps_lat, gps.gps_lng);
    if (warning === true) return setShowOutOfArea(true);
    doSave(false);
  };

  return (
    <ScreenContainer>
      <SectionCard title="Lokasi & Waktu">
        <LocationCascade value={location} onChange={setLocation} />
        {blok && <Text style={styles.faseInfo}>Fase tanaman blok: {blok.status_tanaman}</Text>}
        <FormField label="Baris / Jalur" value={baris} onChangeText={setBaris} placeholder="opsional" />
        <SelectField label="Metode Sampling" value={samplingMethod} options={SAMPLING_METHOD_OPTIONS} onChange={setSamplingMethod} />
        <FormField label="Jumlah Pokok Sampel" required value={sampleCountStr} onChangeText={setSampleCountStr} keyboardType="number-pad" />
        <FormField label="Tanggal" value={tanggal} editable={false} />
        <FormField label="Petugas" value={petugas} onChangeText={setPetugas} placeholder="Nama petugas" />
        <GpsField value={gps} onChange={setGps} />
      </SectionCard>

      <SectionCard
        title={`Ringkasan Pokok (${trees.length})`}
        subtitle={`${exceptionCount} bercatatan / ${trees.length - exceptionCount} normal - ketuk nomor pokok untuk mengisi detail`}
      >
        <View style={styles.treeGrid}>
          {trees.map((t, i) => (
            <TouchableOpacity key={t.pokok_index} style={styles.treeTile} onPress={() => setEditingIndex(i)}>
              <View style={[styles.treeTileInner, t.status_pokok === 'EXCEPTION' && styles.treeTileInnerException]}>
                <Text style={[styles.treeTileText, t.status_pokok === 'EXCEPTION' && styles.treeTileTextException]}>{t.pokok_index}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </SectionCard>

      <SectionCard title="Kondisi Lapangan / Area">
        <SelectField label="Gawangan" value={area.gawangan} options={BAIK_TIDAK_OPTIONS} onChange={(v) => setArea((a) => ({ ...a, gawangan: v }))} />
        <Text style={styles.miniLabel}>Gulma Gawangan</Text>
        <ChipRow
          options={GULMA_OPTIONS.map((o) => ({ value: o.tag, label: o.label }))}
          selected={area.gulma_gawangan}
          onToggle={(tag: GulmaTag) =>
            setArea((a) => ({
              ...a,
              gulma_gawangan: a.gulma_gawangan.includes(tag) ? a.gulma_gawangan.filter((x) => x !== tag) : [...a.gulma_gawangan, tag],
            }))
          }
        />

        <View style={styles.boolRow}>
          <Text style={styles.boolLabel}>Aplikasi Pupuk</Text>
          <Switch value={area.aplikasi_pupuk} onValueChange={(v) => setArea((a) => ({ ...a, aplikasi_pupuk: v }))} />
        </View>
        {area.aplikasi_pupuk && (
          <>
            <FormField label="Jenis Pupuk" value={area.jenis_pupuk || ''} onChangeText={(v) => setArea((a) => ({ ...a, jenis_pupuk: v || null }))} />
            <FormField
              label="Tanggal Pupuk"
              value={area.tanggal_pupuk || ''}
              onChangeText={(v) => setArea((a) => ({ ...a, tanggal_pupuk: v || null }))}
              placeholder="YYYY-MM-DD"
            />
            <FormField
              label="Keterangan Pupuk"
              value={area.keterangan_pupuk || ''}
              onChangeText={(v) => setArea((a) => ({ ...a, keterangan_pupuk: v || null }))}
            />
          </>
        )}

        <Text style={styles.miniLabel}>By-product</Text>
        <ChipRow
          options={[...BY_PRODUCT_OPTIONS]}
          selected={area.by_product}
          onToggle={(v) =>
            setArea((a) => ({ ...a, by_product: a.by_product.includes(v) ? a.by_product.filter((x) => x !== v) : [...a.by_product, v] }))
          }
        />
        <FormField
          label="Keterangan By-product"
          value={area.keterangan_by_product || ''}
          onChangeText={(v) => setArea((a) => ({ ...a, keterangan_by_product: v || null }))}
        />

        <SelectField label="Erosi" value={area.erosi} options={[...EROSI_OPTIONS]} onChange={(v) => setArea((a) => ({ ...a, erosi: v }))} />
        <SelectField label="KBH" value={area.kbh} options={[...KBH_STATUS_OPTIONS]} onChange={(v) => setArea((a) => ({ ...a, kbh: v }))} />
        <SelectField
          label="Beneficial Plants"
          value={area.beneficial_plants}
          options={[...KBH_STATUS_OPTIONS]}
          onChange={(v) => setArea((a) => ({ ...a, beneficial_plants: v }))}
        />
        <FormField
          label="Catatan Area"
          value={area.catatan || ''}
          onChangeText={(v) => setArea((a) => ({ ...a, catatan: v || null }))}
          multiline
          numberOfLines={2}
        />
      </SectionCard>

      <SectionCard title="Water Management" subtitle="Opsional - isi jika blok ini memiliki sistem parit/drainase">
        <View style={styles.boolRow}>
          <Text style={styles.boolLabel}>Catat data Water Management</Text>
          <Switch value={waterEnabled} onValueChange={setWaterEnabled} />
        </View>
        {waterEnabled && (
          <>
            <SelectField label="Drainase" value={water.drainase} options={BAIK_TIDAK_OPTIONS} onChange={(v) => setWater((w) => ({ ...w, drainase: v }))} />
            <FormField
              label="Water Level (cm)"
              value={water.water_level_cm !== null ? String(water.water_level_cm) : ''}
              onChangeText={(v) => setWater((w) => ({ ...w, water_level_cm: toNumberOrNull(v) }))}
              keyboardType="decimal-pad"
            />
            <SelectField label="Water Weir" value={water.water_weir} options={BAIK_TIDAK_OPTIONS} onChange={(v) => setWater((w) => ({ ...w, water_weir: v }))} />
            <SelectField
              label="Kondisi Parit"
              value={water.kondisi_parit}
              options={[...KONDISI_PARIT_OPTIONS]}
              onChange={(v) => setWater((w) => ({ ...w, kondisi_parit: v }))}
            />
            <FormField
              label="Lama Genangan (hari)"
              value={water.lama_genangan_hari !== null ? String(water.lama_genangan_hari) : ''}
              onChangeText={(v) => setWater((w) => ({ ...w, lama_genangan_hari: toNumberOrNull(v) }))}
              keyboardType="number-pad"
            />
            <FormField
              label="Catatan Water Management"
              value={water.catatan || ''}
              onChangeText={(v) => setWater((w) => ({ ...w, catatan: v || null }))}
              multiline
              numberOfLines={2}
            />
          </>
        )}
      </SectionCard>

      <SectionCard title="Bukti Lapangan (sesi)">
        <FormField label="Catatan umum" value={catatan} onChangeText={setCatatan} multiline numberOfLines={3} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Assessment'} onPress={handleSubmit} loading={submitting} />

      <OutOfAreaModal
        visible={showOutOfArea}
        blokLabel={blok?.code || '-'}
        onKembali={() => setShowOutOfArea(false)}
        onTetapSimpan={() => {
          setShowOutOfArea(false);
          doSave(true);
        }}
      />

      {editingIndex !== null && (
        <TreeEditorModal
          tree={trees[editingIndex]}
          photo={treePhotos[editingIndex]}
          onClose={() => setEditingIndex(null)}
          onUpdate={(patch) => updateTreeAt(editingIndex, patch)}
          onPhotoChange={(p) => setTreePhotos((prev) => prev.map((x, i) => (i === editingIndex ? p : x)))}
        />
      )}
    </ScreenContainer>
  );
}

// =================================================================================================
// Per-pokok editor, opened from the numbered grid above. Every control here only ever writes an
// EXCEPTION field - status_pokok itself is display-only (derived by the parent's deriveStatus), so
// there is nothing in this modal that needs to be touched for a pokok that's actually normal.
// =================================================================================================
function TreeEditorModal({
  tree,
  photo,
  onClose,
  onUpdate,
  onPhotoChange,
}: {
  tree: AssessmentTreeDraft;
  photo: CapturedPhoto | null;
  onClose: () => void;
  onUpdate: (patch: Partial<AssessmentTreeDraft>) => void;
  onPhotoChange: (p: CapturedPhoto | null) => void;
}) {
  const toggleKondisi = (tag: KondisiPokokTag) =>
    onUpdate({ kondisi: tree.kondisi.includes(tag) ? tree.kondisi.filter((t) => t !== tag) : [...tree.kondisi, tag] });

  const toggleGulma = (tag: GulmaTag) =>
    onUpdate({
      gulma_piringan: tree.gulma_piringan.includes(tag) ? tree.gulma_piringan.filter((t) => t !== tag) : [...tree.gulma_piringan, tag],
    });

  const toggleDefisiensi = (unsur: DefisiensiUnsur) => {
    const exists = tree.defisiensi.some((d) => d.unsur === unsur);
    onUpdate({
      defisiensi: exists ? tree.defisiensi.filter((d) => d.unsur !== unsur) : [...tree.defisiensi, { unsur, severity: 'RINGAN' as const }],
    });
  };

  const setDefisiensiSeverity = (unsur: DefisiensiUnsur, severity: DefisiensiSeverity) =>
    onUpdate({ defisiensi: tree.defisiensi.map((d) => (d.unsur === unsur ? { ...d, severity } : d)) });

  const toggleHama = (jenis: HamaJenis) => {
    const exists = tree.hama.some((h) => h.jenis === jenis);
    onUpdate({ hama: exists ? tree.hama.filter((h) => h.jenis !== jenis) : [...tree.hama, { jenis, catatan: null }] });
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
          <View style={styles.modalHeaderRow}>
            <View>
              <Text style={styles.modalTitle}>Pokok #{tree.pokok_index}</Text>
              <Text style={[styles.modalStatus, tree.status_pokok === 'EXCEPTION' ? styles.modalStatusException : styles.modalStatusNormal]}>
                {tree.status_pokok === 'EXCEPTION' ? 'Ada catatan' : 'Normal'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.modalCloseBtn}>
              <Text style={styles.modalCloseText}>Selesai</Text>
            </TouchableOpacity>
          </View>

          <SectionCard title="Kondisi Pokok">
            <ChipRow options={KONDISI_POKOK_OPTIONS.map((o) => ({ value: o.tag, label: o.label }))} selected={tree.kondisi} onToggle={toggleKondisi} />
          </SectionCard>

          <SectionCard title="Pruning">
            <SegmentedControl options={PRUNING_OPTIONS} value={tree.pruning} onChange={(v: PruningStatus) => onUpdate({ pruning: v })} />
          </SectionCard>

          <SectionCard title="Susunan Pelepah">
            <SegmentedControl options={SUSUNAN_PELEPAH_OPTIONS} value={tree.susunan_pelepah} onChange={(v) => onUpdate({ susunan_pelepah: v })} />
          </SectionCard>

          <SectionCard title="Piringan">
            <SegmentedControl
              options={BAIK_TIDAK_OPTIONS}
              value={tree.piringan}
              onChange={(v) => onUpdate({ piringan: v, gulma_piringan: v === 'BAIK' ? [] : tree.gulma_piringan })}
            />
            {tree.piringan === 'TIDAK_BAIK' && (
              <ChipRow options={GULMA_OPTIONS.map((o) => ({ value: o.tag, label: o.label }))} selected={tree.gulma_piringan} onToggle={toggleGulma} />
            )}
          </SectionCard>

          <SectionCard title="Defisiensi Hara" subtitle="Ketuk unsur yang bergejala, lalu pilih tingkat keparahan">
            <ChipRow options={DEFISIENSI_UNSUR_OPTIONS} selected={tree.defisiensi.map((d) => d.unsur)} onToggle={toggleDefisiensi} />
            {tree.defisiensi.map((d) => (
              <View key={d.unsur} style={styles.defisiensiRow}>
                <Text style={styles.defisiensiLabel}>{DEFISIENSI_UNSUR_OPTIONS.find((o) => o.value === d.unsur)?.label || d.unsur}</Text>
                <SegmentedControl options={DEFISIENSI_SEVERITY_OPTIONS} value={d.severity} onChange={(v) => setDefisiensiSeverity(d.unsur, v)} />
              </View>
            ))}
          </SectionCard>

          <SectionCard title="Hama" subtitle="Ketuk jenis hama yang terindikasi pada pokok ini">
            <ChipRow options={HAMA_OPTIONS.map((o) => ({ value: o.jenis, label: o.label }))} selected={tree.hama.map((h) => h.jenis)} onToggle={toggleHama} />
          </SectionCard>

          {tree.status_pokok === 'EXCEPTION' && (
            <SectionCard title="Foto Pokok" subtitle="Direkomendasikan untuk pokok bercatatan/abnormal">
              <PhotoField photo={photo} onChange={onPhotoChange} />
            </SectionCard>
          )}

          <SectionCard title="Catatan Pokok">
            <FormField label="Catatan" value={tree.catatan || ''} onChangeText={(v) => onUpdate({ catatan: v || null })} multiline numberOfLines={2} />
          </SectionCard>

          <Button title="Selesai" onPress={onClose} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

// =================================================================================================
// Small reusable chip controls - not promoted to components/ since this is the only screen with a
// multi-select/segmented-control need of this shape (every other screen's choices fit SelectField's
// single-value Picker).
// =================================================================================================
function ChipRow<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onToggle: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <TouchableOpacity key={opt.value} style={[styles.chip, active && styles.chipActive]} onPress={() => onToggle(opt.value)}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <TouchableOpacity key={opt.value} style={[styles.chip, active && styles.chipActive]} onPress={() => onChange(opt.value)}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  faseInfo: { fontSize: 12, color: colors.primaryDark, fontWeight: '600', marginBottom: spacing.sm },
  miniLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 4 },
  boolRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: spacing.sm },
  boolLabel: { fontSize: 13, fontWeight: '600', color: colors.text },

  treeGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  treeTile: { width: '16.66%', aspectRatio: 1, marginVertical: 3, paddingHorizontal: 3 },
  treeTileInner: { flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chip },
  treeTileInnerException: { backgroundColor: colors.warning },
  treeTileText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  treeTileTextException: { color: '#fff' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3, marginBottom: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    margin: 3,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  defisiensiRow: { marginBottom: spacing.sm },
  defisiensiLabel: { fontSize: 12, fontWeight: '700', color: colors.primaryDark, marginBottom: 4 },

  modalSafe: { flex: 1, backgroundColor: colors.bg },
  modalContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
  modalHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  modalTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  modalStatus: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  modalStatusNormal: { color: colors.success },
  modalStatusException: { color: colors.warning },
  modalCloseBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16 },
  modalCloseText: { color: '#fff', fontWeight: '700' },
});
