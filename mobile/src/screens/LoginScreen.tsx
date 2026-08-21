import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import FormField from '../components/FormField';
import Button from '../components/Button';
import { useAuth } from '../state/AuthContext';
import { useNet } from '../state/NetContext';
import { colors, spacing } from '../theme';
import { APP_NAME } from '../config';

/** SPEC.md "Login: online-only pertama kali, session/token tersimpan aman untuk pemakaian offline
 * berikutnya". This screen is only ever shown when there is no cached session (see
 * navigation/RootNavigator.tsx) - so by construction, reaching it means a real login (which
 * requires connectivity) is needed. */
export default function LoginScreen() {
  const { login, loggingIn, loginError } = useAuth();
  const { isOnline } = useNet();
  const [email, setEmail] = useState('deteksi@ews.local');
  const [password, setPassword] = useState('');

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.logo}>🌴</Text>
            <Text style={styles.title}>{APP_NAME}</Text>
            <Text style={styles.subtitle}>Early Warning System Hama &amp; Penyakit Tanaman - Kelapa Sawit</Text>
          </View>

          {!isOnline && (
            <View style={styles.offlineNotice}>
              <Text style={styles.offlineNoticeText}>
                🔴 Anda sedang offline. Login pertama kali memerlukan koneksi internet. Sambungkan ke jaringan lalu coba lagi.
              </Text>
            </View>
          )}

          <FormField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="nama@ews.local"
          />
          <FormField
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
          />
          {loginError ? <Text style={styles.error}>{loginError}</Text> : null}

          <Button
            title={loggingIn ? 'Masuk...' : 'Masuk'}
            onPress={() => login(email.trim(), password)}
            loading={loggingIn}
            disabled={!isOnline || !email || !password}
          />

          <View style={styles.demoBox}>
            <Text style={styles.demoTitle}>Akun demo (password: password123)</Text>
            <Text style={styles.demoLine}>deteksi@ews.local - Petugas Deteksi</Text>
            <Text style={styles.demoLine}>sensus@ews.local - Petugas Sensus</Text>
            <Text style={styles.demoLine}>pengendalian@ews.local - Petugas Pengendalian</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingTop: spacing.xl * 2, flexGrow: 1 },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  logo: { fontSize: 48, marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },
  subtitle: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 4 },
  error: { color: colors.danger, marginBottom: spacing.sm },
  offlineNotice: { backgroundColor: '#FBE7E4', borderRadius: 8, padding: 10, marginBottom: spacing.md },
  offlineNoticeText: { color: colors.danger, fontSize: 12 },
  demoBox: { marginTop: spacing.xl, backgroundColor: colors.chip, borderRadius: 10, padding: spacing.md },
  demoTitle: { fontWeight: '700', fontSize: 12, marginBottom: 6, color: colors.primaryDark },
  demoLine: { fontSize: 12, color: colors.text, marginBottom: 2 },
});
