# Filter Lokasi Bertingkat - Final Report

Perubahan dilakukan khusus pada filter lokasi HomePage tanpa mengubah flow auth, checkout, payment, QRIS, dashboard, notifikasi, atau sistem lain.

## Yang diperbaiki

1. Dropdown lokasi otomatis dari data produk/seller aktif:
   - Kabupaten
   - Kecamatan
   - Desa

2. Data lokasi dibuat unik dan rapi:
   - `sukabumi`, `Sukabumi`, dan ` SUKABUMI ` menjadi satu opsi: `SUKABUMI`
   - spasi berlebihan dibersihkan
   - data kosong tidak ditampilkan

3. Filter bertingkat:
   - Pilih Kabupaten → Kecamatan menyesuaikan kabupaten tersebut
   - Pilih Kecamatan → Desa menyesuaikan kabupaten/kecamatan tersebut
   - Ganti Kabupaten → Kecamatan dan Desa otomatis reset
   - Ganti Kecamatan → Desa otomatis reset

4. Pencarian tetap digabung dengan filter lokasi:
   - pencarian produk/toko
   - kategori
   - subkategori
   - sort terbaru/termurah/termahal/terlaris

5. Performa:
   - memakai `useMemo` untuk mengurangi perhitungan berulang
   - tetap menggunakan debounce search yang sudah ada

6. Kompatibilitas field lokasi:
   - `kabupaten`, `kecamatan`, `desa`
   - `regency`, `district`, `village`
   - `sellerRegency`, `sellerDistrict`, `sellerVillage`
   - `storeRegency`, `storeDistrict`, `storeVillage`
   - `sellerLocation`, `location`, dan `seller`

## Test build

`npm run build` berhasil.

Catatan: Vite memberi warning ukuran chunk >500 kB, bukan error. Build production tetap sukses.
