import { createContext, useContext, useState, useCallback } from 'react';
import { authApi } from '../api/resources';

const AuthContext = createContext(null);

function loadUser() {
  try {
    const raw = localStorage.getItem('ews_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(loadUser());

  const login = useCallback(async (email, password) => {
    const res = await authApi.login(email, password);
    localStorage.setItem('ews_access_token', res.access_token);
    localStorage.setItem('ews_refresh_token', res.refresh_token);
    localStorage.setItem('ews_user', JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('ews_access_token');
    localStorage.removeItem('ews_refresh_token');
    localStorage.removeItem('ews_user');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// Role helpers -------------------------------------------------------
export const ROLES = {
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  RND_FOD: 'RND_FOD',
  MANAGER: 'MANAGER',
  ASKEP_ASISTEN: 'ASKEP_ASISTEN',
  PETUGAS_DETEKSI: 'PETUGAS_DETEKSI',
  PETUGAS_SENSUS: 'PETUGAS_SENSUS',
  PETUGAS_PENGENDALIAN: 'PETUGAS_PENGENDALIAN',
  // V2 (SPEC_V2.md section 1 item 7)
  RISET: 'RISET',
  VIEWER_MANAGEMENT: 'VIEWER_MANAGEMENT',
};

export function hasRole(user, ...roles) {
  if (!user) return false;
  return roles.includes(user.role_code);
}

export function isAdmin(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN);
}

export function canWriteMaster(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN);
}

export function canWriteMasterHptThreshold(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canChangeAlertStatus(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.MANAGER, ROLES.ASKEP_ASISTEN, ROLES.RND_FOD);
}

export function canImport(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canManageUsers(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN);
}

export function canManageKb(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canManageNotificationRules(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canViewAuditLog(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD, ROLES.MANAGER);
}

export function canCreateDetection(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.PETUGAS_DETEKSI, ROLES.RND_FOD);
}

export function canCreateSensus(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.PETUGAS_SENSUS, ROLES.RND_FOD);
}

export function canCreateTreatment(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.PETUGAS_PENGENDALIAN, ROLES.ASKEP_ASISTEN);
}

export function canCreateMortality(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.PETUGAS_PENGENDALIAN);
}

// ---- V2 role helpers (SPEC_V2.md) ----------------------------------

// Mirrors backend routes/yieldMaking.js CREATE_ROLES.
export function canCreateYieldMaking(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD, ROLES.PETUGAS_SENSUS, ROLES.ASKEP_ASISTEN);
}

// Mirrors backend routes/leafAnalysis.js WRITE_ROLES (Riset lab-side record).
export function canManageLeafAnalysis(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RISET, ROLES.RND_FOD);
}

// Mirrors backend routes/defisiensiHara.js POST roles (field findings by Mandor/Petugas).
export function canCreateDefisiensiHaraTemuan(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.PETUGAS_DETEKSI, ROLES.PETUGAS_SENSUS, ROLES.ASKEP_ASISTEN, ROLES.RND_FOD);
}

export function canEditDefisiensiHaraTemuan(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.ASKEP_ASISTEN, ROLES.RND_FOD);
}

// Mirrors backend routes/actionPlans.js requireRole lists.
export function canCreateActionPlan(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.ASKEP_ASISTEN, ROLES.MANAGER, ROLES.RND_FOD);
}

export function canUpdateActionPlan(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.ASKEP_ASISTEN, ROLES.MANAGER, ROLES.RND_FOD, ROLES.PETUGAS_PENGENDALIAN);
}

export function canVerifyActionPlan(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.ASKEP_ASISTEN, ROLES.MANAGER, ROLES.RND_FOD);
}

// Mirrors backend routes/schedulingRules.js / formulas.js WRITE_ROLES — the Rule & Parameter
// Management CRUD surface (formula/threshold/sampling_rule/scheduling_rule).
export function canManageRules(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canGenerateSchedule(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD, ROLES.ASKEP_ASISTEN, ROLES.MANAGER);
}

// Mirrors backend routes/scoring.js requireRole lists.
export function canManageScoringCriteria(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD);
}

export function canEnterScoring(user) {
  return hasRole(user, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.RND_FOD, ROLES.ASKEP_ASISTEN, ROLES.MANAGER);
}
