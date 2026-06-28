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
    apiName: "gemini-1.5-pro",
    vision: true,
  },
  "gemini-1.5-flash": {
    label: "Gemini 1.5 Flash",
    provider: "gemini",
    apiName: "gemini-1.5-flash",
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
