import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initDatabase } from './src/db/database';
import { NetProvider } from './src/state/NetContext';
import { AuthProvider } from './src/state/AuthContext';
import { SyncProvider } from './src/state/SyncContext';
import RootNavigator from './src/navigation/RootNavigator';
import { colors } from './src/theme';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    initDatabase()
      .then(() => setDbReady(true))
      .catch((e) => setDbError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (dbError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Gagal menyiapkan penyimpanan lokal</Text>
        <Text style={styles.errorBody}>{dbError}</Text>
      </View>
    );
  }

  if (!dbReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Menyiapkan database lokal...</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NetProvider>
        <AuthProvider>
          <SyncProvider>
            <RootNavigator />
            <StatusBar style="dark" />
          </SyncProvider>
        </AuthProvider>
      </NetProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24 },
  loadingText: { marginTop: 12, color: colors.textMuted },
  errorTitle: { fontWeight: '800', fontSize: 16, color: colors.danger, marginBottom: 8, textAlign: 'center' },
  errorBody: { color: colors.text, fontSize: 12, textAlign: 'center' },
});
