// The Threshold & Incident Engine (SPEC.md section 4). This is the single place in the codebase
// that turns a field measurement into a classification + incident + alert + notifications.
//
// Pipeline (as specified):
//   DATA MASUK -> VALIDASI -> IDENTIFIKASI HPT -> IDENTIFIKASI FASE TANAMAN -> AMBIL THRESHOLD
//     -> HITUNG (done by caller/sensusEngines before calling this) -> KLASIFIKASI
//     -> BUAT/UPDATE INCIDENT -> jika kategori melewati threshold: BUAT ALERT -> NOTIFIKASI
//
// Threshold values are NEVER hard-coded here: every classification decision is a query against
// the THRESHOLD table, filtered by (hpt_id, species_id/group, fase_tanaman, effective_date,
// status='AKTIF').

const db = require('../db/db');
const { generateIncidentCode } = require('./incidentCode');
const { provider, buildAlertMessage } = require('./notificationProvider');

const SEVERITY_ORDER = ['NORMAL', 'RINGAN', 'SEDANG', 'BERAT', 'CRITICAL'];
const NOTIFY_KATEGORI = ['SEDANG', 'BERAT', 'CRITICAL']; // per BRD 02 section 20 notification engine rule

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function severityRank(k) {
  const i = SEVERITY_ORDER.indexOf(k);
  return i === -1 ? -1 : i;
}

/** Step: AMBIL THRESHOLD. Returns the latest-effective threshold row per kategori.
 *  `context` (optional, V3.1) disambiguates the rare hpt_id that carries more than one formula
 *  over different quantities (see threshold.context's schema.sql comment) -- a row with
 *  context IS NULL always applies (legacy default, matches every pre-V3.1 threshold row), a row
 *  with a context set only applies when it matches the caller's context. */
function getActiveThresholds(hpt_id, species_id, faseTanaman, asOfDate, context) {
  const rows = db
    .prepare(
      `SELECT t.* FROM threshold t
       LEFT JOIN species s ON s.id = @species_id
       WHERE t.hpt_id = @hpt_id
         AND t.status = 'AKTIF'
         AND t.effective_date <= @asOfDate
         AND (t.fase_tanaman = @faseTanaman OR t.fase_tanaman = 'SEMUA')
         AND (t.context IS NULL OR t.context = @context)
         AND (
           t.species_id IS NULL
           OR t.species_id = @species_id
           OR (s.group_name IS NOT NULL AND t.species_id IN (
                 SELECT id FROM species WHERE group_name = s.group_name))
         )
       ORDER BY (t.fase_tanaman = @faseTanaman) DESC, t.effective_date DESC`
    )
    .all({ hpt_id, species_id: species_id || null, faseTanaman, asOfDate, context: context || null });

  const latestByKategori = new Map();
  for (const r of rows) {
    if (!latestByKategori.has(r.kategori)) latestByKategori.set(r.kategori, r);
  }
  return Array.from(latestByKategori.values());
}

/** Step: KLASIFIKASI. Finds which threshold bucket nilai_hasil falls into. */
function classify(thresholdRows, value) {
  const matches = thresholdRows.filter((r) => {
    const min = r.nilai_min === null || r.nilai_min === undefined ? -Infinity : r.nilai_min;
    const max = r.nilai_max === null || r.nilai_max === undefined ? Infinity : r.nilai_max;
    return value >= min && value <= max;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => severityRank(b.kategori) - severityRank(a.kategori));
  return matches[0];
}

/** Step: BUAT/UPDATE INCIDENT. Reuses an open incident for the same HPT+blok, else opens one. */
function findOrCreateIncident({ hpt_id, estate_id, afdeling_id, blok_id, severity, sourceType, sourceId }) {
  const open = db
    .prepare(
      `SELECT * FROM incident WHERE hpt_id=? AND blok_id=? AND status != 'CLOSED' ORDER BY opened_at DESC LIMIT 1`
    )
    .get(hpt_id, blok_id);

  const idField = { DETECTION: 'detection_id', SENSUS: 'sensus_id', MORTALITY: 'mortality_id' }[sourceType];

  if (open) {
    const shouldBump = severityRank(severity) > severityRank(open.severity);
    const setClauses = ['updated_at = datetime(\'now\')'];
    const params = { id: open.id };
    if (shouldBump) {
      setClauses.push('severity = @severity');
      params.severity = severity;
    }
    if (idField && sourceId) {
      setClauses.push(`${idField} = @sourceId`);
      params.sourceId = sourceId;
    }
    db.prepare(`UPDATE incident SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    return db.prepare('SELECT * FROM incident WHERE id=?').get(open.id);
  }

  const incident_code = generateIncidentCode(db);
  const info = db
    .prepare(
      `INSERT INTO incident (incident_code, hpt_id, estate_id, afdeling_id, blok_id, ${idField || 'detection_id'}, status, severity, opened_at)
       VALUES (@incident_code, @hpt_id, @estate_id, @afdeling_id, @blok_id, @sourceId, 'NEW', @severity, datetime('now'))`
    )
    .run({ incident_code, hpt_id, estate_id, afdeling_id, blok_id, sourceId: sourceId || null, severity });
  return db.prepare('SELECT * FROM incident WHERE id=?').get(info.lastInsertRowid);
}

/** Step: BUAT ALERT. One alert row per exceeding event (Alert Center shows each as a card). */
function createAlert({ incident, hpt_id, estate_id, afdeling_id, blok_id, hasil, matched, sourceType, sourceId }) {
  const thresholdRef = matched
    ? `${matched.kategori}: ${matched.nilai_min ?? '-∞'}..${matched.nilai_max ?? '+∞'} ${matched.satuan || ''}`.trim()
    : null;
  const info = db
    .prepare(
      `INSERT INTO alert (incident_id, hpt_id, estate_id, afdeling_id, blok_id, hasil, threshold_ref, kategori, status, source_type, source_id)
       VALUES (@incident_id, @hpt_id, @estate_id, @afdeling_id, @blok_id, @hasil, @threshold_ref, @kategori, 'NEW', @sourceType, @sourceId)`
    )
    .run({
      incident_id: incident.id,
      hpt_id,
      estate_id,
      afdeling_id,
      blok_id,
      hasil,
      threshold_ref: thresholdRef,
      kategori: matched ? matched.kategori : 'RINGAN',
      sourceType,
      sourceId: sourceId || null,
    });
  return db.prepare('SELECT * FROM alert WHERE id=?').get(info.lastInsertRowid);
}

/** Step: NOTIFIKASI. Dashboard notification always logged; Email/WhatsApp only for SEDANG+. */
function dispatchNotifications({ incident, alert, hpt_id, blok }) {
  const hpt = db.prepare('SELECT * FROM hpt WHERE id=?').get(hpt_id);
  const blokLabel = blok ? `Blok ${blok.code}` : '';
  const { subject, message } = buildAlertMessage({ incident, alert, hptName: hpt ? hpt.name : null, blokLabel });

  const results = [];

  // Always create a DASHBOARD notification so it shows up in the Alert Center / Notification log.
  results.push(persistAndSend({ alert_id: alert.id, channel: 'DASHBOARD', recipient: 'dashboard', subject, message }));

  if (NOTIFY_KATEGORI.includes(alert.kategori)) {
    const recipients = resolveRecipients(alert);
    for (const r of recipients) {
      results.push(persistAndSend({ alert_id: alert.id, channel: r.channel, recipient: r.recipient, subject, message }));
    }
  }
  return results;
}

function persistAndSend({ alert_id, channel, recipient, subject, message }) {
  const info = db
    .prepare(
      `INSERT INTO notification (alert_id, channel, recipient, status) VALUES (?, ?, ?, 'PENDING')`
    )
    .run(alert_id, channel, recipient);
  const notifId = info.lastInsertRowid;
  // Fire-and-forget-but-synchronous-enough: MockLogProvider resolves immediately.
  provider
    .send({ channel, recipient, subject, message })
    .then((res) => {
      db.prepare(
        `UPDATE notification SET status=?, sent_at=datetime('now'), response_provider=?, error=? WHERE id=?`
      ).run(res.status, res.response_provider, res.error, notifId);
    })
    .catch((err) => {
      db.prepare(`UPDATE notification SET status='FAILED', error=? WHERE id=?`).run(String(err.message || err), notifId);
    });
  return db.prepare('SELECT * FROM notification WHERE id=?').get(notifId);
}

/** Resolve who should be notified for an alert: notification_rule x PIC. */
function resolveRecipients(alert) {
  const rules = db
    .prepare(
      `SELECT * FROM notification_rule WHERE active=1 AND (trigger_type = 'THRESHOLD_EXCEEDED' OR trigger_type = ?)`
    )
    .all(`KATEGORI_${alert.kategori}`);

  const recipients = [];
  for (const rule of rules) {
    if (rule.recipient_user_id) {
      const u = db.prepare('SELECT * FROM user WHERE id=?').get(rule.recipient_user_id);
      if (u) recipients.push({ channel: rule.channel, recipient: rule.channel === 'WHATSAPP' ? u.phone || u.email : u.email });
    }
    if (rule.recipient_role) {
      const users = db
        .prepare(
          `SELECT u.* FROM user u JOIN role ro ON ro.id=u.role_id
           WHERE ro.code=? AND (u.estate_id IS NULL OR u.estate_id=?) AND u.is_active=1`
        )
        .all(rule.recipient_role, alert.estate_id);
      for (const u of users) recipients.push({ channel: rule.channel, recipient: rule.channel === 'WHATSAPP' ? u.phone || u.email : u.email });
    }
    if (rule.recipient_pic) {
      const pics = db
        .prepare(
          `SELECT DISTINCT u.* FROM pic p JOIN user u ON u.id=p.user_id
           WHERE (p.blok_id=? OR p.afdeling_id=? OR p.estate_id=?)
             AND (p.hpt_id IS NULL OR p.hpt_id=?)`
        )
        .all(alert.blok_id, alert.afdeling_id, alert.estate_id, alert.hpt_id);
      for (const u of pics) recipients.push({ channel: rule.channel, recipient: rule.channel === 'WHATSAPP' ? u.phone || u.email : u.email });
    }
  }
  return recipients;
}

/**
 * Main entry point used by detection/sensus/mortality routes after they've computed a numeric
 * (or ordinal, for qualitative HPT like Ganoderma) result.
 *
 * @param {object} p
 * @param {number} p.hpt_id
 * @param {number|null} p.species_id
 * @param {number} p.blok_id
 * @param {number} p.nilai_hasil
 * @param {'DETECTION'|'SENSUS'|'MORTALITY'|'ASSESSMENT'} p.sourceType
 * @param {number} [p.sourceId]
 * @param {boolean} [p.forced_kandidat_pengendalian] Rayap-style ambang-ekonomi-0% override
 * @param {string} [p.context] V3.1: disambiguates threshold rows when hpt_id has >1 formula
 *   over different quantities (see getActiveThresholds() above)
 */
function runThresholdEngine({ hpt_id, species_id = null, blok_id, nilai_hasil, sourceType, sourceId, forced_kandidat_pengendalian = false, context = null }) {
  // VALIDASI
  const blok = db.prepare('SELECT * FROM blok WHERE id=?').get(blok_id);
  if (!blok) throw new Error('Blok tidak ditemukan');
  const hpt = db.prepare('SELECT * FROM hpt WHERE id=?').get(hpt_id);
  if (!hpt) throw new Error('HPT tidak ditemukan');
  const afdeling = db.prepare('SELECT * FROM afdeling WHERE id=?').get(blok.afdeling_id);
  const estate_id = afdeling ? afdeling.estate_id : null;

  // IDENTIFIKASI FASE TANAMAN
  const faseTanaman = blok.status_tanaman || 'SEMUA';

  // AMBIL THRESHOLD
  const thresholds = getActiveThresholds(hpt_id, species_id, faseTanaman, todayISO(), context);

  // KLASIFIKASI
  let matched = classify(thresholds, nilai_hasil);
  if (!matched && forced_kandidat_pengendalian) {
    matched = thresholds.filter((t) => t.kategori !== 'NORMAL').sort((a, b) => severityRank(a.kategori) - severityRank(b.kategori))[0] || null;
  }
  const kategori = matched ? matched.kategori : 'NORMAL';

  let incident = null;
  let alert = null;
  let notifications = [];

  // BUAT/UPDATE INCIDENT + BUAT ALERT + NOTIFIKASI (only when threshold exceeded, i.e. non-NORMAL)
  if (kategori !== 'NORMAL') {
    incident = findOrCreateIncident({
      hpt_id,
      estate_id,
      afdeling_id: blok.afdeling_id,
      blok_id,
      severity: kategori,
      sourceType,
      sourceId,
    });
    alert = createAlert({
      incident,
      hpt_id,
      estate_id,
      afdeling_id: blok.afdeling_id,
      blok_id,
      hasil: nilai_hasil,
      matched,
      sourceType,
      sourceId,
    });
    notifications = dispatchNotifications({ incident, alert, hpt_id, blok });
  }

  return {
    kategori,
    severity: kategori,
    ews_alert: kategori !== 'NORMAL',
    thresholdRow: matched,
    thresholdsConsidered: thresholds,
    faseTanaman,
    estate_id,
    incident,
    alert,
    notifications,
  };
}

module.exports = {
  runThresholdEngine,
  getActiveThresholds,
  classify,
  SEVERITY_ORDER,
  severityRank,
  todayISO,
};
