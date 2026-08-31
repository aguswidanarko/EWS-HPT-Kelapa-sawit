import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import LoginScreen from '../screens/LoginScreen';
import MainTabs from './MainTabs';
import DeteksiFormScreen from '../screens/DeteksiFormScreen';
import EwsPickerScreen from '../screens/EwsPickerScreen';
import EwsFormScreen from '../screens/EwsFormScreen';
import SensusMenuScreen from '../screens/SensusMenuScreen';
import SensusUPDKSScreen from '../screens/sensus/SensusUPDKSScreen';
import SensusTikusScreen from '../screens/sensus/SensusTikusScreen';
import SensusOryctesScreen from '../screens/sensus/SensusOryctesScreen';
import SensusRayapScreen from '../screens/sensus/SensusRayapScreen';
import SensusGanodermaScreen from '../screens/sensus/SensusGanodermaScreen';
import PengendalianFormScreen from '../screens/PengendalianFormScreen';
import MortalitasFormScreen from '../screens/MortalitasFormScreen';
import YieldMakingMenuScreen from '../screens/YieldMakingMenuScreen';
import PartenocarpiFormScreen from '../screens/yield/PartenocarpiFormScreen';
import WaterManagementFormScreen from '../screens/yield/WaterManagementFormScreen';
import BahanOrganikFormScreen from '../screens/yield/BahanOrganikFormScreen';
import TbmVegetatifFormScreen from '../screens/yield/TbmVegetatifFormScreen';
import DefisiensiHaraScreen from '../screens/DefisiensiHaraScreen';
import ActionPlanScreen from '../screens/ActionPlanScreen';
import ActionPlanDetailScreen from '../screens/ActionPlanDetailScreen';
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
            <Stack.Screen name="EwsPicker" component={EwsPickerScreen} options={{ title: 'Observasi EWS' }} />
            <Stack.Screen name="EwsForm" component={EwsFormScreen} options={{ title: 'Input Data EWS' }} />
            <Stack.Screen name="SensusMenu" component={SensusMenuScreen} options={{ title: 'Sensus' }} />
            <Stack.Screen name="SensusUPDKS" component={SensusUPDKSScreen} options={{ title: 'Sensus UPDKS' }} />
            <Stack.Screen name="SensusTikus" component={SensusTikusScreen} options={{ title: 'Sensus Tikus' }} />
            <Stack.Screen name="SensusOryctes" component={SensusOryctesScreen} options={{ title: 'Sensus Oryctes' }} />
            <Stack.Screen name="SensusRayap" component={SensusRayapScreen} options={{ title: 'Sensus Rayap' }} />
            <Stack.Screen name="SensusGanoderma" component={SensusGanodermaScreen} options={{ title: 'Sensus Ganoderma' }} />
            <Stack.Screen name="Pengendalian" component={PengendalianFormScreen} options={{ title: 'Pengendalian' }} />
            <Stack.Screen name="Mortalitas" component={MortalitasFormScreen} options={{ title: 'Sensus Mortalitas' }} />
            <Stack.Screen name="YieldMakingMenu" component={YieldMakingMenuScreen} options={{ title: 'Yield Making' }} />
            <Stack.Screen name="Partenocarpi" component={PartenocarpiFormScreen} options={{ title: 'Partenocarpi' }} />
            <Stack.Screen name="WaterManagement" component={WaterManagementFormScreen} options={{ title: 'Water Management' }} />
            <Stack.Screen name="BahanOrganik" component={BahanOrganikFormScreen} options={{ title: 'Bahan Organik' }} />
            <Stack.Screen name="TbmVegetatif" component={TbmVegetatifFormScreen} options={{ title: 'TBM Vegetatif' }} />
            <Stack.Screen name="DefisiensiHara" component={DefisiensiHaraScreen} options={{ title: 'Defisiensi Hara' }} />
            <Stack.Screen name="ActionPlan" component={ActionPlanScreen} options={{ title: 'Action Plan' }} />
            <Stack.Screen name="ActionPlanDetail" component={ActionPlanDetailScreen} options={{ title: 'Update Action Plan' }} />
            <Stack.Screen name="PanduanDetail" component={PanduanDetailScreen} options={{ title: 'Panduan' }} />
            <Stack.Screen name="RiwayatDetail" component={RiwayatDetailScreen} options={{ title: 'Detail Riwayat' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
