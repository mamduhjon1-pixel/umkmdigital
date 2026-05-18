import { normalizeStatus } from "./appHelpers";

export function paymentMethodLabel(method) {
  const m = String(method || "").toLowerCase();
  if (m === "cash" || m === "tunai") return "Tunai / Cash";
  if (m === "qris") return "QRIS";
  if (m === "transfer") return "Transfer";
  return method || "Belum dipilih";
}

export function isCashPayment(orderOrMethod) {
  const method = typeof orderOrMethod === "string" ? orderOrMethod : orderOrMethod?.paymentMethod;
  const paymentStatus = typeof orderOrMethod === "string" ? "" : orderOrMethod?.statusPembayaran;
  return String(method || "").toLowerCase() === "cash" || String(paymentStatus || "").toLowerCase() === "tunai";
}

export function isTransferPayment(orderOrMethod) {
  const method = typeof orderOrMethod === "string" ? orderOrMethod : orderOrMethod?.paymentMethod;
  const m = String(method || "").toLowerCase();
  return m === "transfer" || m === "qris";
}

export function getProductCommissionTotal(order) {
  // Komisi admin dihitung hanya dari total produk (harga x qty), tidak termasuk ongkir.
  const fee = Number(order?.adminFee || 0);
  if (fee > 0) return Math.max(0, fee);
  return Math.max(0, Number(order?.productTotal || 0) - Number(order?.sellerProductAmount || 0));
}

export function getSellerTransferReceivableAmount(order) {
  // Alur voucher final:
  // saldo seller transfer/QRIS = harga setelah promo seller - komisi + ongkir.
  // Voucher marketplace tidak mengurangi hak seller karena ditanggung marketplace/admin.
  const storedReceivable = Number(order?.sellerReceivableAmount || 0);
  if (storedReceivable > 0) return Math.max(0, storedReceivable);

  const storedSellerAmount = Number(order?.sellerAmount || 0);
  if (storedSellerAmount > 0) return Math.max(0, storedSellerAmount);

  const productBase = Number(order?.sellerDiscountedProductTotal || order?.commissionBase || order?.productTotal || 0);
  const adminFee = getProductCommissionTotal(order);
  const shippingCost = Number(order?.shippingCost || 0);
  const computed = productBase - adminFee + shippingCost;
  return Math.max(0, computed);
}

export function getSellerReceivableAmount(order) {
  // Tunai tidak masuk saldo seller karena uang diterima langsung oleh seller.
  if (isCashPayment(order)) return 0;
  if (!isTransferPayment(order)) return 0;
  return getSellerTransferReceivableAmount(order);
}

export function getAdminCommissionIncome(order) {
  const fee = getProductCommissionTotal(order);
  if (fee <= 0 || order?.statusPesanan !== "selesai") return 0;
  if (isTransferPayment(order)) return fee;
  if (isCashPayment(order)) {
    if (["approved", "auto_paid", "autopaid", "paid"].includes(order?.cashCommissionStatus)) return fee;
    const paid = Number(order?.cashCommissionPaidFromBalance || 0);
    const remaining = Number(order?.cashCommissionRemaining || 0);
    return Math.min(fee, Math.max(paid, fee - remaining));
  }
  return 0;
}

export function getCashMarketplaceVoucherCompensationAmount(order) {
  // COD/Tunai + voucher marketplace:
  // buyer membayar ke seller setelah diskon marketplace.
  // Jika uang cash yang diterima seller lebih kecil dari hak seller bersih,
  // selisihnya menjadi kompensasi saldo dari marketplace.
  if (!isCashPayment(order)) return 0;
  const sellerAmount = Number(order?.sellerAmount || 0);
  const cashReceived = Number(order?.cashReceivedBySeller || order?.totalAmount || 0);
  return Math.max(0, sellerAmount - cashReceived);
}

export function getCashCommissionDueAmount(order) {
  // COD/Tunai tanpa payment gateway:
  // seller menerima uang langsung dari buyer, lalu hanya membayar selisih
  // jika cash yang diterima melebihi hak seller bersih.
  // Voucher marketplace otomatis mengurangi tagihan komisi COD,
  // dan jika voucher lebih besar dari komisi, sisanya dikompensasi ke saldo seller.
  if (!isCashPayment(order)) return 0;
  const stored = Number(order?.cashCommissionAmount || 0);
  if (stored > 0) return Math.max(0, stored);
  const sellerAmount = Number(order?.sellerAmount || 0);
  const cashReceived = Number(order?.cashReceivedBySeller || order?.totalAmount || 0);
  return Math.max(0, cashReceived - sellerAmount);
}

export function canBuyerCancelOrder(order) {
  const statusPesanan = normalizeStatus(order?.statusPesanan);
  const statusPembayaran = normalizeStatus(order?.statusPembayaran);
  const shippingType = order?.shippingType || "";
  const paymentMethod = order?.paymentMethod || "";

  if (!order?.id) return false;
  if (["dikirim", "selesai", "dibatalkan", "ditolak", "pembatalan_diajukan"].includes(statusPesanan)) return false;
  return true;
}
