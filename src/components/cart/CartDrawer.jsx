import { rupiah } from "../../utils/appHelpers";

export default function CartDrawer({
  cart,
  cartCount,
  selectedCartIds,
  selectedCartItems,
  selectedCartCount,
  selectedCartTotal,
  isAllCartSelected,
  onClose,
  onToggleItem,
  onToggleAll,
  onUpdateQty,
  onRemove,
  onCheckout,
}) {
  return (
    <>
      <div className="overlay-backdrop" onClick={onClose} />
      <div className="cart-drawer">
        <div className="cart-drawer-header">
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>🛒 Keranjang ({cartCount})</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, color: "#999", cursor: "pointer" }}>✕</button>
        </div>
        {cart.length > 0 && (
          <div className="cart-select-row">
            <label>
              <input type="checkbox" checked={isAllCartSelected} onChange={onToggleAll} />
              <span>Pilih semua</span>
            </label>
            <small>{selectedCartItems.length} dipilih</small>
          </div>
        )}
        <div className="cart-drawer-body">
          {cart.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>🛒</div>
              <p>Keranjang kosong</p>
            </div>
          ) : (
            cart.map((item) => {
              const isSelected = selectedCartIds.includes(item.id);
              return (
                <div key={item.id} className={`cart-item ${isSelected ? "cart-item-selected" : ""}`}>
                  <label className="cart-item-check" aria-label={`Pilih ${item.productName || "produk"}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => onToggleItem(item.id)} />
                  </label>
                  <img src={item.imageUrl} alt={item.productName} className="cart-item-img" />
                  <div className="cart-item-info">
                    <div className="cart-item-title">{item.productName}</div>
                    <div className="cart-item-price">{rupiah(item.price)}</div>
                    <div className="qty-control">
                      <button type="button" onClick={() => onUpdateQty(item.id, item.quantity - 1)}>−</button>
                      <span style={{ minWidth: 24, textAlign: "center", fontSize: 14, fontWeight: 600 }}>{item.quantity}</span>
                      <button type="button" onClick={() => onUpdateQty(item.id, item.quantity + 1)}>+</button>
                      <button type="button" onClick={() => onRemove(item.id)} className="cart-remove-btn">Hapus</button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        {cart.length > 0 && (
          <div className="cart-drawer-footer">
            <div className="cart-summary-box">
              <div>
                <span className="cart-summary-label">Total dipilih</span>
                <strong>{selectedCartCount} item</strong>
              </div>
              <span className="cart-summary-price">{rupiah(selectedCartTotal)}</span>
            </div>
            <button className="btn-primary" disabled={selectedCartItems.length === 0} style={{ width: "100%", justifyContent: "center", padding: 12 }} onClick={onCheckout}>
              Checkout Item Dipilih
            </button>
          </div>
        )}
      </div>
    </>
  );
}
