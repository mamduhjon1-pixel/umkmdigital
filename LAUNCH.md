# UMKM Digital — Panduan Launch & Android

## Ringkasan perubahan

### Bug critical (data integrity)
- **Stok**: restore stok memakai `runTransaction` (anti double-restore).
- **Voucher**: rollback kuota voucher saat semua order dalam batch checkout dibatalkan/ditolak.
- **Checkout**: setiap order menyimpan `checkoutBatchId`, `marketplaceVoucherUsageId`, `sellerVoucherUsageId`.
- **soldCount**: perbaikan increment `soldCount` saat order selesai.
- **Saldo seller**: kredit transfer memakai transaksi + idempotency key.
- **Keranjang**: qty dibatasi stok live; add-to-cart cek stok.

### UI/UX premium
- Layer CSS `src/styles/premium.css` (toast, skeleton, confirm dialog, animasi, safe-area).
- Komponen `Toast`, `Skeleton`, `ConfirmDialog`.
- Skeleton loading homepage saat data pertama kali dimuat.

### Android (Capacitor 7)
- Konfigurasi `capacitor.config.json`
- Plugin: App, StatusBar, SplashScreen, Keyboard
- Back button Android terhubung ke history browser

---

## Menjalankan website (development)

```powershell
cd c:\Users\user\Downloads\start
npm install
npm run dev
```

Buka: **http://localhost:5000/**

Pastikan file `.env` berisi kunci Firebase & Cloudinary.

---

## Build website production

```powershell
npm run build
npm run preview
```

Output: folder `dist/`

---

## Build Android (APK debug)

**Prasyarat:** Android Studio + JDK 17 terpasang.

```powershell
cd c:\Users\user\Downloads\start
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

Di Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**

Atau via CLI (setelah `cap add android`):

```powershell
npm run android:apk
```

APK debug biasanya di: `android/app/build/outputs/apk/debug/app-debug.apk`

### Build AAB (Play Store)

Di Android Studio: **Build → Generate Signed Bundle / APK → Android App Bundle**

---

## Cek manual sebelum launch

- [ ] Login / register / logout (buyer, seller, admin)
- [ ] Tambah/edit/hapus produk + stok
- [ ] Keranjang & checkout tanpa voucher
- [ ] Checkout dengan voucher marketplace & voucher toko
- [ ] Pembayaran tunai & transfer
- [ ] Batalkan order sebelum bayar → stok & voucher kembali
- [ ] Order selesai → saldo seller (transfer)
- [ ] Komisi tunai & tagihan
- [ ] Notifikasi
- [ ] Responsive HP (Chrome mobile + APK Capacitor)

---

## File penting yang diubah

| Area | File |
|------|------|
| Order/stock/voucher | `src/services/orderLifecycle.js` |
| Checkout batch | `src/pages/checkout/CheckoutModal.jsx` |
| Cancel flows | `src/pages/buyer/BuyerDashboard.jsx`, `src/pages/admin/AdminDashboard.jsx` |
| UI system | `src/styles/premium.css`, `src/components/ui/*` |
| App shell | `src/App.jsx`, `src/main.jsx` |
| Android | `capacitor.config.json`, `package.json`, `vite.config.js` |

---

## Catatan Firebase

Error `permission-denied` saat belum login adalah perilaku rules Firestore. Pastikan rules production mengizinkan read produk publik dan write sesuai role.
