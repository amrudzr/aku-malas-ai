/**
 * site-profiles.js — Per-domain selector presets (ES module)
 *
 * Manages saved CSS selector profiles for specific websites so that
 * the extractor can deterministically find content, questions, options,
 * and navigation elements without relying on heuristics.
 *
 * Data is stored in chrome.storage.local under key "sk_site_profiles".
 *
 * Profile schema:
 * {
 *   "hostname": {
 *     content:  "CSS selector for main content area",
 *     question: "CSS selector for question text",
 *     options:  "CSS selector for answer inputs/elements",
 *     submit:   "CSS selector for submit button",
 *     next:     "CSS selector for next-chapter button"
 *   }
 * }
 */

const STORAGE_KEY = "sk_site_profiles";

/**
 * Get the profile for a given hostname.
 * @param {string} hostname  e.g. "lms.example.com"
 * @returns {Promise<Object|null>}  The profile object or null if not found.
 */
export async function getProfile(hostname) {
  const all = await loadAll();
  return all[hostname] || null;
}

/**
 * Save or update a profile for a hostname.
 * @param {string} hostname
 * @param {Object} profile  { content?, question?, options?, submit?, next? }
 */
export async function saveProfile(hostname, profile) {
  const all = await loadAll();
  // Strip empty strings — only store selectors that are actually set.
  const cleaned = {};
  for (const [key, val] of Object.entries(profile)) {
    if (typeof val === "string" && val.trim()) {
      cleaned[key] = val.trim();
    }
  }
  if (Object.keys(cleaned).length === 0) {
    // If all fields are empty, remove the profile entirely.
    delete all[hostname];
  } else {
    all[hostname] = cleaned;
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
}

/**
 * Delete a profile for a hostname.
 * @param {string} hostname
 */
export async function deleteProfile(hostname) {
  const all = await loadAll();
  delete all[hostname];
  await chrome.storage.local.set({ [STORAGE_KEY]: all });
}

/**
 * List all saved profiles.
 * @returns {Promise<Object>}  { hostname: profile, ... }
 */
export async function listProfiles() {
  return loadAll();
}

/**
 * Get just the hostnames that have profiles.
 * @returns {Promise<string[]>}
 */
export async function listHostnames() {
  const all = await loadAll();
  return Object.keys(all);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function loadAll() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}
