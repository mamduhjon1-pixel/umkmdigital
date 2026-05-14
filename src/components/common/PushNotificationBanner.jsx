export default function PushNotificationBanner({ status, busy, error, enabled, onEnable }) {
  if (enabled) return null;
  const blocked = status === "denied";
  const unsupported = status === "unsupported";

  return (
    <div className="push-notification-banner">
      <div className="push-notification-inner">
        <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
          <div className="push-notification-icon">🔔</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: "#fff" }}>Aktifkan Notifikasi Real-time</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.82)", lineHeight: 1.45 }}>
              {unsupported
                ? "Browser ini belum mendukung notifikasi web."
                : blocked
                  ? "Izin notifikasi sedang diblokir. Aktifkan dari pengaturan browser."
                  : "Klik sekali agar suara dan push notification tetap aktif setelah refresh sampai logout."}
            </div>
            {error && <div style={{ fontSize: 11, color: "#FDE68A", marginTop: 4 }}>{error}</div>}
          </div>
        </div>
        {!unsupported && !blocked && (
          <button className="push-notification-btn" onClick={onEnable} disabled={busy}>
            {busy ? "Mengaktifkan..." : "Aktifkan"}
          </button>
        )}
      </div>
    </div>
  );
}
