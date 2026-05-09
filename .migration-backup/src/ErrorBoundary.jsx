import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error("Aplikasi error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#fff" }}>
          <div style={{ maxWidth: 520, width: "100%", border: "1px solid #eee", borderRadius: 16, padding: 24, boxShadow: "0 10px 30px rgba(0,0,0,.08)", textAlign: "center" }}>
            <div style={{ fontSize: 46, marginBottom: 10 }}>⚠️</div>
            <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Aplikasi gagal dimuat</h1>
            <p style={{ color: "#666", lineHeight: 1.6 }}>Terjadi error saat membuka halaman. Coba refresh ulang. Kalau masih muncul, buka Console browser untuk melihat detail error.</p>
            <pre style={{ marginTop: 14, textAlign: "left", whiteSpace: "pre-wrap", background: "#f8fafc", padding: 12, borderRadius: 10, fontSize: 12, color: "#b91c1c", maxHeight: 180, overflow: "auto" }}>{String(this.state.error?.message || this.state.error || "Unknown error")}</pre>
            <button onClick={() => window.location.assign(window.location.origin)} style={{ marginTop: 16, border: 0, borderRadius: 10, background: "#f97316", color: "#fff", padding: "10px 16px", fontWeight: 700, cursor: "pointer" }}>Kembali ke Beranda</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
