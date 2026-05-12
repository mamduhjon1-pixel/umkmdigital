import { useState } from "react";
import { deleteDoc, doc, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";

/* ─── NOTIFICATION PAGE ──────────────────────── */
const NOTIF_ICONS = {
  seller_register: "🧑‍💼", user_register: "👤", order_new: "🛒", order_placed: "✅",
  order_update: "📦", order_done: "🎉", payment_proof: "📄", payment_proof_sent: "📤",
  payment_approved: "✅", payment_rejected: "❌", product_new: "📦", withdraw_new: "💸", commission_bill: "💸", commission_bill_reminder: "⏰", commission_proof: "🧾", commission_approved: "✅", commission_cancelled: "❌", commission_auto_paid: "⚡", commission_debt_auto_pay: "⚡",
};
const NOTIF_COLORS = {
  seller_register: "#6366F1", user_register: "#8B5CF6", order_new: "#EE4D2D", order_placed: "#10B981",
  order_update: "#F59E0B", order_done: "#10B981", payment_proof: "#3B82F6", payment_proof_sent: "#3B82F6",
  payment_approved: "#10B981", payment_rejected: "#EF4444", product_new: "#F59E0B", withdraw_new: "#EE4D2D", commission_bill: "#EF4444", commission_bill_reminder: "#F59E0B", commission_proof: "#F59E0B", commission_approved: "#10B981", commission_cancelled: "#EF4444", commission_auto_paid: "#10B981", commission_debt_auto_pay: "#10B981",
};
const NOTIF_LABELS = {
  commission_bill: "Tagihan komisi",
  commission_bill_reminder: "Pengingat komisi",
  commission_auto_paid: "Auto debit komisi",
  commission_debt_auto_pay: "Auto debit komisi",
  commission_proof: "Bukti komisi",
  commission_approved: "Komisi disetujui",
  commission_cancelled: "Komisi dibatalkan",
  chat_message: "Chat",
  order_new: "Pesanan",
  order_update: "Status pesanan",
  order_done: "Pesanan selesai",
  withdraw_new: "Penarikan saldo",
};
function getNotifLabel(type) {
  return NOTIF_LABELS[type] || "Notifikasi";
}

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} hari lalu`;
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

export default function NotificationPage({ notifications }) {
  const [notifBusy, setNotifBusy] = useState(false);
  async function markRead(id) {
    await updateDoc(doc(db, "notifications", id), { isRead: true, read: true });
  }
  async function deleteNotif(id) {
    await deleteDoc(doc(db, "notifications", id));
  }
  async function deleteAll() {
    if (!notifications.length || notifBusy) return;
    if (!confirm("Hapus semua notifikasi?")) return;
    setNotifBusy(true);
    try {
      await Promise.all(notifications.map((n) => deleteDoc(doc(db, "notifications", n.id))));
    } finally {
      setNotifBusy(false);
    }
  }
  async function markAllRead() {
    const unreadItems = notifications.filter((n) => !n.isRead && !n.read);
    if (!unreadItems.length || notifBusy) return;
    setNotifBusy(true);
    try {
      await Promise.all(unreadItems.map((n) => updateDoc(doc(db, "notifications", n.id), { isRead: true, read: true })));
    } finally {
      setNotifBusy(false);
    }
  }

  const unread = notifications.filter((n) => !n.isRead);
  const sorted = [...notifications].sort((a, b) => {
    const ta = a.createdAt?.seconds || 0;
    const tb = b.createdAt?.seconds || 0;
    return tb - ta;
  });

  return (
    <div className="page-container" style={{ maxWidth: 680 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 22, fontWeight: 800 }}>Notifikasi</div>
            {unread.length > 0 && (
              <span style={{ background: "var(--orange)", color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20 }}>
                {unread.length} belum dibaca
              </span>
            )}
          </div>
          {notifications.length > 0 && (
            <div style={{ display: "flex", gap: 8 }}>
              {unread.length > 0 && (
                <button className="btn-ghost btn-sm" onClick={markAllRead} disabled={notifBusy} style={{ fontSize: 12 }}>
                  {notifBusy ? "Memproses..." : "✓ Tandai Semua Dibaca"}
                </button>
              )}
              <button className="btn-ghost btn-sm" onClick={deleteAll} disabled={notifBusy} style={{ fontSize: 12, color: "#EF4444", borderColor: "#FECACA" }}>
                {notifBusy ? "Memproses..." : "🗑 Hapus Semua"}
              </button>
            </div>
          )}
        </div>
        {unread.length > 0 && (
          <p style={{ fontSize: 13, color: "var(--text3)", marginTop: 6 }}>
            Kamu memiliki {unread.length} notifikasi baru yang belum dibaca.
          </p>
        )}
      </div>

      {/* Empty state */}
      {sorted.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">🔔</div>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Belum ada notifikasi</p>
          <p style={{ fontSize: 13, color: "var(--text3)" }}>Semua aktivitas akun kamu akan muncul di sini.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {sorted.map((n) => {
            const icon = NOTIF_ICONS[n.type] || "🔔";
            const color = NOTIF_COLORS[n.type] || "var(--orange)";
            return (
              <div
                key={n.id}
                className="card"
                style={{
                  padding: "14px 16px",
                  borderLeft: `4px solid ${n.isRead ? "var(--border)" : color}`,
                  background: n.isRead ? "#fff" : "#FFFBF9",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  {/* Icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                    background: n.isRead ? "#F3F4F6" : `${color}18`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18,
                  }}>
                    {icon}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: n.isRead ? "var(--text1)" : "#111", lineHeight: 1.3 }}>
                        {n.title}
                        {!n.isRead && (
                          <span style={{ display: "inline-block", width: 7, height: 7, background: color, borderRadius: "50%", marginLeft: 6, verticalAlign: "middle" }} />
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text3)", whiteSpace: "nowrap", flexShrink: 0 }}>
                        {timeAgo(n.createdAt)}
                      </div>
                    </div>
                    <div style={{ margin: "4px 0 8px" }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4,
                        padding: "3px 8px", borderRadius: 999,
                        background: `${color}12`, color,
                        fontSize: 11, fontWeight: 700,
                      }}>
                        {getNotifLabel(n.type)}
                      </span>
                    </div>
                    <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, margin: 0 }}>{n.message}</p>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                      {!n.isRead && (
                        <button
                          onClick={() => markRead(n.id)}
                          style={{
                            background: "none", border: "none", cursor: "pointer",
                            fontSize: 12, color: color, fontWeight: 600, padding: "2px 0",
                          }}
                        >
                          ✓ Tandai Dibaca
                        </button>
                      )}
                      {!n.isRead && <span style={{ color: "var(--border)", fontSize: 12 }}>|</span>}
                      <button
                        onClick={() => deleteNotif(n.id)}
                        style={{
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 12, color: "#9CA3AF", fontWeight: 500, padding: "2px 0",
                        }}
                      >
                        Hapus
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ height: 32 }} />
    </div>
  );
}
