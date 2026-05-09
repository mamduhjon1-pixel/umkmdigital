import React from "react";
import ReactDOM from "react-dom/client";
// @ts-ignore
import App from "./App.jsx";
// @ts-ignore
import ErrorBoundary from "./ErrorBoundary.jsx";
import "./app.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
