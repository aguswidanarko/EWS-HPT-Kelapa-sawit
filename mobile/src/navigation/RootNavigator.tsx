import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import LoginScreen from '../screens/LoginScreen';
import MainTabs from './MainTabs';
import DeteksiFormScreen from '../screens/DeteksiFormScreen';
import SensusMenuScreen from '../screens/SensusMenuScreen';
import SensusUPDKSScreen from '../screens/sensus/SensusUPDKSScreen';
import SensusTikusScreen from '../screens/sensus/SensusTikusScreen';
import SensusOryctesScreen from '../screens/sensus/SensusOryctesScreen';
import SensusRayapScreen from '../screens/sensus/SensusRayapScreen';
import SensusGanodermaScreen from '../screens/sensus/SensusGanodermaScreen';
import PengendalianFormScreen from '../screens/PengendalianFormScreen';
import MortalitasFormScreen from '../screens/MortalitasFormScreen';
import PanduanDetailScreen from '../screens/PanduanDetailScreen';
import RiwayatDetailScreen from '../screens/RiwayatDetailScreen';
import { useAuth } from '../state/AuthContext';
import type { RootStackParamList } from './types';
import { colors } from '../theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { user, initializing } = useAuth();

  if (initializing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.card }, headerTintColor: colors.text }}>
        {!user ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="Deteksi" component={DeteksiFormScreen} options={{ title: 'Deteksi HPT' }} />
            <Stack.Screen name="SensusMenu" component={SensusMenuScreen} options={{ title: 'Sensus' }} />
            <Stack.Screen name="SensusUPDKS" component={SensusUPDKSScreen} options={{ title: 'Sensus UPDKS' }} />
            <Stack.Screen name="SensusTikus" component={SensusTikusScreen} options={{ title: 'Sensus Tikus' }} />
            <Stack.Screen name="SensusOryctes" component={SensusOryctesScreen} options={{ title: 'Sensus Oryctes' }} />
            <Stack.Screen name="SensusRayap" component={SensusRayapScreen} options={{ title: 'Sensus Rayap' }} />
            <Stack.Screen name="SensusGanoderma" component={SensusGanodermaScreen} options={{ title: 'Sensus Ganoderma' }} />
            <Stack.Screen name="Pengendalian" component={PengendalianFormScreen} options={{ title: 'Pengendalian' }} />
            <Stack.Screen name="Mortalitas" component={MortalitasFormScreen} options={{ title: 'Sensus Mortalitas' }} />
            <Stack.Screen name="PanduanDetail" component={PanduanDetailScreen} options={{ title: 'Panduan' }} />
            <Stack.Screen name="RiwayatDetail" component={RiwayatDetailScreen} options={{ title: 'Detail Riwayat' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
