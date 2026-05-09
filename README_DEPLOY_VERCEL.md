# Deploy Vercel - UMKM Digital

Project ini memakai source hasil Replit dari `artifacts/umkm-digital/` dan sudah dibuat standalone untuk Vercel.

## Environment Variables di Vercel
Isi variable berikut:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_CLOUDINARY_CLOUD_NAME=
VITE_CLOUDINARY_UPLOAD_PRESET=
```

## Build Settings Vercel
- Framework Preset: Vite
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`

`vercel.json` sudah disediakan agar refresh dashboard/route tidak 404.
