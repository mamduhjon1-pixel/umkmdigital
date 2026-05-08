# Migrasi Firebase ke Supabase - UMKM Jampang Surade

File project ini sudah dibuat agar aplikasi tidak lagi import Firebase langsung. UI utama tetap dipertahankan.

## 1. Buat tabel di Supabase
1. Buka Supabase Dashboard.
2. Pilih project kamu.
3. Masuk ke **SQL Editor**.
4. Buka file `supabase-schema.sql` dari project ini.
5. Copy semua isi file tersebut.
6. Paste ke SQL Editor.
7. Klik **Run**.

## 2. Isi file `.env`
Buat file baru bernama `.env` di folder utama project, atau copy dari `.env.example`.

Isi seperti ini:

```env
VITE_SUPABASE_URL=https://oudfbqvglpndptzgxzlt.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=ISI_DENGAN_PUBLISHABLE_KEY_KAMU
```

Catatan: project ini React + Vite, jadi pakai `VITE_`, bukan `NEXT_PUBLIC_`.

## 3. Jalankan project
```bash
npm install
npm run dev
```

## 4. Build untuk hosting
```bash
npm run build
```

Folder hasil build ada di `dist`.

## 5. Yang berubah
- Firebase Auth diganti ke Supabase Auth.
- Firestore diganti ke tabel Supabase berbasis JSONB agar field lama tidak rusak.
- Upload gambar Cloudinary tetap dibiarkan seperti sebelumnya.
- Push notification Firebase dimatikan aman karena project Firebase lama sudah dihapus.

## 6. Penting
Karena database Firebase lama sudah terhapus, data lama tidak otomatis kembali kecuali kamu punya backup export Firebase/Firestore. Kalau tidak ada backup, data harus dibuat ulang dari aplikasi.

## 7. Kalau login/register error
Cek Supabase:
- Authentication -> Providers -> Email harus aktif.
- Authentication -> URL Configuration -> Site URL isi domain website kamu.

