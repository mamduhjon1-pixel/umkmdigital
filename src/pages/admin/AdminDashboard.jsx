import { useEffect, useRef, useState } from "react";
import { addDoc, collection, doc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import ChatCenter from "../../components/chat/ChatCenter";
import AdminWithdraw from "../../components/admin/AdminWithdraw";
import AdminCommissionSetting from "../../components/admin/AdminCommissionSetting";
import { PaymentSetting, ManualBalance, CreateSubAdmin } from "../../components/admin/AdminSettingsForms";
import { normalizeStatus, rupiah } from "../../utils/appHelpers";
import { statusLabel } from "../../utils/catalogUtils";
import { sumCommissionDebt, shouldRemindAdminCommissionApproval } from "../../utils/commissionUtils";
import { isCashPayment, isTransferPayment, getSellerReceivableAmount, getProductCommissionTotal } from "../../utils/paymentUtils";
import { canSoftDeleteOrder, isOrderHiddenForRole, softDeleteOrderForRole, softDeleteOrdersForRole } from "../../utils/orderActions";
import { getMillis, sortNewest } from "../../utils/orderUtils";
import { restoreProductStockOnce, cancelCashCommissionBillForOrder } from "../../services/orderLifecycle";
import { getActiveSellerAvailableBalance, isCompletedSale, recordAdminCommissionOnce } from "../../utils/businessUtils";
import { markDashboardNotificationsRead } from "../../services/pushNotifications";
import { openImagePreview } from "../../utils/mediaUtils";

function AdminCommissionReport({ transactions = [], total = 0, wallet }) {
  const sorted = sortNewest(transactions);
  const saldoKomisi = Number(wallet?.saldoKomisi || 0);

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>📑 Laporan Komisi Admin</div>
      <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>
        Laporan ini realtime dari saldo komisi admin. Setiap komisi memakai ID unik, jadi tidak dobel masuk saat halaman direfresh.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#10B98115" }}><span>💰</span></div>
          <div className="stat-value" style={{ color: "#10B981", fontSize: 18 }}>{rupiah(saldoKomisi)}</div>
          <div className="stat-label">Saldo Komisi Admin</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#3B82F615" }}><span>📊</span></div>
          <div className="stat-value" style={{ color: "#3B82F6", fontSize: 18 }}>{rupiah(total)}</div>
          <div className="stat-label">Total Komisi Tercatat</div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">📑</div><p>Belum ada komisi tercatat</p></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Tanggal</th><th>Seller</th><th>Order/Tagihan</th><th>Sumber</th><th>Nominal</th><th>Status</th></tr></thead>
            <tbody>
              {sorted.map((tx) => (
                <tr key={tx.id}>
                  <td>{tx.createdAt?.seconds ? new Date(tx.createdAt.seconds * 1000).toLocaleString("id-ID") : "-"}</td>
                  <td>{tx.sellerName || tx.sellerId || "-"}</td>
                  <td style={{ fontSize: 12 }}>
                    {tx.orderId && <div>Order: {String(tx.orderId).slice(0, 8)}...</div>}
                    {tx.billId && <div>Tagihan: {String(tx.billId).slice(0, 8)}...</div>}
                    {tx.productName && <div>{tx.productName}</div>}
                  </td>
                  <td>{tx.source || "komisi"}</td>
                  <td><b style={{ color: "#10B981" }}>{rupiah(tx.amount)}</b></td>
                  <td><span className="badge badge-green">{tx.status || "masuk"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AdminCommissionBills({ bills = [], createNotif }) {
  const sorted = sortNewest(bills);
  const [approvingBillIds, setApprovingBillIds] = useState({});
  const [cancellingBillIds, setCancellingBillIds] = useState({});

  async function approveBill(bill) {
    if (approvingBillIds[bill.id] || bill.status !== "menunggu_approval") return;
    setApprovingBillIds((prev) => ({ ...prev, [bill.id]: true }));
    try {
      const approvedAmount = Number(bill.remaining || bill.amount || 0);
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, "komisi_tagihan", bill.id);
        const freshBill = await transaction.get(billRef);
        const data = freshBill.data() || {};
        if (data.status !== "menunggu_approval") {
          throw new Error("Tagihan ini sudah diproses.");
        }
        transaction.update(billRef, {
          status: "approved",
          remaining: 0,
          manualPaidAmount: approvedAmount,
          approvedAt: serverTimestamp(),
          paidManualAt: serverTimestamp(),
          note: `Sisa tagihan ${rupiah(approvedAmount)} sudah di-approve admin dari bukti transfer.`,
          updatedAt: serverTimestamp(),
        });
        if (bill.orderId) {
          transaction.update(doc(db, "orders", bill.orderId), {
            cashCommissionStatus: "approved",
            cashCommissionRemaining: 0,
            cashCommissionApprovedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        transaction.set(doc(db, "wallet_transactions", `cash_commission_approved_${bill.id}`), {
          sellerId: bill.sellerId,
          billId: bill.id,
          orderId: bill.orderId || null,
          type: "cash_commission_manual_approved",
          amount: approvedAmount,
          note: "Komisi tunai disetujui admin dari bukti transfer",
          createdAt: serverTimestamp(),
        });
        if (bill.sellerId) {
          transaction.update(doc(db, "users", bill.sellerId), {
            commissionBlocked: false,
            commissionUnblockedAt: serverTimestamp(),
            commissionUnblockedBy: "commission_approved",
            updatedAt: serverTimestamp(),
          });
        }
      });
      await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_approved", title: "Komisi Tunai Disetujui", message: `Bukti pembayaran komisi ${rupiah(bill.amount)} disetujui admin. Akun seller otomatis aktif kembali jika sebelumnya diblokir.`, billId: bill.id, orderId: bill.orderId || null });
      alert("Komisi disetujui. Seller otomatis dibuka blokirnya jika sebelumnya diblokir.");
    } catch (error) {
      alert(error?.message || "Gagal approve komisi. Coba lagi.");
    } finally {
      setApprovingBillIds((prev) => ({ ...prev, [bill.id]: false }));
    }
  }

  async function cancelBill(bill) {
    if (cancellingBillIds[bill.id] || bill.status !== "menunggu_approval") return;
    setCancellingBillIds((prev) => ({ ...prev, [bill.id]: true }));
    try {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, "komisi_tagihan", bill.id);
        const freshBill = await transaction.get(billRef);
        const data = freshBill.data() || {};
        if (data.status !== "menunggu_approval") {
          throw new Error("Tagihan ini sudah diproses.");
        }
        transaction.update(billRef, {
          status: "cancelled",
          proofUrl: "",
          cancelledAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        if (bill.orderId) {
          transaction.update(doc(db, "orders", bill.orderId), {
            cashCommissionStatus: "cancelled",
            cashCommissionProofUrl: "",
            updatedAt: serverTimestamp(),
          });
        }
      });
      await createNotif({ role: "seller", userId: bill.sellerId, type: "commission_cancelled", title: "Bukti Komisi Ditolak", message: `Bukti pembayaran komisi ditolak. Silakan upload ulang.`, billId: bill.id, orderId: bill.orderId || null });
      alert("Tagihan dikembalikan ke seller untuk upload ulang");
    } catch (error) {
      alert(error?.message || "Gagal menolak bukti komisi. Coba lagi.");
    } finally {
      setCancellingBillIds((prev) => ({ ...prev, [bill.id]: false }));
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>💸 Komisi Tunai Seller</div>
      <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12, marginBottom: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
        Klik <b>Approve Komisi</b> setelah bukti transfer valid. Saat approve, tagihan lunas dan blokir seller otomatis dibuka. Blokir seller tetap hanya manual dari menu Blok Seller.
      </div>
      {sorted.length === 0 ? <div className="empty-state"><div className="empty-icon">💸</div><p>Belum ada tagihan komisi</p></div> : sorted.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, fontSize: 13 }}>
            <div><b>Seller</b><br/>{bill.sellerName || bill.sellerId}</div>
            <div><b>Produk</b><br/>{bill.productName || "-"}</div>
            <div><b>Total Komisi</b><br/><span style={{ color: "var(--orange)", fontWeight: 800 }}>{rupiah(bill.amount)}</span></div>
            <div><b>Potong Saldo</b><br/>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</div>
            <div><b>Sisa Tagihan</b><br/><span style={{ color: Number(bill.remaining || 0) > 0 ? "#EF4444" : "#10B981", fontWeight: 800 }}>{rupiah(bill.remaining || 0)}</span></div>
            <div><b>Status</b><br/><span className={`badge ${bill.status === "approved" || bill.status === "auto_paid" || bill.status === "autopaid" || bill.status === "paid" ? "badge-green" : bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status}</span></div>
          </div>
          {bill.note && <div style={{ marginTop: 10, fontSize: 12, color: "var(--text3)", background: "#F8FAFC", borderRadius: 8, padding: 8 }}>{bill.note}</div>}
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" onClick={() => openImagePreview(bill.proofUrl, "Bukti Komisi")} style={{ marginTop: 10, width: 180, height: 110, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }} />}
          {bill.status === "menunggu_approval" && (
            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="btn-primary btn-sm" onClick={() => approveBill(bill)} disabled={!!approvingBillIds[bill.id]}>{approvingBillIds[bill.id] ? "Memproses..." : "Approve Komisi"}</button>
              <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => cancelBill(bill)} disabled={!!cancellingBillIds[bill.id]}>{cancellingBillIds[bill.id] ? "Memproses..." : "Cancel/Tolak"}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboard({ user, profile, products, orders, withdrawals, paymentSetting, manualBalance, commissionSetting, wallets, commissionBills = [], adminCommissionWallet, adminCommissionTransactions = [], users, createNotif, onLogout, setPage, activeTab = "order", onTabChange, notifications = [], unreadNotif = 0, unreadChat = 0 }) {
  const tab = activeTab || "order";
  const remindedAdminApprovalBillsRef = useRef(new Set());
  const syncedAdminCommissionRef = useRef(new Set());
  const activeSellerBalance = getActiveSellerAvailableBalance(wallets, users);
  const displayedBalance = activeSellerBalance;
  const adminCommissionBalance = Number(adminCommissionWallet?.saldoKomisi || 0);
  const commissionReportTotal = adminCommissionTransactions.reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  const isAdmin = profile?.role === "admin";
  const isSubAdmin = profile?.role === "sub_admin";

  useEffect(() => {
    if (!(isAdmin || isSubAdmin)) return;

    const syncItems = [];

    orders.forEach((order) => {
      if (!order?.id || !isCompletedSale(order)) return;
      const amount = getProductCommissionTotal(order);
      if (amount <= 0) return;

      if (isTransferPayment(order)) {
        syncItems.push({
          entryId: `order_${order.id}_transfer_commission`,
          amount,
          sellerId: order.sellerId,
          sellerName: order.sellerName,
          orderId: order.id,
          productName: order.productName,
          source: "transfer_qris_order",
          note: "Komisi admin dari order transfer/QRIS selesai",
        });
      }
    });

    commissionBills.forEach((bill) => {
      if (!bill?.id) return;
      const autoPaid = Number(bill.autoDeductedFromBalance || bill.paidFromBalance || 0);
      const manualPaid = Number(bill.manualPaidAmount || 0);

      if (autoPaid > 0 && ["auto_paid", "partial", "approved", "paid"].includes(String(bill.status || ""))) {
        syncItems.push({
          entryId: `bill_${bill.id}_auto_balance_commission`,
          amount: autoPaid,
          sellerId: bill.sellerId,
          sellerName: bill.sellerName,
          orderId: bill.orderId || null,
          billId: bill.id,
          productName: bill.productName,
          source: "cash_commission_auto_balance",
          note: "Komisi tunai masuk dari potongan saldo seller",
        });
      }

      if (manualPaid > 0 && ["approved", "paid"].includes(String(bill.status || ""))) {
        syncItems.push({
          entryId: `bill_${bill.id}_manual_transfer_commission`,
          amount: manualPaid,
          sellerId: bill.sellerId,
          sellerName: bill.sellerName,
          orderId: bill.orderId || null,
          billId: bill.id,
          productName: bill.productName,
          source: "cash_commission_manual_transfer",
          note: "Komisi tunai masuk dari bukti transfer seller yang di-approve admin",
        });
      }
    });

    syncItems.forEach((item) => {
      if (!item.entryId || syncedAdminCommissionRef.current.has(item.entryId)) return;
      syncedAdminCommissionRef.current.add(item.entryId);
      recordAdminCommissionOnce(item.entryId, item).catch((error) => {
        syncedAdminCommissionRef.current.delete(item.entryId);
        console.error("Gagal sinkron saldo komisi admin:", error);
      });
    });
  }, [orders, commissionBills, isAdmin, isSubAdmin]);

  useEffect(() => {
    if (!(isAdmin || isSubAdmin) || !createNotif) return;

    commissionBills
      .filter(shouldRemindAdminCommissionApproval)
      .forEach(async (bill) => {
        if (!bill?.id || remindedAdminApprovalBillsRef.current.has(bill.id)) return;
        remindedAdminApprovalBillsRef.current.add(bill.id);
        const amount = Number(bill.remaining || bill.amount || 0);
        try {
          await createNotif({
            role: "admin",
            type: "commission_approval_reminder",
            title: "Pengingat Approval Komisi",
            message: `Ada bukti pembayaran komisi ${rupiah(amount)} dari ${bill.sellerName || "seller"} yang masih menunggu approval admin.`,
            billId: bill.id,
            orderId: bill.orderId || null,
            sellerId: bill.sellerId || null,
          });
          await updateDoc(doc(db, "komisi_tagihan", bill.id), {
            lastAdminApprovalReminderAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (error) {
          remindedAdminApprovalBillsRef.current.delete(bill.id);
          console.error("Gagal membuat pengingat approval komisi admin:", error);
        }
      });
  }, [commissionBills, isAdmin, isSubAdmin, createNotif]);

  const tabs = [
    { id: "order", label: "Order Masuk", icon: "🛒" },
    { id: "sellerApproval", label: "Approve Seller", icon: "✅" },
    { id: "sellerBlock", label: "Blok Seller", icon: "🚫" },
    { id: "chat", label: "Chat Seller", icon: "💬" },
    { id: "commission", label: "Komisi Tunai", icon: "💸" },
    { id: "commissionReport", label: "Laporan Komisi", icon: "📑" },
    ...(isAdmin ? [
      { id: "produk", label: "Kelola Produk", icon: "📦" },
      { id: "users", label: "Kelola Akun", icon: "👥" },
      { id: "withdraw", label: "Penarikan", icon: "💰" },
      { id: "commissionSetting", label: "Komisi Global", icon: "📊" },
      { id: "payment", label: "Rekening", icon: "💳" },
      { id: "balance", label: "Saldo Manual", icon: "⚙️" },
      { id: "admins", label: "Tambah Admin", icon: "👤" },
    ] : []),
  ];

  const adminMenuBadges = {
    order: orders.filter((o) => ["menunggu_pembayaran", "menunggu_verifikasi", "pesanan_masuk", "pembatalan_diajukan"].includes(o.statusPesanan) || o.cancelRequest).length,
    sellerApproval: users.filter((u) => u.role === "seller" && ["pending", "menunggu", "waiting"].includes(normalizeStatus(u.status || "pending"))).length,
    chat: unreadChat,
    commission: commissionBills.filter((b) => ["waiting_approval", "pending", "partial"].includes(normalizeStatus(b.status))).length,
    produk: products.filter((p) => p.status === "pending").length,
    withdraw: withdrawals.filter((w) => ["pending", "menunggu"].includes(normalizeStatus(w.status))).length,
    users: users.filter((u) => normalizeStatus(u.status) === "pending").length,
    commissionReport: adminCommissionTransactions.filter((tx) => !tx.readByAdmin).length,
  };

  const currentTabInfo = tabs.find((item) => item.id === tab) || tabs[0];
  const adminPrimaryStats = [
    { label: "Komisi Pending", value: adminMenuBadges.commission || 0, icon: "💸", color: "#f59e0b", tab: "commission" },
  ];
  const adminSecondaryStats = [
    { label: "Order", value: orders.length, icon: "🛒", color: "#3B82F6", tab: "order" },
    { label: "Penarikan", value: withdrawals.length, icon: "💰", color: "#F59E0B", tab: "withdraw" },
    { label: "Total Saldo Seller Aktif", value: rupiah(displayedBalance), icon: "🏪", color: "#10B981", tab: "withdraw" },
    { label: "Saldo Komisi", value: rupiah(adminCommissionBalance), icon: "📈", color: "#10B981", tab: "commissionReport" },
  ];
  const adminQuickActions = [
    ...(isAdmin ? [{ id: "withdraw", label: "Tarik", icon: "💰" }] : []),
  ];

  const goAdminTab = (nextTab) => {
    if (nextTab === "chat") markDashboardNotificationsRead({ user, profile, role: profile?.role || "admin", types: ["chat_message"] });
    if (nextTab === "order") markDashboardNotificationsRead({ user, profile, role: profile?.role || "admin", types: ["order_new", "payment_proof", "order_cancel_request", "shipping_quote_ready"] });
    if (nextTab === "sellerApproval") markDashboardNotificationsRead({ user, profile, role: profile?.role || "admin", types: ["seller_register"] });
    if (nextTab === "commission") markDashboardNotificationsRead({ user, profile, role: profile?.role || "admin", types: ["commission_payment", "commission_approval_reminder"] });
    onTabChange ? onTabChange(nextTab) : null;
  };

  return (
    <div className="admin-pro-shell">
      <aside className="admin-pro-sidebar">
        <div className="admin-pro-brand">
          <div className="admin-pro-logo">UM</div>
          <div>
            <div className="admin-pro-title">UMKM Admin</div>
            <div className="admin-pro-subtitle">Panel Operasional</div>
          </div>
        </div>
        <div className="admin-pro-profile">
          <div className="admin-pro-avatar">{(profile?.name || "A").charAt(0).toUpperCase()}</div>
          <div style={{ minWidth: 0 }}>
            <div className="admin-pro-name">{profile?.name || "Admin"}</div>
            <div className="admin-pro-role">{isAdmin ? "Admin Utama" : "Sub Admin"}</div>
          </div>
        </div>
        <div className="admin-pro-menu-label">Menu Admin</div>
        <div className="admin-pro-menu">
          {tabs.map((t) => (
            <button key={t.id} type="button" className={`admin-pro-menu-item ${tab === t.id ? "active" : ""}`} onClick={() => goAdminTab(t.id)}>
              <span className="admin-pro-menu-icon">{t.icon}</span>
              <span>{t.label}</span>
              {tab !== t.id && adminMenuBadges[t.id] > 0 && <span className="admin-pro-menu-badge">{adminMenuBadges[t.id]}</span>}
            </button>
          ))}
        </div>
        <button type="button" className="admin-pro-logout" onClick={onLogout}>🚪 Keluar</button>
      </aside>
      <main className="admin-pro-main">
        <div className="admin-mobile-header">
          <div>
            <div className="admin-mobile-kicker">Admin Center</div>
            <div className="admin-mobile-title">{currentTabInfo?.label || "Dashboard"}</div>
          </div>
          <div className="dashboard-mobile-actions">
            <button type="button" onClick={() => setPage && setPage("notif")} className="admin-mobile-notif" aria-label="Buka notifikasi admin">
              🔔
              {unreadNotif > 0 ? <span>{unreadNotif}</span> : null}
            </button>
            <button type="button" className="dashboard-mobile-logout admin-mobile-logout-btn" onClick={onLogout}>🚪 Keluar</button>
          </div>
        </div>
        <div className="admin-pro-topbar">
          <div>
            <div className="admin-pro-page-kicker">{currentTabInfo?.icon} Halaman Admin</div>
            <h1>{currentTabInfo?.label || "Kontrol Admin"}</h1>
            <p>Kelola aktivitas penting secara cepat, real-time, dan nyaman dipakai di HP.</p>
          </div>
          <div className="admin-pro-actions">
            <button type="button" onClick={() => setPage && setPage("notif")} className="admin-pro-action-btn admin-notif-corner">🔔 Notifikasi {unreadNotif > 0 ? <span>{unreadNotif}</span> : null}</button>
            <button type="button" onClick={() => goAdminTab("chat")} className="admin-pro-action-btn">💬 Chat {unreadChat > 0 ? <span>{unreadChat}</span> : null}</button>
          </div>
        </div>
        <div className="admin-mobile-quick-grid">
          {adminQuickActions.map((a) => (
            <button key={a.id} type="button" className={`admin-mobile-quick ${tab === a.id ? "active" : ""}`} onClick={() => goAdminTab(a.id)}>
              <span>{a.icon}</span>
              <b>{a.label}</b>
              {tab !== a.id && adminMenuBadges[a.id] > 0 && <em>{adminMenuBadges[a.id]}</em>}
            </button>
          ))}
        </div>
        <div className="admin-pro-stats admin-primary-stats">
          {adminPrimaryStats.map((s) => (
            <button key={s.label} type="button" className="admin-pro-stat-card admin-pro-stat-button" onClick={() => goAdminTab(s.tab)}>
              <div className="stat-icon" style={{ background: s.color + "15" }}><span>{s.icon}</span></div>
              <div style={{ fontWeight: 900, color: s.color, fontSize: 22 }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </button>
          ))}
        </div>
        <div className="admin-pro-stats admin-secondary-stats">
          {adminSecondaryStats.map((s) => (
            <button key={s.label} type="button" className="admin-pro-stat-card admin-pro-stat-button" onClick={() => goAdminTab(s.tab)}>
              <div className="stat-icon" style={{ background: s.color + "15" }}><span>{s.icon}</span></div>
              <div style={{ fontWeight: 800, color: s.color, fontSize: String(s.value).length > 8 ? 13 : 18 }}>{s.value}</div>
              <div className="stat-label">{s.label}</div>
            </button>
          ))}
        </div>
        {tab === "order" && <AdminOrders orders={orders} createNotif={createNotif} />}
        {tab === "chat" && <ChatCenter user={user} profile={profile} createNotif={createNotif} mode="admin" users={users} />}
        {tab === "sellerApproval" && (isAdmin || isSubAdmin) && <AdminSellerApprovals users={users} />}
        {tab === "sellerBlock" && (isAdmin || isSubAdmin) && <AdminSellerBlocks users={users} commissionBills={commissionBills} createNotif={createNotif} />}
        {tab === "produk" && isAdmin && <AdminProducts products={products} />}
        {tab === "users" && isAdmin && <AdminUsers users={users} products={products} />}
        {tab === "withdraw" && isAdmin && <AdminWithdraw withdrawals={withdrawals} />}
        {tab === "commission" && (isAdmin || isSubAdmin) && <AdminCommissionBills bills={commissionBills} createNotif={createNotif} />}
        {tab === "commissionReport" && (isAdmin || isSubAdmin) && <AdminCommissionReport transactions={adminCommissionTransactions} total={commissionReportTotal} wallet={adminCommissionWallet} />}
        {tab === "commissionSetting" && isAdmin && <AdminCommissionSetting current={commissionSetting} products={products} />}
        {tab === "payment" && isAdmin && <PaymentSetting paymentSetting={paymentSetting} />}
        {tab === "balance" && isAdmin && <ManualBalance />}
        {tab === "admins" && isAdmin && <CreateSubAdmin />}
      </main>
    </div>
  );
}




function AdminSellerBlocks({ users = [], commissionBills = [], createNotif }) {


  const sellers = users
    .filter((u) => u.role === "seller" && !u.isDeleted && u.status !== "deleted")
    .sort((a, b) => String(a.name || a.email || "").localeCompare(String(b.name || b.email || "")));

  function sellerIdOf(u) {
    return u.uid || u.id;
  }

  function sellerDebt(sellerId) {
    return sumCommissionDebt(commissionBills.filter((b) => b.sellerId === sellerId));
  }

  async function toggleSellerBlock(u, blocked) {
    const sellerId = sellerIdOf(u);
    if (!sellerId) { alert("ID seller tidak ditemukan."); return; }
    if (!confirm(`${blocked ? "Blokir" : "Buka blokir"} seller ${u.name || u.email || sellerId}?`)) return;
    await updateDoc(doc(db, "users", sellerId), {
      commissionBlocked: blocked,
      commissionBlockedAt: blocked ? serverTimestamp() : null,
      commissionUnblockedAt: !blocked ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    if (createNotif) {
      await createNotif({
        role: "seller",
        userId: sellerId,
        type: blocked ? "seller_commission_blocked" : "seller_commission_unblocked",
        title: blocked ? "Akun Seller Diblokir Admin 🚫" : "Blokir Seller Dibuka ✅",
        message: blocked
          ? "Admin/sub admin memblokir sementara fitur upload produk, proses order, dan penarikan. Selesaikan pembayaran komisi lalu hubungi admin."
          : "Admin/sub admin sudah membuka blokir akun kamu. Fitur seller bisa digunakan kembali.",
      });
    }
    alert(blocked ? "Seller berhasil diblokir." : "Blokir seller berhasil dibuka.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>🚫 Blokir Seller Manual</div>
      <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "#78350F" }}>
        Blokir tidak otomatis. Admin/sub admin bisa blok seller yang belum bayar komisi, lalu buka lagi setelah pembayaran selesai/di-approve.
      </div>
      {sellers.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏪</div><p>Belum ada seller</p></div>
      ) : (
        <div style={{ overflow: "auto" }}>
          <table className="table">
            <thead><tr><th>Seller</th><th>Status Akun</th><th>Tagihan Komisi</th><th>Status Blok</th><th>Aksi</th></tr></thead>
            <tbody>
              {sellers.map((u) => {
                const sellerId = sellerIdOf(u);
                const debt = sellerDebt(sellerId);
                const blocked = u.commissionBlocked === true;
                return (
                  <tr key={sellerId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{u.name || "Seller"}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)" }}>{u.email || "-"}</div>
                    </td>
                    <td style={{ fontSize: 13 }}>{u.status || "active"}</td>
                    <td style={{ fontWeight: 800, color: debt > 0 ? "#EF4444" : "#10B981" }}>{rupiah(debt)}</td>
                    <td><span className={`badge ${blocked ? "badge-red" : "badge-green"}`}>{blocked ? "Diblokir" : "Aktif"}</span></td>
                    <td>
                      {blocked ? (
                        <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => toggleSellerBlock(u, false)}>Buka Blokir</button>
                      ) : (
                        <button className="btn-ghost btn-sm" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => toggleSellerBlock(u, true)}>Blokir Seller</button>
                      )}
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

function AdminSellerApprovals({ users = [] }) {
  const pendingSellers = users
    .filter((u) => u.role === "seller" && u.status !== "active" && u.status !== "approved" && !u.isDeleted)
    .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  async function approveSeller(u) {
    if (u.role !== "seller") return;
    const sellerId = u.uid || u.id;
    if (!sellerId) {
      alert("ID seller tidak ditemukan.");
      return;
    }
    await updateDoc(doc(db, "users", sellerId), {
      status: "active",
      commissionBlocked: false,
      approvedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "seller_wallets", sellerId), {
      sellerId,
      sellerName: u.name || u.email || "Seller",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
    }, { merge: true });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: sellerId,
      type: "seller_approved",
      title: "Akun Seller Disetujui ✅",
      message: "Akun seller kamu sudah disetujui admin. Sekarang kamu bisa upload produk.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert("Seller berhasil di-approve. Seller sekarang bisa upload produk.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>✅ Approve Seller</div>
      {pendingSellers.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">✅</div>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>Tidak ada seller menunggu approval</p>
          <p style={{ fontSize: 13, color: "var(--text3)" }}>Seller baru yang mendaftar akan muncul di sini.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {pendingSellers.map((u) => (
            <div className="card" key={u.uid || u.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 700 }}>{u.name || "Seller Baru"}</div>
                <div style={{ fontSize: 13, color: "var(--text3)" }}>{u.email || "-"}</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Status: <b>{u.status || "pending"}</b></div>
              </div>
              <button className="btn-primary btn-sm" onClick={() => approveSeller(u)}>Approve Seller</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminUsers({ users = [], products = [] }) {
  const [filter, setFilter] = useState("all");
  const visibleUsers = users
    .filter((u) => u.role === "buyer" || u.role === "seller" || u.role === "deleted")
    .filter((u) => filter === "all" ? true : u.role === filter)
    .sort((a, b) => getMillis(b.createdAt) - getMillis(a.createdAt));

  async function approveSeller(u) {
    if (u.role !== "seller") return;
    await updateDoc(doc(db, "users", u.uid || u.id), {
      status: "active",
      commissionBlocked: false,
      approvedAt: serverTimestamp(),
    });
    await setDoc(doc(db, "seller_wallets", u.uid || u.id), {
      sellerId: u.uid || u.id,
      sellerName: u.name || u.email || "Seller",
      saldoTersedia: 0,
      saldoTertahan: 0,
      totalPenjualan: 0,
      totalDitarik: 0,
    }, { merge: true });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: u.uid || u.id,
      type: "seller_approved",
      title: "Akun Seller Disetujui ✅",
      message: "Akun seller kamu sudah disetujui admin. Sekarang kamu bisa upload produk.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert("Akun seller berhasil disetujui. Seller sekarang bisa upload produk.");
  }

  async function toggleSellerBlock(u, blocked) {
    if (u.role !== "seller") return;
    const sellerId = u.uid || u.id;
    if (!sellerId) { alert("ID seller tidak ditemukan."); return; }
    const actionText = blocked ? "blokir" : "buka blokir";
    if (!confirm(`${blocked ? "Blokir" : "Buka blokir"} seller ${u.name || u.email || sellerId}?`)) return;
    await updateDoc(doc(db, "users", sellerId), {
      commissionBlocked: blocked,
      commissionBlockedAt: blocked ? serverTimestamp() : null,
      commissionUnblockedAt: !blocked ? serverTimestamp() : null,
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, "notifications"), {
      role: "seller",
      userId: sellerId,
      type: blocked ? "seller_commission_blocked" : "seller_commission_unblocked",
      title: blocked ? "Akun Seller Diblokir Admin 🚫" : "Blokir Seller Dibuka ✅",
      message: blocked
        ? "Admin/sub admin memblokir sementara fitur upload produk, proses order, dan penarikan. Selesaikan pembayaran komisi lalu hubungi admin."
        : "Admin/sub admin sudah membuka blokir akun kamu. Fitur seller bisa digunakan kembali.",
      isRead: false,
      createdAt: serverTimestamp(),
    });
    alert(`Seller berhasil di-${actionText}.`);
  }

  async function deleteAccount(u) {
    if (u.role !== "buyer" && u.role !== "seller") {
      alert("Hanya akun buyer atau seller yang bisa dihapus dari menu ini.");
      return;
    }
    if (!confirm(`Hapus akun ${u.name || u.email}? Akun akan dinonaktifkan dari dashboard.`)) return;
    await updateDoc(doc(db, "users", u.uid || u.id), {
      status: "deleted",
      previousRole: u.role,
      role: "deleted",
      isDeleted: true,
      deletedAt: serverTimestamp(),
    });
    if (u.role === "seller") {
      const snap = await getDocs(query(collection(db, "products"), where("sellerId", "==", u.uid || u.id)));
      await Promise.all(snap.docs.map((d) => updateDoc(doc(db, "products", d.id), { isDeleted: true, updatedAt: serverTimestamp() })));
    }
    alert("Akun berhasil dinonaktifkan. Jika ini akun seller, produk seller juga disembunyikan.");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>👥 Kelola Akun Buyer & Seller</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all", "buyer", "seller", "deleted"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
              borderColor: filter === s ? "var(--orange)" : "var(--border)",
              background: filter === s ? "var(--orange-light)" : "#fff",
              color: filter === s ? "var(--orange)" : "var(--text2)" }}>
            {s === "all" ? "Semua" : s === "buyer" ? "Buyer" : s === "seller" ? "Seller" : "Terhapus"}
          </button>
        ))}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead><tr><th>Nama</th><th>Email</th><th>Role</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {visibleUsers.map((u) => (
              <tr key={u.uid || u.id}>
                <td style={{ fontWeight: 600 }}>{u.name || "-"}</td>
                <td style={{ fontSize: 13 }}>{u.email || "-"}</td>
                <td><span className="badge badge-info">{u.previousRole && u.role === "deleted" ? u.previousRole : u.role}</span></td>
                <td style={{ fontSize: 13 }}>{u.status || "active"}{u.role === "seller" && u.commissionBlocked === true && <div><span className="badge badge-red">Diblokir Komisi</span></div>}</td>
                <td>
                  {u.role === "buyer" || u.role === "seller" ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {u.role === "seller" && u.status !== "active" && u.status !== "approved" && (
                        <button className="btn-primary btn-sm" onClick={() => approveSeller(u)}>Approve Seller</button>
                      )}
                      {u.role === "seller" && (u.commissionBlocked === true ? (
                        <button className="btn-primary btn-sm" style={{ background: "#10B981" }} onClick={() => toggleSellerBlock(u, false)}>Buka Blokir</button>
                      ) : (
                        <button className="btn-ghost btn-sm" style={{ color: "#B91C1C", borderColor: "#FCA5A5" }} onClick={() => toggleSellerBlock(u, true)}>Blokir Seller</button>
                      ))}
                      <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => deleteAccount(u)}>Hapus Akun</button>
                    </div>
                  ) : <span style={{ fontSize: 12, color: "var(--text3)" }}>Tidak ada aksi</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminProducts({ products }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? products : products.filter((p) => p.status === filter);

  async function approve(id) { await updateDoc(doc(db, "products", id), { status: "active" }); alert("Produk disetujui"); }
  async function reject(id) { await updateDoc(doc(db, "products", id), { status: "rejected" }); alert("Produk ditolak"); }
  async function updateCommission(id, type, value) {
    const v = prompt(`Komisi ${type === "percent" ? "persen (%):" : "nominal (Rp):"}`, "10");
    if (v === null) return;
    await updateDoc(doc(db, "products", id), { commissionType: type, commissionValue: Number(v) });
    alert("Komisi diperbarui");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>📦 Kelola Produk</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","pending","active","rejected"].map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
              borderColor: filter === s ? "var(--orange)" : "var(--border)",
              background: filter === s ? "var(--orange-light)" : "#fff",
              color: filter === s ? "var(--orange)" : "var(--text2)" }}>
            {s === "all" ? "Semua" : statusLabel(s).label} ({s === "all" ? products.length : products.filter((p) => p.status === s).length})
          </button>
        ))}
      </div>
      <div style={{ overflow: "auto" }}>
        <table className="table">
          <thead>
            <tr><th>Produk</th><th>Seller</th><th>Harga</th><th>Komisi</th><th>Status</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const s = statusLabel(p.status);
              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <img src={p.imageUrl || "https://via.placeholder.com/44?text=No"} alt={p.productName} onClick={() => openImagePreview(p.imageUrl || "https://via.placeholder.com/200?text=No", p.productName || "Foto Produk")} style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", cursor: "zoom-in" }} />
                      <span style={{ fontWeight: 500, fontSize: 13 }}>{p.productName}</span>
                    </div>
                  </td>
                  <td style={{ fontSize: 13 }}>{p.sellerName}</td>
                  <td style={{ color: "var(--orange)", fontWeight: 600 }}>{rupiah(p.price)}</td>
                  <td style={{ fontSize: 12 }}>{p.commissionType === "percent" ? `${p.commissionValue}%` : rupiah(p.commissionValue)}</td>
                  <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                  <td>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {p.status !== "active" && <button className="btn-primary btn-sm" onClick={() => approve(p.id)}>✅ Setujui</button>}
                      {p.status !== "rejected" && <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => reject(p.id)}>Tolak</button>}
                      <button className="btn-ghost btn-sm" onClick={() => updateCommission(p.id, "percent", p.commissionValue)}>% Komisi</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminOrders({ orders, createNotif }) {
  const [filter, setFilter] = useState("all");
  const [selectedOrderIds, setSelectedOrderIds] = useState([]);
  const visibleOrders = orders.filter((o) => !isOrderHiddenForRole(o, "admin"));
  const sortedOrders = sortNewest(visibleOrders);
  const filtered = filter === "all" ? sortedOrders : sortedOrders.filter((o) => o.statusPembayaran === filter || o.statusPesanan === filter);
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
    if (!confirm(`Hapus ${selectedDeletable.length} order dari dashboard admin? Data order tetap aman untuk buyer/seller.`)) return;
    await softDeleteOrdersForRole(selectedDeletable, "admin");
    setSelectedOrderIds((prev) => prev.filter((id) => !selectedDeletable.includes(id)));
  }

  async function deleteSingleOrder(order) {
    if (!canSoftDeleteOrder(order)) { alert("Hanya order Selesai atau Dibatalkan yang bisa dihapus."); return; }
    if (!confirm("Hapus order ini dari dashboard admin?")) return;
    await softDeleteOrderForRole(order.id, "admin");
    setSelectedOrderIds((prev) => prev.filter((id) => id !== order.id));
  }

  async function approve(o) {
    await updateDoc(doc(db, "orders", o.id), {
      statusPembayaran: "sudah_dibayar",
      statusPesanan: "pesanan_masuk",
      verifiedAt: serverTimestamp(),
      showToSeller: true,
      updatedAt: serverTimestamp(),
    });
    await createNotif({
      role: "seller",
      userId: o.sellerId,
      type: "payment_approved",
      title: "Pembayaran Buyer Disetujui",
      message: `Pembayaran ${o.productName} sudah disetujui. Saldo seller akan masuk setelah order selesai.`,
      orderId: o.id
    });
    alert("Pembayaran disetujui. Saldo seller akan masuk setelah order selesai.");
  }

  async function reject(o) {
    await restoreProductStockOnce(o);
    await cancelCashCommissionBillForOrder(o.id);
    await updateDoc(doc(db, "orders", o.id), { statusPembayaran: "ditolak", statusPesanan: "dibatalkan", updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran untuk ${o.productName} ditolak admin`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "payment_rejected", title: "Pembayaran Ditolak", message: `Pembayaran ${o.productName} ditolak admin`, orderId: o.id });
    alert("Pembayaran ditolak");
  }

  async function approveCancel(o) {
    if (!confirm("Setujui pembatalan pesanan ini?")) return;
    await restoreProductStockOnce(o);
    await cancelCashCommissionBillForOrder(o.id);
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: "dibatalkan", cancelStatus: "approved", cancelApprovedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_cancel_approved", title: "Pembatalan Disetujui", message: `Pembatalan pesanan ${o.productName} disetujui admin.`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "order_cancel_approved", title: "Pesanan Dibatalkan", message: `Pesanan ${o.productName} dibatalkan oleh admin atas pengajuan buyer.`, orderId: o.id });
    alert("Pembatalan pesanan disetujui");
  }

  async function rejectCancel(o) {
    if (!confirm("Tolak pengajuan pembatalan ini?")) return;
    const backStatus = o.paymentMethod === "cash" || o.statusPembayaran === "tunai" ? "pesanan_masuk" : (o.statusPembayaran === "sudah_dibayar" ? "pesanan_masuk" : "menunggu_pembayaran");
    await updateDoc(doc(db, "orders", o.id), { statusPesanan: backStatus, cancelRequest: false, cancelStatus: "rejected" , cancelRejectedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    await createNotif({ role: "buyer", userId: o.buyerId, type: "order_cancel_rejected", title: "Pembatalan Ditolak", message: `Pengajuan pembatalan ${o.productName} ditolak admin. Pesanan dilanjutkan.`, orderId: o.id });
    await createNotif({ role: "seller", userId: o.sellerId, type: "order_cancel_rejected", title: "Pembatalan Ditolak", message: `Pesanan ${o.productName} tetap dilanjutkan.`, orderId: o.id });
    alert("Pengajuan pembatalan ditolak");
  }


  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>🛒 Order Masuk ({sortedOrders.length})</div>
      {deletableFiltered.length > 0 && (
        <div className="card" style={{ marginBottom: 14, padding: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-ghost btn-sm" onClick={toggleSelectAllDeletable}>Pilih Semua</button>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Order selesai/dibatalkan</span>
          </div>
          <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={deleteSelectedOrders} disabled={selectedDeletable.length === 0}>Hapus yang Dipilih ({selectedDeletable.length})</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {["all","menunggu_pembayaran","menunggu_verifikasi","sudah_dibayar","pembatalan_diajukan"].map((s) => {
          const info = s === "all" ? { label: "Semua" } : statusLabel(s);
          return (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "6px 14px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer",
                borderColor: filter === s ? "var(--orange)" : "var(--border)",
                background: filter === s ? "var(--orange-light)" : "#fff",
                color: filter === s ? "var(--orange)" : "var(--text2)" }}>
              {info.label}{(s === "all" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPembayaran === s || o.statusPesanan === s).length) > 0 ? ` (${s === "all" ? sortedOrders.length : sortedOrders.filter((o) => o.statusPembayaran === s || o.statusPesanan === s).length})` : ""}
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🛒</div><p>Tidak ada order</p></div>
      ) : filtered.map((o) => {
        const s = statusLabel(o.statusPesanan);
        const sp = statusLabel(o.statusPembayaran);
        return (
          <div key={o.id} className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
              <img src={o.productImage || "https://via.placeholder.com/72?text=No"} alt={o.productName} onClick={() => openImagePreview(o.productImage || "https://via.placeholder.com/240?text=No", o.productName || "Foto Produk")} style={{ width: 72, height: 72, borderRadius: 10, objectFit: "cover", flexShrink: 0, cursor: "zoom-in" }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{o.productName}</span>
                  <span className={`badge ${sp.cls}`}>Bayar: {sp.label}</span>
                  <span className={`badge ${s.cls}`}>Pesanan: {s.label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 16px", fontSize: 13, color: "var(--text2)" }}>
                  <span>Pembeli: {o.buyerName}</span>
                  <span>WA: {o.buyerWhatsapp}</span>
                  <span>Qty: {o.quantity}</span>
                  <span>Subtotal: {rupiah(o.productTotal)}</span>
                  <span>Ongkir: {rupiah(o.shippingCost)}</span>
                  <span>Total: <b style={{ color: "var(--orange)" }}>{rupiah(o.totalAmount)}</b></span>
                  <span>Komisi: {rupiah(o.adminFee)}</span>
                  <span>{isCashPayment(o) ? "Tunai ke Seller" : "Saldo Seller"}: <b style={{ color: "#10B981" }}>{rupiah(isCashPayment(o) ? o.totalAmount : getSellerReceivableAmount(o))}</b></span>
                  <span>Kurir: {o.courierName} {o.courierService}</span>
                </div>
                {o.buyerAddress && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>📍 {o.buyerAddress}</div>}
              </div>
            </div>
            {o.paymentProofUrl && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Bukti Pembayaran:</div>
                <img src={o.paymentProofUrl} alt="Bukti" style={{ width: 200, height: 130, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }} onClick={() => openImagePreview(o.paymentProofUrl, "Bukti Transfer")} />
              </div>
            )}
            {canSoftDeleteOrder(o) && (
              <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700 }}><input type="checkbox" checked={selectedOrderIds.includes(o.id)} onChange={() => toggleSelectOrder(o.id)} /> Pilih</label>
                <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#FCA5A5" }} onClick={() => deleteSingleOrder(o)}>Hapus Order</button>
              </div>
            )}
            {o.statusPembayaran === "menunggu_verifikasi" && (
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button className="btn-primary btn-sm" onClick={() => approve(o)}>✅ Setujui Pembayaran</button>
                <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => reject(o)}>✕ Tolak</button>
              </div>
            )}
            {(o.cancelRequest || o.statusPesanan === "pembatalan_diajukan") && o.cancelStatus !== "approved" && (
              <div style={{ marginTop: 12, padding: 12, background: "#FFF8E1", borderRadius: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#92400E", marginBottom: 8 }}>Buyer mengajukan pembatalan pesanan</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn-primary btn-sm" onClick={() => approveCancel(o)}>Approve Pembatalan</button>
                  <button className="btn-ghost btn-sm" style={{ color: "#EF4444", borderColor: "#EF4444" }} onClick={() => rejectCancel(o)}>Tolak Pembatalan</button>
                </div>
              </div>
            )}
            {o.shippingType === "pickup" && o.statusPesanan !== "selesai" && (
              <div style={{ marginTop: 12, fontSize: 12, color: "var(--text3)" }}>Konfirmasi ambil di tempat dilakukan oleh seller setelah pembeli datang.</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
