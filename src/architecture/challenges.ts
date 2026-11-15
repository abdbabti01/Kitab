// Guided design challenges: requirements, constraints, scenarios to run, and checks on what the runs show.
// A challenge never matches a diagram: any design whose runs meet the checks passes. Pure data and functions.
import { components, configFor, type ComponentKind, type Design, type Fault, type Workload } from "./model.ts";
import { designCost, summarize, type Summary } from "./metrics.ts";
import { simulate, type SimRun } from "./simulate.ts";
import { build } from "./templates.ts";
import { validateDesign, type Validation } from "./validate.ts";
import { ms, pct } from "./explain.ts";

export type Outcome = { run: SimRun; summary: Summary };
export type Scenario = {
  id: string;
  title: string;
  workload?: Partial<Workload>;
  /** Failure variants: each set of faults is one run; a check must hold in every one. None: one run with no faults. */
  faults?: (design: Design) => Fault[][];
};
export type CheckResult = { passed: boolean; observed: string };
export type Check = { id: string; requirement: string; scenario: string; test: (outcomes: Outcome[], design: Design) => CheckResult };

export type Challenge = {
  id: string;
  /** Bumped when requirements change; progress made against another version starts again. */
  version: string;
  title: string;
  summary: string;
  story: string;
  requirements: string[];
  constraints: string[];
  /** Settings fixed by the challenge, applied to every component of that kind before any run. */
  fixed: Partial<Record<ComponentKind, Record<string, number | string | boolean>>>;
  /** Components that can't be removed. */
  locked: string[];
  budget: number;
  starter: () => Design;
  workload: Partial<Workload>;
  scenarios: Scenario[];
  checks: Check[];
  hints: string[];
  /** Valid approaches and their trade-offs, shown once the learner has passed. */
  approaches: { title: string; detail: string }[];
};

const all = (outcomes: Outcome[], test: (s: Summary, o: Outcome) => boolean) => outcomes.every((o) => test(o.summary, o));
const worst = <T>(outcomes: Outcome[], value: (s: Summary, o: Outcome) => T, pick: (a: T, b: T) => T) => outcomes.map((o) => value(o.summary, o)).reduce((a, b) => pick(a, b));

const percent = (value: number) => `${+(value * 100).toFixed(1)}%`;
const success = (scenario: string, min: number, label = `At least ${percent(min)} of requests succeed`): Check => ({
  id: `success-${scenario}`,
  requirement: label,
  scenario,
  test: (outcomes) => {
    const rate = worst(outcomes, (s) => s.successRate, Math.min);
    return { passed: rate >= min, observed: `${(rate * 100).toFixed(1)}% succeeded${outcomes.length > 1 ? " (worst run)" : ""}` };
  },
});

const latency = (scenario: string, max: number, op?: "read" | "write", label?: string): Check => ({
  id: `p95-${scenario}${op ? `-${op}` : ""}`,
  requirement: label ?? `95% of ${op ? `${op}s` : "requests"} finish within ${max} ms`,
  scenario,
  test: (outcomes) => {
    const p95 = worst(outcomes, (s) => (op ? s.byOp[op]?.p95 ?? null : s.p95) ?? Infinity, Math.max);
    return { passed: p95 <= max, observed: p95 === Infinity ? "no request succeeded" : `95% within ${ms(p95)}` };
  },
});

const databaseLoad = (scenario: string, max: number): Check => ({
  id: `db-load-${scenario}`,
  requirement: `No database is busy more than ${pct(max)} of the time`,
  scenario,
  test: (outcomes, design) => {
    const dbs = design.nodes.filter((n) => n.kind === "sql" || n.kind === "nosql");
    if (!dbs.length) return { passed: false, observed: "there is no database" };
    const peak = worst(outcomes, (s) => Math.max(...dbs.map((d) => Math.max(...(s.nodes[d.id].utilisation ?? [0])))), Math.max);
    return { passed: peak <= max, observed: `busiest database in use ${pct(peak)} of the time` };
  },
});

const writesStored: Check = {
  id: "writes-stored",
  requirement: "Every successful write is stored in a database",
  scenario: "normal",
  test: (outcomes, design) => {
    const dbs = new Set(design.nodes.filter((n) => n.kind === "sql" || n.kind === "nosql").map((n) => n.id));
    const { run, summary } = outcomes[0];
    const stored = run.events.filter((e) => e.type === "start" && dbs.has(e.node) && e.op === "write").length;
    const ok = summary.byOp.write?.ok ?? 0;
    return { passed: ok > 0 && stored >= ok, observed: dbs.size ? `${stored.toLocaleString("en")} database writes for ${ok.toLocaleString("en")} successful writes` : "there is no database: writes are kept only in a server's memory" };
  },
};

const budget = (max: number): Check => ({
  id: "budget",
  requirement: `The design costs at most ${max} units`,
  scenario: "normal",
  test: (_outcomes, design) => {
    const cost = designCost(design);
    return { passed: cost <= max, observed: `costs ${cost} units` };
  },
});

const eachApi = (fromS: number, toS: number) => (design: Design) => {
  const apis = design.nodes.filter((n) => n.kind === "api").slice(0, 4);
  return apis.length ? apis.map((api) => [{ node: api.id, fromS, toS }]) : [[]];
};
const firstOf = (kind: ComponentKind, fromS: number, toS: number) => (design: Design) => {
  const target = design.nodes.find((n) => n.kind === kind);
  return [target ? [{ node: target.id, fromS, toS }] : []];
};

const client = (label: string, config: Record<string, unknown>) => ["client-1", "client", label, 80, 220, config] as const;

export const challenges: Challenge[] = [
  {
    id: "simple-web-app",
    version: "1",
    title: "Design a simple web application",
    summary: "A notes app: users read and save notes. Make it work, reliably and quickly.",
    story: "A small team is launching a notes app. About 30 requests arrive each second: 80% read a note, 20% save one. Notes must survive a server restart.",
    requirements: ["Users can read and save notes.", "Saved notes are stored durably, not only in a server's memory."],
    constraints: ["The users' traffic is fixed: 30 requests per second, 20% writes.", "Budget: 8 cost units."],
    fixed: { client: { rps: 30, writePercent: 20, assetPercent: 0 } },
    locked: ["client-1"],
    budget: 8,
    starter: () => build("Notes app", [client("Users", { rps: 30, writePercent: 20 })], []),
    workload: { durationS: 10, keys: 1000 },
    scenarios: [{ id: "normal", title: "A normal day" }],
    checks: [success("normal", 0.99), latency("normal", 250), writesStored, budget(8)],
    hints: [
      "A client needs something to answer it: add an API server and connect the client to it.",
      "Where are notes kept when the server restarts? Connect the API server to a database.",
      "Run the simulation and look at the inspector: each request crosses the Internet twice (40 ms each way).",
    ],
    approaches: [
      { title: "API server and SQL database", detail: "The classic three-tier design. SQL gives tables, transactions and queries across notes; at this load one server and one database are far from their limits." },
      { title: "API server and NoSQL database", detail: "Notes are looked up by id, which suits a key-value store. You give up joins and multi-item transactions; at this scale either choice works." },
      { title: "Adding a load balancer now", detail: "Valid, and it makes adding a second server later painless, but it costs units for capacity this load doesn't need yet." },
    ],
  },
  {
    id: "cache-read-heavy",
    version: "1",
    title: "Add caching to a read-heavy API",
    summary: "A product catalogue is slow at peak. The database is the bottleneck. Fix it without a bigger database.",
    story: "A shop's catalogue API serves 400 requests per second, 95% of them reads, and a few popular products get most views. Pages are slow and the database is nearly always busy.",
    requirements: ["Keep serving reads and writes.", "Pages must become fast again."],
    constraints: ["The database can't be made bigger: its settings are fixed (8 queries at once, 20 ms per read).", "Traffic is fixed: 400 requests per second, 5% writes, popular products.", "Budget: 12 cost units."],
    fixed: { client: { rps: 400, writePercent: 5, assetPercent: 0 }, sql: { concurrency: 8, readMs: 20, writeMs: 15, queueLimit: 100 } },
    locked: ["client-1"],
    budget: 12,
    starter: () =>
      build("Catalogue API", [
        client("Shoppers", { rps: 400, writePercent: 5 }),
        ["api-1", "api", "Catalogue API", 340, 220, { concurrency: 64, serviceMs: 10, queueLimit: 200 }],
        ["sql-1", "sql", "Products database", 600, 220, { concurrency: 8, readMs: 20, writeMs: 15 }],
      ], [["client-1", "api-1"], ["api-1", "sql-1"]]),
    workload: { durationS: 8, keys: 2000, skew: "popular" },
    scenarios: [{ id: "normal", title: "Peak traffic" }],
    checks: [success("normal", 0.995), latency("normal", 150, "read"), databaseLoad("normal", 0.7), budget(12)],
    hints: [
      "Open the run's findings: which component is busy almost all the time?",
      "Most reads ask for the same few products. Something in memory could answer those without the database.",
      "Another way to share reads is a copy of the database that only serves reads.",
    ],
    approaches: [
      { title: "Cache-aside cache", detail: "Cheapest (2 units). Popular products are answered from memory, so the database sees mostly misses. Cached data can be stale until a write removes it, and a cold or failed cache sends everything back to the database." },
      { title: "Read replica", detail: "Costs 4 units. Reads are shared between the primary and the replica, and nothing can be stale in this model; in reality a replica lags slightly behind. The replica also has to apply every write, so it scales reads, not writes." },
      { title: "Both", detail: "Over the budget here, but common in production: the cache absorbs popular reads and replicas cover the misses and a cache outage." },
    ],
  },
  {
    id: "scale-behind-lb",
    version: "1",
    title: "Scale an API behind a load balancer",
    summary: "One API server can't keep up, and a single server is a single point of failure.",
    story: "A booking API receives 600 requests per second. One server can't handle that, and when it restarts everyone gets errors. Spread the load and stay up when any one server fails.",
    requirements: ["Serve the full load.", "Keep working while any one API server is down."],
    constraints: ["Each API server is fixed: 8 requests at once, 25 ms of work each.", "Traffic is fixed: 600 requests per second, 10% writes.", "Budget: 16 cost units."],
    fixed: { client: { rps: 600, writePercent: 10, assetPercent: 0 }, api: { concurrency: 8, serviceMs: 25 }, sql: { concurrency: 40, readMs: 5, writeMs: 15 } },
    locked: ["client-1"],
    budget: 16,
    starter: () =>
      build("Booking API", [
        client("Travellers", { rps: 600, writePercent: 10 }),
        ["api-1", "api", "Booking API", 340, 220, { concurrency: 8, serviceMs: 25 }],
        ["sql-1", "sql", "Bookings database", 600, 220, { concurrency: 40 }],
      ], [["client-1", "api-1"], ["api-1", "sql-1"]]),
    workload: { durationS: 8 },
    scenarios: [
      { id: "normal", title: "Full load" },
      { id: "server-down", title: "Any one API server down from 2 s to 6 s", faults: eachApi(2, 6) },
    ],
    checks: [success("normal", 0.999), latency("normal", 200), success("server-down", 0.98, "With any one API server down, at least 98% of requests succeed"), budget(16)],
    hints: [
      "How many requests per second can one server finish? The inspector shows its capacity from its settings.",
      "A load balancer spreads requests over several servers. How many do you need, and how many if one is down?",
      "When a server fails, how quickly does the load balancer notice? Look at its health-check settings, and at what the client does after an error.",
    ],
    approaches: [
      { title: "N + 1 servers with health checks", detail: "Enough servers to carry the load with one missing. Requests sent to the failed server before the next health check still fail, so a shorter check interval loses fewer." },
      { title: "Client retries", detail: "One retry with backoff lets a request that hit the failed server succeed on another. Cheap, but every retry is extra load: with too little spare capacity, retries make an overload worse." },
      { title: "Least-outstanding balancing", detail: "Sends each request to the server with the fewest in progress, which evens out load when servers slow down unequally. With identical servers it behaves much like round-robin." },
    ],
  },
  {
    id: "async-orders",
    version: "1",
    title: "Design an asynchronous order system",
    summary: "Accept orders instantly, process them in the background, and lose none when the database fails.",
    story: "A shop receives 150 orders per second at peak. Processing an order (payment and stock checks) takes 200 ms of work in the order service. Customers must get an answer quickly, and no order may be lost, even if the database is down for a few seconds.",
    requirements: ["Accept each order quickly.", "Process every order in the background order service (workers) and store it.", "Lose no order during a short database outage."],
    constraints: ["Traffic is fixed: 150 orders per second.", "Each worker is fixed: 8 orders at once, 200 ms of work each.", "Budget: 16 cost units."],
    fixed: { client: { rps: 150, writePercent: 100, assetPercent: 0 }, worker: { concurrency: 8, serviceMs: 200 }, sql: { concurrency: 20, writeMs: 15 } },
    locked: ["client-1"],
    budget: 16,
    starter: () =>
      build("Order system", [
        client("Shoppers", { rps: 150, writePercent: 100 }),
        ["api-1", "api", "Orders API", 320, 220, { concurrency: 32, serviceMs: 10 }],
        ["sql-1", "sql", "Orders database", 860, 220, { concurrency: 20 }],
      ], [["client-1", "api-1"], ["api-1", "sql-1"]]),
    workload: { durationS: 8 },
    scenarios: [
      { id: "normal", title: "Peak orders" },
      { id: "db-down", title: "Database down from 2 s to 5 s", faults: firstOf("sql", 2, 5) },
    ],
    checks: [
      latency("normal", 150, "write", "95% of orders are accepted within 150 ms"),
      {
        id: "processed",
        requirement: "Every accepted order is processed and stored within 20 s",
        scenario: "normal",
        test: (outcomes) => processed(outcomes),
      },
      success("db-down", 0.999, "During the database outage, at least 99.9% of orders are accepted"),
      {
        id: "none-lost",
        requirement: "No order is lost or set aside during the outage",
        scenario: "db-down",
        test: (outcomes) => processed(outcomes),
      },
      budget(16),
    ],
    hints: [
      "If the API waits for the database, what do customers see when the database is down?",
      "A queue lets the API answer as soon as the order is safely stored in the queue. Workers then take orders from it.",
      "Workers must keep up: 150 orders per second at 200 ms each needs how many slots in total?",
      "During the outage, workers fail to store orders and return them to the queue. How many tries do they get, and how long between them?",
    ],
    approaches: [
      { title: "Queue with enough workers", detail: "The API answers 202 Accepted once the order is queued; workers process it later. Customers wait milliseconds instead of the processing time, and the queue absorbs bursts and outages. The cost: the order isn't processed when the customer sees “accepted”, so failures must be handled later, not shown to them." },
      { title: "More retries, or longer between them", detail: "A worker that can't reach the database returns the order to the queue. Retrying for longer than the outage (more receives, or a longer delay) means no order becomes a dead letter; too long a delay slows recovery." },
      { title: "More workers vs. bigger workers", detail: "Throughput is slots ÷ time per order. More workers also survive one worker failing, which this challenge doesn't test but production would." },
    ],
  },
  {
    id: "resilient-api",
    version: "1",
    title: "Survive a server failure without a retry storm",
    summary: "When one server fails, errors and retries pile up until everything slows down. Make the design fail gracefully.",
    story: "A ticketing API runs on two servers behind a load balancer. When one failed last week, the other was flooded: clients retried instantly, three times, and almost every request timed out.",
    requirements: ["Serve 300 requests per second.", "Stay fast and available while one API server is down."],
    constraints: ["Each API server is fixed: 8 requests at once, 30 ms of work each.", "Traffic is fixed: 300 requests per second.", "Budget: 14 cost units."],
    fixed: { client: { rps: 300, writePercent: 10, assetPercent: 0 }, api: { concurrency: 8, serviceMs: 30 }, sql: { concurrency: 40, readMs: 5, writeMs: 15 } },
    locked: ["client-1"],
    budget: 14,
    starter: () =>
      build("Ticketing API", [
        client("Fans", { rps: 300, writePercent: 10, timeoutMs: 1000, retries: 3, backoffMs: 0 }),
        ["load-balancer-1", "load-balancer", "Load balancer", 300, 220, { healthChecks: false }],
        ["api-1", "api", "Ticket API", 520, 120, { concurrency: 8, serviceMs: 30 }],
        ["api-2", "api", "Ticket API 2", 520, 320, { concurrency: 8, serviceMs: 30 }],
        ["sql-1", "sql", "Tickets database", 760, 220, { concurrency: 40 }],
      ], [["client-1", "load-balancer-1"], ["load-balancer-1", "api-1"], ["load-balancer-1", "api-2"], ["api-1", "sql-1"], ["api-2", "sql-1"]]),
    workload: { durationS: 10 },
    scenarios: [
      { id: "normal", title: "Normal load" },
      { id: "server-down", title: "Any one API server down from 2 s to 7 s", faults: eachApi(2, 7) },
    ],
    checks: [
      success("normal", 0.999),
      success("server-down", 0.99, "With any one API server down, at least 99% of requests succeed"),
      latency("server-down", 400, undefined, "With a server down, 95% of requests still finish within 400 ms"),
      {
        id: "retry-load",
        requirement: "Retries add at most 20% extra traffic during the failure",
        scenario: "server-down",
        test: (outcomes) => {
          const extra = worst(outcomes, (s) => s.retries / Math.max(1, s.requests), Math.max);
          return { passed: extra <= 0.2, observed: `retries added ${pct(extra)}` };
        },
      },
      budget(14),
    ],
    hints: [
      "Run the starter with a server down and read the findings: where do the errors and timeouts come from?",
      "Does the load balancer notice that a server has failed?",
      "Can one server carry the whole load alone? Compare its capacity with 300 requests per second.",
      "Instant retries hit the overloaded server again at once. Try fewer retries, with backoff.",
    ],
    approaches: [
      { title: "Health checks plus spare capacity", detail: "Health checks stop traffic to the failed server; a third server means the survivors aren't overloaded. Each piece alone isn't enough: without spare capacity the remaining server queues and times out." },
      { title: "Fewer retries with backoff", detail: "One retry after a pause recovers requests that hit the failed server before it was detected, without multiplying load on the survivors. Instant, repeated retries are what turned a partial outage into a full one." },
      { title: "Bounded queues", detail: "A server that refuses work when its queue is full fails fast instead of making every request wait until it times out. Fast failures plus a retry elsewhere beat slow failures." },
    ],
  },
  {
    id: "url-shortener",
    version: "1",
    title: "Build a URL shortener",
    summary: "Turn long links into short codes and redirect a thousand visitors a second, even when the cache fails.",
    story: "Your URL shortener is popular: 1,000 requests per second, 90% of them redirects (reads) and 10% new short links (writes). A handful of links go viral and get most of the clicks. Redirects must be fast, and a cache restart must not take the service down.",
    requirements: ["Create short links and redirect visitors.", "Redirects must be fast.", "Keep working if the cache fails for a few seconds."],
    constraints: ["Traffic is fixed: 1,000 requests per second, 10% writes, popular links.", "API servers are fixed: 16 requests at once, 10 ms each. SQL databases are fixed: 8 queries at once, 10 ms per read, 20 ms per write. NoSQL databases are fixed: 4 partitions of 4, 5 ms per operation.", "Budget: 20 cost units."],
    fixed: {
      client: { rps: 1000, writePercent: 10, assetPercent: 0 },
      api: { concurrency: 16, serviceMs: 10 },
      sql: { concurrency: 8, readMs: 10, writeMs: 20 },
      nosql: { partitions: 4, concurrencyPerPartition: 4, opMs: 5 },
    },
    locked: ["client-1"],
    budget: 20,
    starter: () => build("URL shortener", [client("Visitors", { rps: 1000, writePercent: 10 })], []),
    workload: { durationS: 8, keys: 50_000, skew: "popular" },
    scenarios: [
      { id: "normal", title: "Peak traffic" },
      { id: "cache-down", title: "The cache fails from 3 s to 6 s", faults: firstOf("cache", 3, 6) },
    ],
    checks: [success("normal", 0.995), latency("normal", 130, "read", "95% of redirects finish within 130 ms"), success("cache-down", 0.99, "With the cache down, at least 99% of requests succeed"), budget(20)],
    hints: [
      "Estimate first: 900 reads and 100 writes per second. How many can one API server and one database finish?",
      "A few links get most clicks. What answers those without touching the database?",
      "When the cache fails, every read goes to the database at once. Can it take that load? What could share it?",
    ],
    approaches: [
      { title: "Load balancer, servers, cache and a read replica", detail: "The cache answers viral links; the replica gives the database tier enough read capacity to survive a cache outage. A typical relational design." },
      { title: "NoSQL by short code", detail: "A redirect is a lookup by key, exactly what a partitioned store does well. Spread over partitions it carries the full read load without a cache, though a single viral link always lands on one partition." },
      { title: "Cache in front of NoSQL", detail: "Takes the hottest keys off their partition and cuts latency further, at extra cost. Without a cache, NoSQL alone is the cheaper valid design here." },
    ],
  },
];

function processed(outcomes: Outcome[]): CheckResult {
  let accepted = 0;
  let acked = 0;
  let dead = 0;
  let slowest = 0;
  for (const { run } of outcomes) {
    for (const e of run.events) {
      if (e.type === "publish") accepted++;
      if (e.type === "ack") {
        acked++;
        slowest = Math.max(slowest, e.latency!);
      }
      if (e.type === "dead-letter") dead++;
    }
  }
  if (!accepted) return { passed: false, observed: "no order reached a queue, so no worker processed any" };
  const passed = acked === accepted && dead === 0 && slowest <= 20_000;
  return { passed, observed: `${acked.toLocaleString("en")} of ${accepted.toLocaleString("en")} processed${dead ? `, ${dead} dead letters` : ""}; slowest after ${ms(slowest)}` };
}

export const findChallenge = (id: string) => challenges.find((c) => c.id === id);

/** The design as the challenge runs it: fixed settings applied to every component of that kind, workload set. */
export function challengeDesign(challenge: Challenge, design: Design): Design {
  return {
    ...design,
    nodes: design.nodes.map((node) => {
      const fixed = challenge.fixed[node.kind];
      return fixed ? { ...node, config: configFor(node.kind, { ...node.config, ...fixed }) } : node;
    }),
    workload: { ...design.workload, seed: 1, pattern: "random", ...challenge.workload } as Design["workload"],
    faults: [],
  };
}

export type Evaluation = {
  validation: Validation;
  checks: (Check & CheckResult)[];
  passed: boolean;
  cost: number;
  outcomes: Record<string, Outcome[]>;
};

/** Run every scenario the challenge's checks need and judge each check. Only the simulator decides. */
export function evaluate(challenge: Challenge, learnerDesign: Design): Evaluation {
  const design = challengeDesign(challenge, learnerDesign);
  const validation = validateDesign(design);
  const cost = designCost(design);
  if (!validation.ok) return { validation, checks: challenge.checks.map((c) => ({ ...c, passed: false, observed: "the design isn't valid yet" })), passed: false, cost, outcomes: {} };
  const outcomes: Record<string, Outcome[]> = {};
  for (const scenario of challenge.scenarios) {
    const variants = scenario.faults ? scenario.faults(design) : [[]];
    outcomes[scenario.id] = variants.map((faults) => {
      const run = simulate({ ...design, workload: { ...design.workload, ...scenario.workload }, faults });
      return { run, summary: summarize(run) };
    });
  }
  const checks = challenge.checks.map((check) => ({ ...check, ...check.test(outcomes[check.scenario], design) }));
  return { validation, checks, passed: checks.every((c) => c.passed), cost, outcomes };
}

/** A setting the challenge fixes, so the editor can show it as fixed instead of editable. */
export const isFixed = (challenge: Challenge | undefined, kind: ComponentKind, field: string) => Boolean(challenge?.fixed[kind] && field in challenge.fixed[kind]!);

export const kindName = (kind: ComponentKind) => components[kind].name;
