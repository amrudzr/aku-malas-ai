/**
 * extractor.js — DOM text extraction module (ES module)
 *
 * Provides functions that run inside a content-script context
 * (via chrome.scripting.executeScript) to extract structured text
 * from the active page: content, questions, answer options, and
 * navigation actions.
 *
 * When a Site Profile is available, deterministic CSS selectors are
 * used. Otherwise, generic heuristics scan the DOM.
 */

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

/**
 * Extract structured page context.
 * @param {Object|null} profile  Site profile with CSS selectors, or null for heuristic mode.
 * @returns {Object} Structured context object.
 */
export function extractPageContext(profile) {
  const root = document;

  const context = {
    title: document.title || "",
    url: location.href,
    hostname: location.hostname,
    content: extractContent(root, profile),
    question: extractQuestion(root, profile),
    options: detectOptions(root, profile),
    actions: detectActions(root, profile),
  };

  return context;
}

/**
 * Convert a context object into a formatted prompt string for the AI.
 * @param {Object} context  Output of extractPageContext().
 * @returns {string}
 */
export function buildPromptText(context) {
  const lines = [];

  lines.push("=== KONTEKS HALAMAN ===");
  lines.push(`Judul: ${context.title}`);
  lines.push(`URL: ${context.url}`);
  lines.push("");

  if (context.content) {
    lines.push("=== KONTEN UTAMA ===");
    lines.push(context.content);
    lines.push("");
  }

  if (context.question) {
    lines.push("=== PERTANYAAN ===");
    lines.push(context.question);
    lines.push("");
  }

  if (context.options.length > 0) {
    lines.push("=== OPSI TERSEDIA ===");
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    context.options.forEach((opt, i) => {
      const letter = labels[i] || String(i + 1);
      lines.push(`[${letter}] ${opt.label}${opt.value ? ` (value: ${opt.value})` : ""}`);
    });
    lines.push("");
  }

  if (context.actions.length > 0) {
    lines.push("=== AKSI TERSEDIA ===");
    context.actions.forEach((act) => {
      const tag = act.type.toUpperCase().padEnd(8);
      lines.push(`[${tag}] ${act.label} (selector: ${act.selector})`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Content extraction
// ---------------------------------------------------------------------------

function extractContent(root, profile) {
  if (profile?.content) {
    const el = root.querySelector(profile.content);
    return el ? cleanBlockText(el.innerText) : "";
  }
  // Heuristic: try common content containers in priority order.
  const candidates = [
    "article",
    "main",
    "[role='main']",
    ".content",
    ".materi",
    ".lesson-content",
    ".course-content",
    "#content",
    ".post-body",
    ".entry-content",
  ];
  for (const sel of candidates) {
    const el = root.querySelector(sel);
    if (el && el.innerText.trim().length > 50) {
      return cleanBlockText(el.innerText);
    }
  }
  // Fallback: body text (truncated). Expand truncation limit because we preserve newlines.
  const body = root.body?.innerText || "";
  return cleanBlockText(body).slice(0, 15000);
}

// ---------------------------------------------------------------------------
// Question extraction
// ---------------------------------------------------------------------------

function extractQuestion(root, profile) {
  if (profile?.question) {
    const el = root.querySelector(profile.question);
    return el ? cleanBlockText(el.innerText) : "";
  }
  // Heuristic: look for question-like elements.
  const candidates = [
    ".question-text",
    ".quiz-question",
    ".soal",
    ".qtext",            // Moodle
    ".question",
    ".que .qtext",       // Moodle
    "legend",            // common in form-based quizzes
    ".prompt",
    "[data-question]",
  ];
  for (const sel of candidates) {
    const el = root.querySelector(sel);
    if (el && el.innerText.trim().length > 5) {
      return cleanBlockText(el.innerText);
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Options detection
// ---------------------------------------------------------------------------

/**
 * Find all selectable options (radio, checkbox, select, clickable answer divs).
 * @returns {Array<{selector: string, label: string, value: string, type: string, index: number}>}
 */
export function detectOptions(root, profile) {
  const options = [];

  if (profile?.options) {
    const els = root.querySelectorAll(profile.options);
    els.forEach((el, i) => {
      options.push({
        selector: buildSelector(el, profile.options, i),
        label: getOptionLabel(el),
        value: el.value || el.dataset.value || "",
        type: el.type || el.tagName.toLowerCase(),
        index: i,
      });
    });
    return options;
  }

  // Heuristic: find form inputs that look like quiz answers.
  // 1. Radio buttons in forms
  const radios = root.querySelectorAll('input[type="radio"]');
  if (radios.length > 0) {
    radios.forEach((radio, i) => {
      options.push({
        selector: buildSelector(radio, 'input[type="radio"]', i),
        label: getOptionLabel(radio),
        value: radio.value || "",
        type: "radio",
        index: i,
      });
    });
    return options;
  }

  // 2. Checkboxes in forms
  const checkboxes = root.querySelectorAll('input[type="checkbox"]');
  if (checkboxes.length >= 2) {
    checkboxes.forEach((cb, i) => {
      options.push({
        selector: buildSelector(cb, 'input[type="checkbox"]', i),
        label: getOptionLabel(cb),
        value: cb.value || "",
        type: "checkbox",
        index: i,
      });
    });
    return options;
  }

  // 3. Clickable answer containers (common in modern LMS)
  const answerContainers = [
    ".answer-option",
    ".choice",
    ".option",
    ".answer",
    "[data-answer]",
    ".multichoice .answer div",
  ];
  for (const sel of answerContainers) {
    const els = root.querySelectorAll(sel);
    if (els.length >= 2) {
      els.forEach((el, i) => {
        options.push({
          selector: buildSelector(el, sel, i),
          label: cleanText(el.innerText),
          value: el.dataset.value || el.dataset.answer || "",
          type: "clickable",
          index: i,
        });
      });
      return options;
    }
  }

  // 4. Select dropdowns
  const selects = root.querySelectorAll("select");
  selects.forEach((select) => {
    const selectOptions = select.querySelectorAll("option");
    selectOptions.forEach((opt, i) => {
      if (opt.value && opt.value !== "") {
        options.push({
          selector: buildSelector(opt, "option", i),
          label: cleanText(opt.textContent),
          value: opt.value,
          type: "select-option",
          index: i,
          parentSelector: buildSelector(select, "select", 0),
        });
      }
    });
  });

  return options;
}

// ---------------------------------------------------------------------------
// Action detection
// ---------------------------------------------------------------------------

/**
 * Find submit, next, and navigation buttons.
 * @returns {Array<{selector: string, label: string, type: string}>}
 */
export function detectActions(root, profile) {
  const actions = [];

  // Profile-defined actions
  if (profile?.submit) {
    const el = root.querySelector(profile.submit);
    if (el) {
      actions.push({
        selector: profile.submit,
        label: cleanText(el.textContent) || "Submit",
        type: "submit",
      });
    }
  }
  if (profile?.next) {
    const el = root.querySelector(profile.next);
    if (el) {
      actions.push({
        selector: profile.next,
        label: cleanText(el.textContent) || "Next",
        type: "next",
      });
    }
  }
  if (profile?.submit || profile?.next) return actions;

  // Heuristic: find submit buttons
  const submitCandidates = [
    'button[type="submit"]',
    'input[type="submit"]',
    ".submit-btn",
    "#submitBtn",
    "#submit",
    ".btn-submit",
    ".check-answer",
  ];
  for (const sel of submitCandidates) {
    const el = root.querySelector(sel);
    if (el) {
      actions.push({
        selector: sel,
        label: cleanText(el.textContent || el.value) || "Submit",
        type: "submit",
      });
      break;
    }
  }

  // Heuristic: find "next" / navigation buttons
  const allButtons = root.querySelectorAll("a, button");
  const nextPatterns = /next|lanjut|berikut|selanjutnya|continue|proceed|→|»|▶/i;
  for (const btn of allButtons) {
    const text = (btn.textContent || btn.title || btn.ariaLabel || "").trim();
    if (nextPatterns.test(text) && text.length < 60) {
      actions.push({
        selector: buildSelector(btn, btn.tagName.toLowerCase(), 0),
        label: cleanText(text) || "Next",
        type: "next",
      });
      break;
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Build a reasonably unique CSS selector for an element. */
function buildSelector(el, fallbackBase, index) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) return `[name="${CSS.escape(el.name)}"]`;
  // Use nth-of-type with the fallback base selector.
  return `${fallbackBase}:nth-of-type(${index + 1})`;
}

/** Get a human-readable label for a form input. */
function getOptionLabel(el) {
  // 1. Check for an associated <label>
  if (el.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return cleanText(label.textContent);
    } catch (e) {}
  }
  // 2. Check parent <label>
  const parentLabel = el.closest("label");
  if (parentLabel) return cleanText(parentLabel.textContent);
  // 3. Check next sibling text
  const next = el.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE && next.textContent.trim()) {
    return cleanText(next.textContent);
  }
  // 3b. Check next element sibling
  const nextEl = el.nextElementSibling;
  if (nextEl && nextEl.textContent.trim()) {
    return cleanText(nextEl.textContent);
  }
  // 4. Check parent container text
  const parent = el.parentElement;
  if (parent) {
    const text = parent.textContent.replace(el.textContent || "", "").trim();
    if (text) return cleanText(text);
  }
  // 5. Extended fallback for table rows, list items, etc.
  const container = el.closest("tr, li, .choice, .option, .answer");
  if (container) {
    const text = container.textContent.trim();
    if (text) return cleanText(text);
  }
  return el.value || "(no label)";
}

/** Clean whitespace from short extracted text (labels, single lines). */
function cleanText(text) {
  return (text || "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Clean text but preserve structural newlines (useful for content and questions). */
function cleanBlockText(text) {
  return (text || "")
    .replace(/[ \t]+/g, " ")         // Collapse horizontal whitespace
    .replace(/\n\s*\n+/g, "\n\n")    // Collapse multiple newlines into max double newlines
    .trim();
}

// ---------------------------------------------------------------------------
// Auto-Profiler Helpers
// ---------------------------------------------------------------------------

/**
 * Minify the DOM tree by removing heavy tags, large text nodes, and keeping only structure and useful attributes.
 * Useful to send to the AI for selector auto-discovery without exceeding token limits.
 * @param {Element|Document} rootNode - the node to compress, typically document.body
 * @returns {string} - a minified HTML representation
 */
export function compressDOM(node = document.body) {
  if (!node) return "";

  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (!text) return "";
    return text.length > 30 ? text.substring(0, 30) + "..." : text;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tag = node.tagName.toLowerCase();
  
  // Skip heavy or non-visual elements
  const skipTags = ['script', 'style', 'svg', 'noscript', 'iframe', 'img', 'video', 'audio', 'canvas', 'meta', 'link'];
  if (skipTags.includes(tag)) {
    return "";
  }

  let attrs = "";
  const keepAttrs = ['id', 'class', 'name', 'type', 'role', 'data-value', 'aria-label'];
  for (const attr of node.attributes) {
    if (keepAttrs.includes(attr.name)) {
      attrs += ` ${attr.name}="${attr.value}"`;
    }
  }

  let childrenHtml = "";
  for (const child of node.childNodes) {
    childrenHtml += compressDOM(child);
  }

  // Optimize: Skip empty structural divs to save tokens
  if (!childrenHtml && !attrs && (tag === 'div' || tag === 'span')) {
    return "";
  }

  // If node has no children but has attributes, represent as self-closing
  if (!childrenHtml && attrs) {
    return `<${tag}${attrs}/>`;
  }

  return `<${tag}${attrs}>${childrenHtml}</${tag}>`;
}
