// Rule & Parameter Management backing (SPEC_V2.md section 4 Backend: "routes/formulas.js").
// CRUD for `formula` (generic rule engine definitions) and `sampling_rule`. Threshold CRUD already
// exists at /api/master/thresholds (V1, untouched); scheduling_rule CRUD lives in
// routes/schedulingRules.js. A preview endpoint lets the admin UI test a formula against sample
// input before saving, without writing any data.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');
const { evaluateFormula } = require('../services/ruleEngine');

const router = express.Router();
router.use(requireAuth);

const WRITE_ROLES = ['ADMIN', 'RND_FOD'];

// ---------------------------------------------------------------- formula
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['hpt_id', 'formula_type', 'context', 'active']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM formula';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY hpt_id, id';
    res.json({ data: db.prepare(sql).all(params) });
  })
);

// NOTE: `:id` is constrained to digits on this top-level router (unlike the `sampling_rule` sub-
// router below) so that GET/PUT/DELETE /api/formulas/sampling-rules... falls through to the
// `router.use('/sampling-rules', samplingRouter)` mount instead of being captured here first by
// Express's in-order route matching (a plain `/:id` would treat "sampling-rules" itself as an id
// and always 404, since route registration order puts these formula routes before that mount).
router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const row = db.prepare('SELECT * FROM formula WHERE id=?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ data: row });
  })
);

router.post(
  '/',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const { hpt_id, formula_type, context, expression_json, unit, description, active } = req.body;
    if (!hpt_id || !formula_type || !expression_json) {
      return res.status(400).json({ error: 'hpt_id, formula_type, expression_json wajib diisi' });
    }
    const exprStr = typeof expression_json === 'string' ? expression_json : JSON.stringify(expression_json);
    JSON.parse(exprStr); // validate it's real JSON before saving
    const info = db
      .prepare(
        `INSERT INTO formula (hpt_id, formula_type, context, expression_json, unit, description, active)
         VALUES (@hpt_id, @formula_type, @context, @expression_json, @unit, @description, @active)`
      )
      .run({
        hpt_id,
        formula_type,
        context: context || 'SENSUS',
        expression_json: exprStr,
        unit: unit || null,
        description: description || null,
        active: active === undefined ? 1 : active,
      });
    const row = db.prepare('SELECT * FROM formula WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_FORMULA', after: row });
    res.status(201).json({ data: row });
  })
);

router.put(
  '/:id(\\d+)',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM formula WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['hpt_id', 'formula_type', 'context', 'expression_json', 'unit', 'description', 'active'].filter(
      (f) => req.body[f] !== undefined
    );
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const payload = { ...req.body, id: req.params.id };
    if (payload.expression_json !== undefined && typeof payload.expression_json !== 'string') {
      payload.expression_json = JSON.stringify(payload.expression_json);
    }
    if (payload.expression_json !== undefined) JSON.parse(payload.expression_json); // validate
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE formula SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run(payload);
    const after = db.prepare('SELECT * FROM formula WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_FORMULA', before, after });
    res.json({ data: after });
  })
);

router.delete(
  '/:id(\\d+)',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM formula WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM formula WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_FORMULA', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);

// POST /api/formulas/:id/preview { payload: {...} } -> dry-run evaluate, no DB writes.
router.post(
  '/:id(\\d+)/preview',
  asyncHandler(async (req, res) => {
    const formulaRow = db.prepare('SELECT * FROM formula WHERE id=?').get(req.params.id);
    if (!formulaRow) return res.status(404).json({ error: 'Not found' });
    try {
      const result = evaluateFormula(formulaRow, req.body.payload || {});
      res.json({ data: result });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  })
);

// ---------------------------------------------------------------- sampling_rule
const samplingRouter = express.Router();
samplingRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['hpt_id', 'active']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM sampling_rule';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY hpt_id, id';
    res.json({ data: db.prepare(sql).all(params) });
  })
);
samplingRouter.post(
  '/',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const fields = ['hpt_id', 'method', 'row_start', 'row_interval', 'plant_start', 'plant_interval', 'minimum_sample', 'unit_scope', 'description', 'active'].filter(
      (f) => req.body[f] !== undefined
    );
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const cols = fields.join(', ');
    const params = fields.map((f) => '@' + f).join(', ');
    const info = db.prepare(`INSERT INTO sampling_rule (${cols}) VALUES (${params})`).run(req.body);
    const row = db.prepare('SELECT * FROM sampling_rule WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_SAMPLING_RULE', after: row });
    res.status(201).json({ data: row });
  })
);
samplingRouter.put(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM sampling_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['hpt_id', 'method', 'row_start', 'row_interval', 'plant_start', 'plant_interval', 'minimum_sample', 'unit_scope', 'description', 'active'].filter(
      (f) => req.body[f] !== undefined
    );
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE sampling_rule SET ${setSql}, updated_at = datetime('now') WHERE id = @id`).run({ ...req.body, id: req.params.id });
    const after = db.prepare('SELECT * FROM sampling_rule WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_SAMPLING_RULE', before, after });
    res.json({ data: after });
  })
);
samplingRouter.delete(
  '/:id',
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM sampling_rule WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM sampling_rule WHERE id=?').run(req.params.id);
    auditFromReq(req, { aktivitas: 'DELETE_SAMPLING_RULE', before });
    res.json({ data: { id: Number(req.params.id), deleted: true } });
  })
);
router.use('/sampling-rules', samplingRouter);

module.exports = router;
