// Permission summary per role (BRD 01 section 4, BRD 02 section 39). Informational — returned
// in the login payload as "hak_akses" so clients can drive UI, while the real enforcement
// happens via requireRole() on each route.

const ROLE_PERMISSIONS = {
  ADMIN: ['ALL'],
  // V2 (SPEC_V2.md section 1 item 7): SUPER_ADMIN sits above ADMIN (full access + system config).
  SUPER_ADMIN: ['ALL', 'SYSTEM_CONFIG'],
  RND_FOD: ['VIEW_ALL', 'MANAGE_THRESHOLD', 'MANAGE_KNOWLEDGE_BASE', 'VIEW_REPORTS', 'VIEW_AUDIT_LOG'],
  MANAGER: ['VIEW_REGION', 'VIEW_REPORTS', 'UPDATE_ALERT_STATUS'],
  ASKEP_ASISTEN: ['VIEW_REGION', 'MANAGE_SCHEDULE', 'UPDATE_ALERT_STATUS', 'CREATE_TREATMENT', 'VIEW_REPORTS'],
  PETUGAS_DETEKSI: ['CREATE_DETECTION', 'VIEW_OWN_AREA'],
  PETUGAS_SENSUS: ['CREATE_SENSUS', 'VIEW_OWN_AREA'],
  PETUGAS_PENGENDALIAN: ['CREATE_TREATMENT', 'CREATE_MORTALITY', 'VIEW_OWN_AREA'],
  // V3.2: generic field officer, one shared mobile login per Afdeling ("Master User Mobile Apps
  // per Afdeling") -- unlike the 3 siloed PETUGAS_* roles above, this one can submit every field
  // data type from a single account so one afdeling-level login covers Deteksi/Sensus/
  // Pengendalian/Mortalitas/Yield Making/Assessment/Agro Observation/Defisiensi Hara. See
  // requireRole(...) call sites across routes/detection.js, sensus.js, treatment.js, mortality.js,
  // yieldMaking.js, assessment.js, agroObservation.js, defisiensiHara.js, actionPlans.js.
  PETUGAS_LAPANGAN: [
    'CREATE_DETECTION', 'CREATE_SENSUS', 'CREATE_TREATMENT', 'CREATE_MORTALITY',
    'CREATE_YIELD_MAKING', 'CREATE_ASSESSMENT', 'CREATE_AGRO_OBSERVATION',
    'CREATE_DEFISIENSI_HARA', 'UPDATE_ACTION_PLAN', 'VIEW_OWN_AREA',
  ],
  // V2 (SPEC_V2.md section 1 item 7): RISET is a NEW role for leaf analysis/defisiensi hara,
  // separate from RND_FOD (which stays the HPT/Yield Making field-analytical role).
  RISET: ['CREATE_LEAF_ANALYSIS', 'VIEW_DEFISIENSI_HARA', 'VIEW_OWN_AREA'],
  // V2: read-only role for CEO/Management (BRD section 9 UI/UX).
  VIEWER_MANAGEMENT: ['VIEW_ALL', 'VIEW_REPORTS'],
};

module.exports = { ROLE_PERMISSIONS };
