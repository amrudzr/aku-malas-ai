# Task Breakdown — Auto-Pilot Mode

> Dokumen ini berisi checklist per fase. Setiap fase dirancang untuk dikerjakan
> di **conversation baru** yang terpisah. Baca file `implementation-fase-N.md`
> yang sesuai untuk konteks lengkap sebelum mulai.

---

## Fase 1 — Fondasi: Ekstraksi Teks + Site Profile + Dry-Run ✅

> **Status: SELESAI.** Implementasi sudah ada di codebase.
> Lihat `implementation-fase-1.md` untuk detail apa yang sudah dibangun.

- [x] Buat `extractor.js` — modul ekstraksi DOM → teks terstruktur
- [x] Buat `site-profiles.js` — CRUD preset selector per domain
- [x] Modifikasi `background.js` — tambah handler `EXTRACT_PAGE` + fungsi `extractPage()`
- [x] Modifikasi `api.js` — tambah `sendToAIForAutopilot()` + `AUTOPILOT_SYSTEM_PROMPT` + `callGeminiAutopilot()`
- [x] Modifikasi `sidepanel.html` — tambah tombol Auto-Pilot, toggle Dry-Run, section Site Profile di Settings
- [x] Modifikasi `sidepanel.js` — handler `handleAutoPilot()`, `renderDryRunBubble()`, handler site profile
- [x] Modifikasi `sidepanel.css` — styling Auto-Pilot button, dry-run toggle, dry-run bubble, site profile section

---

## Fase 2 — Eksekusi Aksi + Auto-Pilot Loop + Token Budget ✅

> **Status: SELESAI.**
> Baca `implementation-fase-2.md` sebelum memulai conversation baru.

- [x] Buat `autopilot.js` — state machine (IDLE → EXTRACTING → DECIDING → PREVIEWING → EXECUTING → WAITING → loop/DONE)
- [x] Modifikasi `background.js` — tambah handler `EXECUTE_ACTION` (eksekusi select/click/fill di tab aktif)
- [x] Modifikasi `sidepanel.html` — tambah progress bar, status text, tombol Stop, field Token Budget di Settings
- [x] Modifikasi `sidepanel.css` — styling progress bar, status indicator, token warning
- [x] Modifikasi `sidepanel.js`:
  - [x] Import dan integrasi `autopilot.js`
  - [x] Aktifkan tombol Eksekusi/Skip/Stop di dry-run bubble
  - [x] Wire progress events ke UI
  - [x] Render ringkasan akhir saat loop selesai
  - [x] Estimasi token usage + notifikasi saat mendekati budget
- [x] Modifikasi `api.js` — tambah fungsi estimasi token (`estimateTokens()`)
- [x] Verifikasi:
  - [x] Dry-run → klik Eksekusi → jawaban terpilih + submit berhasil
  - [x] Loop berjalan antar chapter (next → extract → decide → execute → repeat)
  - [x] Tombol Stop menghentikan loop
  - [x] Token budget warning muncul saat mendekati batas
  - [x] Ringkasan akhir ditampilkan setelah loop selesai

---

## Fase 3 — Context Carry-Over + Keyboard Shortcut + Polish ✅

> **Status: SELESAI.**
> Baca `implementation-fase-3.md` sebelum memulai conversation baru.

- [x] Modifikasi `autopilot.js` — tambah array `chapterSummaries[]`, inject ke konteks per iterasi
- [x] Modifikasi `manifest.json` — tambah `commands` untuk keyboard shortcut
- [x] Modifikasi `background.js` — tambah listener `chrome.commands.onCommand`
- [x] Polish:
  - [x] Test end-to-end di Oracle Academy (3+ chapter berturut-turut)
  - [x] Pastikan context carry-over meningkatkan akurasi
  - [x] Pastikan shortcut `Alt+Shift+A` toggle Auto-Pilot
  - [x] Update README.md dan TUTORIAL.md dengan dokumentasi fitur baru
