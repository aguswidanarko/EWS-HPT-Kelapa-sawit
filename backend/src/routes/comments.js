// Comment feature on all EWS Detail modules -- V3 Addendum 2, source: "Tambahan Fitur Komentar
// pada semua modul Detail EWS.pdf". Generic entity_type + entity_id so one table/API/component
// serves Alert Detail, Incident Detail, Action Plan Detail, and the Blok detail panel on Peta
// EWS. Every comment records: user, text, date+time (per the note's explicit requirement) --
// nothing here is ever edited or deleted, matching an audit-trail expectation for a "catatan
// hasil temuan" (findings note) feature.

const express = require('express');
const db = require('../db/db');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { auditFromReq } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const ENTITY_TYPES = ['ALERT', 'INCIDENT', 'ACTION_PLAN', 'BLOK'];

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { entity_type, entity_id } = req.query;
    if (!entity_type || !entity_id || !ENTITY_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `entity_type (${ENTITY_TYPES.join('/')}) dan entity_id wajib diisi` });
    }
    const rows = db
      .prepare(
        `SELECT c.*, u.name AS user_name
         FROM comment c JOIN user u ON u.id = c.user_id
         WHERE c.entity_type = ? AND c.entity_id = ?
         ORDER BY c.created_at ASC`
      )
      .all(entity_type, entity_id);
    res.json({ data: rows });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { entity_type, entity_id, comment_text } = req.body;
    if (!entity_type || !entity_id || !ENTITY_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `entity_type (${ENTITY_TYPES.join('/')}) dan entity_id wajib diisi` });
    }
    if (!comment_text || !comment_text.trim()) {
      return res.status(400).json({ error: 'comment_text wajib diisi' });
    }
    const info = db
      .prepare(`INSERT INTO comment (entity_type, entity_id, user_id, comment_text) VALUES (?, ?, ?, ?)`)
      .run(entity_type, entity_id, req.user.id, comment_text.trim());
    const row = db
      .prepare(`SELECT c.*, u.name AS user_name FROM comment c JOIN user u ON u.id = c.user_id WHERE c.id=?`)
      .get(info.lastInsertRowid);
    auditFromReq(req, { aktivitas: 'CREATE_COMMENT', after: row });
    res.status(201).json({ data: row });
  })
);

module.exports = router;
