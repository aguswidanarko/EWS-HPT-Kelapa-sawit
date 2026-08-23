import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { MasterDataProvider } from './context/MasterDataContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';

import Login from './pages/Login';
import DashboardUtama from './pages/DashboardUtama';
import PetaEWS from './pages/PetaEWS';
import Deteksi from './pages/Deteksi';
import Sensus from './pages/Sensus';
import Pengendalian from './pages/Pengendalian';
import Mortalitas from './pages/Mortalitas';
import AlertCenter from './pages/AlertCenter';
import AlertDetail from './pages/AlertDetail';
import IncidentManagement from './pages/IncidentManagement';
import IncidentDetail from './pages/IncidentDetail';
import KnowledgeBase from './pages/KnowledgeBase';
import ImportData from './pages/ImportData';
import MasterData from './pages/MasterData';
import PicUser from './pages/PicUser';
import Notification from './pages/Notification';
import Report from './pages/Report';
import AuditLog from './pages/AuditLog';
import SystemSettings from './pages/SystemSettings';

// V2 (SPEC_V2.md section 4 Dashboard)
import Partenocarpi from './pages/yieldMaking/Partenocarpi';
import WaterManagement from './pages/yieldMaking/WaterManagement';
import BahanOrganik from './pages/yieldMaking/BahanOrganik';
import TbmVegetatif from './pages/yieldMaking/TbmVegetatif';
import DefisiensiHara from './pages/DefisiensiHara';
import ActionPlanList from './pages/ActionPlanList';
import ActionPlanDetail from './pages/ActionPlanDetail';
import MonitoringSchedule from './pages/MonitoringSchedule';
import RuleParameterManagement from './pages/RuleParameterManagement';
import ScoringKpi from './pages/ScoringKpi';

function AuthedShell() {
  return (
    <ProtectedRoute>
      <MasterDataProvider>
        <Layout />
      </MasterDataProvider>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AuthedShell />}>
            <Route path="/" element={<DashboardUtama />} />
            <Route path="/peta" element={<PetaEWS />} />
            <Route path="/deteksi" element={<Deteksi />} />
            <Route path="/sensus" element={<Sensus />} />
            <Route path="/pengendalian" element={<Pengendalian />} />
            <Route path="/mortalitas" element={<Mortalitas />} />
            <Route path="/alerts" element={<AlertCenter />} />
            <Route path="/alerts/:id" element={<AlertDetail />} />
            <Route path="/incidents" element={<IncidentManagement />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route path="/yield-making/partenocarpi" element={<Partenocarpi />} />
            <Route path="/yield-making/water-management" element={<WaterManagement />} />
            <Route path="/yield-making/bahan-organik" element={<BahanOrganik />} />
            <Route path="/yield-making/tbm-vegetatif" element={<TbmVegetatif />} />
            <Route path="/defisiensi-hara" element={<DefisiensiHara />} />
            <Route path="/action-plans" element={<ActionPlanList />} />
            <Route path="/action-plans/:id" element={<ActionPlanDetail />} />
            <Route path="/monitoring-schedule" element={<MonitoringSchedule />} />
            <Route path="/rules" element={<RuleParameterManagement />} />
            <Route path="/scoring" element={<ScoringKpi />} />
            <Route path="/knowledge-base" element={<KnowledgeBase />} />
            <Route path="/import" element={<ImportData />} />
            <Route path="/master" element={<MasterData />} />
            <Route path="/pic-user" element={<PicUser />} />
            <Route path="/notification" element={<Notification />} />
            <Route path="/report" element={<Report />} />
            <Route path="/audit-log" element={<AuditLog />} />
            <Route path="/settings" element={<SystemSettings />} />
            <Route path="*" element={<DashboardUtama />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
