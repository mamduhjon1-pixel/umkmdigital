export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((Number(lat2) - Number(lat1)) * Math.PI) / 180;
  const dLon = ((Number(lon2) - Number(lon1)) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((Number(lat1) * Math.PI) / 180) *
      Math.cos((Number(lat2) * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function calculateSameDayShipping(distanceKm) {
  if (distanceKm <= 30) return 10000;
  return 10000 + Math.ceil(distanceKm - 30) * 2000;
}
export const CATEGORY_GROUPS = {
  "Makanan": ["Makanan Ringan", "Makanan Berat", "Kue Basah", "Kue Kering", "Frozen Food", "Sambal", "Makanan Tradisional", "Makanan Khas Daerah"],
  "Minuman": ["Minuman Dingin", "Minuman Panas", "Kopi", "Teh", "Jus", "Minuman Herbal", "Minuman Kemasan"],
  "Fashion": ["Baju Pria", "Baju Wanita", "Baju Anak", "Daster", "Kaos", "Celana", "Jaket", "Hijab", "Sandal", "Sepatu", "Tas", "Aksesoris"],
  "Kecantikan & Perawatan": ["Skincare", "Makeup", "Body Care", "Hair Care", "Parfum", "Alat Kecantikan"],
  "Kesehatan": ["Vitamin", "Obat Herbal", "Alat Kesehatan", "Suplemen"],
  "Elektronik": ["HP", "Aksesoris HP", "Charger", "Headset", "Speaker", "Lampu", "Peralatan Elektronik Rumah"],
  "Rumah Tangga": ["Peralatan Dapur", "Peralatan Rumah", "Dekorasi Rumah", "Furniture", "Peralatan Kebersihan"],
  "Kebutuhan Harian": ["Sembako", "Air Galon", "Gas LPG", "Sabun & Deterjen", "Perawatan Diri"],
  "Bayi & Anak": ["Baju Bayi", "Perlengkapan Bayi", "Mainan Anak", "Susu & Makanan Bayi"],
  "Hobi & Olahraga": ["Alat Olahraga", "Sepeda", "Fitness", "Outdoor", "Memancing"],
  "Otomotif": ["Sparepart Motor", "Sparepart Mobil", "Aksesoris Kendaraan", "Oli & Cairan"],
  "Pertanian & Peternakan": ["Bibit Tanaman", "Pupuk", "Alat Pertanian", "Pakan Ternak"],
  "Hasil Laut": ["Ikan Segar", "Udang", "Cumi", "Kepiting", "Ikan Asin"],
  "Olahan Seafood": ["Kerupuk Ikan", "Abon Ikan", "Bakso Ikan", "Nugget Seafood", "Sambal Seafood"],
  "Peralatan Nelayan": ["Jaring", "Alat Pancing", "Umpan", "Cool Box", "Peralatan Laut"],
  "Kerajinan & UMKM": ["Handmade", "Kerajinan Kayu", "Kerajinan Bambu", "Kerajinan Kerang", "Souvenir"],
  "Oleh-Oleh": ["Oleh-Oleh Makanan", "Souvenir", "Produk Khas Daerah", "Hampers"],
  "Wisata & Jasa": ["Paket Wisata", "Sewa Perahu", "Guide Lokal", "Foto & Video", "Homestay"],
  "Jasa Lokal": ["Service Elektronik", "Tukang Bangunan", "Jasa Antar", "Laundry", "Bersih-Bersih", "Jasa Pijat"],
  "Lainnya": ["Produk Lainnya"],
};

export const CATEGORY_ICONS = {
  all: "🏪",
  "Makanan": "🍱",
  "Minuman": "🥤",
  "Fashion": "👗",
  "Kecantikan & Perawatan": "💄",
  "Kesehatan": "💊",
  "Elektronik": "📱",
  "Rumah Tangga": "🏠",
  "Kebutuhan Harian": "🛒",
  "Bayi & Anak": "🧸",
  "Hobi & Olahraga": "⚽",
  "Otomotif": "🏍️",
  "Pertanian & Peternakan": "🌾",
  "Hasil Laut": "🐟",
  "Olahan Seafood": "🍤",
  "Peralatan Nelayan": "🎣",
  "Kerajinan & UMKM": "🧶",
  "Oleh-Oleh": "🎁",
  "Wisata & Jasa": "🏝️",
  "Jasa Lokal": "🛠️",
  "Lainnya": "📦",
};

export const CATEGORIES = [
  { id: "all", label: "Semua", icon: CATEGORY_ICONS.all },
  ...Object.keys(CATEGORY_GROUPS).map((name) => ({ id: name, label: name, icon: CATEGORY_ICONS[name] || "📦" })),
];

export function statusLabel(s) {
  const map = {
    menunggu_pembayaran: { label: "Menunggu Bayar", cls: "badge-yellow" },
    menunggu_verifikasi: { label: "Verifikasi", cls: "badge-yellow" },
    sudah_dibayar: { label: "Sudah Dibayar", cls: "badge-green" },
    pesanan_masuk: { label: "Pesanan Masuk", cls: "badge-green" },
    diproses: { label: "Diproses", cls: "badge-orange" },
    dikirim: { label: "Dikirim", cls: "badge-orange" },
    selesai: { label: "Selesai", cls: "badge-green" },
    dibatalkan: { label: "Dibatalkan", cls: "badge-red" },
    pembatalan_diajukan: { label: "Menunggu Approval Admin", cls: "badge-yellow" },
    ditolak: { label: "Ditolak", cls: "badge-red" },
    pending: { label: "Pending", cls: "badge-yellow" },
    active: { label: "Aktif", cls: "badge-green" },
    rejected: { label: "Ditolak", cls: "badge-red" },
    approved: { label: "Disetujui", cls: "badge-green" },
    paid: { label: "Dibayar", cls: "badge-green" },
    menunggu_ongkir: { label: "Menunggu Ongkir", cls: "badge-yellow" },
    tunai: { label: "Tunai", cls: "badge-green" },
  };
  return map[s] || { label: s, cls: "badge-gray" };
}

export function productSoldCount(product) {
  return Number(product?.soldCount || product?.totalSold || product?.sold || product?.totalReviews || 0);
}

export async function copyToClipboard(text, successMessage = "Berhasil disalin") {
  try {
    if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(String(text || ""));
    else {
      const textarea = document.createElement("textarea");
      textarea.value = String(text || "");
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    alert(successMessage);
  } catch (error) {
    alert("Gagal menyalin. Coba salin manual.");
  }
}

export function getOrderShippingAddress(order = {}) {
  const lines = [
    order.buyerName ? `Nama: ${order.buyerName}` : "",
    order.buyerWhatsapp ? `WA: ${order.buyerWhatsapp}` : "",
    order.buyerAddress ? `Alamat: ${order.buyerAddress}` : "",
    [order.buyerVillage, order.buyerDistrict, order.buyerRegency].filter(Boolean).join(", "),
    order.buyerMapsLink ? `Maps: ${order.buyerMapsLink}` : "",
    order.courierName ? `Pengiriman: ${order.courierName}${order.courierService ? ` ${order.courierService}` : ""}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
