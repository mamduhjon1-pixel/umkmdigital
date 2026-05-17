import { useState } from "react";
import { rupiah, emptyLocationFilter, getLocationOptions, productMatchesLocation, getLocationFilterLabel, getStock, isOutOfStock } from "../../utils/appHelpers";
import { CATEGORY_GROUPS, CATEGORIES, statusLabel, productSoldCount } from "../../utils/catalogUtils";
import { openImagePreview } from "../../utils/mediaUtils";
import { startChatWithSeller } from "../../utils/chatActions";

const normalizeSearchText = (value) => String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

function getSearchableProductText(product = {}) {
  const locationParts = [
    product.kabupaten,
    product.kecamatan,
    product.desa,
    product.sellerLocation?.kabupaten,
    product.sellerLocation?.kecamatan,
    product.sellerLocation?.desa,
    product.location,
  ];

  return normalizeSearchText([
    product.productName,
    product.name,
    product.category,
    product.subCategory,
    product.description,
    product.sellerName,
    product.storeName,
    product.shopName,
    ...locationParts,
  ].filter(Boolean).join(" "));
}

function productMatchesSearch(product, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  const searchableText = getSearchableProductText(product);
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  return queryWords.every((word) => searchableText.includes(word));
}

export function HomePage({ products, search, onProductClick, onAddToCart, user, profile, setPage, locationFilter = emptyLocationFilter, onLocationFilterChange, onResetLocationFilter, buyerBanners = [] }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [activeSubCategory, setActiveSubCategory] = useState("all");
  const [sortBy, setSortBy] = useState("terbaru");

  const locationOptions = getLocationOptions(products, locationFilter);
  const hasLocationFilter = Boolean(locationFilter.kabupaten || locationFilter.kecamatan || locationFilter.desa);
  let filtered = products;
  if (hasLocationFilter) filtered = filtered.filter((p) => productMatchesLocation(p, locationFilter));
  if (search) filtered = filtered.filter((p) => productMatchesSearch(p, search));
  if (activeCategory !== "all") filtered = filtered.filter((p) => p.category === activeCategory);
  if (activeSubCategory !== "all") filtered = filtered.filter((p) => p.subCategory === activeSubCategory);
  if (sortBy === "termurah") filtered = [...filtered].sort((a, b) => a.price - b.price);
  if (sortBy === "termahal") filtered = [...filtered].sort((a, b) => b.price - a.price);
  if (sortBy === "terlaris") filtered = [...filtered].sort((a, b) => productSoldCount(b) - productSoldCount(a));

  return (
    <div className="page-container">
      {/* HERO */}
      <div className="hero-banner">
        <div className="hero-pattern" />
        <div className="hero-pattern2">🛍️</div>
        <h1>Belanja Produk UMKM<br />Lokal Berkualitas</h1>
        <p>Temukan ribuan produk UMKM terbaik di sekitar anda. Dukung pengusaha lokal, belanja lebih hemat!</p>
        <div className="hero-cta" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {!user ? (
            <>
              <button className="btn-primary" style={{ background: "#fff", color: "var(--orange)", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage("register")}>Mulai Belanja</button>
              <button className="btn-outline" style={{ border: "2px solid rgba(255,255,255,0.8)", color: "#fff", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage("login")}>Masuk</button>
            </>
          ) : (
            <button className="btn-primary" style={{ background: "#fff", color: "var(--orange)", padding: "12px 24px", fontSize: 15 }} onClick={() => setPage(profile?.role === "buyer" ? "buyer" : profile?.role === "seller" ? "seller" : "admin")}>
              Dashboard Saya →
            </button>
          )}
        </div>
      </div>


      <PublicBannerCarousel banners={buyerBanners} />

      {/* CATEGORIES */}
      <div style={{ marginBottom: 24 }}>
        <div className="section-title">Kategori</div>
        <div className="category-grid">
          {CATEGORIES.map((c) => (
            <div key={c.id} className={`cat-item ${activeCategory === c.id ? "active" : ""}`} onClick={() => { setActiveCategory(c.id); setActiveSubCategory("all"); }}>
              <span className="cat-icon">{c.icon}</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
        {activeCategory !== "all" && CATEGORY_GROUPS[activeCategory] && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button
              onClick={() => setActiveSubCategory("all")}
              style={{ padding: "7px 14px", borderRadius: 100, border: "1.5px solid", cursor: "pointer", fontWeight: 600, fontSize: 12,
                borderColor: activeSubCategory === "all" ? "var(--orange)" : "var(--border)",
                background: activeSubCategory === "all" ? "var(--orange-light)" : "#fff",
                color: activeSubCategory === "all" ? "var(--orange)" : "var(--text2)" }}
            >
              Semua {activeCategory}
            </button>
            {CATEGORY_GROUPS[activeCategory].map((sub) => (
              <button
                key={sub}
                onClick={() => setActiveSubCategory(sub)}
                style={{ padding: "7px 14px", borderRadius: 100, border: "1.5px solid", cursor: "pointer", fontWeight: 600, fontSize: 12,
                  borderColor: activeSubCategory === sub ? "var(--orange)" : "var(--border)",
                  background: activeSubCategory === sub ? "var(--orange-light)" : "#fff",
                  color: activeSubCategory === sub ? "var(--orange)" : "var(--text2)" }}
              >
                {sub}
              </button>
            ))}
          </div>
        )}
      </div>

      <LocationProductFilter
        filter={locationFilter}
        options={locationOptions}
        total={filtered.length}
        hasLocationFilter={hasLocationFilter}
        onChange={onLocationFilterChange}
        onReset={onResetLocationFilter}
      />

      {/* PRODUCTS */}
      <div>
        <div className="sort-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            {activeCategory === "all" ? "Semua Produk" : activeSubCategory !== "all" ? activeSubCategory : activeCategory}
            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--text3)", marginLeft: 8 }}>({filtered.length} produk)</span>
          </div>
          <div className="sort-buttons" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--text3)", flexShrink: 0 }}>Urutkan:</span>
            {["terbaru","termurah","termahal","terlaris"].map((s) => (
              <button key={s} onClick={() => setSortBy(s)}
                style={{ padding: "5px 12px", borderRadius: 100, fontSize: 12, border: "1.5px solid", cursor: "pointer", fontWeight: 500, flexShrink: 0,
                  borderColor: sortBy === s ? "var(--orange)" : "var(--border)",
                  background: sortBy === s ? "var(--orange-light)" : "#fff",
                  color: sortBy === s ? "var(--orange)" : "var(--text2)" }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state search-empty-state">
            <div className="empty-icon">🔍</div>
            <p>{search ? `Produk untuk “${search}” belum ditemukan` : "Tidak ada produk ditemukan"}</p>
            <span>Coba gunakan kata kunci lain, cek kategori, atau ubah filter lokasi.</span>
          </div>
        ) : (
          <div className="grid-5">
            {filtered.map((p) => (
              <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={user} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



function PublicBannerCarousel({ banners = [] }) {
  const slides = Array.isArray(banners) ? banners.filter((item) => item?.imageUrl).slice(0, 5) : [];
  if (slides.length === 0) return null;

  return (
    <section className="public-ad-carousel" aria-label="Banner promo marketplace">
      <div className="public-ad-track">
        {slides.map((banner, index) => (
          <div className="public-ad-slide" key={banner.id || banner.imageUrl || index}>
            <img src={banner.imageUrl} alt={banner.title || `Banner marketplace ${index + 1}`} loading="lazy" />
          </div>
        ))}
      </div>
      {slides.length > 1 && (
        <div className="public-ad-dots">
          {slides.map((_, index) => <span key={index} />)}
        </div>
      )}
    </section>
  );
}

function LocationProductFilter({ filter, options, total, hasLocationFilter, onChange, onReset }) {
  const safeChange = typeof onChange === "function" ? onChange : () => {};
  const safeReset = typeof onReset === "function" ? onReset : () => {};
  const activeChips = [
    filter.kabupaten ? { key: "kabupaten", label: `Kab/Kota: ${filter.kabupaten}` } : null,
    filter.kecamatan ? { key: "kecamatan", label: `Kec: ${filter.kecamatan}` } : null,
    filter.desa ? { key: "desa", label: `Desa: ${filter.desa}` } : null,
  ].filter(Boolean);

  const clearChip = (key) => {
    if (key === "kabupaten") return safeChange({ kabupaten: "", kecamatan: "", desa: "" });
    if (key === "kecamatan") return safeChange({ kecamatan: "", desa: "" });
    if (key === "desa") return safeChange({ desa: "" });
  };

  return (
    <div className="location-filter-card">
      <div className="location-filter-head">
        <div>
          <div className="location-filter-kicker">Cari produk terdekat</div>
          <div className="location-filter-title">📍 Filter Lokasi Produk</div>
          <div className="location-filter-subtitle">
            {hasLocationFilter
              ? `Menampilkan produk di ${getLocationFilterLabel(filter)}.`
              : "Pilih wilayah secara bertingkat. Kecamatan dan desa otomatis mengikuti kabupaten/kota yang dipilih."}
          </div>
        </div>
        <span className="location-active-badge">{hasLocationFilter ? getLocationFilterLabel(filter) : "Semua lokasi"}</span>
      </div>

      <div className="location-filter-controls">
        <div className="location-field">
          <label>Kabupaten / Kota</label>
          <select
            className="form-input"
            value={filter.kabupaten}
            onChange={(e) => safeChange({ kabupaten: e.target.value, kecamatan: "", desa: "" })}
          >
            <option value="">Semua Kabupaten/Kota</option>
            {options.kabupaten.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="location-field">
          <label>Kecamatan</label>
          <select
            className="form-input"
            value={filter.kecamatan}
            onChange={(e) => safeChange({ kecamatan: e.target.value, desa: "" })}
            disabled={!filter.kabupaten || options.kecamatan.length === 0}
          >
            <option value="">{filter.kabupaten ? "Semua Kecamatan" : "Pilih kabupaten dulu"}</option>
            {options.kecamatan.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <div className="location-field">
          <label>Desa / Kelurahan</label>
          <select
            className="form-input"
            value={filter.desa}
            onChange={(e) => safeChange({ desa: e.target.value })}
            disabled={!filter.kecamatan || options.desa.length === 0}
          >
            <option value="">{filter.kecamatan ? "Semua Desa/Kelurahan" : "Pilih kecamatan dulu"}</option>
            {options.desa.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
        <button type="button" className="location-reset-btn" onClick={safeReset} disabled={!hasLocationFilter}>Reset</button>
      </div>

      <div className="location-filter-bottom">
        <div className="location-filter-result"><b>{total}</b> produk sesuai filter aktif.</div>
        {activeChips.length > 0 && (
          <div className="location-chip-row">
            {activeChips.map((chip) => (
              <button key={chip.key} type="button" className="location-filter-chip" onClick={() => clearChip(chip.key)}>
                {chip.label} <span>×</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function SellerStorePage({ sellerId, products, onProductClick, onAddToCart, user, setPage }) {
  const sellerProducts = products.filter((p) => p.sellerId === sellerId && !p.isDeleted);
  const sellerName = sellerProducts[0]?.sellerName || "Toko Seller";
  const totalSold = sellerProducts.reduce((sum, p) => sum + productSoldCount(p), 0);
  const totalStock = sellerProducts.reduce((sum, p) => sum + getStock(p), 0);

  return (
    <div className="page-container">
      <button className="btn-ghost btn-sm" style={{ marginBottom: 14 }} onClick={() => setPage("home")}>← Kembali ke Beranda</button>
      <div className="card" style={{ marginBottom: 20, background: "linear-gradient(135deg, #fff, #FFF7ED)" }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ width: 58, height: 58, borderRadius: 16, background: "var(--orange-light)", color: "var(--orange)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🏪</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 900 }}>{sellerName}</div>
            <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 4 }}>{sellerProducts.length} produk aktif · {totalSold} terjual · stok tersedia {totalStock}</div>
          </div>
        </div>
      </div>
      <div className="section-title">Produk dari {sellerName}</div>
      {sellerProducts.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🏪</div><p>Produk seller belum tersedia</p></div>
      ) : (
        <div className="grid-5">
          {sellerProducts.map((p) => <ProductCard key={p.id} product={p} onClick={() => onProductClick(p)} onAddToCart={() => onAddToCart(p)} user={user} />)}
        </div>
      )}
    </div>
  );
}

export function ProductCard({ product, onClick, onAddToCart, user }) {
  return (
    <div className="product-card" onClick={onClick}>
      <img src={product.imageUrl || "https://via.placeholder.com/200x200?text=No+Image"} alt={product.productName} className="product-img" onClick={(e) => { e.stopPropagation(); openImagePreview(product.imageUrl || "https://via.placeholder.com/200x200?text=No+Image", product.productName || "Foto Produk"); }} style={{ cursor: "zoom-in" }} />
      <div className="product-info">
        <div className="product-name">{product.productName}</div>
        <div className="product-price">{rupiah(product.price)}</div>
        <div className="product-meta">
          <span>⭐ {(product.averageRating || 0).toFixed(1)}</span>
          <span>·</span>
          <span>{productSoldCount(product)} terjual</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: isOutOfStock(product) ? "#EF4444" : "#10B981", marginTop: 4 }}>
          {isOutOfStock(product) ? "Stok habis" : `Stok ${getStock(product)}`}
        </div>
        {user && (
          <button className="add-cart-btn" disabled={isOutOfStock(product)} onClick={(e) => { e.stopPropagation(); if (isOutOfStock(product)) return; onAddToCart(); }}>
            {isOutOfStock(product) ? "Stok Habis" : "+ Keranjang"}
          </button>
        )}
      </div>
    </div>
  );
}

export function ProductDetailModal({ product, reviews = [], onClose, onAddToCart, onBuyNow, user, profile, onSellerClick, onOpenChat }) {
  const [qty, setQty] = useState(1);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 style={{ fontWeight: 700 }}>Detail Produk</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <img src={product.imageUrl || "https://via.placeholder.com/240x240?text=No+Image"} alt={product.productName}
              onClick={() => openImagePreview(product.imageUrl || "https://via.placeholder.com/240x240?text=No+Image", product.productName || "Foto Produk")}
              style={{ width: 240, height: 240, objectFit: "cover", borderRadius: 12, flexShrink: 0, cursor: "zoom-in" }} />
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{product.productName}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "var(--orange)", marginBottom: 12 }}>{rupiah(product.price)}</div>
              <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>⭐ {(product.averageRating || 0).toFixed(1)}</span>
                <span style={{ fontSize: 13, color: "var(--text2)" }}>| {productSoldCount(product)} terjual</span>
                <span className={`badge ${statusLabel(product.status).cls}`}>{statusLabel(product.status).label}</span>
              </div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Kategori:</b> {product.category}{product.subCategory ? ` / ${product.subCategory}` : ""}</div>
              <div style={{ fontSize: 13, color: getStock(product) > 0 ? "var(--text2)" : "#EF4444", marginBottom: 4 }}><b>Stok:</b> {getStock(product)} {getStock(product) <= 0 ? "(Habis)" : "tersedia"}</div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 4 }}><b>Penjual:</b> <button type="button" className="link-button" onClick={() => product.sellerId && onSellerClick?.(product.sellerId)}>{product.sellerName || "Toko Seller"}</button></div>
              <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}><b>Berat:</b> {product.weightGram}g</div>
              {product.description && <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, lineHeight: 1.6 }}>{product.description}</div>}
              {reviews.length > 0 && (
                <div style={{ marginBottom: 16, padding: 12, background: "var(--bg)", borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8 }}>Ulasan Pembeli</div>
                  {reviews.slice(0, 3).map((r) => (
                    <div key={r.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8, marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700 }}>⭐ {Number(r.rating || 0).toFixed(1)} · {r.buyerName || "Pembeli"}</div>
                      {r.comment && <div style={{ fontSize: 12, color: "var(--text2)", marginTop: 4, lineHeight: 1.5 }}>{r.comment}</div>}
                    </div>
                  ))}
                </div>
              )}
              {user && (
                <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                  <div className="qty-control">
                    <button onClick={() => setQty(Math.max(1, qty - 1))}>−</button>
                    <span style={{ minWidth: 32, textAlign: "center", fontWeight: 600 }}>{qty}</span>
                    <button onClick={() => setQty(qty + 1)}>+</button>
                  </div>
                  <button className="btn-outline" style={{ flex: 1, justifyContent: "center" }} disabled={isOutOfStock(product) || qty > getStock(product)}
                    onClick={() => { if (isOutOfStock(product) || qty > getStock(product)) return alert("Stok produk tidak mencukupi."); for (let i = 0; i < qty; i++) onAddToCart(product); }}>
                    {isOutOfStock(product) ? "Stok Habis" : "🛒 Tambah ke Keranjang"}
                  </button>
                  <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={isOutOfStock(product) || qty > getStock(product)}
                    onClick={() => onBuyNow?.(product, qty)}>
                    ⚡ Beli Sekarang
                  </button>
                  {profile?.role === "buyer" && product.sellerId && product.sellerId !== user?.uid && (
                    <button className="btn-outline" style={{ flex: 1, justifyContent: "center" }}
                      onClick={async () => {
                        const chatId = await startChatWithSeller(product, user, profile);
                        if (chatId) {
                          try { sessionStorage.setItem("umkm_open_chat_id", chatId); } catch (error) { console.warn("Tidak bisa menyimpan chat tujuan", error); }
                          onClose?.();
                          onOpenChat?.();
                        }
                      }}>
                      💬 Chat Seller
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── AUTH PAGES ────────────────────────────── */
