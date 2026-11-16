// Lab: one client's flood, or simply more users than the server can take, makes everyone wait until they give up.
// Per-client rate limits stop a single client from taking the capacity; load shedding keeps the queue short when
// the total is too much, so the requests that are accepted are answered in time.
// Modelled: one server that finishes 400 requests a second in arrival order; normal users whose page loads send 12
// requests at once; per-client limiters (fixed window, sliding window log, token bucket); optional shedding by
// expected wait. Users give up after 1 s in the queue. Ten-millisecond steps; burst times come from the seed.
import { prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { limiter: "none" | "fixed" | "sliding" | "token"; rate: number; burst: number; shedMs: number };

const STEP = 10;
const BUCKET = 250;
const CAPACITY = 400;
const GIVE_UP = 1000;
const DURATION = 10_000;
const PAGE = 12;
const PAGE_EVERY = 2400;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const events: LabEvent[] = [];
  type Req = { client: string; kind: "user" | "scraper" | "partner"; at: number };
  // Arrivals by step.
  const arrivals = new Map<number, Req[]>();
  const add = (t: number, r: Omit<Req, "at">, n = 1) => {
    const step = Math.floor(t / STEP) * STEP;
    if (step < 0 || step >= DURATION) return;
    const list = arrivals.get(step) ?? [];
    for (let i = 0; i < n; i++) list.push({ ...r, at: step });
    arrivals.set(step, list);
  };
  for (let u = 0; u < p.users; u++) {
    const offset = Math.floor(random() * PAGE_EVERY);
    for (let t = offset; t < DURATION; t += PAGE_EVERY + Math.floor((random() - 0.5) * 400)) add(t, { client: `user-${u}`, kind: "user" }, PAGE);
  }
  if (p.scraperRate) for (let t = p.scraperFrom; t < p.scraperTo; t += STEP) add(t, { client: "scraper", kind: "scraper" }, (p.scraperRate * STEP) / 1000);
  if (p.partnerBurst) for (let s = 1000; s < DURATION; s += 1000) {
    add(s - STEP, { client: "partner", kind: "partner" }, p.partnerBurst);
    add(s, { client: "partner", kind: "partner" }, p.partnerBurst);
  }

  // Limiters, per client.
  const windows = new Map<string, { window: number; count: number }>();
  const logs = new Map<string, number[]>();
  const buckets = new Map<string, { tokens: number; at: number }>();
  const allow = (client: string, t: number) => {
    if (c.limiter === "none") return true;
    if (c.limiter === "fixed") {
      const w = Math.floor(t / 1000);
      const s = windows.get(client);
      const state = s && s.window === w ? s : { window: w, count: 0 };
      windows.set(client, state);
      if (state.count >= c.rate) return false;
      state.count++;
      return true;
    }
    if (c.limiter === "sliding") {
      const log = logs.get(client) ?? [];
      while (log.length && log[0] <= t - 1000) log.shift();
      logs.set(client, log);
      if (log.length >= c.rate) return false;
      log.push(t);
      return true;
    }
    const b = buckets.get(client) ?? { tokens: c.burst, at: t };
    b.tokens = Math.min(c.burst, b.tokens + ((t - b.at) * c.rate) / 1000);
    b.at = t;
    buckets.set(client, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };

  const queue: Req[] = [];
  let head = 0;
  let credit = 0;
  const latencies: number[] = [];
  const partnerAccepted: number[] = [];
  let bucket = { userRequests: 0, userOk: 0, userLimited: 0, userShed: 0, userGaveUp: 0, scraperSent: 0, scraperServed: 0, partnerSent: 0, partnerServed: 0, served: 0, depth: 0 };
  for (let t = 0; t < DURATION + GIVE_UP; t += STEP) {
    for (const r of arrivals.get(t) ?? []) {
      if (r.kind === "user") bucket.userRequests++;
      if (r.kind === "scraper") bucket.scraperSent++;
      if (r.kind === "partner") bucket.partnerSent++;
      if (!allow(r.client, t)) {
        if (r.kind === "user") bucket.userLimited++;
        continue;
      }
      const waitMs = ((queue.length - head) / CAPACITY) * 1000;
      if (waitMs > c.shedMs) {
        if (r.kind === "user") bucket.userShed++;
        continue;
      }
      if (r.kind === "partner") partnerAccepted.push(t);
      queue.push(r);
    }
    // Users who have waited too long leave the queue.
    for (let i = head; i < queue.length; i++) {
      const r = queue[i];
      if (r.kind === "user" && t - r.at >= GIVE_UP && r.at >= 0) {
        bucket.userGaveUp++;
        r.at = -1;
      }
    }
    credit += (CAPACITY * STEP) / 1000;
    while (credit >= 1 && head < queue.length) {
      const r = queue[head++];
      if (r.at < 0) continue;
      credit -= 1;
      bucket.served++;
      if (r.kind === "user") {
        bucket.userOk++;
        latencies.push(t + STEP - r.at);
      } else if (r.kind === "scraper") bucket.scraperServed++;
      else bucket.partnerServed++;
    }
    credit = Math.min(credit, 1);
    if (head > 5000) {
      queue.splice(0, head);
      head = 0;
    }
    if ((t + STEP) % BUCKET === 0) {
      bucket.depth = queue.length - head;
      events.push({ i: 0, t: t + STEP - BUCKET, actor: "server", kind: "tick", tone: bucket.userGaveUp || bucket.userShed || bucket.userLimited ? "bad" : "info", text: `Users: ${bucket.userRequests} requests, ${bucket.userOk} answered, ${bucket.userLimited} rate-limited, ${bucket.userShed} shed, ${bucket.userGaveUp} gave up.${bucket.scraperSent ? ` Scraper: ${bucket.scraperSent} sent, ${bucket.scraperServed} served.` : ""}${bucket.partnerSent ? ` Partner: ${bucket.partnerSent} sent, ${bucket.partnerServed} served.` : ""} ${bucket.depth} waiting.`, data: { ...bucket, servedRate: bucket.served * 4, userOkRate: bucket.userOk * 4, capacity: CAPACITY, waitMs: Math.round((bucket.depth / CAPACITY) * 1000) } });
      bucket = { userRequests: 0, userOk: 0, userLimited: 0, userShed: 0, userGaveUp: 0, scraperSent: 0, scraperServed: 0, partnerSent: 0, partnerServed: 0, served: 0, depth: 0 };
    }
  }
  latencies.sort((a, b) => a - b);
  const p99 = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.99) - 1)] : 0;
  let partnerMax = 0;
  for (let i = 0, j = 0; i < partnerAccepted.length; i++) {
    while (partnerAccepted[i] - partnerAccepted[j] >= 1000) j++;
    partnerMax = Math.max(partnerMax, i - j + 1);
  }
  events.push({ i: 0, t: DURATION + GIVE_UP, actor: "server", kind: "note", tone: "info", text: `Users' p99 latency: ${p99} ms. The partner's most requests accepted in any one second: ${partnerMax}.`, data: { p99, partnerMax } });
  return events.map((e, i) => ({ ...e, i }));
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["userRequests", "userOk", "userLimited", "userShed", "userGaveUp", "scraperSent", "scraperServed", "partnerServed", "served", "p99", "partnerMax"]);
  return { ...f, userPercent: f.userRequests ? Math.floor((f.userOk / f.userRequests) * 1000) / 10 : 100, scraperPerS: Math.round(f.scraperServed / 6) };
}

const scenarios: LabScenario[] = [
  { id: "scraper", title: "A scraper", description: "40 users browse normally (about 200 requests a second, in bursts of 12 per page). From 2 s to 8 s a scraper sends 600 requests a second.", seed: 51, params: { users: 40, scraperRate: 600, scraperFrom: 2000, scraperTo: 8000 } },
  { id: "boundary", title: "A partner's bursts", description: "40 users browse normally. A partner's integration sends 40 requests in the last 10 ms of every second and 40 more in the first 10 ms of the next.", seed: 52, params: { users: 40, partnerBurst: 40 } },
  { id: "viral", title: "Gone viral", description: "120 genuine users at once (about 600 requests a second, in page-sized bursts): more than the server's 400.", seed: 53, params: { users: 120 } },
];

const checks = [
  { id: "scraper:users", scenario: "scraper", requirement: "At least 99% of users' requests are answered", passed: (f: Facts) => f.userPercent >= 99, observed: (f: Facts) => `${f.userPercent}% answered` },
  { id: "scraper:fast", scenario: "scraper", requirement: "99% of users' answers come within 300 ms", passed: (f: Facts) => f.p99 <= 300, observed: (f: Facts) => `p99 ${f.p99} ms` },
  { id: "scraper:share", scenario: "scraper", requirement: "The scraper gets at most 60 requests a second (15% of capacity)", passed: (f: Facts) => f.scraperPerS <= 60, observed: (f: Facts) => `${f.scraperPerS} per second served` },
  { id: "boundary:users", scenario: "boundary", requirement: "At least 99% of users' requests are answered", passed: (f: Facts) => f.userPercent >= 99, observed: (f: Facts) => `${f.userPercent}% answered` },
  { id: "boundary:partner", scenario: "boundary", requirement: "The partner, contracted for 30 requests a second, never gets more than 30 accepted in any one-second span", passed: (f: Facts) => f.partnerMax <= 30, observed: (f: Facts) => `up to ${f.partnerMax} in one second` },
  { id: "viral:fast", scenario: "viral", requirement: "99% of the users' answers come within 300 ms", passed: (f: Facts) => f.p99 <= 300, observed: (f: Facts) => `p99 ${f.p99} ms` },
  { id: "viral:nobody-waits-in-vain", scenario: "viral", requirement: "No user waits in the queue until they give up", passed: (f: Facts) => f.userGaveUp === 0, observed: (f: Facts) => (f.userGaveUp ? `${f.userGaveUp.toLocaleString("en")} gave up after waiting` : "none") },
  { id: "viral:busy", scenario: "viral", requirement: "The server stays busy: at least 95% of its capacity serves users", passed: (f: Facts) => f.userOk >= CAPACITY * (DURATION / 1000) * 0.95, observed: (f: Facts) => `${f.userOk.toLocaleString("en")} answered of ${CAPACITY * (DURATION / 1000)} possible` },
];

export const rateLimitLab: Lab = {
  id: "rate-limit",
  version: "1",
  title: "Protect an API from overload",
  summary: "A scraper floods your API and real users time out; a partner bursts at second boundaries; then real traffic simply exceeds capacity. Rate limits and load shedding keep the API useful for the people it's for.",
  story: [
    "Your API finishes 400 requests a second. Normal users send about 200, in bursts: each page load fires 12 requests at once. A queue in front absorbs the bursts.",
    "When one client sends 600 a second, the queue fills with its requests and everyone else waits behind them until they give up. And when genuine demand exceeds capacity, a long queue only means every user waits too long; it's better to answer some quickly and turn the rest away at once.",
  ],
  unit: "overload",
  view: { kind: "series", lines: [{ key: "userOkRate", label: "Users' requests answered per second" }, { key: "servedRate", label: "All requests served per second" }, { key: "waitMs", label: "Queue wait (ms)" }], limit: { key: "capacity", label: "Capacity" } },
  controls: [
    { id: "limiter", type: "select", label: "Per-client rate limiter", help: "How each client's requests are counted against its limit.", options: [
      { value: "none", label: "None" },
      { value: "fixed", label: "Fixed window: at most N per calendar second" },
      { value: "sliding", label: "Sliding window: at most N in any one-second span" },
      { value: "token", label: "Token bucket: N per second on average, bursts up to the bucket size" },
    ] },
    { id: "rate", type: "number", label: "Limit per client", help: "Requests per second (per window for windows; refill rate for the token bucket).", min: 1, max: 200, step: 1 },
    { id: "burst", type: "number", label: "Token bucket size", help: "With the token bucket: the largest burst a client can send at once.", min: 1, max: 200, step: 1 },
    { id: "shedMs", type: "number", label: "Shed when the expected wait exceeds", help: "Refuse new requests at once (503) when the queue already holds more than this much work. 5000 means no shedding in practice.", min: 50, max: 5000, step: 50, unit: "ms" },
  ],
  starter: { limiter: "none", rate: 20, burst: 20, shedMs: 5000 },
  locked: [],
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "userPercent", label: "Users' requests answered (%)" },
    { key: "p99", label: "Users' p99 (ms)" },
    { key: "userGaveUp", label: "Users who gave up waiting", bad: "above-zero" },
    { key: "userLimited", label: "Users' requests rate-limited", bad: "above-zero" },
    { key: "scraperPerS", label: "Scraper served per second" },
    { key: "partnerMax", label: "Partner's most accepted in one second" },
  ],
  checks,
  prediction: {
    unit: "requests",
    answer: "partnerMax",
    variants: [
      { id: "fixed-20", question: "A fixed window allows 40 requests per calendar second per client. The partner sends 40 just before each second ends and 40 just after. What's the most of its requests accepted within one second?", scenario: scenarios[1], config: { limiter: "fixed", rate: 40 } },
      { id: "sliding-20", question: "A sliding window allows 40 requests in any one-second span per client. The partner sends 40 just before each second ends and 40 just after. What's the most of its requests accepted within one second?", scenario: scenarios[1], config: { limiter: "sliding", rate: 40 } },
    ],
  },
  questions: [
    {
      id: "fixed-window",
      prompt: "Why did the fixed window let the partner through at up to twice its limit?",
      options: [
        { text: "Requests just before and just after a window boundary fall in two different windows, so each gets its full allowance.", correct: true, why: "Right. A sliding window or a token bucket counts any one-second span." },
        { text: "Because the server was too fast.", why: "The limiter decided before the server saw them." },
        { text: "Fixed windows count only every other second.", why: "They count every second; the boundary is the gap." },
      ],
    },
    {
      id: "shedding",
      prompt: "In the viral scenario every user is genuine. Why reject some of them?",
      options: [
        { text: "To punish heavy users.", why: "Nobody here is abusive; demand simply exceeds capacity." },
        { text: "Rejecting is pointless; queue them all.", why: "Then everyone waits past their patience and the server finishes work for people who've left." },
        { text: "When demand exceeds capacity, someone isn't served either way. Refusing early lets the accepted ones be answered fast instead of everyone waiting until they give up.", correct: true, why: "Right. Load shedding keeps goodput high and latency bounded." },
      ],
    },
    {
      id: "burst",
      prompt: "Why give the token bucket a size of at least 12 here?",
      options: [
        { text: "A page load sends 12 requests at once; a smaller bucket would rate-limit normal page loads although the average rate is low.", correct: true, why: "Right. Size limits from real client behaviour: average rate and burst." },
        { text: "Token buckets need a size above 10.", why: "Any size works; it's chosen from the traffic." },
        { text: "To let the scraper through faster.", why: "The scraper's average rate is what the bucket limits; the size only allows short bursts." },
      ],
    },
  ],
  explain: (f) => {
    const parts: string[] = [];
    if (f.userGaveUp) parts.push(`${f.userGaveUp.toLocaleString("en")} user requests waited in the queue until their users gave up: the queue held more work than anyone would wait for.`);
    if (f.userLimited) parts.push(`${f.userLimited.toLocaleString("en")} of users' own requests were rate-limited: the limit (or bucket size) is below a normal page load.`);
    if (f.scraperPerS > 60) parts.push(`The scraper got ${f.scraperPerS} requests a second served: nothing limits a single client.`);
    if (f.partnerMax > 30) parts.push(`The partner got ${f.partnerMax} requests accepted within one second, beyond its contract of 30.`);
    if (f.p99 > 300) parts.push(`Users' p99 was ${f.p99} ms.`);
    if (!parts.length) parts.push(`${f.userPercent}% of users' requests answered with p99 ${f.p99} ms; the scraper got ${f.scraperPerS}/s and the partner at most ${f.partnerMax} in a second.`);
    return parts.join(" ");
  },
  hints: [
    "In the scraper run, whose requests fill the queue?",
    "A limit per client stops one client taking everything. Size it from what a normal user does: 12 at once, about 5 a second on average. Which algorithm treats the partner's boundary trick correctly?",
    "With 600 genuine requests a second and capacity for 400, a third can't be served either way. How long should the queue be allowed to get?",
  ],
  assumptions: [
    `The server finishes ${CAPACITY} requests a second, oldest first. A user whose request has waited 1 s gives up; the scraper and partner never give up.`,
    "Each user loads a page about every 2.4 s, sending 12 requests at once; start times and gaps come from a fixed seed.",
    "Limits are per client (by API key or IP). Shedding refuses a request when the queue already holds more than the configured wait at full speed.",
    "Rate-limited and shed requests are refused at once (429 or 503) and not retried here.",
  ],
  notModelled: [
    "Distributed rate limiting across several API servers (shared counters, approximations).",
    "Clients retrying after 429/503 (see the retry-storm lab), and priorities between kinds of request.",
    "Attackers rotating keys or IPs, and authentication.",
  ],
};
