/**
 * autopilot.js — State machine and loop controller for Auto-Pilot mode.
 */

import { sendToAIForAutopilot, estimateTokens } from "./api.js";
import { getProfile } from "./site-profiles.js";

// Event handling
const listeners = {};
export function on(event, callback) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
}
function emit(event, data) {
  if (listeners[event]) {
    listeners[event].forEach((cb) => cb(data));
  }
}

// State
let state = "IDLE"; // IDLE, EXTRACTING, DECIDING, PREVIEWING, EXECUTING, WAITING_PAGE_CHANGE
let options = {};
let results = [];
let chapterSummaries = [];
let totalTokens = 0;
let count = 0;
let userActionResolve = null;
let userSkipped = false;

function setState(newState) {
  state = newState;
  emit("stateChange", state);
}

export function getState() {
  return state;
}

// User Actions from UI (Preview bubble)
export function executeNow() {
  if (state !== "PREVIEWING" || !userActionResolve) return;
  userSkipped = false;
  userActionResolve();
}

export function skipCurrent() {
  if (state !== "PREVIEWING" || !userActionResolve) return;
  userSkipped = true;
  userActionResolve();
}

export function stop() {
  if (state === "IDLE") return;
  const wasPreviewing = (state === "PREVIEWING");
  setState("IDLE"); // Stopping loop
  if (wasPreviewing && userActionResolve) {
    userActionResolve(); // Release the lock so loop can gracefully exit
  }
}

function waitForUserAction() {
  return new Promise((resolve) => {
    userActionResolve = resolve;
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

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

export async function start(opts) {
  if (state !== "IDLE") return;
  options = opts;
  results = [];
  chapterSummaries = [];
  totalTokens = 0;
  count = 0;
  
  try {
    while (state !== "IDLE") {
      setState("EXTRACTING");
      
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab) throw new Error("No active tab found.");
      
      const hostname = activeTab.url ? new URL(activeTab.url).hostname : "";
      const profile = await getProfile(hostname);
      
      const extractRes = await chrome.runtime.sendMessage({
        type: "EXTRACT_PAGE",
        profile,
      });
      
      if (!extractRes?.ok) {
        throw new Error(extractRes?.error || "Extraction failed.");
      }
      
      const context = extractRes.context;
      const promptText = buildPromptFromContext(context);
      
      if (state === "IDLE") break; // Checked if stopped during await

      setState("DECIDING");
      const decision = await sendToAIForAutopilot({
        modelId: options.modelId,
        apiKey: options.apiKey,
        pageContext: promptText,
        chapterSummaries,
      });

      if (decision.summary) {
        chapterSummaries.push(decision.summary);
        if (chapterSummaries.length > 10) {
          chapterSummaries = chapterSummaries.slice(-10);
        }
      }
      
      // Calculate tokens
      const promptTokens = estimateTokens(promptText);
      const resTokens = estimateTokens(JSON.stringify(decision));
      totalTokens += (promptTokens + resTokens);
      
      emit("tokenUpdate", { used: totalTokens, budget: options.tokenBudget });

      if (state === "IDLE") break;

      // Log result
      results.push({
        chapter: count + 1,
        title: context.title,
        question: context.question,
        answer: decision.selectedOption ? decision.selectedOption.label : "N/A",
        confidence: decision.confidence || "low",
      });

      // Preview or execute
      userSkipped = false;
      let shouldPreview = options.dryRun;
      
      if (options.tokenBudget && totalTokens >= options.tokenBudget) {
        shouldPreview = true;
        emit("tokenWarning", { used: totalTokens, budget: options.tokenBudget });
      }

      if (shouldPreview) {
        setState("PREVIEWING");
        emit("preview", { decision, context });
        await waitForUserAction();
        if (state === "IDLE") break;
      }

      if (!userSkipped) {
        setState("EXECUTING");
        const actionArray = decision.actions || [];
        
        // Add the selected option if not already in actions array
        if (decision.selectedOption?.selector && !actionArray.find(a => a.selector === decision.selectedOption.selector)) {
          actionArray.unshift({
            type: "select",
            selector: decision.selectedOption.selector
          });
        }
        
        if (actionArray.length > 0) {
          const execRes = await chrome.runtime.sendMessage({
            type: "EXECUTE_ACTION",
            tabId: activeTab.id,
            actions: actionArray,
          });
          if (!execRes?.ok) {
            throw new Error(execRes?.error || "Execution failed.");
          }
        }
        
        setState("WAITING_PAGE_CHANGE");
        // We wait a bit to let navigation happen. If no next action exists, we stop.
        const hasNext = actionArray.some(a => a.type === "click" && a.selector);
        if (!hasNext) {
          // If the AI didn't click anything to navigate, we assume the loop is done.
          emit("error", new Error("No navigation action found by AI. Stopping."));
          break;
        }

        // Wait for page to reload/navigate
        try {
          const waitRes = await chrome.runtime.sendMessage({
            type: "WAIT_FOR_PAGE_CHANGE",
            tabId: activeTab.id,
            originalUrl: activeTab.url,
            originalTitle: activeTab.title
          });
          if (!waitRes?.ok) {
            console.warn("Wait for page change returned error or timed out:", waitRes?.error);
          }
        } catch (e) {
          console.warn("Failed to wait for page change:", e);
        }
        // Extra sleep to allow dom rendering
        await sleep(1500);
      }

      count++;
      const correct = results.filter(r => r.confidence === "high" || r.confidence === "medium").length;
      const warning = results.filter(r => r.confidence === "low").length;
      const failed = 0;
      emit("progress", { completed: count, correct, warning, failed });
    }
  } catch (err) {
    emit("error", err);
  } finally {
    setState("IDLE");
    emit("done", { results, totalTokens });
  }
}
