export function scrollToTopSmooth() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const PAGE_PATHS = {
  home: "/",
  login: "/login",
  register: "/register",
  sellerStore: "/toko",
  chat: "/chat",
  notif: "/notifikasi",
};

const DASHBOARD_PATHS = {
  buyer: {
    beranda: "/buyer",
    pesanan: "/buyer/pesanan",
    profil: "/buyer/profil",
  },
  seller: {
    beranda: "/seller",
    order: "/seller/orderan",
    produk: "/seller/produk",
    chat: "/seller/chat",
    withdraw: "/seller/saldo",
    tagihan: "/seller/tagihan",
    profil: "/seller/profil",
  },
  admin: {
    order: "/admin/orderan",
    chat: "/admin/chat",
    sellerApproval: "/admin/verifikasi-seller",
    sellerBlock: "/admin/blokir-seller",
    produk: "/admin/produk",
    users: "/admin/pengguna",
    withdraw: "/admin/withdraw",
    commission: "/admin/komisi",
    commissionReport: "/admin/laporan-komisi",
    commissionSetting: "/admin/setting-komisi",
    payment: "/admin/pembayaran",
    balance: "/admin/saldo-manual",
    admins: "/admin/sub-admin",
  },
};

const PATH_TO_ROUTE = new Map();
Object.entries(PAGE_PATHS).forEach(([page, path]) => PATH_TO_ROUTE.set(path, { page, tab: "" }));
Object.entries(DASHBOARD_PATHS).forEach(([page, tabs]) => {
  Object.entries(tabs).forEach(([tab, path]) => PATH_TO_ROUTE.set(path, { page, tab }));
});

function normalizePath(pathname = "/") {
  const clean = String(pathname || "/").replace(/\/+$/, "");
  return clean || "/";
}

export function getDefaultDashboardTab(roleOrPage) {
  if (roleOrPage === "admin") return "order";
  if (roleOrPage === "seller") return "beranda";
  if (roleOrPage === "buyer") return "beranda";
  return "";
}

export function getDashboardRouteFromUrl() {
  try {
    const pathRoute = PATH_TO_ROUTE.get(normalizePath(window.location.pathname));
    if (pathRoute) return pathRoute;

    // Backward compatibility untuk link lama: /?page=seller&tab=produk
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page") || "home";
    const tab = params.get("tab") || (page === "admin" || page === "seller" || page === "buyer" ? getDefaultDashboardTab(page) : "");
    return { page, tab };
  } catch {
    return { page: "home", tab: "" };
  }
}

export function getPathForRoute(page, tab = "") {
  if (DASHBOARD_PATHS[page]) {
    const finalTab = tab || getDefaultDashboardTab(page);
    return DASHBOARD_PATHS[page][finalTab] || DASHBOARD_PATHS[page][getDefaultDashboardTab(page)] || "/";
  }
  return PAGE_PATHS[page] || "/";
}

export function pushAppRoute(page, tab = "") {
  try {
    const url = new URL(window.location.href);
    url.pathname = getPathForRoute(page, tab);
    url.search = "";
    window.history.pushState({ page, tab }, "", url);
  } catch {}
}
