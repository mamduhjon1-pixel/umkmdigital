# UMKM Jampang Surade - Final Supabase Realtime

Versi ini memakai Supabase untuk auth, database, realtime, dan session aplikasi.

## Yang sudah disiapkan

- Supabase Auth untuk login, register, logout, reset password.
- Realtime untuk produk, order, review, penarikan, wallet seller, komisi, admin wallet, user, notifikasi, chat, chat messages, dan presence online/offline.
- Live dashboard admin dengan data order, seller approval, chat, penarikan, produk, user, saldo, komisi, dan user/seller online.
- Realtime login/logout melalui tabel `user_presence` dan update status online pada tabel `users`.
- Sound notification untuk order/chat/notifikasi baru.
- SQL final siap paste ke Supabase SQL Editor: `SUPABASE_SQL_EDITOR_FINAL_AMAN.sql`.
- Build production sudah dites berhasil.

## Setup wajib

1. Buat project Supabase.
2. Buka Supabase SQL Editor.
3. Paste dan jalankan isi file `SUPABASE_SQL_EDITOR_FINAL_AMAN.sql`.
4. Isi file `.env` dari `.env.example`:

```env
VITE_SUPABASE_URL=isi_url_supabase
VITE_SUPABASE_PUBLISHABLE_KEY=isi_anon_publishable_key
VITE_CLOUDINARY_CLOUD_NAME=isi_cloudinary_cloud_name
VITE_CLOUDINARY_UPLOAD_PRESET=isi_upload_preset
```

5. Install dan jalankan:

```bash
npm install
npm run dev
```

## Build production

```bash
npm run build
```
