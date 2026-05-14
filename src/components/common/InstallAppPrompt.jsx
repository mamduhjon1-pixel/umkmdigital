import { useEffect, useState } from "react";

function isRunningAsInstalledApp() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator?.standalone === true;
}

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [installed, setInstalled] = useState(isRunningAsInstalledApp);
  const [hiddenThisSession, setHiddenThisSession] = useState(false);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setInstalled(false);
      setHiddenThisSession(false);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setInstalled(true);
      setHiddenThisSession(true);
      try { localStorage.setItem("umkm_app_installed", "1"); } catch {}
    };

    setInstalled(isRunningAsInstalledApp());
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed || !installEvent || hiddenThisSession) return null;

  async function installApp() {
    try {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice?.outcome === "accepted") {
        setInstalled(true);
        setHiddenThisSession(true);
        try { localStorage.setItem("umkm_app_installed", "1"); } catch {}
      }
    } catch (error) {
      console.warn("Install prompt gagal:", error);
    } finally {
      setInstallEvent(null);
    }
  }

  function closePrompt() {
    // Hanya disembunyikan sementara di sesi ini.
    // Saat halaman dibuka ulang dan aplikasi belum diinstall, prompt akan muncul lagi.
    setHiddenThisSession(true);
  }

  return (
    <div className="install-app-prompt">
      <img src="/icon-192.png" alt="Logo UMKM Digital" className="install-app-logo" />
      <div>
        <strong>Install UMKM Digital</strong>
        <span>Buka lebih cepat seperti aplikasi di HP.</span>
      </div>
      <button type="button" onClick={installApp}>Install</button>
      <button type="button" className="install-app-close" onClick={closePrompt} aria-label="Tutup">×</button>
    </div>
  );
}
