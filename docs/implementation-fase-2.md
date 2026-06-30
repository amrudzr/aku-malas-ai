# Implementation Plan — Fase 2: Eksekusi Aksi + Auto-Pilot Loop + Token Budget

> **Instruksi untuk AI di conversation baru:**
> Baca dokumen ini secara lengkap sebelum memulai implementasi.
> Baca juga `docs/prd.md` untuk konteks proyek dan `docs/implementation-fase-1.md`
> untuk memahami apa yang sudah ada. Jangan buat ulang yang sudah ada.

---

## Konteks Proyek

**Aku Malas AI** — ekstensi Chrome MV3, asisten AI sidebar, vanilla JS/HTML/CSS (tanpa framework/build tools). Target platform: **Oracle Academy**.

### Apa yang Sudah Ada (Fase 1)

File-file berikut sudah ada dan berisi kode dari Fase 1:

- `extractor.js` — ekstraksi DOM → teks terstruktur (konten, pertanyaan, opsi, aksi)
- `site-profiles.js` — CRUD preset selector per domain (`chrome.storage.local`)
- `background.js` — handler: `CAPTURE_VISIBLE`, `CAPTURE_FULL_PAGE`, `EXTRACT_PAGE`
- `api.js` — `sendToAI()` (chat biasa) + `sendToAIForAutopilot()` (JSON response)
- `sidepanel.html` — UI chat + tombol Auto-Pilot + toggle Dry-Run + Site Profile di Settings
- `sidepanel.js` — handler chat + `handleAutoPilot()` + `renderDryRunBubble()` + site profile handlers
- `sidepanel.css` — dark mode styling + Auto-Pilot button/toggle/bubble styling

### Kondisi Saat Ini

Saat user klik "⚡ Auto-Pilot": halaman diekstrak, dikirim ke AI, hasilnya ditampilkan sebagai dry-run bubble. **Tapi tombol Eksekusi/Skip/Stop di bubble masih DISABLED dan tidak melakukan apa-apa.** Loop otomatis belum ada.

---

## Tujuan Fase 2

1. **Mengaktifkan eksekusi aksi** — AI bisa klik jawaban, submit, dan navigasi next chapter.
2. **Auto-Pilot Loop** — loop otomatis: extract → decide → execute → wait → next → repeat.
3. **Token Budget** — estimasi penggunaan token per request, notifikasi saat mendekati budget, configurable di Settings.
4. **Progress Tracker** — bar + counter selama loop berjalan + ringkasan akhir.

---

## Perubahan Detail

### 1. [BARU] `autopilot.js` — State Machine + Loop Controller

Buat file baru `autopilot.js` sebagai ES module.

**State machine:**
```
IDLE → EXTRACTING → DECIDING → PREVIEWING → EXECUTING → WAITING_PAGE_CHANGE → (loop kembali ke EXTRACTING / DONE)
```

**Fungsi yang harus di-export:**

```javascript
// State & kontrol
export function start(options)    // options: { dryRun: boolean }
export function stop()            // hentikan loop
export function executeNow()      // dari PREVIEWING → EXECUTING (user klik "Eksekusi")
export function skipCurrent()     // dari PREVIEWING → WAITING → loop ke halaman berikut
export function getState()        // return state saat ini

// Event emitter sederhana (callback-based)
export function on(event, callback)
// Events: "stateChange", "progress", "error", "done", "tokenUpdate"
```

**Internal flow dalam `start()`:**
```javascript
async function runLoop() {
  while (state !== "IDLE") {
    setState("EXTRACTING");
    const context = await extractCurrentPage();  // kirim EXTRACT_PAGE ke background
    
    setState("DECIDING");
    const decision = await callAI(context);      // sendToAIForAutopilot
    updateTokenUsage(context, decision);          // hitung estimasi token
    
    if (dryRun) {
      setState("PREVIEWING");
      emit("preview", { decision, context });
      await waitForUserAction();  // tunggu user klik Eksekusi/Skip/Stop
      if (state === "IDLE") return;  // user klik Stop
      if (userSkipped) { /* lanjut tanpa eksekusi */ }
    }
    
    if (!userSkipped) {
      setState("EXECUTING");
      await executeActions(decision.actions);     // kirim EXECUTE_ACTION ke background
    }
    
    // Navigasi ke next page
    const nextAction = decision.actions?.find(a => a.type === "click" && /* is next button */);
    // atau detect dari context.actions type "next"
    
    setState("WAITING_PAGE_CHANGE");
    await waitForPageChange();  // poll document.title / URL sampai berubah
    await sleep(1500);          // beri waktu halaman load
    
    emit("progress", { completed: ++count, ... });
    
    // Cek token budget
    if (totalTokens >= tokenBudget) {
      emit("tokenWarning", { used: totalTokens, budget: tokenBudget });
      setState("PREVIEWING");  // pause, biarkan user memutuskan
      await waitForUserAction();
    }
  }
  emit("done", { results, totalTokens });
}
```

**Data yang diakumulasi selama loop:**
```javascript
const results = [];  // { chapter, question, answer, confidence, correct? }
let totalTokens = 0; // estimasi kumulatif
let count = 0;       // jumlah chapter yang diproses
```

**Dependency:** Module ini mengimpor dari `api.js` dan berkomunikasi dengan `background.js` via `chrome.runtime.sendMessage`.

---

### 2. [MODIFIKASI] `background.js` — Tambah Handler `EXECUTE_ACTION`

Tambah handler baru di message listener yang sudah ada:

```javascript
if (message?.type === "EXECUTE_ACTION") {
  executeAction(message.tabId, message.actions)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
}
```

**Fungsi `executeAction(tabId, actions)`:**
- Terima array instruksi: `[{ type, selector, value? }]`
- Eksekusi satu per satu di tab via `chrome.scripting.executeScript`
- Tipe aksi:
  - `"select"` → set `el.checked = true` + dispatch `change` event (untuk radio/checkbox). Untuk select dropdown, set `el.value` + dispatch `change`.
  - `"click"` → `el.click()`
  - `"fill"` → `el.value = value` + dispatch `input` event
- **Delay 400ms antar aksi** agar halaman sempat merender.
- Dispatch event dengan `new Event('change', { bubbles: true })` agar framework (React/Angular) mendeteksi perubahan.

**Fungsi `waitForPageChange(tabId, originalTitle, originalUrl, timeoutMs = 15000)`:**
- Poll `document.title` dan `location.href` setiap 500ms
- Return ketika salah satu berubah, atau throw jika timeout

---

### 3. [MODIFIKASI] `api.js` — Tambah Estimasi Token

Tambah fungsi ekspor baru:

```javascript
/**
 * Estimasi kasar jumlah token dari sebuah string.
 * Menggunakan aturan ~4 karakter = 1 token (rough average untuk bahasa campuran).
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
```

Fungsi ini dipanggil oleh `autopilot.js` untuk menghitung estimasi token per request (input prompt + output response).

---

### 4. [MODIFIKASI] `sidepanel.html`

#### A. Progress bar (tambah di atas `<main id="chatArea">`)
```html
<div id="autopilotStatus" class="autopilot-status hidden">
  <div class="ap-progress-bar">
    <div id="apProgressFill" class="ap-progress-fill" style="width: 0%"></div>
  </div>
  <div class="ap-status-text">
    <span id="apStatusLabel">Idle</span>
    <span id="apTokenUsage" class="ap-token-usage"></span>
  </div>
  <div class="ap-counters">
    <span class="ap-counter correct">✅ <span id="apCorrect">0</span></span>
    <span class="ap-counter warning">⚠️ <span id="apWarning">0</span></span>
    <span class="ap-counter error">❌ <span id="apFailed">0</span></span>
  </div>
  <button id="apStopBtn" class="ap-stop-btn" title="Stop Auto-Pilot">⏹ Stop</button>
</div>
```

#### B. Token Budget di Settings (tambah di modal, setelah System Prompt section)
```html
<section class="field-group">
  <label class="field-label">Token Budget (Auto-Pilot)</label>
  <p class="field-hint">Estimasi batas token per sesi. Notifikasi muncul saat mendekati batas. Kosongkan = tanpa batas.</p>
  <input id="tokenBudget" type="number" class="text-input" placeholder="50000" min="1000" step="1000" />
</section>
```

---

### 5. [MODIFIKASI] `sidepanel.css`

Tambah styling:

```css
/* ============ PROGRESS BAR ============ */
.autopilot-status {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  animation: rise 0.28s ease;
}
.ap-progress-bar {
  flex: 1;
  height: 6px;
  background: var(--surface-3);
  border-radius: 3px;
  overflow: hidden;
}
.ap-progress-fill {
  height: 100%;
  background: var(--grad);
  border-radius: 3px;
  transition: width 0.4s ease;
}
.ap-status-text {
  display: flex;
  flex-direction: column;
  font-size: 11px;
  color: var(--text-dim);
  font-weight: 500;
  min-width: 80px;
}
.ap-token-usage {
  font-size: 10px;
  color: var(--text-faint);
}
.ap-token-usage.warning { color: #ffc98a; }
.ap-token-usage.danger { color: var(--danger); }
.ap-counters {
  display: flex;
  gap: 8px;
  font-size: 11px;
}
.ap-stop-btn {
  background: transparent;
  border: 1px solid rgba(255, 107, 129, 0.35);
  color: var(--danger);
  padding: 4px 10px;
  border-radius: var(--radius-xs);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--trans);
}
.ap-stop-btn:hover { background: rgba(255, 107, 129, 0.1); }

/* Token warning notification */
.token-warning-bubble {
  background: linear-gradient(135deg, rgba(255, 201, 138, 0.1), rgba(255, 107, 129, 0.1));
  border: 1px solid rgba(255, 201, 138, 0.3);
  padding: 12px 14px;
  border-radius: var(--radius);
  font-size: 12.5px;
  line-height: 1.5;
}
```

---

### 6. [MODIFIKASI] `sidepanel.js`

Perubahan besar — ini adalah file integrasi utama:

#### A. Import tambahan
```javascript
import { start, stop, executeNow, skipCurrent, on } from "./autopilot.js";
import { estimateTokens } from "./api.js";
```

#### B. Element references tambahan
```javascript
const autopilotStatus = $("autopilotStatus");
const apProgressFill = $("apProgressFill");
const apStatusLabel = $("apStatusLabel");
const apTokenUsage = $("apTokenUsage");
const apCorrect = $("apCorrect");
const apWarning = $("apWarning");
const apFailed = $("apFailed");
const apStopBtn = $("apStopBtn");
const tokenBudgetInput = $("tokenBudget");
```

#### C. Token budget di settings flow
- Di `loadSettings()`: baca `settings.tokenBudget` → reflect ke `tokenBudgetInput.value`
- Di `handleSaveSettings()`: baca `tokenBudgetInput.value` → simpan ke `settings.tokenBudget`

#### D. Ubah `handleAutoPilot()` untuk menggunakan `autopilot.js`
Alih-alih menjalankan 1x extraction inline, sekarang panggil `start()` dari autopilot.js yang menjalankan loop.

#### E. Wire event dari autopilot ke UI
```javascript
on("stateChange", (state) => { apStatusLabel.textContent = state; });
on("progress", ({ completed, total, result }) => { /* update counters + progress bar */ });
on("preview", ({ decision, context }) => { renderDryRunBubble(decision, context); });
on("tokenUpdate", ({ used, budget }) => { /* update token display + check warning */ });
on("done", ({ results, totalTokens }) => { /* render ringkasan akhir */ });
```

#### F. Aktifkan tombol di dry-run bubble
Di `renderDryRunBubble()`, ubah tombol dari `disabled = true` menjadi fungsional:
- **▶ Eksekusi** → panggil `executeNow()`
- **⏭ Skip** → panggil `skipCurrent()`
- **⏹ Stop** → panggil `stop()`

#### G. Render ringkasan akhir
Saat menerima event `"done"`, tampilkan bubble chat berisi:
```
📊 Ringkasan Auto-Pilot
━━━━━━━━━━━━━━━━━━━━━━
Chapter diproses : 12
Jawaban dipilih  : 11
Confidence rendah: 1
Gagal            : 0
Token digunakan  : ~23,400

Detail:
1. Ch1: Array — [A] Push ✅ (high)
2. Ch2: Linked List — [C] Traverse ✅ (high)
...
```

---

## Urutan Implementasi yang Disarankan

1. `autopilot.js` (file baru — core logic)
2. `background.js` (tambah `EXECUTE_ACTION`)
3. `api.js` (tambah `estimateTokens`)
4. `sidepanel.html` (progress bar + token budget input)
5. `sidepanel.css` (styling progress + token warning)
6. `sidepanel.js` (integrasi semua komponen)
7. Verifikasi end-to-end

---

## Verifikasi

### Test Cases
1. **Single dry-run → Eksekusi:** Klik Auto-Pilot → dry-run muncul → klik Eksekusi → jawaban terpilih di halaman
2. **Single dry-run → Skip:** Klik Skip → lanjut ke chapter berikut tanpa memilih jawaban
3. **Full loop:** Matikan Dry-Run toggle → klik Auto-Pilot → loop berjalan otomatis 3+ chapter
4. **Stop di tengah:** Saat loop berjalan, klik Stop → loop berhenti
5. **Token warning:** Set budget 5000 → jalankan loop → notifikasi muncul saat mendekati 5000
6. **Ringkasan akhir:** Setelah loop selesai → bubble ringkasan muncul dengan counter benar

### Oracle Academy Specific
- Buka kursus Oracle Academy → navigasi ke halaman quiz
- Konfigurasi site profile untuk `academy.oracle.com` (atau subdomain yang sesuai) di Settings
- Jalankan Auto-Pilot → verifikasi ekstraksi pertanyaan + opsi benar
- Verifikasi submit + navigasi next chapter berjalan
