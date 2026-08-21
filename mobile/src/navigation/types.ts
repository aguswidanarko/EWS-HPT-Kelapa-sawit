import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Riwayat: undefined;
  Sinkronisasi: undefined;
  Panduan: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Deteksi: undefined;
  SensusMenu: undefined;
  SensusUPDKS: undefined;
  SensusTikus: undefined;
  SensusOryctes: undefined;
  SensusRayap: undefined;
  SensusGanoderma: undefined;
  Pengendalian: undefined;
  Mortalitas: undefined;
  PanduanDetail: { id: number };
  RiwayatDetail: { kind: 'deteksi' | 'sensus' | 'treatment' | 'mortalitas'; localId: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
