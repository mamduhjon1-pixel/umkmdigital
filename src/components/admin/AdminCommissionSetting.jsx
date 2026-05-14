import { useEffect, useState } from "react";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../../services/firebase";

export default function AdminCommissionSetting({ current, products = [] }) {
  const [value, setValue] = useState(String(current?.globalCommissionPercent || 10));
  const [busy, setBusy] = useState(false);

  useEffect(() => { setValue(String(current?.globalCommissionPercent || 10)); }, [current?.globalCommissionPercent]);

  async function save(applyAll = false) {
    const percent = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!percent || percent < 0 || percent > 100) return alert("Masukkan komisi 1 sampai 100%.");
    setBusy(true);
    try {
      await setDoc(doc(db, "admin_settings", "commission"), { globalCommissionPercent: percent, updatedAt: serverTimestamp() }, { merge: true });
      if (applyAll) {
        const batch = writeBatch(db);
        products.filter((p) => !p.isDeleted).forEach((p) => {
          batch.update(doc(db, "products", p.id), { commissionType: "percent", commissionValue: percent, updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
      alert(applyAll ? "Komisi global disimpan dan diterapkan ke semua produk." : "Komisi global disimpan untuk produk baru.");
    } catch (err) {
      alert("Gagal menyimpan komisi global.");
    }
    setBusy(false);
  }

  return (
    <div className="card" style={{ maxWidth: 520 }}>
      <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 12 }}>📊 Pengaturan Komisi Global</div>
      <p style={{ fontSize: 13, color: "var(--text2)", lineHeight: 1.6, marginBottom: 16 }}>Komisi dihitung per item produk. Contoh: harga Rp100.000, qty 2, komisi 10% = Rp20.000. Ongkir tidak kena komisi.</p>
      <div className="form-group">
        <label>Komisi Global Marketplace (%)</label>
        <input className="form-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="10" />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn-primary" disabled={busy} onClick={() => save(false)}>{busy ? "Menyimpan..." : "Simpan untuk Produk Baru"}</button>
        <button className="btn-outline" disabled={busy} onClick={() => save(true)}>Terapkan ke Semua Produk</button>
      </div>
    </div>
  );
}

