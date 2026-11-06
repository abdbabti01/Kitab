/**
 * Shared daily AI Neuron allowance and the cache/lease race.
 * All inference endpoints and retries draw on one row: usage_counters(scope 'ai-neurons', subject 'global'),
 * whose `tokens` column holds Workers AI Neurons at the model's published rates.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../worker/index.ts";
import { handleGenerate } from "../worker/generation.ts";
import { estimateNeurons, MODEL_NEURONS, NEURON_SCOPE, neuronsFor } from "../worker/quota.ts";
import { DEFAULT_MODEL, DEFAULT_NEURON_BUDGET } from "../worker/env.ts";
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

const spent = (db: FakeD1) => db.rows<{ tokens: number; count: number }>("SELECT tokens, count FROM usage_counters WHERE scope = ? AND subject = 'global'", NEURON_SCOPE)[0] ?? { tokens: 0, count: 0 };

async function call(path: string, body: unknown, env: ReturnType<typeof envWith>) {
  const ctx = context();
  const response = await handle(post(path, body, { "x-kitab-session": "0123456789abcdef0123" }), env, ctx);
  await ctx.settle();
  return { status: response.status, data: (await response.json()) as Record<string, any> };
}

test("budget: a zero budget on a fresh database admits no inference anywhere", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list") }));
  const env = envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: "0" });
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 429);
  assert.equal((await call("/api/tutor", tutorBody, env)).data.reason, "QUOTA_EXHAUSTED");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 0);
  assert.equal(spent(db).tokens, 0);
});

test("budget: generation spends the shared allowance; tutoring and composition are then refused", async () => {
  const db = new FakeD1();
  const budget = 1_000;
  // The draft reports enough real usage (18,000 in, 2,400 out: 971.5 Neurons) to leave less than any tutor/compose reservation (the 200-token compose output alone is 41).
  const ai = new FakeAi(() => ({ response: lessonFor("linked list"), usage: { prompt_tokens: 18_000, completion_tokens: 2_400 } }));
  const env = envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: String(budget) });
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 200);
  assert.equal(spent(db).tokens, 972, "the reservation is reconciled to the Neurons of the reported usage");
  assert.equal((await call("/api/tutor", tutorBody, env)).data.reason, "QUOTA_EXHAUSTED");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 1);
});

test("budget: composition reserves and records its usage in the shared allowance", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: composeOutput, usage: { prompt_tokens: 120, completion_tokens: 30 } }));
  const result = await call("/api/scenario", composeBody, envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: "100000" }));
  assert.equal(result.status, 200);
  assert.equal(spent(db).tokens, Math.ceil(neuronsFor(DEFAULT_MODEL, 120, 30)!));
});

test("budget: concurrent requests near the limit admit only what fits", async () => {
  const db = new FakeD1();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let peak = 0;
  // Calls wait at the gate, so every reservation is made before any is reconciled.
  const ai = new FakeAi(async () => { peak = Math.max(peak, spent(db).tokens); await gate; return { response: tutorOutput, usage: { prompt_tokens: 10, completion_tokens: 10 } }; });
  const reservation = estimateNeurons(DEFAULT_MODEL, { messages: [{ role: "x", content: "x".repeat(4000) }], max_tokens: 400 })!;
  const budget = Math.floor(reservation * 2.5);
  const env = envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: String(budget), AI_TIMEOUT_MS: "5000" });
  const pending = Promise.all(Array.from({ length: 6 }, () => call("/api/tutor", tutorBody, env)));
  await new Promise((resolve) => setTimeout(resolve, 100));
  release();
  const results = await pending;
  const admitted = results.filter((result) => result.data.source === "ai").length;
  assert.equal(ai.calls.length, admitted);
  assert.ok(admitted >= 1 && admitted < 6, `admitted ${admitted} of 6`);
  assert.equal(results.filter((result) => result.data.reason === "QUOTA_EXHAUSTED").length, 6 - admitted);
  assert.ok(peak <= budget, `reserved ${peak} with a budget of ${budget}`);
  assert.equal(spent(db).tokens, admitted * Math.ceil(neuronsFor(DEFAULT_MODEL, 10, 10)!), "reconciled to reported usage afterwards");
});

test("budget: retries are charged; missing usage and failures keep the conservative reservation", async () => {
  const db = new FakeD1();
  const flaky = new FakeAi((_, n) => (n === 1 ? { response: "not json", usage: { prompt_tokens: 300, completion_tokens: 40 } } : { response: lessonFor("linked list"), usage: { prompt_tokens: 900, completion_tokens: 700 } }));
  assert.equal((await call("/api/concept", { concept: "linked list" }, envWith({ DB: db, AI: flaky, DAILY_NEURON_BUDGET: "1000000" }))).status, 200);
  assert.equal(spent(db).tokens, Math.ceil(neuronsFor(DEFAULT_MODEL, 300, 40)!) + Math.ceil(neuronsFor(DEFAULT_MODEL, 900, 700)!), "the rejected first attempt still counts");

  const noUsage = new FakeD1();
  await call("/api/scenario", composeBody, envWith({ DB: noUsage, AI: new FakeAi(() => ({ response: composeOutput })), DAILY_NEURON_BUDGET: "1000000" }));
  assert.ok(spent(noUsage).tokens > 0, "unreported usage is not treated as free");

  const failed = new FakeD1();
  await call("/api/tutor", tutorBody, envWith({ DB: failed, AI: new FakeAi(() => { throw new Error("upstream 500"); }), DAILY_NEURON_BUDGET: "1000000" }));
  assert.ok(spent(failed).tokens > 0, "a failed call keeps its reservation");

  const timedOut = new FakeD1();
  await call("/api/tutor", tutorBody, envWith({ DB: timedOut, AI: new FakeAi(() => new Promise(() => undefined)), AI_TIMEOUT_MS: "20", DAILY_NEURON_BUDGET: "1000000" }));
  assert.ok(spent(timedOut).tokens > 0, "a timed-out call keeps its reservation");
});

test("budget: per-IP call limits still apply independently of Neurons", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: composeOutput, usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  const env = envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: "1000000", DAILY_TUTOR_PER_IP: "1" });
  assert.equal((await call("/api/scenario", composeBody, env)).status, 200);
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal(ai.calls.length, 1);
});

test("compatibility: every AI path sends the JSON-schema model with a bare schema and a bounded output", async () => {
  // Workers AI JSON mode: response_format { type: "json_schema", json_schema: <JSON Schema> }. The configured
  // fp8 model is not on the JSON mode list and failed in production with 5025.
  assert.equal(DEFAULT_MODEL, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.ok(MODEL_NEURONS[DEFAULT_MODEL]);
  const ai = new FakeAi((input) => {
    const content = JSON.stringify(input.messages);
    if (content.includes("Controls:")) return { response: composeOutput, usage: { prompt_tokens: 100, completion_tokens: 20 } };
    if (content.includes("TRUSTED CONTEXT")) return { response: tutorOutput, usage: { prompt_tokens: 100, completion_tokens: 20 } };
    return { response: lessonFor("linked list"), usage: { prompt_tokens: 100, completion_tokens: 20 } };
  });
  const env = envWith({ DB: new FakeD1(), AI: ai, DAILY_NEURON_BUDGET: "100000" });
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 200);
  assert.equal((await call("/api/tutor", tutorBody, env)).data.source, "ai");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 200);
  assert.equal(ai.calls.length, 3);
  for (const { model, input } of ai.calls) {
    assert.equal(model, DEFAULT_MODEL);
    const format = input.response_format as { type: string; json_schema: { type: string; properties: object } };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.type, "object", "the schema itself, not an OpenAI-style {name, schema} wrapper");
    assert.ok(format.json_schema.properties);
    assert.ok(typeof input.max_tokens === "number" && input.max_tokens > 0, "output is bounded, so the reservation is an upper bound");
  }
});

test("compatibility: a model without a known Neuron rate is never called", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: tutorOutput }));
  const env = envWith({ DB: db, AI: ai, AI_MODEL: "@cf/example/unpriced-model", DAILY_NEURON_BUDGET: "100000" });
  assert.equal((await call("/api/tutor", tutorBody, env)).data.reason, "QUOTA_EXHAUSTED");
  assert.equal((await call("/api/scenario", composeBody, env)).status, 429);
  assert.equal((await call("/api/concept", { concept: "linked list" }, env)).status, 429);
  assert.equal(ai.calls.length, 0);
  assert.equal(spent(db).tokens, 0);
});

test("compatibility: a 5025 JSON-schema rejection falls back to reviewed content and keeps its reservation", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => { throw new Error("5025: This model doesn't support JSON Schema."); });
  const result = await call("/api/tutor", tutorBody, envWith({ DB: db, AI: ai, DAILY_NEURON_BUDGET: "100000" }));
  assert.equal(result.status, 200);
  assert.equal(result.data.source, "fallback");
  assert.equal(result.data.reason, "AI_FAILED");
  assert.ok(result.data.response.explanation.length > 0, "the reviewed explanation is served");
  assert.ok(spent(db).tokens > 0, "no usage was reported, so the reservation stands");
});

test("budget: the default stays at half of Cloudflare's 10,000 free daily Neurons, and every generation retry is bounded", async () => {
  assert.equal(DEFAULT_NEURON_BUDGET, 5_000);
  const db = new FakeD1();
  // Every attempt returns invalid JSON with no usage: two attempts, each keeps its full reservation.
  const ai = new FakeAi(() => ({ response: "not json" }));
  assert.notEqual((await call("/api/concept", { concept: "linked list" }, envWith({ DB: db, AI: ai }))).status, 200);
  assert.equal(ai.calls.length, 2, "at most two inference attempts");
  const perAttempt = ai.calls.map(({ model, input }) => estimateNeurons(model, input)!);
  assert.equal(spent(db).tokens, perAttempt.reduce((sum, value) => sum + value, 0));
  assert.ok(spent(db).tokens <= DEFAULT_NEURON_BUDGET);
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

test("deployed configuration: a priced JSON-schema model and a Neuron budget at most half the free 10,000", async () => {
  const { readFileSync } = await import("node:fs");
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  assert.ok(MODEL_NEURONS[config.vars.AI_MODEL], `${config.vars.AI_MODEL} has a Neuron rate`);
  const budget = Number(config.vars.DAILY_NEURON_BUDGET);
  assert.ok(Number.isInteger(budget) && budget >= 0 && budget <= 5_000, `budget ${config.vars.DAILY_NEURON_BUDGET}`);
  assert.equal(config.vars.DAILY_TOKEN_BUDGET, undefined, "the old token budget is gone");
});
