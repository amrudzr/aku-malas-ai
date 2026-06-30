# 📘 Tutorial Aku Malas AI — Panduan Lengkap (Bahasa Indonesia)

Panduan langkah-demi-langkah untuk memasang dan menjalankan ekstensi **Aku Malas AI**
di Chrome. Ditulis untuk pemula — ikuti urut dari atas.

---

## 🧩 Bagian 0 — Apa yang kamu butuhkan

- Browser **Google Chrome** versi **114 atau lebih baru**
  (cek di `chrome://settings/help`).
- **API Key Google AI (Gemini)** — gratis. Cara mendapatkannya ada di Bagian 4.
- Folder ekstensi ini (yang sudah berisi semua file).

---

## 📁 Bagian 1 — Siapkan Folder & File

Pastikan struktur folder kamu seperti ini. **Jangan ubah nama file atau folder**,
dan pastikan `markdown.js` berada di dalam subfolder `lib`:

```
Aku Malas AI/
├── manifest.json
├── background.js
├── sidepanel.html
├── sidepanel.css
├── sidepanel.js
├── api.js
└── lib/
    └── markdown.js
```

> 💡 Tidak perlu install apa pun (tanpa npm/Node). Semuanya HTML, CSS, dan
> JavaScript murni.

---

## 🔌 Bagian 2 — Pasang ke Chrome (Load Unpacked)

1. Buka Chrome, ketik di address bar: **`chrome://extensions`** lalu Enter.
2. Nyalakan **Developer mode** (tombol toggle di **pojok kanan atas**).
3. Klik tombol **Load unpacked** (muncul di kiri atas setelah Developer mode aktif).
4. Arahkan ke folder ekstensi:
   `E:\Random\Ekstensi\Aku Malas AI`
   lalu klik **Select Folder**.
5. Kartu **"Aku Malas AI"** akan muncul. Selesai dipasang! ✅

> ⚠️ Kalau ada tulisan **Errors** (merah), klik untuk membaca pesannya.
> Penyebab paling umum: ada file yang hilang atau salah letak (misal
> `markdown.js` tidak di dalam folder `lib`).

---

## 🪟 Bagian 3 — Buka Side Panel (Panel Samping)

1. Klik ikon **puzzle 🧩** (Extensions) di toolbar Chrome (kanan atas).
2. Cari **Aku Malas AI**, klik ikon **pin 📌** agar selalu tampil di toolbar.
3. Klik ikon **Aku Malas AI** di toolbar → panel akan **muncul dari sebelah kanan**.

> Klik ikonnya sekali lagi untuk menutup/membuka panel.

---

## 🔑 Bagian 4 — Ambil API Key Google AI (Gemini)

1. Buka **https://aistudio.google.com/apikey** (login dengan akun Google).
2. Klik **Create API key** / **Buat kunci API**.
3. Salin kunci yang muncul (formatnya diawali `AIza...`).

> Simpan baik-baik dan jangan dibagikan ke orang lain.

---

## ⚙️ Bagian 5 — Masukkan API Key ke Ekstensi

1. Di panel Aku Malas AI, klik ikon **gerigi ⚙ (Settings)** di pojok kanan atas.
2. Tempel kunci tadi ke kolom **Gemini API Key**.
   (Kolom Claude & OpenAI boleh dikosongkan kalau kamu hanya pakai Gemini.)
3. (Opsional) Ubah **System Prompt** untuk mengatur "kepribadian" AI.
   Contoh: *"Kamu adalah asisten yang menjawab singkat dalam Bahasa Indonesia."*
4. Klik **Save** → muncul tulisan **"Settings saved ✓"**.

> 🔒 Kunci disimpan secara lokal di `chrome.storage.local` (di komputermu saja).
> Karena ini ekstensi pribadi, jangan dipublikasikan dengan kunci di dalamnya.

---

## 🤖 Bagian 6 — Pilih Model

Di bagian atas panel ada dropdown model. Untuk kebutuhan cepat, pilih:

- **Gemini 3.1 Flash** — cepat & seimbang (default).
- **Gemini 3.1 Flash Lite** — paling cepat & hemat.
- **Gemini 3.1 Pro** — paling pintar untuk tugas berat.

> Pastikan model yang dipilih cocok dengan API key yang sudah kamu isi
> (semua model Gemini memakai key Google AI yang sama).

---

## 💬 Bagian 7 — Coba Prompt Pertama

1. Ketik pertanyaan di kotak input bawah, misal: *"Jelaskan apa itu HTML."*
2. Tekan **Enter** untuk mengirim. (**Shift + Enter** untuk baris baru.)
3. Akan muncul indikator **titik-titik mengetik**, lalu jawaban AI tampil dengan
   format rapi (Markdown, blok kode, dll).

> Ekstensi mengingat percakapan sebelumnya selama sesi berjalan. Untuk mengosongkan,
> buka Settings → **Clear Chat History**.

---

## 📸 Bagian 8 — Fitur Screenshot

### A. Screenshot Manual (layar yang terlihat)
1. Buka sebuah halaman web biasa (**bukan** halaman `chrome://`).
2. Klik tombol **Screenshot** di toolbar input.
3. Muncul **pratinjau gambar kecil** di atas kotak input.
4. Ketik pertanyaan, misal *"Apa isi gambar ini?"*, lalu kirim. Gambar ikut terkirim.

### B. Screenshot Seluruh Halaman → Otomatis Kirim
1. Buka halaman yang panjang (perlu di-scroll).
2. Klik tombol **Full Page → AI**.
3. Halaman akan **otomatis ter-scroll dari atas ke bawah** sambil ditangkap,
   lalu gambar utuhnya **langsung dikirim ke AI** untuk dianalisis — tanpa klik lagi.

---

## 🔁 Bagian 9 — Setelah Mengubah Kode

Setiap kali kamu mengedit file ekstensi:

1. Buka `chrome://extensions`.
2. Klik ikon **reload ↻** pada kartu **Aku Malas AI**.
3. Tutup & buka lagi panelnya untuk melihat perubahan.

---

## 🛠️ Bagian 10 — Mengatasi Masalah (Troubleshooting)

| Masalah | Penyebab & Solusi |
|---|---|
| **"No API key set…"** | API key belum diisi untuk model yang dipilih. Buka ⚙ Settings, isi kolom Gemini, Save. |
| **"Cannot capture this page"** | Kamu sedang di halaman internal browser (`chrome://`). Buka website biasa dulu. |
| **Error `404 model not found`** | Nama model tidak cocok. Buka `https://generativelanguage.googleapis.com/v1beta/models?key=API_KEY_KAMU` untuk melihat daftar model resmi, lalu samakan di `api.js`. |
| **Error `400 / API key invalid`** | Kunci salah ketik atau belum aktif. Buat ulang di aistudio.google.com/apikey. |
| **Sudah edit kode tapi tidak berubah** | Belum di-reload. Klik ikon ↻ di `chrome://extensions`. |
| **Dropdown masih model lama** | Pilihan tersimpan di storage. Pilih ulang model dari dropdown secara manual. |

## 🤖 Bagian 11 — Auto-Pilot Mode

Fitur eksperimental untuk mengotomatisasi pengerjaan quiz (contoh: Oracle Academy).

1. **Setup Site Profile**: Buka Settings → isi Hostname (misal: `academy.oracle.com`).
   - Gunakan tombol **"🎯" (Picker)** untuk mengklik elemen di halaman web dan mendapatkan CSS selector secara otomatis.
   - Atau ketik manual CSS selector untuk `content`, `question`, `options`, `submit`, dan `next`. Simpan.
2. **Jalankan Auto-Pilot**: Klik tombol `Auto-Pilot` di UI atau gunakan shortcut keyboard `Alt+Shift+A`.
3. **Dry-Run**: Jika opsi "Dry-Run" aktif, ekstensi akan menampilkan tebakan AI terlebih dahulu. Kamu bisa klik Eksekusi atau Skip.
4. **Token Budget**: Set batasan token di Settings agar AI berhenti sejenak saat penggunaan token sudah tinggi.
5. **Context Carry-Over**: Ekstensi akan mengingat ringkasan 10 chapter terakhir untuk membantu menjawab soal yang berkaitan.

---

## ✅ Ringkasan Cepat

1. `chrome://extensions` → **Developer mode** ON → **Load unpacked** → pilih folder.
2. Pin & klik ikon → panel muncul.
3. ⚙ Settings → tempel **Gemini API Key** → Save.
4. Pilih model **Gemini 3.1 Flash** → ketik prompt → Enter.
5. Coba tombol **Screenshot** dan **Full Page → AI**.

Selamat mencoba! 🚀
