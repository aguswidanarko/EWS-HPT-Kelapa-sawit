import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import ScreenContainer from '../components/ScreenContainer';
import SectionCard from '../components/SectionCard';
import FormField from '../components/FormField';
import SelectField from '../components/SelectField';
import PhotoField from '../components/PhotoField';
import Button from '../components/Button';
import { useAuth } from '../state/AuthContext';
import { useSync } from '../state/SyncContext';
import { getCachedActionPlanById, getLatestPendingUpdateFor, insertActionPlanUpdate } from '../db/repo/actionPlanRepo';
import { insertPhoto } from '../db/repo/photoRepo';
import type { CapturedPhoto } from '../domain/photo';
import { uuid } from '../utils/uuid';
import { nowIso, formatDate } from '../utils/format';
import { getDeviceId } from '../utils/device';
import { ACTION_PLAN_STATUSES, type ActionPlanStatus, type CachedActionPlan, type LocalActionPlanUpdate } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { colors, spacing } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'ActionPlanDetail'>;

/** SPEC_V2.md section 4 Mobile: "form to update actual_action/status/note/photo. Status flow
 * Open->Planned->In Progress->Completed->Verified->Closed - CATATAN: beda 6-state dari Alert
 * 7-state, JANGAN disamakan." This screen only edits actual_action/status/evidence photo (PUT
 * /action-plans/:id editable fields per routes/actionPlans.js) - "note" maps onto `actual_action`
 * since action_plan has no separate free-text notes column beyond verification_note (that field is
 * reserved for the ADMIN-only /verify step, not the field officer's update - judgment call). */
export default function ActionPlanDetailScreen({ route }: Props) {
  const { id } = route.params;
  const { user } = useAuth();
  const { notifyDataChanged } = useSync();

  const [plan, setPlan] = useState<CachedActionPlan | null>(null);
  const [pendingUpdate, setPendingUpdate] = useState<LocalActionPlanUpdate | null>(null);
  const [status, setStatus] = useState<ActionPlanStatus | null>(null);
  const [actualAction, setActualAction] = useState('');
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    getCachedActionPlanById(id).then((row) => {
      setPlan(row);
      setStatus((row?.status as ActionPlanStatus) ?? null);
      setActualAction(row?.actual_action ?? '');
    });
    getLatestPendingUpdateFor(id).then(setPendingUpdate);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleSubmit = async () => {
    if (!plan) return;
    if (!status) return Alert.alert('Lengkapi data', 'Status wajib dipilih.');
    setSubmitting(true);
    try {
      const local_id = uuid();
      const device_id = await getDeviceId();
      const now = nowIso();

      await insertActionPlanUpdate({
        local_id,
        action_plan_id: plan.id,
        status,
        actual_action: actualAction || null,
        foto_local_id: photo ? local_id : null,
        evidence_photo_id: null,
        user_id: user?.id ?? null,
        device_id,
        created_at: now,
        updated_at: now,
        sync_status: 'READY_TO_SYNC',
        sync_attempt: 0,
        sync_error: null,
        source: 'MOBILE',
      });

      if (photo) {
        await insertPhoto({
          local_id,
          entity_type: 'ACTION_PLAN',
          entity_local_id: local_id,
          file_uri: photo.uri,
          gps_lat: null,
          gps_lng: null,
          timestamp: now,
          user_id: user?.id ?? null,
          compressed_size: photo.size,
          uploaded: 0,
          server_photo_id: null,
        });
      }

      notifyDataChanged();
      setPhoto(null);
      Alert.alert('Update tersimpan', 'Perubahan tersimpan lokal dan siap disinkronkan.');
      load();
    } catch (e) {
      Alert.alert('Gagal menyimpan', e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  if (!plan) {
    return (
      <ScreenContainer>
        <Text style={styles.empty}>Memuat data Action Plan...</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <SectionCard title="Detail Action Plan">
        <Row label="Masalah" value={plan.problem} />
        <Row label="Rekomendasi" value={plan.recommendation} />
        <Row label="Due date" value={plan.due_date ? formatDate(plan.due_date) : '-'} />
        <Row label="Status saat ini" value={plan.status} />
        {!!plan.overdue && <Text style={styles.warn}>⏰ Overdue - segera tindak lanjuti.</Text>}
        {!!plan.escalated && <Text style={styles.warn}>🚨 Sudah dieskalasi.</Text>}
        {plan.verification_note ? <Row label="Catatan verifikasi" value={plan.verification_note} /> : null}
      </SectionCard>

      {pendingUpdate && (
        <SectionCard title="Perubahan Lokal Menunggu Sinkron">
          <Text style={styles.pendingNote}>
            Anda punya perubahan yang belum tersinkron (status → {pendingUpdate.status}, tersimpan {formatDate(pendingUpdate.created_at)}). Update
            baru di bawah akan menambah antrean sinkronisasi baru.
          </Text>
        </SectionCard>
      )}

      <SectionCard title="Update Progress">
        <SelectField
          label="Status baru"
          required
          value={status}
          options={ACTION_PLAN_STATUSES.map((s) => ({ label: s.replace(/_/g, ' '), value: s }))}
          onChange={(v) => setStatus(v)}
        />
        <FormField
          label="Tindakan / catatan"
          value={actualAction}
          onChangeText={setActualAction}
          multiline
          numberOfLines={4}
          placeholder="Deskripsikan tindakan yang sudah dilakukan"
        />
        <PhotoField label="Foto bukti" photo={photo} onChange={setPhoto} />
      </SectionCard>

      <Button title={submitting ? 'Menyimpan...' : 'Simpan Update'} onPress={handleSubmit} loading={submitting} />
    </ScreenContainer>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#F0F2F1' },
  rowLabel: { width: 130, fontSize: 12, color: colors.textMuted },
  rowValue: { flex: 1, fontSize: 13, color: colors.text, fontWeight: '600' },
  warn: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 6 },
  pendingNote: { fontSize: 12, color: colors.warning, fontWeight: '600' },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.lg },
});
