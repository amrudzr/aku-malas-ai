# 🦥 Aku Malas AI

Ekstensi **Chrome (Manifest V3)** berupa **asisten AI di side panel** — terinspirasi
oleh Sider. Dibuat dengan **vanilla JavaScript, HTML, dan CSS** (tanpa framework,
tanpa build tools), jadi ringan dan mudah dimodifikasi.

> Asisten AI pribadi buat kamu yang... malas. 😴

---

## ✨ Fitur

- 💬 **Chat sidebar** dengan render **Markdown** + **syntax highlighting** untuk blok kode.
- ⚡ **Auto-Pilot Mode** — ekstrak teks, AI jawab quiz, otomatis submit & navigasi.
- 🗂️ **Site Profile** — preset CSS selector per situs.
- ⌨️ **Keyboard Shortcut** — `Alt+Shift+A` untuk start/stop Auto-Pilot.
- 🧠 **Banyak model AI** — Gemini 3.1 (Flash / Flash Lite / Pro), Gemini 1.5, Claude 3.5, GPT-4o.
- 📸 **Screenshot manual** — tangkap layar yang terlihat lalu kirim ke AI.
- 🖼️ **Screenshot seluruh halaman** — scroll otomatis, gabung jadi satu gambar, langsung dikirim.
- 🗂️ **Riwayat percakapan** tersimpan di `chrome.storage.local`.
- ⚙️ **Pengaturan** — simpan API key, ubah system prompt, hapus riwayat.
- 🎨 **Dark mode** modern dengan aksen gradient.

---

## 🚀 Cara Pasang (Load Unpacked)

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (pojok kanan atas)
3. Klik **Load unpacked** → pilih folder ini
4. Pin ikonnya, lalu klik untuk membuka side panel

📖 Panduan lengkap langkah-demi-langkah ada di **[TUTORIAL.md](TUTORIAL.md)**.

---

## 🔑 Menyiapkan API Key

Ekstensi ini **tidak menyertakan** API key apa pun — kamu memasukkan punyamu sendiri:

1. Ambil API key gratis di **https://aistudio.google.com/apikey** (untuk Gemini).
2. Buka ekstensi → ikon **⚙ Settings** → tempel ke kolom **Gemini API Key** → **Save**.

> 🔒 **Soal keamanan:** API key disimpan **lokal** di `chrome.storage.local`
> (di browsermu saja) dan **tidak pernah masuk ke kode atau repo ini**.
> Jangan pernah menulis API key langsung di dalam file lalu meng-commit-nya.

---

## 📁 Struktur Proyek

```
Aku Malas AI/
├── manifest.json     # Konfigurasi MV3, izin, side panel
├── background.js     # Service worker: buka panel + logika screenshot
├── sidepanel.html    # Struktur UI
├── sidepanel.css     # Styling dark mode
├── sidepanel.js      # Kontroler UI (chat, riwayat, event)
├── api.js            # Wrapper fetch modular (Gemini / Claude / OpenAI)
├── lib/
│   └── markdown.js   # Renderer Markdown → HTML (mandiri, aman CSP)
├── TUTORIAL.md       # Panduan pemakaian (Bahasa Indonesia)
├── README.md
├── LICENSE
└── .gitignore
```

---

## 🛠️ Teknologi & Catatan

- **Manifest V3**, izin: `sidePanel`, `storage`, `activeTab`, `tabs`, `scripting`.
- Tanpa CDN: renderer Markdown ditulis sendiri agar lolos **Content-Security-Policy** MV3.
- Screenshot full-page memakai `captureVisibleTab` + `OffscreenCanvas` di service worker.
- Panggilan Claude menyertakan header `anthropic-dangerous-direct-browser-access`.

---

## ⚠️ Disclaimer

Proyek pribadi untuk dipakai sendiri. API key disimpan tanpa enkripsi di storage
lokal browser (standar untuk ekstensi lokal). **Jangan publikasikan ke Chrome Web
Store dengan key tertanam**, dan jangan commit key ke GitHub.

---

## 📄 Lisensi

[MIT](LICENSE) — bebas dipakai dan dimodifikasi.
