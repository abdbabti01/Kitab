// Lab: after an outage, synchronised retries keep a recovered server overloaded (a retry storm); backoff spreads
// them out, jitter de-synchronises them, a retry budget caps them.
// Modelled: open-loop arrivals of new requests at a steady rate; one server that finishes a fixed number of requests
// per second from a bounded FIFO queue and refuses when full; client timeouts (the server still does the work of a
// request whose client has given up: wasted work); a retry policy per client; an outage that refuses everything
// or a crash that drops every queued request at the same instant. Ten-millisecond steps; every random choice
// (jitter) comes from the scenario's seed.
import { prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { policy: "none" | "immediate" | "fixed" | "exponential" | "exponential-jitter"; attempts: number; baseMs: number; timeoutMs: number; budget: boolean };

const STEP = 10;
const BUCKET = 100;
const NEEDS = { outage: 97, "long-outage": 80, restart: 97 } as Record<string, number>;
const RATE = 200;
const CAPACITY = 300;
const QUEUE = 400;
const DURATION = 12_000;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const events: LabEvent[] = [];
  const log = (t: number, e: Omit<LabEvent, "i" | "t">) => events.push({ i: events.length, t, ...e });

  type Attempt = { req: number; n: number; deadline: number; abandoned: boolean };
  const queue: Attempt[] = [];
  let head = 0;
  // Retries waiting to be sent, by the step they're due.
  const due = new Map<number, { req: number; n: number }[]>();
  const born: number[] = [];
  const recentFirst: number[] = [];
  const recentRetries: number[] = [];
  let credit = 0;
  let arrivalCredit = 0;
  let bucket = { attempts: 0, ok: 0, refused: 0, timeouts: 0, wasted: 0, gaveUp: 0, newRequests: 0, retries: 0, latencySum: 0, slow: 0 };
  let downFrom = p.outageFrom ?? -1;
  const downTo = p.outageTo ?? -1;

  const delayFor = (n: number) => {
    // n = 1 for the first retry
    if (c.policy === "immediate") return 0;
    if (c.policy === "fixed") return c.baseMs;
    const cap = Math.min(c.baseMs * 2 ** (n - 1), 20_000);
    return c.policy === "exponential" ? cap : Math.floor(random() * cap);
  };
  const budgetAllows = (t: number) => {
    if (!c.budget) return true;
    // Like Finagle's RetryBudget: retries in the last 10 s may reach 20% of requests in that time, plus 10 per second.
    while (recentFirst.length && recentFirst[0] <= t - 10_000) recentFirst.shift();
    while (recentRetries.length && recentRetries[0] <= t - 10_000) recentRetries.shift();
    return recentRetries.length < recentFirst.length * 0.2 + 100;
  };
  const fail = (t: number, a: { req: number; n: number }) => {
    if (c.policy !== "none" && a.n < c.attempts && budgetAllows(t)) {
      const at = t + Math.max(STEP, Math.ceil(delayFor(a.n) / STEP) * STEP);
      if (at < DURATION + 8000) {
        recentRetries.push(t);
        const list = due.get(at) ?? [];
        list.push({ req: a.req, n: a.n + 1 });
        due.set(at, list);
        return;
      }
    }
    bucket.gaveUp++;
  };
  const send = (t: number, req: number, n: number) => {
    bucket.attempts++;
    if (n > 1) bucket.retries++;
    if (t >= downFrom && t < downTo) {
      bucket.refused++;
      return fail(t, { req, n });
    }
    if (queue.length - head >= QUEUE) {
      bucket.refused++;
      return fail(t, { req, n });
    }
    queue.push({ req, n, deadline: t + c.timeoutMs, abandoned: false });
  };

  const end = DURATION + 8000;
  for (let t = 0; t < end; t += STEP) {
    if (t === downFrom) {
      const dropped = queue.length - head;
      log(t, { actor: "server", kind: "fault", text: p.crash ? `The server crashes: ${dropped} queued requests are dropped at the same instant, and it refuses connections until ${(downTo / 1000).toFixed(1)} s.` : `The server goes down until ${(downTo / 1000).toFixed(1)} s: every request is refused at once.`, tone: "bad", data: { outageFrom: t, outageTo: downTo } });
      for (let i = head; i < queue.length; i++) if (!queue[i].abandoned) fail(t, queue[i]);
      bucket.refused += dropped;
      queue.length = 0;
      head = 0;
      // Clients holding connections (a sync, a long poll) all lose them at this same instant.
      for (let k = 0; k < (p.herd ?? 0); k++) {
        const req = born.length;
        born.push(t);
        bucket.newRequests++;
        bucket.attempts++;
        bucket.refused++;
        recentFirst.push(t);
        fail(t, { req, n: 1 });
      }
      if (p.herd) log(t, { actor: "server", kind: "note", text: `${p.herd.toLocaleString("en")} connected clients lose their connection at the same instant: all of them will retry.`, tone: "warn" });
    }
    if (t === downTo) log(t, { actor: "server", kind: "note", text: "The server is back. Whatever is waiting to retry now arrives on top of new requests.", tone: "info" });
    // New requests.
    if (t < DURATION) {
      arrivalCredit += (RATE * STEP) / 1000;
      while (arrivalCredit >= 1) {
        arrivalCredit -= 1;
        const req = born.length;
        born.push(t);
        bucket.newRequests++;
        recentFirst.push(t);
        send(t, req, 1);
      }
    }
    for (const r of due.get(t) ?? []) send(t, r.req, r.n);
    due.delete(t);
    // Clients give up on attempts that have waited past their timeout.
    for (let i = head; i < queue.length; i++) {
      const a = queue[i];
      if (!a.abandoned && t >= a.deadline) {
        a.abandoned = true;
        bucket.timeouts++;
        fail(t, a);
      }
    }
    // The server finishes what its capacity allows this step.
    if (!(t >= downFrom && t < downTo)) {
      credit = Math.min(credit + (CAPACITY * STEP) / 1000, CAPACITY * STEP / 1000 + 1);
      while (credit >= 1 && head < queue.length) {
        credit -= 1;
        const a = queue[head++];
        if (a.abandoned) bucket.wasted++;
        else {
          bucket.ok++;
          const latency = t + STEP - born[a.req];
          bucket.latencySum += latency;
          if (latency > 1000) bucket.slow++;
        }
      }
      if (head > 5000) {
        queue.splice(0, head);
        head = 0;
      }
    }
    if ((t + STEP) % BUCKET === 0) {
      const perSecond = 1000 / BUCKET;
      log(t + STEP - BUCKET, { actor: "server", kind: "tick", text: `${bucket.attempts * perSecond} attempts per second arrive (${bucket.retries * perSecond} of them retries); ${bucket.ok * perSecond} succeed, ${bucket.refused * perSecond} are refused, ${bucket.timeouts * perSecond} time out; ${queue.length - head} waiting.`, tone: bucket.refused + bucket.timeouts > 0 ? "bad" : "info", data: {
        ...bucket, attemptRate: bucket.attempts * perSecond, okRate: bucket.ok * perSecond, capacity: CAPACITY, depth: queue.length - head,
      } });
      bucket = { attempts: 0, ok: 0, refused: 0, timeouts: 0, wasted: 0, gaveUp: 0, newRequests: 0, retries: 0, latencySum: 0, slow: 0 };
    }
  }
  downFrom = -1;
  return events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["newRequests", "attempts", "retries", "ok", "refused", "timeouts", "wasted", "gaveUp", "slow"]);
  const ticks = events.filter((e) => e.kind === "tick");
  const outage = events.find((e) => e.kind === "fault")?.data;
  // Recovered: from the end of the outage, the first moment after which no attempt is refused or times out.
  const lastBad = ticks.filter((e) => (e.data!.refused ?? 0) + (e.data!.timeouts ?? 0) > 0).at(-1);
  const recoveredAt = lastBad ? lastBad.t + BUCKET : 0;
  const peak = Math.max(0, ...ticks.filter((e) => outage && e.t >= outage.outageTo).map((e) => e.data!.attemptRate ?? 0));
  return {
    ...f,
    successPercent: f.newRequests ? Math.floor((f.ok / f.newRequests) * 1000) / 10 : 0,
    amplification: f.newRequests ? Math.round((f.attempts / f.newRequests) * 100) / 100 : 0,
    recoveryMs: outage ? Math.max(0, recoveredAt - outage.outageTo) : 0,
    peakAfter: peak,
  };
}

const scenarios: LabScenario[] = [
  { id: "outage", title: "A 2-second outage", description: "The server refuses every request from 2 s to 4 s, then comes back at full capacity.", seed: 7, params: { outageFrom: 2000, outageTo: 4000 } },
  { id: "long-outage", title: "A 4-second outage", description: "The server refuses every request from 3 s to 7 s.", seed: 11, params: { outageFrom: 3000, outageTo: 7000 } },
  { id: "restart", title: "A restart drops 600 connections", description: "At 3 s the server restarts for 1 s; 600 clients that were connected lose their connections at the same instant and reconnect.", seed: 13, params: { outageFrom: 3000, outageTo: 4000, herd: 600 } },
];

const checksFor = (s: LabScenario) => [
  ...(s.id === "restart" ? [{ id: "restart:spread", scenario: s.id, requirement: `The reconnecting clients never arrive faster than ${4 * CAPACITY} attempts per second (4× capacity)`, passed: (f: Facts) => f.peakAfter <= 4 * CAPACITY, observed: (f: Facts) => `peak of ${f.peakAfter.toLocaleString("en")} attempts per second` }] : []),
  { id: `${s.id}:served`, scenario: s.id, requirement: `At least ${NEEDS[s.id]}% of requests succeed in the end`, passed: (f: Facts) => f.successPercent >= NEEDS[s.id], observed: (f: Facts) => `${f.successPercent}% succeeded` },
  { id: `${s.id}:recovers`, scenario: s.id, requirement: "Within 3 s of the server's return, nothing is refused or times out", passed: (f: Facts) => f.recoveryMs <= 3000, observed: (f: Facts) => (f.recoveryMs ? `refusals or timeouts went on for ${(f.recoveryMs / 1000).toFixed(1)} s after it returned` : "no refusals or timeouts after it returned") },
  { id: `${s.id}:wasted`, scenario: s.id, requirement: "The server wastes less than 5% of its work on requests whose client gave up", passed: (f: Facts) => f.wasted <= f.ok * 0.05, observed: (f: Facts) => `${f.wasted.toLocaleString("en")} wasted for ${f.ok.toLocaleString("en")} useful` },
];

export const retryStormLab: Lab = {
  id: "retry-storm",
  version: "1",
  title: "Stop a retry storm",
  summary: "A short outage ends, but the server stays overloaded: every client retries at once. Tune the retry policy until it recovers by itself.",
  story: [
    "Your API takes 200 new requests a second and can finish 250. Clients retry failed requests, as they should: most failures are brief.",
    "Then the server is down for a moment. When it returns, it faces new requests plus every client that was waiting to retry, often at the same instant. If that exceeds its capacity, requests queue past their timeouts, clients retry again, and the server spends its time on answers nobody is waiting for. An outage of seconds can last minutes.",
  ],
  unit: "resilience",
  view: { kind: "series", lines: [{ key: "attemptRate", label: "Attempts arriving per second" }, { key: "okRate", label: "Successes per second" }], limit: { key: "capacity", label: "Server capacity" } },
  controls: [
    { id: "policy", type: "select", label: "Retry policy", help: "When a client tries a failed request again.", options: [
      { value: "none", label: "Don't retry" },
      { value: "immediate", label: "Retry immediately" },
      { value: "fixed", label: "Wait a fixed time" },
      { value: "exponential", label: "Exponential backoff (double the wait each time)" },
      { value: "exponential-jitter", label: "Exponential backoff with full jitter (random wait up to the doubled time)" },
    ] },
    { id: "attempts", type: "number", label: "Attempts per request", help: "The first try plus retries.", min: 1, max: 8, step: 1 },
    { id: "baseMs", type: "number", label: "Base wait", help: "The fixed wait, or the first wait that backoff doubles.", min: 10, max: 2000, step: 10, unit: "ms" },
    { id: "timeoutMs", type: "number", label: "Client timeout", help: "How long a client waits for an answer before giving up on that attempt.", min: 200, max: 5000, step: 100, unit: "ms" },
    { id: "budget", type: "toggle", label: "Retry budget", help: "Retries in the last 10 s may not exceed 20% of the requests sent in that time, plus 10 per second; past that, a failure is final." },
  ],
  starter: { policy: "exponential", attempts: 5, baseMs: 1000, timeoutMs: 1000, budget: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "successPercent", label: "Requests that succeeded (%)" },
    { key: "amplification", label: "Attempts per request" },
    { key: "peakAfter", label: "Peak attempts/s after the outage" },
    { key: "recoveryMs", label: "Trouble after return (ms)", bad: "above-zero" },
    { key: "wasted", label: "Wasted work (requests)", bad: "above-zero" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "attempts per second",
    answer: "peakAfter",
    variants: [
      { id: "restart-backoff", question: "600 connected clients lose their connections at the same instant. Each retries with exponential backoff from 1 s, without jitter. The server (300 requests per second) is back after 1 s. What peak rate of attempts per second arrives after it returns?", scenario: scenarios[2] },
      { id: "long-backoff", question: "Clients use exponential backoff from 1 s, without jitter, up to 5 attempts. After a 4-second outage, what peak rate of attempts per second arrives once the server is back (capacity 300)?", scenario: scenarios[1] },
      { id: "restart-jitter", question: "The same 600 clients now use exponential backoff from 1 s with full jitter. What peak rate of attempts per second arrives after the server returns?", scenario: scenarios[2], config: { policy: "exponential-jitter" } },
    ],
  },
  questions: [
    {
      id: "jitter",
      prompt: "Exponential backoff alone still produced a spike after the crash. Why does jitter help?",
      options: [
        { text: "Jitter makes each retry wait longer on average.", why: "Full jitter actually waits less on average (half the cap); what matters is that the waits differ." },
        { text: "Clients that failed at the same instant retry at different instants, so their retries spread out instead of arriving together.", correct: true, why: "Right. Backoff lowers the rate of retries; jitter breaks their synchronisation." },
        { text: "Jitter lets the server tell retries apart from new requests.", why: "The server can't tell them apart either way; jitter only changes when retries are sent." },
      ],
    },
    {
      id: "metastable",
      prompt: "With immediate retries, why does the server stay overloaded even after the outage has ended?",
      options: [
        { text: "Because it hasn't been restarted properly.", why: "It came back at full capacity; the load it faces is the problem." },
        { text: "Retries add load beyond capacity; requests then wait past their timeouts, so the server finishes answers nobody waits for, and every timeout makes another retry.", correct: true, why: "Right. That self-sustaining loop is a metastable failure: the trigger is gone, the overload sustains itself." },
        { text: "New requests arrive faster than before the outage.", why: "New requests arrive at the same 200 per second; retries are the extra load." },
      ],
    },
    {
      id: "budget",
      prompt: "When is a retry budget (retries capped at a share of requests) better than more retries with backoff?",
      options: [
        { text: "When the dependency is overloaded for a long time: the budget caps the extra load at about 10%, whatever the clients do.", correct: true, why: "Right. Backoff spreads retries but each client still retries; a budget bounds the total, so an overloaded service isn't pushed further." },
        { text: "When failures are rare and brief: a budget recovers more of them.", why: "Brief, rare failures are where per-request retries shine; a budget mostly matters under sustained failure." },
        { text: "Never: a budget only loses requests.", why: "It trades some failed requests during long outages for a service that can recover." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    if (f.recoveryMs > 3000) return `After the server returned, refusals and timeouts went on for ${(f.recoveryMs / 1000).toFixed(1)} s: retries arrived at up to ${f.peakAfter} attempts per second against a capacity of ${CAPACITY}. Queued requests outlived their timeouts, so ${f.wasted.toLocaleString("en")} answers went to clients that had already given up, and each of those timeouts made another retry.`;
    if (f.successPercent < 97) return c.policy === "none" ? `Without retries, every request that met the outage failed: ${f.successPercent}% succeeded.` : `The load stayed manageable, but only ${f.successPercent}% of requests succeeded: retries ${c.budget ? "were capped by the budget or " : ""}gave up before the server was back. Spread them over a longer time.`;
    return `${f.successPercent}% succeeded with ${f.amplification} attempts per request. The peak after the outage was ${f.peakAfter} attempts per second against a capacity of ${CAPACITY}, and the server was clear ${f.recoveryMs ? `${(f.recoveryMs / 1000).toFixed(1)} s` : "at once"} after returning.`;
  },
  hints: [
    "Look at the chart right after the server returns: how far above the capacity line do attempts go, and how long does that last?",
    "Waiting longer between attempts lowers the retry rate. Doubling the wait each time (backoff) lets retries span a longer outage with few attempts.",
    "Clients that failed together retry together. A random part in each wait (jitter) spreads them out. Check that the total waiting time still covers the outage.",
  ],
  assumptions: [
    `200 new requests per second, arriving evenly; one server that finishes ${CAPACITY} per second, in arrival order, with room for ${QUEUE} waiting requests (more are refused at once).`,
    "A client whose attempt isn't answered within its timeout gives up on it; the server still does that work when the request reaches the front of the queue.",
    "During an outage every request is refused at once. A crash also drops the queue: all of those clients fail at the same instant.",
    "Retry waits are rounded up to 10 ms steps; jitter is “full jitter”: a random wait between 0 and the doubled wait, from a fixed seed.",
    "The retry budget is shared by all clients and counts the last second.",
  ],
  notModelled: [
    "Different request costs, autoscaling, or the server slowing down as it nears capacity.",
    "Clients that stop sending new requests when things fail (real users often do, which helps).",
    "Server-side protections such as load shedding or rate limiting (see the overload lab).",
  ],
};
