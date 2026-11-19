import { execSync } from "node:child_process";
import { defineConfig, type Connect, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { HTTP_WALKTHROUGH_PATH } from "./src/app/routes.ts";
import { handleLab, LAB_PREFIX } from "./worker/lab.ts";

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

// The Engineering Lab's endpoints in dev and preview: the same handler the Worker runs (it needs no bindings), so
// lab requests are real requests to real code locally too.
const serveLab: Connect.NextHandleFunction = async (request, response, next) => {
  if (!request.url?.startsWith(LAB_PREFIX)) return next();
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(key, value);
  const method = request.method ?? "GET";
  const answer = await handleLab(new Request(`http://${request.headers.host ?? "localhost"}${request.url}`, { method, headers, body: ["GET", "HEAD"].includes(method) ? undefined : Buffer.concat(chunks) }));
  response.statusCode = answer.status;
  answer.headers.forEach((value, key) => response.setHeader(key, value));
  response.end(Buffer.from(await answer.arrayBuffer()));
};

const labEndpoints: Plugin = {
  name: "kitab-lab-endpoints",
  configureServer(server) {
    server.middlewares.use(serveLab);
  },
  configurePreviewServer(server) {
    server.middlewares.use(serveLab);
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

export default defineConfig({ plugins: [react(), httpWalkthrough, labEndpoints] });
