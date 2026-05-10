# Laporan Perubahan Lokasi Buyer Otomatis

Baseline: `UMKM-JAMPANGSURADE-final-filter-lokasi.zip`

## Perubahan yang dilakukan
- Menambahkan tombol **📍 Gunakan Lokasi Saya Otomatis** pada checkout untuk metode pengiriman **Same Day Lokal**.
- Input manual link Google Maps tetap dipertahankan.
- Jika buyer mengizinkan lokasi, sistem memakai `navigator.geolocation` untuk mengambil latitude/longitude.
- Link Google Maps otomatis dibuat dalam format:
  `https://www.google.com/maps?q=LAT,LNG`
- Field order lama tetap dipakai: `buyerMapsLink`.
- Dashboard seller tetap aman karena sudah membaca `buyerMapsLink` untuk tombol **Buka Maps Pembeli**.

## Yang tidak diubah
- Search bar
- Filter lokasi produk
- Cart/checkout selected item
- Payment flow
- Ongkir flow
- Dashboard buyer/seller/admin selain data lama yang tetap dipakai
- Firebase config dan collection
- Struktur order utama

## Test
- `npm install --no-audit --no-fund`: berhasil
- `npm run build`: berhasil

## Catatan
- Lokasi otomatis hanya berjalan jika buyer memberi izin lokasi di browser/HP.
- Jika izin ditolak atau GPS gagal, buyer tetap bisa memakai input manual link Google Maps seperti sebelumnya.
