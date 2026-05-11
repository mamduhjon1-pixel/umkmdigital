# FILTER LOKASI V9 - AUDIT & PERUBAHAN

Base: UMKM-JAMPANGSURADE-FIX-ADMIN-V8-SHOPEE-SELLER-UI.zip

Perubahan hanya pada filter lokasi buyer.

## Yang diperbaiki
- Normalisasi nama lokasi agar tidak dobel:
  - Kabupaten Sukabumi, Kab. Sukabumi, Kota Sukabumi => Sukabumi
  - Kecamatan Cibadak, Kec. Cibadak => Cibadak
  - Desa Sukamaju, Kelurahan Sukamaju => Sukamaju
- Filter bertingkat:
  - Kabupaten/Kota dipilih dulu
  - Kecamatan hanya muncul sesuai Kabupaten/Kota
  - Desa/Kelurahan hanya muncul sesuai Kecamatan
- UI filter dibuat lebih modern dan tetap mengikuti style orange marketplace.
- Ditambahkan chip filter aktif yang bisa diklik untuk hapus filter sebagian.
- Tetap memakai data produk lama, tidak wajib ubah database.

## Yang tidak diubah
- Checkout
- Keranjang
- Order
- Seller dashboard
- Admin dashboard
- Wallet
- Komisi
- Chat
- Notifikasi
- Firebase config
- Firestore rules

## Hasil build
- npm install: sukses
- npm run build: sukses
