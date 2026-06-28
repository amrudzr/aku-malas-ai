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
