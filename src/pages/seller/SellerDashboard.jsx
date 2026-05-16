import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, increment, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";
import { uploadImageToCloudinary } from "../../services/cloudinary";
import ChatCenter from "../../components/chat/ChatCenter";
import SellerCommissionBills from "../../components/seller/SellerCommissionBills";
import { rupiah, formatNumberInput, parseNumberInput, normalizeLocationText, getStock } from "../../utils/appHelpers";
import { CATEGORY_GROUPS, CATEGORIES, statusLabel, copyToClipboard, getOrderShippingAddress } from "../../utils/catalogUtils";
import { sumCommissionDebt, shouldRemindCommissionBill } from "../../utils/commissionUtils";
import { paymentMethodLabel, isCashPayment, isTransferPayment, getSellerReceivableAmount, getProductCommissionTotal } from "../../utils/paymentUtils";
import { getSellerTotalSalesFromOrders } from "../../utils/businessUtils";
import { canSoftDeleteOrder, isOrderHiddenForRole, softDeleteOrderForRole, softDeleteOrdersForRole } from "../../utils/orderActions";
import { sortNewest } from "../../utils/orderUtils";
import { completeOrderAndCreditSeller } from "../../services/orderLifecycle";
import { openImagePreview } from "../../utils/mediaUtils";
import { markDashboardNotificationsRead } from "../../services/pushNotifications";

/* ─── SELLER DASHBOARD ───────────────────────── */
export default function SellerDashboard({ user, profile, products, orders, withdrawals = [], wallets, commissionBills = [], paymentSetting, commissionSetting, chatUnread = 0, createNotif, activeTab = "beranda", onTabChange, notifications = [], setPage, onLogout }) {
  const tab = activeTab || "beranda";
  const wallet = wallets.find((w) => w.sellerId === user.uid);
  const sellerCommissionBills = commissionBills.filter((b) => b.sellerId === user.uid);
  const sellerWithdrawals = withdrawals.filter((w) => w.sellerId === user.uid);
  const sellerIncomingOrderCount = orders.filter((o) => ["pesanan_masuk", "menunggu_ongkir", "menunggu_verifikasi", "pembatalan_diajukan"].includes(o.statusPesanan) || o.pendingShippingQuote).length;
  const sellerOpenCommissionCount = sellerCommissionBills.filter((b) => ["unpaid", "pending", "overdue", "menunggu_pembayaran", "ditolak"].includes(String(b.status || "").toLowerCase()) || (!b.paid && Number(b.remaining || b.amount || 0) > 0)).length;
  const sellerFinanceBadgeCount = sellerWithdrawals.filter((w) => ["pending", "processing", "menunggu", "ditolak", "rejected"].includes(String(w.status || "").toLowerCase())).length;
  const commissionDebt = sumCommissionDebt(sellerCommissionBills);
  const sellerTotalSales = getSellerTotalSalesFromOrders(orders, user.uid);
  const remindedCommissionBillsRef = useRef(new Set());
  const isCommissionBlocked = profile?.commissionBlocked === true;
  const isSellerBlockedByAdmin = isCommissionBlocked;
  const hasOpenCommissionDebt = commissionDebt > 0;
  const activeProducts = products.filter((p) => p.status === "active" && !p.isDeleted).length;
  const totalStock = products.filter((p) => !p.isDeleted).reduce((sum, p) => sum + getStock(p), 0);
  const activeOrders = orders.filter((o) => !["selesai", "dibatalkan"].includes(o.statusPesanan)).length;
  const completedOrders = orders.filter((o) => o.statusPesanan === "selesai").length;
  const sellerName = profile?.storeName || profile?.namaToko || profile?.name || "Seller";
  useEffect(() => {
    if (!user?.uid || profile?.role !== "seller" || !createNotif) return;

    sellerCommissionBills
      .filter(shouldRemindCommissionBill)
      .forEach(async (bill) => {
        if (!bill?.id || remindedCommissionBillsRef.current.has(bill.id)) return;
        remindedCommissionBillsRef.current.add(bill.id);
        const amount = Number(bill.remaining || bill.amount || 0);
        try {
          await createNotif({
            role: "seller",
            userId: user.uid,
            type: "commission_bill_reminder",
            title: "Pengingat Tagihan Komisi",
            message: `Kamu masih punya tagihan komisi tunai ${rupiah(amount)}${bill.productName ? ` untuk ${bill.productName}` : ""}. Silakan bayar ke rekening admin dan upload bukti pembayaran.`,
            billId: bill.id,
            orderId: bill.orderId || null,
          });
          await updateDoc(doc(db, "komisi_tagihan", bill.id), {
            lastReminderAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          remindedCommissionBillsRef.current.delete(bill.id);
          console.error("Gagal membuat pengingat tagihan komisi:", error);
        }
      });
  }, [sellerCommissionBills, user, profile, createNotif]);

  const tabs = [
    { id: "beranda", label: "Dashboard", icon: "🏠" },
    { id: "order", label: "Pesanan Saya", icon: "📋" },
    { id: "produk", label: "Produk Saya", icon: "🛍️" },
    { id: "tagihan", label: "Komisi", icon: "🧾" },
    { id: "withdraw", label: "Keuangan", icon: "💳" },
    { id: "chat", label: "Pesan", icon: "💬" },
    { id: "profil", label: "Profil Toko", icon: "🏪" },
  ];

  const quickStats = [
    { label: "Pesanan", value: activeOrders, sub: `${sellerIncomingOrderCount} perlu diproses`, icon: "🛒", color: "#ee4d2d" },
    { label: "Produk", value: activeProducts, sub: `${products.length} total`, icon: "📦", color: "#2563EB" },
    { label: "Saldo", value: rupiah(wallet?.saldoTersedia || 0), sub: "Tersedia", icon: "💰", color: "#059669" },
  ];

  const goTab = (nextTab) => {
    if (nextTab === "order" && isSellerBlockedByAdmin) {
      alert("Pesanan masuk sedang diblokir admin. Selesaikan tagihan komisi lalu tunggu admin membuka blokir.");
      return;
    }
    if (nextTab === "chat") {
      markDashboardNotificationsRead({ user, profile, role: "seller", types: ["chat_message"] });
    }
    if (nextTab === "order") {
      markDashboardNotificationsRead({ user, profile, role: "seller", types: ["order_new", "payment_proof", "shipping_check", "order_cancel_request"] });
    }
    onTabChange ? onTabChange(nextTab) : null;
  };

  return (
    <div className="seller-pro-shell">
      <aside className="seller-pro-sidebar">
        <button type="button" className="seller-pro-brand seller-pro-brand-button" onClick={() => setPage ? setPage("home") : null} aria-label="Kembali ke halaman utama publik">
          <div className="seller-pro-logo">UM</div>
          <div>
            <div className="seller-pro-brand-title">UMKMDigital</div>
            <div className="seller-pro-brand-sub">Kembali ke marketplace publik</div>
          </div>
        </button>

        <div className="seller-pro-profile">
          <div className="seller-pro-avatar">{sellerName?.[0]?.toUpperCase() || "S"}</div>
          <div style={{ minWidth: 0 }}>
            <div className="seller-pro-name">{sellerName}</div>
            <div className={`seller-pro-status ${profile?.status === "active" ? "active" : "pending"}`}>{profile?.status === "active" ? "Aktif" : "Menunggu Verifikasi"}</div>
          </div>
        </div>

        <nav className="seller-pro-menu">
          {tabs.map((t) => {
            const blockedOrderTab = t.id === "order" && isSellerBlockedByAdmin;
            return (
              <button key={t.id} type="button" className={`seller-pro-menu-item ${tab === t.id ? "active" : ""}`} onClick={() => goTab(t.id)} disabled={blockedOrderTab}>
                <span className="seller-pro-menu-icon">{t.icon}</span>
                <span>{t.label}</span>
                {t.id === "order" && tab !== "order" && !blockedOrderTab && sellerIncomingOrderCount > 0 && <span className="seller-pro-badge">{sellerIncomingOrderCount}</span>}
                {t.id === "tagihan" && tab !== "tagihan" && sellerOpenCommissionCount > 0 && <span className="seller-pro-badge danger">{sellerOpenCommissionCount > 99 ? "99+" : sellerOpenCommissionCount}</span>}
                {t.id === "withdraw" && tab !== "withdraw" && sellerFinanceBadgeCount > 0 && <span className="seller-pro-badge finance">{sellerFinanceBadgeCount > 99 ? "99+" : sellerFinanceBadgeCount}</span>}
                {t.id === "chat" && tab !== "chat" && chatUnread > 0 && <span className="seller-pro-badge">{chatUnread > 99 ? "99+" : chatUnread}</span>}
                {blockedOrderTab && <span className="seller-pro-badge danger">!</span>}
              </button>
            );
          })}
        </nav>

        <button className="seller-pro-logout" onClick={onLogout}>🚪 Keluar</button>
      </aside>

      <main className="seller-pro-main">
        <div className="seller-pro-topbar">
          <div>
            <div className="seller-pro-kicker">Seller Centre</div>
            <h1>{tab === "beranda" ? `Halo, ${sellerName}` : tabs.find((t) => t.id === tab)?.label}</h1>
            <p>{tab === "beranda" ? "Pantau performa toko, pesanan, produk, dan keuangan dalam satu dashboard ringkas." : "Kelola operasional toko dengan tampilan bersih dan fokus."}</p>
          </div>
          <div className="seller-pro-top-actions">
            <button type="button" className="dashboard-mobile-logout seller-mobile-logout" onClick={onLogout}>🚪 Keluar</button>
            <button type="button" className="seller-pro-action seller-chat-action" onClick={() => goTab("chat")} aria-label="Buka pesan seller">
              💬 Pesan {chatUnread > 0 && <span className="seller-pro-badge topbar">{chatUnread > 99 ? "99+" : chatUnread}</span>}
            </button>
            <button type="button" className="seller-pro-action" onClick={() => setPage ? setPage("home") : null}>🏬 Marketplace</button>
            <button type="button" className="seller-pro-action" onClick={() => goTab("produk")}>+ Tambah Produk</button>
            <button type="button" className="seller-pro-action primary" onClick={() => goTab("order")}>Pesanan Perlu Diproses {sellerIncomingOrderCount > 0 ? `(${sellerIncomingOrderCount})` : ""}</button>
          </div>
        </div>

        {tab === "beranda" && (
          <div>
            {(profile?.status === "pending" || hasOpenCommissionDebt || isCommissionBlocked) && (
              <div className="seller-pro-alerts">
                {profile?.status === "pending" && (
                  <div className="seller-pro-alert warning"><b>⏳ Akun menunggu verifikasi</b><span>Admin perlu menyetujui akun sebelum semua fitur seller aktif.</span></div>
                )}
                {hasOpenCommissionDebt && (
                  <div className="seller-pro-alert warning"><b>💸 Tagihan komisi tunai</b><span>Total tagihan saat ini {rupiah(commissionDebt)}. Segera bayar/upload bukti agar operasional lancar.</span></div>
                )}
                {isCommissionBlocked && (
                  <div className="seller-pro-alert danger"><b>🚫 Akun diblokir admin</b><span>Upload produk, proses pesanan, dan penarikan sementara dibatasi. Hubungi admin setelah pembayaran selesai.</span></div>
                )}
              </div>
            )}


            <section className="seller-pro-stats">
              {quickStats.map((s) => (
                <div key={s.label} className="seller-pro-stat-card">
                  <div className="seller-pro-stat-icon" style={{ background: s.color + "15", color: s.color }}>{s.icon}</div>
                  <div className="seller-pro-stat-value" style={{ color: s.color }}>{s.value}</div>
                  <div className="seller-pro-stat-label">{s.label}</div>
                  <div className="seller-pro-stat-sub">{s.sub}</div>
                </div>
              ))}
            </section>

            <section className="seller-pro-grid-two">
              <div className="seller-pro-panel">
                <div className="seller-pro-panel-head"><div><b>Pesanan Perlu Dipantau</b><span>Ringkasan pesanan terbaru toko</span></div><button type="button" onClick={() => goTab("order")}>Kelola Pesanan</button></div>
                <div className="seller-pro-list">
                  {sortNewest(orders).slice(0, 5).map((o) => (
                    <div key={o.id} className="seller-pro-list-row">
                      <div><b>{o.productName || "Produk"}</b><span>{rupiah(o.totalAmount || o.total || 0)}</span></div>
                      <span className={`badge ${statusLabel(o.statusPesanan).cls}`}>{statusLabel(o.statusPesanan).label}</span>
                    </div>
                  ))}
                  {orders.length === 0 && <div className="seller-pro-empty">Belum ada order.</div>}
                </div>
              </div>
              <div className="seller-pro-panel">
                <div className="seller-pro-panel-head"><div><b>Produk Toko</b><span>Produk terbaru dan stok saat ini</span></div><button type="button" onClick={() => goTab("produk")}>Kelola Produk</button></div>
                <div className="seller-pro-list">
                  {products.slice(0, 5).map((p) => (
                    <div key={p.id} className="seller-pro-list-row">
                      <div><b>{p.productName || "Produk"}</b><span>Stok {getStock(p)} • {rupiah(p.price || 0)}</span></div>
                      <span className={`badge ${statusLabel(p.status).cls}`}>{statusLabel(p.status).label}</span>
                    </div>
                  ))}
                  {products.length === 0 && <div className="seller-pro-empty">Belum ada produk.</div>}
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === "produk" && <AddProduct user={user} profile={profile} products={products} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} commissionSetting={commissionSetting} createNotif={createNotif} />}
        {tab === "tagihan" && <SellerCommissionBills bills={sellerCommissionBills} paymentSetting={paymentSetting} createNotif={createNotif} />}
        {tab === "order" && (isSellerBlockedByAdmin ? (
          <div className="card" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#7F1D1D" }}>
            <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 8 }}>🚫 Pesanan Masuk Diblokir</div>
            <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>Admin/sub admin sedang memblokir akses pesanan masuk, proses order, upload produk, dan penarikan. Selesaikan tagihan komisi lalu tunggu admin membuka blokir sesuai sistem yang sudah ada.</p>
          </div>
        ) : <SellerOrders orders={orders} createNotif={createNotif} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} />)}
        {tab === "chat" && <ChatCenter user={user} profile={profile} createNotif={createNotif} mode="seller" />}
        {tab === "withdraw" && <Withdraw user={user} profile={profile} wallet={wallet} totalSales={sellerTotalSales} withdrawals={sellerWithdrawals} hasCommissionDebt={isSellerBlockedByAdmin} commissionDebt={commissionDebt} createNotif={createNotif} />}
        {tab === "profil" && (
          <SellerProfile
            user={user}
            profile={profile}
            wallet={wallet}
            sellerName={sellerName}
            sellerTotalSales={sellerTotalSales}
          />
        )}
      </main>
    </div>
  );
}

function getSellerProfileDefaults(profile = {}) {
  const detailAddress = profile?.sellerAddress || profile?.detailAddress || profile?.address || "";
  const kabupaten = normalizeLocationText(profile?.kabupaten || profile?.regency || profile?.sellerLocation?.kabupaten || profile?.location?.kabupaten || "");
  const kecamatan = normalizeLocationText(profile?.kecamatan || profile?.district || profile?.sellerLocation?.kecamatan || profile?.location?.kecamatan || "");
  const desa = normalizeLocationText(profile?.desa || profile?.village || profile?.sellerLocation?.desa || profile?.location?.desa || "");
  const fullAddress = profile?.fullAddress || [detailAddress, desa, kecamatan, kabupaten].filter(Boolean).join(", ");
  return {
    storeName: profile?.storeName || profile?.namaToko || profile?.name || "",
    whatsapp: profile?.whatsapp || "",
    kabupaten,
    kecamatan,
    desa,
    detailAddress,
    fullAddress,
    sellerMapLink: profile?.sellerMapLink || profile?.storeMapLink || profile?.mapsLink || "",
  };
}

function getSellerProductDefaults(profile = {}) {
  const defaults = getSellerProfileDefaults(profile);
  return {
    sellerAddress: defaults.fullAddress || defaults.detailAddress || "",
    sellerMapLink: defaults.sellerMapLink || "",
    kabupaten: defaults.kabupaten || "",
    kecamatan: defaults.kecamatan || "",
    desa: defaults.desa || "",
  };
}

function SellerProfile({ user, profile, wallet, sellerName, sellerTotalSales }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(() => getSellerProfileDefaults(profile));

  useEffect(() => {
    if (!editing) setForm(getSellerProfileDefaults(profile));
  }, [profile, editing]);

  const locationText = [form.desa, form.kecamatan, form.kabupaten].filter(Boolean).join(", ");
  const displayAddress = form.fullAddress || [form.detailAddress, locationText].filter(Boolean).join(", ") || "-";

  async function saveProfile(e) {
    e.preventDefault();
    if (!user?.uid) return;
    setSaving(true);
    try {
      const kabupaten = normalizeLocationText(form.kabupaten);
      const kecamatan = normalizeLocationText(form.kecamatan);
      const desa = normalizeLocationText(form.desa);
      const detailAddress = form.detailAddress.trim();
      const fullAddress = [detailAddress, desa, kecamatan, kabupaten].filter(Boolean).join(", ");
      const cleanStoreName = form.storeName.trim() || sellerName || profile?.name || "Seller";
      const cleanMapLink = form.sellerMapLink.trim();

      await updateDoc(doc(db, "users", user.uid), {
        name: cleanStoreName,
        storeName: cleanStoreName,
        namaToko: cleanStoreName,
        whatsapp: form.whatsapp.trim(),
        kabupaten,
        kecamatan,
        desa,
        regency: kabupaten,
        district: kecamatan,
        village: desa,
        detailAddress,
        sellerAddress: detailAddress,
        fullAddress,
        sellerMapLink: cleanMapLink,
        storeMapLink: cleanMapLink,
        mapsLink: cleanMapLink,
        sellerLocation: { kabupaten, kecamatan, desa },
        updatedAt: serverTimestamp(),
      });
      setForm((prev) => ({ ...prev, storeName: cleanStoreName, kabupaten, kecamatan, desa, detailAddress, fullAddress, sellerMapLink: cleanMapLink }));
      setEditing(false);
      alert("Profil toko berhasil disimpan. Data ini akan otomatis dipakai saat tambah produk.");
    } catch (error) {
      console.error("Gagal menyimpan profil seller:", error);
      alert(error?.message || "Profil toko gagal disimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="seller-pro-panel seller-pro-profile-panel">
      <div className="seller-pro-panel-head">
        <div><b>Profil Toko</b><span>Informasi toko, alamat, dan lokasi utama seller</span></div>
        <button type="button" onClick={() => setEditing((v) => !v)}>{editing ? "Batal" : "Edit Profil"}</button>
      </div>

      {!editing ? (
        <>
          <div className="seller-pro-profile-table">
            {[["Nama Toko", sellerName], ["Email", profile?.email || user?.email || "-"], ["WhatsApp", profile?.whatsapp || "-"], ["Alamat Toko", displayAddress], ["Lokasi", locationText || "-"], ["Link Google Maps", form.sellerMapLink ? "Tersimpan" : "Belum diisi"], ["Status", profile?.status === "active" ? "✅ Aktif" : "⏳ Pending"], ["Saldo Tersedia", rupiah(wallet?.saldoTersedia || 0)], ["Total Penjualan", rupiah(sellerTotalSales)]].map(([l, v]) => (
              <div key={l}><span>{l}</span><b>{v}</b></div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            {form.sellerMapLink && <button type="button" className="btn-primary btn-sm" onClick={() => window.open(form.sellerMapLink, "_blank")}>Buka Maps Toko</button>}
            <button type="button" className="btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit Data Toko</button>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--text3)", lineHeight: 1.6 }}>
            Data profil ini akan menjadi alamat bawaan saat seller menambahkan produk baru. Seller tetap bisa mengubah alamat per produk jika diperlukan.
          </div>
        </>
      ) : (
        <form onSubmit={saveProfile} className="seller-product-form" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div className="form-group">
            <label>Nama Toko</label>
            <input className="form-input" value={form.storeName} onChange={(e) => setForm({ ...form, storeName: e.target.value })} placeholder="Nama toko" required />
          </div>
          <div className="form-group">
            <label>Nomor WhatsApp</label>
            <input className="form-input" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="08xxxxxxxxxx" required />
          </div>
          <div className="form-group">
            <label>Kabupaten/Kota</label>
            <input className="form-input" value={form.kabupaten} onChange={(e) => setForm({ ...form, kabupaten: e.target.value })} placeholder="Contoh: Sukabumi" required />
          </div>
          <div className="form-group">
            <label>Kecamatan</label>
            <input className="form-input" value={form.kecamatan} onChange={(e) => setForm({ ...form, kecamatan: e.target.value })} placeholder="Contoh: Surade" required />
          </div>
          <div className="form-group">
            <label>Desa/Kelurahan</label>
            <input className="form-input" value={form.desa} onChange={(e) => setForm({ ...form, desa: e.target.value })} placeholder="Contoh: Cipeundeuy" required />
          </div>
          <div className="form-group">
            <label>Link Google Maps Toko</label>
            <input className="form-input" value={form.sellerMapLink} onChange={(e) => setForm({ ...form, sellerMapLink: e.target.value })} placeholder="https://maps.google.com/..." />
          </div>
          <div className="form-group" style={{ gridColumn: "1/-1" }}>
            <label>Detail Alamat Toko</label>
            <textarea className="form-input" rows={3} value={form.detailAddress} onChange={(e) => setForm({ ...form, detailAddress: e.target.value })} placeholder="Jalan/Kampung/RT/RW/patokan toko" required />
            <small style={{ color: "var(--text3)", fontSize: 12 }}>Alamat ini akan otomatis masuk ke form tambah produk.</small>
          </div>
          <div style={{ gridColumn: "1/-1", display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
            <button type="button" className="btn-ghost" onClick={() => { setForm(getSellerProfileDefaults(profile)); setEditing(false); }} disabled={saving}>Batal</button>
            <button className="btn-primary" disabled={saving}>{saving ? "Menyimpan..." : "Simpan Profil"}</button>
          </div>
        </form>
      )}
    </div>
  );
}

function AddProduct({ user, profile, products, hasCommissionDebt = false, commissionDebt = 0, commissionSetting, createNotif }) {
  const createEmptyProductForm = () => ({ productName: "", category: "", subCategory: "", price: "", stock: "", description: "", weightGram: "", ...getSellerProductDefaults(profile) });
  const [form, setForm] = useState(() => createEmptyProductForm());
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const sellerApproved = profile?.status === "active" || profile?.status === "approved";

  if (!sellerApproved) {
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Produk Saya</div>
        <div className="card" style={{ border: "1px solid #F59E0B", background: "#FFF8E1" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#92400E", marginBottom: 8 }}>⏳ Akun Seller Belum Disetujui</div>
          <p style={{ fontSize: 14, color: "#78350F", lineHeight: 1.6 }}>
            Akun seller kamu masih menunggu approval admin. Setelah admin menyetujui akun kamu, tombol upload produk akan aktif otomatis.
          </p>
          <div style={{ marginTop: 12, padding: 12, borderRadius: 10, background: "#fff", fontSize: 13, color: "var(--text2)" }}>
            Status akun: <b>{profile?.status || "pending"}</b>
          </div>
        </div>
      </div>
    );
  }

  if (hasCommissionDebt) {
    return (
      <div>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Produk Saya</div>
        <div className="card" style={{ border: "1px solid #FCA5A5", background: "#FEF2F2" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#B91C1C", marginBottom: 8 }}>🚫 Upload Produk Diblokir Admin</div>
          <p style={{ fontSize: 14, color: "#7F1D1D", lineHeight: 1.6 }}>Akun kamu sedang diblokir manual oleh admin/sub admin. Silakan bayar tagihan komisi melalui menu Tagihan Komisi, upload bukti pembayaran, lalu tunggu admin approve. Setelah approve, blokir akan otomatis dibuka.</p>
        </div>
      </div>
    );
  }

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) { alert("Ukuran gambar maksimal 3MB. Kompres foto dulu jika masih terlalu besar."); return; }
    setFile(f); setPreview(URL.createObjectURL(f));
  }

  async function submit(e) {
    e.preventDefault();
    if (!sellerApproved) { alert("Akun seller belum disetujui admin. Kamu belum bisa upload produk."); return; }
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Upload produk belum bisa dilakukan.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (!file) { alert("Pilih gambar dulu"); return; }
    setLoading(true);
    try {
      const imageUrl = await uploadImageToCloudinary(file);
      const needsAdminApproval = form.category === "Jasa Lokal" && form.subCategory === "Jasa Pijat";
      const ref = await addDoc(collection(db, "products"), {
        sellerId: user.uid, sellerName: profile.name, productName: form.productName, category: form.category, subCategory: form.subCategory,
        price: parseNumberInput(form.price), stock: Number(form.stock), description: form.description,
        weightGram: Number(form.weightGram || 1000), sellerAddress: form.sellerAddress,
        sellerMapLink: form.sellerMapLink,
        kabupaten: normalizeLocationText(form.kabupaten), kecamatan: normalizeLocationText(form.kecamatan), desa: normalizeLocationText(form.desa),
        imageUrl, status: needsAdminApproval ? "pending" : "active", isDeleted: false, commissionType: "percent", commissionValue: Number(commissionSetting?.globalCommissionPercent || 10),
        averageRating: 0, ratingCount: 0, totalReviews: 0, soldCount: 0, totalSold: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await createNotif({ role: "admin", type: "product_new", title: "Produk Baru", message: `${profile.name} upload produk ${form.productName}`, productId: ref.id });
      setShowForm(false); setFile(null); setPreview(""); setForm(createEmptyProductForm());
      alert(needsAdminApproval ? "Jasa Pijat berhasil diupload dan menunggu approval admin." : "Produk berhasil diupload dan langsung aktif.");
    } catch (error) {
      console.error("Gagal upload produk seller:", error);
      alert(error?.message || "Upload produk gagal. Cek koneksi internet, ukuran gambar, dan konfigurasi Cloudinary lalu coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  async function quickEditProduct(p) {
    const price = prompt("Harga baru:", p.price || "");
    if (price === null) return;
    const stock = prompt("Stok baru:", p.stock || "");
    if (stock === null) return;
    await updateDoc(doc(db, "products", p.id), { price: Number(String(price).replace(/\D/g, "")), stock: Number(String(stock).replace(/\D/g, "")), updatedAt: serverTimestamp() });
    alert("Produk berhasil diedit");
  }

  async function softDeleteProduct(p) {
    if (!confirm("Hapus produk " + p.productName + "?")) return;
    await updateDoc(doc(db, "products", p.id), { isDeleted: true, updatedAt: serverTimestamp() });
    alert("Produk berhasil dihapus");
  }

  async function editSellerMapLink(p) {
    const link = prompt("Link Google Maps toko:", p.sellerMapLink || "");
    if (link === null) return;
    await updateDoc(doc(db, "products", p.id), { sellerMapLink: link.trim(), updatedAt: serverTimestamp() });
    alert("Link Google Maps toko berhasil disimpan");
  }

  async function editProductLocation(p) {
    const kabupaten = prompt("Kabupaten produk:", p.kabupaten || "");
    if (kabupaten === null) return;
    const kecamatan = prompt("Kecamatan produk:", p.kecamatan || "");
    if (kecamatan === null) return;
    const desa = prompt("Desa produk:", p.desa || "");
    if (desa === null) return;
    await updateDoc(doc(db, "products", p.id), {
      kabupaten: normalizeLocationText(kabupaten),
      kecamatan: normalizeLocationText(kecamatan),
      desa: normalizeLocationText(desa),
      updatedAt: serverTimestamp(),
    });
    alert("Lokasi produk berhasil disimpan");
  }
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>📦 Produk Saya ({products.filter((p) => !p.isDeleted).length})</div>
        <button className="btn-primary" onClick={() => { if (!showForm) setForm(createEmptyProductForm()); setShowForm(!showForm); }}>+ Tambah Produk</button>
      </div>
      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Tambah Produk Baru</div>
          <form className="seller-product-form" onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="form-group">
              <label>Nama Produk</label>
              <input className="form-input" placeholder="Nama produk" onChange={(e) => setForm({ ...form, productName: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Kategori</label>
              <select className="form-input" onChange={(e) => setForm({ ...form, category: e.target.value, subCategory: "" })} required>
                <option value="">Pilih kategori</option>
                {CATEGORIES.filter((c) => c.id !== "all").map((c) => <option key={c.id} value={c.id}>{c.icon} {c.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Subkategori</label>
              <select className="form-input" value={form.subCategory} onChange={(e) => setForm({ ...form, subCategory: e.target.value })} required disabled={!form.category}>
                <option value="">{form.category ? "Pilih subkategori" : "Pilih kategori dulu"}</option>
                {(CATEGORY_GROUPS[form.category] || []).map((sub) => <option key={sub} value={sub}>{sub}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Harga (Rp)</label>
              <input className="form-input" inputMode="numeric" placeholder="Contoh: 25.000" value={form.price} onChange={(e) => setForm({ ...form, price: formatNumberInput(e.target.value) })} required />
            </div>
            <div className="form-group">
              <label>Stok</label>
              <input className="form-input" type="number" placeholder="Jumlah stok" onChange={(e) => setForm({ ...form, stock: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Berat (gram)</label>
              <input className="form-input" type="number" placeholder="Contoh: 500" onChange={(e) => setForm({ ...form, weightGram: e.target.value })} />
            </div>

            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Alamat Toko</label>
              <input className="form-input" placeholder="Alamat lengkap toko/gudang" value={form.sellerAddress} onChange={(e) => setForm({ ...form, sellerAddress: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Link Google Maps Toko</label>
              <input className="form-input" placeholder="https://maps.google.com/..." value={form.sellerMapLink} onChange={(e) => setForm({ ...form, sellerMapLink: e.target.value })} />
              <small style={{ color: "var(--text3)", fontSize: 12 }}>Otomatis terisi dari Profil Toko, tetap bisa diubah khusus produk ini.</small>
            </div>
            <div className="form-group">
              <label>Kabupaten Produk</label>
              <input className="form-input" placeholder="Contoh: Sukabumi" value={form.kabupaten} onChange={(e) => setForm({ ...form, kabupaten: e.target.value, kecamatan: form.kecamatan, desa: form.desa })} />
            </div>
            <div className="form-group">
              <label>Kecamatan Produk</label>
              <input className="form-input" placeholder="Contoh: Jampang Surade" value={form.kecamatan} onChange={(e) => setForm({ ...form, kecamatan: e.target.value, desa: form.desa })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Desa Produk</label>
              <input className="form-input" placeholder="Contoh: Surade" value={form.desa} onChange={(e) => setForm({ ...form, desa: e.target.value })} />
              <small style={{ color: "var(--text3)", fontSize: 12 }}>Data ini dipakai agar buyer bisa filter produk berdasarkan desa, kecamatan, atau kabupaten.</small>
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Deskripsi</label>
              <textarea className="form-input" rows={3} placeholder="Deskripsi produk..." onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="form-group" style={{ gridColumn: "1/-1" }}>
              <label>Foto Produk (maks 1MB)</label>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} className="form-input" style={{ padding: 8 }} />
              {preview && <img src={preview} alt="Preview" onClick={() => openImagePreview(preview, "Preview Foto Produk")} style={{ height: 160, objectFit: "cover", borderRadius: 8, marginTop: 8, cursor: "zoom-in" }} />}
            </div>
            <div style={{ gridColumn: "1/-1", display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button type="button" className="btn-ghost" onClick={() => setShowForm(false)}>Batal</button>
              <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Mengupload..." : "Upload Produk"}</button>
            </div>
          </form>
        </div>
      )}
      {products.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📦</div><p>Belum ada produk</p></div>
      ) : (
        <>
          <div className="seller-product-mobile-list">
            {products.filter((p) => !p.isDeleted).map((p) => {
              const s = statusLabel(p.status);
              return (
                <article key={p.id} className="seller-product-mobile-card">
                  <img src={p.imageUrl || "https://via.placeholder.com/96?text=No"} alt={p.productName} onClick={() => openImagePreview(p.imageUrl || "https://via.placeholder.com/200?text=No", p.productName || "Foto Produk")} />
                  <div className="seller-product-mobile-info">
                    <div className="seller-product-mobile-title">{p.productName}</div>
                    <div className="seller-product-mobile-meta">{p.category}{p.subCategory ? ` / ${p.subCategory}` : ""}</div>
                    <div className="seller-product-mobile-price">{rupiah(p.price)}</div>
                    <div className="seller-product-mobile-meta">Stok {p.stock} • ⭐ {(p.averageRating || 0).toFixed(1)}</div>
                    <div className="seller-product-mobile-meta">{[p.desa, p.kecamatan, p.kabupaten].filter(Boolean).join(", ") || "Lokasi belum diisi"}</div>
                    <div className="seller-product-mobile-actions">
                      <span className={`badge ${s.cls}`}>{s.label}</span>
                      <button className="btn-ghost btn-sm" onClick={() => quickEditProduct(p)}>Edit</button>
                      <button className="btn-ghost btn-sm" onClick={() => editProductLocation(p)}>Lokasi</button>
                      <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => softDeleteProduct(p)}>Hapus</button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <div className="seller-product-desktop-table" style={{ overflow: "auto" }}>
          <table className="table">
            <thead>
              <tr><th>Produk</th><th>Kategori</th><th>Lokasi</th><th>Harga</th><th>Stok</th><th>Status</th><th>Rating</th><th>Aksi</th></tr>
            </thead>
            <tbody>
              {products.filter((p) => !p.isDeleted).map((p) => {
                const s = statusLabel(p.status);
                return (
                  <tr key={p.id}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                        <img src={p.imageUrl || "https://via.placeholder.com/40?text=No"} alt={p.productName} onClick={() => openImagePreview(p.imageUrl || "https://via.placeholder.com/200?text=No", p.productName || "Foto Produk")} style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", cursor: "zoom-in" }} />
                        <span style={{ fontWeight: 500, fontSize: 13 }}>{p.productName}</span>
                      </div>
                    </td>
                    <td><span style={{ fontSize: 12 }}>{p.category}{p.subCategory ? ` / ${p.subCategory}` : ""}</span></td>
                    <td><span style={{ fontSize: 12, color: "var(--text2)" }}>{[p.desa, p.kecamatan, p.kabupaten].filter(Boolean).join(", ") || "-"}</span></td>
                    <td><span style={{ color: "var(--orange)", fontWeight: 600 }}>{rupiah(p.price)}</span></td>
                    <td>{p.stock}</td>
                    <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                    <td>⭐ {(p.averageRating || 0).toFixed(1)}</td>
                    <td><button className="btn-ghost btn-sm" onClick={() => quickEditProduct(p)}>Edit</button> <button className="btn-ghost btn-sm" onClick={() => editSellerMapLink(p)}>Edit Maps</button> <button className="btn-ghost btn-sm" onClick={() => editProductLocation(p)}>Edit Lokasi</button> <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => softDeleteProduct(p)}>Hapus</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  );
}

function SellerOrders({ orders, createNotif, hasCommissionDebt = false, commissionDebt = 0 }) {
  const [shipForm, setShipForm] = useState({});
  const [quoteForm, setQuoteForm] = useState({});
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const visibleOrders = orders.filter((o) => !isOrderHiddenForRole(o, "seller"));
  const sortedOrders = sortNewest(visibleOrders);
  const deletableOrders = sortedOrders.filter(canSoftDeleteOrder);
  const selectedDeletable = selectedOrderIds.filter((id) => sortedOrders.some((o) => o.id === id && canSoftDeleteOrder(o)));

  function toggleSelectOrder(orderId) {
    setSelectedOrderIds((prev) => prev.includes(orderId) ? prev.filter((id) => id !== orderId) : [...prev, orderId]);
  }

  function toggleSelectAllDeletable() {
    const ids = deletableOrders.map((o) => o.id);
    setSelectedOrderIds((prev) => ids.every((id) => prev.includes(id)) ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]);
  }

  async function deleteSelectedOrders() {
    if (selectedDeletable.length === 0) { alert("Pilih order selesai/dibatalkan dulu."); return; }
    if (!confirm(`Hapus ${selectedDeletable.length} order dari dashboard seller? Data order tetap aman untuk buyer/admin.`)) return;
    await softDeleteOrdersForRole(selectedDeletable, "seller");
    setSelectedOrderIds((prev) => prev.filter((id) => !selectedDeletable.includes(id)));
  }

  async function deleteSingleOrder(order) {
    if (!canSoftDeleteOrder(order)) { alert("Hanya order Selesai atau Dibatalkan yang bisa dihapus."); return; }
    if (!confirm("Hapus order ini dari dashboard seller?")) return;
    await softDeleteOrderForRole(order.id, "seller");
    setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
  }

  const isPickup = (o) => o.shippingType === "pickup";
  const isSameDay = (o) => o.shippingType === "same_day";
  const isExpedition = (o) => !isPickup(o) && !isSameDay(o);

  async function quoteShipping(o) {
    const cost = Number(String(quoteForm[o.id] || "").replace(/\D/g, ""));
    if (!cost || cost < 0) { alert("Isi harga ongkir dulu"); return; }
    const productTotal = Number(o.productTotal || 0);
    const adminFee = getProductCommissionTotal(o);
    const sellerAmount = Math.max(0, productTotal - adminFee + cost);
    const totalAmount = productTotal + cost;
    await updateDoc(doc(db, "orders", o.id), {
      shippingCost: cost,
      totalAmount,
      sellerAmount,
      sellerReceivableAmount: isTransferPayment(o) ? sellerAmount : 0,
      sellerProductAmount: Math.max(0, productTotal - adminFee),
      sellerShippingAmount: cost,
      cashReceivedBySeller: isCashPayment(o) ? totalAmount : 0,
      pendingShippingQuote: false,
      statusPembayaran: o.paymentMethod === "cash" ? "tunai" : "menunggu_pembayaran",
      statusPesanan: o.paymentMethod === "cash" ? "pesanan_masuk" : "menunggu_pembayaran",
      courierService: `Ongkir: ${rupiah(cost)}`,
      updatedAt: serverTimestamp()
    });
    // Komisi tunai diproses saat order selesai, bukan saat ongkir dikirim.
    await createNotif({ role: "buyer", userId: o.buyerId, type: "shipping_quote_ready", title: "Ongkir Sudah Dihitung", message: `Ongkir ${o.productName} adalah ${rupiah(cost)}. Silakan lanjutkan pembayaran.`, orderId: o.id });
    alert("Ongkir dikirim ke buyer");
  }

  async function processOrder(o) {
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Kamu belum bisa proses order.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (isPickup(o)) {
      alert("Ambil di tempat tidak memakai proses/kirim. Konfirmasi setelah pembeli datang.");
      return;
    }
    if (o.statusPembayaran !== "sudah_dibayar" && o.paymentMethod !== "cash") { alert("Order transfer harus di-approve admin dulu"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "diproses", processedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_processing", title: "Pesanan Diproses", message: `Pesanan ${o.productName} sedang diproses seller.`, orderId: o.id });
  }

  async function confirmPickup(o) {
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Kamu belum bisa konfirmasi pickup.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (!confirm("Konfirmasi hanya setelah pembeli sudah datang dan mengambil pesanan. Lanjutkan?")) return;
    await completeOrderAndCreditSeller(o, { pickupConfirmedAt: serverTimestamp() }, createNotif);
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_done", title: "Pesanan Diambil", message: `Pesanan ${o.productName} sudah dikonfirmasi seller. Silakan beri ulasan bintang dan komentar.`, orderId: o.id });
    alert("Pesanan ambil di tempat sudah dikonfirmasi. Buyer akan diminta beri ulasan.");
  }

  async function sendSameDay(o) {
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dikirim", expeditionName: "Same Day Lokal", trackingNumber: "", shippedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_shipped", title: "Pesanan Same Day Dikirim", message: `Pesanan ${o.productName} sedang dikirim oleh seller.`, orderId: o.id });
    alert("Pesanan Same Day ditandai sedang dikirim");
  }

  async function sendTracking(o) {
    if (isPickup(o) || isSameDay(o)) {
      alert("Resi hanya untuk ekspedisi. Ambil di tempat dan Same Day tidak memakai nomor resi.");
      return;
    }
    const data = shipForm[o.id] || {};
    if (!data.expeditionName || !data.trackingNumber) { alert("Isi nama ekspedisi dan nomor resi"); return; }
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dikirim", expeditionName: data.expeditionName, trackingNumber: data.trackingNumber, shippedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_shipped", title: "Pesanan Dikirim 🚚", message: `Pesanan ${o.productName} dikirim via ${data.expeditionName}. Resi: ${data.trackingNumber}`, orderId: o.id });
    alert("Resi berhasil dikirim ke buyer");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>🛒 Pesanan Masuk ({sortedOrders.length})</div>
      {deletableOrders.length > 0 && (
        <div className="card" style={{ marginBottom: 14, padding: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-ghost btn-sm" onClick={toggleSelectAllDeletable}>Pilih Semua</button>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Order selesai/dibatalkan</span>
          </div>
          <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={deleteSelectedOrders} disabled={selectedDeletable.length === 0}>Hapus yang Dipilih ({selectedDeletable.length})</button>
        </div>
      )}
      {sortedOrders.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>Belum ada pesanan masuk</p></div>
      ) : sortedOrders.map((o) => {
        const s = statusLabel(o.statusPesanan);
        const needQuote = o.statusPembayaran === "menunggu_ongkir" || o.pendingShippingQuote;
        return (
          <div key={o.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <img src={o.productImage || "https://via.placeholder.com/72?text=No"} alt={o.productName} onClick={() => openImagePreview(o.productImage || "https://via.placeholder.com/240?text=No", o.productName || "Foto Produk")} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0, cursor: "zoom-in" }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{o.productName}</span>
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}>
                  <span>Pembeli: {o.buyerName}</span>
                  <span>WA: {o.buyerWhatsapp}</span>
                  <span>Qty: {o.quantity}</span>
                  <span>Subtotal: {rupiah(o.productTotal)}</span>
                  <span>Ongkir: {rupiah(o.shippingCost)}</span>
                  <span>Total Bayar: <b style={{ color: "var(--orange)" }}>{rupiah(o.totalAmount)}</b></span>
                  <span>Metode Pembayaran: <b style={{ color: isCashPayment(o) ? "#D97706" : "#2563EB" }}>{isCashPayment(o) ? "Tunai" : paymentMethodLabel(o.paymentMethod)}</b></span>
                  <span>Kurir: {o.courierName}</span>
                  <span>{isCashPayment(o) ? "Tunai diterima seller" : "Saldo masuk saat selesai"}: <b style={{ color: "#10B981" }}>{rupiah(isCashPayment(o) ? o.totalAmount : getSellerReceivableAmount(o))}</b></span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 8, padding: 10, background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10 }}>
                  <div style={{ fontWeight: 800, color: "var(--text2)", marginBottom: 4 }}>📍 Detail alamat pembeli</div>
                  <div>Nama: {o.buyerName || "-"}</div>
                  <div>WA: {o.buyerWhatsapp || "-"}</div>
                  <div>Alamat: {o.buyerAddress || "-"}</div>
                  {(o.buyerVillage || o.buyerDistrict || o.buyerRegency) && <div>Wilayah: {[o.buyerVillage, o.buyerDistrict, o.buyerRegency].filter(Boolean).join(", ")}</div>}
                  <div>Pengiriman: {o.courierName || "-"}{o.courierService ? ` ${o.courierService}` : ""}</div>
                </div>
                {isPickup(o) && o.sellerMapLink && <div style={{ fontSize: 12, marginTop: 6 }}>Link lokasi toko: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.sellerMapLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Toko</button><br/><b>Siapkan pesanannya dan lakukan konfirmasi setelah pembeli datang.</b></div>}
                {isSameDay(o) && o.buyerMapsLink && <div style={{ fontSize: 12, marginTop: 6 }}>Maps pembeli: <button type="button" className="btn-primary btn-sm" onClick={() => window.open(o.buyerMapsLink, "_blank")} style={{ marginLeft: 6 }}>Buka Maps Pembeli</button></div>}
                {isExpedition(o) && (o.buyerVillage || o.buyerDistrict || o.buyerRegency) && <div style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>Alamat ongkir: {o.buyerVillage}, {o.buyerDistrict}, {o.buyerRegency} <button type="button" className="btn-primary btn-sm" onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")}>Cek Ongkir</button><button type="button" className="btn-ghost btn-sm" onClick={() => copyToClipboard(getOrderShippingAddress(o), "Alamat sudah disalin")}>Salin Alamat Ongkir</button></div>}
              </div>
            </div>

            {o.paymentProofUrl && <div style={{ marginTop: 10 }}><img src={o.paymentProofUrl} alt="Bukti" onClick={() => openImagePreview(o.paymentProofUrl, "Bukti Transfer")} style={{ width: 160, height: 100, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }} /></div>}

            {needQuote && !isPickup(o) && (
              <div style={{ marginTop: 12, padding: 12, background: "#FFF8E1", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{isSameDay(o) ? "Isi Ongkir Same Day" : "Isi Ongkir Ekspedisi"}</div>
                {isExpedition(o) && <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}><button type="button" className="btn-primary btn-sm" onClick={() => window.open("https://rajaongkir.com/cek-ongkir", "_blank")}>Cek Ongkir</button><button type="button" className="btn-ghost btn-sm" onClick={() => copyToClipboard(getOrderShippingAddress(o), "Alamat sudah disalin")}>Salin Alamat Ongkir</button></div>}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input className="form-input" style={{ maxWidth: 220 }} placeholder="Harga ongkir, contoh 15000" value={quoteForm[o.id] || ""} onChange={(e) => setQuoteForm({ ...quoteForm, [o.id]: Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID") })} />
                  <button className="btn-primary btn-sm" onClick={() => quoteShipping(o)}>Kirim Ongkir</button>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {canSoftDeleteOrder(o) && <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={selectedOrderIds.includes(o.id)} onChange={() => toggleSelectOrder(o.id)} /> Pilih</label>}
              {canSoftDeleteOrder(o) && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={() => deleteSingleOrder(o)}>Hapus Order</button>}
              {!needQuote && isPickup(o) && o.statusPesanan === "pesanan_masuk" && (
                <div style={{ width: "100%" }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--orange)", marginBottom: 8 }}>Konfirmasi ketika pembeli sudah datang dan mengambil pesanan.</div>
                  <button className="btn-primary btn-sm" onClick={() => confirmPickup(o)}>✅ Konfirmasi Pembeli Datang</button>
                </div>
              )}

              {!needQuote && !isPickup(o) && o.statusPesanan === "pesanan_masuk" && (
                <button className="btn-primary btn-sm" onClick={() => processOrder(o)}>🔄 Proses</button>
              )}

              {isSameDay(o) && o.statusPesanan === "diproses" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {o.buyerMapsLink && <button type="button" className="btn-ghost btn-sm" onClick={() => window.open(o.buyerMapsLink, "_blank")}>Buka Maps Pembeli</button>}
                  <button className="btn-primary btn-sm" style={{ background: "#3B82F6" }} onClick={() => sendSameDay(o)}>🚚 Kirim</button>
                </div>
              )}

              {isExpedition(o) && o.statusPesanan === "diproses" && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input className="form-input" style={{ maxWidth: 180 }} placeholder="Nama ekspedisi" value={shipForm[o.id]?.expeditionName || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), expeditionName: e.target.value } })} />
                  <input className="form-input" style={{ maxWidth: 180 }} placeholder="Nomor resi" value={shipForm[o.id]?.trackingNumber || ""} onChange={(e) => setShipForm({ ...shipForm, [o.id]: { ...(shipForm[o.id] || {}), trackingNumber: e.target.value } })} />
                  <button className="btn-primary btn-sm" style={{ background: "#3B82F6" }} onClick={() => sendTracking(o)}>🚚 Kirim Resi</button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}


function Withdraw({ user, profile, wallet, totalSales = 0, withdrawals = [], hasCommissionDebt = false, commissionDebt = 0, createNotif }) {
  const [amountText, setAmountText] = useState("");
  const [form, setForm] = useState({ bankName: "", accountNumber: "", accountHolder: "" });
  const [loading, setLoading] = useState(false);
  const bankLoadedRef = useRef(false);
  const amount = Number(amountText.replace(/\D/g, ""));
  const savedBank = {
    bankName: wallet?.bankName || wallet?.bank?.bankName || wallet?.rekening?.bankName || profile?.bankName || "",
    accountNumber: wallet?.accountNumber || wallet?.bank?.accountNumber || wallet?.rekening?.accountNumber || profile?.accountNumber || "",
    accountHolder: wallet?.accountHolder || wallet?.bank?.accountHolder || wallet?.rekening?.accountHolder || profile?.accountHolder || "",
  };

  useEffect(() => {
    if (bankLoadedRef.current) return;
    if (!savedBank.bankName && !savedBank.accountNumber && !savedBank.accountHolder) return;
    setForm(savedBank);
    bankLoadedRef.current = true;
  }, [savedBank.bankName, savedBank.accountNumber, savedBank.accountHolder]);

  const sellerWithdrawalStatus = (status) => {
    if (status === "approved") return { label: "Diproses", cls: "warning" };
    if (status === "paid") return { label: "Saldo sudah ditransfer ke rekening anda", cls: "success" };
    if (status === "rejected") return { label: "Ditolak", cls: "danger" };
    return { label: "Menunggu persetujuan admin", cls: "warning" };
  };
  const formatDate = (value) => {
    const date = value?.toDate ? value.toDate() : value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return "-";
    return date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" });
  };

  async function submit(e) {
    e.preventDefault();
    if (hasCommissionDebt) { alert(`Akun seller sedang diblokir manual oleh admin/sub admin. Penarikan belum bisa dilakukan.${commissionDebt > 0 ? ` Tagihan komisi: ${rupiah(commissionDebt)}.` : ""}`); return; }
    if (amount < 10000) { alert("Minimal penarikan adalah Rp10.000"); return; }
    if (amount > Number(wallet?.saldoTersedia || 0)) { alert("Saldo tersedia tidak cukup untuk penarikan ini"); return; }
    setLoading(true);
    try {
      const withdrawalRef = doc(collection(db, "withdrawals"));
      const walletRef = doc(db, "seller_wallets", user.uid);
      const batch = writeBatch(db);
      batch.set(walletRef, {
        sellerId: user.uid,
        saldoTersedia: increment(-amount),
        saldoTertahan: increment(amount),
        bankName: form.bankName,
        accountNumber: form.accountNumber,
        accountHolder: form.accountHolder,
        bank: { bankName: form.bankName, accountNumber: form.accountNumber, accountHolder: form.accountHolder },
        rekening: { bankName: form.bankName, accountNumber: form.accountNumber, accountHolder: form.accountHolder },
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.set(withdrawalRef, {
        sellerId: user.uid, sellerName: profile.name, amount, bankName: form.bankName,
        accountNumber: form.accountNumber, accountHolder: form.accountHolder, status: "pending",
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      batch.set(doc(collection(db, "wallet_transactions")), {
        sellerId: user.uid, withdrawalId: withdrawalRef.id, type: "withdraw_request", amount,
        note: "Request penarikan, saldo dipindahkan ke saldo tertahan", createdAt: serverTimestamp()
      });
      await batch.commit();
      await createNotif({ role: "admin", type: "withdraw_new", title: "Penarikan Baru", message: `Penarikan baru dari ${profile.name} sebesar ${rupiah(amount)} ke ${form.bankName}`, withdrawalId: withdrawalRef.id });
      setAmountText("");
      alert("Pengajuan penarikan berhasil dikirim. Data rekening tersimpan untuk penarikan berikutnya.");
    } catch (error) {
      console.error("Gagal mengajukan penarikan:", error);
      alert("Gagal mengajukan penarikan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💰 Penarikan Saldo</div>
      {hasCommissionDebt && <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", borderRadius: 10, padding: 14, marginBottom: 16, color: "#B91C1C", fontSize: 13 }}>Penarikan diblokir manual oleh admin/sub admin.{commissionDebt > 0 && <> Tagihan komisi: <b>{rupiah(commissionDebt)}</b>.</>}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#10B98115" }}><span>💰</span></div>
          <div className="stat-value" style={{ color: "#10B981", fontSize: 18 }}>{rupiah(wallet?.saldoTersedia || 0)}</div>
          <div className="stat-label">Saldo Tersedia</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#F59E0B15" }}><span>📈</span></div>
          <div className="stat-value" style={{ color: "#F59E0B", fontSize: 18 }}>{rupiah(totalSales)}</div>
          <div className="stat-label">Total Penjualan</div>
        </div>
      </div>
      <div className="card" style={{ maxWidth: 480, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>Ajukan Penarikan</div>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Jumlah (minimal Rp10.000)</label>
            <input className="form-input" placeholder="Contoh: 50.000" value={amountText}
              onChange={(e) => setAmountText(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))} required />
          </div>
          <div className="form-group">
            <label>Nama Bank</label>
            <input className="form-input" placeholder="BCA / BRI / Mandiri / dll" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Nomor Rekening</label>
            <input className="form-input" placeholder="1234567890" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Atas Nama</label>
            <input className="form-input" placeholder="Nama sesuai rekening" value={form.accountHolder} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Memproses..." : "Ajukan Penarikan"}</button>
        </form>
        {(savedBank.bankName || savedBank.accountNumber || savedBank.accountHolder) && (
          <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
            <div style={{ fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>Data rekening tersimpan</div>
            <div>{savedBank.bankName || "-"} • {savedBank.accountNumber || "-"}</div>
            <div>Atas nama: {savedBank.accountHolder || "-"}</div>
            <button type="button" className="btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setForm(savedBank)}>Edit / Pakai Data Ini</button>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800 }}>Riwayat Penarikan</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>Status berubah otomatis saat admin memproses penarikan.</div>
          </div>
          <span className="badge warning">Realtime</span>
        </div>
        {withdrawals.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}><div className="empty-icon">💸</div><p>Belum ada riwayat penarikan.</p></div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {withdrawals.map((w) => {
              const s = sellerWithdrawalStatus(w.status);
              return (
                <div key={w.id} style={{ border: "1px solid var(--border)", borderRadius: 14, padding: 14, display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "start" }}>
                  <div>
                    <div style={{ fontWeight: 800, color: "var(--orange)", marginBottom: 4 }}>{rupiah(w.amount || 0)}</div>
                    <div style={{ fontSize: 13, color: "var(--text2)" }}>{w.bankName || "-"} • {w.accountNumber || "-"}</div>
                    <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>Diajukan: {formatDate(w.createdAt)}</div>
                  </div>
                  <span className={`badge ${s.cls}`} style={{ textAlign: "center", lineHeight: 1.35 }}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
