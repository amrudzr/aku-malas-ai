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

  if (message?.type === "INJECT_PICKER") {
    injectPicker()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message?.type === "COMPRESS_DOM") {
    compressDOMPage()
      .then((domString) => sendResponse({ ok: true, domString }))
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

/** Inject the picker script into the active tab. */
async function injectPicker() {
  const tab = await getActiveTab();
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["picker.js"]
  });
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

  const scriptResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    args: [profile],
    func: (profile) => {
      // --- Inline extraction logic (runs in page context) ---
      // We inline this because MV3 service workers cannot directly import
      // ES modules into the content-script context via executeScript.

      function cleanText(text) {
        return (text || "").replace(/\s+/g, " ").trim();
      }

      function cleanBlockText(text) {
        return (text || "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n\s*\n+/g, "\n\n")
          .trim();
      }

      function buildSelector(el, fallbackBase, index) {
        if (el.id) return `#${el.id}`;
        if (el.name && el.value) return `[name="${el.name}"][value="${el.value}"]`;
        
        // Very robust fallback: mark the element dynamically if it lacks id or name+value
        const uniqueId = el.getAttribute("data-am-id") || "am_opt_" + Math.random().toString(36).substr(2, 9);
        el.setAttribute("data-am-id", uniqueId);
        return `[data-am-id="${uniqueId}"]`;
      }

      function getOptionLabel(el) {
        if (el.id) {
          try {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return cleanText(label.textContent);
          } catch (e) {}
        }
        const parentLabel = el.closest("label");
        if (parentLabel) return cleanText(parentLabel.textContent);
        const next = el.nextSibling;
        if (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
          return cleanText(next.textContent);
        }
        const nextEl = el.nextElementSibling;
        if (nextEl && nextEl.textContent.trim()) {
          return cleanText(nextEl.textContent);
        }
        const parent = el.parentElement;
        if (parent) {
          const text = parent.textContent.replace(el.textContent || "", "").trim();
          if (text) return cleanText(text);
        }
        const container = el.closest("tr, li, .choice, .option, .answer");
        if (container) {
          const text = container.textContent.trim();
          if (text) return cleanText(text);
        }
        return el.value || "(no label)";
      }

      // --- Content ---
      function extractContent() {
        if (profile?.content) {
          const el = document.querySelector(profile.content);
          if (el) return cleanBlockText(el.innerText);
        }
        const candidates = [
          "article", "main", "[role='main']", ".content", ".materi",
          ".lesson-content", ".course-content", "#content",
          ".post-body", ".entry-content",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 50) return cleanBlockText(el.innerText);
        }
        return cleanBlockText(document.body?.innerText || "").slice(0, 15000);
      }

      // --- Question ---
      function extractQuestion() {
        if (profile?.question) {
          const el = document.querySelector(profile.question);
          if (el) return cleanBlockText(el.innerText);
        }
        const candidates = [
          ".question-text", ".quiz-question", ".soal", ".qtext",
          ".question", ".que .qtext", "legend", ".prompt", "[data-question]",
        ];
        for (const sel of candidates) {
          const el = document.querySelector(sel);
          if (el && el.innerText.trim().length > 5) return cleanBlockText(el.innerText);
        }
        return "";
      }

      // --- Options ---
      function detectOptions() {
        const options = [];
        if (profile?.options) {
          const els = document.querySelectorAll(profile.options);
          if (els.length > 0) {
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
        if (actions.length > 0) return actions;

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
        // Heuristic: text-based fallback for submit and next
        const submitTextPat = /submit|kirim|jawab/i;
        const nextPat = /next|lanjut|berikut|selanjutnya|continue|proceed|→|»|▶/i;
        const allBtns = document.querySelectorAll("a, button, input[type='button']");
        
        for (const btn of allBtns) {
          // Skip disabled buttons
          if (btn.disabled || btn.classList.contains("disabled")) continue;
          
          const text = (btn.textContent || btn.title || btn.value || btn.ariaLabel || "").trim();
          
          if (text.length > 0 && text.length < 60) {
            if (!actions.some(a => a.type === "submit") && submitTextPat.test(text)) {
              actions.push({ selector: buildSelector(btn, btn.tagName.toLowerCase(), 0), label: cleanText(text) || "Submit", type: "submit" });
            } else if (!actions.some(a => a.type === "next") && nextPat.test(text)) {
              actions.push({ selector: buildSelector(btn, btn.tagName.toLowerCase(), 0), label: cleanText(text) || "Next", type: "next" });
            }
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

  // Find the best frame that actually contains options or a question
  let bestResult = scriptResults[0]?.result || {};
  let maxScore = -1;
  
  for (const { result } of scriptResults) {
    if (!result) continue;
    let score = 0;
    if (result.question) score += 10;
    if (result.options?.length > 0) score += result.options.length;
    if (result.actions?.length > 0) score += result.actions.length;
    
    if (score > maxScore) {
      maxScore = score;
      bestResult = result;
    }
  }

  return bestResult;
}

/**
 * Execute an array of actions (e.g. clicks, selects) in the active tab.
 */
async function executeAction(tabId, actions) {
  if (!tabId) {
    const tab = await getActiveTab();
    tabId = tab.id;
  }

  const scriptResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
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
          if (el.tagName.toLowerCase() === "select") {
            el.value = action.value || el.options[el.selectedIndex]?.value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            // For radio/checkbox, clicking the label is much safer than clicking the hidden input
            let clickedLabel = false;
            if ((el.type === "radio" || el.type === "checkbox") && el.id) {
              try {
                const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                if (label) {
                  label.click();
                  clickedLabel = true;
                }
              } catch (e) {}
            }
            
            if (!clickedLabel) {
              const parentLabel = el.closest("label");
              if (parentLabel) {
                parentLabel.click();
                clickedLabel = true;
              }
            }

            if (!clickedLabel) {
              el.click();
            }

            // Fallback for radio/checkbox if click() didn't change the checked state
            if ((el.type === "radio" || el.type === "checkbox") && !el.checked) {
              el.checked = true;
              el.dispatchEvent(new Event("change", { bubbles: true }));
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
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
function waitForPageChange(tabId, originalTitle, originalUrl, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let intervalId;
    let originalContentSnippet = null;

    const check = async () => {
      if (Date.now() - startTime > timeoutMs) {
        clearInterval(intervalId);
        // Don't reject — just resolve so the loop continues (SPA might have changed content)
        resolve();
        return;
      }
      try {
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            // Grab a content "fingerprint": question text or first 200 chars of visible body text
            const qEls = document.querySelectorAll('.question-text, .quiz-question, .qtext, .question, legend, .prompt, [data-question]');
            let qText = '';
            for (const el of qEls) {
              if (el.innerText?.trim()) { qText = el.innerText.trim().slice(0, 200); break; }
            }
            // Fallback: grab body text snippet
            const bodySnippet = document.body?.innerText?.trim().slice(0, 300) || '';
            return {
              title: document.title,
              url: location.href,
              contentSnippet: qText || bodySnippet
            };
          }
        });
        
        // First call — capture the original content
        if (originalContentSnippet === null) {
          originalContentSnippet = result.contentSnippet;
          return; // Wait for next check
        }
        
        // Detect change: URL, title, OR content changed
        if (result.title !== originalTitle || result.url !== originalUrl || result.contentSnippet !== originalContentSnippet) {
          clearInterval(intervalId);
          resolve();
        }
      } catch (e) {
        // Tab might be closing or navigating, which implies change
        clearInterval(intervalId);
        resolve();
      }
    };

    intervalId = setInterval(check, 400);
  });
}

/**
 * Compress the active tab's DOM to a minified string for the auto-profiler.
 */
async function compressDOMPage() {
  const tab = await getActiveTab();

  const scriptResults = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    func: () => {
      function compress(node = document.body) {
        if (!node) return "";
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent.trim();
          if (!text) return "";
          return text.length > 30 ? text.substring(0, 30) + "..." : text;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return "";

        const tag = node.tagName.toLowerCase();
        const skipTags = ['script', 'style', 'svg', 'noscript', 'iframe', 'img', 'video', 'audio', 'canvas', 'meta', 'link'];
        if (skipTags.includes(tag)) return "";

        let attrs = "";
        const keepAttrs = ['id', 'class', 'name', 'type', 'role', 'data-value', 'aria-label'];
        for (const attr of node.attributes) {
          if (keepAttrs.includes(attr.name)) {
            attrs += ` ${attr.name}="${attr.value}"`;
          }
        }

        let childrenHtml = "";
        for (const child of node.childNodes) {
          childrenHtml += compress(child);
        }

        if (!childrenHtml && !attrs && (tag === 'div' || tag === 'span')) return "";
        if (!childrenHtml && attrs) return `<${tag}${attrs}/>`;
        return `<${tag}${attrs}>${childrenHtml}</${tag}>`;
      }
      return compress(document.body);
    }
  });

  // Combine DOM strings from all frames to ensure we don't miss anything
  let combinedDom = "";
  for (const { result } of scriptResults) {
    if (result) combinedDom += result + "\n";
  }

  return combinedDom.substring(0, 15000); // Prevent massive payloads
}
