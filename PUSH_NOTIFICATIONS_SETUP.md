# Push / Notifikasi Setelah Migrasi Supabase

Firebase Messaging lama sudah dinonaktifkan. Website sekarang memakai notifikasi browser lokal yang dipicu oleh data realtime Supabase pada tabel `notifications`.

Yang perlu dipastikan:

1. Jalankan `supabase-schema.sql` di Supabase SQL Editor.
2. Aktifkan Realtime untuk tabel `notifications` jika belum aktif.
3. Pastikan file `.env` berisi:

```env
VITE_SUPABASE_URL=isi_url_project_supabase
VITE_SUPABASE_PUBLISHABLE_KEY=isi_anon_publishable_key_supabase
```

Catatan: notifikasi tetap membutuhkan izin browser dari user. Untuk push jarak jauh saat browser tertutup total, nanti perlu Edge Function / provider push terpisah. Flow aplikasi saat ini tetap berjalan tanpa Firebase.
