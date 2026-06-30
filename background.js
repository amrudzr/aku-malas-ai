/**
 * background.js — MV3 Service Worker
 * Responsibilities:
 *   1. Open the side panel when the toolbar icon is clicked.
 *   2. Handle the "full-page screenshot" workflow (scroll + capture + stitch),
 *      because captureVisibleTab can only be called from an extension context
 *      and OffscreenCanvas (for stitching) is available in the worker.
 */

// ---------------------------------------------------------------------------
// 1. Open side panel on icon click
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  // Make the toolbar icon toggle the side panel automatically.
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error("setPanelBehavior failed:", err));
});

// ---------------------------------------------------------------------------
// Keyboard shortcut
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-autopilot") {
    // Forward ke sidepanel via messaging
    chrome.runtime.sendMessage({ type: "TOGGLE_AUTOPILOT" }).catch(() => {
      // Sidepanel mungkin belum terbuka — ignore error
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Message router
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CAPTURE_VISIBLE") {
    captureVisible()
      .then((dataUrl) => sendResponse({ ok: true, dataUrl }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep the message channel open for async response
  }

  if (message?.type === "CAPTURE_FULL_PAGE") {
    captureFullPage()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === "EXTRACT_PAGE") {
    extractPage(message.profile || null)
      .then((context) => sendResponse({ ok: true, context }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === "EXECUTE_ACTION") {
    executeAction(message.tabId, message.actions)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === "WAIT_FOR_PAGE_CHANGE") {
    waitForPageChange(message.tabId, message.originalTitle, message.originalUrl)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the currently active tab in the last focused window. */
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error("No active tab found.");
  if (/^(chrome|edge|about|chrome-extension):/i.test(tab.url || "")) {
    throw new Error("Cannot capture this page (browser internal page).");
  }
  return tab;
}

/** Capture only the visible viewport. Returns a PNG data URL. */
async function captureVisible() {
  const tab = await getActiveTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });
  return dataUrl;
}

/**
 * Capture the entire scrollable page by scrolling through it, capturing each
 * viewport, and stitching the slices onto a single OffscreenCanvas.
 * Falls back gracefully to plain text extraction if anything fails.
 */
async function captureFullPage() {
  const tab = await getActiveTab();

  // Step 1: read page metrics + freeze the page (hide scrollbars, disable
  // smooth scroll, remember original scroll position).
  const [{ result: metrics }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const body = document.body;
      const de = document.documentElement;
      const totalHeight = Math.max(
        body.scrollHeight, de.scrollHeight,
        body.offsetHeight, de.offsetHeight,
        body.clientHeight, de.clientHeight
      );
      const totalWidth = Math.max(de.clientWidth, body.clientWidth);
      return {
        totalHeight,
        totalWidth,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
        dpr: window.devicePixelRatio || 1,
        originalScrollY: window.scrollY,
        originalOverflow: de.style.overflow,
      };
    },
  });

  // Guard against absurdly tall pages (avoids huge memory + rate-limit pain).
  const MAX_HEIGHT = 20000;
  const cappedHeight = Math.min(metrics.totalHeight, MAX_HEIGHT);

  const dpr = metrics.dpr;
  const canvas = new OffscreenCanvas(
    Math.round(metrics.viewportWidth * dpr),
    Math.round(cappedHeight * dpr)
  );
  const ctx = canvas.getContext("2d");

  // Hide scrollbars + sticky elements that would repeat on every slice.
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      document.documentElement.style.overflow = "hidden";
      // Temporarily neutralise fixed/sticky elements so they don't duplicate.
      window.__sk_fixed = [];
      document.querySelectorAll("*").forEach((el) => {
        const pos = getComputedStyle(el).position;
        if (pos === "fixed" || pos === "sticky") {
          window.__sk_fixed.push([el, el.style.position]);
          el.style.position = "absolute";
        }
      });
    },
  });

  try {
    let y = 0;
    const step = metrics.viewportHeight;

    while (y < cappedHeight) {
      // Scroll to the next slice.
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (scrollY) => window.scrollTo(0, scrollY),
        args: [y],
      });

      // Wait for paint + respect captureVisibleTab rate limits (~2/sec).
      await sleep(500);

      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: "png",
      });
      const bitmap = await dataUrlToBitmap(dataUrl);

      // Last slice may be shorter than a full viewport — clip it.
      const remaining = cappedHeight - y;
      const sliceCssHeight = Math.min(step, remaining);
      const sliceDeviceHeight = Math.round(sliceCssHeight * dpr);

      ctx.drawImage(
        bitmap,
        0, 0,                                   // source x,y
        bitmap.width, sliceDeviceHeight,        // source w,h
        0, Math.round(y * dpr),                 // dest x,y
        bitmap.width, sliceDeviceHeight         // dest w,h
      );

      y += step;
    }

    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    const finalDataUrl = await blobToDataUrl(blob);

    return { dataUrl: finalDataUrl };
  } finally {
    // Step 3: restore the page no matter what happened above.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (scrollY) => {
        document.documentElement.style.overflow = "";
        (window.__sk_fixed || []).forEach(([el, original]) => {
          el.style.position = original;
        });
        delete window.__sk_fixed;
        window.scrollTo(0, scrollY);
      },
      args: [metrics.originalScrollY],
    });
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dataUrlToBitmap(dataUrl) {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// 3. Page text extraction (Auto-Pilot Layer 1)
// ---------------------------------------------------------------------------

/**
 * Extract structured text context from the active tab.
 * Runs extraction logic in the page's content-script context.
 * @param {Object|null} profile  Site profile with CSS selectors, or null.
 * @returns {Promise<Object>}  Structured page context.
 */
async function extractPage(profile) {
  const tab = await getActiveTab();

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [profile],
    func: (profile) => {
      // --- Inline extraction logic (runs in page context) ---
      // We inline this because MV3 service workers cannot directly import
      // ES modules into the content-script context via executeScript.

      function cleanText(text) {
        return (text || "").replace(/\s+/g, " ").trim();
      }

      function buildSelector(el, fallbackBase, index) {
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        return `${fallbackBase}:nth-of-type(${index + 1})`;
      }

      function getOptionLabel(el) {
        if (el.id) {
          const label = document.querySelector(`label[for="${el.id}"]`);
          if (label) return cleanText(label.textContent);
        }
        const parentLabel = el.closest("label");
        if (parentLabel) return cleanText(parentLabel.textContent);
        const next = el.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
          return cleanText(next.textContent);
        }
        const parent = el.parentElement;
        if (parent) {
          const text = parent.textContent.replace(el.textContent || "", "").trim();
          if (text) return cleanText(text);
        }
        return el.value || "(no label)";
      }

      // --- Content ---
      function extractContent() {
        if (profile?.content) {
          const el = document.querySelector(profile.content);
          return el ? cleanText(el.innerText) : "";
        }
        const candidates = [
          "article", "main", "[role='main']", ".content", ".materi",
          ".lesson-content", ".course-content", "#content",
          ".post-body", ".entry-content",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 50) return cleanText(el.innerText);
        }
        return cleanText(document.body?.innerText || "").slice(0, 5000);
      }

      // --- Question ---
      function extractQuestion() {
        if (profile?.question) {
          const el = document.querySelector(profile.question);
          return el ? cleanText(el.innerText) : "";
        }
        const candidates = [
          ".question-text", ".quiz-question", ".soal", ".qtext",
          ".question", ".que .qtext", "legend", ".prompt", "[data-question]",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 5) return cleanText(el.innerText);
        }
        return "";
      }

      // --- Options ---
      function detectOptions() {
        const options = [];
        if (profile?.options) {
          const els = document.querySelectorAll(profile.options);
          els.forEach((el, i) => {
            options.push({
              selector: buildSelector(el, profile.options, i),
              label: getOptionLabel(el),
              value: el.value || el.dataset?.value || "",
              type: el.type || el.tagName.toLowerCase(),
              index: i,
            });
          });
          return options;
        }
        // Heuristic: radios
        const radios = document.querySelectorAll('input[type="radio"]');
        if (radios.length > 0) {
          radios.forEach((r, i) => {
            options.push({
              selector: buildSelector(r, 'input[type="radio"]', i),
              label: getOptionLabel(r), value: r.value || "",
              type: "radio", index: i,
            });
          });
          return options;
        }
        // Heuristic: checkboxes
        const cbs = document.querySelectorAll('input[type="checkbox"]');
        if (cbs.length >= 2) {
          cbs.forEach((cb, i) => {
            options.push({
              selector: buildSelector(cb, 'input[type="checkbox"]', i),
              label: getOptionLabel(cb), value: cb.value || "",
              type: "checkbox", index: i,
            });
          });
          return options;
        }
        // Heuristic: clickable answer containers
        const answerSels = [
          ".answer-option", ".choice", ".option", ".answer",
          "[data-answer]", ".multichoice .answer div",
        ];
        for (const sel of answerSels) {
          const els = document.querySelectorAll(sel);
          if (els.length >= 2) {
            els.forEach((el, i) => {
              options.push({
                selector: buildSelector(el, sel, i),
                label: cleanText(el.innerText),
                value: el.dataset?.value || el.dataset?.answer || "",
                type: "clickable", index: i,
              });
            });
            return options;
          }
        }
        return options;
      }

      // --- Actions ---
      function detectActions() {
        const actions = [];
        if (profile?.submit) {
          const el = document.querySelector(profile.submit);
          if (el) actions.push({ selector: profile.submit, label: cleanText(el.textContent) || "Submit", type: "submit" });
        }
        if (profile?.next) {
          const el = document.querySelector(profile.next);
          if (el) actions.push({ selector: profile.next, label: cleanText(el.textContent) || "Next", type: "next" });
        }
        if (profile?.submit || profile?.next) return actions;

        // Heuristic: submit
        const submitSels = [
          'button[type="submit"]', 'input[type="submit"]', ".submit-btn",
          "#submitBtn", "#submit", ".btn-submit", ".check-answer",
        ];
        for (const sel of submitSels) {
          const el = document.querySelector(sel);
          if (el) {
            actions.push({ selector: sel, label: cleanText(el.textContent || el.value) || "Submit", type: "submit" });
            break;
          }
        }
        // Heuristic: next
        const nextPat = /next|lanjut|berikut|selanjutnya|continue|proceed|→|»|▶/i;
        const allBtns = document.querySelectorAll("a, button");
        for (const btn of allBtns) {
          const text = (btn.textContent || btn.title || btn.ariaLabel || "").trim();
          if (nextPat.test(text) && text.length < 60) {
            actions.push({ selector: buildSelector(btn, btn.tagName.toLowerCase(), 0), label: cleanText(text) || "Next", type: "next" });
            break;
          }
        }
        return actions;
      }

      // --- Build and return ---
      return {
        title: document.title || "",
        url: location.href,
        hostname: location.hostname,
        content: extractContent(),
        question: extractQuestion(),
        options: detectOptions(),
        actions: detectActions(),
      };
    },
  });

  return result;
}

/**
 * Execute an array of actions (e.g. clicks, selects) in the active tab.
 */
async function executeAction(tabId, actions) {
  if (!tabId) {
    const tab = await getActiveTab();
    tabId = tab.id;
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    args: [actions],
    func: async (actionsArray) => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      for (const action of actionsArray) {
        if (!action.selector) continue;
        const el = document.querySelector(action.selector);
        if (!el) {
          console.warn(`[Auto-Pilot] Element not found for selector: ${action.selector}`);
          continue;
        }

        if (action.type === "select") {
          if (el.type === "radio" || el.type === "checkbox") {
            el.checked = true;
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (el.tagName.toLowerCase() === "select") {
            el.value = action.value || el.options[el.selectedIndex]?.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            // Click as fallback
            el.click();
          }
        } else if (action.type === "click" || action.type === "submit" || action.type === "next") {
          el.click();
        } else if (action.type === "fill") {
          el.value = action.value || "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Delay between actions
        await sleep(400);
      }
    }
  });
}

/**
 * Wait for document.title or location.href to change indicating navigation.
 */
function waitForPageChange(tabId, originalTitle, originalUrl, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let intervalId;

    const check = async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        reject(new Error("Timeout waiting for page change"));
        return;
      }
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => ({ title: document.title, url: location.href })
        });
        if (result.title !== originalTitle || result.url !== originalUrl) {
          clearInterval(intervalId);
          resolve();
        }
      } catch (e) {
        // Tab might be closing or navigating, which implies change
        clearInterval(intervalId);
        resolve();
      }
    };

    intervalId = setInterval(check, 500);
  });
}
