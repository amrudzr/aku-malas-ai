/**
 * autopilot.js — State machine and loop controller for Auto-Pilot mode.
 */

import { sendToAIForAutopilot, sendToAIForProfiler, estimateTokens } from "./api.js";
import { getProfile, saveProfile } from "./site-profiles.js";

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
      lines.push(`[${letter}] ${opt.label} (selector: ${opt.selector})`);
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
  
  setState("STARTING");
  
  try {
    while (state !== "IDLE") {
      setState("EXTRACTING");
      
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab) throw new Error("No active tab found.");
      
      const hostname = activeTab.url ? new URL(activeTab.url).hostname : "";
      let profile = await getProfile(hostname);
      
      // Auto-Profiler: AI Selector Auto-Discovery
      if (!profile && hostname && options.apiKey) {
        setState("PROFILING");
        try {
          const compressRes = await chrome.runtime.sendMessage({ type: "COMPRESS_DOM" });
          if (compressRes?.ok && compressRes.domString) {
            const aiSelectors = await sendToAIForProfiler({
              modelId: options.modelId,
              apiKey: options.apiKey,
              domString: compressRes.domString
            });
            
            const cleaned = {};
            for (const [k, v] of Object.entries(aiSelectors)) {
              if (v && typeof v === "string") cleaned[k] = v;
            }
            if (Object.keys(cleaned).length > 0) {
              profile = {
                hostname: new URL(activeTab.url).hostname,
                ...cleaned,
              };
              console.log("[Auto-Pilot] AI Discovered Profile:", profile);
              await saveProfile(profile.hostname, profile);
            }
          }
        } catch (e) {
          console.warn("[Auto-Profiler] Failed to auto-discover selectors:", e);
          // Fallback to generic heuristics (profile = null)
        }
        if (state === "IDLE") break;
        
        setState("EXTRACTING");
      }
      
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
      
      // Capture screenshot to provide visual context
      let imageDataUrl = null;
      try {
        const captureRes = await chrome.runtime.sendMessage({ type: "CAPTURE_VISIBLE" });
        if (captureRes?.ok && captureRes.dataUrl) {
          imageDataUrl = captureRes.dataUrl;
        }
      } catch (e) {
        console.warn("[Auto-Pilot] Failed to capture visual context:", e);
      }
      
      if (state === "IDLE") break;

      const decision = await sendToAIForAutopilot({
        modelId: options.modelId,
        apiKey: options.apiKey,
        pageContext: promptText,
        chapterSummaries,
        imageUrl: imageDataUrl
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

      // Log result — support both selectedOption (legacy) and selectedOptions (new)
      const selectedList = decision.selectedOptions || (decision.selectedOption ? [decision.selectedOption] : []);
      const answerLabel = selectedList.length > 0
        ? selectedList.map(o => o.label).join(", ")
        : "N/A";
      results.push({
        chapter: count + 1,
        title: context.title,
        question: context.question,
        answer: answerLabel,
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
        
        // Build a clean action array from AI response + fallbacks
        let actionArray = [];
        
        // Step 1: Add select actions for all chosen options
        if (selectedList.length > 0) {
          for (const opt of selectedList) {
            if (opt.selector && !actionArray.find(a => a.selector === opt.selector)) {
              actionArray.push({ type: "select", selector: opt.selector });
            }
          }
        }
        
        // Step 2: Add any additional AI-specified actions (submit/click/next)
        if (decision.actions && decision.actions.length > 0) {
          for (const act of decision.actions) {
            // Skip "select" actions since we already added them from selectedOptions
            if (act.type === "select") continue;
            if (act.selector && !actionArray.find(a => a.selector === act.selector)) {
              actionArray.push(act);
            }
          }
        }
        
        // Step 3: Ensure a submit/next action exists (fallback from page context)
        const hasNavAction = actionArray.some(a => ["click", "next", "submit"].includes(a.type) && a.selector);
        if (!hasNavAction && context.actions && context.actions.length > 0) {
          const navAction = context.actions.find(a => a.type === "submit" || a.type === "next");
          if (navAction) {
            actionArray.push({
              type: navAction.type,
              selector: navAction.selector
            });
            console.log("[Auto-Pilot] Auto-appended navigation action:", navAction);
          }
        }
        
        console.log("[Auto-Pilot] Final action array:", JSON.stringify(actionArray));
        
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
        // Check if we had a submit/next action at all
        const hasNext = actionArray.some(a => ["click", "next", "submit"].includes(a.type) && a.selector);
        if (!hasNext) {
          console.log("[Auto-Pilot] Soal sudah habis atau tidak ada aksi navigasi. Menghentikan loop.");
          break;
        }

        // Wait for content change (SPA-friendly: check DOM content instead of URL)
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
        // Extra sleep to allow dom rendering after SPA navigation
        await sleep(500);
      }

      count++;
      const correct = results.filter(r => r.confidence === "high" || r.confidence === "medium").length;
      const warning = results.filter(r => r.confidence === "low").length;
      const failed = 0;
      emit("progress", { completed: count, correct, warning, failed });
    }
  } catch (err) {
    const errorMsg = err?.message || (typeof err === "string" ? err : JSON.stringify(err));
    emit("error", new Error(errorMsg || "Unknown Auto-Pilot Error"));
  } finally {
    setState("IDLE");
    emit("done", { results, totalTokens });
  }
}
