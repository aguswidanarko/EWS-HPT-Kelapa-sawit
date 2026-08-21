// Master data CRUD: Estate, Afdeling, Blok, HPT, Species, Threshold.
// Reads: any authenticated user. Writes: ADMIN (Threshold/HPT/Species/KB also allow RND_FOD,
// since BRD 02 section 39 gives R&D/FOD ownership of threshold + knowledge base).

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

// ---------------------------------------------------------------- helpers
function crud(table, { allowedFields, writeRoles = ['ADMIN'], afterFetch = null, orderBy = 'id' }) {
  const r = express.Router();

  r.get(
    '/',
    asyncHandler(async (req, res) => {
      let sql = `SELECT * FROM ${table}`;
      const clauses = [];
      const params = {};
      for (const f of allowedFields) {
        if (req.query[f] !== undefined) {
          clauses.push(`${f} = @${f}`);
          params[f] = req.query[f];
        }
      }
      if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
      sql += ` ORDER BY ${orderBy}`;
      let rows = db.prepare(sql).all(params);
      if (afterFetch) rows = rows.map(afterFetch);
      res.json({ data: rows });
    })
  );

  r.get(
    '/:id',
    asyncHandler(async (req, res) => {
      let row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!row) return res.status(404).json({ error: `${table} not found` });
      if (afterFetch) row = afterFetch(row);
      res.json({ data: row });
    })
  );

  r.post(
    '/',
    requireRole(...writeRoles),
    asyncHandler(async (req, res) => {
      const fields = allowedFields.filter((f) => req.body[f] !== undefined);
      if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
      const cols = fields.join(', ');
      const params = fields.map((f) => '@' + f).join(', ');
      const info = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${params})`).run(req.body);
      const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(info.lastInsertRowid);
      auditFromReq(req, { aktivitas: `CREATE_${table.toUpperCase()}`, after: row });
      res.status(201).json({ data: row });
    })
  );

  r.put(
    '/:id',
    requireRole(...writeRoles),
    asyncHandler(async (req, res) => {
      const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!before) return res.status(404).json({ error: `${table} not found` });
      const fields = allowedFields.filter((f) => req.body[f] !== undefined);
      if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
      const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
      const hasUpdatedAt = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === 'updated_at');
      db.prepare(
        `UPDATE ${table} SET ${setSql}${hasUpdatedAt ? ", updated_at = datetime('now')" : ''} WHERE id = @id`
      ).run({ ...req.body, id: req.params.id });
      const after = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      auditFromReq(req, { aktivitas: `UPDATE_${table.toUpperCase()}`, before, after });
      res.json({ data: after });
    })
  );

  r.delete(
    '/:id',
    requireRole(...writeRoles),
    asyncHandler(async (req, res) => {
      const before = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(req.params.id);
      if (!before) return res.status(404).json({ error: `${table} not found` });
      db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id);
      auditFromReq(req, { aktivitas: `DELETE_${table.toUpperCase()}`, before });
      res.json({ data: { id: Number(req.params.id), deleted: true } });
    })
  );

  return r;
}

// ---------------------------------------------------------------- Estate
router.use(
  '/estates',
  crud('estate', { allowedFields: ['code', 'name', 'map_file_ref'] })
);

// ---------------------------------------------------------------- Afdeling
router.use(
  '/afdelings',
  crud('afdeling', { allowedFields: ['estate_id', 'code', 'name', 'map_file_ref'] })
);

// ---------------------------------------------------------------- Blok
router.use(
  '/bloks',
  crud('blok', {
    allowedFields: [
      'afdeling_id', 'code', 'name', 'luas', 'tahun_tanam', 'status_tanaman',
      'referensi_polygon', 'jumlah_baris', 'parameter_sampling_json',
    ],
  })
);

// GET /master/bloks/:id/sampling-plan?metode=BARIS_SAMPEL|GRID|SELURUH_POKOK
router.get(
  '/bloks/:id/sampling-plan',
  asyncHandler(async (req, res) => {
    const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(req.params.id);
    if (!blok) return res.status(404).json({ error: 'Blok not found' });
    const { buildSamplingPlan } = require('../services/sensusEngines');
    res.json({ data: buildSamplingPlan(blok, req.query.metode || 'BARIS_SAMPEL') });
  })
);

// ---------------------------------------------------------------- HPT
router.use(
  '/hpt',
  crud('hpt', {
    writeRoles: ['ADMIN', 'RND_FOD'],
    allowedFields: [
      'code', 'name', 'nama_lokal', 'kategori', 'status_aktif', 'deskripsi', 'gejala',
      'metode_deteksi', 'metode_sensus', 'satuan', 'threshold_default', 'panduan_md',
    ],
  })
);

// ---------------------------------------------------------------- Species
router.use(
  '/species',
  crud('species', { writeRoles: ['ADMIN', 'RND_FOD'], allowedFields: ['hpt_id', 'code', 'name', 'group_name'] })
);

// ---------------------------------------------------------------- Threshold
router.use(
  '/thresholds',
  crud('threshold', {
    writeRoles: ['ADMIN', 'RND_FOD'],
    orderBy: 'hpt_id, effective_date DESC',
    allowedFields: [
      'hpt_id', 'species_id', 'fase_tanaman', 'kategori', 'nilai_min', 'nilai_max',
      'satuan', 'tindakan', 'severity', 'effective_date', 'status',
    ],
  })
);

// GET /master/thresholds/active?hpt_id=&species_id=&fase_tanaman= -> resolves the same way the
// engine does, useful for mobile to cache "what threshold applies right now".
router.get(
  '/thresholds-active',
  asyncHandler(async (req, res) => {
    const { getActiveThresholds } = require('../services/thresholdEngine');
    const { hpt_id, species_id, fase_tanaman } = req.query;
    if (!hpt_id || !fase_tanaman) return res.status(400).json({ error: 'hpt_id and fase_tanaman are required' });
    const rows = getActiveThresholds(Number(hpt_id), species_id ? Number(species_id) : null, fase_tanaman, new Date().toISOString().slice(0, 10));
    res.json({ data: rows });
  })
);

module.exports = router;
