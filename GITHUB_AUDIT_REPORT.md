# Audit Aman GitHub

## Aman untuk diupload
- `src/`
- `public/` setelah konfigurasi Firebase lama dibersihkan
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `index.html`
- `.env.example`
- `supabase-schema.sql`
- file `.md` panduan/laporan

## Jangan upload
- `.env`
- `.env.local`
- `.env.production`
- file apa pun yang berisi `SERVICE_ROLE_KEY`
- file apa pun yang berisi `DATABASE_URL=postgresql://...password...`
- password database Supabase

## Perubahan pada versi GitHub-safe
- Folder `dist/` dihapus karena itu hasil build dan tidak perlu masuk GitHub.
- File `.gitignore` ditambahkan.
- Konfigurasi Firebase lama di `public/firebase-messaging-sw.js` diganti placeholder.

## Catatan
- `.env.example` boleh diupload karena hanya contoh.
- `VITE_SUPABASE_PUBLISHABLE_KEY` adalah key publik, tapi tetap sebaiknya nilai asli disimpan di `.env`, bukan di GitHub.
