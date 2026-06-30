/**
 * picker.js — Visual Element Picker
 * 
 * Injected into the active tab to allow the user to point and click
 * an element. Computes a unique CSS selector for the clicked element
 * and sends it back to the extension.
 */

(function initPicker() {
  // Prevent multiple injections
  if (window.__akuMalasPickerActive) return;
  window.__akuMalasPickerActive = true;

  // Create a highlight overlay element
  const overlay = document.createElement("div");
  overlay.style.position = "fixed";
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "9999999";
  overlay.style.border = "2px solid #ff6b81";
  overlay.style.backgroundColor = "rgba(255, 107, 129, 0.2)";
  overlay.style.transition = "all 0.1s ease-out";
  overlay.style.display = "none";
  document.body.appendChild(overlay);

  let currentTarget = null;

  function onMouseMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === document.body || el === document.documentElement) {
      overlay.style.display = "none";
      currentTarget = null;
      return;
    }
    
    currentTarget = el;
    const rect = el.getBoundingClientRect();
    overlay.style.display = "block";
    overlay.style.top = rect.top + "px";
    overlay.style.left = rect.left + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
  }

  function onClick(e) {
    if (!currentTarget) return;
    
    e.preventDefault();
    e.stopPropagation();

    const selector = generateSelector(currentTarget);
    
    // Clean up
    cleanup();

    // Send back to extension
    chrome.runtime.sendMessage({
      type: "PICKER_RESULT",
      selector: selector
    });
  }

  function cleanup() {
    window.__akuMalasPickerActive = false;
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClick, true);
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function generateSelector(el) {
    if (!el) return "";
    
    // 1. If it has an ID, that's usually unique enough
    if (el.id) {
      return `#${CSS.escape(el.id)}`;
    }

    // 2. Build a path
    const path = [];
    let current = el;
    
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && current !== document.documentElement) {
      let sel = current.nodeName.toLowerCase();
      
      if (current.id) {
        sel += `#${CSS.escape(current.id)}`;
        path.unshift(sel);
        break; // IDs are unique, we can stop here
      } else if (current.className && typeof current.className === 'string') {
        // Try to use classes, ignore utility-like or state classes if possible, but for simplicity we use all valid classes
        const classes = current.className.split(/\s+/).filter(c => c);
        if (classes.length > 0) {
          sel += `.${classes.map(c => CSS.escape(c)).join('.')}`;
        }
      }
      
      // If there are siblings with the same tag+class, we need nth-of-type
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.nodeName === current.nodeName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }
      
      if (index > 1) {
        sel += `:nth-of-type(${index})`;
      }
      
      path.unshift(sel);
      current = current.parentNode;
    }
    
    return path.join(" > ");
  }

  // Attach listeners in capture phase to intercept clicks before the page does
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);

  // Optional: Listen for Escape to cancel
  document.addEventListener("keydown", function onKey(e) {
    if (e.key === "Escape") {
      cleanup();
      document.removeEventListener("keydown", onKey, true);
    }
  }, true);

})();
