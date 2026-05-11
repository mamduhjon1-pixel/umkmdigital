import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  runTransaction,
} from "firebase/firestore";
import { onMessage } from "firebase/messaging";
import { auth, db, getFirebaseMessaging } from "./services/firebase";
import { uploadImageToCloudinary } from "./services/cloudinary";
import { createCashCommissionBill, resolveCheckoutProduct, completeOrderAndCreditSeller, recomputeProductRating, restoreProductStockOnce, cancelCashCommissionBillForOrder } from "./services/orderLifecycle";
import PushNotificationBanner from "./components/common/PushNotificationBanner";
import { clearNotificationSession, getNotificationPermission, isPushSessionEnabled, markDashboardNotificationsRead, playOrderSound, registerPushNotification, setNotificationAudioUnlocked, showLocalBrowserNotification, unlockNotificationSound } from "./services/pushNotifications";
import InstallAppPrompt from "./components/common/InstallAppPrompt";
import CartDrawer from "./components/cart/CartDrawer";
import { LoginPage, RegisterPage } from "./pages/auth/AuthPages";
import NotificationPage from "./pages/notifications/NotificationPage";
import { HomePage, SellerStorePage, ProductDetailModal } from "./pages/shop/PublicPages";
import useRealtimeData from "./hooks/useRealtimeData";
import {
  complaintEmail,
  ADMIN_EMAILS,
  isKnownAdminEmail,
  normalizeRole,
  rupiah,
  getTodayKey,
  getNotificationDedupeKey,
  shouldThrottleNotification,
  formatNumberInput,
  parseNumberInput,
  LOCATION_FILTER_STORAGE_KEY,
  emptyLocationFilter,
  toTitleCaseLocation,
  normalizeLocationText,
  normalizeLocationKey,
  getProductLocationValue,
  getStoredLocationFilter,
  getLocationOptions,
  productMatchesLocation,
  getLocationFilterLabel,
  getStock,
  isOutOfStock,
  normalizeStatus,
  isOrderStatus
} from "./utils/appHelpers";
import { getMillis, getOrderMillis, sortNewest, getOrderStatusRank, sortOrdersByStage } from "./utils/orderUtils";
import { canSoftDeleteOrder, isOrderHiddenForRole, softDeleteOrderForRole, softDeleteOrdersForRole } from "./utils/orderActions";
import { scrollToTopSmooth, getDashboardRouteFromUrl, getDefaultDashboardTab, pushAppRoute } from "./utils/navigationUtils";
import { calcCommission, isOpenCommissionBill, shouldRemindCommissionBill, shouldRemindAdminCommissionApproval, sumCommissionDebt, getCommissionPaidAmount, getCommissionRemainingAmount, getSafeAvailableBalance } from "./utils/commissionUtils";
import { calculateDistanceKm, calculateSameDayShipping, CATEGORY_GROUPS, CATEGORY_ICONS, CATEGORIES, statusLabel, productSoldCount, copyToClipboard, getOrderShippingAddress } from "./utils/catalogUtils";
import { paymentMethodLabel, isCashPayment, isTransferPayment, getProductCommissionTotal, getSellerTransferReceivableAmount, getSellerReceivableAmount, getAdminCommissionIncome, canBuyerCancelOrder } from "./utils/paymentUtils";
import { getChatParticipantsKey, getAdminSellerChatId, isActiveSellerAccount, getOrderSalesTotal, isCompletedSale, getSellerTotalSalesFromOrders, getActiveSellerAvailableBalance, recordAdminCommissionOnce } from "./utils/businessUtils";
import { openImagePreview } from "./utils/mediaUtils";
import "./index.css";

const BuyerDashboard = lazy(() => import("./pages/buyer/BuyerDashboard"));
const SellerDashboard = lazy(() => import("./pages/seller/SellerDashboard"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const CheckoutModal = lazy(() => import("./pages/checkout/CheckoutModal"));
const ChatCenter = lazy(() => import("./components/chat/ChatCenter"));

function RouteFallback() {
  return (
    <div className="loading-screen" style={{ minHeight: "45vh" }}>
      <div className="spinner" />
      <p style={{ color: "#999", fontSize: 14 }}>Memuat halaman...</p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const initialRoute = getDashboardRouteFromUrl();
  const [page, setPage] = useState(() => {
    try {
      if (initialRoute.page && initialRoute.page !== "home") return initialRoute.page;
      const pendingPage = sessionStorage.getItem("umkm_pending_page");
      if (pendingPage) {
        sessionStorage.removeItem("umkm_pending_page");
        return pendingPage;
      }
    } catch {}
    return initialRoute.page || "home";
  });
  const [dashboardTab, setDashboardTab] = useState(initialRoute.tab || "");
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState([]);
  const [selectedCartIds, setSelectedCartIds] = useState([]);
  const [showCart, setShowCart] = useState(false);
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState(getStoredLocationFilter);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const [pushStatus, setPushStatus] = useState(() => getNotificationPermission());
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  useEffect(() => {
    try {
      localStorage.setItem(LOCATION_FILTER_STORAGE_KEY, JSON.stringify(locationFilter));
    } catch {}
  }, [locationFilter]);

  useEffect(() => {
    const onPopState = () => {
      const next = getDashboardRouteFromUrl();
      setPage(next.page || "home");
      setDashboardTab(next.tab || "");
      setShowCart(false);
      setSelectedProduct(null);
      scrollToTopSmooth();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function updateLocationFilter(next) {
    setLocationFilter((prev) => ({ ...emptyLocationFilter, ...prev, ...next }));
  }

  function resetLocationFilter() {
    setLocationFilter(emptyLocationFilter);
  }

  async function createNotif(data) {
    try {
      const payload = { ...data };
      const dedupeKey = getNotificationDedupeKey(payload);

      if (dedupeKey && shouldThrottleNotification(payload)) {
        const notifRef = doc(db, "notifications", dedupeKey);
        const existing = await getDoc(notifRef);
        if (existing.exists()) {
          await setDoc(notifRef, {
            ...payload,
            dedupeKey,
            updatedAt: serverTimestamp(),
            lastTriggeredAt: serverTimestamp(),
          }, { merge: true });
          return;
        }
        await setDoc(notifRef, {
          ...payload,
          dedupeKey,
          isRead: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
        return;
      }

      await addDoc(collection(db, "notifications"), { ...payload, isRead: false, createdAt: serverTimestamp() });
    } catch (error) {
      console.error("Gagal membuat notifikasi:", error);
    }
  }

  useEffect(() => {
    const unlock = () => unlockNotificationSound();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("touchstart", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);


  useEffect(() => {
    if (isPushSessionEnabled() && getNotificationPermission() === "granted") {
      setNotificationAudioUnlocked(true);
      setPushStatus("granted");
    }
  }, []);


  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handleMessage = (event) => {
      if (event?.data?.type === "UMKM_OPEN_PAGE" && event.data.page) {
        setPage(event.data.page);
        setShowCart(false);
        setSelectedProduct(null);
      }
    };
    navigator.serviceWorker.addEventListener("message", handleMessage);
    return () => navigator.serviceWorker.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const handleBack = (event) => {
      if (showCheckout) { event.preventDefault?.(); setShowCheckout(false); return; }
      if (showCart) { event.preventDefault?.(); setShowCart(false); return; }
      if (selectedProduct) { event.preventDefault?.(); setSelectedProduct(null); }
    };
    window.addEventListener("popstate", handleBack);
    return () => window.removeEventListener("popstate", handleBack);
  }, [showCheckout, showCart, selectedProduct]);

  useEffect(() => {
    if (!user) return;
    let unsubMessage = null;
    let active = true;
    getFirebaseMessaging().then((messaging) => {
      if (!active || !messaging) return;
      unsubMessage = onMessage(messaging, (payload) => {
        playOrderSound();
        showLocalBrowserNotification({
          id: payload?.messageId,
          title: payload?.notification?.title || payload?.data?.title || "Notifikasi Baru",
          message: payload?.notification?.body || payload?.data?.body || payload?.data?.message || "Ada aktivitas baru di UMKM Digital.",
          type: payload?.data?.type,
          chatId: payload?.data?.chatId,
        });
      });
    }).catch(() => {});
    return () => {
      active = false;
      if (typeof unsubMessage === "function") unsubMessage();
    };
  }, [user]);

  async function enablePushNotifications() {
    if (!user) return;
    setPushBusy(true);
    setPushError("");
    try {
      await registerPushNotification(user, profile);
      setPushStatus("granted");
      alert("Notifikasi berhasil diaktifkan. Suara akan tetap aktif setelah refresh, dan push notification siap menerima pesan dari sistem.");
    } catch (error) {
      console.error("Gagal mengaktifkan notifikasi:", error);
      setPushStatus(getNotificationPermission());
      setPushError(error?.message || "Gagal mengaktifkan notifikasi.");
    } finally {
      setPushBusy(false);
    }
  }

  async function logoutAndClearSession() {
    clearNotificationSession();
    try {
      if (user?.uid) {
        await setDoc(doc(db, "users", user.uid), {
          notificationEnabled: false,
          notificationLoggedOutAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    } catch {}
    await signOut(auth);
    navGoTo("home");
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      try {
        if (u) {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) {
            const rawProfile = snap.data();
            const normalizedProfile = {
              ...rawProfile,
              uid: rawProfile.uid || u.uid,
              email: rawProfile.email || u.email || "",
              role: normalizeRole(rawProfile.role || rawProfile.peran, rawProfile.email || u.email),
              isDeleted: rawProfile.isDeleted ?? rawProfile.Dihapus ?? false,
              name: rawProfile.name || rawProfile.nama || rawProfile.displayName || u.email || "User",
            };
            setProfile(normalizedProfile);

            const currentPage = new URLSearchParams(window.location.search).get("page");
            const detectedRole = normalizedProfile.role;
            if (!currentPage && (page === "login" || page === "home")) {
              if (detectedRole === "admin" || detectedRole === "sub_admin") setPage("admin");
              else if (detectedRole === "seller") setPage("seller");
              else if (detectedRole === "buyer") setPage("buyer");
            }
          } else if (isKnownAdminEmail(u.email)) {
            const adminProfile = {
              uid: u.uid,
              email: u.email || "",
              name: u.displayName || "Admin",
              role: "admin",
              status: "active",
              isDeleted: false,
            };
            setProfile(adminProfile);
            if (page === "login" || page === "home") setPage("admin");
          } else {
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Gagal memuat profil user:", error);
        setProfile(null);
      } finally {
        setLoading(false);
      }
    }, (error) => {
      console.error("Auth listener error:", error);
      setLoading(false);
    });

    const safetyTimer = setTimeout(() => setLoading(false), 6000);
    return () => {
      clearTimeout(safetyTimer);
      unsub();
    };
  }, []);

  const handleNewNotifications = useCallback((newNotifications) => {
    playOrderSound();
    newNotifications.slice(0, 3).forEach((n) => showLocalBrowserNotification(n));
  }, []);

  const {
    products,
    orders,
    reviews,
    notifications,
    withdrawals,
    paymentSetting,
    manualBalance,
    commissionSetting,
    wallets,
    commissionBills,
    adminCommissionWallet,
    adminCommissionTransactions,
    allUsers,
  } = useRealtimeData({
    user,
    profile,
    onNewOrder: playOrderSound,
    onNewNotification: handleNewNotifications,
  });

  function addToCart(product) {
    setCart((prev) => {
      const exists = prev.find((i) => i.id === product.id);
      if (exists) return prev.map((i) => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { ...product, quantity: 1 }];
    });
    setSelectedCartIds((prev) => prev.includes(product.id) ? prev : [...prev, product.id]);
    setShowCart(true);
  }
  function removeFromCart(id) {
    setCart((prev) => prev.filter((i) => i.id !== id));
    setSelectedCartIds((prev) => prev.filter((selectedId) => selectedId !== id));
  }
  function updateQty(id, qty) {
    if (qty < 1) { removeFromCart(id); return; }
    setCart((prev) => prev.map((i) => i.id === id ? { ...i, quantity: qty } : i));
  }
  function toggleCartSelection(id) {
    setSelectedCartIds((prev) => prev.includes(id) ? prev.filter((selectedId) => selectedId !== id) : [...prev, id]);
  }
  function toggleSelectAllCart() {
    setSelectedCartIds((prev) => prev.length === cart.length ? [] : cart.map((item) => item.id));
  }
  const selectedCartItems = cart.filter((item) => selectedCartIds.includes(item.id));
  const selectedCartCount = selectedCartItems.reduce((s, i) => s + Number(i.quantity || 0), 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const selectedCartTotal = selectedCartItems.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
  const isAllCartSelected = cart.length > 0 && selectedCartIds.length === cart.length;
  const unreadNotif = notifications.filter((n) => !n.isRead).length;
  const unreadChat = notifications.filter(n => !n.isRead && n.type === "chat_message").length;
  const activeProducts = products.filter((p) => p.status === "active" && !p.isDeleted);
  const effectiveRole = normalizeRole(profile?.role || profile?.peran, user?.email || profile?.email);
  const hasAdminAccess = effectiveRole === "admin" || effectiveRole === "sub_admin";
  const isAdminMode = page === "admin" && hasAdminAccess;

  useEffect(() => {
    if (user && isKnownAdminEmail(user.email) && page !== "admin") {
      setPage("admin");
      setShowCart(false);
      setSelectedProduct(null);
    }
  }, [user, page]);

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <p style={{ color: "#999", fontSize: 14 }}>Memuat aplikasi...</p>
      </div>
    );
  }

  function navGoTo(p, tab = "") {
    const sameDashboard = p === page && ["admin", "seller", "buyer"].includes(p);
    const finalTab = tab || (["admin", "seller", "buyer"].includes(p) ? (sameDashboard && dashboardTab ? dashboardTab : getDefaultDashboardTab(p)) : "");
    setPage(p);
    setDashboardTab(finalTab);
    setShowCart(false);
    setSelectedProduct(null);
    pushAppRoute(p, finalTab);
    scrollToTopSmooth();
  }

  function navDashboard(p, tab) {
    navGoTo(p, tab || getDefaultDashboardTab(p));
  }

  return (
    <div className={isAdminMode ? "app-shell admin-mode" : "app-shell"} style={{ minHeight: "100vh", background: isAdminMode ? "#F5F7FB" : "var(--bg)" }}>
      {user && (
        <PushNotificationBanner
          status={pushStatus}
          busy={pushBusy}
          error={pushError}
          enabled={isPushSessionEnabled() && pushStatus === "granted"}
          onEnable={enablePushNotifications}
        />
      )}
      <InstallAppPrompt />
      {/* ── DESKTOP NAVBAR ── */}
      <div className="nav-sticky nav-desktop">
        <div style={{ background: "var(--orange)" }}>
          <div className="nav-inner">
            <div className="nav-logo" onClick={() => navGoTo("home")}>UMKM<span>Digital</span></div>
            <div className="nav-search">
              <input placeholder="Cari produk, toko..." value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") navGoTo("home"); }} />
              <button onClick={() => navGoTo("home")}>🔍</button>
            </div>
            <div className="nav-actions">
              {user && (
                <button className="nav-icon-btn" onClick={() => setShowCart(!showCart)}>
                  🛒{cartCount > 0 && <span className="badge-count">{cartCount}</span>}
                </button>
              )}
              {user && (
                <button className="nav-icon-btn" onClick={() => navGoTo("notif")}>
                  🔔{unreadNotif > 0 && <span className="badge-count">{unreadNotif}</span>}
                </button>
              )}
              {user && (
                <button className="nav-icon-btn" onClick={() => navGoTo("chat")} title="Chat">
                  💬{unreadChat > 0 && <span className="badge-count">{unreadChat}</span>}
                </button>
              )}
              {!user ? (
                <>
                  <button className="nav-btn" onClick={() => navGoTo("login")}>Masuk</button>
                  <button className="nav-btn" style={{ background: "rgba(255,255,255,0.2)" }} onClick={() => navGoTo("register")}>Daftar</button>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {effectiveRole === "buyer" && <button className="nav-btn" onClick={() => navGoTo("buyer")}>Dashboard</button>}
                  {effectiveRole === "seller" && <button className="nav-btn" onClick={() => navGoTo("seller")}>Toko Saya</button>}
                  {hasAdminAccess && <button className="nav-btn" onClick={() => navGoTo("admin")}>Admin Panel</button>}
                  <button className="nav-user-btn" onClick={logoutAndClearSession}>
                    <div className="nav-avatar">{profile?.name?.[0]?.toUpperCase() || "U"}</div>
                    <span style={{ maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile?.name || "User"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE NAVBAR ── */}
      <div className="nav-sticky nav-mobile">
        <div className="nav-mobile-top">
          <span className="nav-mobile-logo" onClick={() => navGoTo("home")}>UMKM<span style={{ opacity: 0.8 }}>Digital</span></span>
          <div className="nav-mobile-icons">
            {user && (
              <button className="nav-icon-btn" onClick={() => setShowCart(!showCart)} style={{ fontSize: 20, padding: "4px 6px" }}>
                🛒{cartCount > 0 && <span className="badge-count">{cartCount}</span>}
              </button>
            )}
            {user && (
              <button className="nav-icon-btn" onClick={() => navGoTo("notif")} style={{ fontSize: 20, padding: "4px 6px" }}>
                🔔{unreadNotif > 0 && <span className="badge-count">{unreadNotif}</span>}
              </button>
            )}
            {!user && (
              <button onClick={() => navGoTo("login")} style={{ background: "rgba(255,255,255,0.2)", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 6, fontWeight: 600, fontSize: 13 }}>Masuk</button>
            )}
          </div>
        </div>
        <div className="nav-mobile-bottom">
          <div className="nav-search" style={{ flex: 1 }}>
            <input placeholder="Cari produk, toko..." value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") navGoTo("home"); }} />
            <button onClick={() => navGoTo("home")}>🔍</button>
          </div>
        </div>
      </div>

      {/* CART DRAWER */}
      {showCart && !isAdminMode && (
        <CartDrawer
          cart={cart}
          cartCount={cartCount}
          selectedCartIds={selectedCartIds}
          selectedCartItems={selectedCartItems}
          selectedCartCount={selectedCartCount}
          selectedCartTotal={selectedCartTotal}
          isAllCartSelected={isAllCartSelected}
          onClose={() => setShowCart(false)}
          onToggleItem={toggleCartSelection}
          onToggleAll={toggleSelectAllCart}
          onUpdateQty={updateQty}
          onRemove={removeFromCart}
          onCheckout={() => { if (selectedCartItems.length === 0) return; setShowCart(false); setShowCheckout(true); }}
        />
      )}

      {/* CHECKOUT MODAL */}
      {showCheckout && (
        <Suspense fallback={<RouteFallback />}><CheckoutModal
          cart={selectedCartItems}
          user={user}
          profile={profile}
          onClose={() => setShowCheckout(false)}
          onSuccess={() => {
            const checkedIds = new Set(selectedCartIds);
            setCart((prev) => prev.filter((item) => !checkedIds.has(item.id)));
            setSelectedCartIds([]);
            setShowCheckout(false);
            scrollToTopSmooth();
            navGoTo("buyer");
          }}
          createNotif={createNotif}
        /></Suspense>
      )}

      {/* PRODUCT DETAIL MODAL */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          reviews={reviews.filter((r) => r.productId === selectedProduct.id)}
          onClose={() => setSelectedProduct(null)}
          onAddToCart={(p) => { addToCart(p); setSelectedProduct(null); }}
          user={user}
          profile={profile}
          onSellerClick={(sellerId) => { setSelectedSellerId(sellerId); setSelectedProduct(null); navGoTo("sellerStore"); }}
          onOpenChat={() => navGoTo("chat")}
        />
      )}

      {/* PAGES */}
      {page === "home" && (
        <HomePage
          products={activeProducts}
          search={search}
          onProductClick={setSelectedProduct}
          onAddToCart={addToCart}
          user={user}
          profile={profile}
          setPage={navGoTo}
          locationFilter={locationFilter}
          onLocationFilterChange={updateLocationFilter}
          onResetLocationFilter={resetLocationFilter}
        />
      )}
      {page === "sellerStore" && (
        <SellerStorePage
          sellerId={selectedSellerId}
          products={activeProducts}
          onProductClick={setSelectedProduct}
          onAddToCart={addToCart}
          user={user}
          setPage={navGoTo}
        />
      )}
      {page === "login" && <LoginPage setPage={navGoTo} />}
      {page === "register" && <RegisterPage setPage={navGoTo} createNotif={createNotif} />}
      {page === "buyer" && effectiveRole === "buyer" && (
        <Suspense fallback={<RouteFallback />}><BuyerDashboard user={user} profile={profile} orders={sortOrdersByStage(orders.filter((o) => o.buyerId === user.uid))}
          products={activeProducts} paymentSetting={paymentSetting} createNotif={createNotif}
          onAddToCart={addToCart} onProductClick={setSelectedProduct} setPage={navGoTo}
          activeTab={dashboardTab || "beranda"} onTabChange={(tab) => navDashboard("buyer", tab)} notifications={notifications}
          onLogout={logoutAndClearSession} /></Suspense>
      )}
      {page === "seller" && effectiveRole === "seller" && (
        <Suspense fallback={<RouteFallback />}><SellerDashboard user={user} profile={profile}
          products={products.filter((p) => p.sellerId === user.uid)}
          orders={sortOrdersByStage(orders.filter((o) => {
            const sellerProductIds = new Set(products.filter((p) => p.sellerId === user.uid).map((p) => p.id));
            return o.sellerId === user.uid || sellerProductIds.has(o.productId);
          }))}
          wallets={wallets} commissionBills={commissionBills} paymentSetting={paymentSetting} commissionSetting={commissionSetting} chatUnread={unreadChat} createNotif={createNotif}
          activeTab={dashboardTab || "beranda"} onTabChange={(tab) => navDashboard("seller", tab)} notifications={notifications}
          onLogout={logoutAndClearSession} /></Suspense>
      )}
      {page === "admin" && hasAdminAccess && (
        <Suspense fallback={<RouteFallback />}><AdminDashboard user={user} profile={{ ...profile, role: effectiveRole }} products={products} orders={sortOrdersByStage(orders)} withdrawals={withdrawals}
          paymentSetting={paymentSetting} manualBalance={manualBalance} commissionSetting={commissionSetting} wallets={wallets} commissionBills={commissionBills}
          adminCommissionWallet={adminCommissionWallet} adminCommissionTransactions={adminCommissionTransactions}
          users={allUsers} createNotif={createNotif} onLogout={logoutAndClearSession} setPage={navGoTo}
          activeTab={dashboardTab || "order"} onTabChange={(tab) => navDashboard("admin", tab)} notifications={notifications} unreadNotif={unreadNotif} unreadChat={unreadChat} /></Suspense>
      )}
      {page === "admin" && user && !hasAdminAccess && (
        <div className="card" style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
          <h2>Akses Admin Belum Terbaca</h2>
          <p style={{ color: "var(--text2)", fontSize: 14 }}>Email login: {user?.email || "-"}</p>
          <p style={{ color: "var(--text2)", fontSize: 14 }}>Role terbaca: {profile?.role || profile?.peran || "belum ada profile"}</p>
          <button className="btn-primary" onClick={() => navGoTo("home")}>Kembali</button>
        </div>
      )}
      {page === "notif" && user && (
        <NotificationPage notifications={notifications} />
      )}
      {page === "chat" && user && (
        <Suspense fallback={<RouteFallback />}><ChatCenter user={user} profile={profile} createNotif={createNotif} /></Suspense>
      )}

      {/* FOOTER — hidden on mobile */}
      {!isAdminMode && <footer style={{ background: "#222", color: "#aaa", padding: "32px 16px", marginTop: 40 }} className="footer-desktop">
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32, marginBottom: 24 }}>
            <div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 12 }}>UMKM<span style={{ color: "var(--orange)" }}>Digital</span></div>
              <p style={{ fontSize: 13, lineHeight: 1.7 }}>Marketplace digital untuk UMKM lokal di sekitar anda. Produk lokal berkualitas, pembayaran aman.</p>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 12 }}>Layanan Pelanggan</div>
              <p style={{ fontSize: 13, marginBottom: 6 }}>📧 {complaintEmail}</p>
              <p style={{ fontSize: 13 }}>Senin – Sabtu, 08.00 – 17.00 WIB</p>
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, marginBottom: 12 }}>Tentang</div>
              <p style={{ fontSize: 13, marginBottom: 6, cursor: "pointer" }}>Tentang Kami</p>
              <p style={{ fontSize: 13, marginBottom: 6, cursor: "pointer" }}>Kebijakan Privasi</p>
              <p style={{ fontSize: 13, cursor: "pointer" }}>Syarat & Ketentuan</p>
            </div>
          </div>
          <div style={{ borderTop: "1px solid #333", paddingTop: 20, textAlign: "center", fontSize: 12 }}>
            © 2025 UMKM Digital di sekitar anda. Hak cipta dilindungi.
          </div>
        </div>
      </footer>}

      {/* ── BOTTOM NAVIGATION (mobile only) ── */}
      {!isAdminMode && <nav className="bottom-nav">
        <button className={`bottom-nav-item ${page === "home" ? "active" : ""}`} onClick={() => navGoTo("home")}>
          <span className="nav-icon">🏠</span>
          <span>Beranda</span>
        </button>
        <button className={`bottom-nav-item ${page === "home" && false ? "active" : ""}`}
          onClick={() => { navGoTo("home"); }}>
          <span className="nav-icon">🏪</span>
          <span>Kategori</span>
        </button>
        {user ? (
          <button className="bottom-nav-item" onClick={() => setShowCart(true)} style={{ position: "relative" }}>
            <span className="nav-icon">🛒</span>
            {cartCount > 0 && <span className="nav-badge">{cartCount}</span>}
            <span>Keranjang</span>
          </button>
        ) : (
          <button className={`bottom-nav-item ${page === "register" ? "active" : ""}`} onClick={() => navGoTo("register")}>
            <span className="nav-icon">📝</span>
            <span>Daftar</span>
          </button>
        )}
        {user ? (
          <button className={`bottom-nav-item ${page === "chat" ? "active" : ""}`} onClick={() => navGoTo("chat")} style={{ position: "relative" }}>
            <span className="nav-icon">💬</span>
            {unreadChat > 0 && <span className="nav-badge">{unreadChat}</span>}
            <span>Chat</span>
          </button>
        ) : (
          <button className={`bottom-nav-item ${page === "login" ? "active" : ""}`} onClick={() => navGoTo("login")}>
            <span className="nav-icon">🔔</span>
            <span>Notifikasi</span>
          </button>
        )}
        <button className={`bottom-nav-item ${["buyer","seller","admin","login"].includes(page) ? "active" : ""}`}
          onClick={() => {
            if (!user) navGoTo("login");
            else if (effectiveRole === "buyer") navGoTo("buyer");
            else if (effectiveRole === "seller") navGoTo("seller");
            else navGoTo("admin");
          }}>
          <span className="nav-icon">👤</span>
          <span>{user ? "Akun" : "Masuk"}</span>
        </button>
      </nav>}
    </div>
  );
}

/* ─── HOME PAGE ─────────────────────────────── */
