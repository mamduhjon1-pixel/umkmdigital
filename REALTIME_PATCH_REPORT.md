# Realtime Stability Patch Report

Perubahan yang dibuat tanpa mengubah UI utama:

1. Chat query realtime sekarang difilter dari Supabase:
   - buyer hanya mengambil chat buyer sendiri
   - seller hanya mengambil chat seller sendiri
   - admin hanya mengambil chat admin-seller
   Ini mengganti pola lama yang mengambil semua chat lalu difilter di browser.

2. Realtime listener di service Supabase diberi debounce/in-flight guard:
   - mengurangi fetch ulang bertubi-tubi saat banyak event masuk
   - mencegah dashboard/chat terasa berat karena event realtime beruntun

3. Fallback profile diperkuat:
   - kalau profil Supabase gagal dimuat, dashboard tidak macet loading putih
   - app tetap memakai profil fallback dari session/metadata/cache role

4. Sound chat dibuat anti dobel:
   - setiap pesan punya tracking id
   - suara hanya bunyi untuk pesan baru dari lawan bicara

5. Read receipt dasar ditambahkan:
   - pesan aktif yang dibuka user otomatis ditandai read
   - unreadFor dihapus untuk pesan yang sedang dibaca

6. Typing indicator realtime dasar ditambahkan:
   - saat user mengetik, chat doc menyimpan status typing
   - lawan chat melihat teks "sedang mengetik..."
   - typing otomatis mati setelah berhenti mengetik

7. Cart realtime + local fallback ditambahkan:
   - cart tetap tersimpan localStorage
   - jika table carts tersedia di Supabase, cart sync antar device
   - jika table carts belum ada, cart lokal tetap jalan dan tidak crash

8. SQL disesuaikan:
   - table carts ditambahkan
   - index carts ditambahkan
   - RLS carts ditambahkan
   - carts dimasukkan ke realtime publication

Hasil test:
- npm run build: berhasil
- Firebase dependency aktif: tidak ada
- Syntax/import error: tidak ada
