export function getMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function getOrderMillis(item) {
  return Math.max(
    getMillis(item?.createdAt),
    getMillis(item?.updatedAt),
    getMillis(item?.paymentProofUploadedAt),
    getMillis(item?.processedAt),
    getMillis(item?.shippingQuotedAt),
    getMillis(item?.verifiedAt),
    getMillis(item?.cancelRequestedAt),
    getMillis(item?.cancelApprovedAt),
    getMillis(item?.cancelRejectedAt),
    getMillis(item?.shippedAt),
    getMillis(item?.receivedAt)
  );
}

export function sortNewest(items) {
  return [...items].sort((a, b) => {
    const diff = getOrderMillis(b) - getOrderMillis(a);
    if (diff !== 0) return diff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}


export function getOrderStatusRank(order) {
  const status = order?.statusPesanan || order?.statusPembayaran || "";
  const rank = {
    pembatalan_diajukan: 0,
    menunggu_ongkir: 1,
    menunggu_pembayaran: 2,
    menunggu_verifikasi: 3,
    sudah_dibayar: 4,
    pesanan_masuk: 5,
    diproses: 6,
    dikirim: 7,
    selesai: 8,
    dibatalkan: 9,
    ditolak: 10,
  };
  return rank[status] ?? 99;
}

export function sortOrdersByStage(items = []) {
  return [...items].sort((a, b) => {
    const stageDiff = getOrderStatusRank(a) - getOrderStatusRank(b);
    if (stageDiff !== 0) return stageDiff;
    const timeDiff = getOrderMillis(b) - getOrderMillis(a);
    if (timeDiff !== 0) return timeDiff;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

