import { useState } from "react";
import { doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "../../services/firebase";
import { uploadImageToCloudinary } from "../../services/cloudinary";
import { rupiah } from "../../utils/appHelpers";
import { isOpenCommissionBill, sumCommissionDebt } from "../../utils/commissionUtils";
import { sortNewest } from "../../utils/orderUtils";
import { openImagePreview } from "../../utils/mediaUtils";

export default function SellerCommissionBills({ bills = [], paymentSetting, createNotif }) {
  const [proofFile, setProofFile] = useState(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const openBills = sortNewest(bills).filter(isOpenCommissionBill);
  const payableBills = openBills.filter((bill) => bill.status !== "menunggu_approval");
  const approvalBills = openBills.filter((bill) => bill.status === "menunggu_approval");
  const historyBills = sortNewest(bills).filter((bill) => !isOpenCommissionBill(bill)).slice(0, 5);
  const totalDebt = sumCommissionDebt(bills);
  const uploadTargetTotal = payableBills.reduce((sum, bill) => sum + Number(bill.remaining || bill.amount || 0), 0);

  async function uploadProofForAllOpenBills() {
    if (uploadingProof) return;
    if (payableBills.length === 0) { alert("Tidak ada tagihan yang perlu dibayar saat ini."); return; }
    if (!proofFile) { alert("Pilih bukti pembayaran komisi dulu"); return; }
    if (proofFile.size > 1024 * 1024) { alert("Ukuran bukti maksimal 1MB"); return; }
    setUploadingProof(true);
    try {
      const url = await uploadImageToCloudinary(proofFile);
      const targetIds = new Set(payableBills.map((bill) => bill.id));
      await runTransaction(db, async (transaction) => {
        const freshBills = [];
        for (const bill of payableBills) {
          const billRef = doc(db, "komisi_tagihan", bill.id);
          const freshBill = await transaction.get(billRef);
          const data = freshBill.data() || {};
          if (!freshBill.exists() || ["menunggu_approval", "approved", "auto_paid", "autopaid", "paid"].includes(data.status) || !isOpenCommissionBill({ id: bill.id, ...data })) continue;
          freshBills.push({ ref: billRef, bill, data });
        }
        if (freshBills.length === 0) throw new Error("Tagihan sudah berubah. Cek ulang halaman tagihan.");
        freshBills.forEach(({ ref, bill }) => {
          transaction.update(ref, {
            proofUrl: url,
            status: "menunggu_approval",
            proofUploadedAt: serverTimestamp(),
            paidAsGroup: true,
            groupProofBillIds: Array.from(targetIds),
            updatedAt: serverTimestamp(),
          });
          if (bill.orderId) {
            transaction.update(doc(db, "orders", bill.orderId), {
              cashCommissionProofUrl: url,
              cashCommissionStatus: "menunggu_approval",
              updatedAt: serverTimestamp(),
            });
          }
        });
      });
      await createNotif({
        role: "admin",
        type: "commission_proof",
        title: "Bukti Komisi Tunai Menunggu Approval",
        message: `${payableBills[0]?.sellerName || "Seller"} mengirim bukti pembayaran total komisi ${rupiah(uploadTargetTotal)} untuk ${payableBills.length} tagihan. Silakan cek dan approve jika pembayaran sudah masuk.`,
        billId: payableBills[0]?.id || null,
        sellerId: payableBills[0]?.sellerId || null,
      });
      setProofFile(null);
      alert("Bukti pembayaran komisi berhasil dikirim. Menunggu approval admin.");
    } catch (error) {
      console.error("Gagal upload bukti komisi", error);
      alert(error?.message || "Gagal upload bukti komisi. Coba lagi.");
    } finally {
      setUploadingProof(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>💸 Tagihan Komisi Tunai</div>
      <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13, color: "var(--text2)", lineHeight: 1.6 }}>
        Tagihan di bawah hanya sebagai notifikasi/detail. Transfer sesuai <b>total tagihan</b>, lalu upload bukti pembayaran satu kali dari kolom pembayaran utama.
      </div>

      <div className="card" style={{ marginBottom: 16, border: "1px solid var(--border)", boxShadow: "0 8px 24px rgba(15,23,42,.06)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 14, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 13, color: "var(--text2)", fontWeight: 700 }}>Total yang harus dibayar</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: totalDebt > 0 ? "#EF4444" : "#10B981", marginTop: 4 }}>{rupiah(totalDebt)}</div>
            {approvalBills.length > 0 && <div style={{ fontSize: 12, color: "#92400E", marginTop: 4 }}>Ada {approvalBills.length} bukti pembayaran yang sedang menunggu approval admin.</div>}
          </div>
          <span className={`badge ${totalDebt > 0 ? "badge-red" : "badge-green"}`}>{totalDebt > 0 ? "Belum Lunas" : "Lunas"}</span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
          <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 800, textTransform: "uppercase" }}>Bank Admin</div><div style={{ fontWeight: 800, marginTop: 4 }}>{paymentSetting?.bankName || "Belum diatur"}</div></div>
          <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 800, textTransform: "uppercase" }}>Nomor Rekening</div><div style={{ fontWeight: 800, marginTop: 4 }}>{paymentSetting?.accountNumber || "-"}</div></div>
          <div style={{ background: "#F8FAFC", border: "1px solid var(--border)", borderRadius: 10, padding: 12 }}><div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 800, textTransform: "uppercase" }}>Atas Nama</div><div style={{ fontWeight: 800, marginTop: 4 }}>{paymentSetting?.accountHolder || "-"}</div></div>
        </div>

        {payableBills.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label>Upload bukti pembayaran total tagihan</label>
              <input className="form-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 6 }}>Upload satu bukti untuk total {rupiah(uploadTargetTotal)}. Maksimal 1MB.</div>
            </div>
            <button className="btn-primary" onClick={uploadProofForAllOpenBills} disabled={uploadingProof || !proofFile}>{uploadingProof ? "Mengirim..." : "Upload Bukti Pembayaran"}</button>
          </div>
        ) : (
          <div style={{ background: "#ECFDF5", border: "1px solid #A7F3D0", color: "#065F46", borderRadius: 10, padding: 12, fontSize: 13, fontWeight: 700 }}>Tidak ada tagihan yang perlu diupload saat ini.</div>
        )}
      </div>

      {openBills.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">✅</div><p>Tidak ada tagihan komisi terbuka</p></div>
      ) : openBills.map((bill) => (
        <div key={bill.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontWeight: 800 }}>{bill.productName || "Tagihan Komisi"}</div>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>Jumlah tagihan: <b style={{ color: "#EF4444" }}>{rupiah(bill.remaining || bill.amount)}</b></div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4, lineHeight: 1.6 }}>
                Total komisi: <b>{rupiah(bill.amount)}</b> · Dipotong saldo: <b>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</b> · Sisa: <b>{rupiah(bill.remaining || 0)}</b>
              </div>
              {bill.note && <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>{bill.note}</div>}
              <div style={{ fontSize: 12, color: "var(--text3)" }}>Status: {bill.status}</div>
            </div>
            <span className={`badge ${bill.status === "menunggu_approval" ? "badge-yellow" : "badge-red"}`}>{bill.status === "menunggu_approval" ? "Menunggu Admin" : "Belum Lunas"}</span>
          </div>
          {bill.proofUrl && <img src={bill.proofUrl} alt="Bukti komisi" onClick={() => openImagePreview(bill.proofUrl, "Bukti Komisi")} style={{ marginTop: 10, width: 160, height: 100, objectFit: "cover", borderRadius: 8, cursor: "zoom-in" }} />}
        </div>
      ))}

      {historyBills.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800, marginBottom: 10 }}>Riwayat Komisi Terakhir</div>
          {historyBills.map((bill) => (
            <div key={bill.id} className="card" style={{ marginBottom: 10, padding: 12, background: "#F8FAFC" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--text2)", lineHeight: 1.6 }}>
                <div>
                  <b style={{ color: "var(--text)" }}>{bill.productName || "Komisi Tunai"}</b><br/>
                  Total: <b>{rupiah(bill.amount)}</b> · Potong saldo: <b>{rupiah(bill.autoDeductedFromBalance || bill.paidFromBalance || 0)}</b> · Sisa: <b>{rupiah(bill.remaining || 0)}</b>
                  {bill.note && <div style={{ color: "var(--text3)", marginTop: 3 }}>{bill.note}</div>}
                </div>
                <span className={`badge ${["approved","auto_paid","autopaid","paid"].includes(bill.status) ? "badge-green" : "badge-gray"}`}>{bill.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
