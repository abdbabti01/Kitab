import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./v2-app";

const TcpReferenceLesson = lazy(
  () => import("./visual-engine/tcp/TcpReferenceLesson"),
);
const isTcpLesson =
  window.location.pathname.startsWith("/lesson/tcp") ||
  window.location.pathname.startsWith("/visual-lab");
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ padding: 32 }}>Opening lesson…</div>}>
      {isTcpLesson ? <TcpReferenceLesson /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
