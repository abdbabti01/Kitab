// Everything a learner observes is read here from one run's events and spans: metrics, logs, traces, topology health
// and the findings that diagnostics produce. Nothing is sampled from a second model or generated at random. Pure
// TypeScript, no React or DOM.
import { csv, isFailure, type Endpoint, type IncidentEvent, type Run, type Span, type State } from "./engine.ts";

export type Window = { from: number; to: number };
const inWindow = (t: number, w: Window) => t >= w.from && t < w.to;

/** Nearest-rank percentile of already sorted numbers (no interpolation): always one of the observed values. */
export function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

type Index = {
  completes: IncidentEvent[];
  gauges: IncidentEvent[];
  byTrace: Map<string, Span[]>;
  children: Map<string, Span[]>;
  byId: Map<string, Span>;
};
const indexes = new WeakMap<Run, Index>();
export function index(run: Run): Index {
  let ix = indexes.get(run);
  if (ix) return ix;
  const byTrace = new Map<string, Span[]>();
  const children = new Map<string, Span[]>();
  const byId = new Map<string, Span>();
  for (const span of run.spans) {
    byId.set(span.id, span);
    const list = byTrace.get(span.trace) ?? [];
    list.push(span);
    byTrace.set(span.trace, list);
    if (span.parent) {
      const kids = children.get(span.parent) ?? [];
      kids.push(span);
      children.set(span.parent, kids);
    }
  }
  ix = { completes: run.events.filter((e) => e.type === "complete"), gauges: run.events.filter((e) => e.type === "gauge"), byTrace, children, byId };
  indexes.set(run, ix);
  return ix;
}

// ---- Request facts ----

export type RequestFacts = {
  requests: number;
  failures: number;
  /** Percent of legitimate requests that failed. */
  errorRate: number;
  p50: number;
  p95: number;
  p99: number;
  /** Completed legitimate requests per second. */
  throughput: number;
  /** Extra attempts clients made per logical request. */
  clientRetriesPerRequest: number;
  byStatus: Record<string, number>;
};

export function requestFacts(run: Run, w: Window, endpoint?: Endpoint): RequestFacts {
  const done = index(run).completes.filter((e) => e.legit && inWindow(e.t, w) && (!endpoint || e.endpoint === endpoint));
  const latencies = done.map((e) => e.latencyMs!).sort((a, b) => a - b);
  const failures = done.filter((e) => e.failed).length;
  const byStatus: Record<string, number> = {};
  for (const e of done) byStatus[String(e.status)] = (byStatus[String(e.status)] ?? 0) + 1;
  const seconds = Math.max(0.001, (w.to - w.from) / 1000);
  return {
    requests: done.length,
    failures,
    errorRate: done.length ? (failures * 100) / done.length : 0,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    throughput: done.length / seconds,
    clientRetriesPerRequest: done.length ? done.reduce((n, e) => n + (e.attempts! - 1), 0) / done.length : 0,
    byStatus,
  };
}

export function gaugeStats(run: Run, w: Window, key: string) {
  const values = index(run).gauges.filter((e) => inWindow(e.t, w) && e.data![key] !== undefined).map((e) => e.data![key]);
  if (!values.length) return { max: 0, min: 0, mean: 0, first: 0, last: 0, samples: 0 };
  return { max: Math.max(...values), min: Math.min(...values), mean: values.reduce((a, b) => a + b, 0) / values.length, first: values[0], last: values.at(-1)!, samples: values.length };
}
export function gaugeAt(run: Run, t: number) {
  const gauges = index(run).gauges;
  let found = gauges[0];
  for (const g of gauges) {
    if (g.t > t) break;
    found = g;
  }
  return found?.data ?? {};
}

const spansIn = (run: Run, w: Window, pick: (s: Span) => boolean) => run.spans.filter((s) => s.end >= 0 && inWindow(s.end, w) && !s.attrs.unfinished && pick(s));
const dur = (s: Span) => s.end - s.start;
export function spanStats(spans: Span[]) {
  const d = spans.map(dur).sort((a, b) => a - b);
  const errors = spans.filter((s) => s.status === "error").length;
  return { calls: spans.length, errors, errorRate: spans.length ? (errors * 100) / spans.length : 0, p50: percentile(d, 50), p95: percentile(d, 95), max: d.at(-1) ?? 0 };
}

// ---- Metrics over time ----

export type MetricKey =
  | "rps" | "errorRate" | "p50" | "p95" | "p99" | "retries" | "status2xx" | "status4xx" | "status429" | "status401" | "status5xx" | "noResponse"
  | "paymentP95" | "dbP95" | "cacheHitRate" | "poolInUse" | "poolWaiting" | "poolSize" | "threadsBusy" | "threadsLimit" | "dbActive" | "dbCpuSlots" | "dbWaiting"
  | "dbConnections" | "queueDepth" | "queueAgeS" | "workerBusy" | "healthyInstances" | "paymentInflight" | "duplicateCharges" | "gatewayRps";

export type MetricDef = { key: MetricKey; label: string; unit: string; how: string; group: "Customers" | "Latency" | "Dependencies" | "Saturation" | "Queues" };

/** How each metric is computed: the Metrics view shows this text beside the chart. */
export const METRICS: MetricDef[] = [
  { key: "rps", label: "Completed requests", unit: "req/s", group: "Customers", how: "Legitimate logical requests that ended in the bucket (success or failure), divided by the bucket's seconds. Measured in the browser or partner app (real-user monitoring)." },
  { key: "errorRate", label: "Error rate", unit: "%", group: "Customers", how: "Failed ÷ completed legitimate requests in the bucket. Failed: no answer, 5xx, 429 or 401 after the client's retries. 402 (card declined) and 403 (missing scope) are correct answers. Scraper and attack traffic is excluded." },
  { key: "p50", label: "p50 latency", unit: "ms", group: "Latency", how: "Nearest-rank 50th percentile of the latency of every completed legitimate request in the bucket, retries included, measured by the client. Always one of the simulated values." },
  { key: "p95", label: "p95 latency", unit: "ms", group: "Latency", how: "Nearest-rank 95th percentile of the same samples: 95% of requests finished within it." },
  { key: "p99", label: "p99 latency", unit: "ms", group: "Latency", how: "Nearest-rank 99th percentile of the same samples. With few requests in a bucket it is close to the slowest one." },
  { key: "retries", label: "Retries", unit: "attempts/s", group: "Customers", how: "Client attempts after the first, plus payment-call attempts after the first, that ended in the bucket, per second." },
  { key: "status2xx", label: "2xx answers", unit: "req/s", group: "Customers", how: "Completed legitimate requests whose final status was 2xx, per second." },
  { key: "status4xx", label: "Other 4xx answers", unit: "req/s", group: "Customers", how: "Final status 400, 402, 403 or 404, per second." },
  { key: "status429", label: "429 answers", unit: "req/s", group: "Customers", how: "Final status 429 (rate limited), per second." },
  { key: "status401", label: "401 answers", unit: "req/s", group: "Customers", how: "Final status 401 (authentication failed), per second." },
  { key: "status5xx", label: "5xx answers", unit: "req/s", group: "Customers", how: "Final status 500-599, per second." },
  { key: "noResponse", label: "No response", unit: "req/s", group: "Customers", how: "Requests that ended with no answer at all (the client timed out or could not connect), per second." },
  { key: "gatewayRps", label: "Requests reaching the gateway", unit: "req/s", group: "Customers", how: "Gateway server spans that ended in the bucket, per second: what the servers see, which can differ from what clients send." },
  { key: "paymentP95", label: "Payment call p95", unit: "ms", group: "Dependencies", how: "p95 duration of each POST /v1/charges attempt the store made, ended in the bucket, including timeouts." },
  { key: "dbP95", label: "Database query p95", unit: "ms", group: "Dependencies", how: "p95 duration of postgres query spans ended in the bucket, from submission (including time waiting for a CPU slot) to result." },
  { key: "cacheHitRate", label: "Cache hit rate", unit: "%", group: "Dependencies", how: "Cache GETs that found a fresh entry ÷ all cache GETs ended in the bucket." },
  { key: "poolInUse", label: "Pool connections in use", unit: "connections", group: "Saturation", how: "Maximum of the gauge readings in the bucket (read every 500 ms), summed over instances. Leaked connections count as in use." },
  { key: "poolSize", label: "Pool size", unit: "connections", group: "Saturation", how: "Configured pool size × instances, at the gauge readings." },
  { key: "poolWaiting", label: "Requests waiting for a connection", unit: "requests", group: "Saturation", how: "Maximum gauge reading in the bucket, summed over instances." },
  { key: "threadsBusy", label: "API worker threads busy", unit: "threads", group: "Saturation", how: "Maximum gauge reading in the bucket, summed over serving instances." },
  { key: "threadsLimit", label: "API worker threads available", unit: "threads", group: "Saturation", how: "Concurrency × serving instances at the gauge readings." },
  { key: "dbActive", label: "Database queries running", unit: "queries", group: "Saturation", how: "Maximum gauge reading of queries holding a database CPU slot." },
  { key: "dbCpuSlots", label: "Database CPU slots", unit: "slots", group: "Saturation", how: "Configured concurrent query capacity." },
  { key: "dbWaiting", label: "Queries waiting for CPU", unit: "queries", group: "Saturation", how: "Maximum gauge reading of queries queued inside the database." },
  { key: "dbConnections", label: "Database connections open", unit: "connections", group: "Saturation", how: "Maximum gauge reading of connections open to the database from every pool." },
  { key: "healthyInstances", label: "Instances in rotation", unit: "instances", group: "Saturation", how: "Minimum gauge reading of instances the gateway considers healthy and routes to." },
  { key: "paymentInflight", label: "Payment calls in flight", unit: "calls", group: "Dependencies", how: "Maximum gauge reading of charge requests the provider is processing for the store (the provider reports this on its dashboard)." },
  { key: "duplicateCharges", label: "Duplicate charges", unit: "charges", group: "Dependencies", how: "Charges the payments reconciliation job found for an order that was already charged, per bucket." },
  { key: "queueDepth", label: "Queue depth", unit: "messages", group: "Queues", how: "Maximum gauge reading of messages waiting in the orders queue." },
  { key: "queueAgeS", label: "Oldest message age", unit: "s", group: "Queues", how: "Maximum gauge reading of the age of the oldest waiting message." },
  { key: "workerBusy", label: "Worker slots busy", unit: "messages", group: "Queues", how: "Maximum gauge reading of messages being processed at once." },
];

export type Bucket = { from: number; to: number; values: Record<MetricKey, number> };
export const BUCKET_MS = 2000;

/** Every metric per bucket over the whole run. Bounded: at most endMs / BUCKET_MS buckets (60 for a 120 s run). */
const bucketCache = new WeakMap<Run, Bucket[]>();
export function buckets(run: Run): Bucket[] {
  const cached = bucketCache.get(run);
  if (cached) return cached;
  const n = Math.ceil(run.endMs / BUCKET_MS);
  const out: Bucket[] = Array.from({ length: n }, (_, i) => ({ from: i * BUCKET_MS, to: (i + 1) * BUCKET_MS, values: {} as Record<MetricKey, number> }));
  const lat: number[][] = out.map(() => []);
  const counts = out.map(() => ({ done: 0, failed: 0, retries: 0, s2: 0, s4: 0, s429: 0, s401: 0, s5: 0, s0: 0, gateway: 0, hits: 0, gets: 0, dup: 0 }));
  const pay: number[][] = out.map(() => []);
  const dbq: number[][] = out.map(() => []);
  const at = (t: number) => Math.min(n - 1, Math.floor(t / BUCKET_MS));
  for (const e of index(run).completes) {
    if (!e.legit) continue;
    const c = counts[at(e.t)];
    c.done++;
    if (e.failed) c.failed++;
    c.retries += e.attempts! - 1;
    lat[at(e.t)].push(e.latencyMs!);
    const st = e.status!;
    if (st === 0) c.s0++;
    else if (st >= 500) c.s5++;
    else if (st === 429) c.s429++;
    else if (st === 401) c.s401++;
    else if (st >= 400) c.s4++;
    else c.s2++;
  }
  for (const e of run.events) if (e.type === "charge" && e.data?.duplicate) counts[at(e.t)].dup++;
  for (const s of run.spans) {
    if (s.end < 0 || s.attrs.unfinished) continue;
    const b = at(s.end);
    if (s.service === "gateway" && s.kind === "server") counts[b].gateway++;
    else if (s.name === "POST /v1/charges") {
      pay[b].push(dur(s));
      if ((s.attrs.attempt as number) > 1) counts[b].retries++;
    } else if (s.service === "postgres") dbq[b].push(dur(s));
    else if (s.name === "GET product:{id}") {
      counts[b].gets++;
      if (s.attrs["cache.hit"]) counts[b].hits++;
    }
  }
  const gauges = index(run).gauges;
  out.forEach((bucket, i) => {
    const sec = BUCKET_MS / 1000;
    const c = counts[i];
    const l = lat[i].sort((a, b) => a - b);
    const g = gauges.filter((e) => e.t >= bucket.from && e.t < bucket.to).map((e) => e.data!);
    const max = (k: string) => (g.length ? Math.max(...g.map((d) => d[k] ?? 0)) : 0);
    const min = (k: string) => (g.length ? Math.min(...g.map((d) => d[k] ?? 0)) : 0);
    bucket.values = {
      rps: c.done / sec, errorRate: c.done ? (c.failed * 100) / c.done : 0, p50: percentile(l, 50), p95: percentile(l, 95), p99: percentile(l, 99), retries: c.retries / sec,
      status2xx: c.s2 / sec, status4xx: c.s4 / sec, status429: c.s429 / sec, status401: c.s401 / sec, status5xx: c.s5 / sec, noResponse: c.s0 / sec, gatewayRps: c.gateway / sec,
      paymentP95: percentile(pay[i].sort((a, b) => a - b), 95), dbP95: percentile(dbq[i].sort((a, b) => a - b), 95), cacheHitRate: c.gets ? (c.hits * 100) / c.gets : 0,
      poolInUse: max("pool.inUse"), poolSize: max("pool.size"), poolWaiting: max("pool.waiting"), threadsBusy: max("api.threads.busy"), threadsLimit: max("api.threads.limit"),
      dbActive: max("db.active"), dbCpuSlots: max("db.cpuSlots"), dbWaiting: max("db.waiting"), dbConnections: max("db.connections"), healthyInstances: min("api.healthy"),
      paymentInflight: max("payment.inflight"), duplicateCharges: c.dup, queueDepth: max("queue.depth"), queueAgeS: max("queue.oldestAgeMs") / 1000, workerBusy: max("worker.busy"),
    };
  });
  bucketCache.set(run, out);
  return out;
}

// ---- Logs ----

export type Level = "INFO" | "WARN" | "ERROR";
export type LogLine = { id: string; t: number; service: string; level: Level; message: string; req?: number; trace?: string; span?: string; code?: string };

/**
 * Log lines, each from one span or event of the run: access logs from gateway spans, an error line where an error
 * started (the span whose children don't carry the same error), and lines for state events. Tokens, passwords and
 * card data are never in a span or event, so they can't reach a log.
 */
const logCache = new WeakMap<Run, LogLine[]>();
export function logs(run: Run): LogLine[] {
  const cached = logCache.get(run);
  if (cached) return cached;
  const { children, byId } = index(run);
  const out: LogLine[] = [];
  const instanceOf = (s: Span): string => {
    for (let p: Span | undefined = s; p; p = p.parent ? byId.get(p.parent) : undefined) if (p.attrs.instance) return String(p.attrs.instance);
    return s.service;
  };
  for (const s of run.spans) {
    if (s.end < 0 || s.attrs.unfinished) continue;
    const base = { t: s.end, req: s.req, trace: s.trace, span: s.id };
    if (s.service === "gateway" && s.kind === "server") {
      const status = Number(s.attrs["http.status"] ?? 0);
      out.push({ ...base, id: `a${s.id}`, service: "gateway", level: status >= 500 ? "ERROR" : status >= 400 ? "WARN" : "INFO", message: `${s.name} ${status} ${Math.round(dur(s))}ms key=${s.attrs["client.key"]}${s.attrs.upstream ? ` upstream=${s.attrs.upstream}` : ""}${s.attrs["retry.after"] ? ` retry_after=${s.attrs["retry.after"]}` : ""}`, code: s.error?.code });
      continue;
    }
    if (s.status !== "error" || !s.error) continue;
    if ((children.get(s.id) ?? []).some((c) => c.error?.code === s.error!.code)) continue;
    const service = s.service === "store-api" || s.service === "postgres" ? instanceOf(s) : s.service === "payment-provider" ? instanceOf(s) : s.service;
    const level: Level = s.name === "POST /v1/charges" || s.kind === "client" && s.service === "browser" ? "WARN" : "ERROR";
    const prefix = s.service === "browser" || s.service === "partner-app" ? `RUM ${s.name}: ` : s.name === "POST /v1/charges" ? `payment call attempt ${s.attrs.attempt} failed: ` : "";
    out.push({ ...base, id: `e${s.id}`, service, level, message: `${prefix}${s.error.message}`, code: s.error.code });
  }
  for (const e of run.events) {
    const base = { id: `v${e.i}`, t: e.t, req: e.req, trace: e.trace };
    if (e.type === "change") out.push({ ...base, service: e.by === "learner" ? "you" : "deploys", level: "INFO", message: `${e.label}${e.message ? ` (${e.message.replace(/env\.[^,]+(, )?/g, "").replace(/, $/, "")})` : ""}` });
    else if (e.type === "health" || e.type === "breaker" || e.type === "dead-letter" || e.type === "warning" || e.type === "leak") out.push({ ...base, service: e.service ?? "", level: e.type === "health" && e.data?.healthy ? "INFO" : "WARN", message: e.message ?? "", code: e.code });
    else if (e.type === "charge" || e.type === "instance" || e.type === "jwks" || e.type === "index") out.push({ ...base, service: e.service ?? "", level: e.type === "charge" ? "ERROR" : "INFO", message: e.message ?? "", code: e.code });
  }
  // Change lines mention only the store's own settings: env.* is the outside world, never in a log.
  for (const line of out) if (line.service === "deploys") line.message = line.message.replace(/ \(\)$/, "");
  out.sort((a, b) => a.t - b.t || (a.id < b.id ? -1 : 1));
  logCache.set(run, out);
  return out;
}

// ---- Traces ----

export type TraceSummary = { trace: string; req: number; endpoint: Endpoint; start: number; end: number; status: number; failed: boolean; attempts: number };
export function traces(run: Run): TraceSummary[] {
  const { byTrace } = index(run);
  return index(run).completes.filter((e) => e.legit).map((e) => {
    const root = byTrace.get(e.trace!)![0];
    return { trace: e.trace!, req: e.req!, endpoint: e.endpoint!, start: root.start, end: e.t, status: e.status!, failed: !!e.failed, attempts: e.attempts! };
  });
}

export type WaterfallRow = { span: Span; depth: number };
/** Spans of one trace as a tree in start order, children under their parent. Asynchronous work (the worker) follows its producer. */
export function waterfall(run: Run, trace: string): WaterfallRow[] {
  const spans = index(run).byTrace.get(trace) ?? [];
  const kids = new Map<string | undefined, Span[]>();
  for (const s of spans) {
    const parent = s.parent ?? (s.attrs.followsFrom as string | undefined);
    const list = kids.get(parent) ?? [];
    list.push(s);
    kids.set(parent, list);
  }
  const rows: WaterfallRow[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const s of (kids.get(parent) ?? []).sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1))) {
      rows.push({ span: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return rows;
}

export const CATEGORY_FINDINGS: Partial<Record<Category, string>> = { "connection pool wait": "latency.pool-wait", "payment provider": "latency.payment", database: "latency.database", "thread wait": "latency.thread-wait", "DNS and connect": "latency.connect", "token validation": "latency.auth", cache: "latency.cache", "fraud service": "latency.fraud" };
export type Category = "thread wait" | "connection pool wait" | "database" | "payment provider" | "cache" | "token validation" | "DNS and connect" | "identity provider" | "fraud service" | "queue" | "network and other";
export function categoryOf(s: Span): Category | null {
  if (s.name === "wait for a worker thread") return "thread wait";
  if (s.name === "db.pool.acquire") return "connection pool wait";
  if (s.service === "postgres") return "database";
  if (s.name === "POST /v1/charges") return "payment provider";
  if (s.service === "redis" || s.name === "cache.coalesced_wait") return "cache";
  if (s.name === "auth.validate_token") return "token validation";
  if (s.name.startsWith("dns.") || s.name.startsWith("tcp.")) return "DNS and connect";
  if (s.service === "identity-provider") return "identity provider";
  if (s.service === "fraud-service") return "fraud service";
  if (s.kind === "producer") return "queue";
  return null;
}
/** Time per category in one trace (leaf work only), and which category took the most. */
export function timeByCategory(run: Run, trace: string) {
  const out = new Map<Category, number>();
  const spans = index(run).byTrace.get(trace) ?? [];
  for (const s of spans) {
    if (s.attrs.async) continue;
    const c = categoryOf(s);
    if (c) out.set(c, (out.get(c) ?? 0) + dur(s));
  }
  const root = spans[0];
  const total = root ? dur(root) : 0;
  const known = [...out.values()].reduce((a, b) => a + b, 0);
  if (total > known) out.set("network and other", total - known);
  const top = [...out.entries()].sort((a, b) => b[1] - a[1])[0];
  return { byCategory: out, top: top?.[0] ?? null, total };
}

// ---- Topology ----

export type ComponentId = "browser" | "partner-app" | "dns" | "gateway" | "store-api" | "redis" | "postgres" | "payment-provider" | "orders-queue" | "fulfilment-worker" | "fraud-service" | "identity-provider" | "finance-app";
export type Health = "healthy" | "degraded" | "failing" | "idle" | "no-telemetry";
export type ComponentHealth = { id: ComponentId; health: Health; detail: string };

export const COMPONENT_LABELS: Record<ComponentId, string> = {
  browser: "Browsers (RUM)", "partner-app": "Partner apps", dns: "DNS", gateway: "Gateway / load balancer", "store-api": "Store API", redis: "Cache (Redis)", postgres: "Database (Postgres)",
  "payment-provider": "Payment provider", "orders-queue": "Orders queue", "fulfilment-worker": "Fulfilment worker", "fraud-service": "Fraud service", "identity-provider": "Identity provider", "finance-app": "Finance app",
};

/**
 * Health of each component at time t, from the 5 s of telemetry before it: error rates of its spans (or of our calls
 * to it, for third parties) and saturation gauges. Rules: failing ≥ 20% errors; degraded ≥ 2% errors or saturation
 * ≥ 90% or a growing backlog; idle with no traffic. DNS has no telemetry of its own: a service map can't see it.
 */
export function topology(run: Run, t: number, components: ComponentId[]): ComponentHealth[] {
  const w = { from: Math.max(0, t - 5000), to: t + 1 };
  const g = gaugeAt(run, t);
  const judge = (spans: Span[], saturation = 0, extra = ""): { health: Health; detail: string } => {
    const st = spanStats(spans);
    if (!st.calls) return { health: "idle", detail: "No traffic in the last 5 s" };
    const health: Health = st.errorRate >= 20 ? "failing" : st.errorRate >= 2 || saturation >= 0.9 ? "degraded" : "healthy";
    return { health, detail: `${st.calls} calls, ${st.errorRate.toFixed(1)}% errors, p95 ${Math.round(st.p95)} ms${saturation ? `, ${Math.round(saturation * 100)}% saturated` : ""}${extra}` };
  };
  return components.map((id) => {
    const of = (pick: (s: Span) => boolean) => spansIn(run, w, pick);
    switch (id) {
      case "browser":
      case "partner-app":
        return { id, ...judge(of((s) => s.service === id && !s.parent && s.attrs.legit === true)) };
      case "dns":
        return { id, health: "no-telemetry", detail: "The store runs no DNS servers: their state is visible only by querying resolvers" };
      case "gateway":
        return { id, ...judge(of((s) => s.service === "gateway" && s.kind === "server")) };
      case "store-api": {
        const sat = Math.max((g["api.threads.busy"] ?? 0) / Math.max(1, g["api.threads.limit"] ?? 1), (g["pool.inUse"] ?? 0) / Math.max(1, g["pool.size"] ?? 1));
        return { id, ...judge(of((s) => s.service === "store-api" && s.kind === "server"), sat, `; ${g["api.healthy"] ?? 0} of ${g["api.instances"] ?? 0} instances in rotation`) };
      }
      case "redis":
        return { id, ...judge(of((s) => s.service === "redis")) };
      case "postgres":
        return { id, ...judge(of((s) => s.service === "postgres"), Math.max((g["db.active"] ?? 0) / Math.max(1, g["db.cpuSlots"] ?? 1), (g["db.connections"] ?? 0) / Math.max(1, g["db.maxConnections"] ?? 1))) };
      case "payment-provider":
        return { id, ...judge(of((s) => s.name === "POST /v1/charges")) };
      case "orders-queue": {
        const depth = gaugeStats(run, w, "queue.depth");
        const growing = depth.last > depth.first + 20;
        return { id, health: depth.samples === 0 ? "idle" : growing || depth.last > 500 ? "degraded" : "healthy", detail: `${depth.last} messages waiting${growing ? ", growing" : ""}; oldest ${Math.round((g["queue.oldestAgeMs"] ?? 0) / 1000)} s` };
      }
      case "fulfilment-worker":
        return { id, ...judge(of((s) => s.service === "fulfilment-worker"), (g["worker.busy"] ?? 0) / Math.max(1, g["worker.concurrency"] ?? 1)) };
      case "fraud-service":
        return { id, ...judge(of((s) => s.service === "fraud-service")) };
      case "identity-provider":
        return { id, ...judge(of((s) => s.service === "identity-provider")) };
      case "finance-app":
        return { id, ...judge(of((s) => s.service === "finance-app")) };
    }
  });
}

// ---- Diagnostics and findings ----

/** One fact a diagnostic established from the run, with its numbers. Evidence a learner attaches is one of these. */
export type Finding = { id: string; title: string; detail: string; abnormal: boolean };
export type DiagnosticResult = { rows: [string, string][]; findings: Finding[] };
export type Context = { run: Run; during: Window; before: Window; state: State };
export type Diagnostic = { id: string; title: string; question: string; needs?: (keyof Run["input"]["features"])[]; run: (ctx: Context) => DiagnosticResult };

const pct = (n: number) => `${n.toFixed(1)}%`;
const msf = (n: number) => `${Math.round(n).toLocaleString("en")} ms`;
const f = (id: string, title: string, detail: string, abnormal: boolean): Finding => ({ id, title, detail, abnormal });

export const DIAGNOSTICS: Diagnostic[] = [
  {
    id: "status-codes",
    title: "Break failures down by status and error code",
    question: "What exactly are customers getting back?",
    run: ({ run, during }) => {
      const facts = requestFacts(run, during);
      const codes = new Map<string, number>();
      for (const s of spansIn(run, during, (x) => !x.parent && x.attrs.legit === true && x.status === "error")) codes.set(s.error?.code ?? "?", (codes.get(s.error?.code ?? "?") ?? 0) + 1);
      const top = [...codes.entries()].sort((a, b) => b[1] - a[1]);
      const share = (pred: (st: number) => boolean) => facts.requests ? (Object.entries(facts.byStatus).filter(([k]) => pred(Number(k))).reduce((n, [, v]) => n + v, 0) * 100) / facts.requests : 0;
      const s5 = share((x) => x >= 500), s401 = share((x) => x === 401), s429 = share((x) => x === 429), s0 = share((x) => x === 0), s403 = share((x) => x === 403), s400 = share((x) => x === 400);
      const findings: Finding[] = [];
      if (s5 >= 2) findings.push(f("errors.5xx", "Server errors (5xx)", `${pct(s5)} of requests ended in 5xx; top error codes: ${top.slice(0, 3).map(([c, n]) => `${c} ×${n}`).join(", ")}`, true));
      if (s401 >= 2) findings.push(f("errors.401", "Authentication failures (401)", `${pct(s401)} of requests ended in 401, against ${pct(s403)} 403`, true));
      if (s429 >= 2) findings.push(f("errors.429", "Rate limited (429)", `${pct(s429)} of legitimate requests ended in 429`, true));
      if (s0 >= 2) findings.push(f("errors.no-response", "No response at all", `${pct(s0)} of requests got no answer (${top.filter(([c]) => c === "CONNECT_TIMEOUT" || c === "CLIENT_TIMEOUT").map(([c, n]) => `${c} ×${n}`).join(", ")})`, true));
      if (top.some(([c]) => c === "UNHANDLED_EXCEPTION")) findings.push(f("errors.unhandled-exception", "Our own code throws", `${codes.get("UNHANDLED_EXCEPTION")} requests failed with an unhandled exception in the store-api handler`, true));
      if (s400 >= 2) findings.push(f("errors.400", "Bad request (400)", `${pct(s400)} of requests ended in 400; top: ${top.slice(0, 2).map(([c, n]) => `${c} ×${n}`).join(", ")}`, true));
      if (!findings.length) findings.push(f("errors.none", "Errors at baseline", `${pct(facts.errorRate)} of requests failed`, false));
      return { rows: [["Requests", String(facts.requests)], ["Failed", `${facts.failures} (${pct(facts.errorRate)})`], ["Status counts", Object.entries(facts.byStatus).map(([k, v]) => `${k === "0" ? "no response" : k}: ${v}`).join(", ")], ["Top error codes", top.slice(0, 5).map(([c, n]) => `${c} ×${n}`).join(", ") || "none"]], findings };
    },
  },
  {
    id: "slow-traces",
    title: "Inspect the slowest and failed request traces",
    question: "Where does a bad request spend its time?",
    run: ({ run, during }) => {
      const bad = traces(run).filter((x) => inWindow(x.end, during) && (x.failed || x.end - x.start > 1000)).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 40);
      const totals = new Map<Category, number>();
      let holds = 0, checkouts = 0;
      const { byTrace, children } = index(run);
      for (const t of bad) {
        for (const [c, ms] of timeByCategory(run, t.trace).byCategory) totals.set(c, (totals.get(c) ?? 0) + ms);
        for (const s of byTrace.get(t.trace) ?? []) if (s.name === "db.transaction") {
          checkouts++;
          if ((children.get(s.id) ?? []).some((c) => c.name === "payment.charge")) holds++;
        }
      }
      const sum = [...totals.values()].reduce((a, b) => a + b, 0);
      const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
      const findings: Finding[] = [];
      if (!bad.length) findings.push(f("latency.normal", "No slow or failed requests", "Every request in the window finished within 1 s", false));
      else {
        // Every category that takes at least 30% of the time is a finding: a request can wait on two things in turn.
        for (const [cat, ms] of ranked.filter(([, ms], i) => i === 0 || (ms * 100) / sum >= 30)) if (CATEGORY_FINDINGS[cat]) findings.push(f(CATEGORY_FINDINGS[cat]!, `Time goes to: ${cat}`, `In the ${bad.length} slowest or failed traces, ${cat} took ${pct((ms * 100) / sum)} of the time`, true));
      }
      if (holds) findings.push(f("pool.held-during-payment", "Connection held during the payment call", `In ${holds} of ${checkouts} checkout traces the payment call runs inside db.transaction, so the request keeps its database connection while it waits for the provider`, true));
      else if (bad.some((t) => t.endpoint === "checkout")) findings.push(f("pool.not-held", "No connection held across the payment call", "In the inspected checkout traces every query finishes, and its connection is released, before the payment call starts", false));
      return { rows: [["Traces inspected", String(bad.length)], ...ranked.slice(0, 6).map(([c, ms]) => [c, `${pct((ms * 100) / Math.max(1, sum))} of time`] as [string, string])], findings };
    },
  },
  {
    id: "pool",
    title: "Check database connection pool utilization",
    question: "Are requests waiting for database connections?",
    run: ({ run, during, state }) => {
      const inUse = gaugeStats(run, during, "pool.inUse"), size = gaugeStats(run, during, "pool.size"), waiting = gaugeStats(run, during, "pool.waiting"), leaked = gaugeStats(run, during, "pool.leaked");
      const acquires = spansIn(run, during, (s) => s.name === "db.pool.acquire");
      const st = spanStats(acquires);
      const timeouts = acquires.filter((s) => s.error?.code === "POOL_TIMEOUT").length;
      const tooMany = acquires.filter((s) => s.error?.code === "DB_TOO_MANY_CLIENTS").length;
      const findings: Finding[] = [];
      if (waiting.max > 0 && inUse.max >= size.max) findings.push(f("pool.exhausted", "Pool exhausted", `All ${size.max} connections were in use with up to ${waiting.max} requests waiting; ${timeouts} acquisitions timed out after ${state.pool.acquireTimeoutMs} ms`, true));
      else findings.push(f("pool.ok", "Pool has free connections", `At most ${inUse.max} of ${size.max} connections in use; no request waited`, false));
      if (leaked.last > 0) findings.push(f("pool.leak", "Connections never returned", `${leaked.last} connections are checked out and were never released; in use rose from ${inUse.first} to ${inUse.last} over the window`, true));
      else if (acquires.length) findings.push(f("pool.no-leak", "Every connection comes back", `Connections in use went up and down with traffic (${inUse.min} to ${inUse.max}); none was left checked out`, false));
      if (tooMany) findings.push(f("pool.too-many-clients", "Database refused new connections", `${tooMany} acquisitions failed with "too many clients": pools tried to open more than the database's ${state.db.maxConnections}`, true));
      return { rows: [["In use (max)", `${inUse.max} of ${size.max}`], ["Waiting (max)", String(waiting.max)], ["Acquire p95", msf(st.p95)], ["Acquire timeouts", String(timeouts)], ["Leaked", String(leaked.last)], ["Too many clients", String(tooMany)], ["Configured", `${state.pool.size} per instance × ${state.api.replicas}, timeout ${state.pool.acquireTimeoutMs} ms`]], findings };
    },
  },
  {
    id: "database",
    title: "Check database load and slow queries",
    question: "Is the database itself the bottleneck?",
    run: ({ run, during, state }) => {
      const active = gaugeStats(run, during, "db.active"), waiting = gaugeStats(run, during, "db.waiting"), conns = gaugeStats(run, during, "db.connections");
      const queries = spansIn(run, during, (s) => s.service === "postgres");
      const byStatement = new Map<string, Span[]>();
      for (const q of queries) byStatement.set(String(q.attrs["db.statement"]), [...(byStatement.get(String(q.attrs["db.statement"])) ?? []), q]);
      const ranked = [...byStatement.entries()].map(([k, v]) => ({ k, total: v.reduce((n, s) => n + dur(s), 0), ...spanStats(v), plan: v[0].attrs["db.plan"] })).sort((a, b) => b.total - a.total);
      const scans = queries.filter((q) => String(q.attrs["db.plan"] ?? "").startsWith("Seq Scan"));
      const findings: Finding[] = [];
      const util = active.mean / state.db.cpuSlots;
      if (util >= 0.85 && waiting.max > 0) findings.push(f("db.saturated", "Database CPU saturated", `On average ${active.mean.toFixed(1)} of ${state.db.cpuSlots} CPU slots busy (${pct(util * 100)}); up to ${waiting.max} queries waited for CPU`, true));
      else findings.push(f("db.ok", "Database has headroom", `On average ${active.mean.toFixed(1)} of ${state.db.cpuSlots} CPU slots busy (${pct(util * 100)}); at most ${waiting.max} queries waited`, false));
      if (scans.length) findings.push(f("db.seq-scan", "Sequential scan on a hot path", `${scans.length} queries ran "${scans[0].attrs["db.statement"]}" with plan "${scans[0].attrs["db.plan"]}", p95 ${msf(spanStats(scans).p95)}`, true));
      if (conns.max >= state.db.maxConnections) findings.push(f("db.connections-at-max", "Connections at the database's limit", `${conns.max} of ${state.db.maxConnections} connections open`, true));
      return { rows: [["CPU slots busy (mean / max)", `${active.mean.toFixed(1)} / ${active.max} of ${state.db.cpuSlots}`], ["Queries waiting (max)", String(waiting.max)], ["Connections (max)", `${conns.max} of ${state.db.maxConnections}`], ...ranked.slice(0, 3).map((r) => [r.k, `${r.calls} calls, p95 ${msf(r.p95)}${r.plan ? `, ${r.plan}` : ""}`] as [string, string])], findings };
    },
  },
  {
    id: "dependencies",
    title: "Compare dependency latency and errors before and during",
    question: "Which dependency changed?",
    run: ({ run, during, before }) => {
      const groups: [string, (s: Span) => boolean][] = [
        ["Payment provider", (s) => s.name === "POST /v1/charges"], ["Database", (s) => s.service === "postgres"], ["Cache", (s) => s.service === "redis"],
        ["Identity provider", (s) => s.service === "identity-provider"], ["Fraud service", (s) => s.service === "fraud-service"],
      ];
      const rows: [string, string][] = [];
      const findings: Finding[] = [];
      for (const [name, pick] of groups) {
        const a = spanStats(spansIn(run, before, pick)), b = spanStats(spansIn(run, during, pick));
        if (!a.calls && !b.calls) continue;
        rows.push([name, `before: p95 ${msf(a.p95)}, ${pct(a.errorRate)} errors · during: p95 ${msf(b.p95)}, ${pct(b.errorRate)} errors`]);
        const slower = b.calls > 0 && a.calls > 0 && b.p95 > a.p95 * 2 && b.p95 - a.p95 > 50;
        const key = name.toLowerCase().split(" ")[0];
        if (slower || b.errorRate >= 5) findings.push(f(`dependency.${key}-degraded`, `${name} slower or failing`, `p95 ${msf(a.p95)} → ${msf(b.p95)}, errors ${pct(a.errorRate)} → ${pct(b.errorRate)}`, true));
        else if (b.calls) findings.push(f(`dependency.${key}-ok`, `${name} unchanged`, `p95 ${msf(a.p95)} → ${msf(b.p95)}, errors ${pct(a.errorRate)} → ${pct(b.errorRate)}`, false));
      }
      return { rows, findings };
    },
  },
  {
    id: "retries",
    title: "Measure retry amplification",
    question: "How many calls does one request turn into?",
    needs: ["payment"],
    run: ({ run, during, state }) => {
      const calls = spansIn(run, during, (s) => s.name === "POST /v1/charges");
      const charges = spansIn(run, during, (s) => s.name === "payment.charge");
      const facts = requestFacts(run, during);
      const perCharge = charges.length ? calls.length / charges.length : 0;
      const dup = run.events.filter((e) => e.type === "charge" && inWindow(e.t, during)).length;
      const findings: Finding[] = [];
      if (perCharge >= 1.5 || facts.clientRetriesPerRequest >= 0.5) findings.push(f("retries.amplified", "Retries multiply the load", `Each charge made ${perCharge.toFixed(2)} provider calls and each customer request ${(1 + facts.clientRetriesPerRequest).toFixed(2)} attempts (payment retries ${state.payment.retries}, backoff ${state.payment.backoff})`, true));
      else findings.push(f("retries.low", "Little retrying", `${perCharge.toFixed(2)} provider calls per charge, ${(1 + facts.clientRetriesPerRequest).toFixed(2)} attempts per request`, false));
      if (dup) findings.push(f("charges.duplicate", "Customers charged twice", `${dup} duplicate charges: a timed-out charge was retried without an idempotency key and the provider completed both`, true));
      return { rows: [["Provider calls", String(calls.length)], ["Charges", String(charges.length)], ["Calls per charge", perCharge.toFixed(2)], ["Client attempts per request", (1 + facts.clientRetriesPerRequest).toFixed(2)], ["Duplicate charges", String(dup)], ["Policy", `${state.payment.retries} retries, ${state.payment.backoff}, timeout ${state.payment.timeoutMs} ms, idempotency keys ${state.payment.idempotencyKeys ? "on" : "off"}, breaker ${state.payment.breaker ? "on" : "off"}`]], findings };
    },
  },
  {
    id: "cache",
    title: "Check cache hit rate and concurrent misses",
    question: "Is the cache protecting the database?",
    needs: ["cache"],
    run: ({ run, during, before, state }) => {
      const gets = (w: Window) => spansIn(run, w, (s) => s.name === "GET product:{id}");
      const rate = (list: Span[]) => (list.length ? (list.filter((s) => s.attrs["cache.hit"]).length * 100) / list.length : 0);
      const a = rate(gets(before)), b = rate(gets(during));
      // Concurrent misses for one key: database page reads for the same product started within 100 ms of each other.
      const reads = spansIn(run, during, (s) => s.service === "postgres" && String(s.attrs["db.statement"]).startsWith("SELECT product_page")).sort((x, y) => x.start - y.start);
      const { byId } = index(run);
      const product = (s: Span) => {
        const parent = s.parent ? byId.get(s.parent) : undefined;
        const get = parent ? index(run).children.get(parent.id)?.find((c) => c.name === "GET product:{id}") : undefined;
        return String(get?.attrs["cache.key"] ?? "?");
      };
      let peak = 0, peakKey = "";
      for (let i = 0, j = 0; i < reads.length; i++) {
        while (reads[i].start - reads[j].start > 100) j++;
        const key = product(reads[i]);
        const same = reads.slice(j, i + 1).filter((r) => product(r) === key).length;
        if (same > peak) [peak, peakKey] = [same, key];
      }
      const stale = spansIn(run, during, (s) => s.service === "store-api" && s.kind === "server" && s.attrs.stale === true);
      const findings: Finding[] = [];
      if (b < a - 5) findings.push(f("cache.hit-rate-drop", "Cache hit rate fell", `${pct(a)} before → ${pct(b)} during (TTL ${state.cache.ttlS} s, sale product ${state.cache.saleTtlS} s)`, true));
      else findings.push(f("cache.ok", "Cache hit rate steady", `${pct(a)} before → ${pct(b)} during`, false));
      if (peak >= 8) findings.push(f("cache.stampede", "Many simultaneous misses for one key", `Up to ${peak} database reads for ${peakKey} started within 100 ms: every request that missed rebuilt the same entry${state.cache.coalescing ? "" : " (no request coalescing)"}`, true));
      if (stale.length) findings.push(f("cache.stale", "Stale prices served", `${stale.length} responses served a cached price older than the latest change, by up to ${msf(Math.max(...stale.map((s) => Number(s.attrs.staleMs))))}`, stale.some((s) => Number(s.attrs.staleMs) > 30_000)));
      return { rows: [["Hit rate before", pct(a)], ["Hit rate during", pct(b)], ["Peak concurrent misses (one key)", `${peak}${peakKey ? ` (${peakKey})` : ""}`], ["Stale responses", String(stale.length)], ["Policy", `TTL ${state.cache.ttlS} s (sale product ${state.cache.saleTtlS} s), coalescing ${state.cache.coalescing ? "on" : "off"}`]], findings };
    },
  },
  {
    id: "instances",
    title: "Compare the API instances",
    question: "Is one instance different from the others?",
    run: ({ run, during }) => {
      const servers = spansIn(run, during, (s) => s.service === "store-api" && s.kind === "server");
      const ids = [...new Set(servers.map((s) => String(s.attrs.instance)))].sort();
      const stats = ids.map((id) => ({ id, version: String(servers.filter((s) => s.attrs.instance === id).at(-1)?.attrs.version ?? ""), ...spanStats(servers.filter((s) => s.attrs.instance === id)) }));
      const bad = stats.filter((x) => x.errorRate >= 40);
      const good = stats.filter((x) => x.errorRate < 5);
      const health = run.events.filter((e) => e.type === "health" && inWindow(e.t, during)).length;
      const versions = [...new Set(stats.map((x) => x.version))];
      const findings: Finding[] = [];
      if (bad.length && good.length) findings.push(f("instance.one-bad", "One instance fails, the others don't", `${bad.map((x) => `${x.id} ${pct(x.errorRate)} errors`).join(", ")}; ${good.map((x) => `${x.id} ${pct(x.errorRate)}`).join(", ")}. ${health ? `${health} health-check changes` : "The gateway kept routing to it (no health-check change)"}`, true));
      else findings.push(f("instance.even", "Instances behave alike", stats.map((x) => `${x.id} ${pct(x.errorRate)} errors, p95 ${msf(x.p95)}`).join("; "), false));
      if (versions.length > 1) findings.push(f("instance.mixed-versions", "Instances run different versions", stats.map((x) => `${x.id}: ${x.version}`).join(", "), false));
      return { rows: stats.map((x) => [x.id, `${x.version} · ${x.calls} requests · ${pct(x.errorRate)} errors · p95 ${msf(x.p95)}`] as [string, string]), findings };
    },
  },
  {
    id: "changes",
    title: "Compare metrics before and after each change",
    question: "Did the problem start with a change?",
    run: ({ run, during }) => {
      const changes = run.events.filter((e) => e.type === "change" && e.by === "scenario" && e.t < during.to && run.input.changes.some((c) => c.visible && c.label === e.label));
      const rows: [string, string][] = [];
      const findings: Finding[] = [];
      for (const c of changes) {
        const a = requestFacts(run, { from: Math.max(0, c.t - 10_000), to: c.t }), b = requestFacts(run, { from: c.t, to: Math.min(run.endMs, c.t + 15_000) });
        rows.push([`${c.label} at ${(c.t / 1000).toFixed(0)} s`, `errors ${pct(a.errorRate)} → ${pct(b.errorRate)}, p95 ${msf(a.p95)} → ${msf(b.p95)}`]);
        if (b.errorRate - a.errorRate >= 2 || (b.p95 > a.p95 * 1.5 && b.p95 - a.p95 > 100)) findings.push(f(`change.${c.kind}-correlates`, `Symptoms began after: ${c.label}`, `In the 15 s after it, errors went ${pct(a.errorRate)} → ${pct(b.errorRate)} and p95 ${msf(a.p95)} → ${msf(b.p95)}. Timing alone doesn't prove it caused them.`, true));
      }
      if (!findings.length) findings.push(f("change.none-correlates", "No change lines up with the symptoms", rows.length ? "Metrics were similar before and after each recorded change" : "No change was recorded before the symptoms", false));
      return { rows: rows.length ? rows : [["Changes", "none recorded"]], findings };
    },
  },
  {
    id: "config",
    title: "Review timeouts, retries, pools and health checks",
    question: "Is any setting risky for what we've seen?",
    run: ({ state, run }) => {
      const findings: Finding[] = [];
      const ft = run.input.features;
      if (state.lb.healthCheck === "liveness") findings.push(f("config.liveness-routing", "Routing uses a liveness check", "The gateway routes to any instance whose process answers GET /healthz; it never asks whether the instance can serve requests (GET /ready)", true));
      if (ft.payment && state.payment.timeoutMs >= 5000) findings.push(f("config.long-timeout", "Long payment timeout", `Each payment attempt may hold an API thread for up to ${msf(state.payment.timeoutMs)}`, true));
      if (ft.payment && state.payment.retries > 0 && state.payment.backoff === "none") findings.push(f("config.immediate-retries", "Immediate retries", `${state.payment.retries} payment retries with no backoff or jitter`, true));
      if (ft.payment && state.payment.retries > 0 && !state.payment.idempotencyKeys) findings.push(f("config.retries-without-idempotency", "Retries without idempotency keys", "A retried charge is a new charge to the provider", true));
      if (ft.cache && Math.min(state.cache.ttlS, state.cache.saleTtlS) < 30) findings.push(f("config.short-ttl", "Very short cache TTL", `Catalogue entries live ${state.cache.ttlS} s, the sale product's ${state.cache.saleTtlS} s`, true));
      if (ft.auth && state.auth.jwksRefresh === "startup") findings.push(f("config.jwks-startup-only", "Keys loaded only at startup", "The orders API never refetches the identity provider's JWKS while it runs", true));
      if (state.gateway.rateLimit && state.gateway.keyBy === "client-ip") findings.push(f("config.ratelimit-by-ip", "Rate limits keyed by client IP", "Behind the CDN, the gateway sees the CDN edge's address, not the customer's", true));
      const rows: [string, string][] = [
        ["Client", `timeout ${msf(state.client.timeoutMs)}, ${state.client.retries} retries`],
        ["Health check", `${state.lb.healthCheck}, every ${msf(state.lb.intervalMs)}, ${state.lb.threshold} in a row`],
        ["API", `${state.api.version}, ${state.api.replicas} instances × ${state.api.concurrency} threads, queue ${state.api.queueLimit}`],
        ["Pool", `${state.pool.size} per instance, acquire timeout ${msf(state.pool.acquireTimeoutMs)}`],
        ["Database", `${state.db.cpuSlots} CPU slots, max ${state.db.maxConnections} connections, orders_customer_id_idx ${state.db.ordersIndex ? "present" : "absent"}`],
      ];
      if (ft.payment) rows.push(["Payment calls", `timeout ${msf(state.payment.timeoutMs)}, ${state.payment.retries} retries, ${state.payment.backoff}, breaker ${state.payment.breaker ? "on" : "off"}, idempotency keys ${state.payment.idempotencyKeys ? "on" : "off"}`]);
      if (ft.cache) rows.push(["Cache", `TTL ${state.cache.ttlS} s, sale product ${state.cache.saleTtlS} s, coalescing ${state.cache.coalescing ? "on" : "off"}`]);
      if (ft.queue) rows.push(["Worker", `${state.worker.version}, ${state.worker.concurrency} at once, dead-letter ${state.worker.deadLetter ? `after ${state.worker.maxReceives} receives` : "off"}`]);
      if (ft.auth) rows.push(["Token validation", `issuer ${state.auth.issuer}, audience ${state.auth.audience}, algs ${state.auth.algs}, JWKS ${state.auth.jwksRefresh}`]);
      if (state.gateway.rateLimit) rows.push(["Rate limit", `${state.gateway.limitRps}/s, burst ${state.gateway.burst}, keyed by ${state.gateway.keyBy}`]);
      if (ft.sso) rows.push(["SSO", `redirect_uri https://${state.sso.redirectUri}/callback; registered at the IdP: ${csv(state.idp.registeredRedirects).join(", ")}`]);
      if (ft.dns) rows.push(["DNS", `api.store.example A ${state.dns.record}, TTL ${state.dns.ttlS} s; the gateway's address is 203.0.113.10`]);
      if (!findings.length) findings.push(f("config.nothing-risky", "No risky setting found", "Timeouts, retries, pools and health checks look ordinary", false));
      return { rows, findings };
    },
  },
  {
    id: "queue",
    title: "Check queue depth and worker throughput",
    question: "Are background jobs keeping up?",
    needs: ["queue"],
    run: ({ run, during, state }) => {
      const depth = gaugeStats(run, during, "queue.depth"), age = gaugeStats(run, during, "queue.oldestAgeMs"), busy = gaugeStats(run, during, "worker.busy");
      const consumed = spansIn(run, during, (s) => s.service === "fulfilment-worker");
      const errors = consumed.filter((s) => s.status === "error");
      const published = spansIn(run, during, (s) => s.kind === "producer").length;
      const secs = (during.to - during.from) / 1000;
      const fraud = consumed.length ? consumed.reduce((n, s) => n + (index(run).children.get(s.id) ?? []).filter((c) => c.service === "fraud-service").reduce((m, c) => m + dur(c), 0), 0) / consumed.reduce((n, s) => n + dur(s), 0) : 0;
      const findings: Finding[] = [];
      if (depth.last > depth.first + 50) findings.push(f("queue.growing", "Backlog growing", `Depth ${depth.first} → ${depth.last}, oldest message ${Math.round(age.last / 1000)} s; published ${(published / secs).toFixed(1)}/s, processed ${(consumed.filter((s) => s.status === "ok").length / secs).toFixed(1)}/s`, true));
      else findings.push(f("queue.stable", "Queue keeping up", `Depth ${depth.first} → ${depth.last}`, false));
      if (busy.mean >= state.worker.concurrency * 0.95) findings.push(f("worker.saturated", "Workers always busy", `${busy.mean.toFixed(1)} of ${state.worker.concurrency} slots busy on average`, true));
      if (errors.length) findings.push(f("worker.poison", "Messages failing over and over", `${errors.length} failed processing attempts (${errors[0].error?.code}); the most-retried message was received ${Math.max(...errors.map((e) => Number(e.attrs.receives)))} times${state.worker.deadLetter ? "" : " (no dead-letter queue)"}`, true));
      if (fraud >= 0.5) findings.push(f("worker.fraud-dominant", "Most processing time is the fraud check", `${pct(fraud * 100)} of worker time waits on POST /v2/score`, true));
      return { rows: [["Depth", `${depth.first} → ${depth.last} (max ${depth.max})`], ["Oldest message", `${Math.round(age.last / 1000)} s`], ["Published", `${(published / secs).toFixed(1)}/s`], ["Processed OK", `${(consumed.filter((s) => s.status === "ok").length / secs).toFixed(1)}/s`], ["Failed attempts", String(errors.length)], ["Workers busy (mean)", `${busy.mean.toFixed(1)} of ${state.worker.concurrency}`], ["Dead letters", String(gaugeStats(run, during, "worker.dead").last)]], findings };
    },
  },
  {
    id: "auth",
    title: "Classify authentication and authorization failures",
    question: "Who is rejected, at which check, and is it 401 or 403?",
    needs: ["auth"],
    run: ({ run, during, before }) => {
      const checks = (w: Window) => spansIn(run, w, (s) => s.name === "auth.validate_token" && index(run).byTrace.get(s.trace)?.[0]?.attrs.legit === true);
      const during_ = checks(during);
      const steps = new Map<string, number>();
      for (const s of during_) if (s.attrs["auth.failedStep"]) steps.set(String(s.attrs["auth.failedStep"]), (steps.get(String(s.attrs["auth.failedStep"])) ?? 0) + 1);
      const denied = during_.filter((s) => s.attrs["authz.decision"] === "deny").length;
      const deniedBefore = checks(before).filter((s) => s.attrs["authz.decision"] === "deny").length;
      const kids = new Map<string, number>();
      for (const s of during_) kids.set(String(s.attrs["token.kid"]), (kids.get(String(s.attrs["token.kid"])) ?? 0) + 1);
      const failed = [...steps.values()].reduce((a, b) => a + b, 0);
      const findings: Finding[] = [];
      const ids: Record<string, [string, string]> = { kid: ["auth.unknown-kid", "Tokens signed with a key the API doesn't have"], aud: ["auth.wrong-audience", "Audience doesn't match"], iss: ["auth.wrong-issuer", "Issuer doesn't match"], exp: ["auth.expired", "Expired tokens"], alg: ["auth.alg", "Algorithm refused"], signature: ["auth.signature", "Signatures don't verify"] };
      const sample = (step: string) => during_.find((s) => s.attrs["auth.failedStep"] === step)?.error?.message ?? "";
      for (const [step, n] of [...steps.entries()].sort((a, b) => b[1] - a[1])) findings.push(f(ids[step][0], ids[step][1], `${n} of ${during_.length} legitimate requests failed at the ${step} check: ${sample(step)}`, true));
      if (failed > denied) findings.push(f("auth.authentication-not-authorization", "Authentication fails (401), not authorization (403)", `${failed} requests failed token validation (401); ${denied} were refused by policy (403), against ${deniedBefore} before`, true));
      if (!failed) findings.push(f("auth.ok", "Tokens validate", `${during_.length} tokens validated; ${denied} refused by policy (403, same as before: ${deniedBefore})`, false));
      return { rows: [["Token checks", String(during_.length)], ["Failed validation (401)", [...steps.entries()].map(([k, v]) => `${k}: ${v}`).join(", ") || "none"], ["Refused by policy (403)", `${denied} (before: ${deniedBefore})`], ["Token kids seen", [...kids.entries()].map(([k, v]) => `${k}: ${v}`).join(", ")]], findings };
    },
  },
  {
    id: "dns",
    title: "Query public resolvers for api.store.example",
    question: "What address do customers get for the API?",
    needs: ["dns"],
    run: ({ run, during, before, state }) => {
      // The answers the resolvers last cached before the end of the window (what `dig @resolver` would show).
      const answers = new Map<string, string>();
      for (const e of run.events) if (e.type === "dns" && e.t < during.to) answers.set(e.service!, e.label!);
      const wrong = [...answers.values()].filter((a) => a !== "203.0.113.10").length;
      const rate = (w: Window) => spansIn(run, w, (s) => s.service === "gateway" && s.kind === "server").length / ((w.to - w.from) / 1000);
      const connects = spansIn(run, during, (s) => s.name.startsWith("tcp.connect"));
      const findings: Finding[] = [];
      if (wrong) findings.push(f("dns.wrong-answer", "Resolvers return an address nothing answers on", `${wrong} of ${answers.size} resolvers answer A ${[...answers.values()].find((a) => a !== "203.0.113.10")}; the gateway is at 203.0.113.10. Authoritative record now: A ${state.dns.record}, TTL ${state.dns.ttlS} s`, true));
      else findings.push(f("dns.ok", "Resolvers return the gateway's address", `All ${answers.size} resolvers answer A 203.0.113.10`, false));
      if (rate(during) < rate(before) * 0.8) findings.push(f("dns.traffic-drop", "Fewer requests reach the servers", `The gateway saw ${rate(before).toFixed(1)} req/s before and ${rate(during).toFixed(1)} req/s during, while ${connects.length} client connection attempts timed out`, true));
      return { rows: [["Resolvers queried", String(answers.size)], ["Wrong answers", String(wrong)], ["Gateway traffic", `${rate(before).toFixed(1)} → ${rate(during).toFixed(1)} req/s`], ["Client connect timeouts", String(connects.length)]], findings };
    },
  },
  {
    id: "rate-limit",
    title: "Inspect 429s by rate-limit key",
    question: "Who is being rate limited, and by which key?",
    run: ({ run, during, state }) => {
      const limited = spansIn(run, during, (s) => s.service === "gateway" && s.error?.code === "RATE_LIMITED");
      const keys = new Map<string, number>();
      for (const s of limited) keys.set(String(s.attrs["ratelimit.key"]), (keys.get(String(s.attrs["ratelimit.key"])) ?? 0) + 1);
      const legit = limited.filter((s) => s.attrs["client.key"] !== "key-scraper").length;
      const scraper = limited.length - legit;
      const findings: Finding[] = [];
      if (!state.gateway.rateLimit) findings.push(f("ratelimit.off", "Rate limiting is off", "Nothing limits any client", false));
      else if (legit > scraper && keys.size <= 6) findings.push(f("ratelimit.shared-bucket", "Many customers share a few limit buckets", `${legit} legitimate requests were limited under only ${keys.size} keys (${[...keys.keys()].slice(0, 4).join(", ")}): each bucket holds many customers' traffic`, true));
      else if (limited.length) findings.push(f("ratelimit.per-client", "Limits hit the heavy client", `${scraper} limited requests were the scraper's, ${legit} anyone else's`, false));
      else findings.push(f("ratelimit.none", "No requests limited", "No 429s in the window", false));
      return { rows: [["429s", String(limited.length)], ["Of legitimate clients", String(legit)], ["Of the scraper", String(scraper)], ["Distinct keys limited", String(keys.size)], ["Top keys", [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ×${v}`).join(", ") || "none"], ["Policy", state.gateway.rateLimit ? `${state.gateway.limitRps}/s, burst ${state.gateway.burst}, keyed by ${state.gateway.keyBy}` : "off"]], findings };
    },
  },
  {
    id: "sso",
    title: "Follow the sign-in funnel",
    question: "Where do Finance sign-ins stop?",
    needs: ["sso"],
    run: ({ run, during }) => {
      const app = spansIn(run, during, (s) => s.service === "finance-app" && s.name === "GET /");
      const withSession = app.filter((s) => s.attrs.session === "valid").length;
      const authorize = spansIn(run, during, (s) => s.name === "GET /authorize");
      const rejected = authorize.filter((s) => s.status === "error");
      const callbacks = spansIn(run, during, (s) => s.name === "GET /callback").length;
      const findings: Finding[] = [];
      if (rejected.length) findings.push(f("sso.redirect-rejected", "The identity provider rejects the redirect URI", `${rejected.length} of ${authorize.length} authorization requests failed: ${rejected[0].error?.message}`, true));
      if (withSession && rejected.length) findings.push(f("sso.only-new-sessions", "Only people without a session fail", `${withSession} visits with a valid session succeeded; every failure was a new sign-in`, true));
      if (!rejected.length) findings.push(f("sso.ok", "Sign-ins complete", `${authorize.length} authorization requests, ${callbacks} callbacks`, false));
      return { rows: [["Visits", String(app.length)], ["With a valid session", String(withSession)], ["Sent to the IdP", String(authorize.length)], ["Rejected by the IdP", String(rejected.length)], ["Callbacks completed", String(callbacks)]], findings };
    },
  },
  {
    id: "saturation",
    title: "Check API thread and request-queue saturation",
    question: "Do requests wait for the API itself?",
    run: ({ run, during }) => {
      const busy = gaugeStats(run, during, "api.threads.busy"), limit = gaugeStats(run, during, "api.threads.limit"), queued = gaugeStats(run, during, "api.queue");
      const rejected = spansIn(run, during, (s) => s.error?.code === "SERVER_BUSY").length;
      const browse = requestFacts(run, during, "browse");
      const findings: Finding[] = [];
      if (busy.max >= limit.max && queued.max > 0) findings.push(f("threads.exhausted", "Every API thread busy", `${busy.max} of ${limit.max} threads busy, up to ${queued.max} requests queued, ${rejected} refused as SERVER_BUSY`, true));
      else findings.push(f("threads.ok", "API threads available", `At most ${busy.max} of ${limit.max} busy`, false));
      if (run.input.features.payment && browse.requests && browse.errorRate >= 5) findings.push(f("browse.collateral", "Product pages fail too", `${pct(browse.errorRate)} of product-page requests failed, though they never call the payment provider`, true));
      return { rows: [["Threads busy (max)", `${busy.max} of ${limit.max}`], ["Queued (max)", String(queued.max)], ["Refused (SERVER_BUSY)", String(rejected)], ["Product pages", `${browse.requests} requests, ${pct(browse.errorRate)} failed`]], findings };
    },
  },
];

/** A finding from one trace: the category that took the most of its time. */
export function traceFinding(run: Run, trace: string): Finding {
  const { top, total, byCategory } = timeByCategory(run, trace);
  const ids = CATEGORY_FINDINGS;
  const share = top ? (byCategory.get(top)! * 100) / Math.max(1, total) : 0;
  return { id: top ? ids[top] ?? "latency.other" : "latency.other", title: `Trace ${trace.slice(0, 8)}: most time in ${top ?? "nothing"}`, detail: `${top} took ${Math.round(byCategory.get(top!) ?? 0)} ms of ${Math.round(total)} ms (${share.toFixed(0)}%)`, abnormal: share >= 40 && top !== "network and other" };
}

/** A finding from one log line: its error code, as a fact. */
export function logFinding(line: LogLine): Finding | null {
  if (!line.code) return null;
  const ids: Record<string, string> = {
    POOL_TIMEOUT: "pool.exhausted", POOL_EXHAUSTED: "pool.exhausted", CONNECTION_NOT_RELEASED: "pool.leak", DB_TOO_MANY_CLIENTS: "pool.too-many-clients", PAYMENT_TIMEOUT: "dependency.payment-degraded",
    DUPLICATE_CHARGE: "charges.duplicate", CONFIG_UNAVAILABLE: "instance.local-error", UNHANDLED_EXCEPTION: "errors.unhandled-exception", INVALID_TOKEN_KID: "auth.unknown-kid", INVALID_TOKEN_AUD: "auth.wrong-audience",
    INVALID_TOKEN_ISS: "auth.wrong-issuer", INSUFFICIENT_SCOPE: "auth.insufficient-scope", RATE_LIMITED: "errors.429", OIDC_INVALID_REDIRECT_URI: "sso.redirect-rejected", VALIDATION_ERROR: "worker.poison",
    QUEUE_BACKLOG: "queue.growing", CONNECT_TIMEOUT: "errors.no-response", SERVER_BUSY: "threads.exhausted", PAYMENT_CIRCUIT_OPEN: "breaker.open",
  };
  const id = ids[line.code];
  return id ? { id, title: `Log: ${line.code} on ${line.service}`, detail: line.message, abnormal: true } : null;
}

export { isFailure };
