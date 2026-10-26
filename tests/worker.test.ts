import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../worker/index.ts";
import { handleGenerate, cacheKey } from "../worker/generation.ts";
import { reserve } from "../worker/quota.ts";
import { sha256, today } from "../worker/http.ts";
import { parseDraftContract } from "../src/learning/draft-contract.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { traceFor } from "../src/learning/assessment.ts";
import { context, envWith, FakeAi, FakeD1, lessonFor, post } from "./support/fakes.ts";

const ipHash = () => sha256("ip:203.0.113.5");

test("quota: concurrent reservations at 19/20 admit exactly one", async () => {
  const db = new FakeD1();
  db.sqlite.prepare("INSERT INTO usage_counters (scope, subject, day, count) VALUES ('generate-ip', 'x', ?, 19)").run(today());
  const results = await Promise.all(Array.from({ length: 10 }, () => reserve(db, [{ scope: "generate-ip", subject: "x", limit: 20 }])));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE subject = 'x'")[0].count, 20);
});

test("quota: the old read-then-increment pattern over-admits on the same fake (test is sensitive)", async () => {
  const db = new FakeD1();
  db.sqlite.prepare("INSERT INTO usage_counters (scope, subject, day, count) VALUES ('old', 'x', ?, 19)").run(today());
  const naive = async () => {
    const row = await db.prepare("SELECT count FROM usage_counters WHERE scope = 'old' AND subject = 'x'").first<{ count: number }>();
    if ((row?.count ?? 0) >= 20) return false;
    await db.prepare("UPDATE usage_counters SET count = count + 1 WHERE scope = 'old' AND subject = 'x'").run();
    return true;
  };
  const admitted = (await Promise.all([naive(), naive()])).filter(Boolean).length;
  assert.equal(admitted, 2);
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'old'")[0].count, 21);
});

test("quota: a failure in a later scope releases earlier reservations", async () => {
  const db = new FakeD1();
  const result = await reserve(db, [{ scope: "a", subject: "s", limit: 5 }, { scope: "b", subject: "s", limit: 0 }]);
  assert.equal(result.ok, false);
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'a'")[0].count, 0);
});

test("generation: distinct concurrent misses at 19/20 → one generates, one gets 429", async () => {
  const db = new FakeD1();
  db.sqlite.prepare("INSERT INTO usage_counters (scope, subject, day, count) VALUES ('generate-ip', ?, ?, 19)").run(await ipHash(), today());
  const ai = new FakeAi((input) => ({ response: lessonFor(String((input.messages as { content: string }[])[1].content).includes("hash map") ? "hash map" : "linked list") }));
  const env = envWith({ DB: db, AI: ai });
  const [a, b] = await Promise.all([handle(post("/api/concept", { concept: "linked list" }), env, context()), handle(post("/api/concept", { concept: "hash map" }), env, context())]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
  assert.equal(ai.calls.length, 1);
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'generate-ip'")[0].count, 20);
});

test("generation: identical concurrent misses on one instance share a single inference", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list") }));
  const env = envWith({ DB: db, AI: ai });
  const responses = await Promise.all([1, 2, 3].map(() => handle(post("/api/concept", { concept: "Linked List" }), env, context())));
  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200]);
  assert.equal(ai.calls.length, 1);
  const bodies = await Promise.all(responses.map((response) => response.json() as Promise<{ meta: { versionId: number } }>));
  assert.equal(new Set(bodies.map((body) => body.meta.versionId)).size, 1);
});

test("generation: identical misses on different instances coalesce through the D1 lease", async () => {
  const db = new FakeD1();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const ai = new FakeAi(async () => { await gate; return { response: lessonFor("linked list") }; });
  const env = envWith({ DB: db, AI: ai, AI_TIMEOUT_MS: "5000" });
  const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, 5));
  const leader = handleGenerate(post("/api/concept", { concept: "linked list" }), env, context(), { localCoalescing: false, owner: "instance-a", sleep });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const follower = handleGenerate(post("/api/concept", { concept: "linked list" }), env, context(), { localCoalescing: false, owner: "instance-b", sleep });
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const [first, second] = await Promise.all([leader, follower]);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(ai.calls.length, 1);
  assert.equal(((await second.json()) as { coalesced?: boolean }).coalesced, true);
  assert.equal(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'generate-ip'")[0].count, 1, "the follower reserved nothing");
});

test("generation: success associates content, immutable version, audit row and job", async () => {
  const db = new FakeD1();
  const ai = new FakeAi(() => ({ response: lessonFor("linked list"), usage: { prompt_tokens: 900, completion_tokens: 700 } }));
  const response = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: ai }), context());
  const body = await response.json();
  const contract = parseDraftContract(body);
  assert.ok(contract.success, JSON.stringify(contract.error?.issues));
  const version = db.rows<{ id: number; version: number }>("SELECT id, version FROM lesson_versions")[0];
  assert.equal(contract.data!.meta.versionId, version.id);
  assert.equal(contract.data!.meta.review, "not-reviewed");
  const audit = db.rows<Record<string, unknown>>("SELECT * FROM generation_requests")[0];
  assert.equal(audit.status, "completed");
  assert.equal(audit.lesson_version_id, version.id);
  assert.equal(audit.inference_calls, 1);
  assert.equal(audit.input_tokens, 900);
  assert.equal(audit.prompt_version, "draft-prompt/3");
  assert.equal(db.rows<{ status: string }>("SELECT status FROM generation_jobs WHERE cache_key = ?", cacheKey("linked list"))[0].status, "completed");
  assert.equal(db.rows<{ tokens: number }>("SELECT tokens FROM usage_counters WHERE scope = 'ai-tokens'")[0].tokens, 1600, "shared allowance reconciled to reported usage");

  // A cached read returns the same version without inference.
  const again = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: ai }), context());
  assert.equal(((await again.json()) as { meta: { versionId: number; cached: boolean } }).meta.versionId, version.id);
  assert.equal(ai.calls.length, 1);
});

test("generation: a failed batch commits nothing and reports the save failure", async () => {
  const db = new FakeD1();
  db.failWhen = (sql) => /INSERT INTO lesson_versions/.test(sql);
  const response = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: new FakeAi(() => ({ response: lessonFor("linked list") })) }), context());
  assert.equal(response.status, 503);
  assert.equal(((await response.json()) as { code: string }).code, "D1_SAVE_FAILED");
  assert.equal(db.rows("SELECT * FROM concepts").length, 0, "concept upsert rolled back");
  assert.equal(db.rows<{ status: string }>("SELECT status FROM generation_requests")[0].status, "failed");
  assert.equal(db.rows<{ status: string }>("SELECT status FROM generation_jobs")[0].status, "failed");
});

test("generation: invalid output retries within a bound; off-topic output is rejected", async () => {
  const db = new FakeD1();
  const flaky = new FakeAi((_, call) => (call === 1 ? { response: "not json at all" } : { response: lessonFor("linked list") }));
  const ok = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: flaky }), context());
  assert.equal(ok.status, 200);
  assert.equal(db.rows<{ inference_calls: number }>("SELECT inference_calls FROM generation_requests")[0].inference_calls, 2);

  const offTopic = new FakeAi(() => ({ response: { ...lessonFor("photosynthesis"), title: "Photosynthesis", summary: "Plants turn light into sugar." } }));
  const rejected = await handle(post("/api/concept", { concept: "binary heap" }), envWith({ DB: new FakeD1(), AI: offTopic }), context());
  assert.equal(rejected.status, 502);
  assert.equal(offTopic.calls.length, 3, "retries are bounded");
});

test("generation: timeouts, AI errors and missing bindings fail cleanly", async () => {
  const hang = new FakeAi(() => new Promise(() => undefined));
  const db = new FakeD1();
  const timeout = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: hang, AI_TIMEOUT_MS: "30" }), context());
  assert.equal(timeout.status, 504);
  assert.equal(hang.calls.length, 1, "a timeout is not stacked with more attempts");
  assert.equal(db.rows<{ error_code: string }>("SELECT error_code FROM generation_requests")[0].error_code, "AI_TIMEOUT");

  const broken = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: new FakeD1(), AI: new FakeAi(() => { throw new Error("5xx"); }) }), context());
  assert.equal(broken.status, 502);

  assert.equal((await handle(post("/api/concept", { concept: "linked list" }), envWith({}), context())).status, 503);
  const noAi = new FakeD1();
  const missingAi = await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: noAi }), context());
  assert.equal(((await missingAi.json()) as { code: string }).code, "AI_UNAVAILABLE");
  assert.equal(noAi.rows<{ status: string }>("SELECT status FROM generation_jobs")[0].status, "released");

  const downDb = new FakeD1();
  downDb.failWhen = () => true;
  assert.equal((await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: downDb, AI: hang }), context())).status, 503);
});

test("saved drafts from older releases are repaired with a version row; stale ones are refused", async () => {
  const db = new FakeD1();
  db.sqlite.prepare("INSERT INTO concepts (normalized_name, display_name, category, content_json, source, status) VALUES ('linked list', 'Linked list', 'DS', ?, 'ai', 'draft')").run(JSON.stringify(lessonFor("linked list")));
  const read = await handle(new Request("https://kitab.test/api/lessons/linked%20list"), envWith({ DB: db }), context());
  const body = (await read.json()) as { meta: { versionId: number } };
  assert.equal(read.status, 200);
  assert.equal(body.meta.versionId, db.rows<{ id: number }>("SELECT id FROM lesson_versions")[0].id);

  db.sqlite.prepare("INSERT INTO concepts (normalized_name, display_name, category, content_json, source, status) VALUES ('old thing', 'Old', 'DS', '{\"schemaVersion\":1}', 'ai', 'draft')").run();
  assert.equal((await handle(new Request("https://kitab.test/api/lessons/old%20thing"), envWith({ DB: db }), context())).status, 409);
  assert.equal((await handle(new Request("https://kitab.test/api/lessons/%E0%A4%A"), envWith({ DB: db }), context())).status, 400);
});

test("feedback is tied to an exact draft version or mission version and frame", async () => {
  const db = new FakeD1();
  await handle(post("/api/concept", { concept: "linked list" }), envWith({ DB: db, AI: new FakeAi(() => ({ response: lessonFor("linked list") })) }), context());
  const versionId = db.rows<{ id: number }>("SELECT id FROM lesson_versions")[0].id;
  const env = envWith({ DB: db });
  assert.equal((await handle(post("/api/feedback", { target: { kind: "draft", versionId, frameId: "event-2" }, rating: 2, comment: "Step 3 is unclear" }), env, context())).status, 201);
  assert.equal((await handle(post("/api/feedback", { target: { kind: "draft", versionId: 999, frameId: "event-2" }, rating: 2 }), env, context())).status, 404);
  assert.deepEqual(db.rows("SELECT lesson_version_id, event_id, rating FROM lesson_feedback"), [{ lesson_version_id: versionId, event_id: "event-2", rating: 2 }]);

  const mission = findMission("tcp-lost-segment")!;
  const trace = traceFor(mission, mission.variants[0].params);
  const target = { kind: "mission", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, frameId: trace.frames[5].id };
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }), env, context())).status, 201);
  assert.equal((await handle(post("/api/feedback", { target: { ...target, missionVersion: "0.0.1" }, rating: 4 }), env, context())).status, 409);
  assert.equal((await handle(post("/api/feedback", { target, rating: 9 }), env, context())).status, 400);
  assert.equal(db.rows<{ frame_id: string }>("SELECT frame_id FROM mission_feedback")[0].frame_id, trace.frames[5].id);
});

test("HTTP edges: unknown route, wrong method, oversized and malformed bodies", async () => {
  const env = envWith({ DB: new FakeD1() });
  assert.equal((await handle(new Request("https://kitab.test/api/nope"), env, context())).status, 404);
  assert.equal((await handle(new Request("https://kitab.test/api/concept"), env, context())).status, 405);
  assert.equal((await handle(post("/api/concept", "{broken"), env, context())).status, 400);
  assert.equal((await handle(post("/api/tutor", { padding: "x".repeat(20_000) }), env, context())).status, 413);
  assert.equal((await handle(post("/api/concept", { concept: "x" }), env, context())).status, 400);
  assert.equal((await handle(post("/api/events", { type: "frame-tick", missionId: "tcp-lab" }), env, context())).status, 400);
});
