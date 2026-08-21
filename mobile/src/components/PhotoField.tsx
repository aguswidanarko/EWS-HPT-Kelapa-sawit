import React, { useState } from 'react';
import { ActionSheetIOS, Alert, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { pickPhotoFromLibrary, takePhoto, type CapturedPhoto } from '../domain/photo';
import { colors, spacing } from '../theme';

interface Props {
  label?: string;
  photo: CapturedPhoto | null;
  onChange: (photo: CapturedPhoto | null) => void;
}

/** SPEC.md "Foto": kamera capture, compressed before save/sync (compression happens inside
 * domain/photo.ts before this component ever sees a URI). Falls back to the gallery picker too,
 * useful when testing without a working camera. */
export default function PhotoField({ label = 'Foto', photo, onChange }: Props) {
  const [busy, setBusy] = useState(false);

  const choose = async (fromCamera: boolean) => {
    setBusy(true);
    try {
      const result = fromCamera ? await takePhoto() : await pickPhotoFromLibrary();
      if (result) onChange(result);
    } catch {
      Alert.alert('Gagal', 'Tidak dapat mengambil foto.');
    } finally {
      setBusy(false);
    }
  };

  const openOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Batal', 'Kamera', 'Galeri'], cancelButtonIndex: 0 },
        (idx) => {
          if (idx === 1) choose(true);
          if (idx === 2) choose(false);
        }
      );
    } else {
      Alert.alert('Ambil Foto', undefined, [
        { text: 'Kamera', onPress: () => choose(true) },
        { text: 'Galeri', onPress: () => choose(false) },
        { text: 'Batal', style: 'cancel' },
      ]);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {photo ? (
        <View>
          <Image source={{ uri: photo.uri }} style={styles.thumb} />
          <View style={styles.row}>
            <TouchableOpacity onPress={openOptions} style={styles.smallBtn} disabled={busy}>
              <Text style={styles.smallBtnText}>Ganti foto</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onChange(null)} style={[styles.smallBtn, styles.removeBtn]}>
              <Text style={[styles.smallBtnText, styles.removeText]}>Hapus</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity onPress={openOptions} style={styles.captureBtn} disabled={busy}>
          <Text style={styles.captureText}>{busy ? 'Memproses...' : '📷 Ambil / pilih foto'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  captureBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: colors.card,
  },
  captureText: { color: colors.primaryDark, fontWeight: '600' },
  thumb: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#eee' },
  row: { flexDirection: 'row', marginTop: 6, gap: 8 },
  smallBtn: { paddingVertical: 6, paddingHorizontal: 10, backgroundColor: colors.chip, borderRadius: 6 },
  smallBtnText: { color: colors.primaryDark, fontSize: 12, fontWeight: '600' },
  removeBtn: { backgroundColor: '#FBE7E4' },
  removeText: { color: colors.danger },
});
