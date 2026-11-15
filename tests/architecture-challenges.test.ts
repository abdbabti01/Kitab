import test from "node:test";
import assert from "node:assert/strict";
import { challengeDesign, challenges, evaluate, findChallenge } from "../src/architecture/challenges.ts";
import { build } from "../src/architecture/templates.ts";
import type { Design } from "../src/architecture/model.ts";

type Specs = Parameters<typeof build>[1];
const client = (c: Record<string, unknown> = {}) => ["client-1", "client", "Users", 0, 0, c] as Specs[number];
const apis = (n: number, extra = {}) => Array.from({ length: n }, (_, i) => [`api-${i + 1}`, "api", `API ${i + 1}`, 0, 0, extra] as Specs[number]);
const lb = (c = {}) => ["load-balancer-1", "load-balancer", "LB", 0, 0, c] as Specs[number];
const lbTo = (n: number) => Array.from({ length: n }, (_, i) => ["load-balancer-1", `api-${i + 1}`] as [string, string]);
const apisTo = (n: number, to: string) => Array.from({ length: n }, (_, i) => [`api-${i + 1}`, to] as [string, string]);
const sql = (id = "sql-1") => [id, "sql", id, 0, 0] as Specs[number];
const workers = (n: number, config = {}) => Array.from({ length: n }, (_, i) => [`worker-${i + 1}`, "worker", `W${i + 1}`, 0, 0, config] as Specs[number]);
const workerEdges = (n: number) => Array.from({ length: n }, (_, i) => [["queue-1", `worker-${i + 1}`], [`worker-${i + 1}`, "sql-1"]] as [string, string][]).flat();

/** For every challenge: designs that must pass (different approaches) and designs that must fail. */
const cases: Record<string, { pass: Record<string, () => Design>; fail: Record<string, () => Design> }> = {
  "simple-web-app": {
    pass: {
      "API + SQL": () => build("x", [client(), ...apis(1), sql()], [["client-1", "api-1"], ["api-1", "sql-1"]]),
      "API + NoSQL": () => build("x", [client(), ...apis(1), ["nosql-1", "nosql", "N", 0, 0]], [["client-1", "api-1"], ["api-1", "nosql-1"]]),
    },
    fail: { "no database": () => build("x", [client(), ...apis(1)], [["client-1", "api-1"]]) },
  },
  "cache-read-heavy": {
    pass: {
      cache: () => build("x", [client(), ...apis(1, { concurrency: 64, queueLimit: 200 }), ["cache-1", "cache", "C", 0, 0], sql()], [["client-1", "api-1"], ["api-1", "cache-1"], ["api-1", "sql-1"]]),
      "read replica": () => build("x", [client(), ...apis(1, { concurrency: 64, queueLimit: 200 }), sql(), sql("sql-2")], [["client-1", "api-1"], ["api-1", "sql-1"], ["api-1", "sql-2"], ["sql-1", "sql-2"]]),
    },
    fail: {
      // A bigger database would be the easy way out; the challenge fixes its size.
      "bigger database": () => build("x", [client(), ...apis(1, { concurrency: 64 }), ["sql-1", "sql", "D", 0, 0, { concurrency: 200, readMs: 1 }]], [["client-1", "api-1"], ["api-1", "sql-1"]]),
    },
  },
  "scale-behind-lb": {
    pass: {
      "4 servers, fast health checks": () => build("x", [client(), lb({ checkIntervalMs: 500 }), ...apis(4), sql()], [["client-1", "load-balancer-1"], ...lbTo(4), ...apisTo(4, "sql-1")]),
      "4 servers, one retry": () => build("x", [client({ retries: 1 }), lb(), ...apis(4), sql()], [["client-1", "load-balancer-1"], ...lbTo(4), ...apisTo(4, "sql-1")]),
    },
    fail: { "3 servers: no spare capacity": () => build("x", [client(), lb(), ...apis(3), sql()], [["client-1", "load-balancer-1"], ...lbTo(3), ...apisTo(3, "sql-1")]) },
  },
  "async-orders": {
    pass: {
      "5 workers, 5 tries": () => build("x", [client(), ...apis(1, { concurrency: 32, serviceMs: 10 }), ["queue-1", "queue", "Q", 0, 0], ...workers(5, { maxReceives: 5 }), sql()], [["client-1", "api-1"], ["api-1", "queue-1"], ...workerEdges(5)]),
      "6 workers, longer retry delay": () => build("x", [client(), ...apis(1, { concurrency: 32, serviceMs: 10 }), ["queue-1", "queue", "Q", 0, 0], ...workers(6, { retryDelayMs: 2000 }), sql()], [["client-1", "api-1"], ["api-1", "queue-1"], ...workerEdges(6)]),
    },
    fail: { "retries end before the outage does": () => build("x", [client(), ...apis(1, { concurrency: 32, serviceMs: 10 }), ["queue-1", "queue", "Q", 0, 0], ...workers(5), sql()], [["client-1", "api-1"], ["api-1", "queue-1"], ...workerEdges(5)]) },
  },
  "resilient-api": {
    pass: {
      "health checks + a third server": () => build("x", [client({ retries: 3, backoffMs: 0 }), lb(), ...apis(3), sql()], [["client-1", "load-balancer-1"], ...lbTo(3), ...apisTo(3, "sql-1")]),
      "faster checks, one retry with backoff": () => build("x", [client({ retries: 1, backoffMs: 100 }), lb({ checkIntervalMs: 500 }), ...apis(3), sql()], [["client-1", "load-balancer-1"], ...lbTo(3), ...apisTo(3, "sql-1")]),
    },
    fail: {
      "health checks without spare capacity": () => build("x", [client({ retries: 1, backoffMs: 100 }), lb(), ...apis(2), sql()], [["client-1", "load-balancer-1"], ...lbTo(2), ...apisTo(2, "sql-1")]),
      "spare capacity without health checks": () => build("x", [client({ retries: 1, backoffMs: 100 }), lb({ healthChecks: false }), ...apis(3), sql()], [["client-1", "load-balancer-1"], ...lbTo(3), ...apisTo(3, "sql-1")]),
    },
  },
  "url-shortener": {
    pass: {
      "SQL with cache and replica": () => build("x", [client(), lb(), ...apis(2), ["cache-1", "cache", "C", 0, 0], sql(), sql("sql-2")], [["client-1", "load-balancer-1"], ...lbTo(2), ...apisTo(2, "cache-1"), ...apisTo(2, "sql-1"), ...apisTo(2, "sql-2"), ["sql-1", "sql-2"]]),
      NoSQL: () => build("x", [client(), lb(), ...apis(2), ["nosql-1", "nosql", "N", 0, 0]], [["client-1", "load-balancer-1"], ...lbTo(2), ...apisTo(2, "nosql-1")]),
    },
    fail: { "SQL with cache, no replica": () => build("x", [client(), lb(), ...apis(2), ["cache-1", "cache", "C", 0, 0], sql()], [["client-1", "load-balancer-1"], ...lbTo(2), ...apisTo(2, "cache-1"), ...apisTo(2, "sql-1")]) },
  },
};

test("every challenge has cases, a fixed client and a budget check", () => {
  assert.deepEqual(Object.keys(cases).sort(), challenges.map((c) => c.id).sort());
  for (const c of challenges) {
    assert.ok(c.locked.includes("client-1"));
    assert.ok(c.fixed.client?.rps, c.id);
    assert.ok(c.checks.some((check) => check.id === "budget"), c.id);
    assert.ok(c.approaches.length >= 2 && c.hints.length >= 2, c.id);
    for (const check of c.checks) assert.ok(c.scenarios.some((s) => s.id === check.scenario), `${c.id}: ${check.id}`);
  }
});

for (const challenge of challenges) {
  test(`${challenge.id}: the starter fails, several different designs pass, and wrong designs fail`, () => {
    assert.equal(evaluate(challenge, challenge.starter()).passed, false, "starter");
    for (const [name, make] of Object.entries(cases[challenge.id].pass)) {
      const result = evaluate(challenge, make());
      assert.ok(result.passed, `${name} should pass: ${result.checks.filter((c) => !c.passed).map((c) => `${c.requirement} (${c.observed})`).join("; ")}`);
    }
    for (const [name, make] of Object.entries(cases[challenge.id].fail)) assert.equal(evaluate(challenge, make()).passed, false, `${name} should fail`);
  });
}

test("fixed settings and the challenge workload replace whatever the design says", () => {
  const challenge = findChallenge("cache-read-heavy")!;
  const tampered = cases["cache-read-heavy"].fail["bigger database"]();
  tampered.workload.durationS = 1;
  (tampered.nodes[0].config as { rps: number }).rps = 1;
  const applied = challengeDesign(challenge, tampered);
  assert.equal((applied.nodes.find((n) => n.kind === "sql")!.config as { concurrency: number }).concurrency, 8);
  assert.equal((applied.nodes[0].config as { rps: number }).rps, 400);
  assert.equal(applied.workload.durationS, 8);
});

test("an invalid design is judged without running", () => {
  const result = evaluate(findChallenge("simple-web-app")!, build("x", [client()], []));
  assert.equal(result.validation.ok, false);
  assert.deepEqual(result.outcomes, {});
  assert.ok(result.checks.every((c) => !c.passed));
});

test("evaluation is deterministic", () => {
  const challenge = findChallenge("resilient-api")!;
  const a = evaluate(challenge, challenge.starter());
  const b = evaluate(challenge, challenge.starter());
  assert.deepEqual(a.checks.map((c) => c.observed), b.checks.map((c) => c.observed));
});
