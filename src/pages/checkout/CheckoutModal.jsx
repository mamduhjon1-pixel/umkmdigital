import { useState } from "react";
import { addDoc, collection, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../services/firebase";
import { rupiah, getStock } from "../../utils/appHelpers";
import { isCashPayment, isTransferPayment } from "../../utils/paymentUtils";
import { resolveCheckoutProduct } from "../../services/orderLifecycle";
import { calcCommission } from "../../utils/commissionUtils";

export default function CheckoutModal({ cart, user, profile, onClose, onSuccess, createNotif }) {
  const savedAddress = (() => {
    try {
      const local = localStorage.getItem(`umkm_last_shipping_address_${user?.uid}`);
      return local ? JSON.parse(local) : (profile?.savedShippingAddress || {});
    } catch {
      return profile?.savedShippingAddress || {};
    }
  })();
  const [form, setForm] = useState({
    buyerName: profile?.name || "",
    buyerWhatsapp: profile?.whatsapp || "",
    buyerAddress: savedAddress.buyerAddress || savedAddress.buyerFullAddress || profile?.detailAddress || profile?.fullAddress || "",
    shippingType: "pickup",
    paymentMethod: "transfer",
    buyerMapsLink: savedAddress.buyerMapsLink || "",
    buyerVillage: savedAddress.buyerVillage || profile?.village || "",
    buyerDistrict: savedAddress.buyerDistrict || profile?.district || "",
    buyerRegency: savedAddress.buyerRegency || profile?.regency || "",
  });
  const [loading, setLoading] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [error, setError] = useState("");
  const [shippingCheckRequested, setShippingCheckRequested] = useState(false);
  const cartTotal = cart.reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 1), 0);
  const needsSellerQuote = ["same_day", "jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);
  const needsAddress = ["jne", "pos", "tiki", "jnt", "sicepat"].includes(form.shippingType);


  function useCurrentBuyerLocation() {
    setError("");
    if (!navigator?.geolocation) {
      setError("Browser atau perangkat Anda belum mendukung fitur lokasi otomatis. Silakan tempel link Google Maps secara manual.");
      return;
    }

    setLocationLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = Number(position?.coords?.latitude);
        const lng = Number(position?.coords?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setError("Lokasi otomatis belum berhasil dibaca. Silakan coba lagi atau tempel link Google Maps manual.");
          setLocationLoading(false);
          return;
        }
        const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        setForm((prev) => ({ ...prev, buyerMapsLink: mapUrl }));
        setShippingCheckRequested(false);
        setError("");
        setLocationLoading(false);
      },
      (geoError) => {
        const denied = geoError?.code === 1;
        setError(denied ? "Izin lokasi ditolak. Aktifkan izin lokasi atau tempel link Google Maps secara manual." : "Gagal mengambil lokasi otomatis. Silakan coba lagi atau tempel link Google Maps manual.");
        setLocationLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  async function handleCheckout(e) {
    e.preventDefault();
    setError("");
    if (!user?.uid) { setError("Sesi login tidak valid. Silakan login ulang."); return; }
    if (!cart.length) { setError("Pilih minimal satu produk untuk checkout."); return; }
    setLoading(true);
    try {
      if (form.shippingType === "same_day" && !form.buyerMapsLink.trim()) throw new Error("Gunakan lokasi otomatis atau tempel link Google Maps Anda untuk Same Day.");
      if (needsAddress && (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency)) throw new Error("Desa, kecamatan, dan kabupaten wajib diisi untuk ekspedisi.");
      if (needsSellerQuote && !shippingCheckRequested) throw new Error("Klik tombol Cek Ongkir dulu agar seller menerima perintah cek ongkir.");

      const addressToSave = {
        buyerAddress: form.buyerAddress || "",
        buyerMapsLink: form.buyerMapsLink || "",
        buyerVillage: form.buyerVillage || "",
        buyerDistrict: form.buyerDistrict || "",
        buyerRegency: form.buyerRegency || "",
        updatedAt: new Date().toISOString(),
      };
      if (needsAddress || form.shippingType === "same_day") {
        try {
          localStorage.setItem(`umkm_last_shipping_address_${user.uid}`, JSON.stringify(addressToSave));
        } catch (error) {
          console.error("Gagal menyimpan alamat ke localStorage:", error);
        }
        try {
          await setDoc(doc(db, "users", user.uid), { savedShippingAddress: addressToSave }, { merge: true });
        } catch (error) {
          console.error("Gagal menyimpan alamat otomatis:", error);
        }
      }

      let createdCount = 0;
      const createdOrders = [];

      for (const rawItem of cart) {
        const item = await resolveCheckoutProduct(rawItem);
        const safeSellerId = String(item.sellerId || item.uid || item.ownerId || "");
        const safeProductId = String(item.id || item.productId || "");
        const safeProductName = String(item.productName || item.name || "Produk");
        const safeProductImage = String(item.imageUrl || item.productImage || "");
        const safeQuantity = Math.max(1, Number(rawItem.quantity || item.quantity || 1));
        const safePrice = Number(item.price || 0);

        if (!user?.uid) throw new Error("Sesi login tidak valid. Silakan login ulang.");
        if (!safeProductId) throw new Error("Data produk tidak lengkap. Hapus produk dari keranjang lalu masukkan produk lagi.");
        if (!safeSellerId) throw new Error("Data seller produk tidak lengkap. Coba hapus dari keranjang lalu tambah ulang produk. Kalau masih gagal, seller harus upload ulang produk.");
        if (!safePrice || safePrice <= 0) throw new Error("Harga produk tidak valid. Hubungi seller.");
        const productRef = doc(db, "products", safeProductId);
        const latestProductSnap = await getDoc(productRef);
        const latestStock = latestProductSnap.exists() ? getStock(latestProductSnap.data()) : getStock(item);
        if (latestStock <= 0) throw new Error(`${safeProductName} sedang habis.`);
        if (safeQuantity > latestStock) throw new Error(`Stok ${safeProductName} hanya tersisa ${latestStock}. Kurangi jumlah di keranjang.`);

        const productTotal = safePrice * safeQuantity;
        const adminFee = calcCommission(productTotal, item.commissionType, item.commissionValue);
        const effectivePaymentMethod = form.shippingType === "pickup" ? "cash" : String(form.paymentMethod || "transfer");
        let shippingCost = 0, distanceKm = 0, courierName = "Ambil di Tempat", courierService = "Gratis", statusPembayaran = "menunggu_pembayaran", statusPesanan = "menunggu_pembayaran";
        if (form.shippingType === "pickup") { statusPembayaran = "tunai"; statusPesanan = "pesanan_masuk"; }
        if (form.shippingType === "same_day") { courierName = "Same Day Lokal"; courierService = "Penjual sedang menghitung ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        if (needsAddress) { courierName = form.shippingType.toUpperCase(); courierService = "Penjual sedang cek ongkir"; statusPembayaran = "menunggu_ongkir"; statusPesanan = "menunggu_ongkir"; }
        const totalAmount = productTotal + shippingCost;
        const sellerAmount = productTotal - adminFee + shippingCost;

        const orderPayload = {
          buyerId: user.uid,
          sellerId: safeSellerId,
          sellerName: String(item.sellerName || ""),
          productId: safeProductId,
          productName: safeProductName,
          productImage: safeProductImage,
          buyerName: String(form.buyerName || profile?.name || ""),
          buyerWhatsapp: String(form.buyerWhatsapp || profile?.whatsapp || ""),
          buyerAddress: String(form.buyerAddress || ""),
          buyerMapsLink: String(form.buyerMapsLink || ""),
          buyerVillage: String(form.buyerVillage || ""),
          buyerDistrict: String(form.buyerDistrict || ""),
          buyerRegency: String(form.buyerRegency || ""),
          sellerMapLink: String(item.sellerMapLink || ""),
          sellerAddress: String(item.sellerAddress || ""),
          quantity: safeQuantity,
          productTotal,
          shippingType: String(form.shippingType || "pickup"),
          paymentMethod: effectivePaymentMethod,
          shippingCost,
          distanceKm,
          courierName,
          courierService,
          totalAmount,
          adminFee,
          sellerAmount,
          sellerReceivableAmount: isTransferPayment(effectivePaymentMethod) ? sellerAmount : 0,
          sellerProductAmount: Math.max(0, productTotal - adminFee),
          sellerShippingAmount: shippingCost,
          cashReceivedBySeller: isCashPayment(effectivePaymentMethod) ? totalAmount : 0,
          statusPembayaran,
          statusPesanan,
          proofSubmitted: false,
          reviewSubmitted: false,
          pendingShippingQuote: needsSellerQuote,
          showToSeller: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const ref = await addDoc(collection(db, "orders"), orderPayload);
        await updateDoc(productRef, { stock: increment(-safeQuantity), updatedAt: serverTimestamp() });
        createdCount += 1;
        createdOrders.push({ id: ref.id, ...orderPayload });

        // Komisi tunai diproses saat order selesai agar saldo seller bisa dipotong otomatis dulu.

        await createNotif({ role: "admin", type: "order_new", title: "Order Baru Masuk", message: `${form.buyerName} memesan ${safeProductName} senilai ${rupiah(totalAmount)}`, orderId: ref.id });
        await createNotif({ role: "seller", userId: safeSellerId, type: needsSellerQuote ? "shipping_quote_needed" : "order_new", title: needsSellerQuote ? "Cek Ongkir Pesanan" : "Ada Pesanan Baru! 🎉", message: needsSellerQuote ? `Pembeli memilih ${courierName}. Input ongkir untuk ${safeProductName}.` : `Pesanan baru: ${safeProductName} (${safeQuantity} pcs).`, orderId: ref.id });
        await createNotif({ role: "buyer", userId: user.uid, type: "order_placed", title: "Pesanan Berhasil Dibuat", message: needsSellerQuote ? `Pesanan ${safeProductName} dibuat. Penjual sedang menghitung ongkir.` : `Pesanan ${safeProductName} berhasil dibuat.`, orderId: ref.id });
      }

      if (createdCount <= 0) throw new Error("Pesanan belum berhasil dibuat. Coba lagi.");
      onSuccess();
    } catch (err) {
      console.error("Checkout gagal:", err);
      setError(err.message || "Checkout gagal. Coba lagi.");
      alert(err.message || "Checkout gagal. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}><div className="modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
      <div className="modal-header"><h3 style={{ fontWeight: 700 }}>Checkout ({cart.length} produk dipilih)</h3><button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: "#999" }}>✕</button></div>
      <form onSubmit={handleCheckout}><div className="modal-body checkout-body">
        {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>}
        <div className="checkout-summary-card">
          <div className="checkout-summary-title">Ringkasan Produk Dipilih</div>
          {cart.map((item) => <div key={item.id} className="checkout-item-row"><img src={item.imageUrl} alt={item.productName} /><div className="checkout-item-info"><div>{item.productName}</div><span>{rupiah(item.price)} × {item.quantity}</span></div><strong>{rupiah(item.price * item.quantity)}</strong></div>)}
          <div className="divider" />
          <div className="checkout-total-row"><span>Total Produk</span><span>{rupiah(cartTotal)}</span></div>
        </div>
        <div className="form-group"><label>Nama Penerima</label><input className="form-input" value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} required /></div>
        <div className="form-group"><label>WhatsApp</label><input className="form-input" value={form.buyerWhatsapp} onChange={(e) => setForm({ ...form, buyerWhatsapp: e.target.value })} required /></div>
        <div className="form-group"><label>Alamat Lengkap</label><textarea className="form-input" rows={2} value={form.buyerAddress} onChange={(e) => setForm({ ...form, buyerAddress: e.target.value })} required /></div>
        <div className="form-group"><label>Metode Pengiriman</label><select className="form-input" value={form.shippingType} onChange={(e) => { const nextShipping = e.target.value; setForm({ ...form, shippingType: nextShipping, paymentMethod: nextShipping === "pickup" ? "cash" : (["transfer","qris","cash"].includes(form.paymentMethod) ? (nextShipping === "same_day" ? form.paymentMethod : (form.paymentMethod === "cash" ? "transfer" : form.paymentMethod)) : "transfer") }); setShippingCheckRequested(false); }}><option value="pickup">Ambil di Tempat (Gratis)</option><option value="same_day">Same Day Lokal</option><option value="jne">JNE</option><option value="pos">POS</option><option value="tiki">TIKI</option><option value="jnt">J&T</option><option value="sicepat">SiCepat</option></select></div>
        {form.shippingType === "pickup" && <div className="form-group"><label>Metode Pembayaran</label><div className="form-input" style={{ background: "#f8fafc", color: "var(--text2)" }}>Tunai saat ambil barang</div><div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Tidak perlu upload bukti pembayaran. Setelah order, pembeli melihat link lokasi toko dan instruksi segera ambil pesanan.</div></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Metode Pembayaran Same Day</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option><option value="cash">Tunai saat barang diterima</option></select></div>}
        {form.shippingType !== "pickup" && form.shippingType !== "same_day" && <div className="form-group"><label>Metode Pembayaran</label><select className="form-input" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="transfer">Transfer Bank setelah ongkir keluar</option><option value="qris">Scan QRIS setelah ongkir keluar</option></select></div>}
        {form.shippingType === "same_day" && <div className="form-group"><label>Lokasi Google Maps Anda</label><div style={{ background: "#FFF8E1", border: "1px solid rgba(245, 158, 11, 0.25)", borderRadius: 10, padding: 12, marginBottom: 10 }}><div style={{ fontWeight: 700, marginBottom: 4 }}>Pilih salah satu cara kirim lokasi</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 10 }}>Gunakan lokasi otomatis dari HP/browser, atau tempel link Google Maps manual seperti sebelumnya.</div><button type="button" className="btn-primary btn-sm" onClick={useCurrentBuyerLocation} disabled={locationLoading} style={{ width: "100%", justifyContent: "center" }}>{locationLoading ? "Mengambil lokasi..." : "📍 Gunakan Lokasi Saya Otomatis"}</button></div><input className="form-input" placeholder="Atau tempel link Google Maps alamat pengiriman secara manual" value={form.buyerMapsLink} onChange={(e) => { setForm({ ...form, buyerMapsLink: e.target.value }); setShippingCheckRequested(false); }} required />{form.buyerMapsLink?.trim() && <div style={{ fontSize: 12, color: "#10B981", marginTop: 6 }}>Lokasi sudah terisi. Seller akan menerima tombol Buka Maps Pembeli.</div>}<button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerMapsLink.trim()) { setError("Gunakan lokasi otomatis atau tempel link Google Maps Anda dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Penjual sedang menghitung ongkir. Klik Buat Pesanan untuk mengirim permintaan ke seller." : "Klik Cek Ongkir dulu. Setelah itu tombol Buat Pesanan aktif."}</div></div>}
        {needsAddress && <div style={{ background: "#FFF8E1", padding: 12, borderRadius: 8 }}><div style={{ fontWeight: 700, marginBottom: 8 }}>Alamat untuk cek ongkir</div><div style={{ fontSize: 12, color: "var(--text3)", marginBottom: 8 }}>Alamat ekspedisi akan otomatis disimpan ke profil dan terisi saat belanja berikutnya.</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}><input className="form-input" placeholder="Desa" value={form.buyerVillage} onChange={(e) => { setForm({ ...form, buyerVillage: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kecamatan" value={form.buyerDistrict} onChange={(e) => { setForm({ ...form, buyerDistrict: e.target.value }); setShippingCheckRequested(false); }} required /><input className="form-input" placeholder="Kabupaten" value={form.buyerRegency} onChange={(e) => { setForm({ ...form, buyerRegency: e.target.value }); setShippingCheckRequested(false); }} required /></div><button type="button" className="btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => { if (!form.buyerVillage || !form.buyerDistrict || !form.buyerRegency) { setError("Isi desa, kecamatan, dan kabupaten dulu."); return; } setShippingCheckRequested(true); setError(""); }}>Cek Ongkir</button><div style={{ fontSize: 12, color: shippingCheckRequested ? "#10B981" : "var(--orange)", marginTop: 6 }}>{shippingCheckRequested ? "Permintaan cek ongkir siap dikirim ke seller. Klik Buat Pesanan." : "Klik Cek Ongkir dulu agar seller mendapat perintah cek ongkir."}</div></div>}
      </div><div className="modal-footer"><button type="button" className="btn-ghost" onClick={onClose}>Batal</button><button type="submit" className="btn-primary" disabled={loading || (needsSellerQuote && !shippingCheckRequested)}>{loading ? "Memproses..." : "Buat Pesanan"}</button></div></form>
    </div></div>
  );
}
