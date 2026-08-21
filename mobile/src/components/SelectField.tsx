import { Picker } from '@react-native-picker/picker';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '../theme';

export interface SelectOption<T extends string | number> {
  label: string;
  value: T;
}

interface Props<T extends string | number> {
  label: string;
  required?: boolean;
  value: T | null;
  options: SelectOption<T>[];
  onChange: (value: T | null) => void;
  placeholder?: string;
  disabled?: boolean;
  hint?: string;
}

/** Wraps @react-native-picker/picker with a consistent label/required/hint layout, used for every
 * cascading master-data select (Estate/Afdeling/Blok/HPT/Species/metode/...). */
export default function SelectField<T extends string | number>({
  label,
  required,
  value,
  options,
  onChange,
  placeholder = 'Pilih...',
  disabled,
  hint,
}: Props<T>) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <View style={[styles.pickerBox, disabled ? styles.disabled : undefined]}>
        <Picker
          enabled={!disabled}
          selectedValue={value ?? ''}
          onValueChange={(v) => {
            if (v === '') return onChange(null);
            onChange(v as T);
          }}
        >
          <Picker.Item label={placeholder} value="" color={colors.textMuted} />
          {options.map((opt) => (
            <Picker.Item key={String(opt.value)} label={opt.label} value={opt.value} />
          ))}
        </Picker>
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4 },
  required: { color: colors.danger },
  pickerBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.card, overflow: 'hidden' },
  disabled: { opacity: 0.5 },
  hint: { fontSize: 11, color: colors.textMuted, marginTop: 4 },
});
