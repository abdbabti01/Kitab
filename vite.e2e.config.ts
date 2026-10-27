/**
 * E2E-only dev server: the real Worker `handle()` serves /api/* with the
 * SQLite-backed fake D1 and a scripted fake Workers AI. Never used in production.
 */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { handle } from "./worker/index.ts";
import { FakeAi, FakeD1, lessonFor } from "./tests/support/fakes.ts";

const db = new FakeD1();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ai = new FakeAi(async (input) => {
  const messages = input.messages as { content: string }[];
  const user = messages.at(-1)!.content + messages[1]?.content;
  if (user.includes("Controls:")) {
    // Deterministic delays for the stale-reply tests: a description containing "slow" answers after 2 s.
    // Only the learner's description (between <<< >>>), not the control list, decides the fake reply.
    const description = /<<<([\s\S]*?)>>>/.exec(user)?.[1] ?? "";
    if (/slow/i.test(description)) await sleep(2000);
    return { response: { params: /reorder/i.test(description) ? { scenario: "reorder", payloadBytes: 4000, mssBytes: 1200 } : { scenario: "loss", payloadBytes: 1500, mssBytes: 536 } } };
  }
  if (user.includes("UNTRUSTED LEARNER QUESTION")) {
    // Lesson follow-up: cite the first fact of the rebuilt step. A question containing "slow" answers after 2 s.
    const question = /<<<([\s\S]*?)>>>/.exec(user)?.[1] ?? "";
    if (/slow/i.test(question)) await sleep(2000);
    const fact = /Facts at this step[^\n]*\n- \[([^\]]+)\]/.exec(user)?.[1] ?? "tcp-service";
    return { response: { explanation: "Each level reads only its own header and passes the rest of the bytes along, so every device knows what to do next.", evidence: [fact], misconception: null, attention: null, action: "none" } };
  }
  if (user.includes("TRUSTED CONTEXT")) {
    // A grounded, number-free tutor reply that passes validation for TCP missions.
    return { response: { explanation: "A cumulative TCP acknowledgment names the next byte the receiver expects, so it cannot move past a missing segment.", evidence: ["tcp-cumulative-ack"], misconception: null, attention: null, action: "inspect" } };
  }
  const concept = /concept: "([^"]+)"/.exec(user)?.[1] ?? "linked list";
  return { response: lessonFor(concept) };
});

type Middlewares = { use(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void): void };

function fakeWorker(): Plugin {
  // The same handler serves the dev server and `vite preview` (production build, used for performance runs).
  const mount = (middlewares: Middlewares) =>
      middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/")) return next();
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(key, value);
        headers.set("CF-Connecting-IP", "198.51.100.7");
        const body = Buffer.concat(chunks);
        // Slow network for TCP-lab tutor replies, so a reply can arrive after the learner changed the scenario.
        if (req.url === "/api/tutor" && body.includes('"missionId":"tcp-lab"')) await sleep(1500);
        const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : body });
        const response = await handle(request, { DB: db, AI: ai, AI_TIMEOUT_MS: "5000" }, { waitUntil: () => undefined });
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
  return {
    name: "kitab-fake-worker",
    // Block bodies: a returned function would be treated by Vite as a post-middleware hook.
    configureServer(server) {
      mount(server.middlewares);
    },
    configurePreviewServer(server) {
      mount(server.middlewares);
    },
  };
}

export default defineConfig({ plugins: [react(), fakeWorker()] });
