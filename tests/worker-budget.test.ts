/**
 * Shared daily AI token allowance (review finding 1) and the cache/lease race (finding 4).
 * All inference endpoints and retries draw on one row: usage_counters(scope 'ai-tokens', subject 'global').
 */
import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../worker/index.ts";
import { handleGenerate } from "../worker/generation.ts";
import { estimateTokens, TOKEN_SCOPE } from "../worker/quota.ts";
import { today } from "../worker/http.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { traceFor } from "../src/learning/assessment.ts";
import { context, envWith, FakeAi, FakeD1, lessonFor, post } from "./support/fakes.ts";

const lab = findMission("tcp-lab")!;
const tcp = findMission("tcp-lost-segment")!;
const tcpTrace = traceFor(tcp, tcp.variants[0].params);
const duplicate = tcpTrace.frames.findIndex((frame) => frame.id === tcpTrace.outcome.duplicateAckFrame);

const tutorBody = { missionId: tcp.id, missionVersion: tcp.version, params: tcp.variants[0].params, frameIndex: duplicate, intent: "explain-step", phase: "explain", prediction: { optionId: "gap" }, reasoning: "" };
const tutorOutput = { explanation: "A cumulative TCP acknowledgment names the next byte the receiver expects, so it cannot move past a missing segment.", evidence: ["tcp-cumulative-ack"], misconception: null, attention: null, action: "inspect" };
const composeBody = { missionId: lab.id, missionVersion: lab.version, description: "lose a segment with a tiny MSS" };
const composeOutput = { params: { scenario: "loss", payloadBytes: 1500, mssBytes: 536 } };

const spent = (db: FakeD1) => db.rows<{ tokens: number; count: number }>("SELECT tokens, count FROM usage_counters WHERE scope = ? AND subject = 'global'", TOKEN_SCOPE)[0] ?? { tokens: 0, count: 0 };

async function call(path: string, body: unknown, env: ReturnType<typeof envWith>) {
  const ctx = context();
  const response = await handle(post(path, body, { "x-kitab-session": "0123456789abcdef0123" }), env, ctx);
  await ctx.settle();
  return { status: response.status, data: (await response.json()) as Record<string, any> };
}

test("budget: a zero budget on a fresh database admits no inference anywhere", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list") }));
  const env = envWith({ DB: db, AI: ai, DAILY_TOKEN_BUDGET: "0" });
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 429);
  assert.equal((await call("/api/tutor", tutorBody, env)).data.reason, "QUOTA_EXHAUSTED");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 0);
  assert.equal(spent(db).tokens, 0);
});

test("budget: generation spends the shared allowance; tutoring and composition are then refused", async () => {
  const db = new FakeD1();
  const budget = 20_000;
  // The draft reports enough real usage to leave less than any tutor/compose reservation.
  const ai = new FakeAi(() => ({ response: lessonFor("linked list"), usage: { prompt_tokens: 18_000, completion_tokens: 1_900 } }));
  const env = envWith({ DB: db, AI: ai, DAILY_TOKEN_BUDGET: String(budget) });
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 200);
  assert.equal(spent(db).tokens, 19_900, "the reservation is reconciled to the reported usage");
  assert.equal((await call("/api/tutor", tutorBody, env)).data.reason, "QUOTA_EXHAUSTED");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 1);
});

test("budget: composition reserves and records its usage in the shared allowance", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: composeOutput, usage: { prompt_tokens: 120, completion_tokens: 30 } }));
  const result = await call("/api/scenario", composeBody, envWith({ DB: db, AI: ai, DAILY_TOKEN_BUDGET: "100000" }));
  assert.equal(result.status, 200);
  assert.equal(spent(db).tokens, 150);
});

test("budget: concurrent requests near the limit admit only what fits", async () => {
  const db = new FakeD1();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let peak = 0;
  // Calls wait at the gate, so every reservation is made before any is reconciled.
  const ai = new FakeAi(async () => { peak = Math.max(peak, spent(db).tokens); await gate; return { response: tutorOutput, usage: { prompt_tokens: 10, completion_tokens: 10 } }; });
  const reservation = estimateTokens({ messages: [{ role: "x", content: "x".repeat(4000) }], max_tokens: 400 });
  const budget = Math.floor(reservation * 2.5);
  const env = envWith({ DB: db, AI: ai, DAILY_TOKEN_BUDGET: String(budget), AI_TIMEOUT_MS: "5000" });
  const pending = Promise.all(Array.from({ length: 6 }, () => call("/api/tutor", tutorBody, env)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const results = await pending;
  const admitted = results.filter((result) => result.data.source === "ai").length;
  assert.equal(ai.calls.length, admitted);
  assert.ok(admitted >= 1 && admitted < 6, `admitted ${admitted} of 6`);
  assert.equal(results.filter((result) => result.data.reason === "QUOTA_EXHAUSTED").length, 6 - admitted);
  assert.ok(peak <= budget, `reserved ${peak} with a budget of ${budget}`);
  assert.equal(spent(db).tokens, admitted * 20, "reconciled to reported usage afterwards");
});

test("budget: retries are charged; missing usage and failures keep the conservative reservation", async () => {
  const db = new FakeD1();
  const flaky = new FakeAi((_, n) => (n === 1 ? { response: "not json", usage: { prompt_tokens: 300, completion_tokens: 40 } } : { response: lessonFor("linked list"), usage: { prompt_tokens: 900, completion_tokens: 700 } }));
  assert.equal((await call("/api/concept", { concept: "linked list" }, envWith({ DB: db, AI: flaky, DAILY_TOKEN_BUDGET: "1000000" }))).status, 200);
  assert.equal(spent(db).tokens, 340 + 1600, "the rejected first attempt still counts");

  const noUsage = new FakeD1();
  await call("/api/scenario", composeBody, envWith({ DB: noUsage, AI: new FakeAi(() => ({ response: composeOutput })), DAILY_TOKEN_BUDGET: "1000000" }));
  assert.ok(spent(noUsage).tokens > 0, "unreported usage is not treated as free");

  const failed = new FakeD1();
  await call("/api/tutor", tutorBody, envWith({ DB: failed, AI: new FakeAi(() => { throw new Error("upstream 500"); }), DAILY_TOKEN_BUDGET: "1000000" }));
  assert.ok(spent(failed).tokens > 0, "a failed call keeps its reservation");

  const timedOut = new FakeD1();
  await call("/api/tutor", tutorBody, envWith({ DB: timedOut, AI: new FakeAi(() => new Promise(() => undefined)), AI_TIMEOUT_MS: "20", DAILY_TOKEN_BUDGET: "1000000" }));
  assert.ok(spent(timedOut).tokens > 0, "a timed-out call keeps its reservation");
});

test("budget: per-IP call limits still apply independently of tokens", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: composeOutput, usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  const env = envWith({ DB: db, AI: ai, DAILY_TOKEN_BUDGET: "1000000", DAILY_TUTOR_PER_IP: "1" });
  assert.equal((await call("/api/scenario", composeBody, env)).status, 200);
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 1);
});

test("lease race: a request that resumes after another saved the same query reuses it", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list") }));
  const env = envWith({ DB: db, AI: ai });
  let resume!: () => void;
  const paused = new Promise<void>((resolve) => { resume = resolve; });
  // A misses the cache, then pauses before taking the lease.
  const a = handleGenerate(post("/api/concept", { concept: "linked list" }), env, context(), { localCoalescing: false, owner: "a", beforeLease: () => paused });
  await new Promise((resolve) => setTimeout(resolve, 10));
  // B runs the whole generation and saves it.
  const b = await handleGenerate(post("/api/concept", { concept: "linked list" }), env, context(), { localCoalescing: false, owner: "b" });
  assert.equal(b.status, 200);
  resume();
  const resumed = await a;
  assert.equal(resumed.status, 200);
  assert.equal(ai.calls.length, 1, "one inference");
  assert.equal(db.rows("SELECT id FROM lesson_versions").length, 1, "one saved version");
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'generate-ip'")[0].count, 1, "one quota charge");
  assert.equal(((await resumed.json()) as { meta: { versionId: number } }).meta.versionId, db.rows<{ id: number }>("SELECT id FROM lesson_versions")[0].id);
});

test("lease race: stale saved content is still regenerated after the lease", async () => {
  const db = new FakeD1();
  db.sqlite.prepare("INSERT INTO concepts (normalized_name, display_name, category, content_json, source, status) VALUES ('linked list', 'Old', 'DS', '{\"schemaVersion\":1}', 'ai', 'draft')").run();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list") }));
  const response = await handleGenerate(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: ai }), context(), { localCoalescing: false, owner: "c" });
  assert.equal(response.status, 200);
  assert.equal(ai.calls.length, 1);
});
