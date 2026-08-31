// EWS AI Assistant (BRD Addendum "PalmMind AI Agronomy Assistant", renamed EWS AI Assistant per
// user instruction -- no PalmMind branding surfaces anywhere in this app).
//
// The addendum's own architecture doc specifies OpenAI GPT-5.5 + Supabase pgvector for real
// RAG/generation. Neither literal stack is used here, but the same two ideas now exist in a form
// that fits this self-hosted deployment: this engine is still a deterministic, RULE-BASED answer
// composer that reads the same real EWS data every other module reads (hpt, ews_dictionary,
// threshold, rule_version, incident/alert, action_plan, sensus/detection/agro_observation,
// knowledge_base) and assembles a structured answer from it -- that part never changed and never
// calls an external model. Two additive layers sit on top of it, both optional and both falling
// back to this rule-based answer untouched on any failure:
//   - RAG over uploaded SOP documents: services/kbIndexer.js parses Knowledge Base uploads (PDF/
//     DOC(X)/PPT(X)/XLS(X)/TXT) into `kb_chunk` rows, searchable via SQLite FTS5 -- retrieveKbChunks()
//     below returns real, verbatim document excerpts (with citations) instead of only ever
//     matching a document's title, as this module used to.
//   - LLM phrasing: services/llmPhraser.js optionally sends the already-composed rule-based
//     answer (SOP excerpts included) to the Claude API purely to rephrase it more naturally --
//     never to add facts. Disabled by default; falls back to the rule-based text as-is if
//     disabled, unreachable, or erroring.
// This still satisfies the addendum's 5 AI Governance Rules (section 33):
//   Rule 1: EWS Rule Engine is authority for threshold/status -> every number here is read from
//           the DB, never computed/guessed by this module.
//   Rule 2: never invent technical data -> if a piece of context is missing, the answer says so
//           explicitly instead of filling a plausible-looking gap.
//   Rule 3: enterprise answers must carry a citation -> every answer returns a `citations` list
//           naming exactly which rows it used.
//   Rule 4: an AI recommendation is not automatically an action -> this module only reads/
//           explains; it never writes to incident/alert/action_plan/threshold/rule tables.
//   Rule 5: every AI interaction must be auditable -> every call is persisted to ai_interaction
//           (schema.sql "V3 ADDENDUM: EWS AI ASSISTANT") before it returns.
//
// `engine` on each row is 'RULE_BASED_V1' so a real LLM can be added later (e.g. 'LLM:claude-...')
// without a schema change -- see schema.sql comment.

const db = require('../db/db');
const { getEwsEntry } = require('./ewsRegistry');
const { phraseAnswer } = require('./llmPhraser');
const { retrieveKbChunks } = require('./kbIndexer');

const ENGINE_VERSION = 'RULE_BASED_V1';

// ---------------------------------------------------------------- intent detection
// Keyword-based, Indonesian-first (matches the addendum's own example prompts). Not ML -- a
// simple, auditable, deterministic classifier that only decides which real-data lookup to run.
function detectIntent(question) {
  const q = (question || '').toLowerCase();
  if (/\b(kenapa|mengapa|penyebab|sebab)\b/.test(q) && /\b(warning|alert|masalah|bermasalah)\b|blok/.test(q)) return 'EXPLAIN_WARNING';
  if (/\bkenapa\b|\bmengapa\b/.test(q)) return 'EXPLAIN_WARNING';
  if (/\bsop\b|prosedur|langkah|cara (menangani|mengendalikan)/.test(q)) return 'SOP_LOOKUP';
  if (/riwayat|history|tren|trend|membaik|memburuk|perkembangan/.test(q)) return 'HISTORY';
  if (/tindakan|action plan|belum selesai|pic\b|due date/.test(q)) return 'ACTION_PLAN_STATUS';
  if (/\b(terbesar|terparah|tertinggi|terbanyak|paling (parah|besar|tinggi|banyak)|peringkat|ranking|urutan)\b/.test(q) && /\bblok\b/.test(q)) return 'RANKING';
  return 'GENERAL_KNOWLEDGE';
}

// ---------------------------------------------------------------- context builder
function resolveBlok(blok_id) {
  if (!blok_id) return null;
  return db.prepare('SELECT * FROM blok WHERE id=?').get(blok_id);
}

function resolveEwsDictionary(ews_id) {
  if (!ews_id) return null;
  return db
    .prepare(`SELECT d.*, h.code AS hpt_code, h.name AS hpt_name FROM ews_dictionary d JOIN hpt h ON h.id=d.hpt_id WHERE d.ews_id=?`)
    .get(ews_id);
}

/** Latest 2 observations for a given hpt/table combination + blok, newest first. Table/column
 *  shape differs per indicator family (see ewsRegistry.js) so this switches on entry.table rather
 *  than assuming one schema. */
function recentObservations(entry, blok_id, ews_id) {
  if (!entry || !blok_id) return [];
  if (entry.table === 'sensus') {
    return db.prepare(`SELECT tanggal, hasil_hitung, kategori, ews_alert, created_at FROM sensus WHERE jenis_sensus=? AND blok_id=? ORDER BY tanggal DESC, created_at DESC LIMIT 2`).all(entry.hpt_code, blok_id);
  }
  if (entry.table === 'agro_observation') {
    return db.prepare(`SELECT tanggal, nilai_ukur, kategori, ews_alert, created_at FROM agro_observation WHERE ews_id=? AND blok_id=? ORDER BY tanggal DESC, created_at DESC LIMIT 2`).all(ews_id, blok_id);
  }
  if (['yield_partenocarpi', 'water_management', 'bahan_organik', 'tbm_vegetatif'].includes(entry.table)) {
    return db.prepare(`SELECT tanggal, kategori, ews_alert, created_at FROM ${entry.table} WHERE blok_id=? ORDER BY tanggal DESC, created_at DESC LIMIT 2`).all(blok_id);
  }
  if (entry.table === 'defisiensi_hara_temuan') {
    return db.prepare(`SELECT tanggal, severity, status, created_at FROM defisiensi_hara_temuan WHERE blok_id=? ORDER BY tanggal DESC, created_at DESC LIMIT 2`).all(blok_id);
  }
  return [];
}

function latestIncident({ incident_id, hpt_id, blok_id }) {
  if (incident_id) return db.prepare('SELECT * FROM incident WHERE id=?').get(incident_id);
  if (hpt_id && blok_id) {
    return db.prepare('SELECT * FROM incident WHERE hpt_id=? AND blok_id=? ORDER BY opened_at DESC LIMIT 1').get(hpt_id, blok_id);
  }
  return null;
}

function activeThresholds(hpt_id) {
  if (!hpt_id) return [];
  return db.prepare(`SELECT kategori, nilai_min, nilai_max, satuan, tindakan, severity FROM threshold WHERE hpt_id=? AND status='AKTIF' ORDER BY nilai_min`).all(hpt_id);
}

function relatedKnowledge(hpt_id, limit = 5) {
  if (!hpt_id) return [];
  return db.prepare(`SELECT id, judul, kategori, versi, file_path FROM knowledge_base WHERE hpt_id=? AND status_aktif=1 ORDER BY updated_at DESC LIMIT ?`).all(hpt_id, limit);
}

function searchKnowledge(question, limit = 5) {
  const words = (question || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 4);
  if (!words.length) return [];
  const clauses = words.map(() => `LOWER(judul) LIKE ?`).join(' OR ');
  const params = words.map((w) => `%${w}%`);
  return db.prepare(`SELECT id, judul, kategori, versi, file_path FROM knowledge_base WHERE status_aktif=1 AND (${clauses}) LIMIT ?`).all(...params, limit);
}

/** Human-readable pointer into a source document for a retrieved chunk, e.g. "hal. 3" /
 *  "slide 2" / "sheet Dosis Pupuk" -- used both in the answer text and as the citation label, so
 *  a user (or an auditor reading ai_interaction later) can find the exact spot a claim came from. */
function chunkLocator(c) {
  if (c.page_number) return `hal. ${c.page_number}`;
  if (c.slide_number) return `slide ${c.slide_number}`;
  if (c.sheet_name) return `sheet ${c.sheet_name}`;
  return null;
}

function chunkCitationLabel(c) {
  const locator = chunkLocator(c);
  return `${c.judul}${c.versi ? ` (v${c.versi})` : ''}${locator ? ` -- ${locator}` : ''}`;
}

function openActionPlans(incident_id) {
  if (!incident_id) return [];
  return db
    .prepare(`SELECT id, problem, recommendation, actual_action, due_date, status, pic_user_id FROM action_plan WHERE incident_id=? ORDER BY created_at DESC LIMIT 10`)
    .all(incident_id);
}

function latestRuleVersionForHpt(hpt_id, context) {
  if (!hpt_id) return null;
  const formula = db.prepare(`SELECT id FROM formula WHERE hpt_id=? AND context=? AND active=1 LIMIT 1`).get(hpt_id, context || 'SENSUS');
  if (!formula) return null;
  return db.prepare(`SELECT * FROM rule_version WHERE entity_type='FORMULA' AND entity_id=? ORDER BY version_no DESC LIMIT 1`).get(formula.id);
}

/**
 * Builds the "EWS Context" object the addendum's section 6 requires (Estate/Afdeling/Block/
 * Planting Stage/EWS_ID/Indicator/Observation/Calculated Result/Threshold/Status/Previous
 * Observation/Previous Warning/Action Plan/Action Status/Relevant SOP/Relevant Knowledge) --
 * every field here is a real DB read, nothing synthesized.
 */
function buildEwsContext({ blok_id, ews_id, incident_id, question } = {}) {
  let incident = incident_id ? db.prepare('SELECT * FROM incident WHERE id=?').get(incident_id) : null;
  if (incident && !blok_id) blok_id = incident.blok_id;

  const blok = resolveBlok(blok_id);
  const afdeling = blok ? db.prepare('SELECT * FROM afdeling WHERE id=?').get(blok.afdeling_id) : null;
  const estate = afdeling ? db.prepare('SELECT * FROM estate WHERE id=?').get(afdeling.estate_id) : null;

  let dict = resolveEwsDictionary(ews_id);
  let hpt = dict ? db.prepare('SELECT * FROM hpt WHERE id=?').get(dict.hpt_id) : null;

  if (!hpt && incident) hpt = db.prepare('SELECT * FROM hpt WHERE id=?').get(incident.hpt_id);
  if (!dict && hpt) {
    // no explicit ews_id given -- best-effort match by hpt_id, preferring one whose
    // planting_stage matches this blok's status_tanaman (judgment call: EWS_ID is 1:many with
    // hpt when planting stages split it, e.g. HPT-001/002/003 all = TIKUS).
    const candidates = db.prepare(`SELECT d.*, h.code AS hpt_code, h.name AS hpt_name FROM ews_dictionary d JOIN hpt h ON h.id=d.hpt_id WHERE d.hpt_id=? AND d.status='ACTIVE'`).all(hpt.id);
    dict = candidates.find((c) => blok && c.planting_stage && c.planting_stage.includes(blok.status_tanaman)) || candidates[0] || null;
  }

  if (!incident && hpt && blok) incident = latestIncident({ hpt_id: hpt.id, blok_id: blok.id });
  const alert = incident ? db.prepare('SELECT * FROM alert WHERE incident_id=? ORDER BY created_at DESC LIMIT 1').get(incident.id) : null;

  const entry = dict ? getEwsEntry(dict.ews_id) : null;
  const observations = entry ? recentObservations(entry, blok_id, dict.ews_id) : [];

  return {
    estate: estate ? { id: estate.id, name: estate.name || estate.code } : null,
    afdeling: afdeling ? { id: afdeling.id, name: afdeling.name || afdeling.code } : null,
    blok: blok ? { id: blok.id, code: blok.code, planting_stage: blok.status_tanaman, tahun_tanam: blok.tahun_tanam, luas: blok.luas } : null,
    ews_id: dict ? dict.ews_id : null,
    indicator: hpt ? { code: hpt.code, name: hpt.name, kategori: hpt.kategori, deskripsi: hpt.deskripsi, gejala: hpt.gejala, metode_deteksi: hpt.metode_deteksi, panduan_md: hpt.panduan_md } : null,
    threshold_display_text: dict ? dict.threshold_display_text : null,
    recommendation: dict ? dict.recommendation : null,
    inspection_interval: dict ? dict.inspection_interval : null,
    active_thresholds: hpt ? activeThresholds(hpt.id) : [],
    observation: observations[0] || null,
    previous_observation: observations[1] || null,
    incident: incident ? { id: incident.id, incident_code: incident.incident_code, status: incident.status, severity: incident.severity, opened_at: incident.opened_at } : null,
    alert: alert ? { id: alert.id, hasil: alert.hasil, threshold_ref: alert.threshold_ref, kategori: alert.kategori, status: alert.status } : null,
    action_plans: incident ? openActionPlans(incident.id) : [],
    relevant_sop: hpt ? relatedKnowledge(hpt.id) : [],
    // Real SOP document *content* relevant to the question (RAG retrieval, kbIndexer.js) -- as
    // opposed to relevant_sop above, which only ever matches on document title/hpt_id. hpt_id here
    // (when known) boosts documents belonging to the same indicator to the top of the ranking.
    kb_chunks: retrieveKbChunks(question, { hpt_id: hpt ? hpt.id : null }),
    rule_version: hpt ? latestRuleVersionForHpt(hpt.id, entry ? entry.classifyContext || 'SENSUS' : 'SENSUS') : null,
  };
}

// ---------------------------------------------------------------- answer composers (per intent)
/** Observation value formatted for display -- rounds floats to 2 decimals (sensusEngines.js
 *  produces raw division results like 7.000000000000001) without altering the underlying stored
 *  number, so the answer text reads cleanly while context_json still keeps the exact value. */
function obsValue(o) {
  if (!o) return '-';
  const raw = o.hasil_hitung ?? o.nilai_ukur ?? o.severity ?? o.kategori;
  const n = Number(raw);
  return Number.isFinite(n) && raw !== null && raw !== '' ? (Math.round(n * 100) / 100).toString() : raw;
}

function composeExplainWarning(ctx) {
  const lines = [];
  const citations = [];
  if (!ctx.blok) {
    return { answer: 'Blok tidak ditemukan atau belum dipilih. Pilih Blok (dan EWS_ID bila perlu) terlebih dahulu agar EWS AI Assistant bisa membaca konteks yang tepat.', citations };
  }
  if (!ctx.incident) {
    lines.push(`Blok ${ctx.blok.code} tidak memiliki incident EWS yang aktif/tercatat untuk indikator ini. Informasi belum tersedia -- tidak ada warning yang bisa dijelaskan.`);
    return { answer: lines.join('\n\n'), citations };
  }
  lines.push(`Blok ${ctx.blok.code}${ctx.afdeling ? ` (Afdeling ${ctx.afdeling.name})` : ''} terindikasi *${ctx.incident.severity}* pada indikator **${ctx.indicator ? ctx.indicator.name : '-'}** (Incident ${ctx.incident.incident_code}, status ${ctx.incident.status}).`);
  citations.push({ type: 'INCIDENT', ref: ctx.incident.incident_code, label: `Incident ${ctx.incident.incident_code}` });

  if (ctx.observation) {
    lines.push(`Hasil observasi terakhir (${ctx.observation.tanggal}): ${obsValue(ctx.observation)}${ctx.observation.kategori ? ` -> kategori ${ctx.observation.kategori}` : ''}.`);
  }
  if (ctx.threshold_display_text) {
    lines.push(`Ambang batas EWS untuk ${ctx.ews_id || 'indikator ini'}: ${ctx.threshold_display_text}.`);
    citations.push({ type: 'EWS_DICTIONARY', ref: ctx.ews_id, label: `Master EWS Dictionary ${ctx.ews_id}` });
  } else if (ctx.active_thresholds && ctx.active_thresholds.length) {
    lines.push(`Ambang batas aktif: ${ctx.active_thresholds.map((t) => `${t.kategori} (${t.nilai_min ?? '-'}..${t.nilai_max ?? '+∞'} ${t.satuan || ''})`).join('; ')}.`);
    citations.push({ type: 'THRESHOLD', ref: `hpt:${ctx.indicator ? ctx.indicator.code : ''}`, label: 'Master Data > Threshold' });
  }
  lines.push('Angka observasi dan status di atas berasal dari EWS Rule Engine (bukan diperkirakan oleh AI Assistant).');

  if (ctx.recommendation || (ctx.indicator && ctx.indicator.deskripsi)) {
    lines.push(`Rekomendasi: ${ctx.recommendation || 'Rujuk SOP terkait indikator ini.'}`);
  }
  if (ctx.relevant_sop && ctx.relevant_sop.length) {
    lines.push(`SOP terkait: ${ctx.relevant_sop.map((k) => k.judul).join('; ')}.`);
    ctx.relevant_sop.forEach((k) => citations.push({ type: 'KNOWLEDGE_BASE', ref: k.id, label: k.judul }));
  }
  if (ctx.kb_chunks && ctx.kb_chunks.length) {
    const c = ctx.kb_chunks[0]; // single most relevant excerpt -- keeps this composer's answer concise
    const locator = chunkLocator(c);
    lines.push(`Kutipan SOP -- ${c.judul}${locator ? ` (${locator})` : ''}: "${c.content.slice(0, 400)}${c.content.length > 400 ? '...' : ''}"`);
    citations.push({ type: 'KNOWLEDGE_BASE_CHUNK', ref: c.chunk_id, label: chunkCitationLabel(c) });
  }
  return { answer: lines.join('\n\n'), citations };
}

function composeSopLookup(ctx, question) {
  const citations = [];
  // Real document content first (RAG retrieval) -- falls back to title-only matches (relevant_sop
  // by hpt_id, then a plain title search) only when nothing in the indexed content matches, e.g.
  // because the matching document hasn't been indexed yet (unsupported format, still PENDING).
  if (ctx.kb_chunks && ctx.kb_chunks.length) {
    const lines = [`Berdasarkan dokumen SOP di Knowledge Base:`];
    ctx.kb_chunks.forEach((c) => {
      const locator = chunkLocator(c);
      lines.push('', `**${c.judul}${locator ? ` (${locator})` : ''}**`, c.content);
      citations.push({ type: 'KNOWLEDGE_BASE_CHUNK', ref: c.chunk_id, label: chunkCitationLabel(c) });
    });
    return { answer: lines.join('\n'), citations };
  }
  const kb = ctx.relevant_sop && ctx.relevant_sop.length ? ctx.relevant_sop : searchKnowledge(question);
  if (!kb.length) {
    return { answer: 'Informasi belum tersedia -- belum ada dokumen SOP di Knowledge Base yang cocok dengan konteks/pertanyaan ini.', citations };
  }
  const lines = [`SOP/dokumen yang relevan:`, ...kb.map((k) => `- ${k.judul}${k.versi ? ` (v${k.versi})` : ''} [${k.kategori || 'Umum'}]`)];
  if (ctx.indicator && ctx.indicator.panduan_md) {
    lines.push('', `Panduan singkat untuk ${ctx.indicator.name}:`, ctx.indicator.panduan_md.slice(0, 800));
  }
  kb.forEach((k) => citations.push({ type: 'KNOWLEDGE_BASE', ref: k.id, label: k.judul }));
  return { answer: lines.join('\n'), citations };
}

function composeHistory(ctx) {
  const citations = [];
  if (!ctx.observation) {
    return { answer: 'Informasi belum tersedia -- belum ada riwayat observasi untuk konteks (Blok/EWS_ID) ini.', citations };
  }
  const lines = [`Riwayat observasi terakhir untuk ${ctx.ews_id || (ctx.indicator ? ctx.indicator.name : 'indikator ini')} di Blok ${ctx.blok ? ctx.blok.code : '-'}:`];
  lines.push(`- Terkini (${ctx.observation.tanggal}): ${obsValue(ctx.observation)}${ctx.observation.kategori ? ` (${ctx.observation.kategori})` : ''}`);
  if (ctx.previous_observation) {
    lines.push(`- Sebelumnya (${ctx.previous_observation.tanggal}): ${obsValue(ctx.previous_observation)}${ctx.previous_observation.kategori ? ` (${ctx.previous_observation.kategori})` : ''}`);
    const cur = Number(ctx.observation.hasil_hitung ?? ctx.observation.nilai_ukur);
    const prev = Number(ctx.previous_observation.hasil_hitung ?? ctx.previous_observation.nilai_ukur);
    if (!Number.isNaN(cur) && !Number.isNaN(prev)) {
      lines.push(cur < prev ? 'Tren: membaik (angka menurun).' : cur > prev ? 'Tren: memburuk (angka meningkat).' : 'Tren: stabil.');
    }
  } else {
    lines.push('Belum ada observasi sebelumnya untuk dibandingkan.');
  }
  lines.push('Data historis ini dibaca langsung dari tabel observasi EWS, bukan dihitung ulang oleh AI Assistant.');
  citations.push({ type: 'OBSERVATION_HISTORY', ref: `${ctx.ews_id || ''}/${ctx.blok ? ctx.blok.code : ''}`, label: 'Riwayat observasi EWS' });
  return { answer: lines.join('\n'), citations };
}

function composeActionPlanStatus(ctx) {
  const citations = [];
  if (!ctx.incident) {
    return { answer: 'Informasi belum tersedia -- tidak ada incident aktif pada konteks ini sehingga tidak ada Action Plan untuk dilaporkan.', citations };
  }
  citations.push({ type: 'INCIDENT', ref: ctx.incident.incident_code, label: `Incident ${ctx.incident.incident_code}` });
  if (!ctx.action_plans || !ctx.action_plans.length) {
    return { answer: `Belum ada Action Plan tercatat untuk Incident ${ctx.incident.incident_code}.`, citations };
  }
  const lines = [`Action Plan untuk Incident ${ctx.incident.incident_code}:`];
  ctx.action_plans.forEach((ap) => {
    lines.push(`- [${ap.status}] ${ap.recommendation || ap.problem || '(tanpa deskripsi)'}${ap.due_date ? ` -- due ${ap.due_date}` : ''}`);
    citations.push({ type: 'ACTION_PLAN', ref: ap.id, label: `Action Plan #${ap.id}` });
  });
  return { answer: lines.join('\n'), citations };
}

/** Best-effort match of a question's text against hpt.name/code (e.g. "tikus" -> the TIKUS hpt
 *  row) -- used by composeRanking, which (unlike every other composer above) has no blok_id/
 *  ews_id given and must figure out which indicator the question is even about. Simple substring
 *  match, same philosophy as searchKnowledge()'s keyword approach: not ML, fully auditable. */
function resolveHptFromQuestion(question) {
  const q = (question || '').toLowerCase();
  const allHpt = db.prepare('SELECT id, code, name FROM hpt WHERE status_aktif=1').all();
  return allHpt.find((h) => q.includes(h.name.toLowerCase()) || q.includes(h.code.toLowerCase())) || null;
}

/** "Blok mana yang paling parah untuk X?" -- an aggregate/ranking question across ALL bloks, which
 *  every other composer above cannot answer (they only ever read the ONE blok_id/ews_id given in
 *  context). Reads each blok's latest sensus/agro_observation row for the matched indicator and
 *  ranks by the observed value -- still a real DB read, still fully auditable, just shaped
 *  differently (many rows compared, not one). Table types this doesn't yet cover (yield_making's
 *  4 tables, defisiensi_hara_temuan) say so honestly instead of guessing. */
function composeRanking(ctx, question) {
  const citations = [];
  const hpt = resolveHptFromQuestion(question);
  if (!hpt) {
    return {
      answer: 'Informasi belum tersedia -- EWS AI Assistant belum bisa mengenali indikator/HPT mana yang dimaksud dari pertanyaan ini. Coba sebutkan nama indikatornya secara eksplisit (mis. "tikus", "ulat api", "ganoderma").',
      citations,
    };
  }

  const ewsRows = db.prepare(`SELECT ews_id FROM ews_dictionary WHERE hpt_id=? AND status='ACTIVE'`).all(hpt.id);
  const entries = ewsRows.map((r) => ({ ews_id: r.ews_id, entry: getEwsEntry(r.ews_id) })).filter((e) => e.entry);
  const table = entries.length ? entries[0].entry.table : null;

  let rows = [];
  if (table === 'sensus') {
    rows = db
      .prepare(
        `SELECT b.code AS blok_code, s.tanggal, s.hasil_hitung, s.kategori, s.ews_alert
         FROM sensus s
         JOIN blok b ON b.id = s.blok_id
         WHERE s.jenis_sensus = ?
           AND s.id = (SELECT s2.id FROM sensus s2 WHERE s2.blok_id = s.blok_id AND s2.jenis_sensus = s.jenis_sensus ORDER BY s2.tanggal DESC, s2.created_at DESC LIMIT 1)
         ORDER BY s.hasil_hitung DESC
         LIMIT 5`
      )
      .all(hpt.code);
  } else if (table === 'agro_observation') {
    const ids = entries.map((e) => e.ews_id);
    rows = db
      .prepare(
        `SELECT b.code AS blok_code, o.tanggal, o.nilai_ukur AS hasil_hitung, o.kategori, o.ews_alert
         FROM agro_observation o
         JOIN blok b ON b.id = o.blok_id
         WHERE o.ews_id IN (${ids.map(() => '?').join(',')})
           AND o.id = (SELECT o2.id FROM agro_observation o2 WHERE o2.blok_id=o.blok_id AND o2.ews_id=o.ews_id ORDER BY o2.tanggal DESC, o2.created_at DESC LIMIT 1)
         ORDER BY o.nilai_ukur DESC
         LIMIT 5`
      )
      .all(...ids);
  } else {
    return {
      answer: `Informasi belum tersedia -- perbandingan antar-blok untuk indikator ${hpt.name} belum didukung EWS AI Assistant saat ini (baru mendukung indikator berbasis sensus dan observasi Agro). Silakan cek langsung di halaman Sensus/Deteksi untuk indikator ini.`,
      citations,
    };
  }

  if (!rows.length) {
    return { answer: `Belum ada data sensus/observasi untuk indikator ${hpt.name} di blok manapun.`, citations };
  }

  const lines = [`Blok dengan hasil sensus/observasi tertinggi untuk indikator **${hpt.name}** (5 teratas, dari data terbaru tiap blok):`];
  rows.forEach((r, i) => {
    lines.push(`${i + 1}. Blok ${r.blok_code}: ${obsValue(r)}${r.kategori ? ` (${r.kategori})` : ''}${r.ews_alert ? ' -- ALERT' : ''} -- data ${r.tanggal}`);
  });
  lines.push('Angka di atas dibaca langsung dari data sensus/observasi EWS terbaru per blok (bukan diperkirakan oleh AI Assistant); blok tanpa data belum tercatat pada daftar ini.');
  citations.push({ type: 'SENSUS_RANKING', ref: hpt.code, label: `Data Sensus/Observasi ${hpt.name} (semua blok)` });
  return { answer: lines.join('\n'), citations };
}

function composeGeneralKnowledge(ctx, question) {
  const citations = [];
  const lines = [];
  if (ctx.indicator && (ctx.indicator.deskripsi || ctx.indicator.gejala)) {
    if (ctx.indicator.deskripsi) lines.push(`**${ctx.indicator.name}** -- ${ctx.indicator.deskripsi}`);
    if (ctx.indicator.gejala) lines.push(`Gejala: ${ctx.indicator.gejala}`);
    citations.push({ type: 'MASTER_HPT', ref: ctx.indicator.code, label: `Master Data > Indikator ${ctx.indicator.name}` });
  }
  if (ctx.kb_chunks && ctx.kb_chunks.length) {
    // Real SOP content (RAG retrieval) -- this is what lets a question like "berapa dosis pupuk
    // urea untuk TBM?" be answered from the actual uploaded SOP text, not just its title.
    if (lines.length) lines.push('');
    lines.push('Dari dokumen Knowledge Base:');
    ctx.kb_chunks.forEach((c) => {
      const locator = chunkLocator(c);
      lines.push('', `**${c.judul}${locator ? ` (${locator})` : ''}**`, c.content);
      citations.push({ type: 'KNOWLEDGE_BASE_CHUNK', ref: c.chunk_id, label: chunkCitationLabel(c) });
    });
  } else {
    const kb = searchKnowledge(question);
    if (kb.length) {
      if (lines.length) lines.push('');
      lines.push('Dokumen terkait:', ...kb.map((k) => `- ${k.judul}`));
      kb.forEach((k) => citations.push({ type: 'KNOWLEDGE_BASE', ref: k.id, label: k.judul }));
    }
  }
  if (!lines.length) {
    return { answer: 'Informasi belum tersedia di data EWS atau Knowledge Base untuk pertanyaan ini. Coba pilih Blok/EWS_ID agar EWS AI Assistant punya konteks lebih spesifik, atau hubungi Riset/R&D.', citations };
  }
  return { answer: lines.join('\n'), citations };
}

// ---------------------------------------------------------------- public API
// async because the optional LLM phrasing layer (llmPhraser.js) makes a network call; the
// deterministic rule-based composition above stays 100% synchronous DB reads either way. If the
// LLM layer is disabled/unreachable, phraseAnswer() resolves to null and this falls straight
// back to the rule-based `composed.answer` -- identical behavior to before this layer existed.
async function answerQuestion({ question, blok_id, ews_id, incident_id, user_id }) {
  if (!question || !String(question).trim()) {
    throw Object.assign(new Error('question wajib diisi'), { status: 400 });
  }
  const intent = detectIntent(question);
  const ctx = buildEwsContext({ blok_id, ews_id, incident_id, question });

  let composed;
  if (intent === 'EXPLAIN_WARNING') composed = composeExplainWarning(ctx);
  else if (intent === 'SOP_LOOKUP') composed = composeSopLookup(ctx, question);
  else if (intent === 'HISTORY') composed = composeHistory(ctx);
  else if (intent === 'ACTION_PLAN_STATUS') composed = composeActionPlanStatus(ctx);
  else if (intent === 'RANKING') composed = composeRanking(ctx, question);
  else composed = composeGeneralKnowledge(ctx, question);

  // Citations always come from the deterministic layer above and are never touched by the LLM
  // phrasing step (Governance Rule 3). The rule-based answer is preserved verbatim in
  // context_json._rule_based_answer for audit even when the LLM's phrasing is what gets shown.
  let finalAnswer = composed.answer;
  let engine = ENGINE_VERSION;
  const llmResult = await phraseAnswer({ question, ruleBasedAnswer: composed.answer, context: ctx });
  if (llmResult) {
    finalAnswer = llmResult.text;
    engine = `LLM:${llmResult.model}`;
  }
  const contextForAudit = { ...ctx, _rule_based_answer: composed.answer };

  const info = db
    .prepare(
      `INSERT INTO ai_interaction (user_id, question, blok_id, ews_id, incident_id, intent, context_json, citations_json, answer, rule_version_id, engine)
       VALUES (@user_id, @question, @blok_id, @ews_id, @incident_id, @intent, @context_json, @citations_json, @answer, @rule_version_id, @engine)`
    )
    .run({
      user_id: user_id || null,
      question: String(question).trim(),
      blok_id: blok_id || null,
      ews_id: ews_id || null,
      incident_id: incident_id || null,
      intent,
      context_json: JSON.stringify(contextForAudit),
      citations_json: JSON.stringify(composed.citations),
      answer: finalAnswer,
      rule_version_id: ctx.rule_version ? ctx.rule_version.id : null,
      engine,
    });

  const row = db.prepare('SELECT * FROM ai_interaction WHERE id=?').get(info.lastInsertRowid);
  return {
    interaction_id: row.id,
    intent,
    answer: finalAnswer,
    citations: composed.citations,
    context_used: contextForAudit,
    engine,
    created_at: row.created_at,
  };
}

function submitFeedback({ id, user_id, feedback, reason, note }) {
  const row = db.prepare('SELECT * FROM ai_interaction WHERE id=?').get(id);
  if (!row) throw Object.assign(new Error('Interaksi tidak ditemukan'), { status: 404 });
  if (!['HELPFUL', 'NOT_HELPFUL'].includes(feedback)) {
    throw Object.assign(new Error('feedback harus HELPFUL atau NOT_HELPFUL'), { status: 400 });
  }
  db.prepare(`UPDATE ai_interaction SET feedback=@feedback, feedback_reason=@reason, feedback_note=@note WHERE id=@id`).run({
    id,
    feedback,
    reason: reason || null,
    note: note || null,
  });
  return db.prepare('SELECT * FROM ai_interaction WHERE id=?').get(id);
}

module.exports = { answerQuestion, submitFeedback, buildEwsContext, detectIntent };
