import { useEffect, useState } from "react";

export default function InstallAppPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem("umkm_install_prompt_dismissed") === "1"; } catch { return false; }
  });

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

  if (!installEvent || dismissed) return null;

  async function installApp() {
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
        <strong>Install UMKM Digital</strong>
        <span>Buka lebih cepat seperti aplikasi di HP.</span>
      </div>
      <button type="button" onClick={installApp}>Install</button>
      <button type="button" className="install-app-close" onClick={closePrompt} aria-label="Tutup">×</button>
    </div>
  );
}
