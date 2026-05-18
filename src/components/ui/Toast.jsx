import { createContext, useCallback, useContext, useMemo, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((message, options = {}) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const item = {
      id,
      message: String(message || ""),
      type: options.type || "info",
      duration: Number(options.duration || 3200),
    };
    setToasts((prev) => [...prev.slice(-4), item]);
    window.setTimeout(() => dismiss(id), item.duration);
    return id;
  }, [dismiss]);

  const value = useMemo(() => ({
    toast,
    success: (msg, opts) => toast(msg, { ...opts, type: "success" }),
    error: (msg, opts) => toast(msg, { ...opts, type: "error" }),
    info: (msg, opts) => toast(msg, { ...opts, type: "info" }),
  }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-item toast-${t.type}`} role="status">
            <span>{t.message}</span>
            <button type="button" className="toast-close" onClick={() => dismiss(t.id)} aria-label="Tutup">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast harus dipakai di dalam ToastProvider");
  return ctx;
}
