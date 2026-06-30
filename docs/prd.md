# PRD — Auto-Pilot Mode (Aku Malas AI)

## 1. Latar Belakang

**Aku Malas AI** adalah ekstensi Chrome (Manifest V3) berupa asisten AI di side panel, dibangun dengan vanilla JS/HTML/CSS. Saat ini ekstensi mengandalkan **screenshot** untuk memberikan konteks halaman ke AI — pendekatan yang boros token dan lambat.

**Platform target utama: Oracle Academy** (platform e-learning untuk kursus Oracle).

## 2. Tujuan

Menambahkan mode **Auto-Pilot** yang:
1. **Mengekstrak teks** langsung dari DOM halaman (bukan screenshot) → hemat token ~10-50x.
2. **AI menganalisis** pertanyaan + opsi, memilih jawaban yang tepat.
3. **Mengeksekusi aksi** secara otomatis: klik jawaban, submit, navigasi ke chapter berikutnya.
4. **Loop otomatis** antar chapter sampai selesai atau user menghentikan.

## 3. Keputusan Desain

| Keputusan | Hasil |
|---|---|
| Mode eksekusi default | **Dry-Run** (preview dulu, user konfirmasi sebelum eksekusi) |
| Batasan chapter | Tidak ada hard limit. Tampilkan **notifikasi token usage** dan biarkan user set budget di Settings |
| Platform target | **Oracle Academy** — heuristik dan contoh site profile difokuskan ke sini |

## 4. Fitur yang Dibangun

### Core (3 Layer)
- **Layer 1 — Ekstraksi Teks:** Ambil konten, pertanyaan, opsi jawaban, tombol navigasi dari DOM.
- **Layer 2 — Keputusan AI:** Kirim teks terstruktur ke AI, terima instruksi JSON (jawaban + confidence).
- **Layer 3 — Eksekusi Aksi:** Klik opsi, submit, navigasi ke chapter berikutnya via `chrome.scripting`.

### Enhancement
- **Site Profile:** Preset CSS selector per domain (simpan sekali, pakai terus).
- **Dry-Run Mode:** Preview keputusan AI sebelum eksekusi.
- **Token Budget:** Estimasi & notifikasi penggunaan token, configurable di Settings.
- **Progress Tracker:** Bar + counter (benar/salah) selama loop berjalan.
- **Context Carry-Over:** Ringkasan chapter sebelumnya dibawa ke request berikutnya.
- **Keyboard Shortcut:** `Alt+Shift+A` untuk toggle Auto-Pilot.

## 5. Pembagian Fase

| Fase | Scope | Status |
|---|---|---|
| **Fase 1** | Ekstraksi teks + Site Profile + Dry-Run + UI dasar | ✅ Selesai |
| **Fase 2** | Eksekusi aksi + Auto-Pilot Loop + Token Budget + Progress Tracker | ⏳ Belum |
| **Fase 3** | Context Carry-Over + Keyboard Shortcut + Polish | ⏳ Belum |

## 6. Arsitektur

```
┌─────────────────────────────────────────────────────┐
│                   AUTO-PILOT MODE                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  ┌───────────┐   ┌───────────┐   ┌───────────────┐ │
│  │  LAYER 1  │──▶│  LAYER 2  │──▶│    LAYER 3    │ │
│  │ Ekstraksi │   │  Analisis  │   │ Eksekusi Aksi │ │
│  │   Teks    │   │  AI + Kepu-│   │ (Klik, Submit │ │
│  │ & Konteks │   │  tusan     │   │  & Navigasi)  │ │
│  └───────────┘   └───────────┘   └───────────────┘ │
│                                                     │
│  ◀─── Loop: ulangi untuk chapter/halaman berikut ──▶│
└─────────────────────────────────────────────────────┘
```

## 7. Struktur File Target (Setelah Semua Fase Selesai)

```
Aku Malas AI/
├── manifest.json            ← + commands (shortcut)
├── background.js            ← + EXTRACT_PAGE, EXECUTE_ACTION
├── sidepanel.html           ← + Auto-Pilot UI, progress bar
├── sidepanel.css            ← + styling Auto-Pilot
├── sidepanel.js             ← + Auto-Pilot handlers
├── api.js                   ← + sendToAIForAutopilot, token estimasi
├── extractor.js              ★ Ekstraksi DOM → teks
├── autopilot.js              ★ Loop controller + state machine
├── site-profiles.js          ★ CRUD preset selector per domain
├── lib/
│   └── markdown.js
├── docs/
│   ├── prd.md               ← dokumen ini
│   ├── tasks.md
│   ├── implementation-fase-1.md
│   ├── implementation-fase-2.md
│   ├── implementation-fase-3.md
│   ├── overview.md
│   └── feature-proposal.md
├── TUTORIAL.md
├── README.md
├── LICENSE
└── .gitignore
```

## 8. Catatan Teknis

- **Manifest V3** — semua scripting via `chrome.scripting.executeScript`, tidak ada content scripts persisten.
- **Tanpa framework/build tools** — vanilla JS, HTML, CSS saja.
- **API key** disimpan lokal di `chrome.storage.local` oleh user (bring-your-own-key).
- **Model yang didukung:** Gemini (3.1 Flash/Lite/Pro, 1.5), Claude 3.5, GPT-4o.
- **Gemini API** mendukung `responseMimeType: "application/json"` untuk output JSON yang reliable.
