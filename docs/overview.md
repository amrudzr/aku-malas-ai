# Overview & Struktur Proyek: Aku Malas AI

## 📌 Deskripsi Proyek
**Aku Malas AI** adalah ekstensi Google Chrome (berbasis Manifest V3) yang berfungsi sebagai asisten AI di panel samping (side panel). Proyek ini dibangun sepenuhnya menggunakan **Vanilla JavaScript, HTML, dan CSS** tanpa framework atau build tools tambahan, sehingga ringan, cepat, dan mudah untuk dimodifikasi.

## ✨ Fitur Utama
- **Chat Sidebar:** Antarmuka obrolan yang mendukung rendering Markdown dan syntax highlighting.
- **Dukungan Multi-Model AI:** Kompatibel dengan model dari Google (Gemini 3.1, Gemini 1.5), Anthropic (Claude 3.5), dan OpenAI (GPT-4o).
- **Tangkapan Layar (Screenshot):**
  - *Manual:* Menangkap bagian layar yang terlihat.
  - *Full Page:* Menggulir halaman secara otomatis untuk menangkap seluruh halaman.
- **Penyimpanan Lokal:** Riwayat obrolan dan pengaturan (seperti API Key) disimpan secara aman di browser menggunakan `chrome.storage.local`.
- **Tema Gelap (Dark Mode):** Desain antarmuka modern dengan aksen gradien.

## 📁 Struktur Direktori dan File

Berikut adalah penjelasan mengenai struktur file dalam proyek ini:

- **`manifest.json`**  
  File konfigurasi utama untuk ekstensi Chrome (Manifest V3). Mengatur izin (permissions) seperti `sidePanel`, `storage`, `activeTab`, `tabs`, dan `scripting`, serta mendefinisikan *service worker* dan file UI side panel.

- **`background.js`**  
  Bertindak sebagai *Service Worker*. Menangani *event* sistem di latar belakang, seperti logika untuk membuka panel samping dan menangkap layar (menggunakan `captureVisibleTab` dan `OffscreenCanvas`).

- **`sidepanel.html`**  
  Struktur antarmuka pengguna (UI) utama untuk panel samping.

- **`sidepanel.css`**  
  File *styling* untuk memberikan tampilan visual yang modern (dark mode).

- **`sidepanel.js`**  
  Pengontrol logika antarmuka pengguna (UI Controller). Menangani input dari pengguna, pengelolaan riwayat obrolan, dan berbagai *event* pada UI.

- **`api.js`**  
  Berisi wrapper fungsi `fetch` yang modular untuk melakukan panggilan API ke berbagai model (Gemini, Claude, OpenAI).

- **`lib/`**  
  Folder yang menyimpan *library* internal.
  - **`markdown.js`**: Renderer Markdown kustom untuk menerjemahkan teks Markdown menjadi HTML. Ditulis secara mandiri agar ekstensi lolos dari standar kebijakan keamanan (Content-Security-Policy/CSP) tanpa mengandalkan CDN eksternal.

- **`TUTORIAL.md` & `README.md`**  
  Dokumentasi proyek yang berisi panduan lengkap instalasi, konfigurasi, cara pemakaian, serta gambaran teknis proyek.

- **`LICENSE` & `.gitignore`**  
  Lisensi proyek (MIT) dan daftar pengecualian file atau folder untuk Git.

## 🛠️ Teknologi yang Digunakan
- **Chrome Extension Manifest V3** (Standar keamanan dan API ekstensi terbaru).
- **Vanilla Web Technologies** (HTML5, CSS3, ES6+ JavaScript) — tanpa Node.js, npm, atau bundler.
- **Chrome APIs Utama:** `chrome.sidePanel`, `chrome.storage.local`, `chrome.tabs`, `chrome.scripting`.

## 🔒 Catatan Keamanan & Arsitektur
Proyek ini mengadopsi pendekatan *bring-your-own-key*. API Key pengguna tidak di-*hardcode* di dalam skrip, melainkan dikelola langsung dari panel pengaturan dan disimpan di dalam `chrome.storage.local` tanpa enkripsi tambahan (standar untuk ekstensi lokal). Tidak ada server *backend* perantara, sehingga panggilan API dieksekusi secara langsung dari browser pengguna ke *endpoint* API penyedia layanan AI.
