// Lab: a popular cached value expires and every request that misses queries the database at once (a stampede);
// many keys cached together expire together. Request coalescing, serving stale while one request refreshes, and
// jittered expiry spread or remove that load.
// Modelled: four app servers sharing one cache; a database with 20 connections that answers each query in 300 ms
// (more wait in line); requests arriving evenly; users who give up after 1 s. Keys are warmed at start with the
// configured TTL (plus jitter from the seed). Ten-millisecond steps.
import { prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { coalesce: "none" | "server" | "global"; refresh: "on-miss" | "stale" | "ahead"; ttlS: number; jitterPercent: number };

const STEP = 10;
const BUCKET = 250;
const SERVERS = 4;
const DB_CONNECTIONS = 20;
const QUERY_MS = 300;
const GIVE_UP = 1000;
const DURATION = 24_000;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const events: LabEvent[] = [];
  const ttl = c.ttlS * 1000;
  const ttlFor = () => Math.round(ttl * (1 - (c.jitterPercent / 100) * random()));
  type Entry = { expiresAt: number; filledAt: number };
  const cache = new Map<number, Entry>();
  for (let k = 0; k < p.keys; k++) cache.set(k, { expiresAt: ttlFor(), filledAt: 0 });
  // In-flight refreshes: by key (global) or by server and key.
  const inflight = new Map<string, { waiters: { arrived: number }[] }>();
  const dbRunning: { done: number; key: number; flight: string }[] = [];
  const dbQueue: { key: number; flight: string }[] = [];
  const latencies: number[] = [];
  let bucket = { requests: 0, slow: 0, failed: 0, queries: 0, peakDb: 0, stale: 0, maxStale: 0 };
  let credit = 0;
  let totals = { failed: 0 };

  const scope = (server: number, key: number) => (c.coalesce === "global" ? `k${key}` : c.coalesce === "server" ? `s${server}k${key}` : `r${Math.floor(random() * 1e9)}`);
  const startQuery = (key: number, flight: string) => {
    bucket.queries++;
    if (dbRunning.length < DB_CONNECTIONS) dbRunning.push({ done: now + QUERY_MS, key, flight });
    else dbQueue.push({ key, flight });
  };
  const answer = (arrived: number) => {
    const latency = now - arrived;
    if (latency > GIVE_UP) {
      bucket.failed++;
      totals.failed++;
      return;
    }
    latencies.push(latency);
    if (latency > 200) bucket.slow++;
  };
  /** A refresh: one database query whose result fills the cache and answers everyone waiting on it. */
  const refresh = (flight: string, key: number, waiter?: number) => {
    const existing = inflight.get(flight);
    if (existing) {
      if (waiter !== undefined) existing.waiters.push({ arrived: waiter });
      return;
    }
    inflight.set(flight, { waiters: waiter === undefined ? [] : [{ arrived: waiter }] });
    startQuery(key, flight);
  };

  let now = 0;
  for (now = 0; now < DURATION + GIVE_UP; now += STEP) {
    // Finished queries fill the cache and answer their waiters; queued ones take free connections.
    for (let i = dbRunning.length - 1; i >= 0; i--) {
      const q = dbRunning[i];
      if (q.done > now) continue;
      dbRunning.splice(i, 1);
      cache.set(q.key, { expiresAt: now + ttlFor(), filledAt: now });
      for (const w of inflight.get(q.flight)?.waiters ?? []) answer(w.arrived);
      inflight.delete(q.flight);
    }
    while (dbRunning.length < DB_CONNECTIONS && dbQueue.length) {
      const q = dbQueue.shift()!;
      dbRunning.push({ done: now + QUERY_MS, ...q });
    }
    if (now < DURATION) {
      credit += (p.rate * STEP) / 1000;
      while (credit >= 1) {
        credit -= 1;
        bucket.requests++;
        const server = Math.floor(random() * SERVERS);
        const key = p.keys === 1 ? 0 : Math.floor(random() * p.keys);
        const entry = cache.get(key)!;
        const fresh = now < entry.expiresAt;
        if (fresh) {
          if (c.refresh === "ahead" && now >= entry.expiresAt - ttl * 0.2) refresh(scope(server, key), key);
          answer(now);
        } else if (c.refresh === "stale") {
          const age = now - entry.expiresAt;
          bucket.stale++;
          if (age > bucket.maxStale) bucket.maxStale = age;
          refresh(scope(server, key), key);
          answer(now);
        } else refresh(scope(server, key), key, now);
      }
    }
    const db = dbRunning.length + dbQueue.length;
    if (db > bucket.peakDb) bucket.peakDb = db;
    if ((now + STEP) % BUCKET === 0) {
      events.push({ i: 0, t: now + STEP - BUCKET, actor: "db", kind: "tick", tone: bucket.peakDb > DB_CONNECTIONS ? "bad" : "info", text: `${bucket.requests * 4} requests/s; ${bucket.queries} database queries started; up to ${bucket.peakDb} running or waiting at the database; ${bucket.failed} users gave up${bucket.stale ? `; ${bucket.stale} answered with stale data` : ""}.`, data: { ...bucket, limit: DB_CONNECTIONS } });
      bucket = { requests: 0, slow: 0, failed: 0, queries: 0, peakDb: 0, stale: 0, maxStale: 0 };
    }
  }
  latencies.sort((a, b) => a - b);
  const p99 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.99) - 1)] : 0;
  events.push({ i: 0, t: now, actor: "db", kind: "note", tone: "info", text: `p99 latency ${p99} ms over ${latencies.length.toLocaleString("en")} answered requests; ${totals.failed.toLocaleString("en")} users gave up.`, data: { p99 } });
  return events.map((e, i) => ({ ...e, i }));
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["requests", "queries", "failed", "stale", "p99"]);
  const ticks = events.filter((e) => e.kind === "tick");
  return { ...f, peakDb: Math.max(0, ...ticks.map((e) => e.data!.peakDb)), maxStaleMs: Math.max(0, ...ticks.map((e) => e.data!.maxStale)) };
}

const scenarios: LabScenario[] = [
  { id: "hot-key", title: "One hot key", description: "The home page's product list: 2,000 requests a second, all for the same cached value.", seed: 41, params: { keys: 1, rate: 2000 } },
  { id: "mass-expiry", title: "200 keys warmed together", description: "After a deploy, 200 category pages were cached at the same moment; 2,000 requests a second spread over them.", seed: 42, params: { keys: 200, rate: 2000 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:db`, scenario: s.id, requirement: `The database never has more than ${DB_CONNECTIONS} queries running or waiting`, passed: (f: Facts) => f.peakDb <= DB_CONNECTIONS, observed: (f: Facts) => `peak of ${f.peakDb.toLocaleString("en")}` },
  { id: `${s.id}:p99`, scenario: s.id, requirement: "99% of requests are answered within 200 ms, and nobody gives up", passed: (f: Facts) => f.p99 <= 200 && f.failed === 0, observed: (f: Facts) => `p99 ${f.p99} ms${f.failed ? `, ${f.failed.toLocaleString("en")} gave up` : ""}` },
  { id: `${s.id}:fresh`, scenario: s.id, requirement: "No answer is more than 1 s past its expiry", passed: (f: Facts) => f.maxStaleMs <= 1000, observed: (f: Facts) => (f.stale ? `stale by up to ${f.maxStaleMs} ms` : "never stale") },
];

export const cacheStampedeLab: Lab = {
  id: "cache-stampede",
  version: "1",
  title: "Handle a cache stampede",
  summary: "A popular cached value expires, and two thousand requests a second all ask the database for it at once. Stop the stampede without serving data that's badly out of date.",
  story: [
    "Your cache answers almost every request, so the database is sized for the few misses: 20 connections, 300 ms per query. That works until the most popular value expires.",
    "In the 300 ms it takes to fetch it again, every request for it misses too and sends its own query: hundreds at once. They queue behind 20 connections, users time out, and the cache stays empty until the pile clears. A deploy that warms many keys at the same moment sets up the same thing for all of them at once.",
  ],
  unit: "performance",
  view: { kind: "series", lines: [{ key: "peakDb", label: "Queries running or waiting at the database" }], limit: { key: "limit", label: "Database connections" } },
  controls: [
    { id: "coalesce", type: "select", label: "Request coalescing", help: "Whether requests that miss share one database query.", options: [
      { value: "none", label: "None: every miss queries the database" },
      { value: "server", label: "Per server: one query per key per app server (single-flight)" },
      { value: "global", label: "Cluster-wide: one query per key, via a lock in the cache" },
    ] },
    { id: "refresh", type: "select", label: "When a value expires", help: "What requests do around expiry.", options: [
      { value: "on-miss", label: "Wait for a fresh value (cache-aside)" },
      { value: "stale", label: "Serve the old value while one request refreshes it (stale-while-revalidate)" },
      { value: "ahead", label: "Refresh in the background during the last 20% of the TTL (refresh-ahead)" },
    ] },
    { id: "ttlS", type: "number", label: "Time to live", help: "How long a value stays fresh in the cache.", min: 1, max: 60, step: 1, unit: "s" },
    { id: "jitterPercent", type: "number", label: "TTL jitter", help: "Shorten each TTL by a random amount up to this share, so keys cached together don't expire together.", min: 0, max: 50, step: 5, unit: "%" },
  ],
  starter: { coalesce: "none", refresh: "on-miss", ttlS: 10, jitterPercent: 0 },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "peakDb", label: "Peak at the database" },
    { key: "queries", label: "Database queries" },
    { key: "p99", label: "p99 latency (ms)" },
    { key: "failed", label: "Users who gave up", bad: "above-zero" },
    { key: "maxStaleMs", label: "Most stale answer (ms)" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "queries",
    answer: "peakDb",
    variants: [
      { id: "none", question: "2,000 requests a second for one key; it expires; a database query takes 300 ms. Without coalescing, how many queries are running or waiting at the database at the peak?", scenario: scenarios[0] },
      { id: "server", question: "Now each of the 4 app servers coalesces misses into one query per key. How many queries are running or waiting at the database at the peak?", scenario: scenarios[0], config: { coalesce: "server" } },
    ],
  },
  questions: [
    {
      id: "swr",
      prompt: "Stale-while-revalidate removes the wait. What does it cost?",
      options: [
        { text: "Users briefly see the previous value after it has expired: acceptable for a product list, not for a bank balance.", correct: true, why: "Right. It trades a bounded amount of staleness for no waiting and no stampede." },
        { text: "It doubles database load.", why: "With coalescing, one refresh per key per expiry, as before." },
        { text: "Nothing: the data is always fresh.", why: "The answer during the refresh is, by definition, past its TTL." },
      ],
    },
    {
      id: "jitter",
      prompt: "Coalescing fixed the hot key but not 200 keys warmed together. What did TTL jitter change?",
      options: [
        { text: "Each key expires once instead of many times.", why: "Each key still expires; the point is when." },
        { text: "Keys expire at different moments, so their refresh queries are spread out instead of arriving together.", correct: true, why: "Right. Synchronised expiry is a stampede across keys; jitter de-synchronises it." },
        { text: "It makes the cache bigger.", why: "Size is unchanged." },
      ],
    },
    {
      id: "per-server",
      prompt: "Why can per-server coalescing still overload the database when there are many servers?",
      options: [
        { text: "Each server sends its own query for the same key, so the database gets one per server per key: 50 servers, 50 queries for one expiry.", correct: true, why: "Right. Cluster-wide coalescing (a lock or lease in the cache) gets it down to one." },
        { text: "Servers don't share the cache.", why: "They do; they don't share their in-flight queries." },
        { text: "It doesn't: per-server coalescing always sends one query.", why: "One per server, not one in total." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.peakDb > DB_CONNECTIONS) parts.push(`At the peak, ${f.peakDb.toLocaleString("en")} queries were running or waiting for ${DB_CONNECTIONS} connections${c.coalesce === "none" ? ": every request that missed sent its own" : c.jitterPercent === 0 ? ": keys cached together expired together" : ""}.`);
    if (f.failed) parts.push(`${f.failed.toLocaleString("en")} users gave up waiting.`);
    else if (f.p99 > 200) parts.push(`1% of requests took ${f.p99} ms or more: they waited for a refresh.`);
    if (f.maxStaleMs > 1000) parts.push(`Some answers were ${f.maxStaleMs.toLocaleString("en")} ms past expiry: the refresh took that long to arrive.`);
    if (!parts.length) parts.push(`The database never saw more than ${f.peakDb} queries at once (${f.queries.toLocaleString("en")} in total), p99 was ${f.p99} ms, and stale answers were at most ${f.maxStaleMs} ms past expiry.`);
    return parts.join(" ");
  },
  hints: [
    "In the 300 ms a refresh takes, how many requests for the same key arrive, and what does each do?",
    "Let the requests that miss share one query. Is “one per server” enough?",
    "Waiting for a refresh shows up in p99. Could requests keep using the old value for a moment? And do 200 keys need to expire in the same second?",
  ],
  assumptions: [
    "Four app servers share one cache. Requests arrive evenly; each picks a server, and in the 200-key scenario a key, at random from a fixed seed.",
    "The database has 20 connections and answers any query in 300 ms; more queries wait in line. A user gives up after 1 s.",
    "Cluster-wide coalescing is modelled as instant (a lock in the cache); refresh-ahead starts a background refresh when a request sees a value in the last 20% of its TTL.",
    "Every key is cached at the start; jitter shortens each TTL by a random share up to the setting.",
  ],
  notModelled: [
    "The cache failing or evicting values, and the lock in the cache failing (real systems give that lock its own short lease).",
    "Database slow-down under load (here a query takes 300 ms however busy it is).",
    "Writes and invalidation: values here only expire.",
  ],
};
