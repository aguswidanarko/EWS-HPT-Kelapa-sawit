import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Text } from 'react-native';
import HomeScreen from '../screens/HomeScreen';
import RiwayatScreen from '../screens/RiwayatScreen';
import SyncCenterScreen from '../screens/SyncCenterScreen';
import PanduanListScreen from '../screens/PanduanListScreen';
import { colors } from '../theme';
import type { MainTabParamList } from './types';
import { useSync } from '../state/SyncContext';

const Tab = createBottomTabNavigator<MainTabParamList>();

const ICONS: Record<keyof MainTabParamList, string> = {
  Home: '🏠',
  Riwayat: '🕓',
  Sinkronisasi: '🔄',
  Panduan: '📘',
};

export default function MainTabs() {
  const { pendingTotal } = useSync();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: () => <Text style={{ fontSize: 18 }}>{ICONS[route.name]}</Text>,
        tabBarBadge: route.name === 'Sinkronisasi' && pendingTotal > 0 ? pendingTotal : undefined,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen as never} options={{ title: 'Beranda' }} />
      <Tab.Screen name="Riwayat" component={RiwayatScreen as never} options={{ title: 'Riwayat' }} />
      <Tab.Screen name="Sinkronisasi" component={SyncCenterScreen} options={{ title: 'Sinkronisasi' }} />
      <Tab.Screen name="Panduan" component={PanduanListScreen as never} options={{ title: 'Panduan' }} />
    </Tab.Navigator>
  );
}
