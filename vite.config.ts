import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { HTTP_WALKTHROUGH_PATH } from "./src/app/routes.ts";

// Match Cloudflare's extensionless HTML URL in dev and preview, before the SPA fallback.
const serveHttpWalkthrough: Connect.NextHandleFunction = (request, _response, next) => {
  const path = request.url?.split("?", 1)[0];
  if (path === HTTP_WALKTHROUGH_PATH || path === `${HTTP_WALKTHROUGH_PATH}/`) {
    request.url = `${HTTP_WALKTHROUGH_PATH}.html${request.url?.slice(path.length) ?? ""}`;
  }
  next();
};

const httpWalkthrough: Plugin = {
  name: "http-walkthrough-route",
  configureServer(server) {
    server.middlewares.use(serveHttpWalkthrough);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveHttpWalkthrough);
  },
};

export default defineConfig({ plugins: [react(), httpWalkthrough] });
