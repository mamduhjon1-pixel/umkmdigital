import { statusLabel } from "../../utils/catalogUtils";

const ORDER_STEPS = [
  { key: "menunggu_pembayaran", label: "Menunggu Bayar", match: (o) => ["menunggu_pembayaran", "menunggu_ongkir"].includes(o?.statusPembayaran) || ["menunggu_pembayaran", "menunggu_ongkir"].includes(o?.statusPesanan) },
  { key: "menunggu_verifikasi", label: "Dicek Admin", match: (o) => ["menunggu_verifikasi", "sudah_dibayar", "tunai"].includes(o?.statusPembayaran) || ["menunggu_verifikasi", "pesanan_masuk"].includes(o?.statusPesanan) },
  { key: "diproses", label: "Diproses", match: (o) => ["diproses", "dikirim", "selesai"].includes(o?.statusPesanan) },
  { key: "dikirim", label: "Dikirim", match: (o) => ["dikirim", "selesai"].includes(o?.statusPesanan) },
  { key: "selesai", label: "Selesai", match: (o) => o?.statusPesanan === "selesai" },
];

export default function OrderTimeline({ order, compact = false }) {
  const canceled = order?.statusPesanan === "dibatalkan";
  const current = statusLabel(order?.statusPesanan || order?.statusPembayaran || "menunggu_pembayaran");
  return (
    <div className={`order-timeline ${compact ? "compact" : ""} ${canceled ? "canceled" : ""}`}>
      <div className="order-timeline-head">
        <span>Tracking Pesanan</span>
        <b className={`badge ${current.cls}`}>{current.label}</b>
      </div>
      {canceled ? (
        <div className="order-timeline-canceled">Pesanan dibatalkan. Stok dan saldo mengikuti alur sistem yang sudah ada.</div>
      ) : (
        <div className="order-timeline-steps">
          {ORDER_STEPS.map((step, idx) => {
            const done = step.match(order);
            return (
              <div key={step.key} className={`order-timeline-step ${done ? "done" : ""}`}>
                <span className="order-timeline-dot">{done ? "✓" : idx + 1}</span>
                <span className="order-timeline-label">{step.label}</span>
              </div>
            );
          })}
        </div>
      )}
      {order?.trackingNumber && <div className="order-timeline-note">Resi: <b>{order.trackingNumber}</b>{order?.expeditionName ? ` • ${order.expeditionName}` : ""}</div>}
    </div>
  );
}
