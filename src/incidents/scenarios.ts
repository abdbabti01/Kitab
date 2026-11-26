// The incident library: twelve scenarios over one online store. A scenario is data: a starting state, a story of
// changes (a deployment, a key rotation, a slower provider), the controls and actions a learner may use, recovery
// criteria, safety invariants, hypotheses with the findings that support or refute them, hints and links. The
// engine decides what happens; nothing here states an outcome.
import type { Control } from "../architecture/labs/kernel.ts";
import type { TermId } from "../learning/glossary.ts";
import { applyPatch, type ApiBuild, type Builds, type Change, type ChangeKind, type Endpoint, type Features, type Operation, type Patch, type Run, type State } from "./engine.ts";
import { gaugeStats, requestFacts, spanStats, type ComponentId, type Window } from "./telemetry.ts";

export type Difficulty = "guided" | "intermediate" | "advanced";
export type Truth = "root" | "contributing" | "symptom" | "false";
export type Hypothesis = { id: string; text: string; truth: Truth | Record<string, Truth>; supports: string[]; refutes: string[] };
export type IncidentControl = Control & { component: ComponentId; tradeoff?: string };
export type Action = { id: string; label: string; help: string; kind: ChangeKind; patch?: Patch; ops?: Operation[] };
export type Criterion = {
  id: string;
  label: string;
  /** Why this threshold, in this scenario: a teaching objective, not an industry SLO. */
  why: string;
  run: "target" | "stress";
  /** Absolute window in the run; defaults to the scenario's recovery window. */
  window?: [number, number];
  measure: (run: Run, w: Window) => number;
  op: "<=" | ">=";
  threshold: number;
  unit: string;
};
/** Checked from `fromMs` (the moment the learner's changes apply): what happened before is the incident itself. */
export type Invariant = { id: string; label: string; check: (run: Run, state: State, fromMs: number) => { ok: boolean; observed: string } };
export type RootCause = { label: string; fixed: (state: State, builds: Builds) => boolean };
export type Variant = {
  id: string;
  title: string;
  changes: Change[];
  builds?: Record<string, ApiBuild>;
  rootCause: RootCause[];
  keyEvidence: string[];
  conclusion: string;
  stress?: Stress;
};
export type Stress = { label: string; changes: (fixAtMs: number) => Change[] };
export type LearnLink = { kind: "Learn" | "Playground" | "Practice" | "Lab"; label: string; href: string };
export type GuideStep = { question: string; where: "overview" | "metrics" | "logs" | "traces" | "topology" | "changes" | "diagnose" | "fix"; diagnostic?: string };

export type Scenario = {
  id: string;
  version: string;
  number: number;
  title: string;
  family: string;
  difficulty: Difficulty;
  severity: "SEV-1" | "SEV-2" | "SEV-3";
  /** The incident report as the on-call engineer receives it: symptoms only. */
  report: string;
  impact: string;
  affected: ComponentId[];
  components: ComponentId[];
  endpoints: Endpoint[];
  features: Features;
  builds: Builds;
  /** Over the known-good store. */
  baseline: Patch;
  timing: { faultAtMs: number; fixAtMs: number; endMs: number; settleMs: number };
  variants: Variant[];
  stress: Stress;
  controls: IncidentControl[];
  actions: Action[];
  criteria: Criterion[];
  invariants: Invariant[];
  hypotheses: Hypothesis[];
  guide: GuideStep[];
  hints: string[];
  /** For guided mode: the system in a few sentences, before any investigation. */
  architecture: string;
  terms: TermId[];
  learn: LearnLink[];
  prevention: string[];
  limitations: string[];
  seed: number;
};

export const DEFAULT_STATE: State = {
  client: { timeoutMs: 3000, retries: 1, backoffMs: 200 },
  dns: { record: "203.0.113.10", ttlS: 30 },
  gateway: { rateLimit: false, limitRps: 10, burst: 20, keyBy: "api-key" },
  lb: { healthCheck: "readiness", intervalMs: 2000, threshold: 2 },
  api: { version: "v60", replicas: 2, concurrency: 32, queueLimit: 64 },
  pool: { size: 10, acquireTimeoutMs: 1000 },
  db: { maxConnections: 50, cpuSlots: 8, ordersIndex: false },
  cache: { ttlS: 60, saleTtlS: 60, coalescing: false },
  payment: { timeoutMs: 2000, retries: 0, backoff: "exponential-jitter", breaker: false, idempotencyKeys: true },
  auth: { issuer: "https://login.store.example", audience: "https://api.store.example", jwksRefresh: "on-unknown-kid", algs: "RS256", verifySignature: true },
  idp: { registeredRedirects: "finance.example" },
  sso: { redirectUri: "finance.example", sessionS: 40 },
  worker: { version: "w17", concurrency: 8, maxReceives: 5, deadLetter: true },
  env: {
    traffic: { browse: 40, checkout: 20, orders: 0, login: 0, scraper: 0, attack: 0 },
    payment: { latencyMs: 250, capacity: 100, declinePct: 6 },
    fraud: { latencyMs: 400, capacity: 24 },
    idp: { issuer: "https://login.store.example", signingKid: "k1", publishedKids: "k1", tokenLifetimeS: 30 },
    broken: "",
    poisonPct: 0,
    productQueryMs: 30,
    hotPct: 0,
  },
};

const build = (over: Partial<ApiBuild> & { notes: string }): ApiBuild => ({ paymentInTransaction: false, leakOnDecline: false, discountCrash: false, ordersQuery: "by-id", serviceMs: 4, ...over });
const sec = (s: number) => s * 1000;
const change = (atS: number, kind: ChangeKind, label: string, patch?: Patch, visible = true): Change => ({ atMs: sec(atS), kind, label, patch, visible, by: "scenario" });
const features = (on: Partial<Features>): Features => ({ dns: false, cache: false, queue: false, payment: false, auth: false, sso: false, fraud: false, ...on });

// ---- Shared measures for criteria and invariants ----
const errorRate = (endpoint?: Endpoint) => (run: Run, w: Window) => requestFacts(run, w, endpoint).errorRate;
const p95 = (endpoint?: Endpoint) => (run: Run, w: Window) => requestFacts(run, w, endpoint).p95;
const lastWindow = (_run: Run, w: Window, ms: number): Window => ({ from: Math.max(w.from, w.to - ms), to: w.to });
/** Duplicate charges for orders placed after `from`: duplicates of earlier orders were caused before the change. */
const duplicates = (run: Run, from: number) => {
  const started = new Set(run.events.filter((e) => e.type === "request" && e.t >= from).map((e) => e.req));
  return run.events.filter((e) => e.type === "charge" && started.has(e.req)).length;
};
const attackAccepted = (run: Run, from: number) => run.events.filter((e) => e.type === "complete" && !e.legit && e.endpoint === "orders" && e.status === 200 && e.t >= from).length;

const noDuplicateCharges: Invariant = { id: "no-duplicate-charges", label: "No customer is charged twice", check: (run, _s, from) => ({ ok: duplicates(run, from) === 0, observed: `${duplicates(run, from)} duplicate charges for orders placed after your change` }) };
const forgedRejected: Invariant = {
  id: "forged-rejected",
  label: "Forged, algorithm-confused and other-API tokens are rejected",
  check: (run, s, from) => {
    const n = attackAccepted(run, from);
    const risky = !s.auth.verifySignature ? "signature checks are off" : s.auth.algs.includes("HS256") ? "HS256 is allowed beside RS256 (algorithm confusion)" : s.auth.audience === "*" ? "the audience isn't checked" : "";
    return { ok: n === 0 && !risky, observed: n ? `${n} attack requests got 200${risky ? `: ${risky}` : ""}` : risky ? `No attack got through in this run, but ${risky}` : "Every attack request got 401" };
  },
};

const RECOVERY_WHY = "Scenario teaching objective for this store's checkout, set from the model's healthy baseline; not an industry SLO.";

// ---- Controls reused by several scenarios ----
const c = {
  poolSize: { id: "pool.size", component: "store-api", type: "number", label: "Connection pool size per instance", help: "How many database connections each API instance may hold open.", min: 2, max: 40, step: 1, unit: "connections", tradeoff: "Every instance's pool counts against the database's connection limit." } as IncidentControl,
  acquireTimeout: { id: "pool.acquireTimeoutMs", component: "store-api", type: "number", label: "Pool acquire timeout", help: "How long a request waits for a free connection before failing.", min: 250, max: 5000, step: 250, unit: "ms", tradeoff: "Longer waits turn errors into slow requests; they don't add capacity." } as IncidentControl,
  replicas: { id: "api.replicas", component: "store-api", type: "number", label: "API instances", help: "How many store-api instances run behind the gateway. New ones take 3 s to start.", min: 1, max: 6, step: 1, tradeoff: "More instances means more pools and more database connections." } as IncidentControl,
  concurrency: { id: "api.concurrency", component: "store-api", type: "number", label: "Worker threads per instance", help: "Requests each instance works on at once; more wait in a bounded queue.", min: 8, max: 64, step: 8, unit: "threads" } as IncidentControl,
  clientRetries: { id: "client.retries", component: "browser", type: "number", label: "Client retries", help: "How many times the store's web and mobile clients retry a failed request (with backoff).", min: 0, max: 3, step: 1, tradeoff: "Each retry is another request to an already struggling system." } as IncidentControl,
  payTimeout: { id: "payment.timeoutMs", component: "store-api", type: "number", label: "Payment call timeout", help: "How long the API waits for each charge attempt.", min: 500, max: 10_000, step: 250, unit: "ms", tradeoff: "Too short fails charges that would have succeeded; too long holds threads (and connections) while the provider is slow." } as IncidentControl,
  payRetries: { id: "payment.retries", component: "store-api", type: "number", label: "Payment retries", help: "Extra attempts after a timeout or 503 from the provider.", min: 0, max: 3, step: 1, tradeoff: "Retries multiply the load on a provider that is already slow; without idempotency keys a retry can charge twice." } as IncidentControl,
  backoff: { id: "payment.backoff", component: "store-api", type: "select", label: "Payment retry backoff", help: "When a retry is sent.", options: [{ value: "none", label: "Immediately" }, { value: "exponential-jitter", label: "Exponential backoff with full jitter" }] } as IncidentControl,
  breaker: { id: "payment.breaker", component: "store-api", type: "toggle", label: "Circuit breaker on payment calls", help: "After half of the last 20 calls fail (at least 10), fail fast for 5 s, then let one trial call through.", tradeoff: "While open, checkouts fail immediately instead of waiting." } as IncidentControl,
  idempotency: { id: "payment.idempotencyKeys", component: "store-api", type: "toggle", label: "Idempotency keys on charges", help: "Send the order id as an idempotency key, so the provider charges a retried request only once." } as IncidentControl,
};

const store: ComponentId[] = ["browser", "gateway", "store-api", "redis", "postgres", "payment-provider"];
const sd = (unit: string, concept: string, label: string): LearnLink => ({ kind: "Learn", label, href: `/learn/system-design/${unit}#${concept}` });
const idu = (unit: string, label: string): LearnLink => ({ kind: "Learn", label, href: `/learn/identity/${unit}` });
const lab = (subject: string, id: string, label: string): LearnLink => ({ kind: "Lab", label, href: `/lab/${subject}/${id}` });
const archLab = (id: string, label: string): LearnLink => ({ kind: "Practice", label, href: `/practice/architecture/labs/${id}` });

const commonLimits = [
  "Every duration is a modelled number (fixed costs with seeded variation), not a measurement of Postgres, Redis, a payment provider or a network.",
  "One run covers 80 to 100 simulated seconds; token lifetimes, sessions and TTLs are compressed to fit.",
  "Request arrivals are seeded random (Poisson); the same seed gives the same requests, ids and traces in every run.",
];

// ---------------------------------------------------------------------------------------------------------------
// 1. Database connection pool exhaustion: the flagship.
const poolBuilds: Builds = {
  api: {
    v60: build({ notes: "Charges the card after committing the order (two short transactions)." }),
    v61: build({ paymentInTransaction: true, notes: "Charges the card inside the order's transaction 'so the order and the charge commit together'." }),
    "v61.1": build({ notes: "v61's features, with the charge moved back outside the transaction (and every connection released in a finally block)." }),
    "v61-leak": build({ leakOnDecline: true, notes: "Adds a declined-card path that returns 402 before releasing its connection." }),
  },
  worker: { w17: { fraudCheck: false, notes: "" } },
};
const poolExhaustion: Scenario = {
  id: "db-pool-exhaustion",
  version: "1",
  number: 1,
  title: "Checkout can't get database connections",
  family: "Database connection pool exhaustion",
  difficulty: "guided",
  severity: "SEV-2",
  report: "Checkout failures have increased. Customers are unable to complete purchases; some say the page spins for seconds first.",
  impact: "Customers can't pay; product pages are also slower.",
  affected: ["store-api", "postgres"],
  components: store,
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: poolBuilds,
  baseline: { "env.traffic.checkout": 60, "env.traffic.browse": 40, "api.concurrency": 64, "api.queueLimit": 128, "env.payment.declinePct": 3 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [
    {
      id: "held",
      title: "Connections held during the payment call",
      changes: [change(10, "deploy", "Deploy store-api v61: charge inside the order transaction", { "api.version": "v61" }), change(18, "traffic", "Evening promotion email sent: checkout traffic rises", { "env.traffic.checkout": 80 })],
      rootCause: [{ label: "The payment call no longer runs while a database connection is held", fixed: (s, b) => !b.api[s.api.version]?.paymentInTransaction }],
      keyEvidence: ["pool.exhausted", "latency.pool-wait", "pool.held-during-payment", "db.ok"],
      conclusion: "v61 moved the card charge inside the order's database transaction. Each checkout now holds its connection for the whole provider call (about 250 ms instead of about 10 ms), so the 10-connection pools fill up: requests queue for a connection, latency rises, and after 1 s of waiting they fail with POOL_TIMEOUT. The database itself is mostly idle: the connections are held, not working.",
    },
    {
      id: "leak",
      title: "Connections leaked on the declined-card path",
      changes: [change(10, "deploy", "Deploy store-api v61: new declined-card handling", { "api.version": "v61-leak" })],
      rootCause: [{ label: "Every connection is returned to the pool, on every path", fixed: (s, b) => !b.api[s.api.version]?.leakOnDecline }],
      keyEvidence: ["pool.exhausted", "pool.leak", "latency.pool-wait", "db.ok"],
      conclusion: "v61's declined-card path returns 402 before releasing its connection. About 6% of checkouts are declined, so each instance loses a connection every second or so; the pool's in-use count only ever rises, until it is full and every request waits, then fails. A restart closes the leaked connections and the pool drains again; a bigger pool only delays it.",
    },
  ],
  stress: { label: "Busier evening: checkout traffic 90/s and the provider 450 ms slower", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more checkouts, slower provider", patch: { "env.traffic.checkout": 90, "env.payment.latencyMs": 450 }, visible: false, by: "scenario" }] },
  controls: [c.poolSize, c.acquireTimeout, c.replicas, c.concurrency, c.clientRetries],
  actions: [
    { id: "rollback", label: "Roll back to v60", help: "Redeploy the previous version (rolling, one instance every 2.5 s).", kind: "deploy", patch: { "api.version": "v60" } },
    { id: "hotfix", label: "Deploy hotfix v61.1", help: "v61's features with the charge outside the transaction and connections released in finally blocks.", kind: "deploy", patch: { "api.version": "v61.1" } },
    { id: "restart", label: "Rolling restart", help: "Restart every instance on its current version, one every 2.5 s. Closes their connections.", kind: "operation", ops: ["restart-api"] },
  ],
  criteria: [
    { id: "errors", label: "Checkout error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("checkout"), op: "<=", threshold: 1, unit: "%" },
    { id: "p95", label: "Checkout p95 ≤ 800 ms", why: RECOVERY_WHY, run: "target", measure: p95("checkout"), op: "<=", threshold: 800, unit: "ms" },
    { id: "waiting", label: "No requests waiting for a connection in the last 10 s", why: "A queue for connections that never empties means the pool is still the bottleneck.", run: "target", measure: (r, w) => gaugeStats(r, lastWindow(r, w, 10_000), "pool.waiting").max, op: "<=", threshold: 2, unit: "requests" },
    { id: "leak", label: "No connections leaked after the fix", why: "A pool that loses connections will run dry again, however large it is.", run: "target", measure: (r, w) => gaugeStats(r, w, "pool.leaked").last - gaugeStats(r, w, "pool.leaked").first, op: "<=", threshold: 0, unit: "connections" },
    { id: "stress-errors", label: "Under stress: checkout error rate ≤ 2%", why: "The fix should hold on a busier day, not only today.", run: "stress", measure: errorRate("checkout"), op: "<=", threshold: 2, unit: "%" },
  ],
  invariants: [
    noDuplicateCharges,
    { id: "db-connections", label: "The database never refuses connections", check: (run, _s, from) => { const n = run.spans.filter((s) => s.error?.code === "DB_TOO_MANY_CLIENTS" && s.end >= from).length; return { ok: n === 0, observed: n ? `${n} connection attempts refused: "too many clients"` : "No connection refused" }; } },
  ],
  hypotheses: [
    { id: "pool", text: "Checkout requests wait for database connections: the pool is exhausted", truth: "symptom", supports: ["pool.exhausted", "latency.pool-wait"], refutes: ["pool.ok"] },
    { id: "held", text: "v61 holds each database connection while it waits for the payment provider", truth: { held: "root", leak: "false" }, supports: ["pool.held-during-payment"], refutes: ["pool.not-held"] },
    { id: "leak", text: "v61 doesn't return some connections to the pool (a connection leak)", truth: { held: "false", leak: "root" }, supports: ["pool.leak"], refutes: ["pool.no-leak"] },
    { id: "db-cpu", text: "The database is overloaded and queries are slow", truth: "false", supports: ["db.saturated", "dependency.database-degraded"], refutes: ["db.ok", "dependency.database-ok"] },
    { id: "provider", text: "The payment provider got slower", truth: "false", supports: ["dependency.payment-degraded"], refutes: ["dependency.payment-ok"] },
    { id: "traffic", text: "More checkouts than the store can handle (the promotion)", truth: { held: "contributing", leak: "false" }, supports: ["change.traffic-correlates"], refutes: [] },
  ],
  guide: [
    { question: "Which requests fail, and with what?", where: "diagnose", diagnostic: "status-codes" },
    { question: "Where does a failed checkout spend its time?", where: "traces", diagnostic: "slow-traces" },
    { question: "How many requests wait for a database connection?", where: "diagnose", diagnostic: "pool" },
    { question: "Is the database itself busy?", where: "diagnose", diagnostic: "database" },
    { question: "What changed just before the symptoms?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "Which dependency is contributing most to checkout latency? Compare the error codes first: they say where a request gave up.",
    "Inspect a failed checkout trace. Which span takes the most time: the query, or something before it?",
    "Look at the database connection pool: how many connections are in use, and how many requests are waiting? Then check whether the database itself is busy.",
    "The pool is full while the database is mostly idle: connections are held, not used. Compare what a checkout does while it holds one in v60 and in v61 (and whether every one comes back). Roll back or deploy the hotfix, then verify under stress.",
  ],
  architecture: "Customers' browsers call the gateway, which spreads requests over two store-api instances. Each instance keeps a pool of 10 database connections. A product page reads Redis and, on a miss, the database. A checkout writes the order to Postgres and charges the card at an external payment provider.",
  terms: ["pool", "latency", "saturation", "queue", "span", "trace", "correlationId", "slo", "rollback"],
  learn: [sd("performance", "connection-pooling", "Connection pools"), sd("performance", "littles-law", "Little's law"), sd("performance", "tail-latency", "Tail latency"), sd("resilience", "timeouts-deadlines", "Timeouts and deadlines"), { kind: "Playground", label: "Architecture Playground: find the bottleneck", href: "/practice/architecture" }, lab("architecture", "capacity", "Lab: capacity and queueing in real code")],
  prevention: ["Never hold a database connection across a network call to another service", "Release connections in finally blocks (or a using/try-with-resources scope) and enable pool leak detection", "Alert on pool waiters and acquire time, not only on errors", "Load-test new versions at peak traffic before full rollout"],
  limitations: [...commonLimits, "The pool opens connections lazily and never closes idle ones. The database's CPU slots and contention are a declared model, not Postgres internals. Row locks held by an open transaction aren't modelled."],
  seed: 61,
};

// ---------------------------------------------------------------------------------------------------------------
// 2. Cache stampede.
const stampede: Scenario = {
  id: "cache-stampede",
  version: "1",
  number: 2,
  title: "Product pages slow down in waves",
  family: "Cache stampede",
  difficulty: "intermediate",
  severity: "SEV-2",
  report: "During the flash sale, product pages are slow every few seconds, then fine, then slow again. Some time out.",
  impact: "Shoppers see spinning product pages at the start of the sale.",
  affected: ["store-api", "postgres", "redis"],
  components: store.filter((x) => x !== "payment-provider"),
  endpoints: ["browse"],
  features: features({ cache: true }),
  builds: { api: { v60: build({ notes: "Product pages are cache-aside: read Redis, on a miss build the page from Postgres and store it." }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "env.traffic.browse": 180, "env.traffic.checkout": 0, "env.productQueryMs": 400, "api.replicas": 3, "cache.ttlS": 300 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "ttl",
    title: "A short TTL turns every expiry into a miss storm",
    changes: [change(10, "config", "Flash sale: sale product's cache TTL 60 s → 8 s so its price is at most 10 s stale", { "cache.saleTtlS": 8 }), change(10, "traffic", "Flash sale starts: most shoppers open the sale product", { "env.hotPct": 70 })],
    rootCause: [{ label: "Concurrent misses for one product share a single database read (request coalescing)", fixed: (s) => s.cache.coalescing }],
    keyEvidence: ["cache.stampede", "config.short-ttl", "change.config-correlates", "dependency.database-degraded"],
    conclusion: "With an 8 s TTL the sale product's entry expires every 8 s. It gets about 125 requests a second, so dozens arrive during the 400 ms it takes to rebuild its page, and every one of them misses and queries the database: a stampede. The database's 8 CPU slots fill, queries get slower, so even more requests miss during each rebuild. The freshness requirement (≤ 10 s) rules out simply raising the TTL; request coalescing lets one request per instance rebuild an entry while the others wait for it.",
  }],
  stress: { label: "Sale peak: 260 product-page requests per second", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: sale peak", patch: { "env.traffic.browse": 260 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "cache.saleTtlS", component: "redis", type: "select", label: "Sale product cache TTL", help: "How long the sale product's page stays in Redis.", options: [5, 8, 10, 15, 30, 60, 300].map((v) => ({ value: String(v), label: `${v} s` })), tradeoff: "Longer TTLs mean fewer misses and older prices." } as IncidentControl,
    { id: "cache.ttlS", component: "redis", type: "select", label: "Catalogue cache TTL", help: "How long every other product page stays in Redis.", options: [10, 30, 60, 300, 3600].map((v) => ({ value: String(v), label: `${v} s` })) } as IncidentControl,
    { id: "cache.coalescing", component: "store-api", type: "toggle", label: "Request coalescing (single flight)", help: "On a miss, the first request for a key rebuilds it; later misses for the same key on that instance wait for its result.", tradeoff: "Waiting requests depend on the leader: if its query fails, they fail too." } as IncidentControl,
    { id: "db.cpuSlots", component: "postgres", type: "select", label: "Database size (CPU slots)", help: "A bigger database runs more queries at once.", options: ["8", "16", "32"].map((v) => ({ value: v, label: `${v} slots` })), tradeoff: "Costs more every month; the misses still happen." } as IncidentControl,
    c.poolSize, c.replicas,
  ],
  actions: [],
  criteria: [
    { id: "errors", label: "Product-page error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("browse"), op: "<=", threshold: 1, unit: "%" },
    { id: "p95", label: "Product-page p95 ≤ 200 ms", why: RECOVERY_WHY, run: "target", measure: p95("browse"), op: "<=", threshold: 200, unit: "ms" },
    { id: "stress-p95", label: "Under stress: product-page p95 ≤ 250 ms", why: "The sale peak is the reason the store exists this week.", run: "stress", measure: p95("browse"), op: "<=", threshold: 250, unit: "ms" },
  ],
  invariants: [{
    id: "fresh-prices",
    label: "No price shown more than 10 s after it changed (the sale's freshness requirement)",
    check: (run, _s, from) => {
      const stale = run.spans.filter((s) => s.attrs.stale === true && s.end >= from).map((s) => Number(s.attrs.staleMs));
      const worst = stale.length ? Math.max(...stale) : 0;
      return { ok: worst <= 10_000, observed: stale.length ? `${stale.length} stale responses, the oldest ${Math.round(worst / 1000)} s behind the price` : "No stale price served" };
    },
  }],
  hypotheses: [
    { id: "stampede", text: "Each expiry sends many simultaneous misses for the same product to the database (a cache stampede)", truth: "root", supports: ["cache.stampede", "cache.hit-rate-drop"], refutes: ["cache.ok"] },
    { id: "db-small", text: "The database is too small for sale traffic", truth: "symptom", supports: ["db.saturated"], refutes: ["db.ok"] },
    { id: "redis-down", text: "Redis is failing or slow", truth: "false", supports: ["dependency.cache-degraded"], refutes: ["dependency.cache-ok"] },
    { id: "pool", text: "The connection pool is too small", truth: "symptom", supports: ["pool.exhausted"], refutes: ["pool.ok"] },
    { id: "ttl-change", text: "The TTL change made entries expire much more often", truth: "contributing", supports: ["change.config-correlates", "config.short-ttl"], refutes: [] },
  ],
  guide: [
    { question: "What does the latency look like over time?", where: "metrics" },
    { question: "How often does the cache answer?", where: "diagnose", diagnostic: "cache" },
    { question: "Is the database busy, and with which query?", where: "diagnose", diagnostic: "database" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "The latency comes in waves. What happens every few seconds in a cache?",
    "Check the cache: what is the hit rate, and how many database reads for the same product start at the same moment?",
    "Many requests rebuild the same entry at once. The sale needs fresh prices, so a long TTL is not allowed: how can one request rebuild an entry while the others wait?",
    "Turn on request coalescing and keep the TTL at 10 s or less, then verify under the sale peak.",
  ],
  architecture: "Three store-api instances serve product pages cache-aside: they read Redis first and, on a miss, build the page from Postgres (about 400 ms of database work, with reviews and live stock) and store it. Catalogue pages stay cached for 5 minutes; during the sale the sale product has its own TTL.",
  terms: ["cacheHit", "stampede", "ttl", "saturation", "latency"],
  learn: [sd("performance", "cache-stampede", "Cache stampedes"), sd("performance", "caching-strategies", "Caching strategies"), sd("performance", "cache-invalidation", "Cache invalidation"), archLab("cache-stampede", "Lab: stop a cache stampede"), lab("architecture", "caching", "Lab: caching in real code")],
  prevention: ["Coalesce concurrent misses (single flight) for expensive entries", "Add jitter to TTLs so popular keys don't expire together", "Refresh hot entries early (stale-while-revalidate) when the freshness budget allows", "Load-test configuration changes, not only code"],
  limitations: [...commonLimits, "Coalescing is per instance (three instances can still rebuild one key three times). Prices change every 20 s per product on a fixed schedule; no cache invalidation on price change is modelled."],
  seed: 33,
};

// ---------------------------------------------------------------------------------------------------------------
// 3. Retry storm.
const retryBuilds: Builds = { api: { v60: build({ notes: "Charges with the payments SDK's settings from config." }) }, worker: { w17: { fraudCheck: false, notes: "" } } };
const retryStorm: Scenario = {
  id: "retry-storm",
  version: "1",
  number: 3,
  title: "Checkout stays down after the provider recovered",
  family: "Retry storm",
  difficulty: "intermediate",
  severity: "SEV-1",
  report: "Checkout has been failing for twenty minutes. The payment provider says its incident is resolved, but nothing has improved on our side.",
  impact: "No checkout succeeds; product pages fail too.",
  affected: ["store-api", "payment-provider"],
  components: store,
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: retryBuilds,
  baseline: { "env.traffic.checkout": 50, "env.traffic.browse": 30, "env.payment.capacity": 40, "env.payment.latencyMs": 300, "payment.timeoutMs": 1000, "payment.retries": 3, "payment.backoff": "none", "payment.idempotencyKeys": false, "api.replicas": 3, "api.concurrency": 64, "api.queueLimit": 128, "client.retries": 0 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "storm",
    title: "Immediate retries keep an overloaded provider overloaded",
    changes: [change(10, "dependency", "Payment provider status: investigating elevated latency", { "env.payment.latencyMs": 1500 }), change(20, "dependency", "Payment provider status: resolved", { "env.payment.latencyMs": 300 })],
    rootCause: [{ label: "Retries are bounded and spread out (backoff with jitter, at most 2 retries, or a circuit breaker)", fixed: (s) => s.payment.breaker || s.payment.retries === 0 || (s.payment.backoff === "exponential-jitter" && s.payment.retries <= 2) }],
    keyEvidence: ["retries.amplified", "latency.payment", "config.immediate-retries", "change.dependency-correlates"],
    conclusion: "For ten seconds the provider took 1.5 s per charge, longer than the store's 1 s timeout. Every timed-out charge was retried at once, three times, so the provider received about four calls per checkout and its queue grew. When its own problem ended, it was still working through that queue: each new call waited behind it, timed out and was retried again. The store's retries, not the provider, kept the outage going (a metastable failure). Without idempotency keys, some customers were also charged twice.",
  }],
  stress: { label: "Another 8-second provider slowdown right after your fix", changes: (t) => [
    { atMs: t + sec(3), kind: "dependency", label: "Stress: provider slow again", patch: { "env.payment.latencyMs": 1500 }, visible: false, by: "scenario" },
    { atMs: t + sec(11), kind: "dependency", label: "Stress: provider recovers", patch: { "env.payment.latencyMs": 300 }, visible: false, by: "scenario" },
  ] },
  controls: [c.payRetries, c.backoff, c.payTimeout, c.breaker, c.idempotency, c.clientRetries, c.replicas],
  actions: [],
  criteria: [
    { id: "errors", label: "Checkout error rate ≤ 2%", why: RECOVERY_WHY, run: "target", measure: errorRate("checkout"), op: "<=", threshold: 2, unit: "%" },
    { id: "browse", label: "Product-page error rate ≤ 1%", why: "Pages that never call the provider should never fail because of it.", run: "target", measure: errorRate("browse"), op: "<=", threshold: 1, unit: "%" },
    { id: "amplification", label: "At most 1.3 provider calls per charge", why: "More than that means retries, not customers, are the provider's load.", run: "target", measure: (r, w) => { const calls = r.spans.filter((s) => s.name === "POST /v1/charges" && s.end >= w.from && s.end < w.to).length; const charges = r.spans.filter((s) => s.name === "payment.charge" && s.end >= w.from && s.end < w.to).length; return charges ? calls / charges : 0; }, op: "<=", threshold: 1.3, unit: "calls" },
    { id: "stress-recovers", label: "Under stress: checkout error rate ≤ 2% in the last 12 s", why: "A healthy system recovers on its own when the slowdown ends.", run: "stress", window: [sec(68), sec(80)], measure: errorRate("checkout"), op: "<=", threshold: 2, unit: "%" },
  ],
  invariants: [noDuplicateCharges],
  hypotheses: [
    { id: "provider", text: "The payment provider is still down", truth: "false", supports: [], refutes: ["change.dependency-correlates"] },
    { id: "retries", text: "Our immediate retries keep the provider overloaded (a retry storm)", truth: "root", supports: ["retries.amplified", "config.immediate-retries"], refutes: ["retries.low"] },
    { id: "threads", text: "API threads are all busy waiting on payment calls, so product pages fail too", truth: "symptom", supports: ["threads.exhausted", "browse.collateral"], refutes: ["threads.ok"] },
    { id: "db", text: "The database is the bottleneck", truth: "false", supports: ["db.saturated", "pool.exhausted"], refutes: ["db.ok", "pool.ok"] },
    { id: "idempotency", text: "Retries without idempotency keys charge some customers twice", truth: "contributing", supports: ["charges.duplicate", "config.retries-without-idempotency"], refutes: [] },
  ],
  guide: [
    { question: "Did things improve when the provider recovered?", where: "metrics" },
    { question: "How many provider calls does one checkout make?", where: "diagnose", diagnostic: "retries" },
    { question: "Why do product pages fail?", where: "diagnose", diagnostic: "saturation" },
    { question: "What are the payment timeout and retry settings?", where: "diagnose", diagnostic: "config" },
  ],
  hints: [
    "The provider recovered at 0:20. Compare the payment-call rate with the checkout rate after that.",
    "Measure retry amplification: how many calls reach the provider for each checkout?",
    "Every timeout is retried immediately, three times. What does that do to a provider that is still draining its queue?",
    "Cut the amplification: fewer retries, exponential backoff with jitter, or a circuit breaker. If you keep any retries, turn on idempotency keys. Verify under the stress slowdown.",
  ],
  architecture: "Checkouts charge the card at an external payment provider, with the payments SDK's timeout and retry settings. The provider processes up to 40 charges at once and queues the rest; it keeps working on a charge even after the store stops waiting for it.",
  terms: ["retryAmplification", "backoff", "breaker", "idempotency", "timeout"],
  learn: [sd("resilience", "retry-storms", "Retry storms"), sd("resilience", "backoff-jitter", "Backoff and jitter"), sd("resilience", "circuit-breakers", "Circuit breakers"), sd("idempotency", "idempotency-keys", "Idempotency keys"), archLab("retry-storm", "Lab: tame a retry storm"), lab("architecture", "retries-timeouts", "Lab: real retries and timeouts over HTTP")],
  prevention: ["Retry with exponential backoff and jitter, under a retry budget", "Put a circuit breaker on calls to third parties", "Send idempotency keys on every retried write", "Alert on calls-per-request to a dependency"],
  limitations: [...commonLimits, "The provider is a queue with fixed capacity and seeded latency; it never sheds load below 1,500 queued calls."],
  seed: 3,
};

// ---------------------------------------------------------------------------------------------------------------
// 4. Unhealthy instance behind a liveness check.
const unhealthy: Scenario = {
  id: "unhealthy-instance",
  version: "1",
  number: 4,
  title: "One in three requests fails",
  family: "Load balancer and an unhealthy instance",
  difficulty: "guided",
  severity: "SEV-2",
  report: "About a third of page loads and checkouts fail with a 500 error. Refreshing usually works.",
  impact: "Random failures for every customer; retries mostly succeed.",
  affected: ["gateway", "store-api"],
  components: store,
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: { api: { v60: build({ notes: "" }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "api.replicas": 3, "lb.healthCheck": "liveness", "client.retries": 0, "env.traffic.browse": 60, "env.traffic.checkout": 30 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "disk",
    title: "A full disk on one instance, routed to by a liveness check",
    changes: [change(10, "infrastructure", "api-3's node: disk fills up", { "env.broken": "3" }, false)],
    rootCause: [{ label: "The gateway routes only to instances that pass a readiness check", fixed: (s) => s.lb.healthCheck === "readiness" }],
    keyEvidence: ["instance.one-bad", "config.liveness-routing", "errors.5xx"],
    conclusion: "api-3's disk filled up, so it can't load its pricing config and answers every request with 500 in 3 ms. Its process is still running, so GET /healthz (liveness) keeps passing and the gateway keeps sending it a third of the traffic. A readiness check (GET /ready, which checks the instance can serve) takes it out of rotation after two failed checks; replacing the instance restores capacity.",
  }],
  stress: { label: "A second instance (api-1) breaks the same way after your fix", changes: (t) => [{ atMs: t + sec(5), kind: "infrastructure", label: "Stress: api-1's disk fills up", patch: { "env.broken": "3,1" }, visible: false, by: "scenario" }] },
  controls: [
    { id: "lb.healthCheck", component: "gateway", type: "select", label: "Health check the gateway routes by", help: "liveness: GET /healthz, is the process running? readiness: GET /ready, can it serve requests (config loaded, dependencies reachable)?", options: [{ value: "liveness", label: "Liveness (/healthz)" }, { value: "readiness", label: "Readiness (/ready)" }] } as IncidentControl,
    { id: "lb.intervalMs", component: "gateway", type: "number", label: "Health-check interval", help: "How often the gateway checks each instance.", min: 500, max: 10_000, step: 500, unit: "ms", tradeoff: "Frequent checks detect failures sooner and cost a little load." } as IncidentControl,
    { id: "lb.threshold", component: "gateway", type: "number", label: "Failures before removal", help: "Consecutive failed checks before an instance leaves rotation (and passes before it returns).", min: 1, max: 5, step: 1, tradeoff: "1 reacts fastest but flaps on a single slow check." } as IncidentControl,
    c.replicas, c.clientRetries,
  ],
  actions: [
    { id: "replace", label: "Replace the broken instance", help: "Terminate every instance that is failing and start a fresh one in its place (3 s to boot).", kind: "operation", ops: ["replace-broken"] },
    { id: "restart", label: "Rolling restart", help: "Restart every instance on its current version.", kind: "operation", ops: ["restart-api"] },
  ],
  criteria: [
    { id: "errors", label: "Error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: error rate ≤ 2% after the second failure", why: "Instances will keep failing; routing must route around them.", run: "stress", window: [sec(55), sec(80)], measure: errorRate(), op: "<=", threshold: 2, unit: "%" },
  ],
  invariants: [],
  hypotheses: [
    { id: "instance", text: "One instance is broken and still receives traffic", truth: "symptom", supports: ["instance.one-bad"], refutes: ["instance.even"] },
    { id: "health", text: "The gateway's health check can't tell that the instance can't serve", truth: "root", supports: ["config.liveness-routing", "instance.one-bad"], refutes: [] },
    { id: "deploy", text: "A bad deployment", truth: "false", supports: ["change.deploy-correlates", "instance.mixed-versions"], refutes: ["change.none-correlates"] },
    { id: "db", text: "The database is failing", truth: "false", supports: ["db.saturated", "dependency.database-degraded"], refutes: ["db.ok", "dependency.database-ok"] },
  ],
  guide: [
    { question: "Do all instances fail alike?", where: "diagnose", diagnostic: "instances" },
    { question: "What do the failing instance's logs say?", where: "logs" },
    { question: "Why does the gateway still send it traffic?", where: "diagnose", diagnostic: "config" },
  ],
  hints: [
    "A third of requests fail, with three instances. Compare the instances.",
    "api-3 fails nearly every request, the others almost none. Is the gateway's health check failing for it?",
    "A liveness check only asks whether the process runs. What should the gateway ask before sending a request?",
    "Route by readiness so failing instances leave rotation, and replace api-3. Verify while a second instance fails.",
  ],
  architecture: "The gateway sends requests round-robin to three store-api instances, checking each one every 2 s. An instance that fails two checks in a row leaves rotation until it passes two again.",
  terms: ["healthCheck", "partialFailure"],
  learn: [sd("consistency", "partial-failure", "Partial failure"), sd("coordination", "failure-detection", "Failure detection"), sd("production", "observability", "Observability"), { kind: "Playground", label: "Architecture Playground: fail a server behind a load balancer", href: "/practice/architecture" }],
  prevention: ["Route by readiness, restart by liveness", "Alert on per-instance error rates", "Monitor disk space; ship logs off the node", "Replace unhealthy instances automatically"],
  limitations: [...commonLimits, "Health checks bypass the request queue and are never slow; a readiness check here only knows whether the instance's local state is broken."],
  seed: 4,
};

// ---------------------------------------------------------------------------------------------------------------
// 5. DNS misconfiguration.
const dnsFailure: Scenario = {
  id: "dns-misconfiguration",
  version: "1",
  number: 5,
  title: "The store doesn't load for more and more people",
  family: "DNS and network configuration",
  difficulty: "intermediate",
  severity: "SEV-1",
  report: "Customers say the site never loads; it just spins and gives up. Our servers show no errors at all.",
  impact: "A growing share of customers can't reach the store.",
  affected: ["dns", "browser"],
  components: ["browser", "dns", "gateway", "store-api", "redis", "postgres", "payment-provider"],
  endpoints: ["browse", "checkout"],
  features: features({ dns: true, cache: true, payment: true }),
  builds: { api: { v60: build({ notes: "" }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "env.traffic.browse": 50, "env.traffic.checkout": 20, "client.timeoutMs": 2500 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(100), settleMs: sec(35) },
  variants: [{
    id: "typo",
    title: "A mistyped A record",
    changes: [change(10, "config", "DNS: api.store.example A record updated for the gateway migration", { "dns.record": "203.0.113.100" })],
    rootCause: [{ label: "api.store.example points at the gateway (203.0.113.10)", fixed: (s) => s.dns.record === "203.0.113.10" }],
    keyEvidence: ["dns.wrong-answer", "dns.traffic-drop", "errors.no-response", "latency.connect"],
    conclusion: "During the gateway migration api.store.example's A record was entered as 203.0.113.100 instead of 203.0.113.10. Nothing listens there, so clients that resolve the new record wait for a connection until they time out. Resolvers had cached the correct answer for up to 30 s, so failures grew as their caches expired, and the servers saw less traffic, not more errors. After the record is corrected, resolvers holding the wrong answer keep it until their cached TTL ends: recovery takes up to one TTL.",
  }],
  stress: { label: "Busier: 1.5× traffic after your fix", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more traffic", patch: { "env.traffic.browse": 75, "env.traffic.checkout": 30 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "dns.record", component: "dns", type: "select", label: "api.store.example A record", help: "The address resolvers hand to customers. The gateway's address is 203.0.113.10.", options: [{ value: "203.0.113.10", label: "203.0.113.10" }, { value: "203.0.113.100", label: "203.0.113.100" }] } as IncidentControl,
    { id: "dns.ttlS", component: "dns", type: "select", label: "Record TTL", help: "How long resolvers may cache the answer. Applies to answers given from now on.", options: [5, 30, 300].map((v) => ({ value: String(v), label: `${v} s` })), tradeoff: "Short TTLs make changes (and fixes) take effect sooner, at the cost of more lookups." } as IncidentControl,
    c.clientRetries,
    { id: "client.timeoutMs", component: "browser", type: "number", label: "Client timeout", help: "How long clients wait for an answer.", min: 500, max: 10_000, step: 500, unit: "ms" } as IncidentControl,
  ],
  actions: [],
  criteria: [
    { id: "errors", label: "Error rate ≤ 1% once cached answers expire", why: "Resolvers may keep a wrong answer for one TTL after a fix; the window starts 35 s after it.", run: "target", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: error rate ≤ 1%", why: RECOVERY_WHY, run: "stress", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
  ],
  invariants: [],
  hypotheses: [
    { id: "dns", text: "Customers are given the wrong address for the API", truth: "root", supports: ["dns.wrong-answer", "dns.traffic-drop", "latency.connect"], refutes: ["dns.ok"] },
    { id: "servers", text: "Our servers are overloaded", truth: "false", supports: ["threads.exhausted", "db.saturated"], refutes: ["threads.ok", "db.ok"] },
    { id: "cdn", text: "The gateway is rejecting requests", truth: "false", supports: ["errors.5xx", "errors.429"], refutes: [] },
    { id: "timeouts", text: "Client timeouts are too short", truth: "false", supports: [], refutes: ["latency.connect"] },
  ],
  guide: [
    { question: "What do customers' browsers report?", where: "logs" },
    { question: "Do the servers see the same traffic as before?", where: "metrics" },
    { question: "What address do resolvers return?", where: "diagnose", diagnostic: "dns" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "The servers show no errors. Compare what browsers report with what reaches the gateway.",
    "Failed requests never reached any server: they couldn't connect. Where does a browser get the address it connects to?",
    "Query the resolvers. Compare their answer with the gateway's address.",
    "Correct the A record. Resolvers that cached the wrong answer keep it until their TTL expires, so wait one TTL before judging the fix.",
  ],
  architecture: "Browsers look up api.store.example through public DNS resolvers, which cache the answer for the record's TTL, then connect to that address. The gateway listens on 203.0.113.10.",
  terms: ["dns", "ttl", "rum", "correlationId"],
  learn: [{ kind: "Learn", label: "How DNS turns a name into an address", href: "/concepts/dns" }, { kind: "Playground", label: "Network Playground: a request across the Internet, with DNS", href: "/practice/network?starter=internet" }, lab("networking", "dns-resolver", "Lab: resolve names with real DNS-over-HTTPS")],
  prevention: ["Lower the TTL well before a planned migration", "Validate DNS changes against the target (a synthetic check) before and after applying them", "Monitor from outside: synthetic checks and real-user monitoring see what server logs can't"],
  limitations: [...commonLimits, "Ten resolver groups stand for every customer's resolver; no negative caching, no TCP handshake or packet is simulated: a connection attempt to an address nothing answers on simply waits until the client gives up."],
  seed: 5,
};

// ---------------------------------------------------------------------------------------------------------------
// 6. API authentication failure (three variants).
const authBase: Patch = { "env.traffic.browse": 0, "env.traffic.checkout": 0, "env.traffic.orders": 50, "env.traffic.attack": 3 };
const apiAuth: Scenario = {
  id: "api-auth-failure",
  version: "1",
  number: 6,
  title: "Partner apps can't read orders",
  family: "API authentication failure",
  difficulty: "intermediate",
  severity: "SEV-2",
  report: "Partners report their apps can't load order data: our API rejects their requests. Some partners say it started a few minutes ago, others say it's only just begun.",
  impact: "Partner integrations can't read orders.",
  affected: ["store-api", "partner-app"],
  components: ["partner-app", "gateway", "store-api", "postgres", "identity-provider"],
  endpoints: ["orders"],
  features: features({ auth: true }),
  builds: { api: { v60: build({ notes: "Validates bearer tokens: algorithm, key (kid), signature, issuer, audience, expiry; then the deny-by-default policy." }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { ...authBase, "auth.jwksRefresh": "startup" },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [
    {
      id: "stale-jwks",
      title: "A key rotation the API never saw",
      changes: [change(10, "dependency", "Identity provider rotated its signing key (new kid k2)", { "env.idp.signingKid": "k2", "env.idp.publishedKids": "k1,k2" })],
      rootCause: [{ label: "The API refetches the JWKS when it meets an unknown kid", fixed: (s) => s.auth.jwksRefresh === "on-unknown-kid" }],
      keyEvidence: ["auth.unknown-kid", "auth.authentication-not-authorization", "change.dependency-correlates", "config.jwks-startup-only"],
      conclusion: "The identity provider started signing with a new key, k2, and published it in its JWKS. The orders API loaded the JWKS once at startup and never again, so it doesn't know k2: every token issued after the rotation fails the kid check with 401. Tokens issued before it kept working until they expired, which is why the failures grew over 30 s. Reloading the keys fixes it until the next rotation; refetching on an unknown kid (rate-limited) fixes it for good.",
      stress: { label: "The identity provider rotates again (k3) after your fix", changes: (t) => [{ atMs: t + sec(5), kind: "dependency", label: "Stress: another key rotation (k3)", patch: { "env.idp.signingKid": "k3", "env.idp.publishedKids": "k1,k2,k3" }, visible: false, by: "scenario" }] },
    },
    {
      id: "audience",
      title: "A release changed the expected audience",
      changes: [change(10, "deploy", "orders-api config release 2026-11-25.2", { "auth.audience": "https://api.staging.store.example" })],
      rootCause: [{ label: "The API expects its own audience, https://api.store.example", fixed: (s) => s.auth.audience === "https://api.store.example" }],
      keyEvidence: ["auth.wrong-audience", "auth.authentication-not-authorization", "change.deploy-correlates"],
      conclusion: "Config release 2026-11-25.2 set the expected audience to the staging API's, https://api.staging.store.example. Partners' tokens say aud = https://api.store.example, so every one fails the audience check with 401 from the moment the release went out. Restore the production audience; never turn the check off, or tokens issued for other APIs would be accepted here.",
    },
    {
      id: "issuer",
      title: "The identity provider's issuer URL changed",
      changes: [change(10, "dependency", "Identity provider upgraded: issuer is now https://login.store.example/v2", { "env.idp.issuer": "https://login.store.example/v2" })],
      rootCause: [{ label: "The API trusts the identity provider's current issuer", fixed: (s) => s.auth.issuer === "https://login.store.example/v2" }],
      keyEvidence: ["auth.wrong-issuer", "auth.authentication-not-authorization", "change.dependency-correlates"],
      conclusion: "The identity provider's upgrade changed its issuer to https://login.store.example/v2. Tokens issued after it carry the new iss, which the orders API doesn't trust, so they fail the issuer check with 401; older tokens kept working until they expired. Trust the new issuer exactly (the keys are unchanged).",
    },
  ],
  stress: { label: "Busier: 75 partner requests per second", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more partner traffic", patch: { "env.traffic.orders": 75 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "auth.jwksRefresh", component: "store-api", type: "select", label: "JWKS refresh", help: "When the API loads the identity provider's public keys.", options: [{ value: "startup", label: "Only at startup" }, { value: "on-unknown-kid", label: "At startup, and again on an unknown kid (at most every 10 s)" }] } as IncidentControl,
    { id: "auth.audience", component: "store-api", type: "select", label: "Expected audience", help: "The aud a token must contain to be accepted here.", options: [{ value: "https://api.store.example", label: "https://api.store.example" }, { value: "https://api.staging.store.example", label: "https://api.staging.store.example" }, { value: "*", label: "Don't check the audience" }] } as IncidentControl,
    { id: "auth.issuer", component: "store-api", type: "select", label: "Trusted issuer", help: "The iss a token must have.", options: [{ value: "https://login.store.example", label: "https://login.store.example" }, { value: "https://login.store.example/v2", label: "https://login.store.example/v2" }] } as IncidentControl,
    { id: "auth.algs", component: "store-api", type: "select", label: "Allowed algorithms", help: "Signature algorithms the API accepts.", options: [{ value: "RS256", label: "RS256 only" }, { value: "RS256,HS256", label: "RS256 and HS256" }] } as IncidentControl,
    { id: "auth.verifySignature", component: "store-api", type: "toggle", label: "Verify signatures", help: "Check each token's signature against the identity provider's key." } as IncidentControl,
  ],
  actions: [
    { id: "reload-keys", label: "Reload keys now", help: "Make every instance fetch the JWKS once, immediately.", kind: "operation", ops: ["refresh-jwks"] },
    { id: "restart", label: "Rolling restart", help: "Restart every instance (each loads the JWKS at startup).", kind: "operation", ops: ["restart-api"] },
  ],
  criteria: [
    { id: "errors", label: "Partner error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("orders"), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: partner error rate ≤ 1%", why: RECOVERY_WHY, run: "stress", window: [sec(60), sec(80)], measure: errorRate("orders"), op: "<=", threshold: 1, unit: "%" },
  ],
  invariants: [forgedRejected],
  hypotheses: [
    { id: "authz", text: "Partners lack the orders.read scope (an authorization problem, 403)", truth: "false", supports: ["auth.insufficient-scope"], refutes: ["auth.authentication-not-authorization"] },
    { id: "kid", text: "Tokens are signed with a key the API doesn't have", truth: { "stale-jwks": "root", audience: "false", issuer: "false" }, supports: ["auth.unknown-kid", "config.jwks-startup-only"], refutes: ["auth.wrong-audience", "auth.wrong-issuer"] },
    { id: "aud", text: "The API expects the wrong audience", truth: { "stale-jwks": "false", audience: "root", issuer: "false" }, supports: ["auth.wrong-audience"], refutes: ["auth.unknown-kid", "auth.wrong-issuer"] },
    { id: "iss", text: "The API doesn't trust the issuer the tokens now carry", truth: { "stale-jwks": "false", audience: "false", issuer: "root" }, supports: ["auth.wrong-issuer"], refutes: ["auth.unknown-kid", "auth.wrong-audience"] },
    { id: "expired", text: "Partners send expired tokens", truth: "false", supports: ["auth.expired"], refutes: ["auth.unknown-kid", "auth.wrong-audience", "auth.wrong-issuer"] },
  ],
  guide: [
    { question: "Are requests failing authentication (401) or authorization (403)?", where: "diagnose", diagnostic: "status-codes" },
    { question: "Which token check fails?", where: "diagnose", diagnostic: "auth" },
    { question: "What changed, and on whose side?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "401 means the API couldn't authenticate the caller; 403 means it did, and refused. Which is it?",
    "Classify the failures: which validation step fails, and what do the failing tokens' kid, iss and aud say?",
    "Compare what the tokens carry with what the API expects. Did the API change, or the identity provider?",
    "Fix what the API expects (keys, audience or issuer) without weakening a check, then verify, including under stress.",
  ],
  architecture: "Partner apps get access tokens from the identity provider (30-second lifetime here) and call GET /api/orders with them. The orders API validates each token in order: algorithm allowlist, key by kid from the cached JWKS, signature, issuer, audience, expiry. Then a deny-by-default policy checks the orders.read scope. A few attackers send forged tokens.",
  terms: ["authnStatus", "jwks", "audience", "issuer"],
  learn: [idu("tokens", "JSON Web Tokens and token security"), idu("fundamentals", "Authentication or authorization"), { kind: "Playground", label: "Token Inspector: verify real JWT signatures", href: "/practice/identity/tokens" }, { kind: "Practice", label: "Challenge: why did the API reject the token?", href: "/practice/identity/challenges/token-rejected" }, lab("identity", "jwks-verify", "Lab: verify a JWT against a JWKS"), lab("identity", "audience-bug", "Lab: the audience bug"), lab("identity", "protected-api", "Lab: real 401 and 403 from a protected API")],
  prevention: ["Refetch the JWKS on an unknown kid (rate-limited) and cache it with an expiry", "Keep issuer and audience in reviewed configuration with a startup self-test", "Subscribe to the identity provider's change notices", "Alert on 401 rate separately from 5xx"],
  limitations: [...commonLimits, "Tokens are modelled facts (kid, iss, aud, exp, who signed them), never real JWTs; real signature verification is in the Token Inspector and the identity labs."],
  seed: 6,
};

// ---------------------------------------------------------------------------------------------------------------
// 7. SSO outage.
const ssoOutage: Scenario = {
  id: "sso-outage",
  version: "1",
  number: 7,
  title: "Finance can't sign in",
  family: "SSO outage",
  difficulty: "guided",
  severity: "SEV-2",
  report: "Finance staff can't get into the Finance app this morning: they see an error page from the identity provider. A few colleagues are still working normally.",
  impact: "Staff without an existing session can't sign in to Finance.",
  affected: ["finance-app", "identity-provider"],
  components: ["browser", "finance-app", "identity-provider"],
  endpoints: ["login"],
  features: features({ sso: true }),
  builds: { api: { v60: build({ notes: "" }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "env.traffic.browse": 0, "env.traffic.checkout": 0, "env.traffic.login": 15 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(10) },
  variants: [{
    id: "redirect",
    title: "A new domain, an old redirect URI",
    changes: [change(10, "deploy", "Finance app moved to finance.store.example", { "sso.redirectUri": "finance.store.example" })],
    rootCause: [{ label: "The redirect URI the app sends is registered exactly at the identity provider", fixed: (s) => s.idp.registeredRedirects.split(",").includes(s.sso.redirectUri) }],
    keyEvidence: ["sso.redirect-rejected", "sso.only-new-sessions", "change.deploy-correlates"],
    conclusion: "The Finance app moved to finance.store.example and now sends redirect_uri=https://finance.store.example/callback, but the identity provider only has https://finance.example/callback registered for it. The provider rightly refuses to redirect a sign-in to an unregistered address (that would let an attacker receive the code). People who still had a session kept working until it expired, so failures grew. Register the new URI exactly; never a wildcard.",
  }],
  stress: { label: "Monday morning: twice as many sign-ins", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more sign-ins", patch: { "env.traffic.login": 30 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "idp.registeredRedirects", component: "identity-provider", type: "select", label: "Registered redirect URIs (finance-app)", help: "The callback addresses the identity provider will redirect a sign-in to.", options: [{ value: "finance.example", label: "https://finance.example/callback" }, { value: "finance.example,finance.store.example", label: "https://finance.example/callback and https://finance.store.example/callback" }, { value: "finance.store.example", label: "https://finance.store.example/callback" }, { value: "*", label: "Any URI (wildcard)" }] } as IncidentControl,
    { id: "sso.redirectUri", component: "finance-app", type: "select", label: "Redirect URI the app sends", help: "Where the app asks the identity provider to return the sign-in.", options: [{ value: "finance.example", label: "https://finance.example/callback" }, { value: "finance.store.example", label: "https://finance.store.example/callback" }] } as IncidentControl,
    { id: "sso.sessionS", component: "finance-app", type: "select", label: "App session lifetime", help: "How long a Finance session lasts (40 s here stands for the 8-hour policy).", options: [{ value: "40", label: "40 s (policy: 8 hours)" }, { value: "120", label: "120 s (24 hours)" }, { value: "600", label: "600 s (5 days)" }], tradeoff: "Longer sessions hide sign-in problems and keep stolen sessions useful for longer." } as IncidentControl,
  ],
  actions: [],
  criteria: [
    { id: "errors", label: "Sign-in failure rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("login"), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: sign-in failure rate ≤ 1%", why: RECOVERY_WHY, run: "stress", measure: errorRate("login"), op: "<=", threshold: 1, unit: "%" },
  ],
  invariants: [
    { id: "no-wildcard", label: "Redirect URIs are registered exactly (no wildcard)", check: (_r, s) => ({ ok: !s.idp.registeredRedirects.split(",").includes("*"), observed: s.idp.registeredRedirects.includes("*") ? "A wildcard lets any site receive authorization codes" : "Exact URIs only" }) },
    { id: "session-policy", label: "Sessions follow the 8-hour policy", check: (_r, s) => ({ ok: s.sso.sessionS <= 40, observed: `Sessions last ${s.sso.sessionS} s (policy: 40 s here)` }) },
  ],
  hypotheses: [
    { id: "redirect", text: "The identity provider refuses the app's new redirect URI", truth: "root", supports: ["sso.redirect-rejected"], refutes: ["sso.ok"] },
    { id: "idp-down", text: "The identity provider is down", truth: "false", supports: [], refutes: ["sso.only-new-sessions"] },
    { id: "sessions", text: "Only people without a session are affected", truth: "symptom", supports: ["sso.only-new-sessions"], refutes: [] },
    { id: "passwords", text: "Staff are typing wrong passwords", truth: "false", supports: [], refutes: ["sso.redirect-rejected"] },
  ],
  guide: [
    { question: "Where in the sign-in does it stop?", where: "diagnose", diagnostic: "sso" },
    { question: "What does the identity provider log?", where: "logs" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "Some people still work. What do they have that the others don't?",
    "Follow the sign-in funnel: does the request reach the identity provider, and what does it answer?",
    "The provider compares the redirect URI exactly with the registered ones. Compare the two.",
    "Register https://finance.store.example/callback exactly (or send the old URI again). Don't use a wildcard or longer sessions.",
  ],
  architecture: "The Finance app signs staff in with OpenID Connect. Without a session it redirects to the identity provider's /authorize with its client_id and redirect_uri; the provider signs the person in and redirects back to that URI with a code, which the app exchanges for tokens and turns into a session.",
  terms: ["sso", "redirectUri", "session"],
  learn: [idu("sso", "Single sign-on"), idu("oidc", "OpenID Connect"), { kind: "Playground", label: "Identity Playground: SSO, message by message", href: "/practice/identity" }, { kind: "Practice", label: "Challenge: set up SSO for two applications", href: "/practice/identity/challenges/sso-two-apps" }, lab("identity", "redirect-uri", "Lab: exact redirect URI matching")],
  prevention: ["Register the new redirect URI before moving an app", "Add a synthetic sign-in check per app", "Keep app registrations in reviewed configuration"],
  limitations: [...commonLimits, "The identity provider is simulated, not a real one; sign-in itself (passwords, MFA) always succeeds and takes a fixed time."],
  seed: 7,
};

// ---------------------------------------------------------------------------------------------------------------
// 8. Queue backlog.
const queueBacklog: Scenario = {
  id: "queue-backlog",
  version: "1",
  number: 8,
  title: "Orders are accepted but never ship",
  family: "Queue backlog",
  difficulty: "intermediate",
  severity: "SEV-3",
  report: "Checkout works, but customers get their 'your order is being prepared' email later and later. Warehouse says it has nothing to pick.",
  impact: "Orders wait longer and longer before fulfilment.",
  affected: ["orders-queue", "fulfilment-worker"],
  components: [...store, "orders-queue", "fulfilment-worker", "fraud-service"],
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true, queue: true, fraud: true }),
  builds: { api: { v60: build({ notes: "" }) }, worker: { w17: { fraudCheck: false, notes: "Writes the shipment and notifies the warehouse." }, w18: { fraudCheck: true, notes: "Adds a synchronous fraud score (POST /v2/score) before each shipment." } } },
  baseline: { "env.traffic.checkout": 30, "env.traffic.browse": 20, "env.poisonPct": 3, "worker.deadLetter": false },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "fraud",
    title: "A slower worker version, plus messages that never succeed",
    changes: [change(10, "deploy", "Deploy fulfilment-worker w18: fraud scoring before shipment", { "worker.version": "w18" })],
    rootCause: [
      { label: "Workers can process orders faster than they arrive", fixed: (s) => s.worker.version === "w17" || s.worker.concurrency >= 16 },
      { label: "Messages that keep failing are set aside (dead-letter queue)", fixed: (s) => s.worker.deadLetter },
    ],
    keyEvidence: ["queue.growing", "worker.saturated", "worker.fraud-dominant", "worker.poison"],
    conclusion: "w18 calls the fraud service before every shipment, about 400 ms per message, so 8 workers can finish about 18 orders a second while 30 arrive: the queue grows by about 12 a second and the oldest message gets older. On top of that, 3% of messages have a malformed address and fail every time; with no dead-letter queue they are retried forever, taking worker slots. Scale the workers within the fraud service's capacity (or roll back), and set poison messages aside.",
  }],
  stress: { label: "Busier: 45 checkouts per second", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more orders", patch: { "env.traffic.checkout": 45 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "worker.concurrency", component: "fulfilment-worker", type: "number", label: "Workers (messages at once)", help: "How many messages are processed at the same time.", min: 1, max: 64, step: 1, tradeoff: "Every worker also calls the fraud service, which handles 24 calls at once." } as IncidentControl,
    { id: "worker.deadLetter", component: "fulfilment-worker", type: "toggle", label: "Dead-letter queue", help: "After the maximum receives, move a failing message to orders.dlq instead of retrying it forever." } as IncidentControl,
    { id: "worker.maxReceives", component: "fulfilment-worker", type: "number", label: "Maximum receives", help: "Deliveries before a failing message is dead-lettered.", min: 1, max: 10, step: 1 } as IncidentControl,
  ],
  actions: [{ id: "rollback", label: "Roll back the worker to w17", help: "Ship orders without the fraud score until it is made asynchronous.", kind: "deploy", patch: { "worker.version": "w17" } }],
  criteria: [
    { id: "depth", label: "Queue depth ≤ 50 at the end", why: "A backlog that is not shrinking is not recovered.", run: "target", measure: (r, w) => gaugeStats(r, lastWindow(r, w, 2000), "queue.depth").last, op: "<=", threshold: 50, unit: "messages" },
    { id: "age", label: "Oldest message ≤ 10 s at the end", why: "Customers notice orders that wait.", run: "target", measure: (r, w) => gaugeStats(r, lastWindow(r, w, 2000), "queue.oldestAgeMs").last / 1000, op: "<=", threshold: 10, unit: "s" },
    { id: "checkout", label: "Checkout error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("checkout"), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-depth", label: "Under stress: queue depth ≤ 100 at the end", why: "Capacity should cover a busier day.", run: "stress", measure: (r, w) => gaugeStats(r, lastWindow(r, w, 2000), "queue.depth").last, op: "<=", threshold: 100, unit: "messages" },
  ],
  invariants: [],
  hypotheses: [
    { id: "capacity", text: "Workers process orders slower than they arrive since w18", truth: "root", supports: ["queue.growing", "worker.saturated", "worker.fraud-dominant", "change.deploy-correlates"], refutes: ["queue.stable"] },
    { id: "poison", text: "Some messages fail over and over and take worker time", truth: "contributing", supports: ["worker.poison"], refutes: [] },
    { id: "fraud-down", text: "The fraud service is failing", truth: "false", supports: ["dependency.fraud-degraded"], refutes: ["dependency.fraud-ok"] },
    { id: "checkout", text: "Checkout is broken", truth: "false", supports: ["errors.5xx"], refutes: ["errors.none"] },
  ],
  guide: [
    { question: "Is the queue growing?", where: "diagnose", diagnostic: "queue" },
    { question: "Where does a worker spend its time on one message?", where: "traces" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "Checkout returns success. Follow an order past the queue.",
    "Compare how many messages are published and processed per second. How busy are the workers?",
    "A worker now spends most of its time waiting for the fraud score. Some messages also fail every time they are received.",
    "Add workers (staying within the fraud service's 24 calls at once) or roll back to w17, and turn on the dead-letter queue. Check that the backlog is gone by the end.",
  ],
  architecture: "A checkout writes the order, then publishes an order.created message and answers the customer. Fulfilment workers take messages from the queue, record the shipment and tell the warehouse. A message that fails goes back to the queue.",
  terms: ["queue", "deadLetter", "throughput"],
  learn: [sd("messaging", "queues-and-logs", "Queues and logs"), sd("messaging", "poison-dlq", "Poison messages and dead-letter queues"), sd("overload", "backpressure", "Backpressure"), sd("performance", "littles-law", "Little's law"), { kind: "Playground", label: "Architecture Playground: queues and workers", href: "/practice/architecture" }],
  prevention: ["Alert on oldest-message age, not only depth", "Load-test worker changes against the publish rate", "Always configure a dead-letter queue with a receive limit", "Make slow checks asynchronous or batch them"],
  limitations: [...commonLimits, "One worker pool, no visibility timeout or ordering; a failed message returns after 100 ms. The warehouse call is folded into the shipment write."],
  seed: 8,
};

// ---------------------------------------------------------------------------------------------------------------
// 9. Failed deployment.
const failedDeploy: Scenario = {
  id: "failed-deployment",
  version: "1",
  number: 9,
  title: "Some checkouts fail after this morning's release",
  family: "Failed deployment",
  difficulty: "guided",
  severity: "SEV-2",
  report: "Customer support is getting reports that checkout shows 'Something went wrong'. Not everyone is affected.",
  impact: "Customers using discount codes can't check out.",
  affected: ["store-api"],
  components: store,
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: { api: { v42: build({ notes: "Current stable release." }), v43: build({ discountCrash: true, notes: "Gift cards; refactors discount handling." }), "v43.1": build({ notes: "v43 with the discount null check fixed." }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "api.version": "v42", "api.replicas": 3, "env.traffic.browse": 40, "env.traffic.checkout": 40 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "discount",
    title: "A crash on orders with a discount code",
    changes: [change(10, "deploy", "Deploy store-api v43: gift cards", { "api.version": "v43" })],
    rootCause: [{ label: "No instance runs the crashing v43 code", fixed: (s) => s.api.version !== "v43" }],
    keyEvidence: ["errors.5xx", "change.deploy-correlates", "errors.unhandled-exception"],
    conclusion: "v43 refactored discount handling and dereferences an undefined discount object: every checkout with a discount code (about 30%) throws a TypeError and returns 500. The rolling deploy reached one instance every 2.5 s, so errors grew in three steps. Rolling back to v42 or deploying the fix v43.1 resolves it.",
  }],
  stress: { label: "Busier: 1.5× traffic after your fix", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more traffic", patch: { "env.traffic.checkout": 60, "env.traffic.browse": 60 }, visible: false, by: "scenario" }] },
  controls: [c.replicas, c.clientRetries],
  actions: [
    { id: "rollback", label: "Roll back to v42", help: "Redeploy the previous release (rolling). Gift cards disappear until the fix ships.", kind: "deploy", patch: { "api.version": "v42" } },
    { id: "hotfix", label: "Deploy v43.1", help: "v43 with the discount null check fixed (rolling).", kind: "deploy", patch: { "api.version": "v43.1" } },
    { id: "restart", label: "Rolling restart", help: "Restart every instance on its current version.", kind: "operation", ops: ["restart-api"] },
  ],
  criteria: [
    { id: "errors", label: "Checkout error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate("checkout"), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: checkout error rate ≤ 1%", why: RECOVERY_WHY, run: "stress", measure: errorRate("checkout"), op: "<=", threshold: 1, unit: "%" },
  ],
  invariants: [],
  hypotheses: [
    { id: "deploy", text: "v43 has a bug that crashes some checkouts", truth: "root", supports: ["change.deploy-correlates", "errors.unhandled-exception"], refutes: ["change.none-correlates"] },
    { id: "provider", text: "The payment provider declines more cards", truth: "false", supports: ["dependency.payment-degraded"], refutes: ["dependency.payment-ok"] },
    { id: "instance", text: "One bad instance", truth: "false", supports: ["instance.one-bad"], refutes: ["instance.even"] },
    { id: "db", text: "The database is overloaded", truth: "false", supports: ["db.saturated"], refutes: ["db.ok"] },
  ],
  guide: [
    { question: "When did errors start, and what changed then?", where: "changes", diagnostic: "changes" },
    { question: "What does the error say?", where: "logs" },
    { question: "Do all instances fail alike?", where: "diagnose", diagnostic: "instances" },
  ],
  hints: [
    "Line up the error rate with the change timeline.",
    "Read the error logs for failed checkouts: is it a dependency, or our own code?",
    "Every failing checkout has the same exception, in v43's applyDiscount.",
    "Roll back to v42 or deploy v43.1, then verify.",
  ],
  architecture: "Three store-api instances serve product pages and checkouts. Deployments roll out one instance every 2.5 s: each instance drains, restarts on the new version and rejoins.",
  terms: ["rollback", "canary", "errorBudget", "mttr", "partialFailure"],
  learn: [sd("production", "deployment-strategies", "Deployment strategies"), sd("production", "slo-error-budgets", "SLOs and error budgets"), sd("production", "observability", "Observability")],
  prevention: ["Canary new versions on a small share of traffic, with automatic rollback on error rate", "Test checkout with and without discount codes", "Make rollback one command"],
  limitations: [...commonLimits, "The bug is deterministic: every discounted checkout fails on v43."],
  seed: 9,
};

// ---------------------------------------------------------------------------------------------------------------
// 10. Query performance regression.
const slowQuery: Scenario = {
  id: "slow-query",
  version: "1",
  number: 10,
  title: "Everything is slow since the account page update",
  family: "Database query performance regression",
  difficulty: "intermediate",
  severity: "SEV-2",
  report: "Since this morning the whole store is slow and checkouts sometimes fail. The new 'your orders' page takes seconds.",
  impact: "Everything that touches the database is slow; some requests fail.",
  affected: ["postgres", "store-api"],
  components: ["browser", "partner-app", "gateway", "store-api", "redis", "postgres", "payment-provider"],
  endpoints: ["browse", "checkout", "orders"],
  features: features({ cache: true, payment: true }),
  builds: { api: { v51: build({ notes: "Account page reads one order at a time by id." }), v52: build({ ordersQuery: "by-customer", notes: "New account page: lists all of a customer's orders." }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "api.version": "v51", "env.traffic.browse": 40, "env.traffic.checkout": 20, "env.traffic.orders": 60 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "scan",
    title: "A new query without an index",
    changes: [change(10, "deploy", "Deploy store-api v52: new 'your orders' page", { "api.version": "v52" })],
    rootCause: [{ label: "The orders-by-customer query uses an index (or isn't run)", fixed: (s, b) => s.db.ordersIndex || b.api[s.api.version]?.ordersQuery !== "by-customer" }],
    keyEvidence: ["db.seq-scan", "db.saturated", "change.deploy-correlates", "dependency.database-degraded"],
    conclusion: "v52's account page runs SELECT * FROM orders WHERE customer_id = $1, and orders has no index on customer_id, so every call scans about two million rows (120 ms of database CPU instead of 4). At 60 calls a second that alone needs most of the database's 8 CPU slots: every other query now waits for CPU, so checkouts and product pages slow down too. An index makes the query cheap again (at a small cost on every insert).",
  }],
  stress: { label: "Twice the account-page traffic", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more account-page views", patch: { "env.traffic.orders": 120 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "db.ordersIndex", component: "postgres", type: "toggle", label: "Index orders(customer_id)", help: "CREATE INDEX CONCURRENTLY: about 8 s of one CPU slot to build, then the planner uses it.", tradeoff: "Each insert into orders also updates the index (about 1 ms more)." } as IncidentControl,
    { id: "db.cpuSlots", component: "postgres", type: "select", label: "Database size (CPU slots)", help: "A bigger database runs more queries at once.", options: ["8", "16", "32"].map((v) => ({ value: v, label: `${v} slots` })), tradeoff: "Costs more every month; each scan still costs the same." } as IncidentControl,
    c.poolSize, c.replicas,
  ],
  actions: [{ id: "rollback", label: "Roll back to v51", help: "Removes the new account page until it is fixed.", kind: "deploy", patch: { "api.version": "v51" } }],
  criteria: [
    { id: "errors", label: "Error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
    { id: "p95", label: "Checkout p95 ≤ 600 ms", why: RECOVERY_WHY, run: "target", measure: p95("checkout"), op: "<=", threshold: 600, unit: "ms" },
    { id: "stress-p95", label: "Under stress: checkout p95 ≤ 600 ms", why: "Account-page traffic will grow as people discover it.", run: "stress", measure: p95("checkout"), op: "<=", threshold: 600, unit: "ms" },
  ],
  invariants: [],
  hypotheses: [
    { id: "scan", text: "v52's new query scans the whole orders table", truth: "root", supports: ["db.seq-scan", "change.deploy-correlates"], refutes: [] },
    { id: "db-busy", text: "The database is out of CPU", truth: "symptom", supports: ["db.saturated", "latency.database"], refutes: ["db.ok"] },
    { id: "pool", text: "The connection pool is too small", truth: "symptom", supports: ["pool.exhausted"], refutes: ["pool.ok"] },
    { id: "cache", text: "The cache stopped working", truth: "false", supports: ["cache.hit-rate-drop"], refutes: ["cache.ok"] },
  ],
  guide: [
    { question: "Which dependency is slow?", where: "diagnose", diagnostic: "dependencies" },
    { question: "Which queries use the database's time?", where: "diagnose", diagnostic: "database" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "Everything is slow, not just the account page. What do all those requests share?",
    "Check database load: which statement takes the most time, and what is its plan?",
    "A sequential scan on a hot path uses most of the database's CPU, so every other query waits.",
    "Add the index on orders(customer_id) (or roll back), then verify under twice the account-page traffic.",
  ],
  architecture: "Product pages, checkouts and the account page all query one Postgres database with 8 CPU slots. Queries beyond 8 wait for CPU, and a busy database runs every query a little slower.",
  terms: ["dbIndex", "saturation"],
  learn: [sd("performance", "indexing", "Indexing"), sd("performance", "capacity-planning", "Capacity planning"), { kind: "Playground", label: "Data Structures Playground: why a search tree beats a scan", href: "/practice/structures" }],
  prevention: ["Review query plans (EXPLAIN) for new queries in code review", "Track database CPU per statement", "Build indexes concurrently before the feature that needs them ships"],
  limitations: [...commonLimits, "Query costs are fixed numbers per plan (120 ms for the scan, 4 ms with the index); the table doesn't grow during the run."],
  seed: 10,
};

// ---------------------------------------------------------------------------------------------------------------
// 11. Rate limiting failure.
const rateLimit: Scenario = {
  id: "rate-limit-failure",
  version: "1",
  number: 11,
  title: "Customers get 'Too many requests'",
  family: "Rate limiting failure",
  difficulty: "intermediate",
  severity: "SEV-2",
  report: "Ordinary customers are getting HTTP 429 'Too many requests' while browsing and at checkout, after a single click.",
  impact: "Most customers are throttled; a scraper is not the only one limited.",
  affected: ["gateway"],
  components: ["browser", "gateway", "store-api", "redis", "postgres", "payment-provider"],
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: { api: { v60: build({ notes: "" }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "gateway.rateLimit": true, "env.traffic.browse": 80, "env.traffic.checkout": 20, "env.traffic.scraper": 25 },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(80), settleMs: sec(15) },
  variants: [{
    id: "edge-ip",
    title: "Limits keyed by an address many customers share",
    changes: [change(10, "config", "Gateway plugin upgrade 3.2 → 4.0", { "gateway.keyBy": "client-ip" })],
    rootCause: [{ label: "Limits are keyed by each client's API key", fixed: (s) => s.gateway.keyBy === "api-key" }],
    keyEvidence: ["ratelimit.shared-bucket", "errors.429", "change.config-correlates", "config.ratelimit-by-ip"],
    conclusion: "Version 4.0 of the gateway's rate-limit plugin keys limits by client IP by default. The gateway sits behind the CDN, so the address it sees is one of four CDN edges, each carrying a quarter of all customers' traffic: four buckets of 10 requests a second for about 30 requests a second each. Keying by API key again gives every client its own bucket, so only the scraper is limited.",
  }],
  stress: { label: "Busier: 1.5× customer traffic", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more customers", patch: { "env.traffic.browse": 120, "env.traffic.checkout": 30 }, visible: false, by: "scenario" }] },
  controls: [
    { id: "gateway.keyBy", component: "gateway", type: "select", label: "Rate-limit key", help: "Whose requests share a bucket.", options: [{ value: "api-key", label: "API key (each client)" }, { value: "client-ip", label: "Client IP (as the gateway sees it)" }] } as IncidentControl,
    { id: "gateway.limitRps", component: "gateway", type: "number", label: "Limit per key", help: "Requests per second each bucket refills.", min: 1, max: 100, step: 1, unit: "req/s", tradeoff: "A higher limit also lets abusive clients send more." } as IncidentControl,
    { id: "gateway.burst", component: "gateway", type: "number", label: "Burst", help: "Requests a full bucket allows at once.", min: 1, max: 200, step: 1 } as IncidentControl,
    { id: "gateway.rateLimit", component: "gateway", type: "toggle", label: "Rate limiting on", help: "Turn the limiter off entirely." } as IncidentControl,
  ],
  actions: [],
  criteria: [
    { id: "errors", label: "Customer error rate ≤ 1%", why: RECOVERY_WHY, run: "target", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
    { id: "stress-errors", label: "Under stress: customer error rate ≤ 1%", why: RECOVERY_WHY, run: "stress", measure: errorRate(), op: "<=", threshold: 1, unit: "%" },
  ],
  invariants: [{
    id: "scraper-limited",
    label: "The scraper stays limited (at most 12 accepted requests a second)",
    check: (run, _s, from) => {
      const ok = run.events.filter((e) => e.type === "complete" && !e.legit && e.endpoint === "browse" && e.status === 200 && e.t >= from).length;
      const rate = ok / Math.max(1, (run.endMs - from) / 1000);
      return { ok: rate <= 12, observed: `The scraper got ${rate.toFixed(1)} successful requests per second after your change` };
    },
  }],
  hypotheses: [
    { id: "shared", text: "Many customers share a rate-limit bucket", truth: "root", supports: ["ratelimit.shared-bucket", "config.ratelimit-by-ip"], refutes: ["ratelimit.per-client"] },
    { id: "too-low", text: "The limit is simply too low for today's traffic", truth: "false", supports: [], refutes: ["ratelimit.shared-bucket"] },
    { id: "scraper", text: "A scraper is overloading the store", truth: "false", supports: ["threads.exhausted", "db.saturated"], refutes: ["threads.ok", "db.ok"] },
    { id: "overload", text: "The API is overloaded and shedding load (503)", truth: "false", supports: ["errors.5xx"], refutes: ["errors.429"] },
  ],
  guide: [
    { question: "What status do customers get, and from which component?", where: "diagnose", diagnostic: "status-codes" },
    { question: "Which rate-limit keys are being limited?", where: "diagnose", diagnostic: "rate-limit" },
    { question: "What changed?", where: "changes", diagnostic: "changes" },
  ],
  hints: [
    "429 comes from the gateway's limiter, not from an overloaded server (that would be 503). Who is limited?",
    "Look at the keys of the limited requests. How many distinct keys, and what are they?",
    "Behind a CDN, what client IP does the gateway see?",
    "Key the limiter by API key again. Raising the limit or turning it off would let the scraper through. Verify under stress.",
  ],
  architecture: "Customers' requests reach the gateway through four CDN edge servers. The gateway limits each key to 10 requests a second (burst 20) with a token bucket and answers 429 with Retry-After when a bucket is empty. One API key belongs to a scraper sending 25 requests a second.",
  terms: ["rateLimit"],
  learn: [sd("overload", "rate-limiting", "Rate limiting"), sd("overload", "load-shedding", "Load shedding"), archLab("rate-limit", "Lab: rate limiting, fair and unfair"), lab("networking", "headers-status", "Lab: real status codes and Retry-After")],
  prevention: ["Key limits by authenticated identity; behind a proxy, read the client address only from a trusted forwarding header", "Review default changes in infrastructure upgrades", "Alert on 429 rate for non-abusive clients"],
  limitations: [...commonLimits, "One token bucket per key with a fixed rate and burst, no sliding windows or per-route limits; clients honour Retry-After."],
  seed: 11,
};

// ---------------------------------------------------------------------------------------------------------------
// 12. Multi-factor incident.
const multiFactor: Scenario = {
  id: "multi-factor",
  version: "1",
  number: 12,
  title: "The whole store goes down while payments are slow",
  family: "Multi-factor incident",
  difficulty: "advanced",
  severity: "SEV-1",
  report: "The store is down: product pages, cart, checkout. The payment provider reports degraded performance, but product pages don't use it.",
  impact: "Nothing works, including pages that don't involve payment.",
  affected: ["store-api", "payment-provider"],
  components: store,
  endpoints: ["browse", "checkout"],
  features: features({ cache: true, payment: true }),
  builds: { api: { v43: build({ notes: "Payments SDK 4: 2 s timeout, no retries." }), v44: build({ notes: "Payments SDK 5: the store's timeout and retry overrides were dropped; SDK defaults apply." }) }, worker: { w17: { fraudCheck: false, notes: "" } } },
  baseline: { "api.version": "v43", "env.traffic.browse": 40, "env.traffic.checkout": 25, "env.payment.latencyMs": 300, "env.payment.capacity": 30, "payment.idempotencyKeys": false },
  timing: { faultAtMs: sec(10), fixAtMs: sec(40), endMs: sec(100), settleMs: sec(20) },
  variants: [{
    id: "sdk",
    title: "New SDK defaults meet a slow provider",
    changes: [
      change(10, "deploy", "Deploy store-api v44: payments SDK 5", { "api.version": "v44", "payment.timeoutMs": 10_000, "payment.retries": 3, "payment.backoff": "none" }),
      change(18, "dependency", "Payment provider status: degraded performance", { "env.payment.latencyMs": 2500 }),
      change(65, "dependency", "Payment provider status: resolved", { "env.payment.latencyMs": 300 }),
    ],
    rootCause: [
      { label: "Payment attempts give up quickly (timeout ≤ 3 s), so a slow provider can't hold every thread", fixed: (s) => s.payment.timeoutMs <= 3000 },
      { label: "Retries are bounded and spread out", fixed: (s) => s.payment.retries === 0 || (s.payment.backoff === "exponential-jitter" && s.payment.retries <= 1) || s.payment.breaker },
    ],
    keyEvidence: ["threads.exhausted", "browse.collateral", "config.long-timeout", "retries.amplified", "change.dependency-correlates", "dependency.payment-degraded"],
    conclusion: "Two things combined. v44 upgraded the payments SDK and silently dropped the store's overrides: payment attempts now wait up to 10 s and retry three times immediately. Then the provider slowed to 2.5 s a charge. Each checkout held an API thread for many seconds, retries quadrupled the provider's load (making it slower still), and the 64 threads filled up: product pages, which never call the provider, could no longer get a thread. The provider's slowdown was the trigger and outside the store's control; the timeout and retry regression turned it into a full outage. The fix bounds how long and how often the store waits on the provider, so payments degrade alone.",
  }],
  stress: { label: "Busier: 1.5× traffic while the provider is degraded", changes: (t) => [{ atMs: t, kind: "traffic", label: "Stress: more traffic", patch: { "env.traffic.browse": 60, "env.traffic.checkout": 38 }, visible: false, by: "scenario" }] },
  controls: [c.payTimeout, c.payRetries, c.backoff, c.breaker, c.idempotency, c.replicas, c.concurrency, c.clientRetries],
  actions: [{ id: "rollback", label: "Roll back to v43", help: "Redeploy v43 with its SDK 4 settings (2 s timeout, no retries).", kind: "deploy", patch: { "api.version": "v43", "payment.timeoutMs": 2000, "payment.retries": 0 } }],
  criteria: [
    { id: "browse-degraded", label: "While payments are degraded: product-page error rate ≤ 2%", why: "Pages that don't need the provider must keep working during its incident (isolation).", run: "target", window: [sec(50), sec(65)], measure: errorRate("browse"), op: "<=", threshold: 2, unit: "%" },
    { id: "fail-fast", label: "While payments are degraded: checkout p95 ≤ 5 s", why: "If a checkout can't succeed, it should fail within a bounded time, retries included.", run: "target", window: [sec(50), sec(65)], measure: p95("checkout"), op: "<=", threshold: 5000, unit: "ms" },
    { id: "recovered", label: "After the provider recovers: checkout error rate ≤ 2%", why: "Once the trigger is gone, the store must recover by itself.", run: "target", window: [sec(80), sec(100)], measure: errorRate("checkout"), op: "<=", threshold: 2, unit: "%" },
    { id: "stress-browse", label: "Under stress: product-page error rate ≤ 2% while degraded", why: "Isolation should hold on a busier day too.", run: "stress", window: [sec(50), sec(65)], measure: errorRate("browse"), op: "<=", threshold: 2, unit: "%" },
  ],
  invariants: [noDuplicateCharges],
  hypotheses: [
    { id: "provider", text: "The payment provider slowed down (outside our control)", truth: "root", supports: ["change.dependency-correlates", "dependency.payment-degraded", "latency.payment"], refutes: ["dependency.payment-ok"] },
    { id: "sdk", text: "v44's new SDK waits much longer and retries more on each payment call", truth: "root", supports: ["config.long-timeout", "config.immediate-retries", "retries.amplified", "change.deploy-correlates"], refutes: ["retries.low"] },
    { id: "threads", text: "Every API thread is stuck waiting on payments, so product pages fail too", truth: "symptom", supports: ["threads.exhausted", "browse.collateral"], refutes: ["threads.ok"] },
    { id: "db", text: "The database is overloaded", truth: "false", supports: ["db.saturated", "pool.exhausted"], refutes: ["db.ok", "pool.ok"] },
    { id: "cache", text: "The product cache failed", truth: "false", supports: ["cache.hit-rate-drop", "dependency.cache-degraded"], refutes: ["cache.ok", "dependency.cache-ok"] },
  ],
  guide: [],
  hints: [
    "Product pages fail although they never call the provider. What do they share with checkouts?",
    "Check API saturation and retry amplification. How long can one payment attempt hold a thread now?",
    "Two causes: the provider's slowdown, which you can't fix, and a change on your side that turned it into an outage.",
    "Bound the wait (short timeout or a circuit breaker), bound the retries (with jitter and idempotency keys if you keep any), or roll back to v43. Verify isolation while the provider is still degraded.",
  ],
  architecture: "Two store-api instances with 32 threads each serve product pages and checkouts. A checkout holds its thread while it calls the payment provider; product pages only use the cache and the database.",
  terms: ["bulkhead", "timeout", "retryAmplification", "mttr"],
  learn: [sd("resilience", "bulkheads", "Bulkheads"), sd("resilience", "graceful-degradation", "Graceful degradation"), sd("resilience", "timeouts-deadlines", "Timeouts and deadlines"), sd("resilience", "retry-storms", "Retry storms"), archLab("circuit-breaker", "Lab: circuit breakers"), lab("architecture", "troubleshooting", "Lab: troubleshoot a real faulty endpoint")],
  prevention: ["Pin and review dependency client settings (timeouts, retries) in code, with tests", "Isolate calls to third parties (separate thread pool or a concurrency limit: a bulkhead)", "Circuit breakers on third-party calls", "Alert on thread saturation"],
  limitations: [...commonLimits, "One shared thread pool per instance; no bulkhead option is modelled, so isolation comes from timeouts, retries and the breaker."],
  seed: 12,
};

export const SCENARIOS: Scenario[] = [poolExhaustion, stampede, retryStorm, unhealthy, dnsFailure, apiAuth, ssoOutage, queueBacklog, failedDeploy, slowQuery, rateLimit, multiFactor];
export const findScenario = (id: string) => SCENARIOS.find((s) => s.id === id);
export const INCIDENTS_PATH = "/practice/incidents";
export const incidentPath = (id: string) => `${INCIDENTS_PATH}/${id}`;

/** The scenario's starting state: the known-good store with its baseline applied. */
export const startState = (s: Scenario) => applyPatch(DEFAULT_STATE, s.baseline);
export const truthOf = (h: Hypothesis, variant: string): Truth => (typeof h.truth === "string" ? h.truth : h.truth[variant] ?? "false");
export const variantFor = (s: Scenario, attempt: number) => s.variants[attempt % s.variants.length];
export { spanStats };
