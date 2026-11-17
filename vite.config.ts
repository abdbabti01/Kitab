import { execSync } from "node:child_process";
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

// The commit a build comes from, shown in error details (Workers Builds sets WORKERS_CI_COMMIT_SHA).
function commit() {
  try {
    return process.env.WORKERS_CI_COMMIT_SHA ?? execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}
process.env.VITE_KITAB_BUILD ??= commit().slice(0, 12);

export default defineConfig({ plugins: [react(), httpWalkthrough] });
