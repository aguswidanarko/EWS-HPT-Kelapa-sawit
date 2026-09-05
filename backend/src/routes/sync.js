// Mobile Sync API (BRD 01 section 6 / BRD 02 section 49): download master/threshold/knowledge
// base/jadwal, batch upload deteksi/sensus/treatment/mortalitas, photo upload, sync status,
// push-notification stub.
//
// Conflict policy (SPEC.md section 6 "Konflik data"): server is source of truth for master data
// (mobile only ever downloads master, never writes it here). For field records: a record that
// already has a server_id is NEVER silently overwritten on re-upload — the incoming payload is
// inserted as a new versioned row (sharing the same activity_id) and the conflict is written to
// AUDIT_LOG so it's traceable.

const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadPhoto } = require('../middleware/upload');
const { ingestDetection, ingestSensus, ingestTreatment, ingestMortality } = require('../services/ingestion');
const { logAudit } = require('../services/audit');
const path = require('path');

const router = express.Router();
router.use(requireAuth);

// ------------------------------------------------------------ DOWNLOAD MASTER
router.get(
  '/master',
  asyncHandler(async (req, res) => {
    // V3.2: regions/bisnis_units sent alongside estates so the mobile Region/Bisnis Unit ->
    // PT cascade (LocationCascade.tsx) works fully offline, same as estates/afdelings/bloks
    // always have -- see masterRepo.ts saveMasterData() on the mobile side.
    const regions = db.prepare('SELECT * FROM region').all();
    const bisnisUnits = db.prepare('SELECT * FROM bisnis_unit').all();
    const estates = db.prepare('SELECT * FROM estate').all();
    const afdelings = db.prepare('SELECT * FROM afdeling').all();
    const bloks = db.prepare('SELECT * FROM blok').all();
    const hpt = db.prepare('SELECT * FROM hpt WHERE status_aktif=1').all();
    const species = db.prepare('SELECT * FROM species').all();
    res.json({
      data: { regions, bisnis_units: bisnisUnits, estates, afdelings, bloks, hpt, species },
      synced_at: new Date().toISOString(),
    });
  })
);

router.get(
  '/threshold',
  asyncHandler(async (req, res) => {
    const rows = db.prepare(`SELECT * FROM threshold WHERE status='AKTIF' ORDER BY hpt_id, effective_date DESC`).all();
    res.json({ data: rows, synced_at: new Date().toISOString() });
  })
);

router.get(
  '/knowledge-base',
  asyncHandler(async (req, res) => {
    // V2 (SPEC_V2.md section 1 item 8): mobile only ever receives PUBLISHED documents.
    // status_aktif ("still valid business-wise") and publish_status ("publication stage") are
    // independent -- both must hold for a document to be worth syncing to a device.
    const rows = db.prepare(`SELECT * FROM knowledge_base WHERE status_aktif=1 AND publish_status='PUBLISHED' ORDER BY updated_at DESC`).all();
    const withUrls = rows.map((r) => ({ ...r, download_url: r.file_path ? `/api/knowledge-base/${r.id}/file` : null }));
    res.json({ data: withUrls, synced_at: new Date().toISOString() });
  })
);

router.get(
  '/jadwal',
  asyncHandler(async (req, res) => {
    const clauses = ["status != 'DIBATALKAN'"];
    const params = {};
    if (req.query.user_id) { clauses.push('user_id = @user_id'); params.user_id = req.query.user_id; }
    else clauses.push('user_id = @self'), (params.self = req.user.id);
    const sql = `SELECT * FROM schedule WHERE ${clauses.join(' AND ')} ORDER BY tanggal_rencana`;
    res.json({ data: db.prepare(sql).all(params), synced_at: new Date().toISOString() });
  })
);

// ------------------------------------------------------------ UPLOAD (batch)
const TABLE_BY_KIND = { deteksi: 'detection', sensus: 'sensus', treatment: 'treatment', mortalitas: 'mortality' };

function makeBatchHandler(kind, ingestFn) {
  const table = TABLE_BY_KIND[kind];
  return asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body.items) ? req.body.items : Array.isArray(req.body) ? req.body : [];
    const device_id = req.body.device_id || req.get('X-Device-Id') || null;
    if (!items.length) return res.status(400).json({ error: 'items (array) wajib diisi' });

    const logInfo = db
      .prepare(`INSERT INTO sync_log (user_id, device_id, jumlah_data, status) VALUES (?, ?, ?, 'RUNNING')`)
      .run(req.user.id, device_id, items.length);

    let success = 0;
    let failed = 0;
    const results = [];

    for (const item of items) {
      try {
        if (item.server_id) {
          const existing = db.prepare(`SELECT * FROM ${table} WHERE server_id=?`).get(item.server_id);
          if (existing) {
            logAudit({
              user_id: req.user.id,
              aktivitas: `SYNC_CONFLICT_${kind.toUpperCase()}`,
              before: existing,
              after: item,
              device_source: 'MOBILE',
              ip_session: `${req.ip} device:${device_id}`,
            });
            const versioned = ingestFn(
              { ...item, server_id: undefined, activity_id: item.activity_id || existing.activity_id, source: 'MOBILE', device_id, user_id: item.user_id || req.user.id },
              { user_id: req.user.id }
            );
            results.push({ local_id: item.local_id, server_id: versioned.row.server_id, status: 'VERSIONED_UPDATE', conflict: true, id: versioned.row.id });
            success++;
            continue;
          }
        } else if (item.local_id) {
          // BRD V3.2.1 section 16 (Duplicate Protection / idempotency): the mobile app never got a
          // server_id back for this local_id -- either it truly never uploaded, or it DID and only
          // the response was lost (timeout/dropped connection after the server had already
          // committed the insert). Retrying the same local_id must not create a second row.
          const existing = db.prepare(`SELECT * FROM ${table} WHERE local_id=? ORDER BY id DESC LIMIT 1`).get(item.local_id);
          if (existing) {
            results.push({ local_id: item.local_id, server_id: existing.server_id, status: 'SYNCED', id: existing.id, already_synced: true });
            success++;
            continue;
          }
        }
        const ingested = ingestFn({ ...item, source: 'MOBILE', device_id, user_id: item.user_id || req.user.id }, { user_id: req.user.id });
        results.push({ local_id: item.local_id, server_id: ingested.row.server_id, status: 'SYNCED', id: ingested.row.id });
        success++;
      } catch (e) {
        failed++;
        results.push({ local_id: item.local_id, status: 'FAILED', error: e.message, error_code: e.code || 'VALIDATION_ERROR' });
      }
    }

    db.prepare(`UPDATE sync_log SET finished_at=datetime('now'), success_count=?, failed_count=?, status='COMPLETED' WHERE id=?`).run(
      success,
      failed,
      logInfo.lastInsertRowid
    );

    res.json({ data: results, summary: { total: items.length, success, failed }, sync_log_id: logInfo.lastInsertRowid });
  });
}

router.post('/upload/deteksi', makeBatchHandler('deteksi', ingestDetection));
router.post('/upload/sensus', makeBatchHandler('sensus', ingestSensus));
router.post('/upload/treatment', makeBatchHandler('treatment', ingestTreatment));
router.post('/upload/mortalitas', makeBatchHandler('mortalitas', ingestMortality));

// ------------------------------------------------------------ UPLOAD (foto)
router.post(
  '/upload/foto',
  uploadPhoto.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file wajib diupload (field name: file)' });
    const { entity_type, entity_id, gps_lat, gps_lng, timestamp } = req.body;
    const file_path = path.relative(process.cwd(), req.file.path);
    const info = db
      .prepare(
        `INSERT INTO photo (entity_type, entity_id, file_path, gps_lat, gps_lng, timestamp, user_id, compressed_size)
         VALUES (@entity_type, @entity_id, @file_path, @gps_lat, @gps_lng, @timestamp, @user_id, @compressed_size)`
      )
      .run({
        entity_type: entity_type || 'UNKNOWN',
        entity_id: entity_id || null,
        file_path,
        gps_lat: gps_lat ?? null,
        gps_lng: gps_lng ?? null,
        timestamp: timestamp || new Date().toISOString(),
        user_id: req.user.id,
        compressed_size: req.file.size,
      });
    const row = db.prepare('SELECT * FROM photo WHERE id=?').get(info.lastInsertRowid);
    if (entity_id && ['DETECTION', 'SENSUS', 'TREATMENT', 'MORTALITY'].includes((entity_type || '').toUpperCase())) {
      try {
        db.prepare(`UPDATE ${entity_type.toLowerCase()} SET foto_id=? WHERE id=?`).run(row.id, entity_id);
      } catch (e) {
        /* ignore */
      }
    }
    res.status(201).json({ data: row });
  })
);

// ------------------------------------------------------------ SYNC STATUS
router.get(
  '/status',
  asyncHandler(async (req, res) => {
    const user_id = req.query.user_id || req.user.id;
    const device_id = req.query.device_id || null;
    const lastLog = device_id
      ? db.prepare(`SELECT * FROM sync_log WHERE user_id=? AND device_id=? ORDER BY started_at DESC, id DESC LIMIT 1`).get(user_id, device_id)
      : db.prepare(`SELECT * FROM sync_log WHERE user_id=? ORDER BY started_at DESC, id DESC LIMIT 1`).get(user_id);

    const pending = {};
    for (const [kind, table] of Object.entries(TABLE_BY_KIND)) {
      const row = db
        .prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE user_id=? AND sync_status IN ('DRAFT','READY_TO_SYNC','FAILED')`)
        .get(user_id);
      pending[kind] = row.c;
    }
    res.json({
      data: {
        last_sync: lastLog || null,
        pending,
        pending_total: Object.values(pending).reduce((a, b) => a + b, 0),
      },
    });
  })
);

// ------------------------------------------------------------ PUSH NOTIFICATION STUB
// v1 does not integrate FCM/APNs; this records the registration so a real push provider can be
// wired in later without changing the mobile-facing contract.
router.post(
  '/push-register',
  asyncHandler(async (req, res) => {
    const { device_id, push_token } = req.body;
    logAudit({
      user_id: req.user.id,
      aktivitas: 'PUSH_TOKEN_REGISTER',
      after: { device_id, push_token },
      device_source: 'MOBILE',
      ip_session: req.ip,
    });
    res.json({ data: { registered: true, note: 'Push provider is a stub in v1 (logged only); wire FCM/APNs here in production.' } });
  })
);

module.exports = router;
