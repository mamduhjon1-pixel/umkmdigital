# Tahap 1 - Dashboard Seller Mobile Shopee Style

Perubahan dilakukan hati-hati hanya di dashboard seller agar lebih nyaman dipakai di HP.

## Yang dikerjakan
- Dashboard seller dibuat lebih pendek dan fokus untuk HP.
- Statistik seller diringkas dari banyak kartu menjadi 4 kartu utama: Pesanan, Produk, Saldo, Komisi.
- Ditambahkan shortcut cepat di beranda seller: Order, Produk, Chat, Saldo.
- Menu seller di HP dibuat seperti aplikasi mobile: bottom navigation di bawah layar.
- Menu penting yang muncul di bawah: Dashboard, Pesanan, Produk, Komisi, Chat.
- Menu Keuangan dan Profil tetap ada di desktop, dan Keuangan bisa diakses dari shortcut Saldo di beranda seller.
- Header seller di HP dibuat seperti aplikasi dengan warna orange ala Shopee.
- List produk seller di HP tidak lagi tabel panjang; sekarang menjadi kartu produk mobile.
- Form tambah produk di HP menjadi satu kolom supaya tidak sempit.
- Badge order/chat tetap dipertahankan di menu mobile.

## Yang tidak diubah
- Struktur database Firebase tidak diubah.
- Sistem upload produk tetap memakai struktur data lama.
- Sistem order, komisi, withdraw, chat, dan notifikasi tidak dihapus.
- Dashboard admin dan buyer belum diubah di tahap ini.

## Testing
- `npm run build` berhasil.
- Tidak ada syntax error.
- Warning bundle besar masih ada, sama seperti sebelumnya, bukan error deploy.
