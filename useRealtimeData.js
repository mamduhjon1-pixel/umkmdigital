import { useState } from "react";
import { collection, doc, increment, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { rupiah } from "../../utils/appHelpers";
import { statusLabel } from "../../utils/catalogUtils";

export default function AdminWithdraw({ withdrawals }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? withdrawals : withdrawals.filter((w) => w.status === filter);

  async function updateStatus(w, status) {
    if (w.status === status) return;
    if (w.status === "paid" || w.status === "rejected") {
      alert("Penarikan ini sudah final dan tidak bisa diubah lagi.");
      return;
    }

    const amount = Number(w.amount || 0);
    const batch = writeBatch(db);
    const withdrawalRef = doc(db, "withdrawals", w.id);
    const walletRef = doc(db, "seller_wallets", w.sellerId);
    const txRef = doc(collection(db, "wallet_transactions"));

    batch.update(withdrawalRef, { status, updatedAt: serverTimestamp() });

    if (status === "approved") {
      batch.update(withdrawalRef, { approvedAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_approved", amount, note: "Penarikan disetujui admin", createdAt: serverTimestamp() });
    }

    if (status === "paid") {
      batch.update(walletRef, { saldoTertahan: increment(-amount), totalDitarik: increment(amount), updatedAt: serverTimestamp() });
      batch.update(withdrawalRef, { paidAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_paid", amount, note: "Penarikan berhasil dibayarkan", createdAt: serverTimestamp() });
    }

    if (status === "rejected") {
      batch.update(walletRef, { saldoTersedia: increment(amount), saldoTertahan: increment(-amount), updatedAt: serverTimestamp() });
      batch.update(withdrawalRef, { rejectedAt: serverTimestamp() });
      batch.set(txRef, { sellerId: w.sellerId, withdrawalId: w.id, type: "withdraw_rejected_return", amount, note: "Penarikan ditolak/cancel, saldo dikembalikan ke saldo tersedia", createdAt: serverTimestamp() });
    }

    try {
      await batch.commit();
      alert(status === "rejected" ? "Penarikan ditolak dan saldo dikembalikan" : "Status penarikan diubah");
    } catch (error) {
      console.error("Gagal mengubah status penarikan:", error);
      alert("Gagal mengubah status penarikan. Coba lagi.");
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>💸 Penarikan Seller</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","pending","approved","paid","rejected"].map((s) => {
          const info = s === "all" ? { label: "Semua" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
                borderColor: filter === s ? "var(--orange)" : "var(--border)",
                background: filter === s ? "var(--orange-light)" : "#fff",
                color: filter === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "all" ? withdrawals.length : withdrawals.filter((w) => w.status === s).length) > 0 ? ` (${s === "all" ? withdrawals.length : withdrawals.filter((w) => w.status === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">💸</div><p>Tidak ada penarikan</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Seller</th><th>Jumlah</th><th>Rekening</th><th>Status</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {filtered.map((w) => {
                const s = statusLabel(w.status);
                return (
                  <tr key={w.id}>
                    <td style={{ fontWeight: 500 }}>{w.sellerName}</td>
                    <td style={{ color: "var(--orange)", fontWeight: 700 }}>{rupiah(w.amount)}</td>
                    <td style={{ fontSize: 12 }}>
                      <div>{w.bankName}</div>
                      <div style={{ color: "var(--text3)" }}>{w.accountNumber} a.n {w.accountHolder}</div>
                    </td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button className="btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(w.accountNumber); alert("Disalin!"); }}>📋 Salin Rek</button>
                        {w.status === "pending" && <button className="btn-primary btn-sm" onClick={() => updateStatus(w, "approved")}>Setujui</button>}
                        {w.status === "approved" && <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => updateStatus(w, "paid")}>Sudah Dibayar</button>}
                        {w.status !== "rejected" && w.status !== "paid" && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => updateStatus(w, "rejected")}>Tolak</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
