/**
 * E2E-only dev server: the real Worker `handle()` serves /api/* with the
 * SQLite-backed fake D1 and a scripted fake Workers AI. Never used in production.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handle } from "./worker/index.ts";
import { FakeAi, FakeD1, lessonFor } from "./tests/support/fakes.ts";

const db = new FakeD1();
const ai = new FakeAi((input) => {
  const messages = input.messages as { content: string }[];
  const user = messages.at(-1)!.content + messages[1]?.content;
  if (user.includes("Controls:")) return { response: { params: { scenario: "loss", payloadBytes: 1500, mssBytes: 536 } } };
  if (user.includes("TRUSTED CONTEXT")) {
    // A grounded, number-free tutor reply that passes validation for TCP missions.
    return { response: { explanation: "A cumulative TCP acknowledgment names the next byte the receiver expects, so it cannot move past a missing segment.", evidence: ["tcp-cumulative-ack"], misconception: null, attention: null, action: "inspect" } };
  }
  const concept = /concept: "([^"]+)"/.exec(user)?.[1] ?? "linked list";
  return { response: lessonFor(concept) };
});

function fakeWorker(): Plugin {
  return {
    name: "kitab-fake-worker",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
        headers.set("CF-Connecting-IP", "198.51.100.7");
        const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : Buffer.concat(chunks) });
        const response = await handle(request, { DB: db, AI: ai, AI_TIMEOUT_MS: "5000" }, { waitUntil: () => undefined });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
    },
  };
}

export default defineConfig({ plugins: [react(), fakeWorker()] });
