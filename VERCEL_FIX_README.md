# Catatan Perbaikan Vercel

File ini sudah diperbaiki supaya Vercel tidak mengambil package dari registry internal.

Yang diperbaiki:
- `package-lock.json` dibersihkan dari URL internal yang salah.
- `.npmrc` ditambahkan agar npm memakai registry resmi: `https://registry.npmjs.org/`.
- `.gitignore` diperbarui agar `.env`, `node_modules`, `dist`, dan `.vercel` tidak ikut GitHub.

Setelah upload ke GitHub:
1. Buka Vercel.
2. Masuk project.
3. Buka Deployments.
4. Klik Redeploy.

Variable Vercel tetap:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_CLOUDINARY_CLOUD_NAME`
- `VITE_CLOUDINARY_UPLOAD_PRESET`
