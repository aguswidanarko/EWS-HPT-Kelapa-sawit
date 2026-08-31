// EWS AI Assistant routes (BRD Addendum "PalmMind AI Agronomy Assistant" -- renamed EWS AI
// Assistant, no PalmMind branding anywhere in this app). Thin HTTP layer over
// services/aiAssistant.js -- see that file's header for the rule-based engine rationale and the
// 5 AI Governance Rules this module follows.
//
// Open to every authenticated role (this is a copilot for field staff too, not an admin-only
// tool) -- matches the addendum's own framing ("User dapat bertanya secara natural"). History
// defaults to the caller's own interactions; ?all=true additionally requires an oversight role,
// mirroring routes/auditLog.js's role gate.

const express = require('express');
const db = require('../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { answerQuestion, submitFeedback } = require('../services/aiAssistant');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question, blok_id, ews_id, incident_id } = req.body;
    const result = await answerQuestion({ question, blok_id: blok_id || null, ews_id: ews_id || null, incident_id: incident_id || null, user_id: req.user.id });
    res.status(201).json({ data: result });
  })
);

router.post(
  '/:id/feedback',
  asyncHandler(async (req, res) => {
    const { feedback, reason, note } = req.body;
    const row = submitFeedback({ id: req.params.id, user_id: req.user.id, feedback, reason, note });
    res.json({ data: row });
  })
);

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const wantsAll = req.query.all === 'true';
    if (wantsAll) {
      // same oversight roles as routes/auditLog.js -- requireRole also always allows ADMIN/SUPER_ADMIN
      return requireRole('RND_FOD', 'MANAGER')(req, res, () => {
        const clauses = [];
        const params = {};
        if (req.query.blok_id) { clauses.push('blok_id=@blok_id'); params.blok_id = req.query.blok_id; }
        if (req.query.ews_id) { clauses.push('ews_id=@ews_id'); params.ews_id = req.query.ews_id; }
        let sql = 'SELECT * FROM ai_interaction';
        if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
        sql += ' ORDER BY created_at DESC LIMIT 200';
        res.json({ data: db.prepare(sql).all(params) });
      });
    }
    res.json({ data: db.prepare('SELECT * FROM ai_interaction WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(req.user.id) });
  })
);

module.exports = router;
