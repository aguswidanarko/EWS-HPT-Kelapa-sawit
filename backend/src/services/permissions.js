// Permission summary per role (BRD 01 section 4, BRD 02 section 39). Informational — returned
// in the login payload as "hak_akses" so clients can drive UI, while the real enforcement
// happens via requireRole() on each route.

const ROLE_PERMISSIONS = {
  ADMIN: ['ALL'],
  RND_FOD: ['VIEW_ALL', 'MANAGE_THRESHOLD', 'MANAGE_KNOWLEDGE_BASE', 'VIEW_REPORTS', 'VIEW_AUDIT_LOG'],
  MANAGER: ['VIEW_REGION', 'VIEW_REPORTS', 'UPDATE_ALERT_STATUS'],
  ASKEP_ASISTEN: ['VIEW_REGION', 'MANAGE_SCHEDULE', 'UPDATE_ALERT_STATUS', 'CREATE_TREATMENT', 'VIEW_REPORTS'],
  PETUGAS_DETEKSI: ['CREATE_DETECTION', 'VIEW_OWN_AREA'],
  PETUGAS_SENSUS: ['CREATE_SENSUS', 'VIEW_OWN_AREA'],
  PETUGAS_PENGENDALIAN: ['CREATE_TREATMENT', 'CREATE_MORTALITY', 'VIEW_OWN_AREA'],
};

module.exports = { ROLE_PERMISSIONS };
