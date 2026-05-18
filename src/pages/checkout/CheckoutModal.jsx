import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, increment, runTransaction, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { rupiah, getStock } from "../../utils/appHelpers";
import { isCashPayment, isTransferPayment, getCashMarketplaceVoucherCompensationAmount, getCashCommissionDueAmount } from "../../utils/paymentUtils";
import { resolveCheckoutProduct } from "../../services/orderLifecycle";
import { calcCommission } from "../../utils/commissionUtils";


const normalizeVoucherCode = (value) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
const normalizeKey = (value) => String(value || "").trim().toLowerCase();

function getCheckoutPaymentMethod(form) {
  return form.shippingType === "pickup" ? "cash" : String(form.paymentMethod || "transfer");
}

function getVoucherStatusInfo(voucher) {
  const now = Date.now();
  const start = voucher.startAt ? new Date(voucher.startAt).getTime() : null;
  const end = voucher.endAt ? new Date(voucher.endAt).getTime() : null;
  const quota = Number(voucher.quota || 0);
  const used = Number(voucher.usedCount || 0);
  if (voucher.status !== "active") return { valid: false, reason: "Voucher sedang nonaktif." };
  if (start && now < start) return { valid: false, reason: "Voucher belum aktif." };
  if (end && now > end) return { valid: false, reason: "Voucher sudah berakhir." };
  if (quota > 0 && used >= quota) return { valid: false, reason: "Voucher sudah habis." };
  return { valid: true, reason: "Voucher bisa digunakan." };
}

function getVoucherEligibleItems(voucher, cart = []) {
  const scope = voucher.targetScope || "all";
  const voucherType = voucher.type || voucher.owner || "marketplace";
  if (voucherType === "seller") {
    const sellerId = String(voucher.sellerId || voucher.ownerId || "");
    const sellerItems = cart.filter((item) => String(item.sellerId || item.uid || item.ownerId || "") === sellerId);
    if (scope === "product") {
      const targets = (voucher.targetProductIds || []).map(String).filter(Boolean);
      return sellerItems.filter((item) => targets.includes(String(item.id || item.productId || "")));
    }
    return sellerItems;
  }
  if (scope === "category") {
    const targets = (voucher.targetCategories || []).map(normalizeKey).filter(Boolean);
    return cart.filter((item) => targets.includes(normalizeKey(item.category || item.productCategory)));
  }
  if (scope === "seller") {
    const targets = (voucher.targetSellerIds || []).map(String).filter(Boolean);
    return cart.filter((item) => targets.includes(String(item.sellerId || item.uid || item.ownerId || "")));
  }
  return cart;
}

function calculateVoucherDiscount(voucher, cart = [], paymentMethod = "transfer", userId = "") {
  if (!voucher) return { valid: false, discount: 0, eligibleSubtotal: 0, reason: "Pilih voucher dulu." };
  const status = getVoucherStatusInfo(voucher);
  if (!status.valid) return { ...status, discount: 0, eligibleSubtotal: 0 };
  const allowedMethods = Array.isArray(voucher.paymentMethods) ? voucher.paymentMethods : [];
  if (allowedMethods.length && !allowedMethods.includes(paymentMethod)) {
    return { valid: false, discount: 0, eligibleSubtotal: 0, reason: `Voucher tidak berlaku untuk metode pembayaran ${paymentMethod === "cash" ? "Tunai/COD" : paymentMethod.toUpperCase()}.` };
  }
  const usedBy = voucher.usedBy || voucher.usedByUsers || {};
  const userUsed = Number(usedBy?.[userId] || 0);
  const limitPerUser = Math.max(1, Number(voucher.limitPerUser || 1));
  if (userId && userUsed >= limitPerUser) return { valid: false, discount: 0, eligibleSubtotal: 0, reason: "Voucher sudah mencapai limit penggunaan akun Anda." };

  const eligibleItems = getVoucherEligibleItems(voucher, cart);
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  if (eligibleSubtotal <= 0) return { valid: false, discount: 0, eligibleSubtotal: 0, reason: "Voucher tidak berlaku untuk produk yang dipilih." };
  const minPurchase = Number(voucher.minPurchase || 0);
  if (minPurchase > 0 && eligibleSubtotal < minPurchase) {
    return { valid: false, discount: 0, eligibleSubtotal, reason: `Minimal belanja voucher ${rupiah(minPurchase)}.` };
  }

  let discount = 0;
  if (voucher.discountType === "percent") {
    discount = Math.floor(eligibleSubtotal * Number(voucher.discountValue || 0) / 100);
    const maxDiscount = Number(voucher.maxDiscount || 0);
    if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  } else {
    discount = Number(voucher.discountValue || 0);
    const maxDiscount = Number(voucher.maxDiscount || 0);
    if (maxDiscount > 0) discount = Math.min(discount, maxDiscount);
  }
  discount = Math.max(0, Math.min(discount, eligibleSubtotal));
  if (discount <= 0) return { valid: false, discount: 0, eligibleSubtotal, reason: "Nilai voucher tidak valid." };
  return { valid: true, discount, eligibleSubtotal, eligibleItems, reason: `Voucher ${voucher.code} berhasil digunakan.` };
}


async function createCheckoutOrdersTransaction({
  resolvedCart,
  orderPayloads,
  appliedVoucher,
  appliedSellerVoucher,
  userId,
  cart,
  paymentMethod,
  marketplaceDiscount,
  sellerVoucherDiscount,
}) {
  const orderRefs = orderPayloads.map(() => doc(collection(db, "orders")));
  const checkoutBatchId = doc(collection(db, "orders")).id;
  const marketplaceUsageRef = appliedVoucher && marketplaceDiscount > 0 ? doc(collection(db, "voucher_usages")) : null;
  const sellerUsageRef = appliedSellerVoucher && sellerVoucherDiscount > 0 ? doc(collection(db, "voucher_usages")) : null;

  await runTransaction(db, async (transaction) => {
    for (const resolvedItem of resolvedCart) {
      const liveProductSnap = await transaction.get(resolvedItem.productRef);
      if (!liveProductSnap.exists()) throw new Error(`${resolvedItem.safeProductName} sudah tidak tersedia.`);
      const liveProduct = liveProductSnap.data() || {};
      const latestStock = getStock(liveProduct);
      if (latestStock <= 0) throw new Error(`${resolvedItem.safeProductName} sedang habis.`);
      if (resolvedItem.safeQuantity > latestStock) throw new Error(`Stok ${resolvedItem.safeProductName} hanya tersisa ${latestStock}. Kurangi jumlah di keranjang.`);
      if (liveProduct.isDeleted) throw new Error(`${resolvedItem.safeProductName} sudah tidak tersedia.`);
      if (liveProduct.status && liveProduct.status !== "active") throw new Error(`${resolvedItem.safeProductName} sedang tidak aktif.`);
    }

    let liveMarketplaceVoucher = null;
    if (appliedVoucher?.id && Number(marketplaceDiscount || 0) > 0) {
      const voucherRef = doc(db, "marketplace_vouchers", appliedVoucher.id);
      const voucherSnap = await transaction.get(voucherRef);
      if (!voucherSnap.exists()) throw new Error("Voucher marketplace tidak ditemukan atau sudah dihapus.");
      liveMarketplaceVoucher = { id: appliedVoucher.id, ...(voucherSnap.data() || {}) };
      const validation = calculateVoucherDiscount(liveMarketplaceVoucher, cart, paymentMethod, userId);
      if (!validation.valid) throw new Error(validation.reason || "Voucher marketplace sudah tidak valid.");
      if (Number(validation.discount || 0) !== Number(marketplaceDiscount || 0)) {
        throw new Error("Nilai voucher marketplace berubah. Silakan terapkan voucher ulang sebelum checkout.");
      }
    }

    let liveSellerVoucher = null;
    if (appliedSellerVoucher?.id && Number(sellerVoucherDiscount || 0) > 0) {
      const voucherRef = doc(db, "seller_vouchers", appliedSellerVoucher.id);
      const voucherSnap = await transaction.get(voucherRef);
      if (!voucherSnap.exists()) throw new Error("Voucher toko tidak ditemukan atau sudah dihapus.");
      liveSellerVoucher = { id: appliedSellerVoucher.id, ...(voucherSnap.data() || {}) };
      const validation = calculateVoucherDiscount(liveSellerVoucher, cart, paymentMethod, userId);
      if (!validation.valid) throw new Error(validation.reason || "Voucher toko sudah tidak valid.");
      if (Number(validation.discount || 0) !== Number(sellerVoucherDiscount || 0)) {
        throw new Error("Nilai voucher toko berubah. Silakan terapkan voucher ulang sebelum checkout.");
      }
    }

    orderPayloads.forEach((payload, index) => {
      transaction.set(orderRefs[index], {
        ...payload,
        checkoutBatchId,
        marketplaceVoucherUsageId: marketplaceUsageRef?.id || "",
        sellerVoucherUsageId: sellerUsageRef?.id || "",
      });
    });

    resolvedCart.forEach((resolvedItem) => {
      transaction.update(resolvedItem.productRef, {
        stock: increment(-resolvedItem.safeQuantity),
        updatedAt: serverTimestamp(),
      });
    });

    const orderIds = orderRefs.map((ref) => ref.id);

    if (liveMarketplaceVoucher && marketplaceUsageRef) {
      const voucherRef = doc(db, "marketplace_vouchers", appliedVoucher.id);
      transaction.update(voucherRef, {
        usedCount: increment(1),
        [`usedBy.${userId}`]: increment(1),
        updatedAt: serverTimestamp(),
      });
      transaction.set(marketplaceUsageRef, {
        voucherId: appliedVoucher.id,
        voucherCode: liveMarketplaceVoucher.code || appliedVoucher.code || "",
        voucherType: "marketplace",
        sellerId: "",
        buyerId: userId,
        orderIds,
        discountAmount: Number(marketplaceDiscount || 0),
        paymentMethod,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    if (liveSellerVoucher && sellerUsageRef) {
      const voucherRef = doc(db, "seller_vouchers", appliedSellerVoucher.id);
      transaction.update(voucherRef, {
        usedCount: increment(1),
        [`usedBy.${userId}`]: increment(1),
        updatedAt: serverTimestamp(),
      });
      transaction.set(sellerUsageRef, {
        voucherId: appliedSellerVoucher.id,
        voucherCode: liveSellerVoucher.code || appliedSellerVoucher.code || "",
        voucherType: "seller",
        sellerId: appliedSellerVoucher.sellerId || liveSellerVoucher.sellerId || "",
        buyerId: userId,
        orderIds,
        discountAmount: Number(sellerVoucherDiscount || 0),
        paymentMethod,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });

  return orderRefs.map((ref, index) => ({ id: ref.id, ...orderPayloads[index] }));
}

function allocateVoucherDiscount(voucher, discount, cart = []) {
  const allocation = {};
  if (!voucher || !discount) return allocation;
  const eligibleItems = getVoucherEligibleItems(voucher, cart);
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  if (eligibleSubtotal <= 0) return allocation;
  let allocated = 0;
  eligibleItems.forEach((item, index) => {
    const itemId = String(item.id || item.productId || "");
    const itemTotal = Number(item.price || 0) * Number(item.quantity || 1);
    const share = index === eligibleItems.length - 1 ? Math.max(0, discount - allocated) : Math.floor(discount * itemTotal / eligibleSubtotal);
    allocation[itemId] = share;
    allocated += share;
  });
  return allocation;
}

export default function CheckoutModal({ cart, user, profile, onClose, onSuccess, createNotif }) {
  const savedAddress = (() => {
    try {
      const local = localStorage.getItem(`umkm_last_shipping_address_${user?.uid}`);
      return local ? JSON.parse(local) : (profile?.savedShippingAddress || {});
    } catch {
      return profile?.savedShippingAddress || {};
    }
  })();
  const [form, setForm] = useState({
    buyerName: profile?.name || "",
    buyerWhatsapp: profile?.whatsapp || "",
    buyerAddress: savedAddress.buyerAddress || savedAddress.buyerFullAddress || profile?.detailAddress || profile?.fullAddress || "",
    shippingType: "pickup",
    paymentMethod: "transfer",
    buyerMapsLink: savedAddress.buyerMapsLink || "",
    buyerVillage: savedAddress.buyerVillage || profile?.village || "",
    buyerDistrict: savedAddress.buyerDistrict || profile?.district || "",
    buyerRegency: savedAddress.buyerRegency || profile?.regency || "",
  });
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState("");
  const [shippingCheckRequested, setShippingCheckRequested] = useState(false);
  const [vouchers, setVouchers] = useState([]);
  const [sellerVouchers, setSellerVouchers] = useState([]);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherCode, setVoucherCode] = useState("");
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  const [appliedSellerVoucher, setAppliedSellerVoucher] = useState(null);
  const [voucherMessage, setVoucherMessage] = useState("");
  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
  const effectivePaymentMethod = getCheckoutPaymentMethod(form);
  const appliedVoucherResult = useMemo(() => calculateVoucherDiscount(appliedVoucher, cart, effectivePaymentMethod, user?.uid), [appliedVoucher, cart, effectivePaymentMethod, user?.uid]);
  const appliedSellerVoucherResult = useMemo(() => calculateVoucherDiscount(appliedSellerVoucher, cart, effectivePaymentMethod, user?.uid), [appliedSellerVoucher, cart, effectivePaymentMethod, user?.uid]);
  const marketplaceDiscount = appliedVoucherResult.valid ? appliedVoucherResult.discount : 0;
  const sellerVoucherDiscount = appliedSellerVoucherResult.valid ? appliedSellerVoucherResult.discount : 0;
  const voucherAllocation = useMemo(() => allocateVoucherDiscount(appliedVoucher, marketplaceDiscount, cart), [appliedVoucher, marketplaceDiscount, cart]);
  const sellerVoucherAllocation = useMemo(() => allocateVoucherDiscount(appliedSellerVoucher, sellerVoucherDiscount, cart), [appliedSellerVoucher, sellerVoucherDiscount, cart]);
  const checkoutPreviewTotal = Math.max(0, cartTotal - sellerVoucherDiscount - marketplaceDiscount);
  const needsSellerQuote = ["same_day", "jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);
  const needsAddress = ["jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);

  useEffect(() => {
    let mounted = true;
    async function loadMarketplaceVouchers() {
      setVoucherLoading(true);
      try {
        const snap = await getDocs(collection(db, "marketplace_vouchers"));
        const items = snap.docs
          .map((item) => ({ id: item.id, ...(item.data() || {}) }))
          .filter((item) => item.type === "marketplace" || item.owner === "admin" || !item.type)
          .sort((a, b) => {
            const aActive = getVoucherStatusInfo(a).valid ? 1 : 0;
            const bActive = getVoucherStatusInfo(b).valid ? 1 : 0;
            return bActive - aActive || String(a.code || "").localeCompare(String(b.code || ""));
          });
        const sellerSnap = await getDocs(collection(db, "seller_vouchers"));
        const cartSellerIds = new Set(cart.map((item) => String(item.sellerId || item.uid || item.ownerId || "")).filter(Boolean));
        const sellerItems = sellerSnap.docs
          .map((item) => ({ id: item.id, ...(item.data() || {}) }))
          .filter((item) => cartSellerIds.has(String(item.sellerId || item.ownerId || "")))
          .sort((a, b) => {
            const aActive = getVoucherStatusInfo(a).valid ? 1 : 0;
            const bActive = getVoucherStatusInfo(b).valid ? 1 : 0;
            return bActive - aActive || String(a.code || "").localeCompare(String(b.code || ""));
          });
        if (mounted) {
          setVouchers(items);
          setSellerVouchers(sellerItems);
        }
      } catch (err) {
        console.error("Gagal memuat voucher:", err);
        if (mounted) setVoucherMessage("Voucher belum bisa dimuat. Checkout tetap bisa dilakukan tanpa voucher.");
      } finally {
        if (mounted) setVoucherLoading(false);
      }
    }
    loadMarketplaceVouchers();
    return () => { mounted = false; };
  }, [cart]);

  useEffect(() => {
    if (!appliedVoucher) return;
    if (!appliedVoucherResult.valid) setVoucherMessage(appliedVoucherResult.reason);
  }, [appliedVoucher, appliedVoucherResult]);

  useEffect(() => {
    if (!appliedSellerVoucher) return;
    if (!appliedSellerVoucherResult.valid) setVoucherMessage(appliedSellerVoucherResult.reason);
  }, [appliedSellerVoucher, appliedSellerVoucherResult]);

  const applyVoucher = (voucher) => {
    const result = calculateVoucherDiscount(voucher, cart, effectivePaymentMethod, user?.uid);
    if (!result.valid) {
      setVoucherMessage(result.reason);
      return;
    }
    const voucherType = voucher.type || voucher.owner || "marketplace";
    if (voucherType === "seller") {
      setAppliedSellerVoucher(voucher);
    } else {
      setAppliedVoucher(voucher);
    }
    setVoucherCode(voucher.code || "");
    setVoucherMessage(result.reason);
    setVoucherPickerOpen(false);
  };

  const applyManualVoucher = () => {
    const code = normalizeVoucherCode(voucherCode);
    if (!code) {
      setVoucherMessage("Masukkan kode voucher dulu.");
      return;
    }
    const found = [...vouchers, ...sellerVouchers].find((item) => normalizeVoucherCode(item.code) === code);
    if (!found) {
      setVoucherMessage("Kode voucher tidak ditemukan.");
      return;
    }
    applyVoucher(found);
  };

  const removeVoucher = () => {
    setAppliedVoucher(null);
    setVoucherCode("");
    setVoucherMessage("Voucher marketplace dihapus.");
  };

  const removeSellerVoucher = () => {
    setAppliedSellerVoucher(null);
    setVoucherCode("");
    setVoucherMessage("Voucher toko dihapus.");
  };

  function useCurrentBuyerLocation() {
    setError("");
    if (!navigator?.geolocation) {
      setError("Browser atau perangkat Anda belum mendukung fitur lokasi otomatis. Silakan tempel link Google Maps secara manual.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position?.coords?.latitude);
        const lng = Number(position?.coords?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setError("Lokasi otomatis belum berhasil dibaca. Silakan coba lagi atau tempel link Google Maps manual.");
          setLocationLoading(false);
          return;
        }
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        setForm((prev) => ({ ...prev, buyerMapsLink: mapUrl }));
        setShippingCheckRequested(false);
        setError("");
        setLocationLoading(false);
      },
      (geoError) => {
        const denied = geoError?.code === 1;
        setError(denied ? "Izin lokasi ditolak. Aktifkan izin lokasi atau tempel link Google Maps secara manual." : "Gagal mengambil lokasi otomatis. Silakan coba lagi atau tempel link Google Maps manual.");
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function handleCheckout(e) {
    e.preventDefault();
    setError("");
    if (!user?.uid) { setError("Sesi login tidak valid. Silakan login ulang."); return; }
    if (!cart.length) { setError("Pilih minimal satu produk untuk checkout."); return; }
    setLoading(true);
    try {
      if (form.shippingType === "same_day" && !form.buyerMapsLink.trim()) throw new Error("Gunakan lokasi otomatis atau tempel link Google Maps Anda untuk Same Day.");
      if (needsAddress && (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency)) throw new Error("Desa, kecamatan, dan kabupaten wajib diisi untuk ekspedisi.");
      if (needsSellerQuote && !shippingCheckRequested) throw new Error("Klik tombol Cek Ongkir dulu agar seller menerima perintah cek ongkir.");

      const finalVoucherResult = appliedVoucher ? calculateVoucherDiscount(appliedVoucher, cart, effectivePaymentMethod, user.uid) : { valid: false, discount: 0 };
      const finalSellerVoucherResult = appliedSellerVoucher ? calculateVoucherDiscount(appliedSellerVoucher, cart, effectivePaymentMethod, user.uid) : { valid: false, discount: 0 };
      if (appliedVoucher && !finalVoucherResult.valid) throw new Error(finalVoucherResult.reason || "Voucher marketplace tidak valid untuk checkout ini.");
      if (appliedSellerVoucher && !finalSellerVoucherResult.valid) throw new Error(finalSellerVoucherResult.reason || "Voucher toko tidak valid untuk checkout ini.");
      const finalMarketplaceDiscount = appliedVoucher ? Number(finalVoucherResult.discount || 0) : 0;
      const finalSellerVoucherDiscount = appliedSellerVoucher ? Number(finalSellerVoucherResult.discount || 0) : 0;
      const finalVoucherAllocation = allocateVoucherDiscount(appliedVoucher, finalMarketplaceDiscount, cart);
      const finalSellerVoucherAllocation = allocateVoucherDiscount(appliedSellerVoucher, finalSellerVoucherDiscount, cart);

      const resolvedCart = [];
      for (const rawItem of cart) {
        const item = await resolveCheckoutProduct(rawItem);
        const safeSellerId = String(item.sellerId || item.uid || item.ownerId || "");
        const safeProductId = String(item.id || item.productId || "");
        const safeProductName = String(item.productName || item.name || "Produk");
        const safeProductImage = String(item.imageUrl || item.productImage || "");
        const safeQuantity = Math.max(1, Number(rawItem.quantity || item.quantity || 1));
        const safePrice = Number(item.price || 0);

        if (!safeProductId) throw new Error("Data produk tidak lengkap. Hapus produk dari keranjang lalu masukkan produk lagi.");
        if (!safeSellerId) throw new Error("Data seller produk tidak lengkap. Coba hapus dari keranjang lalu tambah ulang produk. Kalau masih gagal, seller harus upload ulang produk.");
        if (!safePrice || safePrice <= 0) throw new Error("Harga produk tidak valid. Hubungi seller.");

        const productRef = doc(db, "products", safeProductId);
        resolvedCart.push({ rawItem, item, safeSellerId, safeProductId, safeProductName, safeProductImage, safeQuantity, safePrice, productRef });
      }


      const addressToSave = {
        buyerAddress: form.buyerAddress || "",
        buyerMapsLink: form.buyerMapsLink || "",
        buyerVillage: form.buyerVillage || "",
        buyerDistrict: form.buyerDistrict || "",
        buyerRegency: form.buyerRegency || "",
        updatedAt: new Date().toISOString(),
      };
      if (needsAddress || form.shippingType === "same_day") {
        try {
          localStorage.setItem(`umkm_last_shipping_address_${user.uid}`, JSON.stringify(addressToSave));
        } catch (error) {
          console.error("Gagal menyimpan alamat ke localStorage:", error);
        }
        try {
          await setDoc(doc(db, "users", user.uid), { savedShippingAddress: addressToSave }, { merge: true });
        } catch (error) {
          console.error("Gagal menyimpan alamat otomatis:", error);
        }
      }

      const orderPayloads = [];

      for (const resolvedItem of resolvedCart) {
        const { item, safeSellerId, safeProductId, safeProductName, safeProductImage, safeQuantity, safePrice, productRef } = resolvedItem;
        const productTotal = safePrice * safeQuantity;
        const sellerVoucherDiscountItem = Math.max(0, Number(finalSellerVoucherAllocation[safeProductId] || 0));
        const sellerDiscountedProductTotal = Math.max(0, productTotal - sellerVoucherDiscountItem);
        const adminFee = calcCommission(sellerDiscountedProductTotal, item.commissionType, item.commissionValue);
        const marketplaceVoucherDiscount = Math.max(0, Number(finalVoucherAllocation[safeProductId] || 0));
        let shippingCost = 0, distanceKm = 0, courierName = "Ambil di Tempat", courierService = "Gratis", statusPembayaran = "menunggu_pembayaran", statusPesanan = "menunggu_pembayaran";
        if (form.shippingType === "pickup") { statusPembayaran = "tunai"; statusPesanan = "pesanan_masuk"; }
        if (form.shippingType === "same_day") { courierName = "Same Day Lokal"; courierService = "Penjual sedang menghitung ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        if (needsAddress) { courierName = form.shippingType.toUpperCase(); courierService = "Penjual sedang cek ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        const payableProductTotal = Math.max(0, sellerDiscountedProductTotal - marketplaceVoucherDiscount);
        const totalAmount = payableProductTotal + shippingCost;
        const sellerAmount = sellerDiscountedProductTotal - adminFee + shippingCost;
        const cashSettlementPreview = { paymentMethod: effectivePaymentMethod, sellerAmount, totalAmount, cashReceivedBySeller: totalAmount };
        const marketplaceVoucherSellerCompensationAmount = getCashMarketplaceVoucherCompensationAmount(cashSettlementPreview);
        const cashCommissionAmount = getCashCommissionDueAmount(cashSettlementPreview);

        const orderPayload = {
          buyerId: user.uid,
          sellerId: safeSellerId,
          sellerName: String(item.sellerName || ""),
          productId: safeProductId,
          productName: safeProductName,
          productImage: safeProductImage,
          buyerName: String(form.buyerName || profile?.name || ""),
          buyerWhatsapp: String(form.buyerWhatsapp || profile?.whatsapp || ""),
          buyerAddress: String(form.buyerAddress || ""),
          buyerMapsLink: String(form.buyerMapsLink || ""),
          buyerVillage: String(form.buyerVillage || ""),
          buyerDistrict: String(form.buyerDistrict || ""),
          buyerRegency: String(form.buyerRegency || ""),
          sellerMapLink: String(item.sellerMapLink || ""),
          sellerAddress: String(item.sellerAddress || ""),
          quantity: safeQuantity,
          productTotal,
          originalProductTotal: productTotal,
          sellerDiscountedProductTotal,
          sellerVoucherId: appliedSellerVoucher?.id || "",
          sellerVoucherCode: appliedSellerVoucher?.code || "",
          sellerVoucherDiscount: sellerVoucherDiscountItem,
          sellerVoucherOwner: appliedSellerVoucher ? "seller" : "",
          payableProductTotal,
          marketplaceVoucherId: appliedVoucher?.id || "",
          marketplaceVoucherCode: appliedVoucher?.code || "",
          marketplaceVoucherDiscount,
          marketplaceVoucherOwner: appliedVoucher ? "marketplace" : "",
          marketplaceVoucherSellerCompensationAmount,
          cashCommissionAmount,
          cashCommissionRemaining: cashCommissionAmount,
          cashCommissionStatus: cashCommissionAmount > 0 ? "pending" : "not_required",
          voucherCode: appliedVoucher?.code || "",
          voucherDiscountAmount: marketplaceVoucherDiscount,
          shippingType: String(form.shippingType || "pickup"),
          paymentMethod: effectivePaymentMethod,
          shippingCost,
          distanceKm,
          courierName,
          courierService,
          totalAmount,
          adminFee,
          sellerAmount,
          sellerReceivableAmount: isTransferPayment(effectivePaymentMethod) ? sellerAmount : 0,
          sellerProductAmount: Math.max(0, sellerDiscountedProductTotal - adminFee),
          commissionBase: sellerDiscountedProductTotal,
          marketplaceSubsidyAmount: marketplaceVoucherDiscount,
          sellerPromoAmount: sellerVoucherDiscountItem,
          sellerShippingAmount: shippingCost,
          cashReceivedBySeller: isCashPayment(effectivePaymentMethod) ? totalAmount : 0,
          statusPembayaran,
          statusPesanan,
          proofSubmitted: false,
          reviewSubmitted: false,
          pendingShippingQuote: needsSellerQuote,
          showToSeller: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        orderPayloads.push(orderPayload);

        // Komisi tunai diproses saat order selesai agar saldo seller bisa dipotong otomatis dulu.
      }

      if (orderPayloads.length <= 0) throw new Error("Pesanan belum berhasil dibuat. Coba lagi.");

      const createdOrders = await createCheckoutOrdersTransaction({
        resolvedCart,
        orderPayloads,
        appliedVoucher,
        appliedSellerVoucher,
        userId: user.uid,
        cart,
        paymentMethod: effectivePaymentMethod,
        marketplaceDiscount: finalMarketplaceDiscount,
        sellerVoucherDiscount: finalSellerVoucherDiscount,
      });

      for (const createdOrder of createdOrders) {
        await createNotif({ role: "admin", type: "order_new", title: "Order Baru Masuk", message: `${form.buyerName} memesan ${createdOrder.productName} senilai ${rupiah(createdOrder.totalAmount)}`, orderId: createdOrder.id });
        await createNotif({ role: "seller", userId: createdOrder.sellerId, type: needsSellerQuote ? "shipping_quote_needed" : "order_new", title: needsSellerQuote ? "Cek Ongkir Pesanan" : "Ada Pesanan Baru! 🎉", message: needsSellerQuote ? `Pembeli memilih ${createdOrder.courierName}. Input ongkir untuk ${createdOrder.productName}.` : `Pesanan baru: ${createdOrder.productName} (${createdOrder.quantity} pcs).`, orderId: createdOrder.id });
        await createNotif({ role: "buyer", userId: user.uid, type: "order_placed", title: "Pesanan Berhasil Dibuat", message: needsSellerQuote ? `Pesanan ${createdOrder.productName} dibuat. Penjual sedang menghitung ongkir.` : `Pesanan ${createdOrder.productName} berhasil dibuat.`, orderId: createdOrder.id });
      }

      onSuccess();
    } catch (err) {
      console.error("Checkout gagal:", err);
      setError(err.message || "Checkout gagal. Coba lagi.");
      alert(err.message || "Checkout gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-header"><h3 style={{ fontWeight: 700 }}>Checkout ({cart.length} produk dipilih)</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>✕</button></div>
      <form onSubmit={handleCheckout}><div className="modal-body checkout-body">
        {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
        <div className="checkout-summary-card">
          <div className="checkout-summary-title">Ringkasan Produk Dipilih</div>
          {cart.map((item) => <div key={item.id} className="checkout-item-row"><img src={item.imageUrl} alt={item.productName} /><div className="checkout-item-info"><div>{item.productName}</div><span>{rupiah(item.price)} × {item.quantity}</span></div><strong>{rupiah(item.price * item.quantity)}</strong></div>)}
          <div className="divider" />
          <div className="checkout-total-row"><span>Total Produk</span><span>{rupiah(cartTotal)}</span></div>
          {sellerVoucherDiscount > 0 && <div className="checkout-total-row voucher-discount-row"><span>Voucher Toko</span><span>-{rupiah(sellerVoucherDiscount)}</span></div>}
          {marketplaceDiscount > 0 && <div className="checkout-total-row voucher-discount-row"><span>Voucher Marketplace</span><span>-{rupiah(marketplaceDiscount)}</span></div>}
          {(sellerVoucherDiscount > 0 || marketplaceDiscount > 0) && <div className="checkout-total-row checkout-pay-row"><span>Total Bayar Produk</span><strong>{rupiah(checkoutPreviewTotal)}</strong></div>}
        </div>

        <div className="checkout-voucher-card">
          <div className="checkout-voucher-head">
            <div>
              <div className="checkout-voucher-title">🎟️ Voucher & Promo</div>
              <div className="checkout-voucher-subtitle">Pilih voucher marketplace atau voucher toko seperti marketplace profesional.</div>
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setVoucherPickerOpen(true)} disabled={voucherLoading}>{voucherLoading ? "Memuat..." : "Pilih Voucher"}</button>
          </div>
          <div className="checkout-voucher-input-row">
            <input className="form-input" value={voucherCode} onChange={(e) => setVoucherCode(normalizeVoucherCode(e.target.value))} placeholder="Masukkan kode voucher" />
            <button type="button" className="btn-primary btn-sm" onClick={applyManualVoucher}>Terapkan</button>
          </div>
          {appliedSellerVoucher && appliedSellerVoucherResult.valid && <div className="checkout-voucher-applied"><span><b>{appliedSellerVoucher.code}</b> voucher toko diterapkan • Hemat {rupiah(sellerVoucherDiscount)}</span><button type="button" onClick={removeSellerVoucher}>Hapus</button></div>}
          {appliedVoucher && appliedVoucherResult.valid && <div className="checkout-voucher-applied"><span><b>{appliedVoucher.code}</b> voucher marketplace diterapkan • Hemat {rupiah(marketplaceDiscount)}</span><button type="button" onClick={removeVoucher}>Hapus</button></div>}
          {voucherMessage && <div className={(appliedVoucherResult.valid && appliedVoucher) || (appliedSellerVoucherResult.valid && appliedSellerVoucher) ? "checkout-voucher-message success" : "checkout-voucher-message"}>{voucherMessage}</div>}
        </div>

        {voucherPickerOpen && <div className="voucher-picker-backdrop" onClick={() => setVoucherPickerOpen(false)}><div className="voucher-picker-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="voucher-picker-head"><div><b>Pilih Voucher</b><p>Voucher marketplace ditanggung admin, voucher toko ditanggung seller. Semua otomatis divalidasi.</p></div><button type="button" onClick={() => setVoucherPickerOpen(false)}>✕</button></div>
          {voucherLoading ? <div className="empty-state"><div className="empty-icon">⏳</div><p>Memuat voucher...</p></div> : (vouchers.length === 0 && sellerVouchers.length === 0) ? <div className="empty-state"><div className="empty-icon">🎟️</div><p>Belum ada voucher tersedia.</p></div> : <div className="voucher-picker-list">
            {sellerVouchers.length > 0 && <div className="voucher-picker-section-title">Voucher Toko</div>}
            {sellerVouchers.map((voucher) => {
              const result = calculateVoucherDiscount(voucher, cart, effectivePaymentMethod, user?.uid);
              const quota = Number(voucher.quota || 0);
              const used = Number(voucher.usedCount || 0);
              const remaining = quota > 0 ? Math.max(0, quota - used) : "Unlimited";
              return <button type="button" key={`seller-${voucher.id}`} className={`voucher-option-card ${result.valid ? "" : "disabled"}`} onClick={() => applyVoucher(voucher)}>
                <div className="voucher-option-main"><span className="voucher-option-code seller">{voucher.code}</span><b>{voucher.name}</b><small>{voucher.discountType === "percent" ? `Diskon ${voucher.discountValue}%` : `Diskon ${rupiah(voucher.discountValue)}`} {Number(voucher.maxDiscount || 0) > 0 ? `• Maks ${rupiah(voucher.maxDiscount)}` : ""}</small></div>
                <div className="voucher-option-meta"><span>{voucher.sellerName || "Voucher Toko"}</span><span>Min. {rupiah(voucher.minPurchase || 0)}</span><span>Sisa {remaining}</span></div>
                {!result.valid && <div className="voucher-option-reason">{result.reason}</div>}
              </button>;
            })}
            {vouchers.length > 0 && <div className="voucher-picker-section-title">Voucher Marketplace</div>}
            {vouchers.map((voucher) => {
              const result = calculateVoucherDiscount(voucher, cart, effectivePaymentMethod, user?.uid);
              const quota = Number(voucher.quota || 0);
              const used = Number(voucher.usedCount || 0);
              const remaining = quota > 0 ? Math.max(0, quota - used) : "Unlimited";
              return <button type="button" key={`marketplace-${voucher.id}`} className={`voucher-option-card ${result.valid ? "" : "disabled"}`} onClick={() => applyVoucher(voucher)}>
                <div className="voucher-option-main"><span className="voucher-option-code">{voucher.code}</span><b>{voucher.name}</b><small>{voucher.discountType === "percent" ? `Diskon ${voucher.discountValue}%` : `Diskon ${rupiah(voucher.discountValue)}`} {Number(voucher.maxDiscount || 0) > 0 ? `• Maks ${rupiah(voucher.maxDiscount)}` : ""}</small></div>
                <div className="voucher-option-meta"><span>Min. {rupiah(voucher.minPurchase || 0)}</span><span>Sisa {remaining}</span><span>{(voucher.paymentMethods || []).map((m) => m === "cash" ? "Tunai" : m.toUpperCase()).join(" / ")}</span></div>
                {!result.valid && <div className="voucher-option-reason">{result.reason}</div>}
              </button>;
            })}
          </div>}
        </div></div>}

        <div className="form-group"><label>Nama Penerima</label><input className="form-input" value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} required /></div>
        <div className="form-group"><label>WhatsApp</label><input className="form-input" value={form.buyerWhatsapp} onChange={(e) => setForm({ ...form, buyerWhatsapp: e.target.value })} required /></div>
        <div className="form-group"><label>Alamat Lengkap</label><textarea className="form-input" rows={2} value={form.buyerAddress} onChange={(e) => setForm({ ...form, buyerAddress: e.target.value })} required /></div>
        <div className="form-group"><label>Metode Pengiriman</label><select className="form-input" value={form.shippingType} onChange={(e) => { const nextShipping = e.target.value; setForm({ ...form, shippingType: nextShipping, paymentMethod: nextShipping === "pickup" ? "cash" : (["transfer","qris","cash"].includes(form.paymentMethod) ? (nextShipping === "same_day" ? form.paymentMethod : (form.paymentMethod === "cash" ? "transfer" : form.paymentMethod)) : "transfer") }); setShippingCheckRequested(false); }}><option value="pickup">Ambil di Tempat (Gratis)</option><option value="same_day">Same Day Lokal</option><option value="jne">JNE</option><option value="pos">POS</option><option value="tiki">TIKI</option><option value="jnt">J&T</option><option value="sicepat">SiCepat</option></select></div>
        {form.shippingType === "pickup" && <div className="form-group"><label>Metode Pembayaran</label><div className="form-input" style={{ background: "#f8fafc", color: "var(--text2)" }}>Tunai saat ambil barang</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Tidak perlu upload bukti pembayaran. Setelah order, pembeli melihat link lokasi toko dan instruksi segera ambil pesanan.</div></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Metode Pembayaran Same Day</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option><option value="cash">Tunai saat barang diterima</option></select></div>}
        {form.shippingType !== "pickup" && form.shippingType !== "same_day" && <div className="form-group"><label>Metode Pembayaran</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option></select></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Lokasi Google Maps Anda</label><div style={{ background: "#FFF8E1", border: "1px solid rgba(245, 158, 11, 0.25)", borderRadius: 10, padding: 12, marginBottom: 10 }}><div style={{ fontWeight: 700, marginBottom: 4 }}>Pilih salah satu cara kirim lokasi</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>Gunakan lokasi otomatis dari HP/browser, atau tempel link Google Maps manual seperti sebelumnya.</div><button type="button" className="btn-primary btn-sm" onClick={useCurrentBuyerLocation} disabled={locationLoading} style={{ width: "100%", justifyContent: "center" }}>{locationLoading ? "Mengambil lokasi..." : "📍 Gunakan Lokasi Saya Otomatis"}</button></div><input className="form-input" placeholder="Atau tempel link Google Maps alamat pengiriman secara manual" value={form.buyerMapsLink} onChange={(e) => { setForm({ ...form, buyerMapsLink: e.target.value }); setShippingCheckRequested(false); }} required />{form.buyerMapsLink?.trim() && <div style={{ fontSize: 12, color: "#10B981", marginTop: 6 }}>Lokasi sudah terisi. Seller akan menerima tombol Buka Maps Pembeli.</div>}<button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerMapsLink.trim()) { setError("Gunakan lokasi otomatis atau tempel link Google Maps Anda dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Penjual sedang menghitung ongkir. Klik Buat Pesanan untuk mengirim permintaan ke seller." : "Klik Cek Ongkir dulu. Setelah itu tombol Buat Pesanan aktif."}</div></div>}
        {needsAddress && <div style={{ background: "#FFF8E1", padding: 12, borderRadius: 8 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>Alamat untuk cek ongkir</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Alamat ekspedisi akan otomatis disimpan ke profil dan terisi saat belanja berikutnya.</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><input className="form-input" placeholder="Desa" value={form.buyerVillage} onChange={(e) => { setForm({ ...form, buyerVillage: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kecamatan" value={form.buyerDistrict} onChange={(e) => { setForm({ ...form, buyerDistrict: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kabupaten" value={form.buyerRegency} onChange={(e) => { setForm({ ...form, buyerRegency: e.target.value }); setShippingCheckRequested(false); }} required /></div><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency) { setError("Isi desa, kecamatan, dan kabupaten dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Permintaan cek ongkir siap dikirim ke seller. Klik Buat Pesanan." : "Klik Cek Ongkir dulu agar seller mendapat perintah cek ongkir."}</div></div>}
      </div><div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Batal</button><button type="submit" className="btn-primary" disabled={loading || (needsSellerQuote && !shippingCheckRequested)}>{loading ? "Memproses..." : "Buat Pesanan"}</button></div></form>
    </div></div>
  );
}
