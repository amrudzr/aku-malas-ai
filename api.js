/**
 * api.js — Modular AI API layer (ES module)
 *
 * Exposes:
 *   - MODELS: the registry that powers the model dropdown.
 *   - sendToAI(): a single fetch wrapper that dynamically switches endpoints
 *     and request shapes based on the selected model's provider.
 *
 * Each "provider" knows how to translate our internal, normalized message
 * format into its own API schema, and how to read the reply back out.
 *
 * Internal message format (what the UI passes in):
 *   {
 *     role: "user" | "assistant",
 *     content: "text...",
 *     image: "data:image/png;base64,...."   // optional, user messages only
 *   }
 */

// ---------------------------------------------------------------------------
// Model registry — add/remove models here and the dropdown updates itself.
// ---------------------------------------------------------------------------
export const MODELS = {
  "gemini-3.1-flash": {
    label: "Gemini 3.1 Flash",
    provider: "gemini",
    apiName: "gemini-3.1-flash",
    vision: true,
  },
  "gemini-3.1-flash-lite": {
    label: "Gemini 3.1 Flash Lite",
    provider: "gemini",
    apiName: "gemini-3.1-flash-lite",
    vision: true,
  },
  "gemini-3.1-pro": {
    label: "Gemini 3.1 Pro",
    provider: "gemini",
    apiName: "gemini-3.1-pro",
    vision: true,
  },
  "gemini-1.5-pro": {
    label: "Gemini 1.5 Pro",
    provider: "gemini",
    apiName: "gemini-3.1-pro",
    vision: true,
  },
  "gemini-1.5-flash": {
    label: "Gemini 1.5 Flash",
    provider: "gemini",
    apiName: "gemini-3.1-flash",
    vision: true,
  },
  "claude-3-5-sonnet": {
    label: "Claude 3.5 Sonnet",
    provider: "claude",
    apiName: "claude-3-5-sonnet-latest",
    vision: true,
  },
  "claude-3-5-haiku": {
    label: "Claude 3.5 Haiku",
    provider: "claude",
    apiName: "claude-3-5-haiku-latest",
    vision: false,
  },
  "gpt-4o": {
    label: "GPT-4o",
    provider: "openai",
    apiName: "gpt-4o",
    vision: true,
  },
  "gpt-4o-mini": {
    label: "GPT-4o mini",
    provider: "openai",
    apiName: "gpt-4o-mini",
    vision: true,
  },
};

// Which stored API key each provider uses.
export const PROVIDER_KEY_FIELD = {
  gemini: "geminiKey",
  claude: "claudeKey",
  openai: "openaiKey",
};

/**
 * Main entry point used by the UI.
 * @returns {Promise<string>} the assistant's text reply.
 */
export async function sendToAI({ modelId, apiKey, systemPrompt, messages }) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${model.label}. Open Settings (gear icon) and paste your key.`
    );
  }

  switch (model.provider) {
    case "gemini":
      return callGemini(model, apiKey, systemPrompt, messages);
    case "claude":
      return callClaude(model, apiKey, systemPrompt, messages);
    case "openai":
      return callOpenAI(model, apiKey, systemPrompt, messages);
    default:
      throw new Error(`Unsupported provider: ${model.provider}`);
  }
}

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Split a data URL into { mimeType, base64 }. */
function splitDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Invalid image data URL.");
  return { mimeType: match[1], base64: match[2] };
}

/** Robustly read an error body and surface a useful message. */
async function explainHttpError(res) {
  let detail = "";
  try {
    const data = await res.json();
    detail = data?.error?.message || JSON.stringify(data);
  } catch {
    detail = await res.text().catch(() => "");
  }
  return `Request failed (${res.status} ${res.statusText}). ${detail}`.trim();
}

// ---------------------------------------------------------------------------
// Provider: Google Gemini
// ---------------------------------------------------------------------------
async function callGemini(model, apiKey, systemPrompt, messages) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model.apiName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const contents = messages.map((m) => {
    const parts = [];
    if (m.content) parts.push({ text: m.content });
    if (m.image && model.vision) {
      const { mimeType, base64 } = splitDataUrl(m.image);
      parts.push({ inlineData: { mimeType, data: base64 } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const body = {
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explainHttpError(res));

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

// ---------------------------------------------------------------------------
// Provider: Anthropic Claude
// ---------------------------------------------------------------------------
async function callClaude(model, apiKey, systemPrompt, messages) {
  const url = "https://api.anthropic.com/v1/messages";

  const anthropicMessages = messages.map((m) => {
    const content = [];
    if (m.image && model.vision) {
      const { mimeType, base64 } = splitDataUrl(m.image);
      content.push({
        type: "image",
        source: { type: "base64", media_type: mimeType, data: base64 },
      });
    }
    if (m.content) content.push({ type: "text", text: m.content });
    return { role: m.role === "assistant" ? "assistant" : "user", content };
  });

  const body = {
    model: model.apiName,
    max_tokens: 4096,
    messages: anthropicMessages,
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Required to call the Anthropic API directly from a browser context.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explainHttpError(res));

  const data = await res.json();
  const text = data?.content
    ?.filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  if (!text) throw new Error("Claude returned an empty response.");
  return text;
}

// ---------------------------------------------------------------------------
// Provider: OpenAI
// ---------------------------------------------------------------------------
async function callOpenAI(model, apiKey, systemPrompt, messages) {
  const url = "https://api.openai.com/v1/chat/completions";

  const oaMessages = [];
  if (systemPrompt) oaMessages.push({ role: "system", content: systemPrompt });

  for (const m of messages) {
    if (m.image && model.vision) {
      const content = [];
      if (m.content) content.push({ type: "text", text: m.content });
      content.push({ type: "image_url", image_url: { url: m.image } });
      oaMessages.push({ role: m.role, content });
    } else {
      oaMessages.push({ role: m.role, content: m.content });
    }
  }

  const body = {
    model: model.apiName,
    messages: oaMessages,
    temperature: 0.7,
    max_tokens: 4096,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explainHttpError(res));

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error("OpenAI returned an empty response.");
  return text;
}

// ---------------------------------------------------------------------------
// Auto-Pilot: structured JSON response for page automation
// ---------------------------------------------------------------------------

const AUTOPILOT_SYSTEM_PROMPT = `Kamu adalah asisten automasi ujian/quiz di halaman web, dan expert dalam bidang IT/Ilmu Komputer (termasuk kursus seperti Oracle Academy). Kamu menerima teks, pertanyaan, opsi jawaban beserta CSS selector, dan aksi navigasi.

TUGAS UTAMA:
1. Baca pertanyaan dengan sangat teliti. Perhatikan jebakan atau kata kunci. Pastikan jika soal meminta SATU atau LEBIH DARI SATU jawaban.
2. Evaluasi setiap opsi jawaban secara kritis sebelum mengambil keputusan. Pilih opsi yang 100% akurat.
3. Kembalikan keputusanmu dalam format JSON.

FORMAT RESPONS (HANYA JSON, tanpa teks lain):

{
  "reasoning": "Analisis step-by-step singkat mengapa opsi yang dipilih benar dan opsi lain salah",
  "confidence": "high | medium | low",
  "selectedOptions": [
    { "index": 0, "label": "Label opsi A", "selector": "EXACT_SELECTOR_DARI_DAFTAR_OPSI" }
  ],
  "actions": [
    { "type": "select", "selector": "EXACT_SELECTOR_DARI_DAFTAR_OPSI" },
    { "type": "submit", "selector": "EXACT_SELECTOR_SUBMIT" }
  ]
}

ATURAN KRITIS:
1. **SELECTOR**: Gunakan selector PERSIS seperti yang tertulis di bagian "OPSI TERSEDIA" dan "AKSI TERSEDIA".
2. **MULTI-SELECT**: Jika soal meminta lebih dari satu jawaban, masukkan SEMUA jawaban yang benar ke array "selectedOptions".
3. **SUBMIT**: SELALU tambahkan aksi submit/next di akhir array "actions".
4. **TIDAK ADA SOAL**: Jika benar-benar tidak ada opsi jawaban, kembalikan array kosong []. Jika ADA opsi jawaban, kamu WAJIB memilih yang paling masuk akal (meskipun soal terlihat kosong/kurang).
5. JANGAN menambahkan teks apapun di luar blok JSON.`;

/**
 * Send page context to AI and receive structured JSON instructions.
 * Used by the Auto-Pilot system instead of the normal chat flow.
 *
 * @param {Object} params
 * @param {string} params.modelId
 * @param {string} params.apiKey
 * @param {string} params.pageContext  Formatted prompt text from extractor.
 * @param {string[]} [params.chapterSummaries]  Prior chapter summaries for context carry-over.
 * @param {string} params.imageUrl  Optional base64 image data url of the captured page.
 * @returns {Promise<Object>}  Parsed JSON decision from the AI.
 */
export async function sendToAIForAutopilot({ modelId, apiKey, pageContext, chapterSummaries, imageUrl }) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!apiKey) throw new Error(`Missing API key for ${model.label}.`);

  // Build the user message with optional chapter memory.
  let userMessage = pageContext;
  if (chapterSummaries && chapterSummaries.length > 0) {
    const memory = chapterSummaries
      .map((s, i) => `Ch${i + 1}: ${s}`)
      .join("\n");
    userMessage = `=== RINGKASAN CHAPTER SEBELUMNYA ===\n${memory}\n\n${pageContext}`;
  }

  let rawText;
  switch (model.provider) {
    case "gemini":
      rawText = await callGeminiAutopilot(model, apiKey, userMessage, imageUrl);
      break;
    case "claude":
      rawText = await callClaude(model, apiKey, AUTOPILOT_SYSTEM_PROMPT, [
        { role: "user", content: userMessage, image: imageUrl },
      ]);
      break;
    case "openai":
      rawText = await callOpenAI(model, apiKey, AUTOPILOT_SYSTEM_PROMPT, [
        { role: "user", content: userMessage, image: imageUrl },
      ]);
      break;
    default:
      throw new Error(`Unsupported provider: ${model.provider}`);
  }

  // Parse JSON from the AI response (strip markdown fences if present).
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`AI returned invalid JSON. Raw response:\n${rawText}`);
  }
}

/**
 * Gemini-specific autopilot call that uses response_mime_type for reliable JSON.
 */
async function callGeminiAutopilot(model, apiKey, userMessage, imageUrl) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model.apiName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [{ text: userMessage }];
  if (imageUrl && model.vision) {
    const { mimeType, base64 } = splitDataUrl(imageUrl);
    parts.push({ inlineData: { mimeType, data: base64 } });
  }

  const body = {
    contents: [
      { role: "user", parts },
    ],
    systemInstruction: { parts: [{ text: AUTOPILOT_SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.3,         // lower temp for more deterministic answers
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explainHttpError(res));

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
        .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}
// ---------------------------------------------------------------------------
// Auto-Profiler: analyze DOM to extract CSS selectors
// ---------------------------------------------------------------------------

const PROFILER_SYSTEM_PROMPT = `Kamu adalah expert Frontend Developer. Kamu menerima versi mini dari struktur DOM sebuah halaman web.
Tugasmu adalah menganalisis DOM tersebut dan menemukan CSS selector terbaik untuk mengidentifikasi elemen-elemen penting.

Kembalikan HANYA JSON dengan struktur berikut:
{
  "content": "CSS selector untuk area materi / artikel utama (jika ada, else null)",
  "question": "CSS selector untuk teks pertanyaan (jika ada, else null)",
  "options": "CSS selector untuk opsi jawaban (contoh: 'input[type=radio]', '.answer-choice') (jika ada, else null)",
  "submit": "CSS selector untuk tombol submit/kirim jawaban (jika ada, else null)",
  "next": "CSS selector untuk tombol lanjut/next chapter (jika ada, else null)"
}

Aturan:
- Selector harus se-spesifik mungkin (gunakan id, class khusus, name, data-* attr).
- Usahakan selector sependek mungkin tapi akurat.
- Jika tidak menemukan elemen untuk kategori tertentu, kembalikan null.
- HANYA kembalikan string format JSON yang valid.`;

/**
 * Send DOM string to AI to automatically guess CSS selectors for a site profile.
 */
export async function sendToAIForProfiler({ modelId, apiKey, domString }) {
  const model = MODELS[modelId];
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!apiKey) throw new Error(`Missing API key for ${model.label}.`);

  if (model.provider === "gemini") {
    return callGeminiProfiler(model, apiKey, domString);
  } else {
    // For Claude / OpenAI
    let rawText;
    if (model.provider === "claude") {
      rawText = await callClaude(model, apiKey, PROFILER_SYSTEM_PROMPT, [{ role: "user", content: domString }]);
    } else {
      rawText = await callOpenAI(model, apiKey, PROFILER_SYSTEM_PROMPT, [{ role: "user", content: domString }]);
    }
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      throw new Error(`AI returned invalid JSON. Raw response:\n${rawText}`);
    }
  }
}

async function callGeminiProfiler(model, apiKey, domString) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${model.apiName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      { role: "user", parts: [{ text: domString }] },
    ],
    systemInstruction: { parts: [{ text: PROFILER_SYSTEM_PROMPT }] },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await explainHttpError(res));

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join("\n");
  if (!text) throw new Error("Gemini returned an empty response.");
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`Failed to parse profiler JSON: ${text}`);
  }
}

/**
 * Estimasi kasar jumlah token dari sebuah string.
 * Menggunakan aturan ~4 karakter = 1 token (rough average untuk bahasa campuran).
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
