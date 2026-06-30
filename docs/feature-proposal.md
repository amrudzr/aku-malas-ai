# Feature Proposal: Auto-Pilot Mode — Ekstraksi Teks & Automasi Aksi

## Ringkasan Masalah

Saat ini, ekstensi **Aku Malas AI** mengandalkan **tangkapan layar (screenshot)** untuk memberikan konteks halaman ke AI. Pendekatan ini memiliki dua kelemahan utama:

| Aspek | Screenshot (Saat Ini) | Ekstraksi Teks (Diusulkan) |
|---|---|---|
| **Konsumsi Token** | Sangat boros — satu gambar ≈ ratusan hingga ribuan token | Sangat hemat — hanya teks relevan yang dikirim |
| **Kecepatan** | Lambat — perlu scroll, capture, stitch, encode | Cepat — `innerText` / DOM parsing instan |
| **Akurasi** | Bergantung resolusi & OCR model | Teks asli, 100% akurat |
| **Interaksi** | Tidak bisa — AI hanya "melihat" | Bisa — AI tahu struktur DOM & elemen interaktif |

---

## Arsitektur Fitur yang Diusulkan

Fitur baru ini terdiri dari **tiga lapisan** yang bekerja secara berurutan:

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

---

## Layer 1 — Ekstraksi Teks & Konteks Halaman

**Tujuan:** Menggantikan (atau melengkapi) screenshot dengan ekstraksi teks langsung dari DOM, sehingga penggunaan token jauh lebih efisien.

### Apa yang diekstrak:

| Data | Cara Ekstraksi | Kegunaan |
|---|---|---|
| **Teks konten utama** | `document.body.innerText` atau selector spesifik (misal `article`, `.content`) | Memberi AI konteks isi halaman |
| **Judul halaman** | `document.title` + `<h1>` | Identifikasi topik/chapter |
| **Pertanyaan** | Selector seperti `.question`, `form label`, elemen quiz | AI tahu soal apa yang ditanyakan |
| **Opsi jawaban** | Semua `<input type="radio">`, `<input type="checkbox">`, `<select>`, `<button>` dalam konteks form | AI tahu pilihan apa saja yang tersedia |
| **Metadata navigasi** | Tombol "Next", "Submit", "Lanjut", pagination | AI tahu cara berpindah halaman |

### Format output ke AI:

```
=== KONTEKS HALAMAN ===
Judul: Bab 3 — Struktur Data Array
URL: https://lms.example.com/course/chapter-3

=== KONTEN UTAMA ===
Array adalah struktur data yang menyimpan kumpulan elemen...
[... teks konten ...]

=== PERTANYAAN ===
Manakah yang BUKAN merupakan operasi dasar pada array?

=== OPSI TERSEDIA ===
[A] Push — menambah elemen di akhir
[B] Pop — menghapus elemen di akhir  
[C] Compile — mengkompilasi array
[D] Shift — menghapus elemen di awal

=== AKSI TERSEDIA ===
[SUBMIT] Tombol "Kirim Jawaban" (selector: #submitBtn)
[NEXT]   Tombol "Chapter Berikutnya →" (selector: .next-chapter)
```

> **Mengapa format ini?** AI menerima teks terstruktur alih-alih gambar. Ini ~10-50x lebih hemat token dibanding screenshot, dan AI bisa "menunjuk" opsi secara eksplisit.

---

## Layer 2 — Analisis AI & Pengambilan Keputusan

**Tujuan:** AI menerima konteks terstruktur dari Layer 1, lalu mengembalikan instruksi aksi yang jelas dan dapat dieksekusi.

### System Prompt Khusus untuk Auto-Pilot:

```
Kamu adalah asisten automasi halaman web. Kamu akan menerima konteks
halaman berupa teks, pertanyaan, dan daftar opsi.

Tugasmu:
1. Baca dan pahami konten halaman.
2. Jika ada pertanyaan, tentukan jawaban yang paling tepat.
3. Kembalikan instruksi aksi dalam format JSON berikut:

{
  "reasoning": "Penjelasan singkat mengapa memilih jawaban ini",
  "actions": [
    { "type": "select", "selector": "#option-c", "value": "C" },
    { "type": "click", "selector": "#submitBtn" }
  ],
  "next": { "type": "click", "selector": ".next-chapter" }
}

Jika tidak yakin, set "confidence" ke "low" dan jangan eksekusi.
```

### Alur Keputusan AI:

```
Konteks masuk
    │
    ├─▶ Ada pertanyaan + opsi?
    │       ├─ Ya  → Analisis → Pilih jawaban → Return actions
    │       └─ Tidak → Ringkas halaman / laporkan status
    │
    └─▶ Confidence level?
            ├─ High (>80%) → Eksekusi otomatis
            ├─ Medium       → Tampilkan ke user, minta konfirmasi
            └─ Low          → Tampilkan peringatan, JANGAN eksekusi
```

---

## Layer 3 — Eksekusi Aksi di Halaman

**Tujuan:** Mengeksekusi instruksi dari AI pada halaman yang aktif melalui `chrome.scripting.executeScript`.

### Tipe Aksi yang Didukung:

| Tipe Aksi | Deskripsi | Implementasi |
|---|---|---|
| `select` | Memilih radio button / checkbox / dropdown | Set `.checked = true` atau `.value`, trigger `change` event |
| `click` | Mengklik tombol (Submit, Next, dll.) | `element.click()` |
| `fill` | Mengisi input teks | Set `.value`, trigger `input` event |
| `wait` | Menunggu elemen muncul (untuk halaman SPA/AJAX) | `MutationObserver` atau polling `querySelector` |
| `scroll` | Scroll ke elemen tertentu | `element.scrollIntoView()` |

### Mekanisme Keamanan:

- **Konfirmasi sebelum aksi destruktif** — AI tidak boleh submit tanpa persetujuan user (kecuali mode full-auto aktif).
- **Delay antar aksi** — Jeda kecil (~300-500ms) agar halaman sempat merender respons.
- **Deteksi perubahan halaman** — Setelah klik "Next", tunggu hingga DOM berubah sebelum memulai ekstraksi ulang.
- **Tombol darurat STOP** — User bisa menghentikan loop kapan saja.

---

## Alur Lengkap: Auto-Pilot Loop

```
[User klik "▶ Auto-Pilot"]
        │
        ▼
┌─ STEP 1: Ekstrak teks & konteks dari halaman aktif ◄───────┐
│       │                                                      │
│       ▼                                                      │
│  STEP 2: Kirim konteks ke AI (teks saja, tanpa gambar)      │
│       │                                                      │
│       ▼                                                      │
│  STEP 3: AI menganalisis → return JSON instruksi aksi       │
│       │                                                      │
│       ▼                                                      │
│  STEP 4: Validasi confidence                                │
│       ├─ High → Eksekusi otomatis                           │
│       └─ Low  → Pause, tampilkan ke user                    │
│       │                                                      │
│       ▼                                                      │
│  STEP 5: Eksekusi aksi (select jawaban → submit)            │
│       │                                                      │
│       ▼                                                      │
│  STEP 6: Tunggu halaman berubah (next chapter loaded)       │
│       │                                                      │
│       ▼                                                      │
│  STEP 7: Cek — masih ada chapter/halaman berikutnya?        │
│       ├─ Ya  → Loop kembali ke STEP 1 ──────────────────────┘
│       └─ Tidak → Selesai ✅
│
└─ [User bisa tekan "⏹ Stop" kapan saja untuk menghentikan]
```

---

## Perbandingan: Sebelum vs Sesudah

| Aspek | Sebelum (Screenshot) | Sesudah (Auto-Pilot) |
|---|---|---|
| Input ke AI | Gambar PNG/JPEG (besar) | Teks terstruktur (kecil) |
| Token per halaman | ~1.000 – 5.000 token | ~100 – 500 token |
| Kecepatan per halaman | ~3-8 detik (scroll + capture + upload) | ~1-2 detik (extract + API call) |
| Interaksi | Manual — user harus baca & klik sendiri | Otomatis — AI pilih jawaban & klik |
| Skenario multi-chapter | User harus ulangi per halaman | Loop otomatis sampai selesai |

---

## Dampak pada Struktur Kode

### File Baru:

| File | Tanggung Jawab |
|---|---|
| `extractor.js` | Logika ekstraksi DOM → teks terstruktur (Layer 1) |
| `autopilot.js` | Pengontrol loop Auto-Pilot, parsing respons AI, manajemen state (Layer 2 + 3) |

### File yang Dimodifikasi:

| File | Perubahan |
|---|---|
| `manifest.json` | (Mungkin) tambah permission jika diperlukan |
| `background.js` | Tambah message handler baru: `EXTRACT_PAGE`, `EXECUTE_ACTION` |
| `sidepanel.html` | Tambah tombol "Auto-Pilot" dan indikator status loop |
| `sidepanel.js` | Integrasi UI Auto-Pilot, status, dan tombol stop |
| `sidepanel.css` | Styling untuk komponen Auto-Pilot baru |
| `api.js` | Tambah mode respons JSON (system prompt khusus Auto-Pilot) |

### Struktur Proyek Setelah Perubahan:

```
Aku Malas AI/
├── manifest.json
├── background.js        ← + handler EXTRACT_PAGE, EXECUTE_ACTION
├── sidepanel.html       ← + UI Auto-Pilot
├── sidepanel.css        ← + styling Auto-Pilot
├── sidepanel.js         ← + integrasi Auto-Pilot
├── api.js               ← + mode JSON response
├── extractor.js          ★ BARU — ekstraksi DOM ke teks
├── autopilot.js          ★ BARU — pengontrol loop automasi
├── lib/
│   └── markdown.js
├── docs/
│   ├── overview.md
│   └── feature-proposal.md  ← dokumen ini
├── TUTORIAL.md
├── README.md
├── LICENSE
└── .gitignore
```

---

## Catatan Implementasi

1. **Prioritaskan teks, screenshot sebagai fallback.** Untuk halaman yang kontennya sebagian besar berupa gambar (infografis, diagram), screenshot masih berguna. Tapi untuk halaman teks biasa & quiz, ekstraksi teks sudah cukup.

2. **JSON response dari AI.** Agar Layer 3 bisa parsing instruksi dengan andal, AI harus mengembalikan respons dalam format JSON yang ketat. Gunakan fitur `response_mime_type: "application/json"` di Gemini API atau instruksi di system prompt.

3. **Selector harus robust.** Selector CSS yang dihasilkan Layer 1 perlu cukup spesifik agar tidak salah target. Gunakan kombinasi `id`, `name`, `data-*`, atau `nth-child` sebagai fallback.

4. **Rate limiting.** Jangan terlalu agresif saat looping (delay minimal 1-2 detik antar chapter) agar tidak memicu proteksi anti-bot pada platform target.

---

## Fitur Tambahan (High-Impact, Low-Effort)

Berikut lima peningkatan yang memberikan dampak besar dengan usaha implementasi minimal, karena memanfaatkan arsitektur yang sudah dirancang di atas.

---

### Enhancement 1 — 🗂️ Site Profile (Preset Selector per Situs)

**Masalah:** Tanpa panduan, AI harus "menebak" struktur DOM setiap kali halaman diekstrak. Ini lambat dan rawan salah target.

**Solusi:** Simpan peta CSS selector per domain di `chrome.storage.local`. User cukup setup sekali per situs, lalu semua chapter di situs itu langsung akurat.

```json
{
  "lms.example.com": {
    "content": ".materi-content",
    "question": ".soal-text",
    "options": ".pilihan-jawaban input[type=radio]",
    "submit": "#btnSubmit",
    "next": ".btn-next-chapter"
  }
}
```

**Cara kerja:**
1. Saat Auto-Pilot dimulai, `extractor.js` cek apakah ada profile untuk `location.hostname` saat ini.
2. Jika ada → gunakan selector langsung (deterministik, instan).
3. Jika tidak ada → fallback ke ekstraksi generik (heuristik DOM).
4. User bisa menambah/mengedit profile dari panel Settings.

**Effort:** ~30 baris kode + 1 section kecil di Settings modal.

---

### Enhancement 2 — 👁️ Dry-Run Mode (Preview Sebelum Eksekusi)

**Masalah:** User belum percaya bahwa AI akan memilih jawaban yang benar dan takut auto-pilot salah klik.

**Solusi:** Tambahkan toggle "Dry-Run" yang menjalankan Layer 1 dan Layer 2, tapi **menampilkan hasilnya di chat** alih-alih langsung mengeksekusi. User memutuskan sendiri apakah mau lanjut.

```
🔍 Dry-Run — Chapter 3: Struktur Data Array

  Pertanyaan : Manakah yang BUKAN operasi dasar array?
  Jawaban AI : [C] Compile — mengkompilasi array
  Alasan     : "Compile adalah istilah kompilasi kode, bukan operasi array..."
  Confidence : 95%

  [▶ Eksekusi]    [⏭ Skip]    [⏹ Stop]
```

**Cara kerja:** Secara teknis, ini hanya **menghilangkan Step 5-6 dari Auto-Pilot Loop** dan menampilkan output Step 3 ke user sebagai bubble chat interaktif. Hampir nol kode baru — hanya branching sederhana di `autopilot.js`.

**Effort:** ~15 baris logic tambahan.

---

### Enhancement 3 — 📊 Progress Tracker + Ringkasan Akhir

**Masalah:** Selama Auto-Pilot berjalan, user tidak tahu sudah sampai mana, berapa yang benar, dan hasilnya apa.

**Solusi:** Tampilkan progress bar kecil di atas chat area selama loop berjalan:

```
━━━━━━━━━━━━━━━━━━━━ 12/20 chapters
✅ 11 benar  ⚠️ 1 confidence rendah  ❌ 0 gagal
```

Di akhir sesi, auto-generate satu bubble chat ringkasan berisi semua jawaban yang dipilih.

**Cara kerja:** Akumulasi data ke array `results[]` selama loop. Setiap iterasi, update counter di UI. Di akhir, render ringkasan dari array tersebut.

**Effort:** ~40 baris (counter state + 1 komponen UI sederhana).

---

### Enhancement 4 — ⌨️ Keyboard Shortcut

**Masalah:** Untuk memulai Auto-Pilot, user harus membuka panel, mencari tombol, lalu klik. Kurang efisien.

**Solusi:** Daftarkan shortcut di `manifest.json`:

```json
"commands": {
  "start-autopilot": {
    "suggested_key": { "default": "Alt+Shift+A" },
    "description": "Start/Stop Auto-Pilot"
  }
}
```

**Cara kerja:** Chrome menangani registrasi hotkey secara native. Listener di `background.js` meneruskan perintah ke `sidepanel.js` via messaging.

**Effort:** ~10 baris (manifest entry + listener).

---

### Enhancement 5 — 🧠 Context Carry-Over (Memori Antar Chapter)

**Masalah:** Setiap chapter baru, AI memulai dari nol. Jika soal di chapter 5 merujuk materi chapter 2, AI tidak punya konteks.

**Solusi:** Setelah setiap chapter selesai, minta AI menghasilkan ringkasan 1-2 kalimat. Kumpulkan ringkasan ini ke buffer, dan inject sebagai konteks tambahan di request berikutnya:

```
=== RINGKASAN CHAPTER SEBELUMNYA ===
Ch1: Array — push, pop, shift, unshift
Ch2: Linked List — node, pointer, traversal
Ch3: Stack — LIFO, push, pop, peek
Ch4: Queue — FIFO, enqueue, dequeue
Ch5: (sedang dibaca)
```

**Cara kerja:** Append ringkasan ke array `chapterSummaries[]` setelah setiap iterasi. Inject array ini sebagai bagian dari konteks di Layer 2. Tambahan ~50-100 token per request, tapi meningkatkan akurasi secara signifikan.

**Effort:** ~20 baris.

---

## Prioritas Implementasi

| Fase | Fitur | Impact | Effort | Target |
|---|---|---|---|---|
| **Fase 1** | Layer 1 (Ekstraksi Teks) + Layer 2 (Keputusan AI) | ⭐⭐⭐⭐⭐ | Sedang | Fondasi — harus jadi pertama |
| **Fase 1** | Site Profile | ⭐⭐⭐⭐⭐ | Rendah | Membuat ekstraksi reliable |
| **Fase 1** | Dry-Run Mode | ⭐⭐⭐⭐ | Sangat Rendah | Membuat user percaya |
| **Fase 2** | Layer 3 (Eksekusi Aksi) + Auto-Pilot Loop | ⭐⭐⭐⭐⭐ | Sedang | Core automation |
| **Fase 2** | Progress Tracker | ⭐⭐⭐ | Rendah | UX pelengkap loop |
| **Fase 3** | Context Carry-Over | ⭐⭐⭐⭐ | Rendah | Tingkatkan akurasi |
| **Fase 3** | Keyboard Shortcut | ⭐⭐⭐ | Minimal | Quality of life |

---

## Struktur Proyek Final (Setelah Semua Fase)

```
Aku Malas AI/
├── manifest.json            ← + commands (shortcut), permission update
├── background.js            ← + handler: EXTRACT_PAGE, EXECUTE_ACTION, shortcut
├── sidepanel.html           ← + UI Auto-Pilot, progress bar, dry-run buttons
├── sidepanel.css            ← + styling Auto-Pilot, progress tracker
├── sidepanel.js             ← + integrasi Auto-Pilot, dry-run toggle
├── api.js                   ← + mode JSON response untuk Auto-Pilot
├── extractor.js              ★ BARU — ekstraksi DOM → teks terstruktur
├── autopilot.js              ★ BARU — loop controller, state machine, carry-over
├── site-profiles.js          ★ BARU — CRUD preset selector per domain
├── lib/
│   └── markdown.js
├── docs/
│   ├── overview.md
│   └── feature-proposal.md  ← dokumen ini
├── TUTORIAL.md
├── README.md
├── LICENSE
└── .gitignore
```
