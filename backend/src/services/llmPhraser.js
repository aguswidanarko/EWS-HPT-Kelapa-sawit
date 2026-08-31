// Optional LLM phrasing layer for EWS AI Assistant -- sits ON TOP of the deterministic
// rule-based engine in services/aiAssistant.js, never replaces it.
//
// Disabled by default. Enable via env (see systemd unit / deployment guide):
//   AI_ASSISTANT_LLM_ENABLED=true
//   ANTHROPIC_API_KEY=sk-ant-...
//   AI_ASSISTANT_LLM_MODEL=claude-haiku-4-5-20251001   (optional -- this is already the default)
//
// GOVERNANCE (this module must never weaken the 5 AI Governance Rules aiAssistant.js documents):
//   - This module NEVER decides facts, numbers, or status. It receives the already-composed
//     rule-based answer + the exact EWS context object (all real DB reads) and is instructed to
//     only rephrase/narrate those facts in natural language.
//   - If the call fails, times out, is disabled, or the API key is missing, the caller falls
//     back to the original deterministic answer text untouched -- this layer is a pure narration
//     enhancement, never a dependency for correctness or availability of EWS AI Assistant.
//   - citations returned to the client always come from the rule-based layer, never from here.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 15000;

function isEnabled() {
  return process.env.AI_ASSISTANT_LLM_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
}

function currentModel() {
  return process.env.AI_ASSISTANT_LLM_MODEL || DEFAULT_MODEL;
}

function buildSystemPrompt() {
  return [
    'Anda adalah lapisan penulisan-ulang bahasa untuk EWS AI Assistant, asisten data pertanian kelapa sawit.',
    'ATURAN MUTLAK (wajib dipatuhi tanpa kecuali):',
    '1. Anda HANYA boleh memakai fakta yang ada di "Jawaban Dasar" dan "Konteks Data" yang diberikan. Dilarang keras menambahkan angka, tanggal, status, atau klaim apa pun yang tidak tercantum di sana.',
    '2. Jika informasi tidak cukup untuk menjawab pertanyaan pengguna, katakan itu dengan jujur -- jangan mengarang jawaban.',
    '3. Tulis ulang dengan bahasa Indonesia yang natural, ramah, dan mudah dipahami staf lapangan -- tapi jangan mengubah makna atau menghilangkan angka penting dari Jawaban Dasar.',
    '4. Jangan menyebut diri Anda sebagai model AI/LLM dan jangan menyebut nama perusahaan pembuat model. Jawablah sebagai "EWS AI Assistant".',
    '5. Jawaban ringkas dan langsung ke inti, maksimal sekitar 150 kata.',
    '6. "Konteks Data" bisa berisi kb_chunks -- kutipan ASLI dari dokumen SOP (PDF/DOCX/PPT/XLS/TXT) yang diunggah tim ke Knowledge Base, lengkap dengan judul dokumen dan lokasinya (halaman/slide/sheet). Anda boleh memakai isi kb_chunks itu untuk menjawab, TAPI hanya kutip apa yang benar-benar tertulis di sana -- jangan menafsirkan, menggabungkan angka dari baris/dokumen yang berbeda seolah satu kesatuan, atau melengkapi bagian yang tidak disebutkan.',
    '7. Saat memakai isi kb_chunks, sebutkan sumbernya secara natural dalam kalimat (contoh: "Menurut SOP Pemupukan v1.0..."), supaya pengguna tahu itu berasal dari dokumen SOP, bukan dari data EWS.',
  ].join('\n');
}

/**
 * @param {{ question: string, ruleBasedAnswer: string, context: object }} params
 * @returns {Promise<{ text: string, model: string } | null>} null means "use the rule-based
 *   answer as-is" -- caller must treat null as a normal, expected outcome, not an error.
 */
async function phraseAnswer({ question, ruleBasedAnswer, context }) {
  if (!isEnabled()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const userMsg = [
      `Pertanyaan pengguna: ${question}`,
      '',
      '--- Jawaban Dasar (dari EWS Rule Engine, sudah 100% akurat -- hanya perlu dirapikan bahasanya) ---',
      ruleBasedAnswer,
      '',
      '--- Konteks Data EWS (JSON, referensi tambahan bila relevan) ---',
      JSON.stringify(context),
    ].join('\n');

    const model = currentModel();
    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userMsg }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[llmPhraser] Anthropic API error ${res.status}: ${errText.slice(0, 300)}`);
      return null;
    }
    const data = await res.json();
    const text = Array.isArray(data.content) ? data.content.find((c) => c.type === 'text')?.text : null;
    if (!text || !text.trim()) return null;
    return { text: text.trim(), model };
  } catch (err) {
    console.error('[llmPhraser] call failed, falling back to rule-based answer:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { phraseAnswer, isEnabled, currentModel };
