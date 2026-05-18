import React from "react";
import ReactDOM from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

async function initNativeShell() {
  try {
    if (!Capacitor.isNativePlatform()) return;

    document.body.classList.add("capacitor-app");

    const [{ App: CapApp }, { StatusBar, Style }, { SplashScreen }, { Keyboard }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/status-bar"),
      import("@capacitor/splash-screen"),
      import("@capacitor/keyboard"),
    ]);

    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: "#EE4D2D" });
    await SplashScreen.hide();
    await Keyboard.setResizeMode({ mode: "body" });

    CapApp.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
        return;
      }
      CapApp.exitApp();
    });
  } catch (error) {
    console.warn("Native shell init skipped:", error);
  }
}

initNativeShell();

if ("serviceWorker" in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((error) => {
      console.warn("Service worker registration failed:", error);
    });
  });
}
