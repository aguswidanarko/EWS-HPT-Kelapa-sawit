// Peta EWS / GIS (SPEC.md section 7): blok list with severity color-coding, GeoJSON upload for
// Estate/Afdeling boundaries with preview/validate/publish/versioning (source file kept separate
// from the published layer file actually served to the map).

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { uploadGeoJSON, MAPS_DIR } = require('../middleware/upload');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const SEVERITY_COLOR = { NORMAL: 'hijau', RINGAN: 'kuning', SEDANG: 'oranye', BERAT: 'merah', CRITICAL: 'merah' };

// GET /api/gis/bloks -> every blok with its current worst open severity + color for map layer
router.get(
  '/bloks',
  asyncHandler(async (req, res) => {
    const bloks = db
      .prepare(
        `SELECT b.*, af.name AS afdeling_name, af.estate_id, e.name AS estate_name
         FROM blok b JOIN afdeling af ON af.id=b.afdeling_id JOIN estate e ON e.id=af.estate_id`
      )
      .all();
    const rank = { NORMAL: 1, RINGAN: 2, SEDANG: 3, BERAT: 4, CRITICAL: 5 };
    const openIncidents = db.prepare(`SELECT blok_id, severity FROM incident WHERE status != 'CLOSED'`).all();
    const severityByBlok = new Map();
    for (const inc of openIncidents) {
      const current = severityByBlok.get(inc.blok_id);
      if (!current || (rank[inc.severity] || 0) > (rank[current] || 0)) severityByBlok.set(inc.blok_id, inc.severity);
    }
    const data = bloks.map((b) => {
      const severity = severityByBlok.get(b.id) || 'NORMAL';
      return { ...b, severity, color: SEVERITY_COLOR[severity] || 'hijau' };
    });
    res.json({ data });
  })
);

router.get(
  '/bloks/:id',
  asyncHandler(async (req, res) => {
    const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(req.params.id);
    if (!blok) return res.status(404).json({ error: 'Not found' });
    const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(blok.afdeling_id);
    const openIncidents = db.prepare(`SELECT * FROM incident WHERE blok_id=? AND status != 'CLOSED'`).all(blok.id);
    const dominantHpt = db
      .prepare(
        `SELECT h.name, COUNT(*) c FROM detection d JOIN hpt h ON h.id=d.hpt_id WHERE d.blok_id=? GROUP BY h.id ORDER BY c DESC LIMIT 1`
      )
      .get(blok.id);
    const pics = db.prepare('SELECT p.*, u.name AS user_name FROM pic p JOIN user u ON u.id=p.user_id WHERE p.blok_id=?').all(blok.id);
    const recentDetections = db.prepare('SELECT * FROM detection WHERE blok_id=? ORDER BY created_at DESC LIMIT 10').all(blok.id);
    const recentSensus = db.prepare('SELECT * FROM sensus WHERE blok_id=? ORDER BY created_at DESC LIMIT 10').all(blok.id);
    const recentTreatment = db.prepare('SELECT * FROM treatment WHERE blok_id=? ORDER BY created_at DESC LIMIT 10').all(blok.id);
    res.json({
      data: {
        ...blok,
        afdeling,
        open_incidents: openIncidents,
        hpt_dominan: dominantHpt ? dominantHpt.name : null,
        pics,
        recent_detections: recentDetections,
        recent_sensus: recentSensus,
        recent_treatment: recentTreatment,
      },
    });
  })
);

// GET /api/gis/heatmap?from=&to=&hpt_id=&severity=&estate_id=&afdeling_id=&blok_id=
router.get(
  '/heatmap',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.from) { clauses.push('tanggal >= @from'); params.from = req.query.from; }
    if (req.query.to) { clauses.push('tanggal <= @to'); params.to = req.query.to; }
    if (req.query.hpt_id) { clauses.push('hpt_id = @hpt_id'); params.hpt_id = req.query.hpt_id; }
    if (req.query.estate_id) { clauses.push('estate_id = @estate_id'); params.estate_id = req.query.estate_id; }
    if (req.query.afdeling_id) { clauses.push('afdeling_id = @afdeling_id'); params.afdeling_id = req.query.afdeling_id; }
    if (req.query.blok_id) { clauses.push('blok_id = @blok_id'); params.blok_id = req.query.blok_id; }
    if (req.query.severity) { clauses.push('kategori = @severity'); params.severity = req.query.severity; }
    let sql = `SELECT gps_lat AS lat, gps_lng AS lng, kategori, hpt_id, blok_id, tanggal FROM detection WHERE gps_lat IS NOT NULL AND gps_lng IS NOT NULL`;
    if (clauses.length) sql += ' AND ' + clauses.join(' AND ');
    sql += ' LIMIT 5000';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

// ---------------------------------------------------------- GeoJSON layer upload/publish
router.get(
  '/layers',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    if (req.query.entity_type) { clauses.push('entity_type=@entity_type'); params.entity_type = req.query.entity_type; }
    if (req.query.entity_id) { clauses.push('entity_id=@entity_id'); params.entity_id = req.query.entity_id; }
    let sql = 'SELECT * FROM geojson_layer';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY entity_type, entity_id, version DESC';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

function validateGeoJSON(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { valid: false, errors: [`JSON tidak valid: ${e.message}`], feature_count: 0 };
  }
  const errors = [];
  let feature_count = 0;
  const validTypes = ['FeatureCollection', 'Feature', 'Polygon', 'MultiPolygon'];
  if (!json.type || !validTypes.includes(json.type)) {
    errors.push(`type GeoJSON tidak dikenal/didukung: ${json.type}`);
  }
  if (json.type === 'FeatureCollection') {
    if (!Array.isArray(json.features)) errors.push('FeatureCollection.features harus array');
    else {
      feature_count = json.features.length;
      json.features.forEach((f, i) => {
        if (!f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type)) {
          errors.push(`feature[${i}] harus geometry Polygon/MultiPolygon`);
        }
      });
    }
  } else if (json.type === 'Feature') {
    feature_count = 1;
    if (!json.geometry || !['Polygon', 'MultiPolygon'].includes(json.geometry.type)) errors.push('geometry harus Polygon/MultiPolygon');
  } else if (['Polygon', 'MultiPolygon'].includes(json.type)) {
    feature_count = 1;
  }
  return { valid: errors.length === 0, errors, feature_count };
}

// Upload = creates a new version in status UPLOADED, source file kept as-is.
router.post(
  '/layers/upload',
  requireRole('ADMIN', 'RND_FOD'),
  uploadGeoJSON.single('file'),
  asyncHandler(async (req, res) => {
    const { entity_type, entity_id } = req.body;
    if (!req.file) return res.status(400).json({ error: 'file (GeoJSON) wajib diupload' });
    if (!entity_type || !entity_id || !['ESTATE', 'AFDELING'].includes(entity_type)) {
      return res.status(400).json({ error: 'entity_type (ESTATE/AFDELING) dan entity_id wajib diisi' });
    }
    const validation = validateGeoJSON(req.file.path);
    const lastVersion = db
      .prepare('SELECT MAX(version) v FROM geojson_layer WHERE entity_type=? AND entity_id=?')
      .get(entity_type, entity_id);
    const version = (lastVersion.v || 0) + 1;
    const source_file_path = path.relative(process.cwd(), req.file.path);
    const info = db
      .prepare(
        `INSERT INTO geojson_layer (entity_type, entity_id, version, source_file_path, status, feature_count, validation_errors, uploaded_by)
         VALUES (@entity_type, @entity_id, @version, @source_file_path, @status, @feature_count, @validation_errors, @uploaded_by)`
      )
      .run({
        entity_type,
        entity_id,
        version,
        source_file_path,
        status: validation.valid ? 'VALIDATED' : 'UPLOADED',
        feature_count: validation.feature_count,
        validation_errors: validation.errors.length ? JSON.stringify(validation.errors) : null,
        uploaded_by: req.user.id,
      });
    const row = db.prepare('SELECT * FROM geojson_layer WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'UPLOAD_GEOJSON_LAYER', after: row });
    res.status(201).json({ data: row, validation });
  })
);

router.get(
  '/layers/:id/preview',
  asyncHandler(async (req, res) => {
    const layer = db.prepare('SELECT * FROM geojson_layer WHERE id=?').get(req.params.id);
    if (!layer) return res.status(404).json({ error: 'Not found' });
    const filePath = layer.layer_file_path || layer.source_file_path;
    const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
    res.json({ data: { layer, geojson: JSON.parse(raw) } });
  })
);

// Publish: copies the validated source file into the "layer used by app" location and flips
// any previous published version for this entity to ARCHIVED (kept separate from source files).
router.post(
  '/layers/:id/publish',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const layer = db.prepare('SELECT * FROM geojson_layer WHERE id=?').get(req.params.id);
    if (!layer) return res.status(404).json({ error: 'Not found' });
    if (layer.validation_errors) return res.status(400).json({ error: 'Layer punya validation error, tidak bisa dipublish', errors: JSON.parse(layer.validation_errors) });

    const publishedName = `published-${layer.entity_type}-${layer.entity_id}-v${layer.version}.geojson`;
    const layer_file_path = path.relative(process.cwd(), path.join(MAPS_DIR, publishedName));
    fs.copyFileSync(path.resolve(layer.source_file_path), path.resolve(layer_file_path));

    db.prepare(`UPDATE geojson_layer SET status='ARCHIVED' WHERE entity_type=? AND entity_id=? AND status='PUBLISHED'`).run(
      layer.entity_type,
      layer.entity_id
    );
    db.prepare(`UPDATE geojson_layer SET status='PUBLISHED', layer_file_path=?, published_at=datetime('now') WHERE id=?`).run(
      layer_file_path,
      layer.id
    );
    // Keep ESTATE/AFDELING.map_file_ref pointed at the currently published layer for convenience.
    const table = layer.entity_type === 'ESTATE' ? 'estate' : 'afdeling';
    db.prepare(`UPDATE ${table} SET map_file_ref=? WHERE id=?`).run(layer_file_path, layer.entity_id);

    const after = db.prepare('SELECT * FROM geojson_layer WHERE id=?').get(layer.id);
    auditFromReq(req, { aktivitas: 'PUBLISH_GEOJSON_LAYER', before: layer, after });
    res.json({ data: after });
  })
);

module.exports = router;
