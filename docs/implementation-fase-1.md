# Implementation Plan — Fase 1 (SELESAI)

> **Status: SUDAH DIIMPLEMENTASI.** Dokumen ini sebagai referensi apa yang sudah
> dibangun. Tidak perlu dikerjakan lagi kecuali ada bug atau perubahan.

## Konteks

Fase 1 membangun pipeline inti Auto-Pilot: ekstraksi teks dari DOM, keputusan AI
berbasis JSON, dan preview dry-run — tanpa eksekusi otomatis.

## Apa yang Sudah Dibangun

### File Baru

| File | Ukuran | Fungsi |
|---|---|---|
| `extractor.js` | ~10.5 KB | Ekstraksi DOM → teks terstruktur. Dua mode: heuristik (generic) dan profile (per-domain selector). Mendeteksi konten utama, pertanyaan, opsi jawaban (radio/checkbox/select/clickable), dan tombol aksi (submit/next). |
| `site-profiles.js` | ~2.6 KB | CRUD preset selector per domain. Fungsi: `getProfile()`, `saveProfile()`, `deleteProfile()`, `listProfiles()`. Data di `chrome.storage.local` key `sk_site_profiles`. |

### File yang Dimodifikasi

| File | Perubahan |
|---|---|
| `background.js` | +handler `EXTRACT_PAGE` + fungsi `extractPage()` yang inline extraction logic ke content-script context |
| `api.js` | +`AUTOPILOT_SYSTEM_PROMPT` + `sendToAIForAutopilot()` + `callGeminiAutopilot()` (JSON response via `responseMimeType`) |
| `sidepanel.html` | +tombol ⚡ Auto-Pilot, +toggle Dry-Run, +section Site Profile di Settings modal |
| `sidepanel.js` | +`handleAutoPilot()`, +`renderDryRunBubble()`, +`buildPromptFromContext()`, +handler site profile |
| `sidepanel.css` | +styling autopilot-btn, dry-run-toggle, dry-run-bubble, dr-confidence badges, site-profile-section |

## Alur Fase 1

```
User klik "⚡ Auto-Pilot"
  → ambil hostname tab aktif
  → cek site profile untuk hostname
  → kirim EXTRACT_PAGE ke background.js (dengan profile jika ada)
  → background.js executeScript di tab → return konteks terstruktur
  → format konteks menjadi prompt teks
  → kirim ke sendToAIForAutopilot() → AI return JSON
  → render dry-run bubble di chat (pertanyaan, jawaban, alasan, confidence)
  → tombol Eksekusi/Skip/Stop ditampilkan tapi DISABLED (Fase 2)
```
