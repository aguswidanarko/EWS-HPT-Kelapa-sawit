// Scoring / KPI module (SPEC_V2.md section 2 + section 6 acceptance criteria: "Scoring module:
// struktur data siap, UI menampilkan 'kriteria belum final - placeholder' secara eksplisit").
//
// THIS IS DELIBERATELY A SKELETON. The real 5 R&D + 5 Tim Operasional criteria (+ bonus) are not
// available in SPEC_V2.md, the FR, or any BRD provided to this task -- do not invent them. Every
// response from this route carries an explicit `placeholder: true` / `disclaimer` marker so no
// consumer (dashboard, mobile, another agent) can mistake the seeded rows for a final rubric.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const PLACEHOLDER_DISCLAIMER =
  'Kriteria scoring di bawah ini adalah PLACEHOLDER/TBD -- rincian resmi 5 kriteria R&D dan 5 kriteria Tim ' +
  'Operasional belum tersedia di dokumen manapun (SPEC_V2.md section 1). Jangan dipakai sebagai rubrik final.';

router.get(
  '/criteria',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['side', 'active']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM scoring_criteria';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY side, id';
    res.json({ data: db.prepare(sql).all(params), placeholder: true, disclaimer: PLACEHOLDER_DISCLAIMER });
  })
);

router.post(
  '/criteria',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const { side, code, name, max_poin, description, active } = req.body;
    if (!side || !code || !name || max_poin === undefined) {
      return res.status(400).json({ error: 'side, code, name, max_poin wajib diisi' });
    }
    const info = db
      .prepare(`INSERT INTO scoring_criteria (side, code, name, max_poin, description, active) VALUES (@side, @code, @name, @max_poin, @description, @active)`)
      .run({ side, code, name, max_poin, description: description || null, active: active === undefined ? 1 : active });
    const row = db.prepare('SELECT * FROM scoring_criteria WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_SCORING_CRITERIA', after: row });
    res.status(201).json({ data: row, placeholder: true, disclaimer: PLACEHOLDER_DISCLAIMER });
  })
);

router.put(
  '/criteria/:id',
  requireRole('ADMIN', 'RND_FOD'),
  asyncHandler(async (req, res) => {
    const before = db.prepare('SELECT * FROM scoring_criteria WHERE id=?').get(req.params.id);
    if (!before) return res.status(404).json({ error: 'Not found' });
    const fields = ['side', 'code', 'name', 'max_poin', 'description', 'active'].filter((f) => req.body[f] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No valid fields provided' });
    const setSql = fields.map((f) => `${f} = @${f}`).join(', ');
    db.prepare(`UPDATE scoring_criteria SET ${setSql} WHERE id = @id`).run({ ...req.body, id: req.params.id });
    const after = db.prepare('SELECT * FROM scoring_criteria WHERE id=?').get(req.params.id);
    auditFromReq(req, { aktivitas: 'UPDATE_SCORING_CRITERIA', before, after });
    res.json({ data: after, placeholder: true, disclaimer: PLACEHOLDER_DISCLAIMER });
  })
);

router.get(
  '/entries',
  asyncHandler(async (req, res) => {
    const clauses = [];
    const params = {};
    for (const f of ['hpt_id', 'estate_id', 'afdeling_id', 'period_month', 'criteria_id']) {
      if (req.query[f] !== undefined) {
        clauses.push(`${f} = @${f}`);
        params[f] = req.query[f];
      }
    }
    let sql = 'SELECT * FROM scoring_entry';
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY period_month DESC, created_at DESC LIMIT 500';
    res.json({ data: db.prepare(sql).all(params), placeholder: true, disclaimer: PLACEHOLDER_DISCLAIMER });
  })
);

router.post(
  '/entries',
  requireRole('ADMIN', 'RND_FOD', 'ASKEP_ASISTEN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { hpt_id, estate_id, afdeling_id, period_month, criteria_id, poin_diberikan, catatan } = req.body;
    if (!period_month || !criteria_id || poin_diberikan === undefined) {
      return res.status(400).json({ error: 'period_month, criteria_id, poin_diberikan wajib diisi' });
    }
    const criteria = db.prepare('SELECT * FROM scoring_criteria WHERE id=?').get(criteria_id);
    if (!criteria) return res.status(400).json({ error: 'criteria_id tidak ditemukan' });
    if (Number(poin_diberikan) > Number(criteria.max_poin)) {
      return res.status(400).json({ error: `poin_diberikan (${poin_diberikan}) melebihi max_poin kriteria (${criteria.max_poin})` });
    }
    const info = db
      .prepare(
        `INSERT INTO scoring_entry (hpt_id, estate_id, afdeling_id, period_month, criteria_id, poin_diberikan, catatan, created_by_user_id)
         VALUES (@hpt_id, @estate_id, @afdeling_id, @period_month, @criteria_id, @poin_diberikan, @catatan, @created_by_user_id)`
      )
      .run({
        hpt_id: hpt_id || null,
        estate_id: estate_id || null,
        afdeling_id: afdeling_id || null,
        period_month,
        criteria_id,
        poin_diberikan,
        catatan: catatan || null,
        created_by_user_id: req.user.id,
      });
    const row = db.prepare('SELECT * FROM scoring_entry WHERE id=?').get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_SCORING_ENTRY', after: row });
    res.status(201).json({ data: row, placeholder: true, disclaimer: PLACEHOLDER_DISCLAIMER });
  })
);

// GET /api/scoring/summary?period_month=YYYY-MM&estate_id= -> read-model rekap (SPEC_V2.md
// section 2: "Rekap total/level dihitung read-model ... bukan disimpan redundant").
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { period_month, estate_id, afdeling_id } = req.query;
    if (!period_month) return res.status(400).json({ error: 'period_month wajib diisi (format YYYY-MM)' });
    const clauses = ['se.period_month = @period_month'];
    const params = { period_month };
    if (estate_id !== undefined) { clauses.push('se.estate_id = @estate_id'); params.estate_id = estate_id; }
    if (afdeling_id !== undefined) { clauses.push('se.afdeling_id = @afdeling_id'); params.afdeling_id = afdeling_id; }

    const bySide = db
      .prepare(
        `SELECT sc.side AS side, SUM(se.poin_diberikan) AS total_poin, COUNT(*) AS entry_count
         FROM scoring_entry se JOIN scoring_criteria sc ON sc.id = se.criteria_id
         WHERE ${clauses.join(' AND ')}
         GROUP BY sc.side`
      )
      .all(params);

    const maxPossible = db.prepare('SELECT side, SUM(max_poin) AS max_total FROM scoring_criteria WHERE active=1 GROUP BY side').all();
    const maxBySide = Object.fromEntries(maxPossible.map((r) => [r.side, r.max_total]));

    const total_poin = bySide.reduce((acc, r) => acc + (r.total_poin || 0), 0);
    // Level badge 1-4 is a simple /110 scale placeholder per SPEC_V2.md section 4 Dashboard
    // ("rekap /110 + badge Level 1-4"); the 110 denominator itself (5 RND + 5 TIM_OPERASIONAL +
    // BONUS max 10, per the target shape in SPEC_V2.md section 2) is provisional until real
    // criteria/max_poin values are confirmed.
    const denom = 110;
    let level = 1;
    const pct = (total_poin / denom) * 100;
    if (pct >= 90) level = 4;
    else if (pct >= 75) level = 3;
    else if (pct >= 50) level = 2;

    res.json({
      data: {
        period_month,
        estate_id: estate_id ? Number(estate_id) : null,
        afdeling_id: afdeling_id ? Number(afdeling_id) : null,
        by_side: bySide,
        max_by_side: maxBySide,
        total_poin,
        denom,
        level,
      },
      placeholder: true,
      disclaimer: PLACEHOLDER_DISCLAIMER,
    });
  })
);

module.exports = router;
