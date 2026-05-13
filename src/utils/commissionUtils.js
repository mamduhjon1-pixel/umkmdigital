import { getMillis } from "./orderUtils";

export function calcCommission(total, type, value) {
  const normalizedType = type || "percent";
  const normalizedValue = value === undefined || value === null || value === "" ? 10 : value;
  if (normalizedType === "percent") return Math.round(Number(total || 0) * (Number(normalizedValue || 0) / 100));
  if (normalizedType === "fixed") return Number(normalizedValue || 0);
  return Math.round(Number(total || 0) * 0.1);
}


export const OPEN_COMMISSION_STATUSES = ["pending", "partial", "menunggu_approval"];
export const PAYABLE_COMMISSION_STATUSES = ["pending", "partial"];
export const COMMISSION_REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000;
export function isOpenCommissionBill(bill) {
  return OPEN_COMMISSION_STATUSES.includes(bill?.status) && Number(bill?.remaining || bill?.amount || 0) > 0;
}
export function shouldRemindCommissionBill(bill) {
  if (!PAYABLE_COMMISSION_STATUSES.includes(bill?.status)) return false;
  if (Number(bill?.remaining || bill?.amount || 0) <= 0) return false;
  return Date.now() - getMillis(bill?.lastReminderAt) >= COMMISSION_REMINDER_INTERVAL_MS;
}
export function shouldRemindAdminCommissionApproval(bill) {
  if (bill?.status !== "menunggu_approval") return false;
  if (Number(bill?.remaining || bill?.amount || 0) <= 0) return false;
  return Date.now() - getMillis(bill?.lastAdminApprovalReminderAt) >= COMMISSION_REMINDER_INTERVAL_MS;
}
export function sumCommissionDebt(bills = []) {
  return bills.filter(isOpenCommissionBill).reduce((sum, bill) => sum + Number(bill.remaining || bill.amount || 0), 0);
}

export function getCommissionPaidAmount(bill = {}) {
  return Math.max(
    0,
    Number(bill.paidFromBalance || 0),
    Number(bill.autoDeductedFromBalance || 0),
    Number(bill.manualPaidAmount || 0)
  );
}

export function getCommissionRemainingAmount(bill = {}) {
  const explicitRemaining = Number(bill.remaining);
  if (Number.isFinite(explicitRemaining) && explicitRemaining >= 0) return explicitRemaining;
  return Math.max(0, Number(bill.amount || 0) - getCommissionPaidAmount(bill));
}

export function getSafeAvailableBalance(walletData = {}) {
  const balance = Number(walletData?.saldoTersedia || 0);
  return Number.isFinite(balance) ? Math.max(0, balance) : 0;
}
