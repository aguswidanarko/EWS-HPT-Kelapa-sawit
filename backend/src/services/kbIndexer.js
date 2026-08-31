// Knowledge Base full-text indexing + retrieval for EWS AI Assistant RAG.
//
// The Knowledge Base (routes/knowledgeBase.js, table `knowledge_base`) already lets ADMIN/RND_FOD
// upload SOP files and everyone browse/download them -- but until now the AI Assistant could only
// match a question against a document's *title* (aiAssistant.js searchKnowledge()/relatedKnowledge()),
// never its actual content. This module parses an uploaded file's real text into `kb_chunk` rows
// (indexed via the `kb_chunk_fts` FTS5 table, kept in sync by triggers -- see schema.sql "V4:
// KNOWLEDGE BASE RAG") so a question like "berapa dosis pupuk urea untuk TBM?" can be answered
// from the actual SOP text, not just its filename.
//
// GOVERNANCE (same rules aiAssistant.js documents -- this module must not weaken them):
//   - Extraction/retrieval only. Chunk text is stored and returned VERBATIM from the source file.
//     Nothing here summarizes, rewrites, or infers -- that stays downstream in llmPhraser.js, which
//     is instructed to ground itself only in exactly the chunk text this module returns.
//   - Retrieval only ever considers documents with status_aktif=1 AND publish_status='PUBLISHED'
//     (a DRAFT/ARCHIVED SOP must never leak into an AI Assistant answer).
//   - If a file's format can't be parsed, the document is marked index_status='UNSUPPORTED'/
//     'FAILED' and simply excluded from retrieval -- it stays fully usable as a plain downloadable
//     file in the Knowledge Base UI either way. Indexing failure never blocks the upload itself.

const fs = require('fs');
const path = require('path');
const { OfficeConverter } = require('officeparser');
const XLSX = require('xlsx');
const db = require('../db/db');

const OFFICEPARSER_EXT = new Set(['.pdf', '.docx', '.pptx']);
const XLSX_EXT = new Set(['.xls', '.xlsx']);
const TXT_EXT = new Set(['.txt']);

const MAX_CHUNK_SIZE = 1200;

function extOf(filePath) {
  return path.extname(filePath || '').toLowerCase();
}

// ---------------------------------------------------------------- extraction: pdf/docx/pptx
// officeparser's own "document-structure" chunker can return many small fragments (e.g. one per
// wrapped PDF line, since PDF text has no real paragraph markers). coalesce() merges adjacent
// fragments that share the same page/slide/heading, up to MAX_CHUNK_SIZE, so each stored chunk is
// a self-contained unit instead of a half-sentence.
function coalesce(chunks) {
  const out = [];
  for (const c of chunks) {
    const key = `${c.page_number ?? ''}|${c.slide_number ?? ''}|${c.sheet_name ?? ''}|${c.heading ?? ''}`;
    const last = out[out.length - 1];
    if (last && last._key === key && last.text.length + c.text.length + 1 <= MAX_CHUNK_SIZE) {
      last.text += '\n' + c.text;
    } else {
      out.push({ ...c, _key: key });
    }
  }
  return out.map(({ _key, ...rest }) => rest);
}

async function extractOfficeParserChunks(filePath) {
  const { value: rawChunks } = await OfficeConverter.convert(filePath, 'chunks', {
    generatorConfig: {
      chunksConfig: {
        strategy: 'document-structure',
        maxChunkSize: MAX_CHUNK_SIZE,
        tableSplitStrategy: 'row',
      },
    },
  });
  const mapped = rawChunks
    .map((c) => ({
      text: (c.text || '').trim(),
      page_number: c.metadata?.pageNumber ?? null,
      slide_number: c.metadata?.slideNumber ?? null,
      sheet_name: c.metadata?.sheetName ?? null,
      heading: c.metadata?.closestHeading ?? null,
    }))
    .filter((c) => c.text);
  return coalesce(mapped);
}

// ---------------------------------------------------------------- extraction: xls/xlsx
// One chunk per data row, formatted "header: value | header: value" -- officeparser's own xlsx
// chunker splits one cell per chunk, which would scatter e.g. "Urea" / "TBM" / "200 gram/pohon"
// into unrelated, ungroundable chunks. A row is the natural retrieval unit for a dosage/reference
// table, so we read it directly with the `xlsx` package (already a dependency elsewhere in this
// app) instead of relying on officeparser for this format.
function extractXlsxChunks(filePath) {
  const wb = XLSX.readFile(filePath);
  const chunks = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
    if (!rows.length) continue;
    const header = (rows[0] || []).map((h) => String(h || '').trim());
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.some((cell) => String(cell ?? '').trim())) continue; // skip fully empty rows
      const text = header
        .map((h, idx) => `${h || `Kolom ${idx + 1}`}: ${row[idx] ?? ''}`)
        .filter((part) => !/:\s*$/.test(part))
        .join(' | ');
      if (!text.trim()) continue;
      chunks.push({ text, page_number: null, slide_number: null, sheet_name: sheetName, heading: header.filter(Boolean).join(' | ') || null });
    }
  }
  return chunks;
}

// ---------------------------------------------------------------- extraction: txt
// No structural metadata available -- group paragraphs (blank-line separated) up to MAX_CHUNK_SIZE.
function extractTxtChunks(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const paragraphs = raw.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const p of paragraphs) {
    if (buf && buf.length + p.length + 2 > MAX_CHUNK_SIZE) {
      chunks.push({ text: buf, page_number: null, slide_number: null, sheet_name: null, heading: null });
      buf = p;
    } else {
      buf = buf ? `${buf}\n\n${p}` : p;
    }
  }
  if (buf) chunks.push({ text: buf, page_number: null, slide_number: null, sheet_name: null, heading: null });
  return chunks;
}

async function extractChunks(filePath) {
  const ext = extOf(filePath);
  if (OFFICEPARSER_EXT.has(ext)) return extractOfficeParserChunks(filePath);
  if (XLSX_EXT.has(ext)) return extractXlsxChunks(filePath);
  if (TXT_EXT.has(ext)) return extractTxtChunks(filePath);
  throw Object.assign(new Error(`Format file ${ext || '(tanpa ekstensi)'} belum didukung untuk pengindeksan AI Assistant`), {
    code: 'UNSUPPORTED_FORMAT',
  });
}

// ---------------------------------------------------------------- indexing
/** Parses knowledge_base row `kbId`'s file and (re)populates its kb_chunk rows. Safe to call
 *  repeatedly (e.g. on new-version upload, or a manual re-index) -- always replaces any previous
 *  chunks for that document first. Never throws: failures are recorded on the knowledge_base row
 *  itself (index_status/index_error) so an upload never fails just because indexing did. */
async function indexDocument(kbId) {
  const doc = db.prepare('SELECT * FROM knowledge_base WHERE id=?').get(kbId);
  if (!doc) return { status: 'NOT_FOUND' };
  if (!doc.file_path) {
    db.prepare(`UPDATE knowledge_base SET index_status='SKIPPED', index_error='Tidak ada file terlampir', chunk_count=0, indexed_at=datetime('now') WHERE id=?`).run(kbId);
    return { status: 'SKIPPED' };
  }
  const absPath = path.resolve(doc.file_path);
  try {
    if (!fs.existsSync(absPath)) throw Object.assign(new Error('File tidak ditemukan di server'), { code: 'FILE_MISSING' });
    const chunks = await extractChunks(absPath);
    const insertChunk = db.prepare(
      `INSERT INTO kb_chunk (knowledge_base_id, chunk_index, content, page_number, slide_number, sheet_name, heading) VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction((rows) => {
      db.prepare('DELETE FROM kb_chunk WHERE knowledge_base_id=?').run(kbId);
      rows.forEach((c, i) => insertChunk.run(kbId, i, c.text, c.page_number, c.slide_number, c.sheet_name, c.heading));
    });
    tx(chunks);
    db.prepare(`UPDATE knowledge_base SET index_status='INDEXED', index_error=NULL, chunk_count=?, indexed_at=datetime('now') WHERE id=?`).run(chunks.length, kbId);
    return { status: 'INDEXED', chunk_count: chunks.length };
  } catch (err) {
    const status = err.code === 'UNSUPPORTED_FORMAT' ? 'UNSUPPORTED' : 'FAILED';
    console.error(`[kbIndexer] failed to index knowledge_base id=${kbId}:`, err.message);
    db.prepare(`UPDATE knowledge_base SET index_status=?, index_error=?, chunk_count=0, indexed_at=datetime('now') WHERE id=?`).run(status, String(err.message).slice(0, 500), kbId);
    return { status, error: err.message };
  }
}

/** Re-indexes every document that isn't currently INDEXED -- used by the one-off admin endpoint
 *  to backfill documents uploaded before this RAG layer existed, and as a general "retry all
 *  failures" tool. Returns a per-document summary. */
async function reindexAll() {
  const rows = db.prepare(`SELECT id, judul FROM knowledge_base WHERE index_status IS NULL OR index_status != 'INDEXED'`).all();
  const results = [];
  for (const row of rows) {
    const r = await indexDocument(row.id);
    results.push({ id: row.id, judul: row.judul, ...r });
  }
  return results;
}

// ---------------------------------------------------------------- retrieval
// Common Indonesian function words -- excluded from the FTS query so a question full of ordinary
// grammar ("apa itu ... secara umum sekali") doesn't itself generate spurious keyword matches
// against an unrelated chunk that merely shares those filler words. Deliberately conservative
// (only unambiguous function words); real content words are never on this list.
const STOPWORDS = new Set([
  'yang', 'untuk', 'dari', 'dengan', 'pada', 'dan', 'atau', 'ini', 'itu', 'apa', 'apakah',
  'bagaimana', 'kalau', 'jika', 'sudah', 'belum', 'akan', 'adalah', 'ada', 'tidak', 'bukan',
  'saya', 'kita', 'kami', 'anda', 'nya', 'para', 'oleh', 'dalam', 'secara', 'sekali', 'juga',
  'saat', 'ketika', 'karena', 'sebab', 'jadi', 'maka', 'lalu', 'serta', 'per', 'ke', 'di',
  'sekitar', 'seperti', 'lebih', 'kurang', 'sangat', 'terlalu', 'harus', 'wajib', 'boleh',
  'bisa', 'dapat', 'tolong', 'mohon', 'coba', 'relevan', 'informasi',
]);

function ftsQuery(question) {
  const words = String(question || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  if (!words.length) return null;
  // prefix-match each word, OR'd together -- recall over precision at the SQL level; the
  // MIN_RANK cutoff below is what actually enforces precision, using bm25() as the real signal.
  return words.map((w) => `"${w.replace(/"/g, '""')}"*`).join(' OR ');
}

// bm25() in SQLite returns more-negative values for better matches. Calibrated empirically (see
// kbIndexer test run): a genuinely relevant chunk scored -1.9 to -3.8 against a real question,
// while an unrelated question's best (spurious, filler-word-driven) match only reached -0.96.
// -1.0 sits between the two, erring toward excluding a marginal match rather than surfacing SOP
// content that isn't actually about what was asked (a wrong-but-real quote is still misleading).
const MIN_RANK = -1.0;

/** Top-`limit` SOP chunks relevant to `question`, restricted to published/active documents.
 *  When `hpt_id` is known (the question already has an indicator in context), matching chunks
 *  from that indicator's own documents are ranked first. Returns [] on no match, no chunk clearing
 *  the relevance bar, or any FTS error (e.g. an odd question with no usable keywords) -- callers
 *  must treat all of those as the normal "nothing to add" case. */
function retrieveKbChunks(question, { hpt_id = null, limit = 5 } = {}) {
  const match = ftsQuery(question);
  if (!match) return [];
  try {
    const rows = db
      .prepare(
        `SELECT kb.id AS chunk_id, kb.content, kb.page_number, kb.slide_number, kb.sheet_name, kb.heading,
                d.id AS document_id, d.judul, d.kategori, d.versi, d.hpt_id,
                bm25(kb_chunk_fts) AS rank
         FROM kb_chunk_fts
         JOIN kb_chunk kb ON kb.id = kb_chunk_fts.rowid
         JOIN knowledge_base d ON d.id = kb.knowledge_base_id
         WHERE kb_chunk_fts MATCH ?
           AND d.status_aktif = 1
           AND (d.publish_status IS NULL OR d.publish_status = 'PUBLISHED')
         ORDER BY (CASE WHEN ? IS NOT NULL AND d.hpt_id = ? THEN 0 ELSE 1 END), rank
         LIMIT ?`
      )
      .all(match, hpt_id, hpt_id, limit);
    return rows.filter((r) => r.rank <= MIN_RANK).map(({ rank, ...rest }) => rest);
  } catch (err) {
    console.error('[kbIndexer] retrieval failed:', err.message);
    return [];
  }
}

module.exports = { indexDocument, reindexAll, retrieveKbChunks, extractChunks };
