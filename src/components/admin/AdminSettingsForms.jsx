import { useEffect, useState } from "react";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db } from "../../services/firebase";
import { uploadImageToCloudinary } from "../../services/cloudinary";

export function PaymentSetting({ paymentSetting }) {
  const [form, setForm] = useState(paymentSetting || {});
  const [qrisFile, setQrisFile] = useState(null);
  const [qrisPreview, setQrisPreview] = useState(paymentSetting?.qrisUrl || "");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm(paymentSetting || {});
    setQrisPreview(paymentSetting?.qrisUrl || "");
  }, [paymentSetting]);

  function handleQrisFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { alert("Format QRIS harus JPG, PNG, atau WEBP"); return; }
    if (f.size > 1024 * 1024) { alert("Ukuran QRIS maksimal 1MB"); return; }
    setQrisFile(f);
    setQrisPreview(URL.createObjectURL(f));
  }

  async function save(e) {
    e.preventDefault(); setLoading(true);
    try {
      let qrisUrl = form.qrisUrl || "";
      if (qrisFile) qrisUrl = await uploadImageToCloudinary(qrisFile);
      await setDoc(doc(db, "admin_settings", "payment"), { ...form, qrisUrl, updatedAt: serverTimestamp() });
      setForm((prev) => ({ ...prev, qrisUrl }));
      setQrisFile(null);
      alert("Rekening dan QRIS admin disimpan");
    } catch (err) {
      alert(err.message || "Gagal menyimpan pengaturan pembayaran");
    }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>💳 Pengaturan Rekening & QRIS Admin</div>
      <div className="card" style={{ maxWidth: 520 }}>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Nama Bank</label>
            <input className="form-input" placeholder="Contoh: BCA, BRI, Mandiri" value={form.bankName || ""} onChange={(e) => setForm({ ...form, bankName: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Nomor Rekening</label>
            <input className="form-input" placeholder="1234567890" value={form.accountNumber || ""} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Atas Nama</label>
            <input className="form-input" placeholder="Nama pemegang rekening" value={form.accountHolder || ""} onChange={(e) => setForm({ ...form, accountHolder: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Foto QRIS Admin</label>
            <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={handleQrisFile} style={{ padding: 8 }} />
            {qrisPreview && (
              <div style={{ marginTop: 10 }}>
                <img src={qrisPreview} alt="Preview QRIS" style={{ width: 220, maxWidth: "100%", borderRadius: 12, border: "1px solid var(--border)", background: "#fff" }} />
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>QRIS hanya milik admin dan hanya tampil saat buyer memilih pembayaran Scan QRIS.</div>
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Menyimpan..." : "Simpan Rekening & QRIS"}</button>
        </form>
      </div>
    </div>
  );
}

export function ManualBalance() {
  const [amount, setAmount] = useState("");
  const [active, setActive] = useState(false);
  const [loading, setLoading] = useState(false);

  async function save(e) {
    e.preventDefault(); setLoading(true);
    await setDoc(doc(db, "admin_settings", "manualBalance"), { totalSellerBalanceManual: Number(amount.replace(/\D/g, "")), isManualBalanceActive: active, updatedAt: serverTimestamp() });
    setLoading(false); alert("Saldo manual disimpan");
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>⚙️ Edit Saldo Manual</div>
      <div className="card" style={{ maxWidth: 420 }}>
        <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16, background: "var(--orange-light)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--orange)" }}>
          ⚠️ Fitur ini akan mengganti tampilan total saldo seller di dashboard admin dengan nilai manual.
        </div>
        <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Total Saldo Manual (Rp)</label>
            <input className="form-input" placeholder="Contoh: 1.000.000" value={amount}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "") || 0).toLocaleString("id-ID"))} />
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14 }}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--orange)" }} />
            <span>Aktifkan saldo manual</span>
          </label>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Menyimpan..." : "Simpan"}</button>
        </form>
      </div>
    </div>
  );
}

export function CreateSubAdmin() {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault(); setLoading(true);
    try {
      const res = await createUserWithEmailAndPassword(auth, form.email, form.password);
      await setDoc(doc(db, "users", res.user.uid), {
        uid: res.user.uid, name: form.name, email: form.email, role: "sub_admin", status: "active",
        permissions: { canViewOrders: true, canApprovePayments: true, canRejectPayments: true, canViewPaymentProof: true },
        createdAt: serverTimestamp(),
      });
      alert("Admin tambahan berhasil dibuat");
      setForm({ name: "", email: "", password: "" });
    } catch (err) { alert(err.message); }
    setLoading(false);
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 20 }}>👤 Tambah Admin Order</div>
      <div className="card" style={{ maxWidth: 420 }}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="form-group">
            <label>Nama Admin</label>
            <input className="form-input" placeholder="Nama lengkap" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Email Login</label>
            <input className="form-input" type="email" placeholder="admin@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input className="form-input" type="password" placeholder="Minimal 6 karakter" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? "Membuat..." : "Buat Admin"}</button>
        </form>
      </div>
    </div>
  );
}
