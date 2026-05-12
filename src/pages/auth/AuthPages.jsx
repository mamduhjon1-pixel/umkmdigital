import { useState } from "react";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { isKnownAdminEmail } from "../../utils/appHelpers";

export function LoginPage({ setPage }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      if (isKnownAdminEmail(email)) {
        setPage("admin");
      }
      // Selain admin utama, halaman tetap diarahkan otomatis berdasarkan role dari Firestore oleh auth listener.
    } catch (err) {
      setError("Email atau password salah. Silakan coba lagi.");
    }
    setLoading(false);
  }

  async function resetPassword() {
    if (!email) { setError("Masukkan email terlebih dahulu"); return; }
    await sendPasswordResetEmail(auth, email);
    alert("Link reset password telah dikirim ke email Anda");
  }

  return (
    <div className="auth-container" style={{ minHeight: "calc(100vh - 110px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div className="card form-card-mobile" style={{ padding: 36 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--orange)", marginBottom: 6 }}>UMKM Digital</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Masuk ke Akun Anda</div>
            <p style={{ fontSize: 13, color: "var(--text3)" }}>Masuk untuk mulai berbelanja</p>
          </div>
          {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={login} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="form-group">
              <label>Email</label>
              <input className="form-input" type="email" placeholder="contoh@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input className="form-input" type="password" placeholder="Masukkan password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 15 }} disabled={loading}>
              {loading ? "Memproses..." : "Masuk"}
            </button>
          </form>
          <button onClick={resetPassword} style={{ background: "none", border: "none", color: "var(--orange)", fontSize: 13, cursor: "pointer", marginTop: 12, display: "block", textAlign: "center", width: "100%" }}>
            Lupa password?
          </button>
          <div className="divider" />
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text2)" }}>
            Belum punya akun?{" "}
            <span style={{ color: "var(--orange)", fontWeight: 600, cursor: "pointer" }} onClick={() => setPage("register")}>Daftar sekarang</span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function RegisterPage({ setPage, createNotif }) {
  const [form, setForm] = useState({
    name: "",
    whatsapp: "",
    village: "",
    district: "",
    regency: "",
    detailAddress: "",
    email: "",
    password: "",
    role: "buyer",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function register(e) {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const fullAddress = [form.detailAddress, form.village, form.district, form.regency].filter(Boolean).join(", ");
      const savedShippingAddress = {
        buyerAddress: form.detailAddress || "",
        buyerVillage: form.village || "",
        buyerDistrict: form.district || "",
        buyerRegency: form.regency || "",
        buyerFullAddress: fullAddress,
        updatedAt: new Date().toISOString(),
      };
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", res.user.uid), {
        uid: res.user.uid,
        name: form.name,
        email: form.email,
        role: form.role,
        whatsapp: form.whatsapp,
        village: form.village,
        district: form.district,
        regency: form.regency,
        detailAddress: form.detailAddress,
        fullAddress,
        savedShippingAddress,
        status: form.role === "seller" ? "pending" : "active",
        createdAt: serverTimestamp(),
      });
      try { localStorage.setItem(`umkm_last_shipping_address_${res.user.uid}`, JSON.stringify(savedShippingAddress)); } catch {}
      if (form.role === "seller") {
        await setDoc(doc(db, "seller_wallets", res.user.uid), {
          sellerId: res.user.uid, sellerName: form.name, saldoTersedia: 0, saldoTertahan: 0, totalPenjualan: 0, totalDitarik: 0,
        });
        await createNotif({ role: "admin", type: "seller_register", title: "Pendaftaran Seller Baru", message: `${form.name} mendaftar sebagai seller baru. Menunggu persetujuan.` });
      } else {
        await createNotif({ role: "admin", type: "user_register", title: "Pengguna Baru Mendaftar", message: `${form.name} baru saja membuat akun sebagai pembeli.` });
      }
      setPage("home");
    } catch (err) {
      setError(err.message || "Gagal membuat akun. Coba lagi.");
    }
    setLoading(false);
  }

  return (
    <div className="auth-container" style={{ minHeight: "calc(100vh - 110px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: "100%", maxWidth: 440 }}>
        <div className="card form-card-mobile" style={{ padding: 36 }}>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: "var(--orange)", marginBottom: 6 }}>UMKM Digital</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Buat Akun Baru</div>
            <p style={{ fontSize: 13, color: "var(--text3)" }}>Bergabung dan mulai berbelanja atau berjualan</p>
          </div>
          {error && <div style={{ background: "#FEE8E8", color: "#EF4444", padding: "10px 14px", borderRadius: 8, marginBottom: 16, fontSize: 13 }}>{error}</div>}
          <form onSubmit={register} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="form-group"><label>Nama Lengkap</label><input className="form-input" placeholder="Nama lengkap Anda" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="form-group"><label>Nomor WhatsApp</label><input className="form-input" placeholder="08xxxxxxxxxx" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} required /></div>
            <div className="form-group"><label>Desa</label><input className="form-input" placeholder="Nama desa/kelurahan" value={form.village} onChange={(e) => setForm({ ...form, village: e.target.value })} required /></div>
            <div className="form-group"><label>Kecamatan</label><input className="form-input" placeholder="Nama kecamatan" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} required /></div>
            <div className="form-group"><label>Kabupaten</label><input className="form-input" placeholder="Nama kabupaten/kota" value={form.regency} onChange={(e) => setForm({ ...form, regency: e.target.value })} required /></div>
            <div className="form-group"><label>Detail Alamat</label><textarea className="form-input" rows={2} placeholder="Kampung/Jalan/RT/RW/patokan" value={form.detailAddress} onChange={(e) => setForm({ ...form, detailAddress: e.target.value })} required /></div>
            <div className="form-group"><label>Email</label><input className="form-input" type="email" placeholder="contoh@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></div>
            <div className="form-group"><label>Password</label><div style={{ position: "relative" }}><input className="form-input" type={showPassword ? "text" : "password"} placeholder="Minimal 6 karakter" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required style={{ paddingRight: 44 }} /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Sembunyikan kata sandi" : "Lihat kata sandi"} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}>{showPassword ? "🙈" : "👁️"}</button></div></div>
            <div className="form-group">
              <label>Daftar sebagai</label>
              <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="buyer">Pembeli</option>
                <option value="seller">Penjual (Seller)</option>
              </select>
            </div>
            {form.role === "seller" && <div style={{ background: "#FFF8E1", border: "1px solid #F59E0B", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#92400E" }}>⏳ Akun seller harus disetujui admin dulu sebelum bisa upload produk.</div>}
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 13, fontSize: 15 }} disabled={loading}>{loading ? "Memproses..." : "Daftar Sekarang"}</button>
          </form>
          <div className="divider" />
          <p style={{ textAlign: "center", fontSize: 13, color: "var(--text2)" }}>Sudah punya akun? <span style={{ color: "var(--orange)", fontWeight: 600, cursor: "pointer" }} onClick={() => setPage("login")}>Masuk</span></p>
        </div>
      </div>
    </div>
  );
}
