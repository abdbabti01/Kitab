import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./v2-app";

const VisualLab = lazy(() => import("./visual-engine/VisualLab"));
const isLab = window.location.pathname.startsWith("/visual-lab");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ padding: 32 }}>Opening visual lab…</div>}>
      {isLab ? <VisualLab /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
