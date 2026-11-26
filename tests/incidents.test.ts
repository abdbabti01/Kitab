import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch, checkToken, hash01, isFailure, LIMITS, simulate, type ModelToken, type Run } from "../src/incidents/engine.ts";
import { assess, combine, continuedRun, incidentRun, incidentWindow, postmortem, postmortemMarkdown, recoveryWindow, stateAfter, stepError, summarize, verify, type Attempt, type Step } from "../src/incidents/assess.ts";
import { DEFAULT_STATE, SCENARIOS, findScenario, startState, truthOf } from "../src/incidents/scenarios.ts";
import { DIAGNOSTICS, buckets, index, logFinding, logs, percentile, requestFacts, topology, traceFinding, traces, waterfall } from "../src/incidents/telemetry.ts";
import { INCIDENTS_KEY, finish, loadIncidents, newAttempt, resetAttempt, saveAttempt, startAttempt, stateOf } from "../src/incidents/progress.ts";
import { parseRoute } from "../src/app/routes.ts";
import { conceptUnits } from "../src/architecture/concepts/index.ts";
import { identityUnits } from "../src/identity/content/index.ts";
import { glossary, type GlossaryTerm } from "../src/learning/glossary.ts";
import { chapters } from "../src/content/chapters.ts";

const set = (path: string, value: string | number | boolean): Step => ({ kind: "set", path, value });
const act = (id: string): Step => ({ kind: "action", id });

/** For every scenario: changes that fully recover it, and changes that must not (symptom-only, unsafe or wrong). */
const PLANS: Record<string, { fixes: Step[][]; notFixes: Step[][] }> = {
  "db-pool-exhaustion": { fixes: [[act("hotfix")], [act("rollback")]], notFixes: [[set("pool.size", 20)], [set("pool.size", 30)], [act("restart")], [set("api.replicas", 5)]] },
  "cache-stampede": { fixes: [[set("cache.coalescing", true)]], notFixes: [[set("cache.saleTtlS", "60")], [set("db.cpuSlots", "32")], []] },
  "retry-storm": { fixes: [[set("payment.retries", 1), set("payment.backoff", "exponential-jitter"), set("payment.idempotencyKeys", true)], [set("payment.breaker", true)]], notFixes: [[], [set("api.replicas", 6)]] },
  "unhealthy-instance": { fixes: [[set("lb.healthCheck", "readiness"), act("replace")]], notFixes: [[act("replace")], [set("client.retries", 3)]] },
  "dns-misconfiguration": { fixes: [[set("dns.record", "203.0.113.10")]], notFixes: [[set("client.retries", 3)], [set("dns.ttlS", "5")]] },
  "api-auth-failure": { fixes: [], notFixes: [[set("auth.verifySignature", false)], [set("auth.audience", "*")], [set("auth.algs", "RS256,HS256")]] },
  "sso-outage": { fixes: [[set("idp.registeredRedirects", "finance.example,finance.store.example")], [set("sso.redirectUri", "finance.example")]], notFixes: [[set("idp.registeredRedirects", "*")], [set("sso.sessionS", "600")]] },
  "queue-backlog": { fixes: [[set("worker.concurrency", 24), set("worker.deadLetter", true)]], notFixes: [[act("rollback")], [set("worker.deadLetter", true)], [set("worker.concurrency", 12)]] },
  "failed-deployment": { fixes: [[act("rollback")], [act("hotfix")]], notFixes: [[set("api.replicas", 6)], [act("restart")]] },
  "slow-query": { fixes: [[set("db.ordersIndex", true)], [act("rollback")]], notFixes: [[set("db.cpuSlots", "16")], [set("pool.size", 20)]] },
  "rate-limit-failure": { fixes: [[set("gateway.keyBy", "api-key")]], notFixes: [[set("gateway.limitRps", 40)], [set("gateway.rateLimit", false)]] },
  "multi-factor": { fixes: [[set("payment.timeoutMs", 2000), set("payment.retries", 1), set("payment.idempotencyKeys", true), set("payment.breaker", true)]], notFixes: [[set("payment.breaker", true)], [set("api.concurrency", 64), set("api.replicas", 4)], []] },
};
const AUTH_FIXES: Record<string, Step[]> = { "stale-jwks": [set("auth.jwksRefresh", "on-unknown-kid")], audience: [set("auth.audience", "https://api.store.example")], issuer: [set("auth.issuer", "https://login.store.example/v2")] };

const runs = new Map<string, Run>();
const incidentOf = (id: string, variant: string) => {
  const key = `${id}/${variant}`;
  if (!runs.has(key)) {
    const s = findScenario(id)!;
    runs.set(key, incidentRun(s, s.variants.find((v) => v.id === variant)!));
  }
  return runs.get(key)!;
};
const pool = findScenario("db-pool-exhaustion")!;
const held = pool.variants[0];

// ---- Engine ----

test("a run is deterministic: the same input gives the same events and spans", () => {
  const a = incidentRun(pool, held);
  const b = incidentRun(pool, held);
  assert.equal(JSON.stringify(a.events), JSON.stringify(b.events));
  assert.equal(JSON.stringify(a.spans), JSON.stringify(b.spans));
  assert.ok(a.events.length > 1000);
});

test("events are in time order with sequential indexes, and every run is bounded", () => {
  for (const s of SCENARIOS) for (const v of s.variants) {
    const run = incidentOf(s.id, v.id);
    assert.equal(run.truncated, false, `${s.id}/${v.id} truncated`);
    assert.ok(run.events.length < LIMITS.maxEvents && run.spans.length < LIMITS.maxSpans);
    run.events.forEach((e, i) => {
      assert.equal(e.i, i);
      if (i) assert.ok(e.t >= run.events[i - 1].t, `${s.id} event ${i} goes back in time`);
    });
  }
});

test("spans: no negative durations, children inside their parent unless the caller gave up or the work is asynchronous", () => {
  for (const s of SCENARIOS) for (const v of s.variants) {
    const run = incidentOf(s.id, v.id);
    const { byId } = index(run);
    for (const span of run.spans) {
      assert.ok(span.end >= span.start, `${s.id}: ${span.name} ends before it starts`);
      assert.ok(span.status !== "unset" || span.attrs.unfinished, `${s.id}: ${span.name} never closed`);
      if (!span.parent) continue;
      const parent = byId.get(span.parent);
      assert.ok(parent, `${s.id}: ${span.name} has a missing parent`);
      assert.equal(parent!.trace, span.trace);
      assert.ok(span.start >= parent!.start, `${s.id}: ${span.name} starts before ${parent!.name}`);
      const escapes = span.end > parent!.end;
      if (escapes) assert.ok(span.attrs.callerGaveUp || span.attrs.unfinished || parent!.attrs.unfinished || span.attrs.async || isAbandonedWait(run, span), `${s.id}: ${span.name} (${span.end}) outlives synchronous parent ${parent!.name} (${parent!.end})`);
    }
  }
});
/** Work below a span whose caller gave up (a server span still running after the client timed out). */
function isAbandonedWait(run: Run, span: Run["spans"][number]): boolean {
  const { byId } = index(run);
  for (let p = span.parent ? byId.get(span.parent) : undefined; p; p = p.parent ? byId.get(p.parent) : undefined) if (p.attrs.callerGaveUp) return true;
  return false;
}

test("resource readings never exceed their limits", () => {
  for (const s of SCENARIOS) for (const v of s.variants) {
    for (const e of incidentOf(s.id, v.id).events.filter((x) => x.type === "gauge")) {
      const d = e.data!;
      assert.ok(d["db.connections"] <= d["db.maxConnections"], `${s.id}: connections over the database limit`);
      assert.ok(d["db.active"] <= d["db.cpuSlots"], `${s.id}: more queries running than CPU slots`);
      assert.ok(d["api.threads.busy"] <= Math.max(d["api.threads.limit"], d["api.threads.busy"] && d["api.instances"] * 1000), `${s.id}: threads`);
      assert.ok(d["worker.busy"] <= d["worker.concurrency"] || s.id === "queue-backlog", `${s.id}: workers`);
      for (const k of Object.keys(d)) assert.ok(d[k] >= 0, `${s.id}: ${k} negative`);
    }
  }
});

test("stable identities: the same request has the same trace ID in the incident and verification runs", () => {
  const a = incidentOf(pool.id, held.id);
  const b = continuedRun(pool, held, [act("hotfix")], false);
  const first = (run: Run) => run.events.filter((e) => e.type === "request").slice(0, 200).map((e) => `${e.req}:${e.trace}:${e.endpoint}`);
  assert.deepEqual(first(a), first(b));
  // Before the fix time the two executions are identical.
  const until = (run: Run) => run.events.filter((e) => e.t < pool.timing.fixAtMs && e.type !== "change").map((e) => JSON.stringify(e)).join("\n");
  assert.equal(until(a), until(b));
});

test("pool exhaustion is modelled, not drawn: waiting requests, timeouts and held connections come from the same run", () => {
  const run = incidentOf(pool.id, held.id);
  const w = incidentWindow(pool);
  const g = run.events.filter((e) => e.type === "gauge" && e.t >= w.from);
  assert.ok(g.some((e) => e.data!["pool.waiting"] > 0 && e.data!["pool.inUse"] >= e.data!["pool.size"]), "the pool fills with waiters");
  const timeouts = run.spans.filter((x) => x.name === "db.pool.acquire" && x.error?.code === "POOL_TIMEOUT");
  assert.ok(timeouts.length > 0);
  for (const span of timeouts) assert.ok(Math.abs(span.end - span.start - 1000) < 1e-6, "acquire timeouts last exactly the configured timeout");
  // Every POOL_TIMEOUT log line points at the span that timed out.
  const lines = logs(run).filter((l) => l.code === "POOL_TIMEOUT" && l.service !== "gateway");
  assert.ok(lines.length > 0);
  for (const l of lines) assert.equal(index(run).byId.get(l.span!)?.name, "db.pool.acquire", "the line is logged where the timeout happened");
  // Latency rises before failures: the first slow bucket comes before the first failing one.
  const b = buckets(run).filter((x) => x.from >= pool.timing.faultAtMs);
  const slow = b.findIndex((x) => x.values.p95 > 800), failing = b.findIndex((x) => x.values.errorRate > 1);
  assert.ok(slow >= 0 && failing >= 0 && slow <= failing, `slow at ${slow}, failing at ${failing}`);
  // In v60 the payment call is outside the transaction; in v61 every checkout transaction contains it.
  const tx = run.spans.filter((x) => x.name === "db.transaction" && !x.attrs.unfinished);
  assert.ok(tx.length > 0 && tx.every((t) => index(run).children.get(t.id)!.some((c) => c.name === "payment.charge")));
  assert.ok(!run.spans.some((x) => x.name === "db.transaction" && x.start < pool.timing.faultAtMs));
});

test("a connection leak only ever grows until a restart, and a bigger pool only delays it", () => {
  const leak = pool.variants[1];
  const leaked = (run: Run) => run.events.filter((e) => e.type === "gauge").map((e) => e.data!["pool.leaked"]);
  const series = leaked(incidentOf(pool.id, leak.id));
  for (let i = 1; i < series.length; i++) assert.ok(series[i] >= series[i - 1]);
  const restarted = leaked(continuedRun(pool, leak, [act("restart")], false));
  assert.ok(restarted.some((n, i) => i && n < restarted[i - 1]), "a restart closes leaked connections");
  assert.ok(restarted.at(-1)! > 0, "and v61 leaks again afterwards");
});

test("retries amplify load and, without idempotency keys, charge customers twice", () => {
  const s = findScenario("retry-storm")!;
  const run = incidentOf(s.id, "storm");
  const w = incidentWindow(s);
  const calls = run.spans.filter((x) => x.name === "POST /v1/charges" && x.end >= w.from && x.end < w.to).length;
  const charges = run.spans.filter((x) => x.name === "payment.charge" && x.end >= w.from && x.end < w.to).length;
  assert.ok(calls / charges > 2, `${calls} calls for ${charges} charges`);
  assert.ok(run.events.some((e) => e.type === "charge" && e.data?.duplicate));
  const keyed = continuedRun(s, s.variants[0], [set("payment.idempotencyKeys", true)], false);
  const later = new Set(keyed.events.filter((e) => e.type === "request" && e.t >= s.timing.fixAtMs).map((e) => e.req));
  assert.equal(keyed.events.filter((e) => e.type === "charge" && later.has(e.req)).length, 0);
});

test("cache: stampedes are concurrent misses for one key; coalescing collapses them per instance", () => {
  const s = findScenario("cache-stampede")!;
  const run = incidentOf(s.id, "ttl");
  const ctx = { run, during: incidentWindow(s), before: { from: 0, to: s.timing.faultAtMs }, state: stateAfter(s, s.variants[0], []) };
  assert.ok(DIAGNOSTICS.find((d) => d.id === "cache")!.run(ctx).findings.some((f) => f.id === "cache.stampede"));
  const coalesced = continuedRun(s, s.variants[0], [set("cache.coalescing", true)], false);
  const ctx2 = { ...ctx, run: coalesced, during: recoveryWindow(s), state: stateAfter(s, s.variants[0], [set("cache.coalescing", true)]) };
  assert.ok(!DIAGNOSTICS.find((d) => d.id === "cache")!.run(ctx2).findings.some((f) => f.id === "cache.stampede"));
});

test("token checks follow the identity track's order, and 401 is told apart from 403", () => {
  const rs = { issuer: "https://login.store.example", audience: "https://api.store.example", algs: "RS256" as const, verifySignature: true, keys: new Set(["k1"]) };
  const good: ModelToken = { alg: "RS256", kid: "k1", iss: rs.issuer, aud: rs.audience, exp: 100, signedWith: "issuer-key", scopes: "orders.read" };
  assert.deepEqual(checkToken(good, rs, 10), { ok: true });
  assert.equal((checkToken({ ...good, alg: "HS256", signedWith: "public-key-as-hmac" }, rs, 10) as { step: string }).step, "alg");
  assert.equal((checkToken({ ...good, kid: "k2" }, rs, 10) as { step: string }).step, "kid");
  assert.equal((checkToken({ ...good, signedWith: "forged" }, rs, 10) as { step: string }).step, "signature");
  assert.equal((checkToken({ ...good, iss: "https://evil.example", aud: "x" }, rs, 10) as { step: string }).step, "iss", "issuer before audience");
  assert.equal((checkToken({ ...good, aud: "https://hr.store.example" }, rs, 10) as { step: string }).step, "aud");
  assert.equal((checkToken(good, rs, 200) as { step: string }).step, "exp");
  assert.deepEqual(checkToken({ ...good, aud: "https://hr.store.example" }, { ...rs, audience: "*" }, 10), { ok: true }, "an unchecked audience accepts tokens for other APIs");
  assert.deepEqual(checkToken({ ...good, alg: "HS256", signedWith: "public-key-as-hmac" }, { ...rs, algs: "RS256,HS256" }, 10), { ok: true }, "allowing HS256 enables algorithm confusion");
  const run = incidentOf("api-auth-failure", "stale-jwks");
  const statuses = new Set(run.events.filter((e) => e.type === "complete" && e.legit).map((e) => e.status));
  assert.ok(statuses.has(401) && statuses.has(403) && statuses.has(200));
  assert.ok(isFailure(401) && !isFailure(403) && !isFailure(402));
});

test("applyPatch refuses settings the model doesn't have and values of the wrong type", () => {
  assert.throws(() => applyPatch(DEFAULT_STATE, { "pool.nope": 1 }));
  assert.throws(() => applyPatch(DEFAULT_STATE, { "pool.size": "ten" }));
  assert.equal(applyPatch(DEFAULT_STATE, { "pool.size": 12 }).pool.size, 12);
  assert.equal(DEFAULT_STATE.pool.size, 10, "patches never mutate their input");
  assert.ok(hash01(1, 2) >= 0 && hash01(1, 2) < 1 && hash01(1, 2) === hash01(1, 2));
});

test("simulate refuses unbounded work: rates and run length are capped", () => {
  const s = startState(pool);
  const run = simulate({ seed: 1, state: applyPatch(s, { "env.traffic.browse": 100_000 }), changes: [], builds: pool.builds, features: pool.features, endMs: 10 ** 9 });
  assert.ok(run.endMs <= LIMITS.maxEndMs);
  assert.ok(run.events.length <= LIMITS.maxEvents);
});

// ---- Telemetry ----

test("percentiles are nearest-rank and always an observed value", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(xs, 50), 5);
  assert.equal(percentile(xs, 95), 10);
  assert.equal(percentile(xs, 10), 1);
  assert.equal(percentile([], 95), 0);
  const run = incidentOf(pool.id, held.id);
  const lat = new Set(run.events.filter((e) => e.type === "complete" && e.legit).map((e) => e.latencyMs));
  for (const b of buckets(run)) if (b.values.rps) assert.ok(lat.has(b.values.p95), "p95 is one of the simulated latencies");
});

test("metrics are computed from the run: bucket counts add up to the completed requests", () => {
  const run = incidentOf(pool.id, held.id);
  const total = buckets(run).reduce((n, b) => n + b.values.rps * 2, 0);
  const done = run.events.filter((e) => e.type === "complete" && e.legit).length;
  assert.ok(Math.abs(total - done) < 1e-6);
  const f = requestFacts(run, { from: 0, to: run.endMs });
  assert.equal(f.requests, done);
  for (const b of buckets(run)) for (const [k, v] of Object.entries(b.values)) assert.ok(Number.isFinite(v) && v >= 0, `${k} = ${v}`);
});

test("every log line comes from a span or event of the run, and trace IDs correlate", () => {
  for (const s of SCENARIOS) {
    const run = incidentOf(s.id, s.variants[0].id);
    const { byId, byTrace } = index(run);
    for (const line of logs(run)) {
      if (line.id.startsWith("v")) assert.ok(run.events[Number(line.id.slice(1))], `${s.id}: ${line.id}`);
      else assert.ok(byId.has(line.id.slice(1)), `${s.id}: ${line.id}`);
      if (line.trace) assert.ok(byTrace.has(line.trace), `${s.id}: log trace ${line.trace} has no spans`);
      assert.doesNotMatch(line.message, /eyJ[A-Za-z0-9_-]{10,}|password|card number/i, "no tokens or secrets in logs");
    }
  }
});

test("traces and waterfalls only contain work the run did", () => {
  const run = incidentOf(pool.id, held.id);
  const t = traces(run).find((x) => x.failed)!;
  const rows = waterfall(run, t.trace);
  assert.ok(rows.length >= 4);
  assert.ok(rows.every((r) => r.span.trace === t.trace));
  assert.equal(rows[0].depth, 0);
  const finding = traceFinding(run, t.trace);
  assert.ok(finding.id.startsWith("latency."));
});

test("topology health comes from telemetry; DNS has none of its own", () => {
  const s = findScenario("dns-misconfiguration")!;
  const run = incidentOf(s.id, "typo");
  const health = topology(run, s.timing.fixAtMs, s.components);
  assert.equal(health.find((h) => h.id === "dns")!.health, "no-telemetry");
  assert.equal(health.find((h) => h.id === "browser")!.health, "failing");
  assert.equal(health.find((h) => h.id === "store-api")!.health, "healthy", "the servers see nothing wrong");
});

// ---- Scenarios ----

test("every scenario is complete, solvable and honest", () => {
  assert.equal(SCENARIOS.length, 12);
  assert.equal(new Set(SCENARIOS.map((s) => s.id)).size, 12);
  for (const s of SCENARIOS) {
    assert.ok(s.variants.length && s.controls.length && s.criteria.some((c) => c.run === "target") && s.criteria.some((c) => c.run === "stress"), s.id);
    assert.ok(s.hints.length >= 3 && s.limitations.length && s.prevention.length && s.learn.length, s.id);
    for (const c of s.controls) {
      const step = set(c.id, c.type === "number" ? c.min : c.type === "toggle" ? true : c.options[0].value);
      assert.equal(stepError(s, step), null, `${s.id}: ${c.id}`);
      assert.doesNotThrow(() => stateAfter(s, s.variants[0], [step]), `${s.id}: ${c.id} applies to the model`);
    }
    for (const a of s.actions) assert.doesNotThrow(() => stateAfter(s, s.variants[0], [act(a.id)]), `${s.id}: action ${a.id}`);
    for (const t of s.terms) assert.ok(glossary[t], `${s.id}: term ${t}`);
    for (const v of s.variants) {
      assert.ok(s.hypotheses.some((h) => truthOf(h, v.id) === "root"), `${s.id}/${v.id} has a root-cause hypothesis`);
      assert.ok(v.rootCause.length && v.keyEvidence.length && v.conclusion.length > 80, `${s.id}/${v.id}`);
      for (const ch of v.changes) assert.ok(ch.atMs < s.timing.endMs);
    }
  }
});

test("learning links resolve to real pages and sections", () => {
  for (const s of SCENARIOS) for (const link of s.learn) {
    const [path, anchor] = link.href.split("#");
    assert.notEqual(parseRoute(path.split("?")[0]).name, "not-found", `${s.id} → ${link.href}`);
    if (path.startsWith("/learn/system-design/") && anchor) {
      const unit = conceptUnits.find((u) => u.id === path.split("/").pop());
      assert.ok(unit?.concepts.some((c) => c.id === anchor), `${s.id} → ${link.href}`);
    }
    if (path.startsWith("/learn/identity/")) assert.ok(identityUnits.some((u) => u.id === path.split("/").pop()), `${s.id} → ${link.href}`);
    if (path.startsWith("/concepts/")) assert.ok(chapters.some((c) => c.slug === path.split("/").pop()), `${s.id} → ${link.href}`);
  }
  for (const [key, term] of Object.entries(glossary) as [string, GlossaryTerm][]) {
    if (!term.more) continue;
    const [path, anchor] = term.more.href.split("#");
    if (path.startsWith("/learn/system-design/")) assert.ok(conceptUnits.find((u) => u.id === path.split("/").pop())?.concepts.some((c) => c.id === anchor), `glossary ${key}`);
    if (path.startsWith("/learn/identity/")) assert.ok(identityUnits.find((u) => u.id === path.split("/").pop())?.concepts.some((c) => c.id === anchor), `glossary ${key}`);
  }
});

test("each incident shows its symptoms and the evidence for its root cause, from the run alone", () => {
  for (const s of SCENARIOS) for (const v of s.variants) {
    const run = incidentOf(s.id, v.id);
    const ctx = { run, during: incidentWindow(s), before: { from: 0, to: s.timing.faultAtMs }, state: stateAfter(s, v, []) };
    const found = new Set<string>();
    for (const d of DIAGNOSTICS) if (!d.needs || d.needs.every((n) => s.features[n])) for (const f of d.run(ctx).findings) found.add(f.id);
    for (const line of logs(run)) { const f = logFinding(line); if (f) found.add(f.id); }
    for (const k of v.keyEvidence) assert.ok(found.has(k), `${s.id}/${v.id}: key evidence ${k} is not produced by the run`);
    for (const h of s.hypotheses.filter((x) => truthOf(x, v.id) === "root")) assert.ok(h.supports.some((id) => found.has(id)), `${s.id}/${v.id}: nothing in the run supports root hypothesis ${h.id}`);
    for (const h of s.hypotheses.filter((x) => truthOf(x, v.id) === "false")) assert.ok(!h.supports.every((id) => found.has(id)) || !h.supports.length || h.refutes.some((id) => found.has(id)), `${s.id}/${v.id}: false hypothesis ${h.id} is fully supported and never refuted`);
  }
});

test("valid fixes fully recover every incident; symptom-only and unsafe changes don't", { timeout: 600_000 }, () => {
  for (const s of SCENARIOS) {
    const plans = PLANS[s.id];
    for (const v of s.variants) {
      const fixes = s.id === "api-auth-failure" ? [AUTH_FIXES[v.id]] : plans.fixes;
      const incident = incidentOf(s.id, v.id);
      for (const steps of fixes) {
        const r = verify(s, v, steps, incident);
        assert.ok(r.outcome.fullyRecovered, `${s.id}/${v.id} ${JSON.stringify(steps)}: ${r.outcome.label} ${JSON.stringify(r.criteria.filter((c) => !c.passed))}`);
      }
      if (v !== s.variants[0] && s.id !== "api-auth-failure") continue;
      for (const steps of plans.notFixes) {
        const r = verify(s, v, steps, incident);
        assert.ok(!r.outcome.fullyRecovered, `${s.id}/${v.id} ${JSON.stringify(steps)} should not fully recover`);
      }
    }
  }
});

test("doing nothing never recovers, and unsafe shortcuts are named as unsafe", () => {
  for (const s of SCENARIOS) {
    const r = verify(s, s.variants[0], [], incidentOf(s.id, s.variants[0].id));
    assert.ok(!r.outcome.serviceRecovered || !r.outcome.rootCauseFixed, `${s.id}: waiting fixed it`);
  }
  const auth = findScenario("api-auth-failure")!;
  assert.equal(verify(auth, auth.variants[0], [set("auth.verifySignature", false)]).outcome.safe, false);
  const sso = findScenario("sso-outage")!;
  assert.equal(verify(sso, sso.variants[0], [set("idp.registeredRedirects", "*")]).outcome.safe, false);
  const pooled = verify(pool, held, [set("pool.size", 30)]);
  assert.equal(pooled.outcome.safe, false, "an oversized pool exceeds the database's connection limit");
});

test("a bigger pool mitigates but leaves the root cause: the stress workload tells them apart", () => {
  const r = verify(pool, held, [set("pool.size", 20)]);
  assert.equal(r.outcome.serviceRecovered, true);
  assert.equal(r.outcome.rootCauseFixed, false);
  assert.equal(r.outcome.stressPassed, false);
  assert.equal(r.outcome.label, "Mitigated, root cause still present");
});

// ---- Remediation steps ----

test("remediation steps are validated against the scenario's controls and actions", () => {
  assert.equal(stepError(pool, set("pool.size", 20)), null);
  assert.match(stepError(pool, set("pool.size", 99))!, /not a valid value/);
  assert.match(stepError(pool, set("pool.size", 2.5))!, /not a valid value/);
  assert.match(stepError(pool, set("auth.verifySignature", false))!, /can't be changed/);
  assert.match(stepError(pool, act("format-disk"))!, /Unknown action/);
  const { patch, ops, labels } = combine(pool, [set("pool.size", 20), set("pool.size", 30), act("restart"), set("pool.size", 99)]);
  assert.deepEqual(patch, { "pool.size": 30 });
  assert.deepEqual(ops, ["restart-api"]);
  assert.equal(labels.length, 3, "invalid steps are skipped");
  assert.equal(stateAfter(pool, held, [act("hotfix")]).api.version, "v61.1");
  assert.equal(stateAfter(pool, held, []).api.version, "v61", "the incident's own changes are part of the starting point");
});

// ---- Assessment ----

const attemptFor = (s: typeof pool, steps: Step[], evidence: string[], confirm: string[], extra: Partial<Attempt> = {}): Attempt => {
  const v = s.variants[0];
  const run = incidentOf(s.id, v.id);
  const ctx = { run, during: incidentWindow(s), before: { from: 0, to: s.timing.faultAtMs }, state: stateAfter(s, v, []) };
  const all = DIAGNOSTICS.flatMap((d) => (!d.needs || d.needs.every((n) => s.features[n]) ? d.run(ctx).findings : []));
  const ev = evidence.map((id) => ({ ...all.find((f) => f.id === id)!, source: "test" }));
  const hypotheses = confirm.map((id) => ({ id, status: "confirmed" as const, evidence: s.hypotheses.find((h) => h.id === id)!.supports.filter((x) => evidence.includes(x)) }));
  const r = verify(s, v, steps, run);
  return { variant: v.id, steps, evidence: ev, hypotheses, hints: 0, diagnostics: [], verifications: [summarize(steps, r)], notes: {}, ...extra };
};

test("completion needs a verified recovery and a root cause confirmed with evidence; opening or clicking is never enough", () => {
  const empty: Attempt = { variant: held.id, steps: [], evidence: [], hypotheses: [], hints: 0, diagnostics: [], verifications: [], notes: {} };
  assert.equal(assess(pool, held, empty).completed, false);
  const fixedOnly = attemptFor(pool, [act("hotfix")], [], []);
  assert.equal(assess(pool, held, fixedOnly).completed, false, "a fix without a confirmed cause");
  const guessed = attemptFor(pool, [act("hotfix")], [], ["held"]);
  assert.equal(assess(pool, held, guessed).completed, false, "confirming without evidence");
  const good = attemptFor(pool, [act("hotfix")], ["pool.exhausted", "latency.pool-wait", "pool.held-during-payment", "db.ok"], ["pool", "held"]);
  const a = assess(pool, held, good);
  assert.equal(a.completed, true, JSON.stringify(a.dimensions));
  assert.ok(a.dimensions.every((d) => d.mark === "met"));
  const wrong = attemptFor(pool, [act("hotfix")], ["pool.exhausted", "pool.held-during-payment", "db.ok", "dependency.payment-ok"], ["held", "provider"]);
  assert.equal(assess(pool, held, wrong).completed, false, "confirming a hypothesis the evidence contradicts");
  const changedAfter = { ...good, steps: [...good.steps, set("pool.size", 12)] };
  assert.equal(assess(pool, held, changedAfter).completed, false, "a change after the last verification must be verified");
  const rollback = attemptFor(pool, [act("rollback")], ["pool.exhausted", "pool.held-during-payment", "db.ok"], ["held"]);
  assert.equal(assess(pool, held, rollback).completed, true, "another valid remediation is accepted");
  assert.equal(assess(pool, held, { ...good, hints: 4 }).assisted, true);
});

test("the postmortem keeps sources apart and reveals the simulator's conclusion only once resolved", () => {
  const good = attemptFor(pool, [act("hotfix")], ["pool.exhausted", "pool.held-during-payment"], ["held"], { notes: { lessons: "Never hold a connection across a network call." } });
  const run = incidentOf(pool.id, held.id);
  const before = postmortem(pool, held, good, run, null, false);
  assert.ok(!before.flatMap((x) => x.entries).some((e) => e.source === "simulator"));
  const after = postmortem(pool, held, good, run, verify(pool, held, good.steps, run), true);
  const entries = after.flatMap((x) => x.entries);
  assert.ok(entries.some((e) => e.source === "simulator" && e.text === held.conclusion));
  assert.ok(entries.some((e) => e.source === "learner" && /network call/.test(e.text)));
  assert.ok(entries.some((e) => e.source === "hypothesis"));
  assert.equal(after.length, 12);
  const md = postmortemMarkdown(pool, after);
  assert.match(md, /# Postmortem: Checkout can't get database connections/);
  assert.match(md, /Verified system evidence/);
  const none = postmortem(pool, held, { ...good, evidence: [], hypotheses: [] }, run, null, false);
  assert.ok(none.find((x) => x.id === "evidence")!.entries[0].text.includes("No evidence"), "it never claims an investigation that didn't happen");
});

// ---- Persistence ----

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("incident progress is bounded, versioned and never written over data it can't read", () => {
  const storage = memory();
  const a = newAttempt("held", "guided");
  assert.equal(startAttempt(storage, pool.id, pool.version, a).saved, true);
  const r = loadIncidents(storage).records[pool.id];
  assert.equal(r.attempts, 1);
  assert.equal(stateOf(r), "in-progress", "started, never completed by being opened");
  assert.equal(saveAttempt(storage, pool.id, pool.version, { ...a, notes: { x: "y".repeat(5000) } }).saved, false, "out-of-bounds data is refused");
  saveAttempt(storage, pool.id, pool.version, { ...a, hints: 2 });
  assert.equal(loadIncidents(storage).records[pool.id].current!.hints, 2);
  finish(storage, pool.id, pool.version, a, false);
  finish(storage, pool.id, pool.version, a, false);
  assert.equal(loadIncidents(storage).records[pool.id].history.length, 1, "one attempt is recorded once");
  assert.equal(stateOf(loadIncidents(storage).records[pool.id]), "completed");
  resetAttempt(storage, pool.id, pool.version);
  assert.equal(stateOf(loadIncidents(storage).records[pool.id]), "completed", "a reset keeps the completion");
  // A damaged record is kept as it is beside the others.
  const raw = JSON.parse(storage.data.get(INCIDENTS_KEY)!);
  raw.incidents["retry-storm"] = { version: 1, nonsense: true };
  storage.data.set(INCIDENTS_KEY, JSON.stringify(raw));
  assert.equal(loadIncidents(storage).status, "partial");
  saveAttempt(storage, pool.id, pool.version, a);
  assert.deepEqual(JSON.parse(storage.data.get(INCIDENTS_KEY)!).incidents["retry-storm"], { version: 1, nonsense: true });
  // A newer store version is never overwritten.
  const newer = memory();
  newer.data.set(INCIDENTS_KEY, JSON.stringify({ version: 2, incidents: {} }));
  assert.equal(saveAttempt(newer, pool.id, pool.version, a).saved, false);
  assert.equal(JSON.parse(newer.data.get(INCIDENTS_KEY)!).version, 2);
  // Storage that throws fails safely.
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadIncidents(broken).status, "unavailable");
  assert.equal(saveAttempt(broken, pool.id, pool.version, a).saved, false);
});

test("incident routes parse, and malformed ids are not found", () => {
  assert.deepEqual(parseRoute("/practice/incidents"), { name: "incidents" });
  for (const s of SCENARIOS) assert.deepEqual(parseRoute(`/practice/incidents/${s.id}`), { name: "incident", id: s.id });
  assert.equal(parseRoute("/practice/incidents/%E0%A4%A").name, "not-found");
  assert.equal(parseRoute("/practice/incidents/a/b").name, "not-found");
});
