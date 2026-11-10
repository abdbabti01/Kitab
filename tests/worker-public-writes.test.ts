import assert from "node:assert/strict";
import test from "node:test";
import { handle } from "../worker/index.ts";
import { DAILY_LIMITS } from "../worker/feedback.ts";
import { network, sha256, today } from "../worker/http.ts";
import { findMission, missions } from "../src/learning/missions/catalog.ts";
import { traceFor } from "../src/learning/assessment.ts";
import { context, envWith, FakeD1, post } from "./support/fakes.ts";

const mission = findMission("tcp-lost-segment")!;
const trace = traceFor(mission, mission.variants[0].params);
const target = { kind: "mission", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, frameId: trace.frames[2].id };
const event = { type: "prediction-submitted", missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey, correct: true };
const session = "0f8c2a5e-1b7d-4c3a-9e2f-6a1b2c3d4e5f";
const from = (ip: string, extra: Record<string, string> = {}) => ({ "CF-Connecting-IP": ip, "x-kitab-session": session, ...extra });

const rows = (db: FakeD1, table: string) => db.rows<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)[0].n;
const writes = (db: FakeD1, since: number) => db.statements.slice(since).filter((sql) => !/^\s*SELECT/i.test(sql));
const fill = async (db: FakeD1, scope: string, subject: string, count: number) =>
  db.sqlite.prepare("INSERT INTO usage_counters (scope, subject, day, count) VALUES (?, ?, ?, ?)").run(scope, subject, today(), count);
const net = (ip: string) => sha256(`net:${network(ip)}`);
const quiet = (t: { mock: { method(object: object, name: string, impl: () => void): void } }) => t.mock.method(console, "warn", () => undefined);

test("valid feedback and events are stored, including a full-length non-Latin comment", async () => {
  const db = new FakeD1();
  const env = envWith({ DB: db });
  const comment = "ش".repeat(1000);
  assert.equal((await handle(post("/api/feedback", { target, rating: 3, comment }, from("203.0.113.5")), env, context())).status, 201);
  assert.equal(db.rows<{ comment: string }>("SELECT comment FROM mission_feedback")[0].comment, comment);
  const response = await handle(post("/api/events", event, from("203.0.113.5", { "content-type": "application/json; charset=utf-8" })), env, context());
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true, stored: true });
  assert.equal(db.rows<{ session_hash: string }>("SELECT session_hash FROM learning_events")[0].session_hash, await sha256(`session:${session}`));
});

test("malformed requests are rejected before any D1 statement", async () => {
  const db = new FakeD1();
  const env = envWith({ DB: db });
  const cases: [string, Request, number][] = [
    ["invalid JSON", post("/api/feedback", "{broken"), 400],
    ["invalid JSON event", post("/api/events", "not json"), 400],
    ["text/plain", post("/api/feedback", { target, rating: 3 }, { "content-type": "text/plain;charset=UTF-8" }), 415],
    ["form post", post("/api/events", event, { "content-type": "application/x-www-form-urlencoded" }), 415],
    ["no content type", new Request("https://kitab.test/api/events", { method: "POST", body: new Blob([JSON.stringify(event)]) }), 415],
    ["declared oversize", post("/api/feedback", { target, rating: 3, comment: "x".repeat(5_000) }), 413],
    ["oversize event", post("/api/events", { ...event, scenarioKey: "x".repeat(3_000) }), 413],
    ["extra field", post("/api/events", { ...event, admin: true }), 400],
    ["bad event type", post("/api/events", { ...event, type: "frame-tick" }), 400],
    ["bad rating", post("/api/feedback", { target, rating: 0 }), 400],
    ["fractional rating", post("/api/feedback", { target, rating: 4.5 }), 400],
    ["bad frame id", post("/api/feedback", { target: { ...target, frameId: "<script>" }, rating: 3 }), 400],
    ["long comment", post("/api/feedback", { target, rating: 3, comment: "x".repeat(1001) }), 400],
    ["unknown mission event", post("/api/events", { ...event, missionId: "nope" }), 400],
    ["fabricated mission version", post("/api/events", { ...event, missionVersion: "9.9.9" }), 400],
    ["fabricated engine version", post("/api/events", { ...event, engineVersion: "9.9.9", scenarioKey: trace.scenarioKey.replace(trace.engine.version, "9.9.9") }), 400],
    ["junk scenario key", post("/api/events", { ...event, scenarioKey: "junk" }), 400],
    ["stale mission feedback", post("/api/feedback", { target: { ...target, missionVersion: "0.0.1" }, rating: 3 }), 409],
  ];
  for (const [name, request, status] of cases) assert.equal((await handle(request, env, context())).status, status, name);
  assert.deepEqual(db.statements, []);
});

test("a chunked body is cut off once it passes the limit, without reading the rest", async () => {
  const db = new FakeD1();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      if (pulled > 1_000) return controller.close();
      controller.enqueue(new Uint8Array(1_024).fill(32));
    },
  });
  const request = new Request("https://kitab.test/api/events", { method: "POST", body, duplex: "half", headers: { "content-type": "application/json" } } as RequestInit);
  assert.equal(request.headers.get("content-length"), null);
  assert.equal((await handle(request, envWith({ DB: db }), context())).status, 413);
  assert.ok(pulled < 10, `pulled ${pulled} chunks`);
  assert.deepEqual(db.statements, []);
});

test("feedback: the network limit admits exactly its cap, then 429s with Retry-After and no D1 write", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  for (let index = 0; index < DAILY_LIMITS.feedback.network; index += 1) {
    assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context())).status, 201, `request ${index + 1}`);
  }
  const before = db.statements.length;
  const rejected = await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context());
  assert.equal(rejected.status, 429);
  assert.equal(((await rejected.json()) as { code: string }).code, "RATE_LIMITED");
  const retryAfter = Number(rejected.headers.get("retry-after"));
  assert.ok(retryAfter > 0 && retryAfter <= 86_400);
  assert.deepEqual(writes(db, before), []);
  assert.equal(rows(db, "mission_feedback"), DAILY_LIMITS.feedback.network);
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("198.51.100.20")), env, context())).status, 201, "another network is unaffected");
});

test("events: spoofed or missing sessions share their network's limit", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "events-network", await net("203.0.113.5"), DAILY_LIMITS.events.network - 2);
  assert.equal((await handle(post("/api/events", event, { "CF-Connecting-IP": "203.0.113.5" }), env, context())).status, 201, "no session header");
  assert.equal((await handle(post("/api/events", event, from("203.0.113.5", { "x-kitab-session": "<garbage>" })), env, context())).status, 201, "invalid session");
  for (const spoofed of ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", crypto.randomUUID()]) {
    assert.equal((await handle(post("/api/events", event, from("203.0.113.5", { "x-kitab-session": spoofed })), env, context())).status, 429);
  }
  assert.equal(rows(db, "learning_events"), 2);
  assert.equal(db.rows<{ n: number }>("SELECT COUNT(DISTINCT session_hash) AS n FROM learning_events")[0].n, 1, "both stored under the 'none' session");
});

test("concurrent requests at cap - 1 admit exactly one", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "events-network", await net("203.0.113.5"), DAILY_LIMITS.events.network - 1);
  const statuses = await Promise.all(Array.from({ length: 10 }, () => handle(post("/api/events", event, from("203.0.113.5")), env, context()).then((response) => response.status)));
  assert.deepEqual(statuses.sort(), [201, ...Array(9).fill(429)]);
  assert.equal(rows(db, "learning_events"), 1);
});

test("IPv6 is limited per /64: rotating the interface id does not reset the limit", async (t) => {
  quiet(t);
  assert.equal(network("2001:db8:abcd:12:1:2:3:4"), "2001:db8:abcd:12::/64");
  assert.equal(network("2001:0DB8:abcd:0012::99"), "2001:db8:abcd:12::/64");
  assert.equal(network("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(network("::1"), "0:0:0:0::/64");
  assert.equal(network("203.0.113.5"), "203.0.113.5");

  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "feedback-network", await net("2001:db8:abcd:12::1"), DAILY_LIMITS.feedback.network);
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("2001:db8:abcd:12:ffff:1:2:3")), env, context())).status, 429);
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("2001:db8:abcd:13::1")), env, context())).status, 201, "a different /64");
});

test("global caps bound D1 writes across many addresses, separately per endpoint and from AI quotas", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "events-global", "global", DAILY_LIMITS.events.global);
  const before = db.statements.length;
  for (let host = 1; host <= 20; host += 1) {
    assert.equal((await handle(post("/api/events", event, from(`192.0.2.${host}`)), env, context())).status, 429);
  }
  assert.deepEqual(writes(db, before), [], "rejections at the global cap write nothing");
  assert.equal(rows(db, "learning_events"), 0);
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("192.0.2.1")), env, context())).status, 201, "feedback has its own budget");
  assert.deepEqual(db.rows<{ scope: string }>("SELECT DISTINCT scope FROM usage_counters ORDER BY scope").map((row) => row.scope), ["events-global", "feedback-global", "feedback-network"]);
});

test("a classroom of 30 learners behind one NAT works through every mission without hitting a limit", async () => {
  const db = new FakeD1();
  const env = envWith({ DB: db });
  const traces = missions.map((item) => ({ item, trace: traceFor(item, item.variants[0].params) }));
  const statuses = new Map<number, number>();
  for (let learner = 0; learner < 30; learner += 1) {
    const headers = from("198.51.100.7", { "x-kitab-session": `${learner.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000` });
    for (const { item, trace: run } of traces) {
      const base = { missionId: item.id, missionVersion: item.version, engineVersion: run.engine.version, scenarioKey: run.scenarioKey };
      for (const type of ["prediction-submitted", "prediction-submitted", "mission-mastered"]) {
        const status = (await handle(post("/api/events", { type, ...base, correct: type === "mission-mastered" }, headers), env, context())).status;
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      }
    }
    const status = (await handle(post("/api/feedback", { target: { kind: "mission", ...{ missionId: mission.id, missionVersion: mission.version, engineVersion: trace.engine.version, scenarioKey: trace.scenarioKey }, frameId: trace.frames[1].id }, rating: 5, comment: "Clear" }, headers), env, context())).status;
    statuses.set(status, (statuses.get(status) ?? 0) + 1);
  }
  assert.deepEqual([...statuses], [[201, 30 * missions.length * 3 + 30]]);
  assert.equal(rows(db, "learning_events"), 30 * missions.length * 3);
  assert.equal(rows(db, "mission_feedback"), 30);
});

const counters = (db: FakeD1, scope: string) => db.rows<{ n: number }>("SELECT COALESCE(SUM(count), 0) AS n FROM usage_counters WHERE scope = ?", scope)[0].n;

test("concurrency: the global cap's last slot goes to exactly one of ten networks; losers' network slots are released", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "events-global", "global", DAILY_LIMITS.events.global - 1);
  const statuses = await Promise.all(Array.from({ length: 10 }, (_, index) => handle(post("/api/events", event, from(`192.0.2.${index + 1}`)), env, context()).then((response) => response.status)));
  assert.deepEqual(statuses.sort(), [201, ...Array(9).fill(429)]);
  assert.equal(counters(db, "events-global"), DAILY_LIMITS.events.global);
  assert.equal(counters(db, "events-network"), 1, "only the admitted request keeps a network slot");
  assert.equal(rows(db, "learning_events"), 1);
});

test("concurrency: with both caps one slot from full, one request is admitted and neither cap is exceeded", async (t) => {
  quiet(t);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "events-network", await net("203.0.113.5"), DAILY_LIMITS.events.network - 1);
  await fill(db, "events-global", "global", DAILY_LIMITS.events.global - 1);
  const ips = [...Array<string>(5).fill("203.0.113.5"), ...Array.from({ length: 5 }, (_, index) => `192.0.2.${index + 1}`)];
  const statuses = await Promise.all(ips.map((ip) => handle(post("/api/events", event, from(ip)), env, context()).then((response) => response.status)));
  assert.equal(statuses.filter((status) => status === 201).length, 1);
  assert.equal(statuses.filter((status) => status === 429).length, 9);
  assert.equal(counters(db, "events-global"), DAILY_LIMITS.events.global);
  assert.ok(db.rows<{ count: number }>("SELECT count FROM usage_counters WHERE scope = 'events-network'").every((row) => row.count <= DAILY_LIMITS.events.network));
  assert.equal(counters(db, "events-network"), DAILY_LIMITS.events.network, "exactly one network slot was kept");
  assert.equal(rows(db, "learning_events"), 1);
});

test("a D1 failure after the network counter was taken releases it and stores nothing", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  let upserts = 0;
  db.failWhen = (sql) => sql.includes("INSERT INTO usage_counters") && ++upserts === 2; // the global counter
  const response = await handle(post("/api/events", event, from("203.0.113.5")), env, context());
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: false, stored: false });
  assert.equal(counters(db, "events-network"), 0);
  assert.equal(rows(db, "learning_events"), 0);

  upserts = 0;
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context())).status, 503);
  assert.equal(counters(db, "feedback-network"), 0);
  assert.equal(rows(db, "mission_feedback"), 0);
});

test("a failed record insert releases both counters, so a learner's retry is not charged twice", async (t) => {
  t.mock.method(console, "error", () => undefined);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  db.failWhen = (sql) => sql.startsWith("INSERT INTO mission_feedback") || sql.startsWith("INSERT INTO learning_events");
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context())).status, 503);
  assert.equal((await handle(post("/api/events", event, from("203.0.113.5")), env, context())).status, 202);
  for (const scope of ["feedback-network", "feedback-global", "events-network", "events-global"]) assert.equal(counters(db, scope), 0, scope);
  db.failWhen = null;
  assert.equal((await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context())).status, 201);
  assert.equal(counters(db, "feedback-network"), 1);
  assert.equal(rows(db, "mission_feedback"), 1);
});

test("missing or malformed client IPs cannot get around the global cap", async (t) => {
  quiet(t);
  assert.equal(network("::ffff:203.0.113.5"), "203.0.113.5");
  assert.equal(network("::FFFF:198.51.100.7"), "198.51.100.7");
  assert.equal(network("unknown"), "unknown");
  const db = new FakeD1();
  const env = envWith({ DB: db });
  const noIp = () => new Request("https://kitab.test/api/events", { method: "POST", body: JSON.stringify(event), headers: { "content-type": "application/json" } });
  assert.equal((await handle(noIp(), env, context())).status, 201);
  assert.equal(db.rows<{ subject: string }>("SELECT subject FROM usage_counters WHERE scope = 'events-network'")[0].subject, await net("unknown"), "no IP shares one 'unknown' bucket");
  db.sqlite.prepare("UPDATE usage_counters SET count = ? WHERE scope = 'events-global'").run(DAILY_LIMITS.events.global);
  for (const request of [noIp(), post("/api/events", event, from("not-an-ip")), post("/api/events", event, from(":::::")), post("/api/events", event, from("1".repeat(500)))]) {
    assert.equal((await handle(request, env, context())).status, 429);
  }
  assert.equal(rows(db, "learning_events"), 1);
});

test("error responses carry only a message and a code", async (t) => {
  quiet(t);
  t.mock.method(console, "error", () => undefined);
  const db = new FakeD1();
  const env = envWith({ DB: db });
  await fill(db, "feedback-network", await net("203.0.113.5"), DAILY_LIMITS.feedback.network);
  const failing = new FakeD1();
  failing.failWhen = (sql) => sql.startsWith("INSERT INTO mission_feedback");
  const responses = [
    await handle(post("/api/feedback", "{broken"), env, context()),
    await handle(post("/api/feedback", { target, rating: 4 }, { "content-type": "text/plain" }), env, context()),
    await handle(post("/api/feedback", { target, rating: 4, comment: "x".repeat(5_000) }), env, context()),
    await handle(post("/api/feedback", { target, rating: 0 }), env, context()),
    await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.5")), env, context()),
    await handle(post("/api/feedback", { target, rating: 4 }, from("203.0.113.6")), envWith({ DB: failing }), context()),
  ];
  assert.deepEqual(responses.map((response) => response.status), [400, 415, 413, 400, 429, 503]);
  for (const response of responses) {
    const text = await response.text();
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ["code", "error"]);
    assert.doesNotMatch(text, /D1_ERROR|INSERT|SELECT|usage_counters|[a-f0-9]{64}|at \w+ \(/);
  }
});

test("events and feedback from a listed retired mission version are kept under that version; unlisted versions are not", async () => {
  const db = new FakeD1();
  const env = envWith({ DB: db });
  const old = { ...event, missionVersion: "1.0.0" };
  assert.notEqual(mission.version, "1.0.0", "tcp-lost-segment has moved on from 1.0.0");
  assert.equal((await handle(post("/api/events", old, from("203.0.113.5")), env, context())).status, 201);
  assert.equal((await handle(post("/api/feedback", { target: { ...target, missionVersion: "1.0.0" }, rating: 4 }, from("203.0.113.5")), env, context())).status, 201);
  assert.deepEqual(db.rows<{ mission_version: string }>("SELECT mission_version FROM learning_events").map((row) => row.mission_version), ["1.0.0"]);
  assert.equal((await handle(post("/api/events", { ...event, missionVersion: "0.9.0" }), env, context())).status, 400);
  const other = findMission("array-insert-shift")!;
  const otherTrace = traceFor(other, other.variants[0].params);
  assert.equal((await handle(post("/api/events", { ...event, missionId: other.id, missionVersion: "0.9.0", engineVersion: otherTrace.engine.version, scenarioKey: otherTrace.scenarioKey }), env, context())).status, 400);
  assert.equal((await handle(post("/api/events", { ...old, engineVersion: "1.0.0", scenarioKey: trace.scenarioKey.replace(trace.engine.version, "1.0.0") }), env, context())).status, 400, "the engine version is never relaxed");
});
