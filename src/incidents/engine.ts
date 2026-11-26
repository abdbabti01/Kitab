// The Production Incident Simulator's engine: one deterministic, bounded discrete-event model of a small online
// store. Pure TypeScript, no React or DOM. One run produces one canonical record of what happened: `events` (state
// transitions, periodic gauge readings) and `spans` (every unit of modelled work, opened when the work starts and
// closed when it ends). Metrics, logs, traces, topology health, findings, recovery checks and the postmortem are all
// read from that record (telemetry.ts); nothing is generated separately.
//
// It reuses the Architecture simulator's event heap and the identity track's authorization policy. It does not reuse
// the Architecture Playground's `simulate()`: that model has no connection pools, DNS, token validation, deployments,
// rate limits or circuit breakers, and bolting them on would change a validated engine for every Architecture lesson.
// Nothing here observes a real network, CPU, database or identity provider: every duration is a modelled number.
import { Heap } from "../architecture/simulate.ts";
import { evaluate as authorize } from "../identity/authz.ts";

export type Endpoint = "browse" | "checkout" | "orders" | "login";
export const ROUTES: Record<Endpoint, string> = {
  browse: "GET /products/:id",
  checkout: "POST /checkout",
  orders: "GET /api/orders/:id",
  login: "GET finance.store.example/",
};

/** What the store's engineers configure. Every field a learner can change is a control in a scenario. */
export type Config = {
  client: { timeoutMs: number; retries: number; backoffMs: number };
  dns: { record: "203.0.113.10" | "203.0.113.100"; ttlS: number };
  gateway: { rateLimit: boolean; limitRps: number; burst: number; keyBy: "api-key" | "client-ip" };
  lb: { healthCheck: "liveness" | "readiness"; intervalMs: number; threshold: number };
  api: { version: string; replicas: number; concurrency: number; queueLimit: number };
  pool: { size: number; acquireTimeoutMs: number };
  db: { maxConnections: number; cpuSlots: number; ordersIndex: boolean };
  /** ttlS: catalogue pages. saleTtlS: the sale product's page (product 0). */
  cache: { ttlS: number; saleTtlS: number; coalescing: boolean };
  payment: { timeoutMs: number; retries: number; backoff: "none" | "exponential-jitter"; breaker: boolean; idempotencyKeys: boolean };
  auth: { issuer: string; audience: string; jwksRefresh: "startup" | "on-unknown-kid"; algs: "RS256" | "RS256,HS256"; verifySignature: boolean };
  idp: { registeredRedirects: string };
  sso: { redirectUri: string; sessionS: number };
  worker: { version: string; concurrency: number; maxReceives: number; deadLetter: boolean };
};

/** What the store doesn't control: traffic, third parties, hardware. Changes to it come from the scenario. */
export type Env = {
  /** Arrivals per second of each kind of request. `scraper`: browse requests from one aggressive API key. `attack`: forged or misdirected tokens. */
  traffic: { browse: number; checkout: number; orders: number; login: number; scraper: number; attack: number };
  payment: { latencyMs: number; capacity: number; declinePct: number };
  fraud: { latencyMs: number; capacity: number };
  idp: { issuer: string; signingKid: string; publishedKids: string; tokenLifetimeS: number };
  /** Instances (1-based numbers, comma-separated) whose local state is broken: they answer every request with 500. */
  broken: string;
  /** Percent of order messages a worker can never process (a malformed address). */
  poisonPct: number;
  /** Cost of building one product page from the database, before contention. */
  productQueryMs: number;
  /** During a flash sale: percent of product-page requests for the sale product (product 0), whose price changes every 20 s. */
  hotPct: number;
};

export type State = Config & { env: Env };

/** Behaviour that ships with a build. A deployment changes `api.version` (or `worker.version`) to one of these. */
export type ApiBuild = {
  /** The payment call runs inside the order's database transaction, holding its connection. */
  paymentInTransaction: boolean;
  /** The card-declined path returns before releasing its database connection. */
  leakOnDecline: boolean;
  /** Orders with a discount code crash the checkout handler. */
  discountCrash: boolean;
  /** by-id: orders are read by primary key. by-customer: the account page lists a customer's orders. */
  ordersQuery: "by-id" | "by-customer";
  /** CPU time the handler spends per request before any dependency call. */
  serviceMs: number;
  notes: string;
};
export type WorkerBuild = { fraudCheck: boolean; notes: string };
export type Builds = { api: Record<string, ApiBuild>; worker: Record<string, WorkerBuild> };

export type Value = string | number | boolean;
/** Dot paths into State ("pool.size", "env.payment.latencyMs") and their new values. */
export type Patch = Record<string, Value>;
export type Operation = "restart-api" | "replace-broken" | "refresh-jwks";
export type ChangeKind = "deploy" | "config" | "scale" | "dependency" | "traffic" | "infrastructure" | "remediation" | "operation";

export type Change = {
  atMs: number;
  kind: ChangeKind;
  label: string;
  patch?: Patch;
  ops?: Operation[];
  /** Shown on the Changes timeline: the store's own changes are; a third party's internals and traffic aren't. */
  visible: boolean;
  /** Who made it: the scenario's story, or the learner's remediation. */
  by: "scenario" | "learner";
};

export type Features = { dns: boolean; cache: boolean; queue: boolean; payment: boolean; auth: boolean; sso: boolean; fraud: boolean };

export type RunInput = { seed: number; state: State; changes: Change[]; builds: Builds; features: Features; endMs: number };

export type SpanKind = "client" | "server" | "internal" | "producer" | "consumer";
export type Attr = string | number | boolean;
export type Span = {
  id: string;
  trace: string;
  parent?: string;
  req: number;
  service: string;
  name: string;
  kind: SpanKind;
  start: number;
  /** -1 while the work is still going on; a finished run closes or marks every span. */
  end: number;
  status: "ok" | "error" | "unset";
  error?: { code: string; message: string };
  attrs: Record<string, Attr>;
};

export type EventType =
  | "request" // a logical request starts (its first attempt)
  | "complete" // a logical request ends: `status`, `failed`, `latencyMs`, `attempts`
  | "gauge" // a reading of the model's state (every GAUGE_MS); numbers in `data`
  | "change" // a scheduled or learner change is applied
  | "health" // the gateway marks an instance healthy or unhealthy
  | "instance" // an instance starts draining, restarts, joins or leaves
  | "breaker" // a circuit breaker changes state
  | "jwks" // a resource server (re)loads the identity provider's keys
  | "dns" // a resolver group caches an answer
  | "leak" // a connection is not returned to its pool
  | "charge" // the payment provider records a charge (`duplicate` when a request was charged before)
  | "dead-letter" // a message is set aside after too many failures
  | "index" // an index build starts or finishes
  | "warning"; // a component logs a warning about its own state (with the numbers that triggered it)

export type IncidentEvent = {
  i: number;
  t: number;
  type: EventType;
  service?: string;
  req?: number;
  trace?: string;
  span?: string;
  endpoint?: Endpoint;
  status?: number;
  failed?: boolean;
  legit?: boolean;
  latencyMs?: number;
  attempts?: number;
  code?: string;
  message?: string;
  label?: string;
  kind?: ChangeKind;
  by?: Change["by"];
  data?: Record<string, number>;
};

export type Run = { input: RunInput; events: IncidentEvent[]; spans: Span[]; endMs: number; truncated: boolean };

export const NET = { clientMs: 20, internalMs: 1, externalMs: 15 };
export const GAUGE_MS = 500;
export const LIMITS = { maxEvents: 120_000, maxSpans: 260_000, maxEndMs: 120_000, maxRps: 400 };
/** Clients behind the gateway, CDN edge addresses they arrive from, resolver groups, Finance users. */
export const POPULATION = { clients: 200, edges: 4, resolvers: 10, users: 300, apiClients: 60, products: 400 };
export const BREAKER = { window: 20, minCalls: 10, failurePct: 50, openMs: 5000 };
const RESTART_MS = 1500;
const BOOT_MS = 3000;
const ROLL_STEP_MS = 2500;
const JWKS_COOLDOWN_MS = 10_000;
const CONNECT_MS = 5;
const PROVIDER_QUEUE = 400;
export const SKEW_S = 30;

/** A stable number in [0, 1) for a tuple: the same request gets the same traits in every run with this seed. */
export function hash01(...parts: number[]) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
    h ^= h >>> 15;
  }
  return (h >>> 0) / 4294967296;
}
const hex = (n: number, width: number) => (n >>> 0).toString(16).padStart(width, "0").slice(-width);
const salt = (s: string) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);

export function getPath(state: State, path: string): Value {
  let v: unknown = state;
  for (const key of path.split(".")) v = (v as Record<string, unknown>)?.[key];
  return v as Value;
}
/** A new state with the patch applied. Unknown paths throw: a patch can't add settings the model doesn't read. */
export function applyPatch(state: State, patch: Patch): State {
  const next = structuredClone(state);
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split(".");
    let target = next as unknown as Record<string, unknown>;
    for (const key of keys.slice(0, -1)) {
      if (typeof target[key] !== "object" || target[key] === null) throw new Error(`Unknown setting ${path}`);
      target = target[key] as Record<string, unknown>;
    }
    const last = keys.at(-1)!;
    if (!(last in target) || typeof target[last] !== typeof value) throw new Error(`Unknown setting ${path}`);
    target[last] = value;
  }
  return next;
}

export const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** A token as the model knows it: claims and who signed it. Never a real token. */
export type ModelToken = { alg: "RS256" | "HS256"; kid: string; iss: string; aud: string; exp: number; signedWith: "issuer-key" | "forged" | "public-key-as-hmac"; scopes: "orders.read" | "none" };
export type TokenCheck = { ok: true } | { ok: false; step: "alg" | "kid" | "signature" | "iss" | "aud" | "exp"; description: string };

/**
 * A resource server's token checks, in the identity track's order (src/identity/jwt.ts `validate`): algorithm
 * allowlist, key by kid from the trusted set, signature, issuer, audience, expiry. Modelled: there is no real token
 * or signature here, only the facts each check reads.
 */
export function checkToken(token: ModelToken, rs: { issuer: string; audience: string; algs: Config["auth"]["algs"]; verifySignature: boolean; keys: Set<string> }, nowS: number): TokenCheck {
  if (!csv(rs.algs).includes(token.alg)) return { ok: false, step: "alg", description: `alg ${token.alg} is not allowed (allowed: ${rs.algs})` };
  if (token.alg === "RS256" && rs.verifySignature && !rs.keys.has(token.kid)) return { ok: false, step: "kid", description: `no key with kid "${token.kid}" in the cached JWKS (${[...rs.keys].join(", ") || "empty"})` };
  if (rs.verifySignature) {
    // HS256 with the issuer's public key as the HMAC secret "verifies" if HS256 is allowed: algorithm confusion.
    const valid = token.signedWith === "issuer-key" || (token.signedWith === "public-key-as-hmac" && token.alg === "HS256");
    if (!valid) return { ok: false, step: "signature", description: "signature does not verify with the issuer's key" };
  }
  if (token.iss !== rs.issuer) return { ok: false, step: "iss", description: `iss "${token.iss}" is not the trusted issuer "${rs.issuer}"` };
  // "*" models a resource server that skips the audience check: it accepts tokens issued for any API.
  if (rs.audience !== "*" && token.aud !== rs.audience) return { ok: false, step: "aud", description: `aud "${token.aud}" is not this API ("${rs.audience}")` };
  if (nowS >= token.exp + SKEW_S) return { ok: false, step: "exp", description: `token expired at ${token.exp} s (now ${Math.floor(nowS)} s, ${SKEW_S} s skew)` };
  return { ok: true };
}

/** Failures from the customer's side: no answer, 5xx, 429 and 401. 402 (declined card) and 403 (missing scope) are correct answers. */
export const isFailure = (status: number) => status === 0 || status >= 500 || status === 429 || status === 401;

type Pool = { open: number; idle: number; inUse: number; leaked: number; waiters: { cb: (ok: boolean) => void; fail: () => void; timer: { live: boolean } }[]; size: () => number };
type Instance = {
  id: string;
  n: number;
  version: string;
  state: "booting" | "serving" | "draining" | "restarting" | "removed";
  healthy: boolean;
  passes: number;
  fails: number;
  broken: boolean;
  threads: number;
  queue: (() => void)[];
  pool: Pool;
  keys: Set<string>;
  lastJwksFetch: number;
  breaker: { state: "closed" | "open" | "half-open"; outcomes: boolean[]; openedAt: number; trial: boolean };
  coalescing: Map<number, ((ok: boolean) => void)[]>;
};
type Req = { id: number; trace: string; endpoint: Endpoint; legit: boolean; client: number; edge: number; resolver: number; discount: boolean; product: number; user: number; startedAt: number; seq: number; root: Span };
type Message = { id: number; req: number; trace: string; parent: string; enqueuedAt: number; receives: number; poison: boolean };

export function simulate(input: RunInput): Run {
  const { seed, builds, features } = input;
  const endMs = Math.min(input.endMs, LIMITS.maxEndMs);
  let s: State = structuredClone(input.state);
  const heap = new Heap();
  const events: IncidentEvent[] = [];
  const spans: Span[] = [];
  let now = 0;
  let seq = 0;
  let truncated = false;
  const at = (t: number, run: () => void) => heap.push({ t, seq: seq++, run });
  const emit = (e: Omit<IncidentEvent, "i" | "t">) => {
    if (events.length >= LIMITS.maxEvents) {
      truncated = true;
      return;
    }
    events.push({ i: events.length, t: now, ...e });
  };

  // ---- Spans ----
  function open(req: Req, parent: Span | undefined, service: string, name: string, kind: SpanKind, attrs: Record<string, Attr> = {}, start = now): Span {
    const span: Span = { id: `${req.trace.slice(0, 8)}${hex(++req.seq, 8)}`, trace: req.trace, parent: parent?.id, req: req.id, service, name, kind, start, end: -1, status: "unset", attrs };
    if (spans.length >= LIMITS.maxSpans) truncated = true;
    else spans.push(span);
    return span;
  }
  function close(span: Span, ok: boolean, error?: { code: string; message: string }) {
    if (span.end >= 0) return;
    span.end = now;
    span.status = ok ? "ok" : "error";
    if (error) span.error = error;
  }

  // ---- Instances, pools, database ----
  const db = { active: 0, waiting: [] as (() => void)[], connections: 0, indexReady: s.db.ordersIndex, building: false };
  const newPool = (): Pool => ({ open: 0, idle: 0, inUse: 0, leaked: 0, waiters: [], size: () => s.pool.size });
  let instanceNo = 0;
  const instances: Instance[] = [];
  const brokenAt = () => new Set(csv(s.env.broken).map(Number));
  function addInstance(state: Instance["state"]) {
    const n = ++instanceNo;
    const inst: Instance = {
      id: `api-${n}`, n, version: s.api.version, state, healthy: true, passes: 0, fails: 0, broken: brokenAt().has(n), threads: 0, queue: [], pool: newPool(),
      keys: new Set(csv(s.env.idp.publishedKids)), lastJwksFetch: -Infinity, breaker: { state: "closed", outcomes: [], openedAt: 0, trial: false }, coalescing: new Map(),
    };
    instances.push(inst);
    if (state === "booting") at(now + BOOT_MS, () => {
      if (inst.state !== "booting") return;
      inst.state = "serving";
      emit({ type: "instance", service: inst.id, label: "joined", message: `${inst.id} (${inst.version}) started and joined the gateway's pool` });
    });
    return inst;
  }
  for (let i = 0; i < s.api.replicas; i++) addInstance("serving");
  const live = () => instances.filter((i) => i.state !== "removed");

  /** The database runs `cpuSlots` queries at once; more wait. While it is oversubscribed every query runs slower (declared contention model). */
  function contention() {
    const load = (db.active + db.waiting.length) / s.db.cpuSlots;
    return Math.min(3, 1 + 0.25 * Math.max(0, load - 1));
  }
  function dbRun(costMs: number, done: () => void, onStart?: () => void, fixed = false) {
    const start = () => {
      db.active++;
      onStart?.();
      at(now + costMs * (fixed ? 1 : contention()), () => {
        db.active--;
        // Queued work first: a query issued by `done` must not take the freed slot ahead of queries already waiting.
        while (db.active < s.db.cpuSlots && db.waiting.length) db.waiting.shift()!();
        done();
      });
    };
    if (db.active < s.db.cpuSlots && !db.waiting.length) start();
    else db.waiting.push(start);
  }
  function query(req: Req, parent: Span, statement: string, costMs: number, done: () => void, attrs: Record<string, Attr> = {}) {
    const span = open(req, parent, "postgres", statement.split(" ")[0], "client", { "db.statement": statement, "db.costMs": costMs, ...attrs });
    const queuedAt = now;
    dbRun(costMs, () => {
      close(span, true);
      done();
    }, () => {
      span.attrs["db.waitMs"] = now - queuedAt;
      span.attrs["db.contention"] = Math.round(contention() * 100) / 100;
    });
  }

  type Failure = { code: string; message: string };
  function acquire(inst: Instance, req: Req, parent: Span, cb: (ok: boolean, status?: number, error?: Failure) => void) {
    const pool = inst.pool;
    const span = open(req, parent, "store-api", "db.pool.acquire", "internal", { "pool.size": pool.size(), "pool.inUse": pool.inUse, "pool.waiting": pool.waiters.length });
    if (pool.idle > 0) {
      pool.idle--;
      pool.inUse++;
      close(span, true);
      return cb(true);
    }
    if (pool.open < pool.size()) {
      if (db.connections >= s.db.maxConnections) {
        close(span, false, { code: "DB_TOO_MANY_CLIENTS", message: `FATAL: sorry, too many clients already (${db.connections}/${s.db.maxConnections} connections open)` });
        return cb(false, 500, span.error);
      }
      pool.open++;
      pool.inUse++;
      db.connections++;
      return at(now + CONNECT_MS, () => {
        close(span, true);
        cb(true);
      });
    }
    const timer = { live: true };
    const giveUp = (error: Failure) => {
      if (!timer.live) return;
      timer.live = false;
      pool.waiters = pool.waiters.filter((w) => w.timer !== timer);
      close(span, false, error);
      cb(false, 503, error);
    };
    pool.waiters.push({ timer, fail: () => giveUp({ code: "POOL_CLOSED", message: "The connection pool was closed while this request waited (instance restarting)" }), cb: (ok) => {
      close(span, ok);
      cb(ok);
    } });
    at(now + s.pool.acquireTimeoutMs, () => giveUp({ code: "POOL_TIMEOUT", message: `Timed out after ${s.pool.acquireTimeoutMs} ms waiting for a database connection (pool ${pool.inUse}/${pool.size()} in use, ${pool.waiters.length - 1} others waiting)` }));
  }
  function release(pool: Pool) {
    // A pool that shrank closes connections as they come back.
    if (pool.open > pool.size()) {
      pool.open--;
      pool.inUse--;
      db.connections--;
      return;
    }
    while (pool.waiters.length) {
      const w = pool.waiters.shift()!;
      if (!w.timer.live) continue;
      w.timer.live = false;
      return w.cb(true);
    }
    pool.inUse--;
    pool.idle++;
  }
  /** A bigger pool lets waiters open new connections at once. */
  function growPools() {
    for (const inst of live()) {
      const pool = inst.pool;
      while (pool.waiters.length && pool.open < pool.size() && db.connections < s.db.maxConnections) {
        const w = pool.waiters.shift()!;
        if (!w.timer.live) continue;
        w.timer.live = false;
        pool.open++;
        pool.inUse++;
        db.connections++;
        at(now + CONNECT_MS, () => w.cb(true));
      }
    }
  }

  // ---- Instance lifecycle ----
  function restart(inst: Instance, version: string, why: string) {
    if (inst.state === "removed") return;
    inst.state = "draining";
    emit({ type: "instance", service: inst.id, label: "draining", message: `${inst.id} stops taking new requests (${why})` });
    const startedAt = now;
    const wait = () => {
      if (inst.threads > 0 && now - startedAt < 10_000) return at(now + 100, wait);
      inst.state = "restarting";
      // The old process's connections close with it, leaked ones included.
      const old = inst.pool;
      db.connections -= old.open;
      old.open = old.idle = old.inUse = 0;
      if (old.leaked) emit({ type: "instance", service: inst.id, label: "connections closed", message: `${inst.id} closed ${old.leaked} leaked connection${old.leaked === 1 ? "" : "s"} on restart` });
      for (const w of [...old.waiters]) w.fail();
      inst.pool = newPool();
      inst.queue = [];
      at(now + RESTART_MS, () => {
        if (inst.state !== "restarting") return;
        inst.version = version;
        inst.broken = brokenAt().has(inst.n);
        inst.keys = new Set(csv(s.env.idp.publishedKids));
        inst.lastJwksFetch = now;
        inst.breaker = { state: "closed", outcomes: [], openedAt: 0, trial: false };
        inst.coalescing = new Map();
        inst.state = "serving";
        inst.healthy = true;
        inst.passes = inst.fails = 0;
        emit({ type: "instance", service: inst.id, label: "restarted", message: `${inst.id} restarted on ${version}${inst.broken ? " (still broken)" : ""}` });
        emit({ type: "jwks", service: inst.id, message: `${inst.id} loaded JWKS at startup: ${[...inst.keys].join(", ")}` });
      });
    };
    wait();
  }
  function rolling(version: string, why: string) {
    live().forEach((inst, i) => at(now + i * ROLL_STEP_MS, () => restart(inst, version, why)));
  }
  function scaleTo(n: number) {
    const current = live();
    for (let i = current.length; i < n; i++) {
      const inst = addInstance("booting");
      emit({ type: "instance", service: inst.id, label: "booting", message: `${inst.id} is starting (${BOOT_MS} ms)` });
    }
    for (const inst of current.slice(n)) retire(inst, "scale in");
  }
  /** Out of rotation at once; its connections close when its last request finishes. */
  function retire(inst: Instance, why: string) {
    inst.state = "removed";
    emit({ type: "instance", service: inst.id, label: "removed", message: `${inst.id} was removed (${why})` });
    const startedAt = now;
    const wait = () => {
      if (inst.threads > 0 && now - startedAt < 10_000) return at(now + 100, wait);
      db.connections -= inst.pool.open;
      inst.pool.open = inst.pool.idle = inst.pool.inUse = 0;
    };
    wait();
  }

  // ---- Health checks ----
  function healthCheck() {
    for (const inst of live()) {
      if (inst.state !== "serving") continue;
      const pass = s.lb.healthCheck === "liveness" ? true : !inst.broken;
      if (pass) {
        inst.fails = 0;
        inst.passes++;
        if (!inst.healthy && inst.passes >= s.lb.threshold) {
          inst.healthy = true;
          emit({ type: "health", service: "gateway", label: inst.id, data: { healthy: 1 }, message: `${inst.id} passed ${s.lb.threshold} ${s.lb.healthCheck} checks: back in rotation` });
        }
      } else {
        inst.passes = 0;
        inst.fails++;
        if (inst.healthy && inst.fails >= s.lb.threshold) {
          inst.healthy = false;
          emit({ type: "health", service: "gateway", label: inst.id, data: { healthy: 0 }, message: `${inst.id} failed ${s.lb.threshold} readiness checks (GET /ready → 503): removed from rotation` });
        }
      }
    }
    at(now + s.lb.intervalMs, healthCheck);
  }
  at(s.lb.intervalMs, healthCheck);

  // ---- Payment provider (external: no spans of its own, only what our calls see) ----
  const provider = { inflight: 0, queue: [] as (() => void)[], charges: new Map<number, number>(), keyed: new Set<number>() };
  function providerCall(req: Req, attempt: number, cb: (result: "approved" | "declined" | "shed") => void) {
    at(now + NET.externalMs, () => {
      if (provider.queue.length >= PROVIDER_QUEUE) return at(now + NET.externalMs, () => cb("shed"));
      const start = () => {
        provider.inflight++;
        const ms = s.env.payment.latencyMs * (0.7 + 0.6 * hash01(seed, req.id, attempt, 11));
        at(now + ms, () => {
          provider.inflight--;
          const declined = hash01(seed, req.id, 13) * 100 < s.env.payment.declinePct;
          if (!declined) {
            const keyed = s.payment.idempotencyKeys;
            if (!keyed || !provider.keyed.has(req.id)) {
              const count = (provider.charges.get(req.id) ?? 0) + 1;
              provider.charges.set(req.id, count);
              if (keyed) provider.keyed.add(req.id);
              if (count > 1) emit({ type: "charge", service: "payments-reconciliation", req: req.id, trace: req.trace, code: "DUPLICATE_CHARGE", message: `Order ${req.id} was charged ${count} times (no idempotency key on retried charge requests)`, data: { duplicate: 1 } });
            }
          }
          at(now + NET.externalMs, () => cb(declined ? "declined" : "approved"));
          if (provider.queue.length && provider.inflight < s.env.payment.capacity) provider.queue.shift()!();
        });
      };
      if (provider.inflight < s.env.payment.capacity) start();
      else provider.queue.push(start);
    });
  }
  function breakerAllows(inst: Instance) {
    if (!s.payment.breaker) return true;
    const b = inst.breaker;
    if (b.state === "open" && now - b.openedAt >= BREAKER.openMs) {
      b.state = "half-open";
      b.trial = false;
      emit({ type: "breaker", service: inst.id, label: "half-open", message: `${inst.id}: payment circuit half-open, letting one trial call through` });
    }
    if (b.state === "closed") return true;
    if (b.state === "half-open" && !b.trial) return (b.trial = true);
    return false;
  }
  function breakerRecord(inst: Instance, ok: boolean) {
    if (!s.payment.breaker) return;
    const b = inst.breaker;
    if (b.state === "half-open") {
      b.trial = false;
      if (ok) {
        b.state = "closed";
        b.outcomes = [];
        emit({ type: "breaker", service: inst.id, label: "closed", message: `${inst.id}: payment circuit closed (trial call succeeded)` });
      } else {
        b.state = "open";
        b.openedAt = now;
        emit({ type: "breaker", service: inst.id, label: "open", message: `${inst.id}: payment circuit re-opened (trial call failed)` });
      }
      return;
    }
    if (b.state !== "closed") return;
    b.outcomes.push(ok);
    if (b.outcomes.length > BREAKER.window) b.outcomes.shift();
    const failures = b.outcomes.filter((o) => !o).length;
    if (b.outcomes.length >= BREAKER.minCalls && failures * 100 >= BREAKER.failurePct * b.outcomes.length) {
      b.state = "open";
      b.openedAt = now;
      emit({ type: "breaker", service: inst.id, label: "open", message: `${inst.id}: payment circuit opened (${failures} of the last ${b.outcomes.length} calls failed)`, data: { failures, calls: b.outcomes.length } });
    }
  }
  /** One charge: attempts with the configured timeout, retries and backoff. */
  function charge(inst: Instance, req: Req, parent: Span, cb: (result: "approved" | "declined" | "error", code?: string) => void) {
    const span = open(req, parent, "store-api", "payment.charge", "internal", { retries: s.payment.retries, timeoutMs: s.payment.timeoutMs, breaker: s.payment.breaker });
    if (!breakerAllows(inst)) {
      close(span, false, { code: "CIRCUIT_OPEN", message: "Payment circuit is open: failing fast without calling the provider" });
      return cb("error", "CIRCUIT_OPEN");
    }
    const tryOnce = (attempt: number) => {
      // The breaker guards every attempt, retries included.
      if (attempt > 1 && !breakerAllows(inst)) {
        close(span, false, { code: "CIRCUIT_OPEN", message: "Payment circuit opened: no further attempts" });
        return cb("error", "CIRCUIT_OPEN");
      }
      const call = open(req, span, "payment-provider", "POST /v1/charges", "client", { attempt, "idempotency.key": s.payment.idempotencyKeys ? `order-${req.id}` : "none", "peer.service": "payment-provider (external)" });
      let settled = false;
      const next = (code: string, message: string) => {
        close(call, false, { code, message });
        breakerRecord(inst, false);
        if (attempt <= s.payment.retries) {
          const delay = s.payment.backoff === "none" ? 0 : Math.round(hash01(seed, req.id, attempt, 17) * 100 * 2 ** attempt);
          at(now + delay, () => tryOnce(attempt + 1));
        } else {
          close(span, false, { code, message: `${message} (after ${attempt} attempt${attempt === 1 ? "" : "s"})` });
          cb("error", code);
        }
      };
      at(now + s.payment.timeoutMs, () => {
        if (settled) return;
        settled = true;
        call.attrs.callerGaveUp = true;
        next("PAYMENT_TIMEOUT", `No answer from the payment provider within ${s.payment.timeoutMs} ms`);
      });
      providerCall(req, attempt, (result) => {
        if (settled) return;
        settled = true;
        if (result === "shed") return next("PAYMENT_503", "Payment provider answered 503 (overloaded)");
        call.attrs["http.status"] = result === "approved" ? 200 : 402;
        close(call, true);
        breakerRecord(inst, true);
        close(span, true);
        span.attrs.result = result;
        cb(result);
      });
    };
    tryOnce(1);
  }

  // ---- Cache ----
  // product → cached at (ms). The run starts with a warm cache: every entry was stored at some point in the last TTL.
  const ttlOf = (product: number) => (product === 0 ? s.cache.saleTtlS : s.cache.ttlS) * 1000;
  const cache = new Map<number, number>(Array.from({ length: POPULATION.products }, (_, k) => [k, -hash01(seed, k, 47) * ttlOf(k)]));
  /** During a flash sale the sale product's price changes every 20 s: a cached copy older than the last change is stale. */
  const lastPriceChange = (product: number) => {
    if (product !== 0 || s.env.hotPct <= 0) return -Infinity;
    const offset = hash01(seed, product, 23) * 20_000;
    return now < offset ? -Infinity : offset + Math.floor((now - offset) / 20_000) * 20_000;
  };

  // ---- Queue and worker ----
  const queue: Message[] = [];
  const worker = { busy: 0, dead: 0, processed: 0 };
  const fraud = { inflight: 0, waiting: [] as (() => void)[] };
  let messageNo = 0;
  function publish(req: Req, parent: Span, done: () => void) {
    const span = open(req, parent, "store-api", "queue.publish order.created", "producer", { "messaging.destination": "orders" });
    at(now + 2, () => {
      queue.push({ id: ++messageNo, req: req.id, trace: req.trace, parent: span.id, enqueuedAt: now, receives: 0, poison: hash01(seed, req.id, 29) * 100 < s.env.poisonPct });
      span.attrs["messaging.message_id"] = `msg-${messageNo}`;
      close(span, true);
      dispatch();
      done();
    });
  }
  const reqs = new Map<number, Req>();
  function dispatch() {
    while (worker.busy < s.worker.concurrency && queue.length) process(queue.shift()!);
  }
  function process(msg: Message) {
    worker.busy++;
    msg.receives++;
    const req = reqs.get(msg.req)!;
    const build = builds.worker[s.worker.version];
    const span = open(req, undefined, "fulfilment-worker", "process order.created", "consumer", { "messaging.message_id": `msg-${msg.id}`, receives: msg.receives, "queue.waitMs": now - msg.enqueuedAt, async: true, version: s.worker.version, followsFrom: msg.parent });
    const finish = (ok: boolean) => {
      worker.busy--;
      if (ok) worker.processed++;
      dispatch();
    };
    if (msg.poison) {
      return at(now + 20, () => {
        close(span, false, { code: "VALIDATION_ERROR", message: `ValidationError: shipping_address.postcode is required (message msg-${msg.id}, receive ${msg.receives})` });
        if (s.worker.deadLetter && msg.receives >= s.worker.maxReceives) {
          worker.dead++;
          emit({ type: "dead-letter", service: "fulfilment-worker", req: req.id, trace: req.trace, code: "DEAD_LETTER", message: `msg-${msg.id} moved to orders.dlq after ${msg.receives} receives` });
        } else at(now + 100, () => {
          queue.push(msg);
          dispatch();
        });
        finish(false);
      });
    }
    const write = () => query(req, span, "INSERT INTO shipments", 6, () => {
      close(span, true);
      finish(true);
    });
    if (!build.fraudCheck) return at(now + 15, write);
    const call = open(req, span, "fraud-service", "POST /v2/score", "client", { "peer.service": "fraud-service (external)" });
    const start = () => {
      fraud.inflight++;
      at(now + NET.externalMs * 2 + s.env.fraud.latencyMs * (0.8 + 0.4 * hash01(seed, req.id, 31)), () => {
        fraud.inflight--;
        close(call, true);
        if (fraud.waiting.length && fraud.inflight < s.env.fraud.capacity) fraud.waiting.shift()!();
        write();
      });
    };
    at(now + 15, () => (fraud.inflight < s.env.fraud.capacity ? start() : fraud.waiting.push(start)));
  }

  // ---- Orders API identity ----
  const tokens = new Map<number, ModelToken>();
  const nowS = () => now / 1000;
  function tokenFor(client: number): ModelToken {
    const t = tokens.get(client);
    if (t && nowS() < t.exp) return t;
    // Tokens that existed before the run were issued at staggered times with the key and issuer in force at the start.
    const issuedAt = t ? nowS() : -hash01(seed, client, 37) * s.env.idp.tokenLifetimeS * 0.95;
    const fresh: ModelToken = { alg: "RS256", kid: s.env.idp.signingKid, iss: s.env.idp.issuer, aud: "https://api.store.example", exp: issuedAt + s.env.idp.tokenLifetimeS, signedWith: "issuer-key", scopes: client % 20 === 0 ? "none" : "orders.read" };
    tokens.set(client, fresh);
    return fresh;
  }
  const attackToken = (req: number): ModelToken => {
    const kind = req % 3;
    if (kind === 0) return { alg: "RS256", kid: s.env.idp.signingKid, iss: s.env.idp.issuer, aud: "https://api.store.example", exp: nowS() + 300, signedWith: "forged", scopes: "orders.read" };
    if (kind === 1) return { alg: "HS256", kid: s.env.idp.signingKid, iss: s.env.idp.issuer, aud: "https://api.store.example", exp: nowS() + 300, signedWith: "public-key-as-hmac", scopes: "orders.read" };
    return { alg: "RS256", kid: s.env.idp.signingKid, iss: s.env.idp.issuer, aud: "https://hr.store.example", exp: nowS() + 300, signedWith: "issuer-key", scopes: "orders.read" };
  };
  /** Token validation for one request; may refetch the JWKS once (rate-limited) when the kid is unknown. */
  function authenticate(inst: Instance, req: Req, parent: Span, cb: (status: number, error?: { code: string; message: string }) => void) {
    const token = req.legit ? tokenFor(req.client) : attackToken(req.id);
    const span = open(req, parent, "store-api", "auth.validate_token", "internal", { "token.kid": token.kid, "token.iss": token.iss, "token.aud": token.aud, "token.alg": token.alg, "token.expS": Math.round(token.exp) });
    const rs = () => ({ issuer: s.auth.issuer, audience: s.auth.audience, algs: s.auth.algs, verifySignature: s.auth.verifySignature, keys: inst.keys });
    const finish = (result: TokenCheck) => {
      if (result.ok) {
        // Authorization: the identity track's deny-by-default policy (src/identity/authz.ts).
        const decision = authorize({ subject: "alice", action: "read", order: "123", credential: token.scopes === "none" ? "no-scope" : "valid" }, ["audience", "scope", "role", "tenant", "ownership"]);
        span.attrs["authz.decision"] = decision.allow ? "allow" : "deny";
        if (!decision.allow) {
          close(span, true);
          span.attrs["authz.reason"] = decision.reason;
          return cb(decision.status, { code: "INSUFFICIENT_SCOPE", message: `403 ${decision.reason}` });
        }
        close(span, true);
        span.attrs.forged = token.signedWith !== "issuer-key" || token.aud !== "https://api.store.example";
        return cb(200);
      }
      span.attrs["auth.failedStep"] = result.step;
      const error = { code: `INVALID_TOKEN_${result.step.toUpperCase()}`, message: `401 invalid_token: ${result.description}` };
      close(span, false, error);
      cb(401, error);
    };
    const result = checkToken(token, rs(), nowS());
    if (!result.ok && result.step === "kid" && s.auth.jwksRefresh === "on-unknown-kid" && now - inst.lastJwksFetch >= JWKS_COOLDOWN_MS) {
      inst.lastJwksFetch = now;
      const fetch = open(req, span, "identity-provider", "GET /.well-known/jwks.json", "client", { "peer.service": "identity-provider" });
      return at(now + 30, () => {
        inst.keys = new Set(csv(s.env.idp.publishedKids));
        close(fetch, true);
        emit({ type: "jwks", service: inst.id, message: `${inst.id} refetched the JWKS after an unknown kid "${token.kid}": ${[...inst.keys].join(", ")}` });
        finish(checkToken(token, rs(), nowS()));
      });
    }
    at(now + 1, () => finish(result));
  }

  // ---- The store API ----
  function handle(inst: Instance, req: Req, server: Span, cb: (status: number, error?: { code: string; message: string }) => void) {
    const build = builds.api[inst.version];
    if (inst.broken) return at(now + 3, () => cb(500, { code: "CONFIG_UNAVAILABLE", message: `${inst.id}: failed to load pricing config from local cache: ENOSPC: no space left on device` }));
    at(now + build.serviceMs, () => {
      if (req.endpoint === "browse") return browse(inst, req, server, cb);
      if (req.endpoint === "checkout") return checkout(inst, req, server, build, cb);
      return orders(inst, req, server, build, cb);
    });
  }

  function withConnection(inst: Instance, req: Req, parent: Span, work: (done: (leak?: boolean) => void) => void, cb: (status: number, error?: Failure) => void, then: () => void) {
    acquire(inst, req, parent, (ok, status, error) => {
      if (!ok) return cb(status!, error);
      const pool = inst.pool;
      work((leak) => {
        if (leak) {
          pool.leaked++;
          emit({ type: "leak", service: inst.id, req: req.id, trace: req.trace, code: "CONNECTION_NOT_RELEASED", message: `Connection checked out by ${req.trace.slice(0, 8)} was never returned (${pool.leaked} leaked on ${inst.id})` });
        } else release(pool);
        then();
      });
    });
  }

  function browse(inst: Instance, req: Req, server: Span, cb: (status: number, error?: { code: string; message: string }) => void) {
    const key = req.product;
    // A product page is two queries on one connection: the product, then its reviews and stock.
    const fromDb = (answer: (status: number, error?: Failure) => void) => withConnection(inst, req, server, (release) => query(req, server, "SELECT product_page WHERE id = $1", s.env.productQueryMs / 2, () => query(req, server, "SELECT reviews_and_stock WHERE product_id = $1", s.env.productQueryMs / 2, () => release())), answer, () => answer(200));
    if (!features.cache) return fromDb(cb);
    const get = open(req, server, "redis", "GET product:{id}", "client", { "cache.key": `product:${key}` });
    at(now + 1, () => {
      const cachedAt = cache.get(key);
      const hit = cachedAt !== undefined && now - cachedAt < ttlOf(key);
      get.attrs["cache.hit"] = hit;
      close(get, true);
      if (hit) {
        const changed = lastPriceChange(key);
        if (cachedAt! < changed) {
          server.attrs.stale = true;
          server.attrs.staleMs = Math.round(now - changed);
        }
        return cb(200);
      }
      const waiting = inst.coalescing.get(key);
      if (s.cache.coalescing && waiting) {
        const join = open(req, server, "store-api", "cache.coalesced_wait", "internal", { "cache.key": `product:${key}` });
        return waiting.push((ok) => {
          close(join, ok);
          cb(ok ? 200 : 503);
        });
      }
      // With coalescing this request leads: later misses for the key on this instance wait for its answer.
      const followers: ((ok: boolean) => void)[] | null = s.cache.coalescing ? [] : null;
      if (followers) inst.coalescing.set(key, followers);
      const settle = (status: number, error?: Failure) => {
        if (followers) {
          if (inst.coalescing.get(key) === followers) inst.coalescing.delete(key);
          for (const w of followers) w(status === 200);
        }
        cb(status, error);
      };
      fromDb((status, error) => {
        if (status !== 200) return settle(status, error);
        const set = open(req, server, "redis", "SET product:{id}", "client", { "cache.key": `product:${key}`, "cache.ttlS": ttlOf(key) / 1000 });
        at(now + 1, () => {
          cache.set(key, now);
          close(set, true);
          settle(200);
        });
      });
    });
  }

  function checkout(inst: Instance, req: Req, server: Span, build: ApiBuild, cb: (status: number, error?: { code: string; message: string }) => void) {
    if (build.discountCrash && req.discount) return at(now + 2, () => cb(500, { code: "UNHANDLED_EXCEPTION", message: `TypeError: Cannot read properties of undefined (reading 'percent') at applyDiscount (checkout.js:88) [${inst.version}]` }));
    const done = (status: number, error?: { code: string; message: string }) => {
      if (status !== 201) return cb(status, error);
      if (!features.queue) return cb(201);
      publish(req, server, () => cb(201));
    };
    const payFailed = (code?: string) => done(503, { code: code === "CIRCUIT_OPEN" ? "PAYMENT_CIRCUIT_OPEN" : "PAYMENT_UNAVAILABLE", message: code === "CIRCUIT_OPEN" ? "Checkout failed fast: payment circuit open" : "Checkout failed: payment provider did not answer in time" });
    if (build.paymentInTransaction) {
      // v-next: the charge runs inside the order's transaction, so the connection is held for the whole payment call.
      let result: "approved" | "declined" | "error" = "error";
      let failCode: string | undefined;
      return withConnection(inst, req, server, (release) => {
        const tx = open(req, server, "store-api", "db.transaction", "internal", { "tx.holdsConnection": true });
        query(req, tx, "INSERT INTO orders (status = 'pending')", 8, () => {
          charge(inst, req, tx, (r, code) => {
            result = r;
            failCode = code;
            query(req, tx, r === "error" ? "ROLLBACK" : "COMMIT", 2, () => {
              close(tx, true);
              release();
            });
          });
        });
      }, cb, () => (result === "approved" ? done(201) : result === "declined" ? cb(402) : payFailed(failCode)));
    }
    withConnection(inst, req, server, (release) => query(req, server, "INSERT INTO orders (status = 'pending')", 8 + (db.indexReady ? 1 : 0), () => release()), cb, () => {
      if (!features.payment) return done(201);
      charge(inst, req, server, (result, code) => {
        if (result === "error") return payFailed(code);
        withConnection(inst, req, server, (release) => query(req, server, `UPDATE orders SET status = '${result === "approved" ? "paid" : "declined"}'`, 4, () => release(result === "declined" && build.leakOnDecline)), cb, () => (result === "approved" ? done(201) : cb(402)));
      });
    });
  }

  function orders(inst: Instance, req: Req, server: Span, build: ApiBuild, cb: (status: number, error?: { code: string; message: string }) => void) {
    const read = () => {
      const scan = build.ordersQuery === "by-customer" && !db.indexReady;
      const statement = build.ordersQuery === "by-customer" ? "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC" : "SELECT * FROM orders WHERE id = $1";
      const plan = scan ? "Seq Scan on orders (rows ≈ 2,000,000)" : build.ordersQuery === "by-customer" ? "Index Scan using orders_customer_id_idx" : "Index Scan using orders_pkey";
      withConnection(inst, req, server, (release) => query(req, server, statement, scan ? 120 : 4, () => release(), { "db.plan": plan }), cb, () => cb(200));
    };
    if (!features.auth) return read();
    authenticate(inst, req, server, (status, error) => (status === 200 ? read() : cb(status, error)));
  }

  function receive(inst: Instance, req: Req, parent: Span, cb: (status: number, error?: { code: string; message: string }) => void, attemptSettled: () => boolean) {
    const server = open(req, parent, "store-api", ROUTES[req.endpoint], "server", { instance: inst.id, version: inst.version });
    const enqueuedAt = now;
    const finish = (status: number, error?: { code: string; message: string }) => {
      inst.threads--;
      server.attrs["http.status"] = status;
      if (attemptSettled()) server.attrs.callerGaveUp = true;
      close(server, status < 500, error);
      while (inst.threads < s.api.concurrency && inst.queue.length) inst.queue.shift()!();
      cb(status, error);
    };
    const start = () => {
      inst.threads++;
      if (now > enqueuedAt) close(open(req, server, "store-api", "wait for a worker thread", "internal", { "queue.waitMs": now - enqueuedAt }, enqueuedAt), true);
      handle(inst, req, server, finish);
    };
    if (inst.threads < s.api.concurrency) return start();
    if (inst.queue.length < s.api.queueLimit) return void inst.queue.push(start);
    server.attrs["http.status"] = 503;
    close(server, false, { code: "SERVER_BUSY", message: `${inst.id}: all ${s.api.concurrency} worker threads busy and ${inst.queue.length} requests already queued` });
    cb(503, server.error);
  }

  // ---- Gateway: rate limits and load balancing ----
  const buckets = new Map<string, { tokens: number; at: number }>();
  let rr = 0;
  function gateway(req: Req, parent: Span, attemptSettled: () => boolean, respond: (status: number, error?: { code: string; message: string }, retryAfterS?: number) => void) {
    const apiKey = req.client === 0 ? "key-scraper" : `key-${req.client}`;
    const span = open(req, parent, "gateway", ROUTES[req.endpoint], "server", { "client.key": apiKey, "client.address": `edge-${req.edge}` });
    const reply = (status: number, error?: { code: string; message: string }, retryAfterS?: number) => {
      span.attrs["http.status"] = status;
      if (attemptSettled()) span.attrs.callerGaveUp = true;
      close(span, status < 500 && status !== 429, error);
      respond(status, error, retryAfterS);
    };
    if (s.gateway.rateLimit) {
      const key = s.gateway.keyBy === "api-key" ? apiKey : `edge-${req.edge}`;
      const b = buckets.get(key) ?? { tokens: s.gateway.burst, at: now };
      b.tokens = Math.min(s.gateway.burst, b.tokens + ((now - b.at) / 1000) * s.gateway.limitRps);
      b.at = now;
      buckets.set(key, b);
      span.attrs["ratelimit.key"] = key;
      span.attrs["ratelimit.remaining"] = Math.floor(b.tokens);
      if (b.tokens < 1) {
        const retryAfter = Math.max(1, Math.ceil((1 - b.tokens) / s.gateway.limitRps));
        span.attrs["retry.after"] = retryAfter;
        return at(now + 1, () => reply(429, { code: "RATE_LIMITED", message: `429 Too Many Requests for ${key} (limit ${s.gateway.limitRps}/s, burst ${s.gateway.burst}); Retry-After: ${retryAfter}` }, retryAfter));
      }
      b.tokens -= 1;
    }
    const targets = instances.filter((i) => i.state === "serving" && i.healthy);
    if (!targets.length) return at(now + 1, () => reply(503, { code: "NO_HEALTHY_UPSTREAM", message: "No healthy store-api instance to route to" }));
    const inst = targets[rr++ % targets.length];
    span.attrs.upstream = inst.id;
    at(now + 1 + NET.internalMs, () => {
      if (inst.state !== "serving") return at(now + NET.internalMs, () => reply(502, { code: "UPSTREAM_CONNECT_ERROR", message: `${inst.id} refused the connection (${inst.state})` }));
      receive(inst, req, span, (status, error) => at(now + NET.internalMs, () => reply(status, error)), attemptSettled);
    });
  }

  // ---- DNS ----
  const resolvers = Array.from({ length: POPULATION.resolvers }, (_, g) => ({ answer: s.dns.record as string, expires: hash01(seed, g, 41) * s.dns.ttlS * 1000 }));
  function resolve(req: Req, parent: Span, cb: (address: string) => void) {
    const r = resolvers[req.resolver];
    if (now < r.expires) return cb(r.answer);
    const span = open(req, parent, "browser", "dns.resolve api.store.example", "client", { "dns.resolver": `resolver-${req.resolver}` });
    at(now + 15, () => {
      r.answer = s.dns.record;
      r.expires = now + s.dns.ttlS * 1000;
      span.attrs["dns.answer"] = `A ${r.answer}`;
      span.attrs["dns.ttlS"] = s.dns.ttlS;
      close(span, true);
      emit({ type: "dns", service: `resolver-${req.resolver}`, label: r.answer, message: `resolver-${req.resolver} cached api.store.example A ${r.answer} for ${s.dns.ttlS} s`, data: { correct: r.answer === "203.0.113.10" ? 1 : 0 } });
      cb(r.answer);
    });
  }

  // ---- Finance app single sign-on ----
  const sessions = Array.from({ length: POPULATION.users }, (_, u) => hash01(seed, u, 43) * s.sso.sessionS * 1000);
  function login(req: Req, parent: Span, deliver: (status: number, error?: { code: string; message: string }) => void) {
    at(now + NET.clientMs, () => {
      const app = open(req, parent, "finance-app", "GET /", "server");
      at(now + 5, () => {
        if (now < sessions[req.user]) {
          close(app, true);
          app.attrs["session"] = "valid";
          return at(now + NET.clientMs, () => deliver(200));
        }
        app.attrs["session"] = "none";
        app.attrs["http.status"] = 302;
        app.attrs.location = `https://idp.store.example/authorize?client_id=finance-app&redirect_uri=https://${s.sso.redirectUri}/callback`;
        close(app, true);
        at(now + NET.clientMs * 2, () => {
          const authz = open(req, parent, "identity-provider", "GET /authorize", "server", { "oidc.client_id": "finance-app", "oidc.redirect_uri": `https://${s.sso.redirectUri}/callback` });
          at(now + 10, () => {
            const registered = csv(s.idp.registeredRedirects);
            if (!registered.includes(s.sso.redirectUri) && !registered.includes("*")) {
              authz.attrs["http.status"] = 400;
              close(authz, false, { code: "OIDC_INVALID_REDIRECT_URI", message: `invalid_request: redirect_uri https://${s.sso.redirectUri}/callback is not registered for client finance-app (registered: ${registered.map((r) => `https://${r}/callback`).join(", ")})` });
              return at(now + NET.clientMs, () => deliver(400, authz.error));
            }
            at(now + 70, () => {
              authz.attrs["http.status"] = 302;
              close(authz, true);
              at(now + NET.clientMs * 2, () => {
                const callback = open(req, parent, "finance-app", "GET /callback", "server");
                const exchange = open(req, callback, "identity-provider", "POST /token", "client", { grant_type: "authorization_code" });
                at(now + 40, () => {
                  close(exchange, true);
                  sessions[req.user] = now + s.sso.sessionS * 1000;
                  callback.attrs["http.status"] = 302;
                  close(callback, true);
                  at(now + NET.clientMs * 2, () => deliver(200));
                });
              });
            });
          });
        });
      });
    });
  }

  // ---- Clients ----
  let requestNo = 0;
  function startRequest(endpoint: Endpoint, legit: boolean, fromScraper: boolean) {
    const id = ++requestNo;
    const trace = hex(Math.floor(hash01(seed, id, 1) * 2 ** 32), 8) + hex(Math.floor(hash01(seed, id, 2) * 2 ** 32), 8) + hex(id, 16);
    const z = hash01(seed, id, 5);
    // Product popularity: Zipf-like (s = 1) over POPULATION.products, product 0 the most popular.
    const product = hash01(seed, id, 9) * 100 < s.env.hotPct ? 0 : Math.min(POPULATION.products - 1, Math.floor(Math.exp(z * Math.log(POPULATION.products + 1)) - 1));
    const req: Req = {
      id, trace, endpoint, legit,
      client: fromScraper ? 0 : 1 + Math.floor(hash01(seed, id, 3) * (endpoint === "orders" ? POPULATION.apiClients : POPULATION.clients - 1)),
      edge: Math.floor(hash01(seed, id, 4) * POPULATION.edges),
      resolver: Math.floor(hash01(seed, id, 6) * POPULATION.resolvers),
      discount: hash01(seed, id, 7) < 0.3,
      product,
      user: Math.floor(hash01(seed, id, 8) * POPULATION.users),
      startedAt: now, seq: 0, root: undefined as unknown as Span,
    };
    reqs.set(id, req);
    req.root = open(req, undefined, endpoint === "orders" ? "partner-app" : "browser", ROUTES[endpoint], "client", { "request.id": `req-${String(id).padStart(6, "0")}`, legit, ...(fromScraper ? { client: "scraper" } : {}) });
    emit({ type: "request", req: id, trace, endpoint, legit });
    const complete = (status: number, failed: boolean, attempts: number) => {
      req.root.attrs["http.status"] = status;
      req.root.attrs.attempts = attempts;
      close(req.root, !failed);
      emit({ type: "complete", req: id, trace, endpoint, status, failed: legit && failed, legit, latencyMs: now - req.startedAt, attempts });
    };
    if (endpoint === "login") return login(req, req.root, (status, error) => {
      if (status !== 200) req.root.error = error;
      complete(status, status !== 200, 1);
    });
    const attempt = (n: number) => {
      const giveUpAt = now + s.client.timeoutMs;
      const span = open(req, req.root, req.root.service, `${ROUTES[endpoint]} (attempt ${n})`, "client", { attempt: n });
      let settled = false;
      const after = (status: number, error?: { code: string; message: string }, retryAfterS?: number) => {
        span.attrs["http.status"] = status;
        close(span, !isFailure(status), error);
        const retryable = status === 0 || status >= 500 || status === 429;
        if (retryable && n <= s.client.retries) {
          const delay = status === 429 && retryAfterS ? retryAfterS * 1000 : Math.round(s.client.backoffMs * 2 ** (n - 1) * (0.5 + hash01(seed, id, n, 19)));
          return at(now + delay, () => attempt(n + 1));
        }
        if (error) req.root.error = error;
        complete(status, isFailure(status), n);
      };
      at(now + s.client.timeoutMs, () => {
        if (settled) return;
        settled = true;
        after(0, { code: "CLIENT_TIMEOUT", message: `No response within ${s.client.timeoutMs} ms` });
      });
      const deliver = (status: number, error?: { code: string; message: string }, retryAfterS?: number) => {
        if (settled) return;
        settled = true;
        after(status, error, retryAfterS);
      };
      const send = () => at(now + NET.clientMs, () => gateway(req, span, () => settled, (status, error, retryAfterS) => at(now + NET.clientMs, () => deliver(status, error, retryAfterS))));
      if (!features.dns) return send();
      resolve(req, span, (address) => {
        if (address === "203.0.113.10") return send();
        // Nothing listens at the wrong address: the connection attempt gets no answer until the client gives up.
        const connect = open(req, span, req.root.service, `tcp.connect ${address}:443`, "client", { "net.peer.ip": address, modelled: true });
        at(Math.min(now + 3000, giveUpAt), () => {
          close(connect, false, { code: "CONNECT_TIMEOUT", message: `connect ETIMEDOUT ${address}:443` });
          deliver(0, connect.error);
        });
      });
    };
    attempt(1);
  }

  const streams: { key: keyof Env["traffic"]; endpoint: Endpoint; legit: boolean; scraper: boolean }[] = [
    { key: "browse", endpoint: "browse", legit: true, scraper: false },
    { key: "checkout", endpoint: "checkout", legit: true, scraper: false },
    { key: "orders", endpoint: "orders", legit: true, scraper: false },
    { key: "login", endpoint: "login", legit: true, scraper: false },
    { key: "scraper", endpoint: "browse", legit: false, scraper: true },
    { key: "attack", endpoint: "orders", legit: false, scraper: false },
  ];
  for (const stream of streams) {
    let k = 0;
    const next = () => {
      const rate = Math.min(LIMITS.maxRps, s.env.traffic[stream.key]);
      if (rate <= 0) return at(now + 250, next);
      const gap = (-Math.log(1 - hash01(seed, salt(stream.key), ++k)) * 1000) / rate;
      at(now + gap, () => {
        startRequest(stream.endpoint, stream.legit, stream.scraper);
        next();
      });
    };
    at(0, next);
  }

  // ---- Changes ----
  function applyChange(change: Change) {
    const before = s;
    if (change.patch) s = applyPatch(s, change.patch);
    emit({ type: "change", label: change.label, kind: change.kind, by: change.by, message: change.patch ? Object.entries(change.patch).map(([k, v]) => `${k} = ${v}`).join(", ") : undefined });
    if (s.api.version !== before.api.version) rolling(s.api.version, `deploying ${s.api.version}`);
    if (s.api.replicas !== before.api.replicas) scaleTo(s.api.replicas);
    if (s.pool.size > before.pool.size || s.db.maxConnections > before.db.maxConnections) growPools();
    if (s.worker.concurrency !== before.worker.concurrency || s.worker.version !== before.worker.version) dispatch();
    if (s.db.ordersIndex && !before.db.ordersIndex) {
      emit({ type: "index", service: "postgres", label: "building", message: "CREATE INDEX CONCURRENTLY orders_customer_id_idx started" });
      // Building reads the whole table: about 8 s of one CPU slot. Queries keep scanning until it is ready.
      dbRun(8000, () => {
        db.indexReady = true;
        emit({ type: "index", service: "postgres", label: "ready", message: "orders_customer_id_idx is valid and used by the planner" });
      }, undefined, true);
    }
    if (!s.db.ordersIndex) db.indexReady = false;
    if (csv(s.env.broken).join() !== csv(before.env.broken).join()) for (const inst of live()) inst.broken = brokenAt().has(inst.n) || (inst.broken && !change.ops?.includes("replace-broken"));
    for (const op of change.ops ?? []) {
      if (op === "restart-api") rolling(s.api.version, "rolling restart");
      if (op === "replace-broken") {
        for (const inst of live().filter((i) => i.broken)) {
          retire(inst, "terminated and replaced");
          const fresh = addInstance("booting");
          fresh.broken = false;
          emit({ type: "instance", service: fresh.id, label: "booting", message: `${fresh.id} is starting to replace ${inst.id}` });
        }
      }
      if (op === "refresh-jwks") for (const inst of live()) {
        inst.keys = new Set(csv(s.env.idp.publishedKids));
        inst.lastJwksFetch = now;
        emit({ type: "jwks", service: inst.id, message: `${inst.id} reloaded the JWKS on request: ${[...inst.keys].join(", ")}` });
      }
    }
  }
  for (const change of input.changes) at(change.atMs, () => applyChange(change));

  // ---- Gauges ----
  const gauge = () => {
    const serving = live();
    const sum = (f: (i: Instance) => number) => serving.reduce((n, i) => n + f(i), 0);
    const data: Record<string, number> = {
      "api.instances": serving.filter((i) => i.state === "serving").length,
      "api.healthy": serving.filter((i) => i.state === "serving" && i.healthy).length,
      "api.threads.busy": sum((i) => i.threads),
      "api.threads.limit": serving.filter((i) => i.state === "serving").length * s.api.concurrency,
      "api.queue": sum((i) => i.queue.length),
      "pool.inUse": sum((i) => i.pool.inUse),
      "pool.size": serving.length * s.pool.size,
      "pool.waiting": sum((i) => i.pool.waiters.length),
      "pool.leaked": sum((i) => i.pool.leaked),
      "db.connections": db.connections,
      "db.maxConnections": s.db.maxConnections,
      "db.active": db.active,
      "db.waiting": db.waiting.length,
      "db.cpuSlots": s.db.cpuSlots,
      "payment.inflight": provider.inflight,
      "payment.queued": provider.queue.length,
      "payment.capacity": s.env.payment.capacity,
      "breaker.open": serving.filter((i) => i.breaker.state !== "closed").length,
      "queue.depth": queue.length,
      "queue.oldestAgeMs": queue.length ? now - Math.min(...queue.map((m) => m.enqueuedAt)) : 0,
      "worker.busy": worker.busy,
      "worker.concurrency": s.worker.concurrency,
      "worker.dead": worker.dead,
      "fraud.inflight": fraud.inflight,
      "fraud.queued": fraud.waiting.length,
      "dns.correct": resolvers.filter((r) => r.answer === "203.0.113.10").length,
      "dns.resolvers": resolvers.length,
    };
    for (const i of serving) {
      data[`${i.id}.threads`] = i.threads;
      data[`${i.id}.pool.inUse`] = i.pool.inUse;
      data[`${i.id}.pool.waiting`] = i.pool.waiters.length;
      data[`${i.id}.healthy`] = i.state === "serving" && i.healthy ? 1 : 0;
    }
    emit({ type: "gauge", data });
    // A pool that has been fully in use with waiters logs one warning per 5 s, as many pool libraries do.
    for (const i of serving) if (i.pool.waiters.length > 0 && i.pool.inUse >= i.pool.size() && Math.round(now) % 5000 === 0) emit({ type: "warning", service: i.id, code: "POOL_EXHAUSTED", message: `${i.id}: connection pool exhausted (${i.pool.inUse}/${i.pool.size()} in use, ${i.pool.waiters.length} waiting${i.pool.leaked ? `, ${i.pool.leaked} never returned` : ""})`, data: { inUse: i.pool.inUse, waiting: i.pool.waiters.length } });
    if (features.queue && queue.length > 200 && Math.round(now) % 5000 === 0) emit({ type: "warning", service: "orders-queue", code: "QUEUE_BACKLOG", message: `orders queue depth ${queue.length}, oldest message ${Math.round((now - Math.min(...queue.map((m) => m.enqueuedAt))) / 1000)} s old`, data: { depth: queue.length } });
    if (now + GAUGE_MS <= endMs) at(now + GAUGE_MS, gauge);
  };
  at(0, gauge);

  while (heap.items.length && !truncated) {
    const task = heap.pop();
    if (task.t > endMs) break;
    now = task.t;
    task.run();
  }
  now = endMs;
  // Work still going on at the end is marked, not invented: its span stays open-ended with a flag.
  for (const span of spans) if (span.end < 0) {
    span.end = endMs;
    span.attrs.unfinished = true;
  }
  return { input, events, spans, endMs, truncated };
}
