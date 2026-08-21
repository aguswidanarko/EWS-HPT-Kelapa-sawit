import React from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, spacing } from '../theme';

interface Props {
  visible: boolean;
  blokLabel: string;
  onKembali: () => void;
  onTetapSimpan: () => void;
}

/** SPEC.md section 6 GPS warning: "Lokasi Anda berada di luar area Blok <X>" with
 * [Kembali ke lokasi] / [Tetap simpan]. Proceeding sets location_warning=true but still saves. */
export default function OutOfAreaModal({ visible, blokLabel, onKembali, onTetapSimpan }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onKembali}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>⚠️ Lokasi Anda berada di luar area Blok {blokLabel}</Text>
          <Text style={styles.body}>
            Titik GPS yang tercatat berada di luar batas referensi blok ini. Anda tetap dapat menyimpan data,
            tetapi data akan ditandai sebagai peringatan lokasi (location_warning) untuk ditinjau.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={onKembali}>
            <Text style={styles.primaryText}>Kembali ke lokasi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={onTetapSimpan}>
            <Text style={styles.secondaryText}>Tetap simpan</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.card, borderRadius: 14, padding: spacing.lg },
  title: { fontSize: 16, fontWeight: '700', color: colors.danger, marginBottom: 10 },
  body: { fontSize: 13, color: colors.text, lineHeight: 19, marginBottom: spacing.md },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 12, alignItems: 'center', marginBottom: 8 },
  primaryText: { color: '#fff', fontWeight: '700' },
  secondaryBtn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: colors.text, fontWeight: '600' },
});
