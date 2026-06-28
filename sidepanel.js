/**
 * sidepanel.js — UI controller (ES module).
 *
 * Wires together: model dropdown, chat rendering (via SKMarkdown), settings
 * modal, screenshot buttons, chat history persistence, and the API calls.
 */

import { MODELS, PROVIDER_KEY_FIELD, sendToAI } from "./api.js";

// ---------------------------------------------------------------------------
// Element references
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

const chatArea = $("chatArea");
const welcome = $("welcome");
const modelSelect = $("modelSelect");
const promptInput = $("promptInput");
const sendBtn = $("sendBtn");
const screenshotBtn = $("screenshotBtn");
const fullPageBtn = $("fullPageBtn");

const previewWrap = $("previewWrap");
const previewImg = $("previewImg");
const removePreview = $("removePreview");

const settingsBtn = $("settingsBtn");
const settingsOverlay = $("settingsOverlay");
const closeSettings = $("closeSettings");
const saveSettings = $("saveSettings");
const clearHistoryBtn = $("clearHistoryBtn");
const settingsStatus = $("settingsStatus");
const systemPromptInput = $("systemPrompt");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const STORAGE = {
  settings: "sk_settings", // { geminiKey, claudeKey, openaiKey, systemPrompt, model }
  history: "sk_history", // [{ role, content, image? }, ...]
};

const DEFAULT_SYSTEM_PROMPT =
  "Kamu adalah Aku Malas AI, asisten web yang membantu. Jawab ringkas, akurat, dan gunakan format Markdown.";

let settings = {
  geminiKey: "",
  claudeKey: "",
  openaiKey: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  model: "gemini-3.1-flash",
};

let history = []; // conversation memory passed to the API
let pendingImage = null; // data URL attached to the next message
let isBusy = false;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
init();

async function init() {
  populateModelDropdown();
  await loadSettings();
  await loadHistory();
  bindEvents();
}

function populateModelDropdown() {
  modelSelect.innerHTML = "";
  for (const [id, m] of Object.entries(MODELS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = m.label;
    modelSelect.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------
async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE.settings);
  if (data[STORAGE.settings]) {
    settings = { ...settings, ...data[STORAGE.settings] };
  }
  // Reflect into UI
  $("geminiKey").value = settings.geminiKey || "";
  $("claudeKey").value = settings.claudeKey || "";
  $("openaiKey").value = settings.openaiKey || "";
  systemPromptInput.value = settings.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  if (MODELS[settings.model]) modelSelect.value = settings.model;
}

async function persistSettings() {
  await chrome.storage.local.set({ [STORAGE.settings]: settings });
}

async function loadHistory() {
  const data = await chrome.storage.local.get(STORAGE.history);
  history = data[STORAGE.history] || [];
  if (history.length) {
    welcome.classList.add("hidden");
    history.forEach((m) =>
      appendMessage(m.role === "user" ? "user" : "ai", m.content, m.image, false)
    );
    scrollToBottom();
  }
}

async function persistHistory() {
  await chrome.storage.local.set({ [STORAGE.history]: history });
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------
function bindEvents() {
  // Auto-grow textarea
  promptInput.addEventListener("input", () => {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + "px";
  });

  // Enter to send, Shift+Enter for newline
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener("click", handleSend);
  screenshotBtn.addEventListener("click", handleManualScreenshot);
  fullPageBtn.addEventListener("click", handleFullPageScreenshot);

  removePreview.addEventListener("click", clearPendingImage);

  modelSelect.addEventListener("change", () => {
    settings.model = modelSelect.value;
    persistSettings();
  });

  // Settings modal
  settingsBtn.addEventListener("click", () => settingsOverlay.classList.remove("hidden"));
  closeSettings.addEventListener("click", () => settingsOverlay.classList.add("hidden"));
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden");
  });
  saveSettings.addEventListener("click", handleSaveSettings);
  clearHistoryBtn.addEventListener("click", handleClearHistory);

  // Empty-state suggestion chips: prefill the input and focus.
  document.querySelectorAll(".suggestion").forEach((chip) => {
    chip.addEventListener("click", () => {
      promptInput.value = chip.dataset.prompt + " ";
      promptInput.focus();
      promptInput.dispatchEvent(new Event("input")); // grow textarea
    });
  });

  // Delegated copy-button handler for code blocks
  chatArea.addEventListener("click", (e) => {
    const btn = e.target.closest(".copy-btn");
    if (!btn) return;
    const code = btn.closest(".code-block")?.querySelector("code");
    if (code) {
      navigator.clipboard.writeText(code.innerText).then(() => {
        const old = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = old), 1200);
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------
async function handleSaveSettings() {
  settings.geminiKey = $("geminiKey").value.trim();
  settings.claudeKey = $("claudeKey").value.trim();
  settings.openaiKey = $("openaiKey").value.trim();
  settings.systemPrompt = systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  await persistSettings();
  showSettingsStatus("Settings saved ✓");
}

function showSettingsStatus(msg) {
  settingsStatus.textContent = msg;
  setTimeout(() => (settingsStatus.textContent = ""), 1800);
}

async function handleClearHistory() {
  history = [];
  await persistHistory();
  // Remove all message nodes, keep welcome.
  [...chatArea.querySelectorAll(".msg, .typing-row")].forEach((n) => n.remove());
  welcome.classList.remove("hidden");
  showSettingsStatus("Chat history cleared");
}

// ---------------------------------------------------------------------------
// Screenshot handlers
// ---------------------------------------------------------------------------
async function handleManualScreenshot() {
  try {
    setBusy(true, screenshotBtn);
    const res = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE" });
    if (!res?.ok) throw new Error(res?.error || "Capture failed.");
    setPendingImage(res.dataUrl);
  } catch (err) {
    notifyError(err.message);
  } finally {
    setBusy(false, screenshotBtn);
  }
}

async function handleFullPageScreenshot() {
  try {
    setBusy(true, fullPageBtn);
    const res = await chrome.runtime.sendMessage({ type: "CAPTURE_FULL_PAGE" });
    if (!res?.ok) throw new Error(res?.error || "Full-page capture failed.");
    // Attach the full-page image and send immediately (no confirmation).
    pendingImage = res.dataUrl;
    await handleSend("Here is a full-page screenshot of the current page. Please analyze it.");
  } catch (err) {
    notifyError(err.message);
  } finally {
    setBusy(false, fullPageBtn);
  }
}

function setPendingImage(dataUrl) {
  pendingImage = dataUrl;
  previewImg.src = dataUrl;
  previewWrap.classList.remove("hidden");
}

function clearPendingImage() {
  pendingImage = null;
  previewImg.src = "";
  previewWrap.classList.add("hidden");
}

// ---------------------------------------------------------------------------
// Sending messages
// ---------------------------------------------------------------------------
async function handleSend(forcedText) {
  if (isBusy && !forcedText) return;

  const text = (forcedText ?? promptInput.value).trim();
  const image = pendingImage;

  if (!text && !image) return;

  // Validate the key for the chosen provider up front.
  const model = MODELS[settings.model];
  const keyField = PROVIDER_KEY_FIELD[model.provider];
  const apiKey = settings[keyField];
  if (!apiKey) {
    notifyError(
      `No API key set for ${model.label}. Click the gear icon and add your ${model.provider} key.`
    );
    settingsOverlay.classList.remove("hidden");
    return;
  }

  welcome.classList.add("hidden");

  // Render + store the user message.
  appendMessage("user", text, image, true);
  history.push({ role: "user", content: text, image: image || undefined });
  await persistHistory();

  // Reset the input + preview.
  promptInput.value = "";
  promptInput.style.height = "auto";
  clearPendingImage();

  // Loading state
  const typingRow = appendTyping();
  setBusy(true);

  try {
    const reply = await sendToAI({
      modelId: settings.model,
      apiKey,
      systemPrompt: settings.systemPrompt,
      messages: history,
    });

    typingRow.remove();
    appendMessage("ai", reply, null, true);
    history.push({ role: "assistant", content: reply });
    await persistHistory();
  } catch (err) {
    typingRow.remove();
    appendMessage("ai", `⚠️ **Error:** ${err.message}`, null, true);
    notifyError(err.message);
  } finally {
    setBusy(false);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function appendMessage(role, content, image, animate = true) {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;
  if (!animate) wrap.style.animation = "none";

  const roleLabel = document.createElement("div");
  roleLabel.className = "msg-role";
  roleLabel.textContent = role === "user" ? "Kamu" : "Aku Malas AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "ai") {
    // Render Markdown safely via the local renderer.
    bubble.innerHTML = window.SKMarkdown.render(content || "");
  } else {
    // User text is plain — escape by using textContent.
    const p = document.createElement("div");
    p.textContent = content || "";
    bubble.appendChild(p);
  }

  if (image) {
    const img = document.createElement("img");
    img.className = "attachment";
    img.src = image;
    bubble.appendChild(img);
  }

  wrap.appendChild(roleLabel);
  wrap.appendChild(bubble);
  chatArea.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function appendTyping() {
  const row = document.createElement("div");
  row.className = "msg ai typing-row";
  row.innerHTML = `
    <div class="msg-role">Aku Malas AI</div>
    <div class="bubble"><div class="typing"><span></span><span></span><span></span></div></div>
  `;
  chatArea.appendChild(row);
  scrollToBottom();
  return row;
}

function scrollToBottom() {
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ---------------------------------------------------------------------------
// Busy state + errors
// ---------------------------------------------------------------------------
function setBusy(busy, specificBtn) {
  isBusy = busy;
  sendBtn.disabled = busy;
  screenshotBtn.disabled = busy;
  fullPageBtn.disabled = busy;
  if (specificBtn && busy) specificBtn.dataset.loading = "1";
}

function notifyError(msg) {
  // Lightweight, non-blocking error surface.
  console.error("[Aku Malas AI]", msg);
  // Fall back to alert for hard failures like a missing key.
  // (kept minimal so it doesn't spam during normal use)
}
