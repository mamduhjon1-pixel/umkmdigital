export const complaintEmail = "umkmdigitalecommerce@gmail.com";
export const ADMIN_EMAILS = ["mamduhbadruzaman@gmail.com"];
export function isKnownAdminEmail(email) {
  return ADMIN_EMAILS.includes(String(email || "").trim().toLowerCase());
}
export function normalizeRole(role, email) {
  if (isKnownAdminEmail(email)) return "admin";
  const normalized = String(role || "").trim().toLowerCase();
  if (["admin", "sub_admin", "seller", "buyer"].includes(normalized)) return normalized;
  if (["user", "pembeli"].includes(normalized)) return "buyer";
  if (["penjual"].includes(normalized)) return "seller";
  return "buyer";
}
export const rupiah = (n) => `Rp${Number(n || 0).toLocaleString("id-ID")}`;
export function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getNotificationDedupeKey(data = {}) {
  const type = data.type || "notif";
  const userKey = data.userId || data.role || "all";
  const entity = data.dedupeKey || data.chatId || data.billId || data.orderId || data.withdrawId || data.productId || "";
  const reminderSuffix = String(type).includes("reminder") ? getTodayKey() : "";
  if (!entity) {
    const titleKey = String(data.title || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
    return [type, userKey, titleKey, reminderSuffix].filter(Boolean).join("_");
  }
  return [type, userKey, entity, reminderSuffix].filter(Boolean).join("_");
}

export function shouldThrottleNotification(data = {}) {
  // Chat messages tetap per pesan, tapi notifikasi pembuka chat tidak dibuat lagi di Step 8.
  return data.type !== "chat_message";
}

export const formatNumberInput = (value) => String(value || "").replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const parseNumberInput = (value) => Number(String(value || "").replace(/\D/g, ""));
export const LOCATION_FILTER_STORAGE_KEY = "umkm_location_filter_v1";
export const emptyLocationFilter = { kabupaten: "", kecamatan: "", desa: "" };

export function toTitleCaseLocation(value) {
  return String(value || "")
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeLocationText(value) {
  const cleaned = String(value || "")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(kabupaten|kab\.?|kota administrasi|kota|kotamadya|kodya|kecamatan|kec\.?|desa|ds\.?|kelurahan|kel\.?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return toTitleCaseLocation(cleaned);
}

export const normalizeLocationKey = (value) => normalizeLocationText(value).toLowerCase();
export const getProductLocationValue = (product, key) => normalizeLocationText(product?.[key] || product?.sellerLocation?.[key] || product?.location?.[key]);
export function getStoredLocationFilter() {
  try {
    const raw = localStorage.getItem(LOCATION_FILTER_STORAGE_KEY);
    if (!raw) return emptyLocationFilter;
    const parsed = JSON.parse(raw);
    return { ...emptyLocationFilter, ...parsed };
  } catch {
    return emptyLocationFilter;
  }
}
export function getLocationOptions(products = [], filter = emptyLocationFilter) {
  const kabupaten = new Set();
  const kecamatan = new Set();
  const desa = new Set();
  products.forEach((product) => {
    const kab = getProductLocationValue(product, "kabupaten");
    const kec = getProductLocationValue(product, "kecamatan");
    const des = getProductLocationValue(product, "desa");
    if (kab) kabupaten.add(kab);
    const matchesKabupaten = !filter.kabupaten || normalizeLocationKey(kab) === normalizeLocationKey(filter.kabupaten);
    const matchesKecamatan = !filter.kecamatan || normalizeLocationKey(kec) === normalizeLocationKey(filter.kecamatan);
    if (matchesKabupaten && kec) kecamatan.add(kec);
    if (matchesKabupaten && matchesKecamatan && des) desa.add(des);
  });
  const sort = (arr) => [...arr].sort((a, b) => a.localeCompare(b, "id"));
  return { kabupaten: sort(kabupaten), kecamatan: sort(kecamatan), desa: sort(desa) };
}
export function productMatchesLocation(product, filter = emptyLocationFilter) {
  if (!filter.kabupaten && !filter.kecamatan && !filter.desa) return true;
  const kab = normalizeLocationKey(getProductLocationValue(product, "kabupaten"));
  const kec = normalizeLocationKey(getProductLocationValue(product, "kecamatan"));
  const des = normalizeLocationKey(getProductLocationValue(product, "desa"));
  if (filter.desa) return des === normalizeLocationKey(filter.desa);
  if (filter.kecamatan) return kec === normalizeLocationKey(filter.kecamatan);
  if (filter.kabupaten) return kab === normalizeLocationKey(filter.kabupaten);
  return true;
}
export function getLocationFilterLabel(filter = emptyLocationFilter) {
  if (filter.desa) return `Desa ${filter.desa}`;
  if (filter.kecamatan) return `Kecamatan ${filter.kecamatan}`;
  if (filter.kabupaten) return `Kabupaten ${filter.kabupaten}`;
  return "Semua lokasi";
}
export const getStock = (product) => Number(product?.stock ?? product?.stok ?? 0);
export const isOutOfStock = (product) => getStock(product) <= 0;
export const normalizeStatus = (status) => String(status || "").trim().toLowerCase();
export const isOrderStatus = (order, status) => normalizeStatus(order?.statusPesanan) === normalizeStatus(status);
export const hasPaymentProof = (order) => Boolean(order?.proofSubmitted || order?.paymentProofUrl || order?.paymentProofUploadedAt);
const ORDER_DELETE_FINAL_STATUSES = ["selesai", "dibatalkan"];
