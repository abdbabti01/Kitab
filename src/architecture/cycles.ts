// Guided experiments for the System Design lessons: each runs the lesson's own experiment designs in the real
// discrete-event simulator. Every outcome, reason and comparison is read from the run's summary (the same numbers
// the run view and findings show). Pure: no React.
import type { Cycle, Evidence, Reading } from "../learning/cycle.ts";
import { compareChoices, direction } from "../learning/cycle.ts";
import { findArchitectureLesson } from "./lessons.ts";
import { simulate, type FailCode, type SimRun } from "./simulate.ts";
import { summarize, type Summary } from "./metrics.ts";
import { limitSettings, ms, pct } from "./explain.ts";
import type { Design } from "./model.ts";

/** A lesson experiment's design and rate, plus at most one named change. */
export type SdSetup = { lesson: string; variant: string; rate: number; change?: keyof typeof changes };
export type SdRun = { run: SimRun; summary: Summary };

type Config = Record<string, number | boolean | string>;
const config = (d: Design, id: string) => d.nodes.find((n) => n.id === id)!.config as Config;

/** The one change a variation makes, applied to the lesson's design. */
const changes = {
  "slots-8": (d: Design) => void (config(d, "api-1").concurrency = 8),
  "queue-500": (d: Design) => void (config(d, "api-1").queueLimit = 500),
  "db-fast": (d: Design) => void (config(d, "sql-1").readMs = 1),
  "db-slots-40": (d: Design) => void (config(d, "sql-1").concurrency = 40),
  "health-checks": (d: Design) => void (config(d, "load-balancer-1").healthChecks = true),
  "no-retries": (d: Design) => void (config(d, "client-1").retries = 0),
  "backoff-300": (d: Design) => void (config(d, "client-1").backoffMs = 300),
  "api-64": (d: Design) => void (config(d, "api-1").concurrency = 64),
  "no-cache": (d: Design) => {
    d.nodes = d.nodes.filter((x) => x.id !== "cache-1");
    d.edges = d.edges.filter((e) => e.from !== "cache-1" && e.to !== "cache-1");
  },
};

/** The design a setup describes: the lesson's variant at the setup's rate, with its change. */
export function setupDesign(setup: SdSetup): Design {
  const d = findArchitectureLesson(setup.lesson)!.experiment.variants.find((v) => v.id === setup.variant)!.design();
  for (const node of d.nodes) if (node.kind === "client") (node.config as Config).rps = setup.rate;
  if (setup.change) changes[setup.change](d);
  return d;
}
const cache = new Map<string, SdRun>();
/** The real simulator, once per setup (runs are deterministic: the workload has a fixed seed). */
export function runSetup(setup: SdSetup): SdRun {
  const key = JSON.stringify(setup);
  let r = cache.get(key);
  if (!r) {
    const run = simulate(setupDesign(setup));
    r = { run, summary: summarize(run) };
    cache.set(key, r);
  }
  return r;
}

// ---- Values read from a run ----
const nodes = (r: SdRun) => r.run.design.nodes;
const label = (r: SdRun, id: string) => nodes(r).find((n) => n.id === id)?.label ?? id;
const peak = (r: SdRun, id: string) => {
  const u = r.summary.nodes[id]?.utilisation;
  return u ? Math.max(...u) : null;
};
/** Components whose slots were in use at least 85% of the time (the findings' bottleneck rule), busiest first. */
const bottlenecks = (r: SdRun) =>
  nodes(r)
    .map((n) => ({ id: n.id, kind: n.kind, label: n.label, peak: peak(r, n.id) ?? 0 }))
    .filter((n) => n.peak >= 0.85)
    .sort((a, b) => b.peak - a.peak);
const busiest = (r: SdRun) => nodes(r).map((n) => ({ id: n.id, label: n.label, peak: peak(r, n.id) })).filter((n) => n.peak !== null).sort((a, b) => b.peak! - a.peak!)[0];
const failed = (r: SdRun) => r.summary.failed;
const perSecond = (r: SdRun) => Math.round(r.summary.ok / r.summary.durationS);
const failureWords: Record<FailCode, string> = {
  "queue-full": "refused: queue full",
  timeout: "timed out at the client",
  down: "sent to a failed server",
  crashed: "lost when a server failed",
  "no-healthy-target": "no healthy server",
  "no-origin": "no origin to fetch from",
};
const causes = (r: SdRun) =>
  (Object.entries(r.summary.failures) as [FailCode, number][]).filter(([, n]) => n > 0).map(([code, n]) => `${n.toLocaleString("en")} ${failureWords[code]}`).join(", ");
const n = (value: number) => value.toLocaleString("en");
/** "lower"/"same"/"higher" for failed requests: within 2 requests or 5% counts as about the same. */
const failDirection = (before: SdRun, after: SdRun) => direction(failed(before), failed(after), Math.max(2, failed(before) * 0.05));
const rate = (r: SdRun) => (nodes(r).find((x) => x.kind === "client")!.config as Config).rps as number;

/** What the run recorded, most important first. Every value comes from the run's own summary and design. */
function sdEvidence(r: SdRun): Evidence[] {
  const s = r.summary;
  const out: Evidence[] = [
    { label: "Requests that succeeded", value: `${n(s.ok)} of ${n(s.requests)} (${pct(s.successRate)})` },
    { label: "Failed requests", value: s.failed ? `${n(s.failed)} (${causes(r)})` : "None" },
    { label: "95% of successful requests within", value: `${ms(s.p95)} (half within ${ms(s.p50)})` },
  ];
  const top = busiest(r);
  if (top) out.push({ label: "Busiest component", value: `${top.label}: slots in use ${pct(top.peak!)} of the time` });
  out.push({ label: "Finished per second", value: `about ${n(perSecond(r))}, with ${n(rate(r))} arriving` });
  for (const node of nodes(r)) {
    const p = peak(r, node.id);
    const x = s.nodes[node.id];
    if (p !== null && node.id !== top?.id) out.push({ label: `${node.label}: slots in use`, value: `${pct(p)}${x.maxWaiting ? `, up to ${n(x.maxWaiting)} waiting` : ""}` });
    if (x.hitRate !== null) out.push({ label: `${node.label}: hit rate`, value: pct(x.hitRate) });
    if (node.kind === "queue" && x.published) out.push({ label: `${node.label}: most messages waiting`, value: n(x.maxDepth) });
  }
  if (s.retries) out.push({ label: "Retries", value: `${n(s.retries)} extra attempts` });
  for (const node of nodes(r)) {
    const settings = limitSettings(node);
    if (settings) out.push({ label: `${node.label}: settings used`, value: settings });
  }
  return out;
}

const readings = {
  failed: { label: "Failed requests", read: (r: SdRun) => failed(r), format: n },
  success: { label: "Succeeded", read: (r: SdRun) => r.summary.successRate, format: pct },
  p95: { label: "95% within", read: (r: SdRun) => r.summary.p95, format: ms },
  perSecond: { label: "Finished per second", read: perSecond, format: n },
  retries: { label: "Retry attempts", read: (r: SdRun) => r.summary.retries, format: n },
  db: { label: "Database slots in use", read: (r: SdRun) => peak(r, "sql-1"), format: pct },
  hit: { label: "Cache hit rate", read: (r: SdRun) => r.summary.nodes["cache-1"]?.hitRate ?? null, format: pct },
  depth: { label: "Most orders waiting in the queue", read: (r: SdRun) => r.summary.nodes["queue-1"]?.maxDepth ?? null, format: n },
  processed: { label: "95% of orders stored within", read: (r: SdRun) => ackP95(r), format: ms },
} satisfies Record<string, Reading<SdRun>>;
/** Orders per second the workers can finish from their settings: slots × 1000 ÷ milliseconds per message. */
const workerCapacity = (r: SdRun) => nodes(r).filter((x) => x.kind === "worker").reduce((sum, x) => sum + ((x.config as Config).concurrency as number) * 1000 / ((x.config as Config).serviceMs as number), 0);
const ackP95 = (r: SdRun) => {
  const values = nodes(r).filter((x) => x.kind === "worker").map((x) => r.summary.nodes[x.id].ackP95).filter((v): v is number => v !== null);
  return values.length ? Math.max(...values) : null;
};

/** The settings a learner starts from, read from the setup's design (never from a run of it). */
function settingsOf(setup: SdSetup): Evidence[] {
  const d = setupDesign(setup);
  return [
    { label: "Traffic", value: `${n(setup.rate)} requests per second` },
    ...d.nodes.filter((x) => x.kind !== "client").map((x) => ({ label: x.label, value: limitSettings(x) || (x.kind === "load-balancer" ? `health checks ${(x.config as Config).healthChecks ? "on" : "off"}` : x.kind === "cache" ? `holds ${n((x.config as Config).capacityKeys as number)} items` : "no slot limit") })),
    ...(d.faults.length ? [{ label: "Failure", value: d.faults.map((f) => `${d.nodes.find((x) => x.id === f.node)!.label} down from ${f.fromS} s to ${f.toS} s`).join("; ") }] : []),
    ...d.nodes.filter((x) => x.kind === "client" && (x.config as Config).retries).map((x) => ({ label: "Client retries", value: `up to ${(x.config as Config).retries}, ${(x.config as Config).backoffMs} ms apart` })),
  ];
}

/** Shared reasons for "change one thing" trials judged by failed requests. */
const capacityReasons = [
  { id: "added-capacity", text: "It gave the bottleneck more capacity than the arrival rate, so requests stopped piling up." },
  { id: "near-capacity", text: "It raised capacity to about the arrival rate: almost every request succeeds, but the busiest slots are still nearly always in use, so a few bursts are refused." },
  { id: "small-gain", text: "It raised capacity a little, but the bottleneck still finishes fewer requests per second than arrive." },
  { id: "queue-wait", text: "It let more requests wait instead of adding capacity, so they waited longer than clients would and timed out.", miss: "A queue holds requests; it finishes none of them faster. Compare “Finished per second” before and after." },
  { id: "no-effect", text: "It changed a component that wasn't limiting, so nothing measurable changed.", miss: "Check the busiest component's slots in use: the change has to reach the component near 100%." },
];
function capacityReason(r: SdRun, b: SdRun | null) {
  const before = b!;
  if (failed(r) === 0 && failed(before) > 0) return "added-capacity";
  if (r.summary.timeouts > before.summary.timeouts) return "queue-wait";
  if (failDirection(before, r) === "lower") return failed(r) / Math.max(1, r.summary.requests) < 0.01 ? "near-capacity" : "small-gain";
  return "no-effect";
}
/** `how`: the mechanism of this particular change, in one sentence. */
const capacityExplain = (how = "") => (r: SdRun, b: SdRun | null) => {
  const before = b!;
  const top = bottlenecks(before)[0];
  const after = top ? peak(r, top.id) : null;
  return `Failed requests went from ${n(failed(before))} to ${n(failed(r))}${failed(r) ? ` (${causes(r)})` : ""}, and about ${n(perSecond(before))} → ${n(perSecond(r))} requests per second succeeded with ${n(rate(r))} arriving.${top && after !== null ? ` ${top.label}'s slots were in use ${pct(top.peak)} before and ${pct(after)} after.` : ""}${how ? ` ${how}` : ""} ${
    {
      "added-capacity": "Once the busiest component can finish more per second than arrive, waiting stays short and nothing is refused.",
      "near-capacity": "Capacity now roughly matches the arrival rate. Random arrivals still come in bursts, so the slots stay nearly always busy and a burst can still fill the queue.",
      "small-gain": "It wasn't enough: the busiest component still finishes fewer requests per second than arrive, so its queue still fills.",
      "queue-wait": `The slots were already busy almost all the time, so a longer queue finishes no more requests: they wait instead of being refused. Waiting grew past the clients' ${ms(config(r.run.design, "client-1").timeoutMs as number)} timeout, so clients gave up on ${n(r.summary.timeouts)} requests${r.summary.late ? `, and the server still finished ${n(r.summary.late)} answers nobody was waiting for` : ""}: slots spent on abandoned work, so fewer requests succeeded than before.`,
      "no-effect": "Speeding up or enlarging a component that already has spare slots doesn't change what the busiest one can finish.",
    }[capacityReason(r, before)]
  }`;
};

const floor = (setup: SdSetup) => runSetup({ ...setup, rate: 20, change: undefined }).summary.p95 ?? 0;

const capacity: Cycle<SdSetup, SdRun> = {
  id: "sd-capacity",
  version: 1,
  subject: "system-design",
  unit: "fundamentals",
  title: "Traffic grows, capacity doesn't",
  concept: "Capacity is slots × 1000 ÷ milliseconds each request holds a slot.",
  scenario: "Your API server has 4 processing slots and does 20 ms of work per request, and a request keeps its slot while it waits for the database. A newsletter goes out and traffic jumps from 20 to 200 requests per second. Nothing else changes.",
  question: "What happens when requests arrive faster than the API server can finish them?",
  watch: "How busy the API server's slots are, how many requests wait, and how many fail and why.",
  terms: ["slot", "rps", "throughput", "latency", "queue"],
  limits: "Network hops take fixed times and servers don't slow down under memory or CPU pressure. Real overload often also shows as rising error rates from dependencies and garbage-collection pauses.",
  hint: "Compare the arrival rate with what the busiest component finishes per second, then look at its slots in use and why requests failed.",
  start: (setup) => [
    ...settingsOf(setup),
    ...(setup.change ? [] : [{ label: "Measured at 20 req/s", value: `${pct(runSetup({ ...setup, rate: 20 }).summary.successRate)} succeeded, 95% within ${ms(floor(setup))}` }]),
  ],
  base: {
    id: "base",
    label: "200 requests per second",
    setup: { lesson: "fundamentals", variant: "base", rate: 200 },
    question: "Traffic rises from 20 to 200 requests per second. What will users see?",
    choices: [
      { id: "keeps-up", text: "About the same as before: the server keeps up and answers stay fast.", miss: "Estimate the capacity: 4 slots, each held for the 20 ms of work plus the database call, finish well under 200 per second." },
      { id: "slower", text: "Slower answers, but every request still succeeds.", miss: "Waiting grows only until the queue is full. After that the server refuses new requests, and those fail." },
      { id: "fails", text: "Slower answers, and some requests fail." },
    ],
    outcome: (r) => (failed(r) > 0 ? "fails" : (r.summary.p95 ?? 0) > floor(capacity.base.setup) * 1.3 ? "slower" : "keeps-up"),
    reasons: [
      { id: "api", text: "The API server's slots were busy almost all the time: requests arrived faster than it could finish them." },
      { id: "db", text: "The database ran out of capacity.", miss: "Look at the database's slots in use: a component far below 100% has spare capacity." },
      { id: "network", text: "The network got slower with more traffic.", miss: "In this simulator every network hop takes a fixed time (40 ms across the Internet, 1 ms inside the data centre); only waiting for slots grows." },
      { id: "headroom", text: "No component was near its limit, so nothing had to wait." },
    ],
    reason: (r) => {
      const top = bottlenecks(r)[0];
      return !top ? "headroom" : top.kind === "api" ? "api" : top.kind === "sql" ? "db" : "headroom";
    },
    explain: (r) => {
      const api = config(r.run.design, "api-1");
      const x = r.summary.nodes["api-1"];
      const refused = x.rejected["queue-full"] ?? 0;
      return `${label(r, "api-1")} has ${api.concurrency} slots and ${api.serviceMs} ms of work per request; with the database call each request holds a slot a little longer, so it finished about ${n(perSecond(r))} requests per second while ${n(rate(r))} arrived. Its slots were in use ${pct(peak(r, "api-1")!)} of the time and up to ${n(x.maxWaiting)} requests waited for one.${refused ? ` Once its queue of ${api.queueLimit} was full it refused ${n(refused)} requests: backpressure that protects the server, at the cost of errors.` : ""} Successful requests took ${ms(r.summary.p95)} at the 95th percentile against ${ms(floor(capacity.base.setup))} at 20 per second: the extra time is waiting, not work.`;
    },
  },
  variations: [
    {
      id: "slots-8",
      label: "Double the slots",
      change: "The API server gets 8 slots instead of 4. Traffic stays at 200 per second.",
      setup: { lesson: "fundamentals", variant: "base", rate: 200, change: "slots-8" },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail"),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain("Twice the slots can finish about twice as many requests per second: more than the 200 arriving."),
    },
    {
      id: "queue-500",
      label: "A longer queue",
      change: "The API server's waiting queue holds 500 requests instead of 50. Slots and traffic stay the same.",
      setup: { lesson: "fundamentals", variant: "base", rate: 200, change: "queue-500" },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail", { lower: "A queue lets requests wait; it doesn't finish them any faster. Waiting past the client's timeout is still a failure." }),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain(),
    },
    {
      id: "db-fast",
      label: "A faster database",
      change: "Database reads take 1 ms instead of 5 ms. The API server is unchanged.",
      setup: { lesson: "fundamentals", variant: "base", rate: 200, change: "db-fast" },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail"),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain("The database was never the bottleneck, but an API request keeps its slot while it waits for the database, so faster reads free each API slot a few milliseconds sooner."),
    },
  ],
  run: (setup) => runSetup(setup),
  evidence: (r) => sdEvidence(r),
  readings: [readings.failed, readings.success, readings.p95, readings.perSecond],
};

const hitRate = (r: SdRun) => r.summary.nodes["cache-1"]?.hitRate ?? 0;
const cacheReasons = [
  { id: "more-hits", text: "The cache answered a larger share of reads, so fewer reached the database." },
  { id: "same-hits", text: "The cache answered about the same share of reads, so the database saw about the same load." },
  { id: "fewer-hits", text: "A smaller share of reads (or none) was answered by a cache, so more reached the database." },
  { id: "faster-db", text: "The database itself became faster.", miss: "None of these changes touch the database's settings: only how many reads reach it." },
];
const cacheReason = (r: SdRun, b: SdRun | null) => ({ lower: "fewer-hits", same: "same-hits", higher: "more-hits" })[direction(hitRate(b!), hitRate(r), 0.05)];
const dbDirection = (r: SdRun, b: SdRun | null) => direction(peak(b!, "sql-1"), peak(r, "sql-1"), 0.05);
const cacheExplain = (r: SdRun, b: SdRun | null) => {
  const cached = !!r.summary.nodes["cache-1"];
  return `The cache answered ${pct(hitRate(b!))} of lookups in the first run and ${cached ? pct(hitRate(r)) : "none (there is no cache)"} with the change, so the database's slots went from ${pct(peak(b!, "sql-1")!)} to ${pct(peak(r, "sql-1")!)} in use. ${
    !cached
      ? "Without a cache, every read reaches the database: the cache had been absorbing a share of the load."
      : r.run.design.workload.skew === "popular"
        ? "When a few items get most requests, a cache holding them answers most reads: popularity matters as much as size."
        : "When every item is equally likely, the hit rate is capped near the share of items the cache can hold."
  }`;
};
const cacheVariation = (id: string, labelText: string, change: string, variant: string, key?: keyof typeof changes) => ({
  id,
  label: labelText,
  change,
  setup: { lesson: "storage-caching", variant, rate: 300, change: key },
  question: "Compared with the first run, how busy will the database be?",
  choices: compareChoices("Less busy", "About as busy", "Busier"),
  outcome: dbDirection,
  reasons: cacheReasons,
  reason: cacheReason,
  explain: cacheExplain,
});

const caching: Cycle<SdSetup, SdRun> = {
  id: "sd-cache-hit-rate",
  version: 1,
  subject: "system-design",
  unit: "storage-caching",
  title: "How often does the cache answer?",
  concept: "A cache answers a read only if it already holds that item.",
  scenario: "An API reads from 1,000 items through a cache that holds 500 of them, at 300 requests per second (5% writes). Here every item is equally likely to be requested, and the cache starts empty.",
  question: "What share of lookups will the cache answer, and what decides it?",
  watch: "The cache's hit rate, and how busy the database is.",
  terms: ["latency", "slot"],
  limits: "The simulator tracks which items are cached, not their contents, so it can't show stale data. Real hit rates also depend on access patterns that change over time.",
  hint: "Ask what share of the requested items the cache can hold, and whether some items are requested far more often than others.",
  start: (setup) => [...settingsOf(setup), { label: "Items requested", value: `${n(setupDesign(setup).workload.keys)}, ${setupDesign(setup).workload.skew === "popular" ? "a few popular items get most requests" : "every item equally likely"}` }],
  base: {
    id: "base",
    label: "Cache of 500, every item equally likely",
    setup: { lesson: "storage-caching", variant: "uniform", rate: 300 },
    question: "What share of lookups will the cache answer?",
    choices: [
      { id: "low", text: "Under 30%" },
      { id: "half", text: "Between 30% and 60%" },
      { id: "most", text: "Between 60% and 90%", miss: "Holding half the items can't answer more than about half the reads when every item is equally likely." },
      { id: "all", text: "Over 90%", miss: "A cache answers only items it already holds: it starts empty and holds half the items here." },
    ],
    outcome: (r) => (hitRate(r) < 0.3 ? "low" : hitRate(r) < 0.6 ? "half" : hitRate(r) < 0.9 ? "most" : "all"),
    reasons: [
      { id: "share", text: "With every item equally likely, the hit rate is capped near the share of items the cache holds; the empty start and writes push it lower." },
      { id: "popular", text: "A few popular items get most reads, so even a small cache answers most of them." },
      { id: "db-slow", text: "The database was too slow to fill the cache.", miss: "Every miss fills the cache, however long the database takes; speed doesn't decide what's cached." },
    ],
    reason: (r) => (r.run.design.workload.skew === "uniform" ? "share" : hitRate(r) >= 0.6 ? "popular" : "share"),
    explain: (r) =>
      `The cache holds ${n(config(r.run.design, "cache-1").capacityKeys as number)} of ${n(r.run.design.workload.keys)} items and answered ${pct(hitRate(r))} of lookups. With every item equally likely, at most about half the reads can find their item in a cache holding half the items, and fewer early on: it starts empty, so each item's first read misses, and every write removes the item. The database's slots were in use ${pct(peak(r, "sql-1")!)} of the time.`,
  },
  variations: [
    cacheVariation("popular-50", "Popular items, a 50-item cache", "A few items get most requests, and the cache holds only 50 items.", "small"),
    cacheVariation("popular-500", "Popular items, the same 500-item cache", "A few items get most requests; the cache still holds 500.", "large"),
    cacheVariation("no-cache", "No cache", "The cache is removed: every read goes to the database. Items are still equally likely.", "uniform", "no-cache"),
  ],
  run: (setup) => runSetup(setup),
  evidence: (r) => sdEvidence(r),
  readings: [readings.hit, readings.db, readings.p95],
};

const scaleChoices = [
  { id: "api", text: "The API server" },
  { id: "db", text: "The database", miss: "The database's 20 slots at about 5 ms per read can finish far more than 500 reads a second." },
  { id: "none", text: "Nothing: every component has spare capacity" },
];
const scaling: Cycle<SdSetup, SdRun> = {
  id: "sd-bottleneck",
  version: 1,
  subject: "system-design",
  unit: "scalability",
  title: "Find the bottleneck, then fix the right thing",
  concept: "The bottleneck is the component whose slots are nearly always busy; only adding capacity there helps.",
  scenario: "One API server (8 slots, 25 ms of work per request) in front of a database with 20 slots receives 500 requests per second.",
  question: "Which component limits the system, and which change actually helps?",
  watch: "Slots in use for each component, and where requests are refused.",
  terms: ["slot", "lb", "throughput", "rps"],
  limits: "Servers here are identical and never slow down unequally, and adding a server is instant: real scaling takes time and real load balancers see uneven servers.",
  hint: "The bottleneck is the component whose slots are in use close to 100% of the time; changes elsewhere can't raise what it finishes.",
  start: settingsOf,
  base: {
    id: "base",
    label: "One API server at 500 per second",
    setup: { lesson: "scalability", variant: "apis-1", rate: 500 },
    question: "Which component will be the bottleneck?",
    choices: scaleChoices,
    outcome: (r) => {
      const top = bottlenecks(r)[0];
      return !top ? "none" : top.kind === "sql" ? "db" : "api";
    },
    reasons: [
      { id: "api-cap", text: "One server's 8 slots, each held for its 25 ms of work plus the database call, finish fewer requests per second than arrive." },
      { id: "db-cap", text: "The database's slots were full, so the API server waited on it." },
      { id: "no-lb", text: "Without a load balancer, requests can't be processed properly.", miss: "A load balancer only spreads requests over servers; with one server it adds nothing." },
      { id: "headroom", text: "Every component had spare slots." },
    ],
    reason: (r) => {
      const top = bottlenecks(r)[0];
      return !top ? "headroom" : top.kind === "sql" ? "db-cap" : "api-cap";
    },
    explain: (r) =>
      `${label(r, "api-1")}'s slots were in use ${pct(peak(r, "api-1")!)} of the time and it refused ${n(r.summary.nodes["api-1"].rejected["queue-full"] ?? 0)} requests when its queue was full, while the database's slots were in use only ${pct(peak(r, "sql-1")!)}. The system finished about ${n(perSecond(r))} requests per second with ${n(rate(r))} arriving: the API server is the limit, so that is where capacity has to be added.`,
  },
  variations: [
    {
      id: "apis-2",
      label: "Two API servers behind a load balancer",
      change: "A load balancer spreads requests over two identical API servers. The database is unchanged.",
      setup: { lesson: "scalability", variant: "apis-2", rate: 500 },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail"),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain(),
    },
    {
      id: "apis-3",
      label: "Three API servers behind a load balancer",
      change: "A load balancer spreads requests over three identical API servers. The database is unchanged.",
      setup: { lesson: "scalability", variant: "apis-3", rate: 500 },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail"),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain(),
    },
    {
      id: "db-slots-40",
      label: "A bigger database",
      change: "The database gets 40 slots instead of 20. Still one API server.",
      setup: { lesson: "scalability", variant: "apis-1", rate: 500, change: "db-slots-40" },
      question: "Compared with the first run, how many requests will fail?",
      choices: compareChoices("Fewer fail", "About the same number fail", "More fail", { lower: "More database slots help only if the database is what's full. Check its slots in use in the first run." }),
      outcome: (r, b) => failDirection(b!, r),
      reasons: capacityReasons,
      reason: capacityReason,
      explain: capacityExplain(),
    },
  ],
  run: (setup) => runSetup(setup),
  evidence: (r) => sdEvidence(r),
  readings: [readings.failed, readings.perSecond, readings.p95, readings.db],
};

const failureShare = (r: SdRun) => failed(r) / Math.max(1, r.summary.requests);
const retryReasons = [
  { id: "detect", text: "Health checks took the failed server out of rotation, so fewer requests were sent to it." },
  { id: "no-retry", text: "Without retries, every request sent to the failed server failed at once instead of trying again." },
  { id: "spread", text: "Waiting between retries spread them out, so more of them arrived after the failure or at the healthy server." },
  { id: "repair", text: "The change brought the failed server back sooner.", miss: "Nothing in these changes repairs a server: health checks and retries only decide where requests go and when." },
];
const retryReason = (r: SdRun, b: SdRun | null) => {
  const lb = (x: SdRun) => config(x.run.design, "load-balancer-1").healthChecks;
  const client = (x: SdRun) => config(x.run.design, "client-1");
  if (lb(r) && !lb(b!)) return "detect";
  if (client(r).retries === 0 && client(b!).retries !== 0) return "no-retry";
  return "spread";
};
const retryExplain = (r: SdRun, b: SdRun | null) =>
  `Failed requests went from ${n(failed(b!))} to ${n(failed(r))}${failed(r) ? ` (${causes(r)})` : ""}, and retries from ${n(b!.summary.retries)} to ${n(r.summary.retries)} extra attempts. ${
    {
      detect: `With health checks every ${n(config(r.run.design, "load-balancer-1").checkIntervalMs as number)} ms, the load balancer stops choosing the failed server soon after it fails, so requests go to the healthy one: failures are limited to the detection window.`,
      "no-retry": "Retries were hiding failures: a request refused by the failed server often succeeded on its next attempt. Without them each refusal is an error the user sees, but the servers also receive fewer attempts.",
      spread: "A retry that waits gives the system time: some retries land after the server is back or on the healthy server. Retrying instantly concentrates extra load at the worst moment.",
      repair: "",
    }[retryReason(r, b)]
  }`;
const retryVariation = (id: string, labelText: string, change: string, key: keyof typeof changes) => ({
  id,
  label: labelText,
  change,
  setup: { lesson: "reliability-security", variant: "no-checks", rate: 150, change: key },
  question: "Compared with the first run, how many requests will fail?",
  choices: compareChoices("Fewer fail", "About the same number fail", "More fail"),
  outcome: (r: SdRun, b: SdRun | null) => failDirection(b!, r),
  reasons: retryReasons,
  reason: retryReason,
  explain: retryExplain,
});

const failures: Cycle<SdSetup, SdRun> = {
  id: "sd-failover",
  version: 1,
  subject: "system-design",
  unit: "reliability-security",
  title: "A server fails: what do users see?",
  concept: "Redundancy helps only if requests stop going to the failed part.",
  scenario: "Two API servers sit behind a load balancer without health checks. API server 1 fails from 2 s to 5 s. Clients retry a failed request up to 3 times, immediately.",
  question: "How much of the outage reaches users, and what do retries and health checks change?",
  watch: "Failed requests and why, retry attempts, and which server received requests during the failure.",
  terms: ["lb", "retry", "slot"],
  limits: "A failed server here refuses connections at once; real failures can also be slow, partial or intermittent, which makes detection harder.",
  hint: "Count where requests went during the failure: to the failed server (refused), to the healthy one, or tried again.",
  start: settingsOf,
  base: {
    id: "base",
    label: "No health checks, instant retries",
    setup: { lesson: "reliability-security", variant: "no-checks", rate: 150 },
    question: "What share of all requests will fail?",
    choices: [
      { id: "none", text: "None: retries cover the whole outage" },
      { id: "some", text: "A few: under 5% of requests" },
      { id: "many", text: "Many: 5% or more", miss: "Each retry is another chance to be sent to the healthy server, so most refused requests succeed on a later attempt." },
    ],
    outcome: (r) => (failed(r) === 0 ? "none" : failureShare(r) < 0.05 ? "some" : "many"),
    reasons: [
      { id: "retries-hide", text: "The load balancer kept sending requests to the failed server, and retries sent most of them again, often to the healthy server." },
      { id: "lb-detects", text: "The load balancer noticed the failure and stopped using the server.", miss: "Without health checks the load balancer can't notice a failed server: it keeps choosing it in turn." },
      { id: "overload", text: "The surviving server was overloaded and refused requests." },
    ],
    reason: (r) => ((r.summary.nodes["api-2"]?.rejected["queue-full"] ?? 0) > 0 ? "overload" : config(r.run.design, "load-balancer-1").healthChecks ? "lb-detects" : "retries-hide"),
    explain: (r) =>
      `${n(r.summary.nodes["api-1"].rejected.down ?? 0)} attempts reached ${label(r, "api-1")} while it was down and were refused. Clients retried, adding ${n(r.summary.retries)} attempts, and each retry was a new chance to be sent to ${label(r, "api-2")}, so only ${n(failed(r))} of ${n(r.summary.requests)} requests (${pct(failureShare(r))}) failed: those whose every attempt hit the failed server. The retries hide the outage from most users, but they are extra traffic.`,
  },
  variations: [
    retryVariation("health-checks", "Turn on health checks", "The load balancer checks each server every 2 s and stops using one that fails a check.", "health-checks"),
    retryVariation("no-retries", "Turn off retries", "Clients no longer retry: a refused request is an error at once.", "no-retries"),
    retryVariation("backoff", "Wait between retries", "Clients wait 300 ms before each retry instead of retrying at once.", "backoff-300"),
  ],
  run: (setup) => runSetup(setup),
  evidence: (r) => sdEvidence(r),
  readings: [readings.failed, readings.success, readings.retries, readings.p95],
};

const queueing: Cycle<SdSetup, SdRun> = {
  id: "sd-queue",
  version: 1,
  subject: "system-design",
  unit: "distributed",
  title: "Slow workers behind a queue",
  concept: "A queue separates accepting work from doing it.",
  scenario: "Shoppers place 100 orders per second. The Orders API puts each order on a queue and answers; one worker (8 slots, 200 ms per order) stores them in the database.",
  question: "When the worker is slower than orders arrive, who waits: the shopper or the order?",
  watch: "The shoppers' response time, the queue's depth, and how long orders take to be stored.",
  terms: ["queue", "worker", "backpressure", "latency"],
  limits: "The queue here never fills or loses messages, and the run continues until the queue drains. A real queue has limits, and a backlog that never drains needs more workers or backpressure.",
  hint: "Separate the two times: how long the API takes to answer, and how long an order waits in the queue before a worker stores it.",
  start: (setup) => [...settingsOf(setup), { label: "Worker capacity", value: "about 40 orders per second per worker (8 slots × 1000 ÷ 200 ms)" }],
  base: {
    id: "base",
    label: "One worker, 100 orders per second",
    setup: { lesson: "distributed", variant: "workers-1", rate: 100 },
    question: "How will the shoppers' response time change as orders pile up?",
    choices: [
      { id: "fast", text: "It stays fast: the API answers as soon as the order is queued." },
      { id: "slow", text: "It grows: shoppers wait for the worker to store their order.", miss: "With a queue between them, the API doesn't wait for the worker: it answers once the order is queued." },
      { id: "fail", text: "Orders are refused because the worker is too slow.", miss: "This queue accepts every order; it's the backlog, not the shopper, that grows." },
    ],
    outcome: (r) => (failed(r) > 0 ? "fail" : (r.summary.p95 ?? 0) > 150 ? "slow" : "fast"),
    reasons: [
      { id: "decoupled", text: "The API only puts the order on the queue and answers; orders wait in the queue until the worker can store them." },
      { id: "worker-fast", text: "The worker kept up with the orders.", miss: "One worker finishes about 40 orders per second; 100 arrive. Check how many orders waited in the queue." },
      { id: "dropped", text: "The queue dropped the orders it couldn't hold." },
    ],
    reason: (r) => ((r.summary.nodes["queue-1"].maxDepth ?? 0) > 20 ? "decoupled" : failed(r) > 0 ? "dropped" : "worker-fast"),
    explain: (r) =>
      `Shoppers got their answer within ${ms(r.summary.p95)} (95%), because the API's only work is to queue the order. The worker's slots were in use ${pct(peak(r, "worker-1")!)} of the time, up to ${n(r.summary.nodes["queue-1"].maxDepth)} orders waited in the queue, and 95% of orders were stored within ${ms(ackP95(r))} of being queued. The slowness moved from the shopper to the order: processing time is the queue's wait plus the work.`,
  },
  variations: [
    {
      id: "workers-3",
      label: "Three workers",
      change: "Three identical workers read from the queue instead of one.",
      setup: { lesson: "distributed", variant: "workers-3", rate: 100 },
      question: "Compared with the first run, how many orders will wait in the queue at most?",
      choices: compareChoices("Fewer", "About as many", "More"),
      outcome: (r, b) => direction(b!.summary.nodes["queue-1"].maxDepth, r.summary.nodes["queue-1"].maxDepth, Math.max(2, b!.summary.nodes["queue-1"].maxDepth * 0.05)),
      reasons: [
        { id: "workers-keep-up", text: "Together the workers can finish more orders per second than arrive, so the backlog stays small." },
        { id: "api-faster", text: "The API answers faster, so fewer orders reach the queue.", miss: "Every order reaches the queue either way; the API's speed doesn't change how many arrive." },
        { id: "same", text: "Adding workers doesn't change the backlog." },
      ],
      reason: (r, b) => (r.summary.nodes["queue-1"].maxDepth < b!.summary.nodes["queue-1"].maxDepth ? "workers-keep-up" : "same"),
      explain: (r, b) =>
        `The most orders waiting went from ${n(b!.summary.nodes["queue-1"].maxDepth)} to ${n(r.summary.nodes["queue-1"].maxDepth)}, and 95% of orders were stored within ${ms(ackP95(b!))} → ${ms(ackP95(r))}. Together the workers can finish about ${n(workerCapacity(r))} orders per second against ${n(rate(r))} arriving, so the queue only absorbs bursts. Shoppers' answers stayed at ${ms(b!.summary.p95)} → ${ms(r.summary.p95)}: they never waited for the workers.`,
    },
    {
      id: "api-64",
      label: "A bigger Orders API",
      change: "The Orders API gets 64 slots instead of 32. Still one worker.",
      setup: { lesson: "distributed", variant: "workers-1", rate: 100, change: "api-64" },
      question: "Compared with the first run, how many orders will wait in the queue at most?",
      choices: compareChoices("Fewer", "About as many", "More", { lower: "The backlog builds behind the worker. The API was nearly idle: more API slots don't store orders faster." }),
      outcome: (r, b) => direction(b!.summary.nodes["queue-1"].maxDepth, r.summary.nodes["queue-1"].maxDepth, Math.max(2, b!.summary.nodes["queue-1"].maxDepth * 0.05)),
      reasons: [
        { id: "not-the-limit", text: "The API wasn't the limit: the worker is, so the backlog is unchanged." },
        { id: "api-faster", text: "The API answers faster, so fewer orders reach the queue.", miss: "Every order reaches the queue either way; the API's speed doesn't change how many arrive." },
        { id: "workers-keep-up", text: "The worker now keeps up with the orders." },
      ],
      reason: (r, b) => (direction(b!.summary.nodes["queue-1"].maxDepth, r.summary.nodes["queue-1"].maxDepth, Math.max(2, b!.summary.nodes["queue-1"].maxDepth * 0.05)) === "same" ? "not-the-limit" : "workers-keep-up"),
      explain: (r, b) =>
        `The most orders waiting went from ${n(b!.summary.nodes["queue-1"].maxDepth)} to ${n(r.summary.nodes["queue-1"].maxDepth)}. The API's slots were in use only ${pct(peak(b!, "api-1")!)} before; the worker's ${pct(peak(b!, "worker-1")!)}. Adding capacity where there's spare doesn't move the bottleneck.`,
    },
  ],
  run: (setup) => runSetup(setup),
  evidence: (r) => sdEvidence(r),
  readings: [readings.depth, readings.processed, readings.p95],
};

export const sdCycles = [capacity, caching, scaling, queueing, failures];
/** The guided experiment for a System Design lesson, if it has one. */
export const cycleForLesson = (lessonId: string) => sdCycles.find((c) => c.unit === lessonId);
