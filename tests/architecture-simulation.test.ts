import test from "node:test";
import assert from "node:assert/strict";
import { build, templates } from "../src/architecture/templates.ts";
import { simulate, SimulationError, SIM_CONSTANTS, partitionOf, type SimRun } from "../src/architecture/simulate.ts";
import { foldEvents, foldTo, slotLimits, summarize } from "../src/architecture/metrics.ts";
import type { Design } from "../src/architecture/model.ts";

const simple = (rps = 10, extra: Partial<Design["workload"]> = {}, api: Record<string, unknown> = {}, client: Record<string, unknown> = {}) =>
  build("t", [
    ["client-1", "client", "Users", 0, 0, { rps, writePercent: 0, ...client }],
    ["api-1", "api", "API", 0, 0, api],
    ["sql-1", "sql", "DB", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "sql-1"]], { durationS: 2, ...extra });

/** Invariants every run must hold, whatever the design. */
function checkInvariants(run: SimRun) {
  let last = -1;
  const completed = new Map<number, number>();
  for (const [index, e] of run.events.entries()) {
    assert.equal(e.i, index);
    assert.ok(e.t >= last, `events are in time order (${e.type} at ${e.t})`);
    last = e.t;
    if (e.type === "complete") completed.set(e.req!, (completed.get(e.req!) ?? 0) + 1);
    if (e.arriveAt !== undefined) assert.ok(e.arriveAt >= e.t);
  }
  for (const count of completed.values()) assert.equal(count, 1, "a request completes once");
  const s = summarize(run);
  assert.equal(s.ok + s.failed + s.unfinished, s.requests);
  // Slots in use never exceed a component's limit.
  for (const node of run.design.nodes) {
    const limits = slotLimits(run.design, node.id);
    if (!limits.length) continue;
    for (const e of run.events) if (e.busy !== undefined && (e.node === node.id || ((e.type === "consume" || e.type === "dead-letter") && e.to === node.id))) {
      const owner = e.type === "consume" || e.type === "dead-letter" ? e.to : e.node;
      if (owner === node.id) assert.ok(e.busy <= limits[e.part ?? 0], `${node.id} busy ${e.busy} ≤ ${limits[e.part ?? 0]}`);
    }
  }
}

test("every template runs, holds the invariants and finishes its requests", () => {
  for (const template of templates.slice(1)) {
    const run = simulate(template.design());
    checkInvariants(run);
    const s = summarize(run);
    assert.ok(s.requests > 0, template.id);
    assert.equal(s.unfinished, 0, template.id);
    assert.equal(s.failed, 0, template.id);
  }
});

test("latency is the sum of the hops and the work along the path, with no waiting below capacity", () => {
  const run = simulate(simple(10));
  const s = summarize(run);
  const expected = SIM_CONSTANTS.clientToOriginMs * 2 + 20 + SIM_CONSTANTS.internalMs * 2 + 5;
  assert.equal(s.p50, expected);
  assert.equal(s.p99, expected);
});

test("the same design and seed give the same events; another seed changes random arrivals", () => {
  const a = simulate(simple(50, { pattern: "random", seed: 7 }));
  const b = simulate(simple(50, { pattern: "random", seed: 7 }));
  const c = simulate(simple(50, { pattern: "random", seed: 8 }));
  assert.deepEqual(a.events, b.events);
  assert.notDeepEqual(a.events.map((e) => e.t), c.events.map((e) => e.t));
});

test("an invalid design never runs", () => {
  const broken = build("t", [["api-1", "api", "API", 0, 0]], []);
  assert.throws(() => simulate(broken), SimulationError);
});

test("past capacity, requests wait, then the bounded queue refuses the rest", () => {
  // 2 slots × 1000 / 100 ms = 20 requests/s of capacity; 60/s arrive.
  const run = simulate(simple(60, {}, { concurrency: 2, serviceMs: 100, queueLimit: 5 }, { timeoutMs: 10_000 }));
  checkInvariants(run);
  const s = summarize(run);
  assert.ok(s.nodes["api-1"].utilisation![0] > 0.9);
  assert.equal(s.nodes["api-1"].maxWaiting, 5);
  assert.ok((s.nodes["api-1"].rejected["queue-full"] ?? 0) > 0);
  assert.ok((s.failures["queue-full"] ?? 0) > 0);
  assert.ok(s.p95! > 200, "queued requests are slower");
});

test("cache-aside: a cold cache misses first, then popular keys hit and the database sees fewer reads", () => {
  const base = (cache: boolean) => build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 200, writePercent: 0 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 32 }],
    ...(cache ? [["cache-1", "cache", "C", 0, 0, { capacityKeys: 200 }] as const] : []),
    ["sql-1", "sql", "D", 0, 0],
  ] as never, [["client-1", "api-1"], ...(cache ? [["api-1", "cache-1"] as [string, string]] : []), ["api-1", "sql-1"]], { durationS: 5, keys: 1000, skew: "popular" });
  const withCache = simulate(base(true));
  checkInvariants(withCache);
  const s = summarize(withCache);
  const first = withCache.events.find((e) => e.type === "cache")!;
  assert.equal(first.hit, false, "an empty cache misses");
  const rate = s.nodes["cache-1"].hitRate!;
  assert.ok(rate > 0.5 && rate < 1, `hit rate ${rate}`);
  const without = summarize(simulate(base(false)));
  assert.ok(s.nodes["sql-1"].started < without.nodes["sql-1"].started * 0.5);
  // Every miss led to exactly one database read.
  const cache = s.nodes["cache-1"];
  const misses = withCache.events.filter((e) => e.type === "cache" && !e.hit).length;
  assert.equal(s.nodes["sql-1"].started, misses);
  assert.ok(cache.hitRate! < 1);
});

test("uniform keys spread over a small cache hit far less often than popular ones", () => {
  const design = (skew: "uniform" | "popular") => build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 200, writePercent: 0 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 32 }],
    ["cache-1", "cache", "C", 0, 0, { capacityKeys: 100 }],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "cache-1"], ["api-1", "sql-1"]], { durationS: 5, keys: 5000, skew });
  const popular = summarize(simulate(design("popular"))).nodes["cache-1"].hitRate!;
  const uniform = summarize(simulate(design("uniform"))).nodes["cache-1"].hitRate!;
  assert.ok(uniform < 0.05, `uniform ${uniform}`);
  assert.ok(popular > 0.3, `popular ${popular}`);
});

test("a write removes the item from the cache, so the next read of it misses", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 100, writePercent: 30 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 32 }],
    ["cache-1", "cache", "C", 0, 0],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "cache-1"], ["api-1", "sql-1"]], { durationS: 3, keys: 5 }));
  checkInvariants(run);
  const deletes = run.events.filter((e) => e.type === "start" && e.node === "cache-1" && e.op === "delete");
  assert.ok(deletes.length > 0);
  const d = deletes[0];
  const nextRead = run.events.find((e) => e.i > d.i && e.type === "cache" && e.key === d.key);
  if (nextRead) assert.equal(nextRead.hit, false);
});

const balanced = (healthChecks: boolean, faults = [{ node: "api-1", fromS: 1, toS: 3 }], algorithm: "round-robin" | "least-outstanding" = "round-robin") => build("t", [
  ["client-1", "client", "U", 0, 0, { rps: 100, writePercent: 0 }],
  ["load-balancer-1", "load-balancer", "LB", 0, 0, { healthChecks, checkIntervalMs: 500, algorithm }],
  ["api-1", "api", "A1", 0, 0],
  ["api-2", "api", "A2", 0, 0],
  ["sql-1", "sql", "D", 0, 0],
], [["client-1", "load-balancer-1"], ["load-balancer-1", "api-1"], ["load-balancer-1", "api-2"], ["api-1", "sql-1"], ["api-2", "sql-1"]], { durationS: 5 }, faults);

test("round-robin alternates servers; with no failure every request succeeds", () => {
  const run = simulate(balanced(true, []));
  const targets = run.events.filter((e) => e.type === "send" && e.node === "load-balancer-1").map((e) => e.to);
  assert.deepEqual(targets.slice(0, 4), ["api-1", "api-2", "api-1", "api-2"]);
  assert.equal(summarize(run).failed, 0);
});

test("health checks stop traffic to a failed server after the next check; without them half the requests fail", () => {
  const checked = simulate(balanced(true));
  checkInvariants(checked);
  const health = checked.events.filter((e) => e.type === "health");
  assert.deepEqual(health.map((e) => [e.t, e.healthy]), [[1500, false], [3500, true]]);
  const sentToFailed = checked.events.filter((e) => e.type === "send" && e.to === "api-1" && e.t > 1500 && e.t < 3500);
  assert.equal(sentToFailed.length, 0);
  const unchecked = simulate(balanced(false));
  const a = summarize(checked);
  const b = summarize(unchecked);
  assert.ok(b.failed > a.failed * 3, `${b.failed} vs ${a.failed}`);
  assert.ok((b.failures.down ?? 0) > 80);
  // Failures with health checks happen only inside the detection window.
  const failedAt = checked.events.filter((e) => e.type === "complete" && !e.ok).map((e) => e.t);
  assert.ok(failedAt.every((t) => t >= 1000 && t <= 1600), JSON.stringify(failedAt.slice(0, 5)));
});

test("a crash loses the requests in progress there; they fail as crashed", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 100, writePercent: 0 }],
    ["api-1", "api", "A", 0, 0, { serviceMs: 200, concurrency: 64 }],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "sql-1"]], { durationS: 3 }, [{ node: "api-1", fromS: 1, toS: 2 }]));
  checkInvariants(run);
  const s = summarize(run);
  assert.ok((s.failures.crashed ?? 0) > 10);
  assert.ok((s.failures.down ?? 0) > 50);
  assert.equal(run.events.filter((e) => e.type === "fault").length, 1);
  assert.equal(run.events.filter((e) => e.type === "recover").length, 1);
  // Folding up to the middle of the failure shows the component down.
  assert.equal(foldTo(run, null, 1500).nodes["api-1"].down, true);
  assert.equal(foldTo(run, null, 2500).nodes["api-1"].down, false);
});

test("retries turn short failures into successes, and multiply load during an outage", () => {
  const noRetry = build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 100, writePercent: 0, retries: 0 }],
    ["load-balancer-1", "load-balancer", "LB", 0, 0, { healthChecks: false }],
    ["api-1", "api", "A1", 0, 0],
    ["api-2", "api", "A2", 0, 0],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "load-balancer-1"], ["load-balancer-1", "api-1"], ["load-balancer-1", "api-2"], ["api-1", "sql-1"], ["api-2", "sql-1"]], { durationS: 5 }, [{ node: "api-1", fromS: 1, toS: 3 }]);
  const withRetry = structuredClone(noRetry);
  (withRetry.nodes[0].config as { retries: number }).retries = 2;
  const a = summarize(simulate(noRetry));
  const run = simulate(withRetry);
  checkInvariants(run);
  const b = summarize(run);
  assert.ok(b.failed < a.failed / 3, `${b.failed} < ${a.failed}/3`);
  assert.ok(b.retries > 50);
  const attempts = run.events.filter((e) => e.type === "send" && e.node === "client-1").length;
  assert.equal(attempts, b.requests + b.retries);
  // Backoff doubles: a request's second retry starts at least 100 + 200 ms after its first failure.
  const firstRetried = run.events.find((e) => e.type === "retry" && e.attempt === 3);
  if (firstRetried) {
    const r1 = run.events.find((e) => e.type === "retry" && e.req === firstRetried.req && e.attempt === 2)!;
    assert.ok(firstRetried.t - r1.t >= 200);
  }
});

test("a client timeout gives up on slow answers; the late answers are counted as wasted work", () => {
  const run = simulate(simple(40, {}, { concurrency: 1, serviceMs: 50, queueLimit: 1000 }, { timeoutMs: 300 }));
  checkInvariants(run);
  const s = summarize(run);
  assert.ok(s.timeouts > 0);
  assert.ok(s.late > 0);
  assert.equal(s.failures.timeout, s.failed);
});

test("queues absorb a burst: writes are accepted at once (202) and workers catch up", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 200, writePercent: 100 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 16 }],
    ["queue-1", "queue", "Q", 0, 0],
    ["worker-1", "worker", "W", 0, 0, { concurrency: 4, serviceMs: 40 }],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "queue-1"], ["queue-1", "worker-1"], ["worker-1", "sql-1"]], { durationS: 3 }));
  checkInvariants(run);
  const s = summarize(run);
  assert.equal(s.failed, 0);
  assert.ok(s.p95! < 120, "accepted quickly");
  assert.ok(run.events.filter((e) => e.type === "complete").every((e) => e.status === 202));
  const q = s.nodes["queue-1"];
  assert.equal(q.published, 600);
  // 4 slots / (40 ms + a database write of ~17 ms) ≈ 70 messages/s, below 200/s: a backlog builds, then drains.
  assert.ok(q.maxDepth > 200);
  assert.equal(s.nodes["worker-1"].started, 600);
  assert.equal(run.events.filter((e) => e.type === "ack").length, 600);
  assert.equal(q.depth, 0);
});

test("a full queue refuses messages: backpressure reaches the client", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 200, writePercent: 100 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 16 }],
    ["queue-1", "queue", "Q", 0, 0, { maxDepth: 20 }],
    ["worker-1", "worker", "W", 0, 0, { concurrency: 1, serviceMs: 100 }],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "queue-1"], ["queue-1", "worker-1"], ["worker-1", "sql-1"]], { durationS: 2 }));
  checkInvariants(run);
  const s = summarize(run);
  assert.ok((s.failures["queue-full"] ?? 0) > 100);
  assert.ok(s.nodes["queue-1"].maxDepth <= 20);
});

test("failed messages are redelivered, then dead-lettered after the receive limit; none is lost", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 20, writePercent: 100 }],
    ["api-1", "api", "A", 0, 0],
    ["queue-1", "queue", "Q", 0, 0],
    ["worker-1", "worker", "W", 0, 0, { maxReceives: 2, retryDelayMs: 500 }],
    ["sql-1", "sql", "D", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "queue-1"], ["queue-1", "worker-1"], ["worker-1", "sql-1"]], { durationS: 4 }, [{ node: "sql-1", fromS: 1, toS: 3 }]));
  checkInvariants(run);
  const s = summarize(run);
  const q = s.nodes["queue-1"];
  assert.ok(q.redelivered > 0 || s.nodes["worker-1"].redelivered > 0);
  const redelivered = run.events.filter((e) => e.type === "redeliver").length;
  const dead = run.events.filter((e) => e.type === "dead-letter").length;
  const acked = run.events.filter((e) => e.type === "ack").length;
  assert.ok(redelivered > 0);
  assert.ok(dead > 0);
  assert.equal(acked + dead + q.depth, q.published, "every message is acknowledged, dead-lettered or still queued");
});

test("read replicas share reads; every write is also applied on each replica", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 100, writePercent: 20 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 32 }],
    ["sql-1", "sql", "Primary", 0, 0],
    ["sql-2", "sql", "Replica", 0, 0],
  ], [["client-1", "api-1"], ["api-1", "sql-1"], ["api-1", "sql-2"], ["sql-1", "sql-2"]], { durationS: 3 }));
  checkInvariants(run);
  const ops = (node: string, op: string) => run.events.filter((e) => e.type === "start" && e.node === node && e.op === op).length;
  assert.equal(ops("sql-2", "write"), 0, "writes go to the primary only");
  assert.ok(Math.abs(ops("sql-1", "read") - ops("sql-2", "read")) <= 1, "reads alternate");
  assert.equal(ops("sql-2", "apply"), ops("sql-1", "write"), "each write is applied on the replica");
  assert.equal(run.events.filter((e) => e.type === "applied").length, ops("sql-1", "write"));
});

test("NoSQL keys stay on one partition, and a popular key overloads its partition first", () => {
  assert.equal(partitionOf(17, 8), partitionOf(17, 8));
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 800, writePercent: 0 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 64, serviceMs: 5 }],
    ["nosql-1", "nosql", "N", 0, 0, { partitions: 8, concurrencyPerPartition: 1, opMs: 5 }],
  ], [["client-1", "api-1"], ["api-1", "nosql-1"]], { durationS: 3, keys: 10_000, skew: "popular" }));
  checkInvariants(run);
  const util = summarize(run).nodes["nosql-1"].utilisation!;
  const max = Math.max(...util);
  const mean = util.reduce((a, b) => a + b, 0) / util.length;
  assert.equal(util.length, 8);
  assert.ok(max > mean * 1.3, `hot partition ${max.toFixed(2)} vs mean ${mean.toFixed(2)}`);
  for (const e of run.events) if (e.type === "start" && e.node === "nosql-1") assert.equal(e.part, partitionOf(e.key!, 8));
});

test("a CDN serves repeated files from its edge and fetches misses from object storage", () => {
  const run = simulate(templates.find((t) => t.id === "static-site")!.design());
  checkInvariants(run);
  const s = summarize(run);
  assert.ok(s.nodes["cdn-1"].hitRate! > 0.7);
  const misses = run.events.filter((e) => e.type === "cache" && e.node === "cdn-1" && !e.hit).length;
  assert.equal(s.nodes["object-storage-1"].started, misses);
});

test("a cache that fails comes back empty, and reads fall through to the database meanwhile", () => {
  const run = simulate(build("t", [
    ["client-1", "client", "U", 0, 0, { rps: 200, writePercent: 0 }],
    ["api-1", "api", "A", 0, 0, { concurrency: 32 }],
    ["cache-1", "cache", "C", 0, 0],
    ["sql-1", "sql", "D", 0, 0, { concurrency: 50 }],
  ], [["client-1", "api-1"], ["api-1", "cache-1"], ["api-1", "sql-1"]], { durationS: 4, keys: 50 }, [{ node: "cache-1", fromS: 2, toS: 3 }]));
  checkInvariants(run);
  assert.equal(summarize(run).failed, 0, "a cache outage costs speed, not correctness");
  const after = run.events.find((e) => e.type === "cache" && e.t >= 3000)!;
  assert.equal(after.hit, false, "the restarted cache is empty");
});

test("stepping through events and seeking by time read the same state", () => {
  const run = simulate(balanced(true));
  const middle = run.events[Math.floor(run.events.length / 2)];
  const index = run.events.findLastIndex((e) => e.t <= middle.t) + 1;
  const byTime = foldTo(run, null, middle.t);
  const byStep = foldEvents(run, null, index);
  assert.deepEqual(byStep.nodes, byTime.nodes);
  assert.deepEqual(byStep.totals, byTime.totals);
  // Moving forward from an earlier fold gives the same result as folding from the start.
  const incremental = foldTo(run, foldTo(run, null, 1000), middle.t);
  assert.deepEqual(incremental.nodes, byTime.nodes);
});

test("the event stream is bounded", () => {
  const big = simple(1500, { durationS: 10 }, { concurrency: 64 });
  const run = simulate(big);
  assert.ok(run.events.length <= SIM_CONSTANTS.maxEvents);
  assert.equal(summarize(run).requests, 15_000);
});
