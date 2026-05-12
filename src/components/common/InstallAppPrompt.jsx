import { useEffect, useMemo, useState } from "react";

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("umkm_install_prompt_dismissed") === "1"; } catch { return false; }
  });
  const isStandalone = useMemo(() => {
    try { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; } catch { return false; }
  }, []);
  const isIOS = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent || ""), []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setDismissed(true);
      try { localStorage.setItem("umkm_install_prompt_dismissed", "1"); } catch {}
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (dismissed || isStandalone || (!installEvent && !isIOS)) return null;

  async function installApp() {
    if (isIOS && !installEvent) {
      alert("Untuk iPhone: tekan tombol Bagikan di Safari, lalu pilih 'Tambahkan ke Layar Utama'.");
      return;
    }
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch (error) {
      console.warn("Install prompt gagal:", error);
    } finally {
      setInstallEvent(null);
    }
  }

  function closePrompt() {
    setDismissed(true);
    try { localStorage.setItem("umkm_install_prompt_dismissed", "1"); } catch {}
  }

  return (
    <div className="install-app-prompt">
      <div>
        <strong>Install aplikasi untuk pengalaman lebih baik</strong>
        <span>{isIOS ? "iPhone: pakai menu Bagikan lalu Tambahkan ke Layar Utama." : "Buka lebih cepat dan terasa seperti aplikasi di HP."}</span>
      </div>
      <button type="button" onClick={installApp}>{isIOS ? "Cara Install" : "Install"}</button>
      <button type="button" className="install-app-close" onClick={closePrompt}>Nanti</button>
    </div>
  );
}
