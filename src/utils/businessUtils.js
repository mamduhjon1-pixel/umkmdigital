import { doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../services/firebase";
import { normalizeStatus } from "./appHelpers";

export function getChatParticipantsKey(ids = []) {
  return ids.filter(Boolean).sort().join("_");
}

export function getAdminSellerChatId(adminId, sellerId) {
  return `admin_seller_${getChatParticipantsKey([adminId, sellerId])}`;
}


export function isActiveSellerAccount(seller) {
  const status = normalizeStatus(seller?.status || "active");
  return seller?.role === "seller" && ["active", "approved"].includes(status) && seller?.commissionBlocked !== true && seller?.isDeleted !== true;
}

export function getOrderSalesTotal(order) {
  const productTotal = Number(order?.productTotal ?? 0);
  if (productTotal > 0) return productTotal;
  const totalAmount = Number(order?.totalAmount ?? 0);
  const shippingCost = Number(order?.shippingCost ?? 0);
  return Math.max(0, totalAmount - shippingCost);
}

export function isCompletedSale(order) {
  return normalizeStatus(order?.statusPesanan) === "selesai";
}

export function getSellerTotalSalesFromOrders(orders = [], sellerId) {
  if (!sellerId) return 0;
  return orders
    .filter((order) => order?.sellerId === sellerId && isCompletedSale(order))
    .reduce((sum, order) => sum + getOrderSalesTotal(order), 0);
}

export function getActiveSellerAvailableBalance(wallets = [], users = []) {
  const activeSellerIds = new Set(users.filter(isActiveSellerAccount).map((seller) => seller.uid || seller.id));
  return wallets
    .filter((wallet) => activeSellerIds.has(wallet.sellerId || wallet.id))
    .reduce((sum, wallet) => sum + Number(wallet.saldoTersedia || 0), 0);
}

export async function recordAdminCommissionOnce(entryId, payload = {}) {
  const amount = Number(payload.amount || 0);
  if (!entryId || amount <= 0) return;

  const entryRef = doc(db, "admin_commission_transactions", entryId);
  const walletRef = doc(db, "admin_wallets", "commission");

  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(entryRef);
    if (existing.exists()) return;

    transaction.set(entryRef, {
      id: entryId,
      amount,
      sellerId: payload.sellerId || null,
      sellerName: payload.sellerName || "",
      orderId: payload.orderId || null,
      billId: payload.billId || null,
      productName: payload.productName || "",
      source: payload.source || "order_commission",
      status: "masuk",
      note: payload.note || "Komisi masuk ke saldo komisi admin",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    transaction.set(walletRef, {
      saldoKomisi: increment(amount),
      totalKomisiMasuk: increment(amount),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}
