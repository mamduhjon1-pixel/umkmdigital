import { doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../services/firebase";
import { normalizeStatus } from "./appHelpers";

const ORDER_DELETE_FINAL_STATUSES = ["selesai", "dibatalkan"];

export function canSoftDeleteOrder(order) {
  return ORDER_DELETE_FINAL_STATUSES.includes(normalizeStatus(order?.statusPesanan));
}
export function isOrderHiddenForRole(order, role) {
  if (role === "buyer") return order?.hiddenForBuyer === true;
  if (role === "seller") return order?.hiddenForSeller === true;
  if (role === "admin") return order?.hiddenForAdmin === true;
  return false;
}
export async function softDeleteOrderForRole(orderId, role) {
  if (!orderId || !role) return;
  const fieldMap = {
    buyer: { hiddenForBuyer: true, buyerDeletedAt: serverTimestamp() },
    seller: { hiddenForSeller: true, sellerDeletedAt: serverTimestamp() },
    admin: { hiddenForAdmin: true, adminDeletedAt: serverTimestamp() },
  };
  const payload = fieldMap[role];
  if (!payload) return;
  await updateDoc(doc(db, "orders", orderId), { ...payload, updatedAt: serverTimestamp() });
}
export async function softDeleteOrdersForRole(orderIds = [], role) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (!ids.length || !role) return;
  const fieldMap = {
    buyer: { hiddenForBuyer: true, buyerDeletedAt: serverTimestamp() },
    seller: { hiddenForSeller: true, sellerDeletedAt: serverTimestamp() },
    admin: { hiddenForAdmin: true, adminDeletedAt: serverTimestamp() },
  };
  const payload = fieldMap[role];
  if (!payload) return;
  const batch = writeBatch(db);
  ids.forEach((id) => batch.update(doc(db, "orders", id), { ...payload, updatedAt: serverTimestamp() }));
  await batch.commit();
}