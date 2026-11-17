// Everything the learner sees about a run is folded from its event stream here: the state of each component at
// the playback cursor, requests in transit, totals, latencies and the time series. Final metrics are the same fold
// taken to the last event, so the inspector, the diagram and the summary can never disagree.
import { components, type ConfigOf, type Design } from "./model.ts";
import type { FailCode, Op, SimEvent, SimRun } from "./simulate.ts";

export const BUCKET_MS = 500;

export type NodeState = {
  down: boolean;
  /** Per slot group (NoSQL: per partition; others: one). */
  busy: number[];
  waiting: number[];
  busyArea: number[];
  lastAt: number[];
  maxWaiting: number;
  started: number;
  rejected: Partial<Record<FailCode, number>>;
  hits: number;
  misses: number;
  /** Queue: messages stored now. */
  depth: number;
  maxDepth: number;
  published: number;
  acked: number;
  redelivered: number;
  deadLetters: number;
  ackLatencies: number[];
  /** Load balancer: servers it has marked unhealthy. */
  unhealthy: string[];
};

export type Transit = { edge?: string; from: string; to: string; since: number; until: number; type: SimEvent["type"]; ok?: boolean; req?: number };
export type Bucket = { ok: number; failed: number; latencies: number[]; queued: number };
type Totals = { requests: number; ok: number; failed: number; timeouts: number; retries: number; late: number; latencies: number[] };

export type Fold = {
  /** The design snapshot the run simulated: the only design whose component ids and settings this fold describes. */
  design: Design;
  t: number;
  /** Events applied so far: events[0 .. next - 1]. */
  next: number;
  nodes: Record<string, NodeState>;
  transit: Transit[];
  totals: Totals;
  byOp: Partial<Record<Op, Totals>>;
  failures: Partial<Record<FailCode, number>>;
  series: Bucket[];
};

const totals = (): Totals => ({ requests: 0, ok: 0, failed: 0, timeouts: 0, retries: 0, late: 0, latencies: [] });

export function slotLimits(design: Design, id: string): number[] {
  const node = design.nodes.find((n) => n.id === id)!;
  if (node.kind === "api") return [(node.config as ConfigOf<"api">).concurrency];
  if (node.kind === "sql") return [(node.config as ConfigOf<"sql">).concurrency];
  if (node.kind === "worker") return [(node.config as ConfigOf<"worker">).concurrency];
  if (node.kind === "nosql") {
    const c = node.config as ConfigOf<"nosql">;
    return Array(c.partitions).fill(c.concurrencyPerPartition);
  }
  return [];
}

export function createFold(design: Design): Fold {
  const nodes: Record<string, NodeState> = {};
  for (const node of design.nodes) {
    const groups = Math.max(1, slotLimits(design, node.id).length);
    nodes[node.id] = {
      down: false, busy: Array(groups).fill(0), waiting: Array(groups).fill(0), busyArea: Array(groups).fill(0), lastAt: Array(groups).fill(0),
      maxWaiting: 0, started: 0, rejected: {}, hits: 0, misses: 0, depth: 0, maxDepth: 0, published: 0, acked: 0, redelivered: 0, deadLetters: 0, ackLatencies: [], unhealthy: [],
    };
  }
  return { design, t: 0, next: 0, nodes, transit: [], totals: totals(), byOp: {}, failures: {}, series: [] };
}

const bucket = (fold: Fold, t: number) => {
  const index = Math.floor(t / BUCKET_MS);
  while (fold.series.length <= index) fold.series.push({ ok: 0, failed: 0, latencies: [], queued: 0 });
  return fold.series[index];
};

function setBusy(state: NodeState, part: number, busy: number, t: number) {
  state.busyArea[part] += state.busy[part] * (t - state.lastAt[part]);
  state.lastAt[part] = t;
  state.busy[part] = busy;
}

/** Apply one event. Events must be applied in order. */
export function apply(fold: Fold, e: SimEvent) {
  fold.t = e.t;
  fold.next = e.i + 1;
  const n = fold.nodes[e.node];
  const part = e.part ?? 0;
  if (e.arriveAt !== undefined && e.to) fold.transit.push({ edge: e.edge, from: e.node, to: e.to, since: e.t, until: e.arriveAt, type: e.type, ok: e.ok, req: e.req });
  const op = e.op ? (fold.byOp[e.op] ??= totals()) : undefined;
  switch (e.type) {
    case "request":
      fold.totals.requests++;
      op!.requests++;
      break;
    case "retry":
      fold.totals.retries++;
      op!.retries++;
      break;
    case "timeout":
      fold.totals.timeouts++;
      op!.timeouts++;
      break;
    case "late":
      fold.totals.late++;
      break;
    case "complete": {
      const b = bucket(fold, e.t);
      if (e.ok) {
        fold.totals.ok++;
        fold.totals.latencies.push(e.latency!);
        op!.ok++;
        op!.latencies.push(e.latency!);
        b.ok++;
        b.latencies.push(e.latency!);
      } else {
        fold.totals.failed++;
        op!.failed++;
        b.failed++;
        fold.failures[e.reason!.code] = (fold.failures[e.reason!.code] ?? 0) + 1;
      }
      break;
    }
    case "queued":
      n.waiting[part] = e.depth!;
      n.maxWaiting = Math.max(n.maxWaiting, e.depth!);
      break;
    case "start":
      n.waiting[part] = e.depth!;
      n.started++;
      break;
    case "reject":
      n.rejected[e.reason!.code] = (n.rejected[e.reason!.code] ?? 0) + 1;
      break;
    case "cache":
      if (e.hit) n.hits++;
      else n.misses++;
      break;
    case "publish":
      n.published++;
      n.depth = e.depth!;
      n.maxDepth = Math.max(n.maxDepth, n.depth);
      bucket(fold, e.t).queued = Math.max(bucket(fold, e.t).queued, n.depth);
      break;
    case "consume":
      n.depth = e.depth!;
      fold.nodes[e.to!].started++;
      break;
    case "requeue":
      n.depth = e.depth!;
      n.maxDepth = Math.max(n.maxDepth, n.depth);
      break;
    case "ack":
      n.acked++;
      n.ackLatencies.push(e.latency!);
      break;
    case "redeliver":
      n.redelivered++;
      break;
    case "dead-letter":
      n.deadLetters++;
      break;
    case "fault":
      // Everything in progress or waiting there is lost.
      n.down = true;
      for (let p = 0; p < n.busy.length; p++) setBusy(n, p, 0, e.t);
      n.waiting.fill(0);
      break;
    case "recover":
      n.down = false;
      break;
    case "health":
      n.unhealthy = e.healthy ? n.unhealthy.filter((id) => id !== e.to) : [...n.unhealthy, e.to!];
      break;
  }
  // Every event that changes a component's slots in use says how many are in use after it.
  if (e.busy !== undefined) {
    const owner = e.type === "consume" || e.type === "dead-letter" ? fold.nodes[e.to!] : n;
    if (owner.busy.length > part) setBusy(owner, part, e.busy, e.t);
  }
}

/** Move the fold forward to time `t` (inclusive), or rebuild it from the start when going back. */
export function foldTo(run: SimRun, fold: Fold | null, t: number): Fold {
  let f = fold && fold.t <= t ? fold : createFold(run.design);
  const events = run.events;
  while (f.next < events.length && events[f.next].t <= t) apply(f, events[f.next]);
  f.t = t;
  f.transit = f.transit.filter((item) => item.until > t);
  return f;
}

/** Fold through the first `count` events: the cursor of the step-by-step controls. */
export function foldEvents(run: SimRun, fold: Fold | null, count: number): Fold {
  let f = fold && fold.next <= count ? fold : createFold(run.design);
  while (f.next < count) apply(f, run.events[f.next]);
  const t = count ? run.events[count - 1].t : 0;
  f.t = t;
  f.transit = f.transit.filter((item) => item.until > t);
  return f;
}

export function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

/**
 * Share of slot time in use up to the fold's time, per slot group; null for components without a slot limit.
 * Limits come from the fold's own design snapshot: pairing a fold with another design (the live editor's, or a
 * challenge design before its fixed settings apply) read components the run never had, or the wrong limits.
 */
export function utilisation(fold: Fold, id: string): number[] | null {
  const n = fold.nodes[id];
  if (!n) throw new Error(`Invariant: component "${id}" is not part of this run`);
  const limits = slotLimits(fold.design, id);
  if (!limits.length || fold.t <= 0) return null;
  return limits.map((limit, p) => (n.busyArea[p] + n.busy[p] * (fold.t - n.lastAt[p])) / (limit * fold.t));
}

/**
 * Operations per second a component can finish from its settings alone: slots ÷ time per operation. An upper
 * bound for the model, not a real-world figure: an API slot also stays busy while it waits on what it calls.
 */
export function nominalCapacity(design: Design, id: string): { what: string; perSecond: number }[] {
  const node = design.nodes.find((n) => n.id === id)!;
  const c = node.config as Record<string, number>;
  const rate = (slots: number, ms: number) => Math.round((slots * 1000) / ms);
  if (node.kind === "api") return [{ what: "requests (own work only)", perSecond: rate(c.concurrency, c.serviceMs) }];
  if (node.kind === "sql") return [{ what: "reads", perSecond: rate(c.concurrency, c.readMs) }, { what: "writes", perSecond: rate(c.concurrency, c.writeMs) }];
  if (node.kind === "nosql") return [{ what: "operations, spread evenly", perSecond: rate(c.partitions * c.concurrencyPerPartition, c.opMs) }, { what: "operations on one partition", perSecond: rate(c.concurrencyPerPartition, c.opMs) }];
  if (node.kind === "worker") return [{ what: "messages (own work only)", perSecond: rate(c.concurrency, c.serviceMs) }];
  return [];
}

export type Summary = {
  requests: number;
  ok: number;
  failed: number;
  unfinished: number;
  successRate: number;
  timeouts: number;
  retries: number;
  late: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  byOp: Partial<Record<Op, { requests: number; ok: number; failed: number; p95: number | null }>>;
  failures: Partial<Record<FailCode, number>>;
  nodes: Record<string, { utilisation: number[] | null; started: number; rejected: Partial<Record<FailCode, number>>; maxWaiting: number; hitRate: number | null; published: number; acked: number; deadLetters: number; redelivered: number; maxDepth: number; depth: number; ackP95: number | null }>;
  cost: number;
  durationS: number;
  truncated: boolean;
};

export function designCost(design: Design) {
  return design.nodes.reduce((sum, node) => sum + components[node.kind].cost, 0);
}

export function summarize(run: SimRun, fold = foldTo(run, null, run.endMs)): Summary {
  const t = fold.totals;
  const finished = t.ok + t.failed;
  const nodes: Summary["nodes"] = {};
  for (const node of run.design.nodes) {
    const n = fold.nodes[node.id];
    nodes[node.id] = {
      utilisation: utilisation(fold, node.id),
      started: n.started,
      rejected: n.rejected,
      maxWaiting: n.maxWaiting,
      hitRate: n.hits + n.misses ? n.hits / (n.hits + n.misses) : null,
      published: n.published,
      acked: n.acked,
      deadLetters: n.deadLetters,
      redelivered: n.redelivered,
      maxDepth: n.maxDepth,
      depth: n.depth,
      ackP95: percentile(n.ackLatencies, 95),
    };
  }
  const byOp: Summary["byOp"] = {};
  for (const [op, o] of Object.entries(fold.byOp) as [Op, Totals][]) byOp[op] = { requests: o.requests, ok: o.ok, failed: o.failed, p95: percentile(o.latencies, 95) };
  return {
    requests: t.requests,
    ok: t.ok,
    failed: t.failed,
    unfinished: t.requests - finished,
    successRate: t.requests ? t.ok / t.requests : 0,
    timeouts: t.timeouts,
    retries: t.retries,
    late: t.late,
    p50: percentile(t.latencies, 50),
    p95: percentile(t.latencies, 95),
    p99: percentile(t.latencies, 99),
    byOp,
    failures: fold.failures,
    nodes,
    cost: designCost(run.design),
    durationS: run.design.workload.durationS,
    truncated: run.truncated,
  };
}
