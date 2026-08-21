import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ConnectionPill from './ConnectionPill';
import { colors, spacing } from '../theme';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  showPill?: boolean;
  style?: ViewStyle;
}

/** Standard screen chrome: safe-area + persistent connection pill (SPEC.md "Header status
 * koneksi" - shown on every screen, not just Home) + optional scroll container for forms. */
export default function ScreenContainer({ children, scroll = true, showPill = true, style }: Props) {
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {showPill && (
        <View style={styles.pillRow}>
          <ConnectionPill />
        </View>
      )}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Body
          style={[styles.flex, style]}
          contentContainerStyle={scroll ? styles.scrollContent : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </Body>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  pillRow: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.xl * 2 },
});
