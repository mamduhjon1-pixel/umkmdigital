import { useState } from "react";
import { addDoc, collection, doc, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { uploadImageToCloudinary } from "../../services/cloudinary";
import { hasPaymentProof, isOrderStatus, normalizeStatus, rupiah } from "../../utils/appHelpers";
import { sortNewest } from "../../utils/orderUtils";
import { canSoftDeleteOrder, isOrderHiddenForRole, softDeleteOrderForRole, softDeleteOrdersForRole } from "../../utils/orderActions";
import { statusLabel, copyToClipboard } from "../../utils/catalogUtils";
import { canBuyerCancelOrder } from "../../utils/paymentUtils";
import { completeOrderAndCreditSeller, recomputeProductRating, restoreProductStockOnce, cancelCashCommissionBillForOrder } from "../../services/orderLifecycle";
import { openImagePreview } from "../../utils/mediaUtils";
import { ProductCard } from "../shop/PublicPages";

/* ─── BUYER DASHBOARD ────────────────────────── */
export default function BuyerDashboard({ user, profile, orders, products, paymentSetting, createNotif, onAddToCart, onProductClick, setPage, activeTab = "beranda", onTabChange, notifications = [], onLogout }) {
  const tab = activeTab || "beranda";
  const buyerActiveOrderCount = orders.filter((o) => !["selesai", "dibatalkan"].includes(o.statusPesanan)).length;
  const buyerWaitingPayment = orders.filter((o) => ["menunggu_pembayaran", "menunggu_ongkir"].includes(o.statusPembayaran) && !["selesai", "dibatalkan"].includes(o.statusPesanan)).length;
  const buyerCompletedCount = orders.filter((o) => o.statusPesanan === "selesai").length;
  const unreadBuyerNotif = notifications.filter((n) => !n.read && (!n.role || n.role === "buyer") && (!n.userId || n.userId === user?.uid)).length;
  const featuredProducts = products.slice(0, 8);
  const tabs = [
    { id: "beranda", label: "Beranda", short: "Home", icon: "🏠" },
    { id: "pesanan", label: "Pesanan", short: "Pesanan", icon: "📦", badge: buyerActiveOrderCount },
    { id: "profil", label: "Profil", short: "Profil", icon: "👤" },
  ];
  const goTab = (nextTab) => onTabChange ? onTabChange(nextTab) : null;
  return (
    <div className="buyer-app-shell">
      <aside className="buyer-app-nav" aria-label="Menu pembeli">
        <div className="buyer-app-brand">
          <div className="buyer-app-logo">🛍️</div>
          <div>
            <div className="buyer-app-brand-title">UMKM Buyer</div>
            <div className="buyer-app-brand-sub">Belanja lokal lebih mudah</div>
          </div>
        </div>
        <div className="buyer-app-profile">
          <div className="buyer-app-avatar">{profile?.name?.[0]?.toUpperCase() || "B"}</div>
          <div style={{ minWidth: 0 }}>
            <div className="buyer-app-name">{profile?.name || "Pembeli"}</div>
            <div className="buyer-app-status">Pembeli Aktif</div>
          </div>
        </div>
        <nav className="buyer-app-menu">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`buyer-app-menu-item ${tab === t.id ? "active" : ""}`} onClick={() => goTab(t.id)}>
              <span className="buyer-app-menu-icon">{t.icon}</span>
              <span>{t.short}</span>
              {t.badge > 0 && tab !== t.id && <span className="buyer-app-badge">{t.badge > 99 ? "99+" : t.badge}</span>}
            </button>
          ))}
          <button type="button" className="buyer-app-menu-item" onClick={() => setPage("home")}>
            <span className="buyer-app-menu-icon">🔎</span>
            <span>Belanja</span>
          </button>
        </nav>
        <button className="buyer-app-logout" onClick={onLogout}>🚪 Keluar</button>
      </aside>
      <main className="buyer-app-main">
        <div className="buyer-mobile-header">
          <div>
            <div className="buyer-mobile-kicker">UMKM Digital</div>
            <div className="buyer-mobile-title">Hai, {profile?.name || "Pembeli"}</div>
          </div>
          <div className="dashboard-mobile-actions">
            <button className="buyer-mobile-notif" type="button" onClick={() => setPage("notif")} aria-label="Buka notifikasi">
              🔔{unreadBuyerNotif > 0 && <span>{unreadBuyerNotif > 99 ? "99+" : unreadBuyerNotif}</span>}
            </button>
            <button type="button" className="dashboard-mobile-logout buyer-mobile-logout-btn" onClick={onLogout}>🚪 Keluar</button>
          </div>
        </div>

        {tab === "beranda" && (
          <div className="buyer-home-page">
            <section className="buyer-hero-card">
              <div>
                <div className="buyer-hero-kicker">Belanja UMKM lokal</div>
                <h1>Temukan produk favorit tanpa ribet.</h1>
                <p>Cek pesanan, lanjut belanja, dan pantau status langsung dari HP.</p>
              </div>
              <button type="button" onClick={() => setPage("home")}>Mulai Belanja</button>
            </section>

            <div className="buyer-quick-grid">
              <button type="button" onClick={() => goTab("pesanan")}><span>📦</span><b>Pesanan</b><em>{buyerActiveOrderCount}</em></button>
              <button type="button" onClick={() => setPage("home")}><span>🛒</span><b>Keranjang</b><em>Belanja</em></button>
              <button type="button" onClick={() => goTab("profil")}><span>👤</span><b>Profil</b><em>Akun</em></button>
              <button type="button" onClick={() => setPage("home")}><span>🔎</span><b>Produk</b><em>Lihat</em></button>
            </div>

            <div className="buyer-stat-strip">
              <div><b>{orders.length}</b><span>Total Pesanan</span></div>
              <div><b>{buyerWaitingPayment}</b><span>Perlu Dibayar</span></div>
              <div><b>{buyerCompletedCount}</b><span>Selesai</span></div>
            </div>

            <section className="buyer-section-card">
              <div className="buyer-section-head">
                <div><b>Produk Pilihan</b><span>Rekomendasi UMKM untuk kamu</span></div>
                <button type="button" onClick={() => setPage("home")}>Lihat Semua</button>
              </div>
              <div className="buyer-product-grid">
                {featuredProducts.map((p) => (
                  <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={true} />
                ))}
              </div>
            </section>
          </div>
        )}
        {tab === "pesanan" && <div className="buyer-page-card"><BuyerOrders orders={orders} createNotif={createNotif} paymentSetting={paymentSetting} /></div>}
        {tab === "profil" && <div className="buyer-page-card"><BuyerProfile profile={profile} /></div>}
      </main>
    </div>
  );
}

function BuyerOrders({ orders, createNotif, paymentSetting }) {
  const [activeStatus, setActiveStatus] = useState("semua");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const statusFilters = ["semua","menunggu_pembayaran","menunggu_verifikasi","pesanan_masuk","diproses","dikirim","selesai","dibatalkan"];
  const visibleOrders = orders.filter((o) => !isOrderHiddenForRole(o, "buyer"));
  const sortedOrders = sortNewest(visibleOrders);
  const filtered = activeStatus === "semua" ? sortedOrders : sortedOrders.filter((o) => o.statusPesanan === activeStatus);
  const deletableFiltered = filtered.filter(canSoftDeleteOrder);
  const selectedDeletable = selectedOrderIds.filter((id) => filtered.some((o) => o.id === id && canSoftDeleteOrder(o)));

  function toggleSelectOrder(orderId) {
    setSelectedOrderIds((prev) => prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]);
  }

  function toggleSelectAllDeletable() {
    const ids = deletableFiltered.map((o) => o.id);
    setSelectedOrderIds((prev) => ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  }

  async function deleteSelectedOrders() {
    if (selectedDeletable.length === 0) { alert("Pilih order selesai/dibatalkan dulu."); return; }
    if (!confirm(`Hapus ${selectedDeletable.length} order dari dashboard buyer? Data order tetap aman untuk admin/seller.`)) return;
    await softDeleteOrdersForRole(selectedDeletable, "buyer");
    setSelectedOrderIds((prev) => prev.filter((id) => !selectedDeletable.includes(id)));
  }

  async function deleteSingleOrder(order) {
    if (!canSoftDeleteOrder(order)) { alert("Hanya order Selesai atau Dibatalkan yang bisa dihapus."); return; }
    if (!confirm("Hapus order ini dari dashboard buyer?")) return;
    await softDeleteOrderForRole(order.id, "buyer");
    setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Pesanan Saya</div>
      {deletableFiltered.length > 0 && (
        <div className="card" style={{ marginBottom: 14, padding: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-ghost btn-sm" onClick={toggleSelectAllDeletable}>Pilih Semua</button>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Order selesai/dibatalkan</span>
          </div>
          <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={deleteSelectedOrders} disabled={selectedDeletable.length === 0}>Hapus yang Dipilih ({selectedDeletable.length})</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {statusFilters.map((s) => {
          const info = s === "semua" ? { label: "Semua", cls: "badge-gray" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setActiveStatus(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer", fontWeight: 500,
                borderColor: activeStatus === s ? "var(--orange)" : "var(--border)",
                background: activeStatus === s ? "var(--orange-light)" : "#fff",
                color: activeStatus === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "semua" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPesanan === s).length) > 0 ? ` (${s === "semua" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPesanan === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📦</div><p>Tidak ada pesanan</p></div>
      ) : (
        filtered.map((o) => <BuyerOrderCard key={o.id} order={o} createNotif={createNotif} paymentSetting={paymentSetting} selectable={canSoftDeleteOrder(o)} selected={selectedOrderIds.includes(o.id)} onToggleSelect={() => toggleSelectOrder(o.id)} onDeleteOrder={() => deleteSingleOrder(o)} />)
      )}
    </div>
  );
}

function BuyerOrderCard({ order, createNotif, paymentSetting, selectable = false, selected = false, onToggleSelect, onDeleteOrder }) {
  const [file, setFile] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const s = statusLabel(order.statusPesanan);
  async function uploadProof() {
    if (uploadLoading) return;
    if (order.proofSubmitted || order.paymentProofUrl || order.statusPembayaran === "menunggu_verifikasi" || order.statusPembayaran === "sudah_dibayar") { alert("Bukti pembayaran sudah pernah dikirim"); return; }
    if (!file) { alert("Pilih bukti pembayaran dulu"); return; }
    setUploadLoading(true);
    try {
      const url = await uploadImageToCloudinary(file);
      await runTransaction(db, async (transaction) => {
        const orderRef = doc(db, "orders", order.id);
        const freshOrder = await transaction.get(orderRef);
        const data = freshOrder.data() || {};
        if (data.proofSubmitted || data.paymentProofUrl || data.statusPembayaran === "menunggu_verifikasi" || data.statusPembayaran === "sudah_dibayar") {
          throw new Error("Bukti pembayaran sudah pernah dikirim");
        }
        transaction.update(orderRef, {
          paymentProofUrl: url,
          proofSubmitted: true,
          paymentProofUploadedAt: serverTimestamp(),
          statusPembayaran: "menunggu_verifikasi",
          updatedAt: serverTimestamp(),
        });
      });
      await createNotif({ role: "admin", type: "payment_proof", title: "Bukti Pembayaran Dikirim", message: `${order.buyerName} mengupload bukti pembayaran untuk ${order.productName}`, orderId: order.id });
      await createNotif({ role: "seller", userId: order.sellerId, type: "payment_proof", title: "Buyer Upload Bukti Bayar", message: `Pembeli sudah mengupload bukti pembayaran untuk ${order.productName}.`, orderId: order.id });
      alert("Bukti pembayaran berhasil dikirim");
    } catch (error) {
      alert(error?.message || "Gagal mengirim bukti pembayaran. Coba lagi.");
    } finally {
      setUploadLoading(false);
    }
  }
  async function received() {
    if (order.receivedAt) return;
    const qty = Number(order.quantity || 1);
    await completeOrderAndCreditSeller(order, {}, createNotif);
    await createNotif({ role: "seller", userId: order.sellerId, type: "order_done", title: "Pesanan Selesai ✅", message: `${order.buyerName} telah mengkonfirmasi penerimaan ${order.productName}.`, orderId: order.id });
    setShowReview(true);
  }
  async function sendReview() {
    if (order.reviewSubmitted || reviewBusy) { alert("Ulasan sudah dikirim"); return; }
    setReviewBusy(true);
    try {
      await addDoc(collection(db, "reviews"), { orderId: order.id, productId: order.productId, sellerId: order.sellerId, buyerId: order.buyerId, buyerName: order.buyerName, rating: Number(rating), comment, createdAt: serverTimestamp() });
      await recomputeProductRating(order.productId);
      await updateDoc(doc(db, "orders", order.id), { reviewSubmitted: true, updatedAt: serverTimestamp() });
      await createNotif({ role: "seller", userId: order.sellerId, type: "review_new", title: "Ulasan Baru ⭐", message: `${order.buyerName} memberi rating ${rating} bintang untuk ${order.productName}.`, orderId: order.id });
      alert("Ulasan telah dikirim");
      setShowReview(false);
    } catch (error) {
      alert("Gagal mengirim ulasan. Coba lagi.");
    } finally {
      setReviewBusy(false);
    }
  }
  async function requestCancelOrder() {
    if (cancelBusy || order.cancelRequest || ["dikirim", "selesai", "dibatalkan", "pembatalan_diajukan"].includes(normalizeStatus(order.statusPesanan))) return;
    const alreadyUploadedProof = hasPaymentProof(order) || ["menunggu_verifikasi", "sudah_dibayar", "approved", "paid"].includes(normalizeStatus(order.statusPembayaran));
    const confirmText = alreadyUploadedProof
      ? "Bukti pembayaran sudah dikirim. Ajukan pembatalan ke admin?"
      : "Batalkan pesanan ini sekarang? Pesanan akan langsung dibatalkan tanpa approval admin.";
    if (!confirm(confirmText)) return;
    setCancelBusy(true);
    try {
      if (alreadyUploadedProof) {
        await updateDoc(doc(db, "orders", order.id), { cancelRequest: true, cancelStatus: "pending", statusPesanan: "pembatalan_diajukan", cancelRequestedAt: serverTimestamp(), updatedAt: serverTimestamp() });
        await createNotif({ role: "admin", type: "order_cancel_request", title: "Pengajuan Pembatalan Pesanan", message: `${order.buyerName} mengajukan pembatalan untuk ${order.productName}.`, orderId: order.id });
        alert("Pengajuan pembatalan dikirim ke admin");
      } else {
        await restoreProductStockOnce(order);
        await cancelCashCommissionBillForOrder(order.id);
        await updateDoc(doc(db, "orders", order.id), {
          statusPesanan: "dibatalkan",
          statusPembayaran: "dibatalkan",
          cancelRequest: false,
          cancelStatus: "auto_cancelled_before_payment",
          cancelledByBuyerAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await createNotif({ role: "seller", userId: order.sellerId, type: "order_cancelled", title: "Pesanan Dibatalkan Buyer", message: `${order.buyerName} membatalkan pesanan ${order.productName} sebelum upload bukti pembayaran.`, orderId: order.id });
        alert("Pesanan berhasil dibatalkan");
      }
    } catch (error) {
      alert(error?.message || "Gagal membatalkan pesanan. Coba lagi.");
    } finally {
      setCancelBusy(false);
    }
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        <img src={order.productImage || "https://via.placeholder.com/80?text=No"} alt={order.productName} onClick={() => openImagePreview(order.productImage || "https://via.placeholder.com/240?text=No", order.productName || "Foto Produk")} style={{ width: 80, height: 80, borderRadius: 10, objectFit: "cover", flexShrink: 0, cursor: "zoom-in" }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}><span style={{ fontWeight: 700, fontSize: 15 }}>{order.productName}</span><span className={`badge ${s.cls}`}>{s.label}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}><span>Qty: {order.quantity}</span><span>Subtotal: {rupiah(order.productTotal)}</span><span>Ongkir: {rupiah(order.shippingCost)}</span><span>Total: <b style={{ color: "var(--orange)" }}>{rupiah(order.totalAmount)}</b></span><span>Kurir: {order.courierName}</span>{order.trackingNumber && <span>Resi: <b>{order.trackingNumber}</b></span>}</div>
          {order.sellerMapLink && order.shippingType === "pickup" && <div style={{ marginTop: 8, fontSize: 13 }}><b>Link lokasi toko:</b> <button type="button" className="btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => window.open(order.sellerMapLink, "_blank")}>Buka Maps Toko</button><div style={{ color: order.statusPesanan === "selesai" ? "#10B981" : "var(--orange)", fontWeight: 700, marginTop: 6 }}>{order.statusPesanan === "selesai" ? "Pesanan sudah diambil" : "Segera ambil pesanan anda"}</div></div>}
          
          {order.statusPembayaran === "menunggu_ongkir" && <div style={{ marginTop: 8, padding: 10, background: "#FFF8E1", borderRadius: 8, color: "#92400E", fontSize: 13 }}>Penjual sedang menghitung ongkir. Tombol pembayaran aktif setelah ongkir dikirim.</div>}
          {order.trackingNumber && <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}><button className="btn-ghost btn-sm" onClick={() => copyToClipboard(order.trackingNumber, "Resi berhasil disalin")}>Salin Resi</button><a className="btn-primary btn-sm" href="https://parcelsapp.com/id" target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>Lacak Paket</a></div>}
        </div>
      </div>
      {order.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={order.paymentProofUrl} alt="Bukti" onClick={() => openImagePreview(order.paymentProofUrl, "Bukti Transfer")} style={{ width: 180, height: 120, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }} /></div>}
      {canBuyerCancelOrder(order) &&
        order.statusPembayaran !== "menunggu_ongkir" &&
        !order.proofSubmitted &&
        !order.paymentProofUrl &&
        ["transfer", "qris"].includes(order.paymentMethod) &&
        order.shippingType !== "pickup" && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
          {/* WAJIB URUT: INFO REKENING ADMIN → UPLOAD BUKTI → TOMBOL KIRIM BUKTI */}
          {order.paymentMethod === "qris" ? (
            <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 13, border: "1px solid #FDE68A" }}>
              <div style={{ fontWeight: 800, marginBottom: 8, color: "#92400E" }}>📱 SCAN QRIS ADMIN</div>
              {paymentSetting?.qrisUrl ? (
                <img src={paymentSetting.qrisUrl} alt="QRIS Admin" style={{ width: 220, maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }} />
              ) : (
                <div style={{ color: "#B91C1C", fontWeight: 700 }}>QRIS belum diatur admin</div>
              )}
              <div style={{ color: "var(--orange)", fontWeight: 800, marginTop: 8 }}>Jika sudah bayar kirimkan bukti pembayaran</div>
            </div>
          ) : (
            <div style={{ background: "#FFF8E1", borderRadius: 10, padding: 14, marginBottom: 12, fontSize: 13, border: "1px solid #FDE68A" }}>
              <div style={{ fontWeight: 800, marginBottom: 8, color: "#92400E" }}>💳 INFO REKENING ADMIN</div>
              <div>Bank: <b>{paymentSetting?.bankName || "Belum diatur admin"}</b></div>
              <div>No Rekening: <b>{paymentSetting?.accountNumber || "-"}</b></div>
              <div>Atas Nama: <b>{paymentSetting?.accountHolder || "-"}</b></div>
              <div style={{ color: "var(--orange)", fontWeight: 800, marginTop: 8 }}>Jika sudah bayar kirimkan bukti pembayaran</div>
            </div>
          )}

          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Upload Bukti Pembayaran</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                if (e.target.files[0]?.size > 1024 * 1024) {
                  alert("Maks 1MB");
                  return;
                }
                setFile(e.target.files[0]);
              }}
              style={{ fontSize: 13, flex: 1 }}
            />
            <button className="btn-primary btn-sm" onClick={uploadProof} disabled={uploadLoading}>
              {uploadLoading ? "Mengirim..." : "Kirim Bukti"}
            </button>
          </div>
        </div>
      )}
      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        {selectable && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={selected} onChange={onToggleSelect} /> Pilih</label>}
        {isOrderStatus(order, "dikirim") && !order.receivedAt && <button className="btn-primary btn-sm" onClick={received}>✅ Sudah Diterima</button>}
        {canBuyerCancelOrder(order) && !order.cancelRequest && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={requestCancelOrder} disabled={cancelBusy}>{cancelBusy ? "Memproses..." : "Batalkan Pesanan"}</button>}
        {order.statusPesanan === "pembatalan_diajukan" && <span className="badge badge-yellow">Menunggu Approval Admin</span>}
        {order.statusPesanan === "selesai" && !order.reviewSubmitted && <button className="btn-outline btn-sm" onClick={() => setShowReview(!showReview)}>⭐ Beri Ulasan</button>}
        {order.statusPesanan === "selesai" && order.reviewSubmitted && <button className="btn-primary btn-sm" disabled style={{ background: "#111", borderColor: "#111" }}>Ulasan Terkirim</button>}
        {selectable && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={onDeleteOrder}>Hapus Order</button>}
      </div>
      {showReview && !order.reviewSubmitted && <div style={{ marginTop: 14, padding: 14, background: "var(--bg)", borderRadius: 8 }}><div style={{ fontWeight: 600, marginBottom: 8 }}>Beri Ulasan</div><div style={{ display: "flex", gap: 8, marginBottom: 10 }}>{[1,2,3,4,5].map((r) => <button key={r} onClick={() => setRating(r)} style={{ background: rating >= r ? "#F59E0B" : "#fff", border: "1.5px solid", borderColor: rating >= r ? "#F59E0B" : "var(--border)", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontWeight: 700 }}>⭐</button>)}</div><textarea className="form-input" rows={2} placeholder="Tulis komentar Anda..." value={comment} onChange={(e) => setComment(e.target.value)} style={{ marginBottom: 8 }} /><button className="btn-primary btn-sm" onClick={sendReview} disabled={reviewBusy || order.reviewSubmitted} style={(reviewBusy || order.reviewSubmitted) ? { background: "#111", borderColor: "#111" } : {}}>{reviewBusy || order.reviewSubmitted ? "Ulasan Terkirim" : "Kirim Ulasan"}</button></div>}
    </div>
  );
}


function BuyerProfile({ profile }) {
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>👤 Profil Saya</div>
      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, fontWeight: 700 }}>{profile?.name?.[0]?.toUpperCase()}</div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{profile?.name}</div>
            <span className="badge badge-green">Pembeli Aktif</span>
          </div>
        </div>
        <div className="divider" />
        {[["Email", profile?.email],["WhatsApp", profile?.whatsapp || "-"],["Status Akun", profile?.status === "active" ? "✅ Aktif" : profile?.status]].map(([l,v]) => (
          <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
            <span style={{ color: "var(--text2)" }}>{l}</span>
            <span style={{ fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
