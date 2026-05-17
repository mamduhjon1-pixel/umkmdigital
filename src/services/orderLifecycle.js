import { collection, doc, getDoc, getDocs, increment, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "./firebase";
import { rupiah } from "../utils/appHelpers";
import { getMillis } from "../utils/orderUtils";
import { getSafeAvailableBalance, getCommissionPaidAmount, getCommissionRemainingAmount } from "../utils/commissionUtils";
import { isCashPayment, isTransferPayment, getSellerReceivableAmount, getProductCommissionTotal, getCashMarketplaceVoucherCompensationAmount, getCashCommissionDueAmount } from "../utils/paymentUtils";

export async function autoDeductCommissionBills() {
  // Legacy helper disimpan agar kompatibel dengan kode lama.
  // Alur final sekarang diproses per order tunai melalui settleCashCommissionOnCompletion().
  return;
}

export async function createCashCommissionBill(orderId, orderData, createNotif) {
  const existingSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
  if (!existingSnap.empty) return;

  const amount = getCashCommissionDueAmount(orderData);
  if (!amount || amount <= 0 || !orderData.sellerId) return;

  const billRef = doc(collection(db, "komisi_tagihan"));
  await setDoc(billRef, {
    sellerId: orderData.sellerId,
    sellerName: orderData.sellerName || "",
    orderId,
    productName: orderData.productName || "",
    amount,
    remaining: amount,
    paidFromBalance: 0,
    autoDeductedFromBalance: 0,
    manualPaidAmount: 0,
    status: "pending",
    source: "cash_order",
    note: "Tagihan komisi tunai dibuat otomatis berdasarkan cash yang diterima seller dikurangi hak seller bersih. Voucher marketplace COD otomatis mengurangi tagihan komisi, dan jika lebih besar dari komisi maka selisihnya menjadi kompensasi saldo seller.",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, "orders", orderId), {
    cashCommissionAmount: amount,
    cashCommissionPaidFromBalance: 0,
    cashCommissionRemaining: amount,
    cashCommissionStatus: "pending",
    commissionBillId: billRef.id,
    updatedAt: serverTimestamp(),
  });

  if (createNotif) {
    await createNotif({
      role: "seller",
      userId: orderData.sellerId,
      type: "commission_bill",
      title: "Tagihan Komisi Tunai Dibuat",
      message: `Tagihan komisi tunai ${rupiah(amount)} untuk ${orderData.productName} sudah dibuat. Jika ada voucher marketplace COD, tagihan sudah otomatis disesuaikan agar hak seller tetap aman.`,
      orderId,
    });
  }
}

export async function settleCashCommissionOnCompletion(orderId, orderData, createNotif) {
  if (!orderId || !orderData?.sellerId || !isCashPayment(orderData)) return;

  const amount = getCashCommissionDueAmount(orderData);
  if (!amount || amount <= 0) return;

  const existingSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
  const billRef = existingSnap.empty ? doc(collection(db, "komisi_tagihan")) : doc(db, "komisi_tagihan", existingSnap.docs[0].id);
  const walletRef = doc(db, "seller_wallets", orderData.sellerId);
  const orderRef = doc(db, "orders", orderId);
  const txRef = doc(db, "wallet_transactions", `cash_commission_auto_deduct_${orderId}`);

  const result = await runTransaction(db, async (transaction) => {
    const orderSnap = await transaction.get(orderRef);
    const freshOrder = orderSnap.data() || {};
    if (freshOrder.cashCommissionSettlementDone === true) {
      return { skipped: true };
    }

    const walletSnap = await transaction.get(walletRef);
    const billSnap = await transaction.get(billRef);
    const walletData = walletSnap.exists() ? walletSnap.data() : {};
    const currentBalance = getSafeAvailableBalance(walletData);

    const existingBill = billSnap.exists() ? billSnap.data() || {} : {};
    const existingPaid = getCommissionPaidAmount(existingBill);
    const currentRemaining = billSnap.exists()
      ? getCommissionRemainingAmount(existingBill)
      : Math.max(0, amount - existingPaid);

    if (currentRemaining <= 0 || ["auto_paid", "autopaid", "approved", "cancelled"].includes(String(existingBill.status || ""))) {
      transaction.set(orderRef, {
        cashCommissionSettlementDone: true,
        cashCommissionStatus: existingBill.status || "auto_paid",
        cashCommissionRemaining: 0,
        cashCommissionPaidFromBalance: Math.max(existingPaid, amount),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      return { skipped: true, alreadySettled: true };
    }

    const deduct = Math.min(currentBalance, currentRemaining);
    const remaining = Math.max(0, currentRemaining - deduct);
    const status = remaining <= 0 ? "auto_paid" : deduct > 0 ? "partial" : "pending";
    const sellerName = orderData.sellerName || freshOrder.sellerName || existingBill.sellerName || "";
    const productName = orderData.productName || freshOrder.productName || existingBill.productName || "";
    const paidAfter = existingPaid + deduct;

    if (!walletSnap.exists()) {
      transaction.set(walletRef, {
        sellerId: orderData.sellerId,
        sellerName,
        saldoTersedia: 0,
        saldoTertahan: 0,
        totalPenjualan: 0,
        totalDitarik: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    if (deduct > 0) {
      transaction.set(walletRef, {
        saldoTersedia: increment(-deduct),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(txRef, {
        sellerId: orderData.sellerId,
        billId: billRef.id,
        orderId,
        type: "cash_commission_auto_deduct",
        amount: deduct,
        totalCommission: amount,
        remaining,
        balanceBefore: currentBalance,
        balanceAfter: Math.max(0, currentBalance - deduct),
        note: `Komisi tunai dipotong otomatis dari saldo seller ${rupiah(deduct)}. Sisa tagihan ${rupiah(remaining)}.`,
        createdAt: serverTimestamp(),
      }, { merge: true });
    }

    const billPayload = {
      sellerId: orderData.sellerId,
      sellerName,
      orderId,
      productName,
      amount,
      remaining,
      paidFromBalance: paidAfter,
      autoDeductedFromBalance: paidAfter,
      manualPaidAmount: Number(existingBill.manualPaidAmount || 0),
      status,
      source: "cash_order",
      settledAtOrderComplete: true,
      autoDeductedAt: deduct > 0 ? serverTimestamp() : existingBill.autoDeductedAt || null,
      note: remaining <= 0
        ? `Komisi tunai ${rupiah(amount)} sudah lunas otomatis dipotong dari saldo seller.`
        : `Komisi tunai ${rupiah(amount)}: dipotong otomatis ${rupiah(deduct)} dari saldo seller, sisa tagihan ${rupiah(remaining)}.`,
      createdAt: existingBill.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    transaction.set(billRef, billPayload, { merge: true });

    transaction.set(orderRef, {
      cashCommissionAmount: amount,
      cashCommissionPaidFromBalance: paidAfter,
      cashCommissionRemaining: remaining,
      cashCommissionStatus: status,
      cashCommissionSettlementDone: remaining <= 0,
      commissionBillId: billRef.id,
      updatedAt: serverTimestamp(),
    }, { merge: true });

    return { sellerId: orderData.sellerId, amount, deduct, remaining, status, billId: billRef.id, productName };
  });

  if (createNotif && result && !result.skipped) {
    if (result.remaining <= 0) {
      await createNotif({
        role: "seller",
        userId: result.sellerId,
        type: "commission_auto_paid",
        title: "Komisi Tunai Lunas Otomatis",
        message: `Komisi tunai ${rupiah(result.amount)} untuk ${result.productName || "pesanan"} sudah otomatis dipotong dari saldo seller. Tidak ada sisa tagihan.`,
        billId: result.billId,
        orderId,
      });
    } else {
      await createNotif({
        role: "seller",
        userId: result.sellerId,
        type: "commission_bill",
        title: "Sisa Tagihan Komisi Tunai",
        message: `Komisi tunai ${rupiah(result.amount)}: saldo dipotong otomatis ${rupiah(result.deduct)}, sisa tagihan ${rupiah(result.remaining)}. Silakan bayar sisa tagihan dan upload bukti.`,
        billId: result.billId,
        orderId,
      });
    }
  }
}
export async function autoPayOpenCommissionBillsFromSellerBalance(sellerId, createNotif, reason = "Saldo tersedia masuk") {
  if (!sellerId) return { totalDeducted: 0, paidBills: [], partialBills: [] };

  const openSnap = await getDocs(query(collection(db, "komisi_tagihan"), where("sellerId", "==", sellerId)));
  const candidateDocs = openSnap.docs
    .map((billDoc) => ({ id: billDoc.id, ref: doc(db, "komisi_tagihan", billDoc.id), data: billDoc.data() || {} }))
    .filter(({ data }) => ["pending", "partial"].includes(String(data.status || "")) && Number(data.remaining || data.amount || 0) > 0)
    .sort((a, b) => getMillis(a.data.createdAt) - getMillis(b.data.createdAt));

  if (candidateDocs.length === 0) return { totalDeducted: 0, paidBills: [], partialBills: [] };

  const walletRef = doc(db, "seller_wallets", sellerId);
  const txRefs = candidateDocs.map(({ id }) => doc(db, "wallet_transactions", `commission_debt_auto_pay_${id}_${Date.now()}`));

  const result = await runTransaction(db, async (transaction) => {
    const walletSnap = await transaction.get(walletRef);
    let availableBalance = walletSnap.exists() ? getSafeAvailableBalance(walletSnap.data()) : 0;
    if (availableBalance <= 0) return { totalDeducted: 0, paidBills: [], partialBills: [] };

    let totalDeducted = 0;
    const paidBills = [];
    const partialBills = [];

    for (let i = 0; i < candidateDocs.length; i += 1) {
      if (availableBalance <= 0) break;
      const { id, ref, data: cachedData } = candidateDocs[i];
      const freshSnap = await transaction.get(ref);
      if (!freshSnap.exists()) continue;
      const freshData = freshSnap.data() || {};
      const status = String(freshData.status || "");
      if (!["pending", "partial"].includes(status)) continue;

      const remainingBefore = getCommissionRemainingAmount(freshData);
      if (remainingBefore <= 0) continue;

      const deduct = Math.min(availableBalance, remainingBefore);
      const remainingAfter = Math.max(0, remainingBefore - deduct);
      const nextStatus = remainingAfter <= 0 ? "auto_paid" : "partial";
      const paidBefore = getCommissionPaidAmount(freshData);
      const paidAfter = paidBefore + deduct;

      transaction.update(ref, {
        paidFromBalance: paidAfter,
        autoDeductedFromBalance: paidAfter,
        remaining: remainingAfter,
        status: nextStatus,
        lastAutoPaidAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        note: remainingAfter <= 0
          ? `Tagihan komisi ${rupiah(Number(freshData.amount || 0))} lunas otomatis dari saldo seller.`
          : `Tagihan komisi dibayar sebagian otomatis ${rupiah(deduct)} dari saldo seller. Sisa ${rupiah(remainingAfter)}.`,
      });

      if (freshData.orderId) {
        transaction.set(doc(db, "orders", freshData.orderId), {
          cashCommissionPaidFromBalance: paidAfter,
          cashCommissionRemaining: remainingAfter,
          cashCommissionStatus: nextStatus,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }

      transaction.set(txRefs[i], {
        sellerId,
        billId: id,
        orderId: freshData.orderId || null,
        type: "commission_debt_auto_pay",
        amount: deduct,
        remainingBefore,
        remainingAfter,
        paidBefore,
        paidAfter,
        balanceBefore: availableBalance,
        balanceAfter: Math.max(0, availableBalance - deduct),
        source: reason,
        note: `Auto bayar tagihan komisi dari saldo tersedia seller sebesar ${rupiah(deduct)}.`,
        createdAt: serverTimestamp(),
      });

      availableBalance -= deduct;
      totalDeducted += deduct;
      const item = {
        billId: id,
        orderId: freshData.orderId || null,
        productName: freshData.productName || cachedData.productName || "tagihan komisi",
        amount: Number(freshData.amount || cachedData.amount || 0),
        deduct,
        remaining: remainingAfter,
      };
      if (remainingAfter <= 0) paidBills.push(item);
      else partialBills.push(item);
    }

    if (totalDeducted > 0) {
      transaction.set(walletRef, {
        saldoTersedia: increment(-totalDeducted),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    return { totalDeducted, paidBills, partialBills };
  });

  if (result?.totalDeducted > 0 && createNotif) {
    const paidCount = result.paidBills?.length || 0;
    const partialCount = result.partialBills?.length || 0;
    await createNotif({
      role: "seller",
      userId: sellerId,
      type: "commission_auto_paid",
      title: paidCount > 0 && partialCount === 0 ? "Tagihan Komisi Lunas Otomatis" : "Tagihan Komisi Terbayar Otomatis",
      message: `${rupiah(result.totalDeducted)} otomatis dipotong dari saldo tersedia untuk membayar tagihan komisi. Lunas: ${paidCount}, sebagian: ${partialCount}.`,
    });
  }

  return result || { totalDeducted: 0, paidBills: [], partialBills: [] };
}



export async function recomputeProductRating(productId) {
  if (!productId) return;
  const snap = await getDocs(query(collection(db, "reviews"), where("productId", "==", productId)));
  const list = snap.docs.map((d) => d.data());
  const total = list.length;
  const avg = total ? list.reduce((sum, r) => sum + Number(r.rating || 0), 0) / total : 0;
  await setDoc(doc(db, "products", productId), {
    averageRating: Number(avg.toFixed(1)),
    ratingCount: total,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}



export async function resolveCheckoutProduct(item) {
  const itemId = String(item?.id || item?.productId || "");
  let merged = { ...(item || {}) };

  if (itemId && (!merged.sellerId || !merged.price || !merged.productName)) {
    try {
      const productSnap = await getDoc(doc(db, "products", itemId));
      if (productSnap.exists()) {
        merged = { id: productSnap.id, ...productSnap.data(), ...merged };
        // Keep fresh product fields when cart contains empty/invalid values.
        const fresh = productSnap.data();
        if (!merged.sellerId && fresh.sellerId) merged.sellerId = fresh.sellerId;
        if (!merged.productName && fresh.productName) merged.productName = fresh.productName;
        if (!merged.imageUrl && fresh.imageUrl) merged.imageUrl = fresh.imageUrl;
        if (!Number(merged.price || 0) && Number(fresh.price || 0)) merged.price = fresh.price;
        if (!merged.sellerName && fresh.sellerName) merged.sellerName = fresh.sellerName;
        if (!merged.sellerMapLink && fresh.sellerMapLink) merged.sellerMapLink = fresh.sellerMapLink;
        if (!merged.sellerAddress && fresh.sellerAddress) merged.sellerAddress = fresh.sellerAddress;
        if (!merged.commissionType && fresh.commissionType) merged.commissionType = fresh.commissionType;
        if (!merged.commissionValue && fresh.commissionValue) merged.commissionValue = fresh.commissionValue;
      }
    } catch (error) {
      console.error("Gagal mengambil ulang data produk checkout:", error);
    }
  }

  return merged;
}



export async function creditCashMarketplaceVoucherCompensationOnce(orderId, orderData, createNotif) {
  if (!orderId || !orderData?.sellerId || !isCashPayment(orderData)) return;
  if (orderData.marketplaceVoucherCompensationCredited === true) return;

  const compensationAmount = getCashMarketplaceVoucherCompensationAmount(orderData);
  if (!compensationAmount || compensationAmount <= 0) return;

  const walletRef = doc(db, "seller_wallets", orderData.sellerId);
  const walletSnap = await getDoc(walletRef);

  if (!walletSnap.exists()) {
    await setDoc(walletRef, {
      sellerId: orderData.sellerId,
      sellerName: orderData.sellerName || "",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  const batch = writeBatch(db);
  batch.set(walletRef, {
    sellerId: orderData.sellerId,
    sellerName: orderData.sellerName || "",
    saldoTersedia: increment(compensationAmount),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(doc(collection(db, "wallet_transactions")), {
    sellerId: orderData.sellerId,
    orderId,
    type: "marketplace_voucher_cash_compensation",
    amount: compensationAmount,
    marketplaceVoucherCode: orderData.marketplaceVoucherCode || orderData.voucherCode || "",
    marketplaceVoucherDiscount: Number(orderData.marketplaceVoucherDiscount || orderData.voucherDiscountAmount || 0),
    cashReceivedBySeller: Number(orderData.cashReceivedBySeller || orderData.totalAmount || 0),
    sellerAmount: Number(orderData.sellerAmount || 0),
    adminFee: getProductCommissionTotal(orderData),
    note: "Kompensasi voucher marketplace untuk order tunai/COD. Buyer membayar ke seller setelah diskon, selisih hak seller otomatis masuk saldo seller.",
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, "orders", orderId), {
    marketplaceVoucherSellerCompensationAmount: compensationAmount,
    marketplaceVoucherCompensationCredited: true,
    marketplaceVoucherCompensationCreditedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  await batch.commit();

  if (createNotif) {
    await createNotif({
      role: "seller",
      userId: orderData.sellerId,
      type: "voucher_compensation",
      title: "Kompensasi Voucher Marketplace Masuk",
      message: `Kompensasi voucher marketplace ${rupiah(compensationAmount)} untuk ${orderData.productName || "pesanan"} sudah masuk ke saldo seller.`,
      orderId,
    });
  }
}

export async function creditSellerBalanceOnce(orderId, orderData, createNotif) {
  if (!orderId || !orderData?.sellerId) return;
  if (orderData.balanceCredited === true) return;

  // Pembayaran tunai tidak masuk saldo seller karena uang produk diterima langsung oleh seller.
  // Saldo seller hanya diisi untuk order transfer/QRIS saat order sudah selesai.
  if (!isTransferPayment(orderData) || isCashPayment(orderData)) return;

  const sellerAmount = getSellerReceivableAmount(orderData);
  const productTotal = Number(orderData.sellerDiscountedProductTotal || orderData.commissionBase || orderData.productTotal || 0);
  if (sellerAmount <= 0) return;

  const walletRef = doc(db, "seller_wallets", orderData.sellerId);
  const walletSnap = await getDoc(walletRef);

  if (!walletSnap.exists()) {
    await setDoc(walletRef, {
      sellerId: orderData.sellerId,
      sellerName: orderData.sellerName || "",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  const batch = writeBatch(db);
  batch.set(walletRef, {
    sellerId: orderData.sellerId,
    sellerName: orderData.sellerName || "",
    saldoTersedia: increment(sellerAmount),
    totalPenjualan: increment(productTotal),
    updatedAt: serverTimestamp(),
  }, { merge: true });

  batch.set(doc(collection(db, "wallet_transactions")), {
    sellerId: orderData.sellerId,
    orderId,
    type: "transfer_order_completed_credit",
    amount: sellerAmount,
    productTotal,
    adminFee: getProductCommissionTotal(orderData),
    shippingCost: Number(orderData.shippingCost || 0),
    note: "Saldo seller transfer/QRIS = harga setelah promo seller - komisi + ongkir. Voucher marketplace ditanggung admin, bukan mengurangi hak seller.",
    createdAt: serverTimestamp(),
  });

  batch.update(doc(db, "orders", orderId), {
    balanceCredited: true,
    balanceCreditedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function completeOrderAndCreditSeller(order, extra = {}, createNotif) {
  if (!order?.id) return;
  await updateDoc(doc(db, "orders", order.id), {
    statusPesanan: "selesai",
    receivedAt: serverTimestamp(),
    soldCounted: true,
    updatedAt: serverTimestamp(),
    ...extra,
  });

  const completedOrderData = { ...order, statusPesanan: "selesai", ...extra };
  await creditSellerBalanceOnce(order.id, completedOrderData, createNotif);
  await creditCashMarketplaceVoucherCompensationOnce(order.id, completedOrderData, createNotif);
  await settleCashCommissionOnCompletion(order.id, completedOrderData, createNotif);
  await autoPayOpenCommissionBillsFromSellerBalance(order.sellerId, createNotif, isTransferPayment(completedOrderData) ? "Saldo order transfer/QRIS masuk" : "Cek saldo setelah pesanan selesai");

  if (order.productId && !order.soldCounted) {
    try {
      await setDoc(doc(db, "products", order.productId), {
        soldCount: increment(Number(order.quantity || 1)),
        totalSold: increment(Number(order.quantity || 1)),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error("Gagal update jumlah terjual:", error);
    }
  }
}

export async function restoreProductStockOnce(order) {
  if (!order?.id || !order?.productId || order.stockRestored === true) return;
  const qty = Number(order.quantity || 0);
  if (qty <= 0) return;
  const batch = writeBatch(db);
  batch.set(doc(db, "products", order.productId), { stock: increment(qty), updatedAt: serverTimestamp() }, { merge: true });
  batch.update(doc(db, "orders", order.id), { stockRestored: true, stockRestoredAt: serverTimestamp(), updatedAt: serverTimestamp() });
  await batch.commit();
}

export async function cancelCashCommissionBillForOrder(orderId) {
  if (!orderId) return;
  try {
    const snap = await getDocs(query(collection(db, "komisi_tagihan"), where("orderId", "==", orderId)));
    await Promise.all(snap.docs.map((billDoc) => updateDoc(doc(db, "komisi_tagihan", billDoc.id), {
      status: "cancelled",
      remaining: 0,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })));
  } catch (error) {
    console.error("Gagal membatalkan tagihan komisi order:", error);
  }
}
