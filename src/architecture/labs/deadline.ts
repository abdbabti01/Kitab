// Lab: timeouts and retries at every layer multiply load on the deepest dependency and keep it busy with work
// nobody is waiting for; one retrying layer and a propagated deadline fix both.
// Modelled: users who give up after 1 s; a gateway and a service, each with a per-attempt timeout and a retry
// count; a database that serves one call at a time in arrival order at a fixed rate (lower during a slowdown) and
// may fail a share of calls at once (from the seed). With deadline propagation, every hop knows the user's
// deadline: it waits no longer than the time left, starts no attempt after it, and the database skips calls whose
// deadline has passed. Without it, the database works on every call it receives.
import { Timeline, prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { gatewayRetries: number; gatewayTimeoutMs: number; serviceRetries: number; serviceTimeoutMs: number; propagate: boolean };

const HOP = 5;
const USER_DEADLINE = 1000;
const RATE = 100;
const DURATION = 10_000;
const BUCKET = 250;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const tl = new Timeline();
  type Bucket = { users: number; ok: number; failed: number; dbCalls: number; dbWork: number; wasted: number; skipped: number };
  const empty = (): Bucket => ({ users: 0, ok: 0, failed: 0, dbCalls: 0, dbWork: 0, wasted: 0, skipped: 0 });
  const buckets: Bucket[] = [];
  const at = (t: number) => (buckets[Math.floor(t / BUCKET)] ??= empty());
  const lateStarts: number[] = [];

  type User = { start: number; deadline: number; done: boolean };
  type Call = { user: User; deadline: number; abandoned: boolean; reply: (ok: boolean) => void };
  const queue: Call[] = [];
  let busyUntil = 0;
  let serving = false;
  const rateAt = (t: number) => (t >= (p.slowFrom ?? Infinity) && t < (p.slowTo ?? -1) ? p.slowRate : p.rate);

  function serveNext() {
    if (serving) return;
    while (queue.length) {
      const call = queue.shift()!;
      if (c.propagate && tl.now >= call.deadline) {
        at(tl.now).skipped++;
        continue;
      }
      serving = true;
      const work = 1000 / rateAt(tl.now);
      busyUntil = tl.now + work;
      tl.at(busyUntil, () => {
        serving = false;
        at(tl.now).dbWork++;
        if (call.abandoned || call.user.done || tl.now > call.user.deadline) at(tl.now).wasted++;
        call.reply(true);
        serveNext();
      });
      return;
    }
  }

  function dbCall(user: User, deadline: number, reply: (ok: boolean) => void): Call {
    at(tl.now).dbCalls++;
    const call: Call = { user, deadline, abandoned: false, reply };
    if (random() < (p.errorRate ?? 0)) {
      tl.after(HOP, () => reply(false));
      return call;
    }
    queue.push(call);
    serveNext();
    return call;
  }

  /** The service: up to 1 + serviceRetries calls to the database, each with its own timeout. */
  function service(user: User, reply: (ok: boolean) => void) {
    let attempt = 0;
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      tl.after(HOP, () => reply(ok));
    };
    const tryOnce = () => {
      attempt++;
      const left = user.deadline - tl.now - HOP;
      if (c.propagate && left <= 0) return finish(false);
      const wait = c.propagate ? Math.min(c.serviceTimeoutMs, left) : c.serviceTimeoutMs;
      const start = tl.now;
      let settled = false;
      let call: Call | undefined;
      const fail = () => {
        if (call) call.abandoned = true;
        if (attempt <= c.serviceRetries) tryOnce();
        else finish(false);
      };
      tl.after(HOP, () => {
        if (settled) return;
        // With propagation the call carries this attempt's own deadline (the caller's timeout, within the user's).
        call = dbCall(user, start + wait, (ok) => {
          tl.after(HOP, () => {
            if (settled) return;
            settled = true;
            if (ok) finish(true);
            else fail();
          });
        });
      });
      tl.after(wait, () => {
        if (settled) return;
        settled = true;
        fail();
      });
    };
    tryOnce();
  }

  /** The gateway: up to 1 + gatewayRetries calls to the service. */
  function gateway(user: User) {
    let attempt = 0;
    const tryOnce = () => {
      attempt++;
      const left = user.deadline - tl.now;
      if (c.propagate && left <= HOP) return;
      const wait = c.propagate ? Math.min(c.gatewayTimeoutMs, left) : c.gatewayTimeoutMs;
      let settled = false;
      const fail = () => {
        if (attempt <= c.gatewayRetries) tryOnce();
      };
      tl.after(HOP, () => service(user, (ok) => {
        tl.after(HOP, () => {
          if (settled) return;
          settled = true;
          if (ok && !user.done && tl.now <= user.deadline) {
            user.done = true;
            at(user.start).ok++;
            if (user.start >= (p.slowTo ?? Infinity) + 1000) lateStarts.push(1);
          } else if (!ok) fail();
        });
      }));
      tl.after(wait, () => {
        if (settled) return;
        settled = true;
        fail();
      });
    };
    tryOnce();
  }

  for (let t = 0; t < DURATION; t += 1000 / RATE) {
    tl.at(t, () => {
      const user: User = { start: tl.now, deadline: tl.now + USER_DEADLINE, done: false };
      at(tl.now).users++;
      tl.after(USER_DEADLINE, () => {
        if (!user.done) at(user.start).failed++;
      });
      gateway(user);
    });
  }
  if (p.slowFrom !== undefined) {
    tl.at(p.slowFrom, () => tl.log({ actor: "db", kind: "fault", text: `The database slows down: it now finishes ${p.slowRate} calls per second instead of ${p.rate}.`, tone: "bad" }));
    tl.at(p.slowTo, () => tl.log({ actor: "db", kind: "note", text: `The database is back to ${p.rate} calls per second.`, tone: "info" }));
  }
  tl.drain(DURATION + 60_000);
  // One tick per quarter second, in time order with the notes.
  const ticks: LabEvent[] = buckets.map((b, i) => ({ i: 0, t: i * BUCKET, actor: "db", kind: "tick", tone: b.failed ? "bad" : "info", text: `Users: ${b.users} started, ${b.ok} answered in time, ${b.failed} gave up. Database: ${b.dbCalls} calls, ${b.dbWork} finished (${b.wasted} for nobody), ${b.skipped} skipped as expired.`, data: { ...b, callRate: (b.dbCalls * 1000) / BUCKET, workRate: (b.dbWork * 1000) / BUCKET, wastedRate: (b.wasted * 1000) / BUCKET, capacity: rateAt(i * BUCKET), afterOk: 0 } }));
  const merged = [...tl.events, ...ticks].sort((a, b) => a.t - b.t || (a.kind === "tick" ? 1 : 0) - (b.kind === "tick" ? 1 : 0));
  const recoveredUsers = buckets.slice(Math.ceil(((p.slowTo ?? DURATION) + 1000) / BUCKET)).reduce((n, b) => n + b.users, 0);
  const last = merged.filter((e) => e.kind === "tick").at(-1);
  if (last) last.data = { ...last.data, afterUsers: recoveredUsers, afterOk: lateStarts.length };
  return merged.map((e, i) => ({ ...e, i }));
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["users", "ok", "failed", "dbCalls", "dbWork", "wasted", "skipped", "afterUsers", "afterOk"]);
  return {
    ...f,
    successPercent: f.users ? Math.floor((f.ok / f.users) * 1000) / 10 : 0,
    amplification: f.users ? Math.round((f.dbCalls / f.users) * 100) / 100 : 0,
    wastedPercent: f.dbWork ? Math.round((f.wasted / f.dbWork) * 1000) / 10 : 0,
    afterPercent: f.afterUsers ? Math.floor((f.afterOk / f.afterUsers) * 1000) / 10 : 100,
  };
}

const scenarios: LabScenario[] = [
  { id: "flaky", title: "A flaky database", description: "One database call in five fails at once (a dropped connection, a lock timeout). Capacity is ample.", seed: 3, params: { rate: 200, errorRate: 0.2 } },
  { id: "slow", title: "A slow database", description: "From 2 s to 5 s the database finishes 60 calls a second instead of 200, while users keep arriving at 100 a second.", seed: 5, params: { rate: 200, slowFrom: 2000, slowTo: 5000, slowRate: 60 } },
];

/** Every database call fails at once: calls per request is then exactly the retries' product. */
const allFail: LabScenario = { id: "all-fail", title: "Every call fails", description: "The database refuses every call at once.", seed: 1, params: { rate: 200, errorRate: 1 } };

const checks = [
  { id: "flaky:served", scenario: "flaky", requirement: "At least 98% of users get an answer within their 1 s", passed: (f: Facts) => f.successPercent >= 98, observed: (f: Facts) => `${f.successPercent}% answered in time` },
  { id: "slow:amplification", scenario: "slow", requirement: "At most 1.5 database calls per user request", passed: (f: Facts) => f.amplification <= 1.5, observed: (f: Facts) => `${f.amplification} calls per request` },
  { id: "slow:wasted", scenario: "slow", requirement: "Less than 10% of the database's work is for requests nobody waits for any more", passed: (f: Facts) => f.wastedPercent < 10, observed: (f: Facts) => `${f.wastedPercent}% of its work wasted` },
  { id: "slow:recovers", scenario: "slow", requirement: "From 1 s after the slowdown ends, at least 99% of users are answered in time", passed: (f: Facts) => f.afterPercent >= 99, observed: (f: Facts) => `${f.afterPercent}% answered in time` },
];

export const deadlineLab: Lab = {
  id: "deadline-budget",
  version: "1",
  title: "Retries at every layer",
  summary: "A gateway and a service both retry with their own timeouts. Watch one slow database turn into a flood of calls nobody is waiting for, then fix the timeouts.",
  story: [
    "A user's request passes through a gateway, then a service, then the database. Users give up after one second. Each layer was written by a different team, and each added timeouts and retries “to be safe”.",
    "When the database slows down, each layer's retries multiply the calls of the layer above, and the database spends its scarce capacity on calls whose user has long gone.",
  ],
  unit: "resilience",
  view: { kind: "series", lines: [{ key: "callRate", label: "Database calls per second" }, { key: "workRate", label: "Database work finished per second" }, { key: "wastedRate", label: "…of which nobody was waiting" }], limit: { key: "capacity", label: "Database capacity" } },
  controls: [
    { id: "gatewayRetries", type: "number", label: "Gateway retries", help: "Extra attempts the gateway makes when the service fails or doesn't answer in time.", min: 0, max: 3, step: 1 },
    { id: "gatewayTimeoutMs", type: "number", label: "Gateway timeout", help: "How long the gateway waits for each attempt.", min: 50, max: 3000, step: 50, unit: "ms" },
    { id: "serviceRetries", type: "number", label: "Service retries", help: "Extra attempts the service makes when the database fails or doesn't answer in time.", min: 0, max: 3, step: 1 },
    { id: "serviceTimeoutMs", type: "number", label: "Service timeout", help: "How long the service waits for each database call.", min: 50, max: 3000, step: 50, unit: "ms" },
    { id: "propagate", type: "toggle", label: "Propagate the user's deadline", help: "Each hop waits no longer than the user's remaining time, starts nothing after it, and the database skips expired calls." },
  ],
  starter: { gatewayRetries: 2, gatewayTimeoutMs: 1000, serviceRetries: 2, serviceTimeoutMs: 1000, propagate: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "successPercent", label: "Answered in time (%)" },
    { key: "amplification", label: "Database calls per request" },
    { key: "wastedPercent", label: "Database work wasted (%)", bad: "above-zero" },
    { key: "skipped", label: "Expired calls skipped" },
  ],
  checks,
  prediction: {
    unit: "calls",
    answer: "amplification",
    variants: [
      { id: "two-two", question: "The gateway retries up to 2 times and the service retries up to 2 times. If every database call fails, how many database calls can one user request cause at most?", scenario: allFail, config: { gatewayRetries: 2, serviceRetries: 2 } },
      { id: "three-one", question: "The gateway retries up to 3 times and the service retries once. If every database call fails, how many database calls can one user request cause at most?", scenario: allFail, config: { gatewayRetries: 3, serviceRetries: 1 } },
      { id: "one-three", question: "The gateway retries once and the service retries up to 3 times. If every database call fails, how many database calls can one user request cause at most?", scenario: allFail, config: { gatewayRetries: 1, serviceRetries: 3 } },
    ],
  },
  questions: [
    {
      id: "one-layer",
      prompt: "Why retry at one layer only?",
      options: [
        { text: "Retries at several layers multiply: the deepest dependency sees the product of every layer's attempts, exactly when it is struggling.", correct: true, why: "Right. 3 attempts at each of 3 layers is 27 calls for one request." },
        { text: "Because retrying at the gateway is always more effective.", why: "Which layer retries matters less than that only one does, with a budget." },
        { text: "Because retries are never useful below the edge.", why: "A retry close to the failure (in the service) is often the cheapest; it just shouldn't be repeated above." },
      ],
    },
    {
      id: "deadline",
      prompt: "What does propagating the deadline change at the database?",
      options: [
        { text: "It makes the database faster.", why: "Its capacity is the same; it just stops spending it on dead requests." },
        { text: "Calls whose user has already given up are skipped instead of served, so its capacity goes to requests that can still succeed.", correct: true, why: "Right. Without the deadline, the database can't tell a live request from an abandoned one." },
        { text: "It cancels requests that are already being processed.", why: "In this model (and often in practice) work already started finishes; expired work is skipped before it starts." },
      ],
    },
    {
      id: "inner-timeout",
      prompt: "The service's timeout is 2 s and users give up after 1 s. What's the consequence?",
      options: [
        { text: "None: a longer timeout only helps.", why: "The user is gone after 1 s, so the service's second second, and any retry, serves no one." },
        { text: "The service can still be waiting, or retrying, after the user has left; inner timeouts must fit inside the caller's remaining time.", correct: true, why: "Right. Size inner timeouts from the outer deadline." },
        { text: "The gateway will wait 2 s too.", why: "The gateway has its own timeout; the problem is work continuing below it." },
      ],
    },
  ],
  explain: (f) => {
    const parts = [`${f.successPercent}% of users were answered within 1 s; the database received ${f.amplification} calls per user request.`];
    if (f.wastedPercent >= 10) parts.push(`${f.wastedPercent}% of the database's work was for calls whose service attempt or user had already given up: capacity spent on nobody.`);
    if (f.amplification > 1.5) parts.push("Retries at more than one layer multiplied the calls exactly while the database was struggling.");
    if (f.skipped) parts.push(`${f.skipped.toLocaleString("en")} calls were skipped because their deadline had passed.`);
    if (f.afterPercent < 99) parts.push(`Even a second after the slowdown ended, only ${f.afterPercent}% of new users were answered in time: the backlog of wasted calls was still in the way.`);
    return parts.join(" ");
  },
  hints: [
    "Multiply: with 2 retries at the gateway and 2 at the service, how many database calls can one request make?",
    "Keep retries at one layer. Which one is closer to the failure, and cheaper to retry from?",
    "A timeout longer than the user's 1 s keeps work going for nobody. Shorten inner timeouts, or let every hop use the time the user has left.",
  ],
  assumptions: [
    "100 users a second, each giving up after 1 s. One-way hops take 5 ms. Retries are sent at once.",
    "The database handles one call at a time, in arrival order, at 200 calls a second (60 during the slowdown). In “flaky”, 20% of calls fail immediately, chosen from a fixed seed.",
    "A caller that times out stops waiting, but the call it sent stays in the database's queue and is still served, unless deadlines are propagated and it has expired.",
    "The gateway and service have no capacity limits of their own here: only the database is scarce.",
  ],
  notModelled: [
    "Backoff between retries (see the retry-storm lab), retry budgets and circuit breakers.",
    "Cancelling work already in progress (some systems can; many can't).",
    "Latency variation, connection limits, and the cost of the retries to the gateway and service themselves.",
  ],
};

