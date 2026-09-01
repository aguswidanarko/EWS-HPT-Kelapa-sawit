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
  // V3 Dynamic Form Engine (BRD_V3_Mobile_Offline.docx section 3): EwsPicker + EwsForm cover all
  // 32 EWS_IDs (see domain/ewsFormSchema.ts) and replace the old per-indicator screens below as
  // Home's navigation targets. The old screens/routes are kept registered (not deleted) so any
  // in-flight deep link or rollback still works; only HomeScreen.tsx no longer points at them.
  EwsPicker: { scope?: 'HPT' | 'Yield Making' | 'Agro' | 'WM' } | undefined;
  EwsForm: { ews_id: string };
  // V3.1 Universal Assessment Form (BRD_Mobile_V3_1.docx): PRIMARY entry point for 29 of the 31
  // EWS indicators (see domain/assessmentSchema.ts + services/assessmentEngine.js) - one visit,
  // many pokok, backend computes every relevant EWS result. EwsPicker/EwsForm above stay
  // available for the remainder (Yield Making, Pokok Doyong) and as a manual fallback.
  Assessment: undefined;
  SensusMenu: undefined;
  SensusUPDKS: undefined;
  SensusTikus: undefined;
  SensusOryctes: undefined;
  SensusRayap: undefined;
  SensusGanoderma: undefined;
  Pengendalian: undefined;
  Mortalitas: undefined;
  YieldMakingMenu: undefined;
  Partenocarpi: undefined;
  WaterManagement: undefined;
  BahanOrganik: undefined;
  TbmVegetatif: undefined;
  DefisiensiHara: undefined;
  ActionPlan: undefined;
  ActionPlanDetail: { id: number };
  PanduanDetail: { id: number };
  RiwayatDetail: {
    kind:
      | 'deteksi'
      | 'sensus'
      | 'treatment'
      | 'mortalitas'
      | 'partenocarpi'
      | 'water_management'
      | 'bahan_organik'
      | 'tbm_vegetatif'
      | 'defisiensi_hara'
      | 'agro_observation'
      | 'action_plan';
    localId: string;
  };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
