// The architecture simulator: a deterministic discrete-event simulation of requests moving through a design.
// Pure TypeScript, no React or DOM. One run produces one event stream; the timeline, the diagram, the inspector
// and every metric are read from that stream (see metrics.ts), never from a second model.
//
// What is modelled, and nothing more (the lessons and the playground's "How the simulator works" say the same):
// - fixed network delays per hop (SIM_CONSTANTS), not real network behaviour;
// - per-component concurrency limits with bounded FIFO waiting queues, and refusal when the queue is full;
// - fixed service times per operation (no variance unless arrivals are random);
// - cache-aside caches and CDNs with bounded least-recently-used storage and optional expiry, over a key space
//   with uniform or Zipf (s = 1) popularity;
// - SQL read replicas (reads rotate over the primary and its replicas; every write is also applied on each replica);
// - NoSQL partitions chosen by key hash, each with its own capacity;
// - durable queues, workers with redelivery and dead letters;
// - scheduled component failures: a failed component refuses connections at once and loses work in progress;
// - client timeouts and retries with exponential backoff; load balancers with interval health checks.
// Not modelled: data contents or consistency (so no stale reads), replication lag effects, network loss or
// congestion, CPU contention, autoscaling, failover, hung (slow but alive) servers, authentication or cost of data.
import { indexDesign, validateDesign } from "./validate.ts";
import type { ConfigOf, Design, DesignNode } from "./model.ts";

export const SIM_CONSTANTS = {
  /** One way, client to a CDN edge. */
  clientToCdnMs: 10,
  /** One way, client to anything else over the Internet. */
  clientToOriginMs: 40,
  /** One way, CDN edge to its origin. */
  cdnToOriginMs: 30,
  /** One way, between components in one data centre. */
  internalMs: 1,
  /** Time a cache, CDN, load balancer or queue spends on one operation. */
  quickOpMs: 1,
  /** Arrivals stop at the workload's duration; work already started may finish during this extra time. */
  drainMs: 30_000,
  maxEvents: 500_000,
};

export type Op = "read" | "write" | "asset" | "get" | "set" | "delete" | "publish" | "apply";
export type FailCode = "down" | "crashed" | "queue-full" | "no-healthy-target" | "timeout" | "no-origin";
export type Failure = { code: FailCode; node: string };

export type EventType =
  | "request" // a client starts a logical request (its first attempt)
  | "retry" // a client starts another attempt of the same request
  | "send" // a call leaves `node` for `to` along `edge`, arriving at `arriveAt`
  | "queued" // the call waits at `node`: every slot is busy (`depth` waiting now)
  | "start" // `node` begins work on the call (`busy` slots in use now)
  | "reject" // `node` refuses or drops the call (`reason`)
  | "reply" // `node` answers `to` (ok or not), arriving at `arriveAt`
  | "cache" // a cache or CDN lookup: `hit`
  | "complete" // a client's logical request ends: ok, or failed with `reason`
  | "timeout" // a client stops waiting for an attempt
  | "late" // an answer arrives after its client stopped waiting: wasted work
  | "publish" // a queue accepts a message (`depth` stored now)
  | "consume" // a queue hands a message to a worker
  | "ack" // a worker finished a message
  | "redeliver" // a worker gives a message back after a failure; it returns to the queue at `arriveAt`
  | "requeue" // the message is back in the queue (`depth` stored now)
  | "applied" // a replica finished applying a replicated write
  | "dead-letter" // a message failed too often and is set aside
  | "replicate" // a primary sends a write to a replica
  | "fault" // a component fails
  | "recover" // a component comes back
  | "health"; // a load balancer marks a server healthy or unhealthy

export type SimEvent = {
  i: number;
  t: number;
  type: EventType;
  node: string;
  to?: string;
  edge?: string;
  arriveAt?: number;
  req?: number;
  attempt?: number;
  msg?: number;
  op?: Op;
  key?: number;
  ok?: boolean;
  hit?: boolean;
  reason?: Failure;
  part?: number;
  depth?: number;
  busy?: number;
  latency?: number;
  status?: number;
  healthy?: boolean;
};

export type SimRun = {
  design: Design;
  events: SimEvent[];
  /** Simulated milliseconds when arrivals stopped, and when the run ended. */
  arrivalsEndMs: number;
  endMs: number;
  truncated: boolean;
};

export class SimulationError extends Error {}

/** mulberry32: small, fast and reproducible. Not for security. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Task = { t: number; seq: number; run: () => void };
export class Heap {
  items: Task[] = [];
  push(task: Task) {
    const a = this.items;
    a.push(task);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (Heap.less(a[p], a[i])) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.less(a[l], a[m])) m = l;
        if (r < a.length && Heap.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  static less(x: Task, y: Task) {
    return x.t < y.t || (x.t === y.t && x.seq < y.seq);
  }
}

/** Least recently used store with optional expiry, keyed by item number. */
class Lru {
  entries = new Map<number, number>();
  capacity: number;
  ttlMs: number;
  constructor(capacity: number, ttlMs: number) {
    this.capacity = capacity;
    this.ttlMs = ttlMs;
  }
  get(key: number, now: number) {
    const expires = this.entries.get(key);
    if (expires === undefined) return false;
    this.entries.delete(key);
    if (expires <= now) return false;
    this.entries.set(key, expires);
    return true;
  }
  set(key: number, now: number) {
    if (this.capacity === 0) return;
    this.entries.delete(key);
    this.entries.set(key, this.ttlMs ? now + this.ttlMs : Infinity);
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value!);
  }
}

type Root = { req?: number; attempt?: number; msg?: number };
type Call = {
  from: string;
  to: string;
  edge?: string;
  op: Op;
  key: number;
  root: Root;
  part: number;
  live: boolean;
  /** Replication work: never refused for a full queue, answers nobody. */
  background: boolean;
  cb: (ok: boolean, failure?: Failure, hit?: boolean) => void;
};
type Slots = { busy: number; limit: number; queueLimit: number; waiting: Call[] };
type Message = { id: number; key: number; receives: number; enqueuedAt: number; req?: number };
type Work = { msg: Message; queue: string; live: boolean };
type Runtime = {
  node: DesignNode;
  down: boolean;
  slots: Slots[];
  active: Set<Call>;
  store?: Lru;
  rr: number;
  outstanding: Map<string, number>;
  unhealthy: Set<string>;
  messages: Message[];
  works: Set<Work>;
};

const UNLIMITED = 1_000_000;

function slotsFor(node: DesignNode): Slots[] {
  const slot = (limit: number, queueLimit: number): Slots => ({ busy: 0, limit, queueLimit, waiting: [] });
  switch (node.kind) {
    case "api": {
      const c = node.config as ConfigOf<"api">;
      return [slot(c.concurrency, c.queueLimit)];
    }
    case "sql": {
      const c = node.config as ConfigOf<"sql">;
      return [slot(c.concurrency, c.queueLimit)];
    }
    case "nosql": {
      const c = node.config as ConfigOf<"nosql">;
      return Array.from({ length: c.partitions }, () => slot(c.concurrencyPerPartition, c.queueLimit));
    }
    case "worker": {
      const c = node.config as ConfigOf<"worker">;
      return [slot(c.concurrency, 0)];
    }
    default:
      return [slot(UNLIMITED, 0)];
  }
}

/** A key's partition: a fixed integer hash, so the same key always lands on the same partition. */
export const partitionOf = (key: number, partitions: number) => (Math.imul(key + 1, 2654435761) >>> 0) % partitions;

/** Cumulative probabilities for Zipf (s = 1) over n items; item 0 is the most popular. */
function zipf(n: number) {
  const cdf = new Float64Array(n);
  let sum = 0;
  for (let k = 0; k < n; k++) cdf[k] = sum += 1 / (k + 1);
  for (let k = 0; k < n; k++) cdf[k] /= sum;
  return cdf;
}

/** Run a design. Throws SimulationError if the design does not validate: a run never starts on an invalid graph. */
export function simulate(design: Design): SimRun {
  const validation = validateDesign(design);
  if (!validation.ok) throw new SimulationError(validation.errors[0].message);
  const g = indexDesign(design);
  const w = design.workload;
  const random = prng(w.seed);
  const heap = new Heap();
  const events: SimEvent[] = [];
  let now = 0;
  let seq = 0;
  let truncated = false;
  const at = (t: number, run: () => void) => heap.push({ t, seq: seq++, run });
  const emit = (e: Omit<SimEvent, "i" | "t">) => {
    if (events.length >= SIM_CONSTANTS.maxEvents) {
      truncated = true;
      return;
    }
    events.push({ i: events.length, t: now, ...e });
  };

  const rt = new Map<string, Runtime>(
    design.nodes.map((node) => {
      const runtime: Runtime = { node, down: false, slots: slotsFor(node), active: new Set(), rr: 0, outstanding: new Map(), unhealthy: new Set(), messages: [], works: new Set() };
      if (node.kind === "cache" || node.kind === "cdn") {
        const c = node.config as ConfigOf<"cache">;
        runtime.store = new Lru(c.capacityKeys, c.ttlS * 1000);
      }
      return [node.id, runtime];
    }),
  );
  const node = (id: string) => rt.get(id)!;

  const hop = (from: string, to: string) => {
    const a = g.byId.get(from)!.kind;
    const b = g.byId.get(to)!.kind;
    if (a === "client") return b === "cdn" ? SIM_CONSTANTS.clientToCdnMs : SIM_CONSTANTS.clientToOriginMs;
    if (a === "cdn") return SIM_CONSTANTS.cdnToOriginMs;
    return SIM_CONSTANTS.internalMs;
  };
  const tag = (root: Root) => ({ req: root.req, attempt: root.attempt, msg: root.msg });

  /** Send a call from one component to another; `cb` runs when the answer is back at the caller. */
  function send(from: string, to: string, op: Op, key: number, root: Root, cb: Call["cb"], background = false) {
    const target = g.byId.get(to)!;
    const part = target.kind === "nosql" ? partitionOf(key, (target.config as ConfigOf<"nosql">).partitions) : 0;
    const call: Call = { from, to, edge: g.edgeBetween(from, to)?.id, op, key, root, part, live: true, background, cb };
    const arriveAt = now + hop(from, to);
    emit({ type: background ? "replicate" : "send", node: from, to, edge: call.edge, arriveAt, op, key, ...tag(root) });
    at(arriveAt, () => arrive(call));
  }

  function arrive(call: Call) {
    const n = node(call.to);
    if (n.down) return refuse(call, { code: "down", node: call.to });
    const s = n.slots[call.part];
    if (s.busy < s.limit) begin(call);
    else if (call.background || s.waiting.length < s.queueLimit) {
      s.waiting.push(call);
      emit({ type: "queued", node: call.to, op: call.op, key: call.key, part: call.part, depth: s.waiting.length, ...tag(call.root) });
    } else refuse(call, { code: "queue-full", node: call.to });
  }

  function refuse(call: Call, failure: Failure) {
    call.live = false;
    emit({ type: "reject", node: call.to, op: call.op, key: call.key, reason: failure, part: call.part, ...tag(call.root) });
    if (!call.background) answer(call, false, failure);
  }

  /** `busy`: the slots still in use at the answering component, when the answer frees one. */
  function answer(call: Call, ok: boolean, failure?: Failure, hit?: boolean, busy?: number) {
    const arriveAt = now + hop(call.from, call.to);
    emit({ type: "reply", node: call.to, to: call.from, edge: call.edge, arriveAt, ok, op: call.op, reason: failure, part: call.part, busy, ...tag(call.root) });
    at(arriveAt, () => call.cb(ok, failure, hit));
  }

  function begin(call: Call) {
    const n = node(call.to);
    const s = n.slots[call.part];
    s.busy++;
    n.active.add(call);
    emit({ type: "start", node: call.to, op: call.op, key: call.key, part: call.part, busy: s.busy, depth: s.waiting.length, ...tag(call.root) });
    handle(n, call, (ok, failure, hit) => {
      if (!call.live) return;
      call.live = false;
      s.busy--;
      n.active.delete(call);
      if (!call.background) answer(call, ok, failure, hit, s.busy);
      else emit({ type: "applied", node: call.to, op: call.op, key: call.key, busy: s.busy });
      while (s.busy < s.limit && s.waiting.length && !n.down) begin(s.waiting.shift()!);
    });
  }

  /** Continue only while the call is still alive: a crash in the meantime discards the rest of the work. */
  const after = (call: Call, ms: number, run: () => void) => at(now + ms, () => call.live && run());
  const sub = (call: Call, to: string, op: Op, key: number, cb: Call["cb"]) => send(call.to, to, op, key, call.root, (...args) => call.live && cb(...args));

  function handle(n: Runtime, call: Call, finish: (ok: boolean, failure?: Failure, hit?: boolean) => void) {
    const id = n.node.id;
    const fail = (failure?: Failure) => finish(false, failure);
    switch (n.node.kind) {
      case "load-balancer": {
        const c = n.node.config as ConfigOf<"load-balancer">;
        const targets = g.out(id).filter((t) => !n.unhealthy.has(t.id));
        if (!targets.length) return after(call, SIM_CONSTANTS.quickOpMs, () => fail({ code: "no-healthy-target", node: id }));
        let target = targets[n.rr++ % targets.length];
        if (c.algorithm === "least-outstanding") {
          const load = (t: DesignNode) => n.outstanding.get(t.id) ?? 0;
          target = targets.reduce((best, t) => (load(t) < load(best) ? t : best), target);
        }
        return after(call, SIM_CONSTANTS.quickOpMs, () => {
          n.outstanding.set(target.id, (n.outstanding.get(target.id) ?? 0) + 1);
          send(id, target.id, call.op, call.key, call.root, (ok, failure) => {
            n.outstanding.set(target.id, n.outstanding.get(target.id)! - 1);
            if (call.live) finish(ok, failure);
          });
        });
      }
      case "cdn": {
        const origins = g.out(id);
        const files = origins.find((o) => o.kind === "object-storage");
        const app = origins.find((o) => o.kind === "api" || o.kind === "load-balancer");
        return after(call, SIM_CONSTANTS.quickOpMs, () => {
          if (call.op !== "asset") {
            if (!app) return fail({ code: "no-origin", node: id });
            return sub(call, app.id, call.op, call.key, finish);
          }
          const hit = n.store!.get(call.key, now);
          emit({ type: "cache", node: id, key: call.key, hit, ...tag(call.root) });
          if (hit) return finish(true);
          const origin = files ?? app;
          if (!origin) return fail({ code: "no-origin", node: id });
          sub(call, origin.id, "asset", call.key, (ok, failure) => {
            if (ok) n.store!.set(call.key, now);
            finish(ok, failure);
          });
        });
      }
      case "cache":
        return after(call, SIM_CONSTANTS.quickOpMs, () => {
          if (call.op === "get") {
            const hit = n.store!.get(call.key, now);
            emit({ type: "cache", node: id, key: call.key, hit, ...tag(call.root) });
            return finish(true, undefined, hit);
          }
          if (call.op === "set") n.store!.set(call.key, now);
          else n.store!.entries.delete(call.key);
          finish(true);
        });
      case "api": {
        const c = n.node.config as ConfigOf<"api">;
        const { primaries, replicas } = g.dataStores(id);
        const primary = primaries[0];
        const cache = g.out(id).find((o) => o.kind === "cache");
        const files = g.out(id).find((o) => o.kind === "object-storage");
        const queue = g.out(id, "async")[0];
        return after(call, c.serviceMs, () => {
          if (call.op === "asset") return files ? sub(call, files.id, "asset", call.key, finish) : finish(true);
          if (call.op === "read") {
            const fromDatabase = () => {
              if (!primary) return finish(true);
              const readers = [primary, ...replicas];
              const reader = readers[n.rr++ % readers.length];
              sub(call, reader.id, "read", call.key, (ok, failure) => {
                if (!ok) return fail(failure);
                if (cache) sub(call, cache.id, "set", call.key, () => finish(true));
                else finish(true);
              });
            };
            // A cache that is down or refuses counts as a miss: the read goes to the database.
            if (cache) return sub(call, cache.id, "get", call.key, (ok, _failure, hit) => (ok && hit ? finish(true) : fromDatabase()));
            return fromDatabase();
          }
          if (queue) return sub(call, queue.id, "publish", call.key, finish);
          if (!primary) return finish(true);
          sub(call, primary.id, "write", call.key, (ok, failure) => {
            if (!ok) return fail(failure);
            if (cache) sub(call, cache.id, "delete", call.key, () => finish(true));
            else finish(true);
          });
        });
      }
      case "sql": {
        const c = n.node.config as ConfigOf<"sql">;
        const write = call.op === "write" || call.op === "apply";
        return after(call, write ? c.writeMs : c.readMs, () => {
          if (call.op === "write") for (const replica of g.out(id, "replication")) send(id, replica.id, "apply", call.key, call.root, () => {}, true);
          finish(true);
        });
      }
      case "nosql":
        return after(call, (n.node.config as ConfigOf<"nosql">).opMs, () => finish(true));
      case "object-storage":
        return after(call, (n.node.config as ConfigOf<"object-storage">).latencyMs, () => finish(true));
      case "queue":
        return after(call, SIM_CONSTANTS.quickOpMs, () => {
          if (n.messages.length >= (n.node.config as ConfigOf<"queue">).maxDepth) return fail({ code: "queue-full", node: id });
          n.messages.push({ id: ++messageId, key: call.key, receives: 0, enqueuedAt: now, req: call.root.req });
          emit({ type: "publish", node: id, msg: messageId, key: call.key, depth: n.messages.length, req: call.root.req, attempt: call.root.attempt });
          finish(true);
          dispatch(id);
        });
      default:
        return fail();
    }
  }

  let messageId = 0;

  /** Hand stored messages to workers with a free slot, in turn. Workers pull; nothing is pushed to a busy one. */
  function dispatch(queueId: string) {
    const q = node(queueId);
    if (q.down) return;
    const workers = g.out(queueId, "async").map((w) => node(w.id));
    while (q.messages.length) {
      const free = workers.filter((w) => !w.down && w.slots[0].busy < w.slots[0].limit);
      if (!free.length) return;
      const worker = free[q.rr++ % free.length];
      process(q, worker, q.messages.shift()!);
    }
  }

  function process(q: Runtime, worker: Runtime, msg: Message) {
    const c = worker.node.config as ConfigOf<"worker">;
    const s = worker.slots[0];
    msg.receives++;
    s.busy++;
    const work: Work = { msg, queue: q.node.id, live: true };
    worker.works.add(work);
    emit({ type: "consume", node: q.node.id, to: worker.node.id, edge: g.edgeBetween(q.node.id, worker.node.id)?.id, msg: msg.id, key: msg.key, depth: q.messages.length, busy: s.busy });
    const { primaries } = g.dataStores(worker.node.id);
    const cache = g.out(worker.node.id).find((o) => o.kind === "cache");
    const done = (ok: boolean, failure?: Failure) => {
      if (!work.live) return;
      work.live = false;
      worker.works.delete(work);
      s.busy--;
      if (ok) emit({ type: "ack", node: worker.node.id, msg: msg.id, latency: now - msg.enqueuedAt, busy: s.busy });
      else retryMessage(q, c, msg, failure ?? { code: "down", node: worker.node.id }, worker.node.id, s.busy);
      for (const source of g.into(worker.node.id, "async")) dispatch(source.id);
    };
    at(now + c.serviceMs, () => {
      if (!work.live) return;
      const root = { msg: msg.id };
      send(worker.node.id, primaries[0].id, "write", msg.key, root, (ok, failure) => {
        if (!ok || !cache) return done(ok, failure);
        send(worker.node.id, cache.id, "delete", msg.key, root, () => done(true));
      });
    });
  }

  function retryMessage(q: Runtime, c: ConfigOf<"worker">, msg: Message, failure: Failure, worker: string, busy?: number) {
    if (msg.receives >= c.maxReceives) return emit({ type: "dead-letter", node: q.node.id, to: worker, msg: msg.id, reason: failure, key: msg.key, busy });
    emit({ type: "redeliver", node: worker, to: q.node.id, edge: g.edgeBetween(q.node.id, worker)?.id, msg: msg.id, reason: failure, arriveAt: now + c.retryDelayMs, busy });
    at(now + c.retryDelayMs, () => {
      q.messages.push(msg);
      emit({ type: "requeue", node: q.node.id, msg: msg.id, depth: q.messages.length });
      dispatch(q.node.id);
    });
  }

  // ---- Failures and health checks ----
  const downAt = (id: string, t: number) => design.faults.some((f) => f.node === id && f.fromS * 1000 <= t && t < f.toS * 1000);
  for (const fault of design.faults) {
    at(fault.fromS * 1000, () => crash(fault.node));
    at(fault.toS * 1000, () => !downAt(fault.node, now) && recover(fault.node));
    for (const lb of g.into(fault.node).filter((n) => n.kind === "load-balancer")) {
      const c = lb.config as ConfigOf<"load-balancer">;
      if (!c.healthChecks) continue;
      // The first health check after a change notices it.
      const detect = (ms: number) => (Math.floor(ms / c.checkIntervalMs) + 1) * c.checkIntervalMs;
      at(detect(fault.fromS * 1000), () => {
        if (!downAt(fault.node, now) || node(lb.id).unhealthy.has(fault.node)) return;
        node(lb.id).unhealthy.add(fault.node);
        emit({ type: "health", node: lb.id, to: fault.node, healthy: false });
      });
      at(detect(fault.toS * 1000), () => {
        if (downAt(fault.node, now) || !node(lb.id).unhealthy.delete(fault.node)) return;
        emit({ type: "health", node: lb.id, to: fault.node, healthy: true });
      });
    }
  }

  function crash(id: string) {
    const n = node(id);
    if (n.down) return;
    n.down = true;
    emit({ type: "fault", node: id });
    for (const s of n.slots) {
      for (const call of [...s.waiting]) refuse(call, { code: "crashed", node: id });
      s.waiting = [];
    }
    for (const call of [...n.active]) {
      n.slots[call.part].busy--;
      refuse(call, { code: "crashed", node: id });
    }
    n.active.clear();
    // Memory is lost: a cache comes back empty. Queues and databases keep their data.
    if (n.store) n.store.entries.clear();
    for (const work of [...n.works]) {
      work.live = false;
      n.slots[0].busy--;
      retryMessage(node(work.queue), n.node.config as ConfigOf<"worker">, work.msg, { code: "crashed", node: id }, id);
    }
    n.works.clear();
  }

  function recover(id: string) {
    const n = node(id);
    if (!n.down) return;
    n.down = false;
    emit({ type: "recover", node: id });
    if (n.node.kind === "queue") dispatch(id);
    if (n.node.kind === "worker") for (const source of g.into(id, "async")) dispatch(source.id);
  }

  // ---- Clients ----
  const durationMs = w.durationS * 1000;
  const cdf = w.skew === "popular" ? { keys: zipf(w.keys), assets: zipf(w.assets) } : null;
  const pick = (n: number, table: Float64Array | undefined) => {
    const r = random();
    if (!table) return Math.min(n - 1, Math.floor(r * n));
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (table[mid] < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  let requestId = 0;

  for (const client of design.nodes.filter((n) => n.kind === "client")) {
    const c = client.config as ConfigOf<"client">;
    const targets = g.out(client.id);
    const app = targets.find((t) => t.kind === "api" || t.kind === "load-balancer");
    const cdn = targets.find((t) => t.kind === "cdn");
    const files = targets.find((t) => t.kind === "cdn" || t.kind === "object-storage");
    const entryFor = (op: Op) => (op === "asset" ? files ?? app! : app ?? cdn!);
    // Steady arrivals are computed from their index, so rounding never adds an extra one.
    let index = 0;
    let previous = 0;
    const nextArrival = () => (w.pattern === "steady" ? (++index * 1000) / c.rps : (previous += (-Math.log(1 - random()) * 1000) / c.rps));

    const arrival = () => {
      const r = random() * 100;
      const op: Op = r < c.assetPercent ? "asset" : r < c.assetPercent + c.writePercent ? "write" : "read";
      const key = op === "asset" ? pick(w.assets, cdf?.assets) : pick(w.keys, cdf?.keys);
      const req = ++requestId;
      const startedAt = now;
      emit({ type: "request", node: client.id, req, op, key, attempt: 1 });
      const attempt = (n: number) => {
        let settled = false;
        if (n > 1) emit({ type: "retry", node: client.id, req, op, key, attempt: n });
        const next = (failure: Failure) => {
          if (n <= c.retries) at(now + c.backoffMs * 2 ** (n - 1), () => attempt(n + 1));
          else emit({ type: "complete", node: client.id, req, op, attempt: n, ok: false, reason: failure, latency: now - startedAt });
        };
        at(now + c.timeoutMs, () => {
          if (settled) return;
          settled = true;
          emit({ type: "timeout", node: client.id, req, op, attempt: n });
          next({ code: "timeout", node: client.id });
        });
        send(client.id, entryFor(op).id, op, key, { req, attempt: n }, (ok, failure) => {
          if (settled) return emit({ type: "late", node: client.id, req, op, attempt: n, ok });
          settled = true;
          if (ok) emit({ type: "complete", node: client.id, req, op, attempt: n, ok: true, latency: now - startedAt, status: op === "write" && writesQueued(entryFor(op).id) ? 202 : 200 });
          else next(failure!);
        });
      };
      attempt(1);
      const t = nextArrival();
      if (t < durationMs) at(t, arrival);
    };
    const first = w.pattern === "steady" ? 0 : nextArrival();
    if (first < durationMs) at(first, arrival);
  }

  /** Writes through this entry are accepted onto a queue (202) rather than stored before the answer (200). */
  function writesQueued(entry: string): boolean {
    const n = g.byId.get(entry)!;
    if (n.kind === "api") return g.out(entry, "async").length > 0;
    return g.out(entry).some((o) => (o.kind === "api" || o.kind === "load-balancer") && writesQueued(o.id));
  }

  const endLimit = durationMs + SIM_CONSTANTS.drainMs;
  while (heap.items.length && !truncated) {
    const task = heap.pop();
    if (task.t > endLimit) break;
    now = task.t;
    task.run();
  }
  // The run ends with its last event; timers that fired with nothing left to do don't extend it.
  return { design, events, arrivalsEndMs: durationMs, endMs: events.at(-1)?.t ?? 0, truncated };
}
