# Implementation Plan — Fase 3: Context Carry-Over + Keyboard Shortcut + Polish

> **Instruksi untuk AI di conversation baru:**
> Baca dokumen ini secara lengkap sebelum memulai implementasi.
> Baca juga `docs/prd.md` untuk konteks proyek. Fase 1 dan 2 harus sudah selesai.

---

## Prasyarat

Pastikan semua komponen dari Fase 1 dan 2 sudah berfungsi:
- ✅ Fase 1: Ekstraksi teks + Site Profile + Dry-Run bubble
- ✅ Fase 2: `autopilot.js` (loop controller), `EXECUTE_ACTION`, token budget, progress tracker

---

## Konteks Proyek

**Aku Malas AI** — ekstensi Chrome MV3, vanilla JS/HTML/CSS. Target: Oracle Academy.

### File yang Relevan untuk Fase 3

| File | Fungsi Saat Ini |
|---|---|
| `autopilot.js` | State machine + loop controller + event emitter |
| `api.js` | `sendToAIForAutopilot()` — sudah menerima parameter `chapterSummaries` tapi belum digunakan oleh autopilot |
| `manifest.json` | Konfigurasi MV3, belum ada `commands` |
| `background.js` | Handler pesan, belum ada listener shortcut |
| `sidepanel.js` | Integrasi UI Auto-Pilot |

---

## Tujuan Fase 3

1. **Context Carry-Over** — bawa ringkasan chapter sebelumnya ke request AI berikutnya agar jawaban lebih akurat.
2. **Keyboard Shortcut** — `Alt+Shift+A` untuk toggle Auto-Pilot tanpa klik.
3. **Polish** — update dokumentasi, test end-to-end di Oracle Academy.

---

## Perubahan Detail

### 1. [MODIFIKASI] `autopilot.js` — Context Carry-Over

#### Tambah state:
```javascript
let chapterSummaries = [];  // ["Ch1: Array — push, pop", "Ch2: Linked List — node, pointer", ...]
```

#### Di dalam loop, setelah AI memberikan keputusan:
```javascript
// Setelah setiap chapter selesai, ambil summary dari decision
if (decision.summary) {
  chapterSummaries.push(decision.summary);
}
```

#### Saat memanggil `sendToAIForAutopilot()`, pass `chapterSummaries`:
```javascript
const decision = await sendToAIForAutopilot({
  modelId,
  apiKey,
  pageContext: promptText,
  chapterSummaries,  // ← TAMBAH INI
});
```

> **Catatan:** `sendToAIForAutopilot()` di `api.js` sudah mendukung parameter `chapterSummaries` sejak Fase 1. Fungsi tersebut akan mem-prepend ringkasan sebagai konteks tambahan:
> ```
> === RINGKASAN CHAPTER SEBELUMNYA ===
> Ch1: Array — push, pop, shift, unshift
> Ch2: Linked List — node, pointer, traversal
> ```

#### Reset saat loop selesai atau dihentikan:
```javascript
function reset() {
  chapterSummaries = [];
  results = [];
  totalTokens = 0;
  count = 0;
}
```

#### Batasi ukuran carry-over:
Agar tidak terlalu banyak token, batasi `chapterSummaries` ke **10 entry terakhir**. Jika lebih, hapus yang paling awal:
```javascript
if (chapterSummaries.length > 10) {
  chapterSummaries = chapterSummaries.slice(-10);
}
```

---

### 2. [MODIFIKASI] `manifest.json` — Tambah Commands

Tambah key `commands` di root object:

```json
{
  "manifest_version": 3,
  "name": "Aku Malas AI — Sidebar Assistant",
  "version": "1.1.0",
  ...existing keys...,
  "commands": {
    "toggle-autopilot": {
      "suggested_key": {
        "default": "Alt+Shift+A"
      },
      "description": "Start/Stop Auto-Pilot"
    }
  }
}
```

> **Catatan:** Update version dari `1.0.0` ke `1.1.0` untuk menandai rilis Auto-Pilot.

---

### 3. [MODIFIKASI] `background.js` — Listener Keyboard Shortcut

Tambah di bagian atas (setelah `onInstalled`):

```javascript
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
```

---

### 4. [MODIFIKASI] `sidepanel.js` — Handle Shortcut Message

Tambah listener di `bindEvents()`:

```javascript
// Listen for keyboard shortcut forwarded from background
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "TOGGLE_AUTOPILOT") {
    handleAutoPilot();  // atau stop() jika sudah berjalan
  }
});
```

---

### 5. Polish — Update Dokumentasi

#### `README.md`
Tambah section baru di bawah fitur:
- ⚡ **Auto-Pilot Mode** — ekstrak teks, AI jawab quiz, otomatis submit & navigasi
- 🗂️ **Site Profile** — preset CSS selector per situs
- ⌨️ **Keyboard Shortcut** — `Alt+Shift+A`

#### `TUTORIAL.md`
Tambah bagian baru:
- **Bagian 11 — Auto-Pilot Mode**
  - Cara menggunakan Auto-Pilot
  - Cara setup Site Profile untuk Oracle Academy
  - Pengaturan Token Budget
  - Keyboard shortcut

---

## Verifikasi

### Test Cases
1. **Context carry-over:** Jalankan Auto-Pilot di 3+ chapter → periksa bahwa request ke-3 berisi ringkasan Ch1 dan Ch2
2. **Keyboard shortcut:** Tekan `Alt+Shift+A` → Auto-Pilot dimulai. Tekan lagi → Auto-Pilot berhenti
3. **Carry-over cap:** Jalankan 12+ chapter → pastikan hanya 10 ringkasan terakhir yang dikirim (cek di console log)

### End-to-End di Oracle Academy
1. Buka Oracle Academy → login → buka kursus
2. Setup site profile untuk hostname Oracle Academy dengan selector yang benar
3. Klik Auto-Pilot (atau `Alt+Shift+A`)
4. Dry-run → verifikasi jawaban benar → klik Eksekusi
5. Matikan Dry-Run → jalankan full-auto 5+ chapter
6. Pastikan:
   - Jawaban terpilih dengan benar
   - Submit berhasil
   - Navigasi ke chapter berikut berjalan
   - Progress bar update real-time
   - Token usage ter-track
   - Ringkasan akhir muncul dengan detail per-chapter
