// Lab: a failing dependency drags down requests that don't even use it; timeouts, a circuit breaker, a bulkhead and
// a fallback contain it.
// Modelled: a shop API with a pool of worker slots shared by two kinds of request: product pages (which call a
// healthy catalog) and recommendation panels (which call a recommendations service). A request holds its slot for
// all its work, including waiting on its dependency; without a free slot it waits in a bounded queue. Users give up
// after 2 s. The recommendations service may hang (never answer), fail at once, or slow down for a while.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { timeoutMs: number; breaker: boolean; thresholdPercent: number; openMs: number; recSlots: number; fallback: boolean };

const SLOTS = 40;
const QUEUE = 200;
const USER_WAIT = 2000;
const DURATION = 10_000;
const BUCKET = 250;
const PAGES_PER_S = 120;
const PANELS_PER_S = 60;
const OWN_MS = 10;
const CATALOG_MS = 20;
const REC_MS = 30;
const WINDOW = 1000;
const MIN_CALLS = 10;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  type Bucket = { pages: number; pagesOk: number; panels: number; panelsOk: number; panelsFallback: number; recCalls: number; recCallsDown: number; refused: number; busy: number; open: number; realAfter: number; panelsAfter: number };
  const buckets: Bucket[] = [];
  const at = (t: number) => (buckets[Math.floor(t / BUCKET)] ??= { pages: 0, pagesOk: 0, panels: 0, panelsOk: 0, panelsFallback: 0, recCalls: 0, recCallsDown: 0, refused: 0, busy: 0, open: 0, realAfter: 0, panelsAfter: 0 });
  const down = (t: number) => t >= p.from && t < p.to;

  let free = SLOTS;
  let recInFlight = 0;
  const waiting: { kind: "page" | "panel"; start: number }[] = [];
  // Breaker state.
  let state: "closed" | "open" | "half-open" = "closed";
  let openUntil = 0;
  let trial = false;
  const outcomes: { t: number; ok: boolean }[] = [];

  const record = (ok: boolean) => {
    if (!c.breaker) return;
    if (state === "half-open") {
      trial = false;
      if (ok) {
        state = "closed";
        outcomes.length = 0;
        tl.log({ actor: "api", kind: "note", text: "The trial call succeeded: the breaker closes and calls flow again.", tone: "good" });
      } else {
        state = "open";
        openUntil = tl.now + c.openMs;
        tl.log({ actor: "api", kind: "note", text: `The trial call failed: the breaker opens again for ${c.openMs} ms.`, tone: "warn" });
      }
      return;
    }
    outcomes.push({ t: tl.now, ok });
    while (outcomes.length && outcomes[0].t <= tl.now - WINDOW) outcomes.shift();
    const failed = outcomes.filter((o) => !o.ok).length;
    if (state === "closed" && outcomes.length >= MIN_CALLS && (failed / outcomes.length) * 100 >= c.thresholdPercent) {
      state = "open";
      openUntil = tl.now + c.openMs;
      tl.log({ actor: "api", kind: "note", text: `${failed} of the last ${outcomes.length} recommendation calls failed: the breaker opens. For ${c.openMs} ms, calls fail at once without being sent.`, tone: "warn" });
    }
  };
  /** Whether the breaker lets this call through. */
  const allow = () => {
    if (!c.breaker || state === "closed") return true;
    if (state === "open" && tl.now >= openUntil) {
      state = "half-open";
      trial = false;
    }
    if (state === "half-open" && !trial) {
      trial = true;
      return true;
    }
    return false;
  };

  function release() {
    free++;
    while (free > 0 && waiting.length) {
      const next = waiting.shift()!;
      if (tl.now - next.start >= USER_WAIT) continue;
      begin(next.kind, next.start);
    }
  }

  function answer(kind: "page" | "panel", start: number, outcome: "ok" | "fallback" | "error") {
    const late = tl.now - start > USER_WAIT;
    if (late || outcome === "error") return;
    const b = at(start);
    if (kind === "page") b.pagesOk++;
    else if (outcome === "ok") b.panelsOk++;
    else b.panelsFallback++;
    if (kind === "panel" && outcome === "ok" && start >= p.to + 1000) b.realAfter++;
  }

  function begin(kind: "page" | "panel", start: number) {
    free--;
    tl.after(OWN_MS, () => {
      if (kind === "page") {
        tl.after(CATALOG_MS, () => {
          answer("page", start, "ok");
          release();
        });
        return;
      }
      const degrade = () => {
        answer("panel", start, c.fallback ? "fallback" : "error");
        release();
      };
      if (recInFlight >= c.recSlots) return degrade();
      if (!allow()) return degrade();
      recInFlight++;
      at(tl.now).recCalls++;
      if (down(tl.now)) at(tl.now).recCallsDown++;
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        recInFlight--;
        record(ok);
        if (ok) {
          answer("panel", start, "ok");
          release();
        } else degrade();
      };
      const sentAt = tl.now;
      if (down(sentAt) && p.mode === 1) {
        // Hung: no answer ever comes.
      } else if (down(sentAt) && p.mode === 2) tl.after(5, () => settle(false));
      else tl.after(down(sentAt) && p.mode === 3 ? p.slowMs : REC_MS, () => settle(true));
      tl.after(c.timeoutMs, () => settle(false));
    });
  }

  function arrive(kind: "page" | "panel") {
    const b = at(tl.now);
    if (kind === "page") b.pages++;
    else {
      b.panels++;
      if (tl.now >= p.to + 1000) b.panelsAfter++;
    }
    if (free > 0) return begin(kind, tl.now);
    if (waiting.length >= QUEUE) {
      b.refused++;
      return;
    }
    waiting.push({ kind, start: tl.now });
  }

  for (let t = 0; t < DURATION; t += 1000 / PAGES_PER_S) tl.at(Math.round(t), () => arrive("page"));
  for (let t = 3; t < DURATION; t += 1000 / PANELS_PER_S) tl.at(Math.round(t), () => arrive("panel"));
  for (let t = 0; t < DURATION; t += BUCKET) tl.at(t + BUCKET - 1, () => {
    const b = at(t);
    b.busy = SLOTS - free;
    b.open = state === "open" ? 1 : 0;
  });
  tl.at(p.from, () => tl.log({ actor: "rec", kind: "fault", text: p.mode === 1 ? "Recommendations hangs: calls are accepted but never answered." : p.mode === 2 ? "Recommendations fails: every call gets an error at once." : `Recommendations slows down: each call takes ${p.slowMs} ms.`, tone: "bad" }));
  tl.at(p.to, () => tl.log({ actor: "rec", kind: "note", text: "Recommendations is healthy again.", tone: "info" }));
  tl.drain(DURATION + 30_000);

  const ticks: LabEvent[] = buckets.map((b, i) => ({
    i: 0, t: i * BUCKET, actor: "api", kind: "tick", tone: b.pagesOk < b.pages ? "bad" : "info",
    text: `Pages: ${b.pagesOk} of ${b.pages} answered in time. Panels: ${b.panelsOk} real, ${b.panelsFallback} fallback, of ${b.panels}. ${b.recCalls} calls to recommendations. ${b.busy} of ${SLOTS} slots busy${b.open ? "; breaker open" : ""}.`,
    data: { ...b, slotsBusy: b.busy, slots: SLOTS, pageOkRate: (b.pagesOk * 1000) / BUCKET, recRate: (b.recCalls * 1000) / BUCKET },
  }));
  return [...tl.events, ...ticks].sort((a, b) => a.t - b.t || (a.kind === "tick" ? 1 : 0) - (b.kind === "tick" ? 1 : 0)).map((e, i) => ({ ...e, i }));
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["pages", "pagesOk", "panels", "panelsOk", "panelsFallback", "recCalls", "recCallsDown", "refused", "realAfter", "panelsAfter"]);
  const pct = (a: number, b: number) => (b ? Math.floor((a / b) * 1000) / 10 : 100);
  return {
    ...f,
    pagePercent: pct(f.pagesOk, f.pages),
    panelPercent: pct(f.panelsOk + f.panelsFallback, f.panels),
    realAfterPercent: pct(f.realAfter, f.panelsAfter),
    peakBusy: Math.max(0, ...events.filter((e) => e.kind === "tick").map((e) => e.data!.slotsBusy ?? 0)),
  };
}

const scenarios: LabScenario[] = [
  { id: "hang", title: "Recommendations hangs", description: "From 2 s to 6 s, calls to recommendations are accepted but never answered.", seed: 1, params: { from: 2000, to: 6000, mode: 1 } },
  { id: "errors", title: "Recommendations fails fast", description: "From 2 s to 6 s, every call to recommendations gets an error at once.", seed: 1, params: { from: 2000, to: 6000, mode: 2 } },
  { id: "slow", title: "Recommendations is slow", description: "From 2 s to 6 s, each call to recommendations takes 1.5 s instead of 30 ms.", seed: 1, params: { from: 2000, to: 6000, mode: 3, slowMs: 1500 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:pages`, scenario: s.id, requirement: "At least 99% of product pages are answered within 2 s", passed: (f: Facts) => f.pagePercent >= 99, observed: (f: Facts) => `${f.pagePercent}% of pages answered in time` },
  { id: `${s.id}:panels`, scenario: s.id, requirement: "At least 95% of recommendation panels show something (real or fallback) within 2 s", passed: (f: Facts) => f.panelPercent >= 95, observed: (f: Facts) => `${f.panelPercent}% of panels shown` },
  { id: `${s.id}:relief`, scenario: s.id, requirement: "While it's failing, recommendations receives at most 150 calls in total", passed: (f: Facts) => f.recCallsDown <= 150, observed: (f: Facts) => `${f.recCallsDown.toLocaleString("en")} calls while it was failing` },
  { id: `${s.id}:resume`, scenario: s.id, requirement: "From 1 s after it recovers, at least 95% of panels show real recommendations", passed: (f: Facts) => f.realAfterPercent >= 95, observed: (f: Facts) => `${f.realAfterPercent}% real after recovery` },
];

export const circuitBreakerLab: Lab = {
  id: "circuit-breaker",
  version: "1",
  title: "Contain a failing dependency",
  summary: "A recommendations service hangs, and soon product pages fail too, though they never call it. Add a timeout, a circuit breaker, a bulkhead and a fallback until only the broken feature degrades.",
  story: [
    "Your shop API serves product pages (which call the catalog) and recommendation panels (which call a separate recommendations service). Both share one pool of 40 worker slots: a request holds a slot until it answers, including while it waits for its dependency.",
    "When recommendations stops answering, each panel request holds its slot for as long as it waits. Soon every slot is waiting on recommendations, and product pages, which never touch it, queue and time out. A failure in an optional feature has become an outage of the whole shop.",
  ],
  unit: "resilience",
  view: { kind: "series", lines: [{ key: "slotsBusy", label: "Worker slots busy" }, { key: "pageOkRate", label: "Pages answered per second" }, { key: "recRate", label: "Calls to recommendations per second" }], limit: { key: "slots", label: "All slots" } },
  controls: [
    { id: "timeoutMs", type: "number", label: "Timeout for recommendation calls", help: "How long a panel request waits for recommendations before treating the call as failed.", min: 50, max: 5000, step: 50, unit: "ms" },
    { id: "breaker", type: "toggle", label: "Circuit breaker", help: "Stops calling recommendations after too many failures in the last second, then tests it with a single call." },
    { id: "thresholdPercent", type: "number", label: "Breaker opens at a failure rate of", help: "Share of failed calls in the last second (at least 10 calls) that opens the breaker.", min: 10, max: 100, step: 5, unit: "%" },
    { id: "openMs", type: "number", label: "Breaker open period", help: "How long calls fail fast before a trial call is let through.", min: 100, max: 10000, step: 100, unit: "ms" },
    { id: "recSlots", type: "number", label: "Bulkhead: slots that may wait on recommendations", help: "The most recommendation calls in flight at once; beyond it, panels give up at once. 40 means no bulkhead (the whole pool).", min: 1, max: 40, step: 1 },
    { id: "fallback", type: "toggle", label: "Fallback: show popular items", help: "When the call fails, times out, is refused by the breaker or the bulkhead, the panel shows a cached “popular” list instead of an error." },
  ],
  starter: { timeoutMs: 5000, breaker: false, thresholdPercent: 50, openMs: 5000, recSlots: 40, fallback: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "pagePercent", label: "Pages answered (%)" },
    { key: "panelPercent", label: "Panels shown (%)" },
    { key: "recCallsDown", label: "Calls while it was failing" },
    { key: "peakBusy", label: "Most slots busy" },
    { key: "realAfterPercent", label: "Real panels after recovery (%)" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "slots",
    answer: "peakBusy",
    variants: [
      { id: "hang-5s", question: "Recommendations hangs. Panel requests arrive 60 times a second and wait up to 5 s for it. How many of the 40 worker slots are busy at the worst moment?", scenario: scenarios[0] },
      { id: "hang-bulkhead", question: "Recommendations hangs, but at most 10 slots may wait on it (a bulkhead); panels beyond that give up at once. How many of the 40 worker slots are busy at the worst moment?", scenario: scenarios[0], config: { recSlots: 10 } },
    ],
  },
  questions: [
    {
      id: "why-pages",
      prompt: "Product pages never call recommendations. Why did they fail?",
      options: [
        { text: "The catalog slowed down too.", why: "The catalog stayed healthy; pages failed waiting for a slot." },
        { text: "Panel requests held every shared slot while waiting on the hung service, so pages queued behind them past their 2 s.", correct: true, why: "Right. A shared resource turns one dependency's failure into everyone's." },
        { text: "The load balancer sent pages to the wrong server.", why: "There's one API; the shared slot pool is the link." },
      ],
    },
    {
      id: "breaker-vs-timeout",
      prompt: "You already have a short timeout. What does a circuit breaker add?",
      options: [
        { text: "Nothing, once the timeout is short.", why: "Each call still waits for the timeout and still reaches the failing service." },
        { text: "It stops sending calls at all while the dependency is failing: callers fail at once instead of waiting a timeout each time, and the dependency gets room to recover.", correct: true, why: "Right. A timeout bounds each wait; a breaker avoids the call." },
        { text: "It retries failed calls automatically.", why: "A breaker does the opposite: it stops calls." },
      ],
    },
    {
      id: "open-period",
      prompt: "The breaker's open period is 30 s. The dependency recovers after 4 s. What happens?",
      options: [
        { text: "Users get the fallback for up to 26 s longer than necessary; a shorter open period with half-open trials resumes sooner.", correct: true, why: "Right. The open period trades protection for recovery speed." },
        { text: "The breaker closes as soon as the dependency recovers.", why: "Nothing is sent while it's open, so it can't notice the recovery until a trial call." },
        { text: "Every call during those 30 s is retried later.", why: "Calls refused by a breaker aren't queued; they fail (or fall back)." },
      ],
    },
  ],
  explain: (f) => {
    const parts: string[] = [];
    if (f.pagePercent < 99) parts.push(`Only ${f.pagePercent}% of product pages were answered in time: up to ${f.peakBusy} of ${SLOTS} slots were busy, mostly with panel requests waiting on recommendations, so pages queued behind them.`);
    else parts.push(`${f.pagePercent}% of pages were answered in time; at most ${f.peakBusy} slots were busy.`);
    if (f.panelPercent < 95) parts.push(`Only ${f.panelPercent}% of panels showed anything.`);
    if (f.recCallsDown > 150) parts.push(`Recommendations received ${f.recCallsDown.toLocaleString("en")} calls while it was failing: no room to recover.`);
    if (f.realAfterPercent < 95) parts.push(`After it recovered, only ${f.realAfterPercent}% of panels showed real recommendations: callers kept refusing or falling back.`);
    return parts.join(" ");
  },
  hints: [
    "Look at the slots line during the failure: who holds them, and for how long?",
    "Limit how long, and how many slots, can wait on recommendations. Pages then keep their share of the pool.",
    "A failed panel can still show something useful. And while recommendations is down, why call it at all? Make sure you'd notice when it's back.",
  ],
  assumptions: [
    `120 product pages and 60 recommendation panels a second; ${SLOTS} worker slots shared by both, with ${QUEUE} places to wait; users give up after 2 s.`,
    "A page takes 10 ms of the API's work plus 20 ms waiting for the catalog; a panel takes 10 ms plus its call to recommendations (30 ms when healthy).",
    "A hung call never answers and ends only at the timeout; a failing call errors after 5 ms.",
    "The breaker counts calls over the last second and needs at least 10 before it can open; after the open period, one trial call decides between closing and opening again.",
  ],
  notModelled: [
    "Retries (see the retry-storm lab), several API servers, or per-server breakers disagreeing.",
    "Recommendations' own capacity: here it recovers on schedule whatever load it gets.",
    "Thread-pool overheads, connection limits, and stale fallback data.",
  ],
};
