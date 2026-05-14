export function openImagePreview(url, title = "Pratinjau Gambar") {
  if (!url) return;
  try {
    const existing = document.getElementById("umkm-image-preview-overlay");
    if (existing) existing.remove();
    const overlay = document.createElement("div");
    overlay.id = "umkm-image-preview-overlay";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(15,23,42,.82);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px;";
    const safeUrl = String(url).replace(/"/g, "&quot;");
    const safeTitle = String(title || "Pratinjau Gambar").replace(/[<>]/g, "");
    overlay.innerHTML = `
      <div style="position:relative;max-width:min(94vw,920px);max-height:92vh;background:#fff;border-radius:16px;padding:12px;box-shadow:0 24px 70px rgba(0,0,0,.35);">
        <button aria-label="Tutup" style="position:absolute;right:10px;top:10px;width:34px;height:34px;border-radius:999px;border:none;background:rgba(15,23,42,.72);color:#fff;font-size:18px;cursor:pointer;z-index:2;">×</button>
        <div style="font-size:13px;font-weight:800;color:#334155;margin:0 42px 10px 4px;">${safeTitle}</div>
        <img src="${safeUrl}" alt="${safeTitle}" style="display:block;max-width:90vw;max-height:78vh;object-fit:contain;border-radius:12px;" />
      </div>`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
    overlay.querySelector("button")?.addEventListener("click", close);
    document.body.appendChild(overlay);
  } catch {
    window.open(url, "_blank");
  }
}
