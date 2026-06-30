/**
 * sidepanel.js — UI controller (ES module).
 *
 * Wires together: model dropdown, chat rendering (via SKMarkdown), settings
 * modal, screenshot buttons, chat history persistence, and the API calls.
 */

import { MODELS, PROVIDER_KEY_FIELD, sendToAI, sendToAIForAutopilot, estimateTokens } from "./api.js";
import { getProfile, saveProfile, deleteProfile } from "./site-profiles.js";
import { start, stop, executeNow, skipCurrent, on, getState } from "./autopilot.js";

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

// Auto-Pilot elements
const autoPilotBtn = $("autoPilotBtn");
const dryRunToggle = $("dryRunToggle");
const autopilotStatus = $("autopilotStatus");
const apProgressFill = $("apProgressFill");
const apStatusLabel = $("apStatusLabel");
const apTokenUsage = $("apTokenUsage");
const apCorrect = $("apCorrect");
const apWarning = $("apWarning");
const apFailed = $("apFailed");
const apStopBtn = $("apStopBtn");

// Site Profile elements
const profileHostname = $("profileHostname");
const profileContent = $("profileContent");
const profileQuestion = $("profileQuestion");
const profileOptions = $("profileOptions");
const profileSubmit = $("profileSubmit");
const profileNext = $("profileNext");
const loadProfileBtn = $("loadProfileBtn");
const saveProfileBtn = $("saveProfileBtn");
const deleteProfileBtn = $("deleteProfileBtn");
const profileStatus = $("profileStatus");

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
  tokenBudget: null,
};

let history = []; // conversation memory passed to the API
let pendingImage = null; // data URL attached to the next message
let isBusy = false;
let activePickerTarget = null;

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
  if (settings.tokenBudget) $("tokenBudget").value = settings.tokenBudget;
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
  // Listen for messages from background/content scripts
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TOGGLE_AUTOPILOT") {
      if (getState() !== "IDLE") {
        stop();
      } else {
        handleAutoPilot();
      }
    } else if (message?.type === "PICKER_RESULT") {
      if (activePickerTarget) {
        const inputEl = document.getElementById(activePickerTarget);
        if (inputEl) {
          inputEl.value = message.selector;
          showProfileStatus(`Selector diambil untuk ${activePickerTarget.replace('profile', '')}`);
        }
        activePickerTarget = null;
      }
    }
  });

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
  settingsBtn.addEventListener("click", async () => {
    settingsOverlay.classList.remove("hidden");
    
    // Auto-fill hostname for Site Profiles
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.url && !tab.url.startsWith("chrome")) {
        const host = new URL(tab.url).hostname;
        if (profileHostname.value !== host) {
          profileHostname.value = host;
          handleLoadProfile(); // Automatically try to load if it exists
        }
      }
    } catch (err) {
      console.warn("Failed to auto-fill hostname:", err);
    }
  });
  closeSettings.addEventListener("click", () => settingsOverlay.classList.add("hidden"));
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add("hidden");
  });
  saveSettings.addEventListener("click", handleSaveSettings);
  clearHistoryBtn.addEventListener("click", handleClearHistory);

  // Auto-Pilot
  autoPilotBtn.addEventListener("click", handleAutoPilot);

  // Site Profiles
  loadProfileBtn.addEventListener("click", handleLoadProfile);
  saveProfileBtn.addEventListener("click", handleSaveProfile);
  deleteProfileBtn.addEventListener("click", handleDeleteProfile);

  // Visual Element Picker
  document.querySelectorAll(".pick-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      activePickerTarget = btn.dataset.target;
      try {
        const res = await chrome.runtime.sendMessage({ type: "INJECT_PICKER" });
        if (!res?.ok) {
          showProfileStatus("Gagal inject picker: " + (res?.error || "Unknown error"));
          activePickerTarget = null;
        } else {
          showProfileStatus("Silakan klik elemen di halaman web...");
        }
      } catch (err) {
        showProfileStatus("Error: " + err.message);
        activePickerTarget = null;
      }
    });
  });

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
  settings.tokenBudget = parseInt($("tokenBudget").value, 10) || null;
  await persistSettings();
  settingsStatus.textContent = "Tersimpan ✔";
  settingsStatus.classList.remove("hidden");
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
  // Also show an alert so it's not missed if the chat scrolls too fast
  alert("⚠️ Auto-Pilot Error: " + msg);
}

// ---------------------------------------------------------------------------
// Auto-Pilot handlers
// ---------------------------------------------------------------------------

async function handleAutoPilot() {
  if (isBusy) return;

  const model = MODELS[settings.model];
  const keyField = PROVIDER_KEY_FIELD[model.provider];
  const apiKey = settings[keyField];
  if (!apiKey) {
    notifyError(`No API key set for ${model.label}.`);
    settingsOverlay.classList.remove("hidden");
    return;
  }

  welcome.classList.add("hidden");
  setBusy(true, autoPilotBtn);
  autopilotStatus.classList.remove("hidden");

  // Reset UI
  apProgressFill.style.width = "0%";
  apStatusLabel.textContent = "Starting...";
  apTokenUsage.textContent = "";
  apTokenUsage.className = "ap-token-usage";
  apCorrect.textContent = "0";
  apWarning.textContent = "0";
  apFailed.textContent = "0";

  // Start the state machine loop
  start({
    modelId: settings.model,
    apiKey,
    tokenBudget: settings.tokenBudget,
    isDryRun: dryRunToggle.checked
  });
}

// ---------------------------------------------------------------------------
// Auto-Pilot Events
// ---------------------------------------------------------------------------

on("stateChange", (state) => {
  apStatusLabel.textContent = state;
  switch (state) {
    case "PROFILING": apProgressFill.style.width = "10%"; break;
    case "EXTRACTING": apProgressFill.style.width = "20%"; break;
    case "DECIDING": apProgressFill.style.width = "50%"; break;
    case "PREVIEWING": apProgressFill.style.width = "70%"; break;
    case "EXECUTING": apProgressFill.style.width = "85%"; break;
    case "WAITING_PAGE_CHANGE": apProgressFill.style.width = "95%"; break;
    case "IDLE": 
      apProgressFill.style.width = "100%"; 
      setTimeout(() => apProgressFill.style.width = "0%", 1000);
      setBusy(false, autoPilotBtn);
      break;
  }
});

on("progress", (counters) => {
  apCorrect.textContent = counters.correct || 0;
  apWarning.textContent = counters.warning || 0;
  apFailed.textContent = counters.failed || 0;
});

on("tokenUpdate", (data) => {
  apTokenUsage.textContent = `${data.used} tokens`;
  if (data.percentage > 90) apTokenUsage.className = "ap-token-usage danger";
  else if (data.percentage > 70) apTokenUsage.className = "ap-token-usage warning";
  else apTokenUsage.className = "ap-token-usage";
});

on("tokenWarning", () => {
  const bubble = document.createElement("div");
  bubble.className = "token-warning-bubble";
  bubble.textContent = "⚠️ Token usage is approaching the limit.";
  chatArea.appendChild(bubble);
  scrollToBottom();
});

on("preview", (data) => {
  // Store summary in history
  const { decision, context } = data;
  const summary = decision.summary || "(no summary)";
  const answer = decision.selectedOption
    ? `Jawaban: ${decision.selectedOption.label} (${decision.confidence})`
    : "Tidak ada pertanyaan ditemukan.";
  
  history.push({
    role: "assistant",
    content: `[Auto-Pilot] ${answer}\n\nRingkasan: ${summary}\n\nAlasan: ${decision.reasoning || "-"}`,
  });
  persistHistory();

  renderDryRunBubble(decision, context, data.isDryRun);
});

on("done", ({ results, totalTokens }) => {
  const chapterCount = results ? results.length : 0;
  const answered = results ? results.filter(r => r.answer && r.answer !== "N/A").length : 0;
  const lowConf = results ? results.filter(r => r.confidence === "low").length : 0;
  const failed = 0;

  let details = results ? results.map((r, i) => {
    return `${i + 1}. Ch${r.chapter}: ${r.title} — [${r.answer}] (${r.confidence})`;
  }).join("\n") : "";

  const summaryMsg = `📊 **Ringkasan Auto-Pilot**
━━━━━━━━━━━━━━━━━━━━━━
Chapter diproses : ${chapterCount}
Jawaban dipilih  : ${answered}
Confidence rendah: ${lowConf}
Gagal            : ${failed}
Token digunakan  : ~${totalTokens || 0}

**Detail:**
${details}`;

  appendMessage("ai", summaryMsg, null, true);
  setBusy(false, autoPilotBtn);
  setTimeout(() => autopilotStatus.classList.add("hidden"), 3000);
});

on("error", (err) => {
  appendMessage("ai", `⚠️ **Auto-Pilot Error:** ${err.message}`, null, true);
  notifyError(err.message);
  setBusy(false, autoPilotBtn);
});

apStopBtn.addEventListener("click", () => stop());

/**
 * Build a formatted prompt string from the extracted context object.
 */
function buildPromptFromContext(ctx) {
  const lines = [];
  lines.push("=== KONTEKS HALAMAN ===");
  lines.push(`Judul: ${ctx.title}`);
  lines.push(`URL: ${ctx.url}`);
  lines.push("");

  if (ctx.content) {
    lines.push("=== KONTEN UTAMA ===");
    lines.push(ctx.content);
    lines.push("");
  }
  if (ctx.question) {
    lines.push("=== PERTANYAAN ===");
    lines.push(ctx.question);
    lines.push("");
  }
  if (ctx.options?.length > 0) {
    lines.push("=== OPSI TERSEDIA ===");
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    ctx.options.forEach((opt, i) => {
      const letter = labels[i] || String(i + 1);
      lines.push(`[${letter}] ${opt.label}${opt.value ? ` (value: ${opt.value})` : ""}`);
    });
    lines.push("");
  }
  if (ctx.actions?.length > 0) {
    lines.push("=== AKSI TERSEDIA ===");
    ctx.actions.forEach((act) => {
      lines.push(`[${act.type.toUpperCase()}] ${act.label} (selector: ${act.selector})`);
    });
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Render the AI decision as an interactive dry-run bubble in the chat.
 */
function renderDryRunBubble(decision, context) {
  const wrap = document.createElement("div");
  wrap.className = "msg ai";

  const roleLabel = document.createElement("div");
  roleLabel.className = "msg-role";
  roleLabel.textContent = "Auto-Pilot";

  const bubble = document.createElement("div");
  bubble.className = "bubble dry-run-bubble";

  // Header
  const header = document.createElement("div");
  header.className = "dr-header";
  header.textContent = `🔍 Dry-Run — ${context.title}`;
  bubble.appendChild(header);

  // Question
  if (context.question) {
    bubble.appendChild(makeField("Pertanyaan", context.question));
  }

  // Selected answer
  if (decision.selectedOption) {
    bubble.appendChild(makeField("Jawaban AI", decision.selectedOption.label));
  } else {
    bubble.appendChild(makeField("Jawaban AI", "Tidak ada pertanyaan/opsi ditemukan"));
  }

  // Reasoning
  if (decision.reasoning) {
    bubble.appendChild(makeField("Alasan", decision.reasoning));
  }

  // Confidence badge
  const confRow = document.createElement("div");
  confRow.className = "dr-field";
  const confKey = document.createElement("span");
  confKey.className = "dr-key";
  confKey.textContent = "Confidence";
  const confBadge = document.createElement("span");
  confBadge.className = `dr-confidence ${decision.confidence || "low"}`;
  confBadge.textContent = decision.confidence || "unknown";
  confRow.appendChild(confKey);
  confRow.appendChild(confBadge);
  bubble.appendChild(confRow);

  // Summary
  if (decision.summary) {
    bubble.appendChild(makeField("Ringkasan", decision.summary));
  }

  // Action buttons (Fase 2)
  const actionsDiv = document.createElement("div");
  actionsDiv.className = "dr-actions";

  const execBtn = document.createElement("button");
  execBtn.className = "dr-action-btn execute";
  execBtn.textContent = "▶ Eksekusi";
  execBtn.onclick = () => {
    execBtn.disabled = true;
    skipBtn.disabled = true;
    executeNow();
  };

  const skipBtn = document.createElement("button");
  skipBtn.className = "dr-action-btn skip";
  skipBtn.textContent = "⏭ Skip";
  skipBtn.onclick = () => {
    execBtn.disabled = true;
    skipBtn.disabled = true;
    skipCurrent();
  };

  const stopBtn = document.createElement("button");
  stopBtn.className = "dr-action-btn stop";
  stopBtn.textContent = "⏹ Stop";
  stopBtn.onclick = () => {
    stop();
  };

  actionsDiv.appendChild(execBtn);
  actionsDiv.appendChild(skipBtn);
  actionsDiv.appendChild(stopBtn);
  bubble.appendChild(actionsDiv);

  wrap.appendChild(roleLabel);
  wrap.appendChild(bubble);
  chatArea.appendChild(wrap);
  scrollToBottom();
}

function makeField(key, value) {
  const row = document.createElement("div");
  row.className = "dr-field";
  const k = document.createElement("span");
  k.className = "dr-key";
  k.textContent = key;
  const v = document.createElement("span");
  v.className = "dr-val";
  v.textContent = value;
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

// ---------------------------------------------------------------------------
// Site Profile handlers
// ---------------------------------------------------------------------------

async function handleLoadProfile() {
  const hostname = profileHostname.value.trim();
  if (!hostname) return;
  const profile = await getProfile(hostname);
  if (profile) {
    profileContent.value = profile.content || "";
    profileQuestion.value = profile.question || "";
    profileOptions.value = profile.options || "";
    profileSubmit.value = profile.submit || "";
    profileNext.value = profile.next || "";
    showProfileStatus("Profile loaded ✓");
  } else {
    profileContent.value = "";
    profileQuestion.value = "";
    profileOptions.value = "";
    profileSubmit.value = "";
    profileNext.value = "";
    showProfileStatus("No profile found for this hostname");
  }
}

async function handleSaveProfile() {
  const hostname = profileHostname.value.trim();
  if (!hostname) {
    showProfileStatus("Hostname is required");
    return;
  }
  await saveProfile(hostname, {
    content: profileContent.value,
    question: profileQuestion.value,
    options: profileOptions.value,
    submit: profileSubmit.value,
    next: profileNext.value,
  });
  showProfileStatus("Profile saved ✓");
}

async function handleDeleteProfile() {
  const hostname = profileHostname.value.trim();
  if (!hostname) return;
  await deleteProfile(hostname);
  profileContent.value = "";
  profileQuestion.value = "";
  profileOptions.value = "";
  profileSubmit.value = "";
  profileNext.value = "";
  showProfileStatus("Profile deleted");
}

function showProfileStatus(msg) {
  profileStatus.textContent = msg;
  setTimeout(() => (profileStatus.textContent = ""), 2000);
}
