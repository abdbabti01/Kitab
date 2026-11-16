// Lab: a retried payment request charges a card twice; idempotency keys make retries safe.
// Modelled: one order, a client that times out and retries, two API servers behind a round-robin load balancer,
// an optional idempotency store (per-server memory, shared check-then-insert, or an atomic insert with an
// in-progress lease) and a payment provider that, like real processors accepting idempotency keys, remembers a
// key and replays its first result (409 while that first request is still running).
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

const NET = { client: 40, store: 1, provider: 50 };
const PROVIDER_MS = 100;

type Config = { keyMode: "none" | "per-attempt" | "per-click" | "per-order"; store: "none" | "memory" | "check-then-insert" | "atomic"; forwardKey: boolean; retries: number; timeoutMs: number; retryDelayMs: number; leaseMs: number };

/** Why a second charge happened, decided where the API chose to call the provider (explanations only). */
const CAUSES = [
  "",
  "No idempotency key: nothing can tell this retry from a new payment.",
  "This request carried a different key from the earlier one, so it looked like a new payment. The key must name the payment, not the attempt or the click.",
  "The key was sent, but nothing checked it: the API keeps no record of keys and doesn't pass the key to the provider.",
  "The key was remembered only in the memory of the server that saw it first; this request reached the other server.",
  "Check-then-insert race: this request looked for the key before the first request had saved it, so both went ahead.",
  "The server that charged crashed before recording the result. When its in-progress lease expired, another server charged again: only the provider knew the charge had happened.",
  "The first request was still running when its in-progress lease expired, so another server took the key over and charged again. A lease must outlast the slowest legitimate request.",
] as const;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  const order = "order-1";
  const apis = ["api-1", "api-2"];
  const down = new Set<string>();
  let turn = 0;
  const memory: Record<string, Map<string, "in-progress" | "done">> = { "api-1": new Map(), "api-2": new Map() };
  const store = new Map<string, { status: "in-progress" | "done"; expires: number; owner: string }>();
  const provider = new Map<string, { status: "in-progress" | "done"; charge?: string }>();
  let charges = 0;
  let receipts = 0;
  let providerCalls = 0;
  let lost = 0;
  let firstKey: string | undefined;
  let crashed = false;

  type Sub = { s: number; ended: Set<number>; done: boolean };
  type Req = { sub: Sub; n: number; key?: string; claimed?: boolean };

  const keyFor = (s: number, n: number) =>
    c.keyMode === "per-order" ? "ord-1" : c.keyMode === "per-click" ? `click-${s + 1}` : c.keyMode === "per-attempt" ? `try-${s + 1}.${n}` : undefined;
  const pick = () => {
    const healthy = apis.filter((a) => !down.has(a));
    return healthy[turn++ % healthy.length];
  };

  function submit(s: number) {
    const sub: Sub = { s, ended: new Set(), done: false };
    tl.log({ actor: "client", kind: "note", text: s === 0 ? "The customer presses Pay for order 1 ($40)." : "The customer presses Pay again: a double click.", tone: s === 0 ? "info" : "warn", ref: order, data: s === 0 ? { orders: 1 } : {} });
    attempt(sub, 1);
  }

  function attempt(sub: Sub, n: number) {
    const key = keyFor(sub.s, n);
    firstKey ??= key;
    const api = pick();
    tl.log({ actor: "client", kind: "message", to: api, text: `POST /payments, attempt ${n}${key ? `, Idempotency-Key ${key}` : ", no key"}`, tone: n > 1 ? "warn" : "info", ref: order, data: { attempts: 1 } });
    const req: Req = { sub, n, key };
    tl.after(NET.client, () => apiReceive(api, req));
    tl.after(c.timeoutMs, () => {
      if (sub.done || sub.ended.has(n)) return;
      sub.ended.add(n);
      tl.log({ actor: "client", kind: "note", text: `No answer after ${c.timeoutMs} ms: the client stops waiting for attempt ${n}.`, tone: "warn", ref: order, data: { timeouts: 1 } });
      retryOrGiveUp(sub, n);
    });
  }

  function retryOrGiveUp(sub: Sub, n: number) {
    if (n <= c.retries) tl.after(c.retryDelayMs, () => attempt(sub, n + 1));
    else tl.log({ actor: "client", kind: "note", text: "No retries left: the customer sees “Payment failed” and doesn't know whether they were charged.", tone: "bad", ref: order, data: { gaveUp: 1 } });
  }

  function clientReceive(req: Req, status: 200 | 409) {
    const { sub, n } = req;
    if (sub.done || sub.ended.has(n)) {
      tl.log({ actor: "client", kind: "note", text: `The answer to attempt ${n} arrives after the client stopped waiting: it is ignored.`, tone: "warn", ref: order, data: { late: 1 } });
      return;
    }
    sub.ended.add(n);
    if (status === 200) {
      sub.done = true;
      tl.log({ actor: "client", kind: "note", text: "200 OK: the customer sees “Payment confirmed”.", tone: "good", ref: order, data: { confirmed: 1 } });
    } else {
      tl.log({ actor: "client", kind: "note", text: "409 Conflict: this payment is still in progress. The client will try again.", tone: "info", ref: order, data: { conflicts: 1 } });
      retryOrGiveUp(sub, n);
    }
  }

  function reply(api: string, req: Req, status: 200 | 409, text: string) {
    const lose = status === 200 && lost < (p.lostResponses ?? 0);
    if (lose) lost++;
    tl.log({ actor: api, kind: "message", to: "client", lost: lose, text: lose ? `${text}. Lost on the way: the network drops it.` : text, tone: lose ? "bad" : status === 200 ? "good" : "info", ref: order });
    if (!lose) tl.after(NET.client, () => clientReceive(req, status));
  }

  function apiReceive(api: string, req: Req) {
    const key = req.key;
    if (!key || c.store === "none") return callProvider(api, req);
    if (c.store === "memory") {
      const seen = memory[api].get(key);
      if (seen === "done") return reply(api, req, 200, `200 OK (replayed from ${api}'s memory)`);
      if (seen === "in-progress") return reply(api, req, 409, "409 Conflict (in progress here)");
      memory[api].set(key, "in-progress");
      tl.log({ actor: api, kind: "note", text: `Key ${key} is new to this server's memory: it goes ahead.`, tone: "info", ref: order });
      return callProvider(api, req);
    }
    const atomic = c.store === "atomic";
    tl.log({ actor: api, kind: "message", to: "store", text: atomic ? `INSERT key ${key} as in progress (unique)` : `SELECT key ${key}`, tone: "info", ref: order });
    tl.after(NET.store, () => {
      const rec = store.get(key);
      const expired = rec?.status === "in-progress" && rec.expires <= tl.now;
      if (rec && !expired) {
        tl.log({ actor: "store", kind: "note", text: rec.status === "done" ? `Key ${key} is already done: here is the saved result.` : atomic ? `Key ${key} already exists and is in progress: the insert fails.` : `Key ${key} found, in progress.`, tone: "info", ref: order });
        return tl.after(NET.store, () => (rec.status === "done" ? reply(api, req, 200, "200 OK (replayed saved result)") : reply(api, req, 409, "409 Conflict: in progress")));
      }
      if (atomic) {
        store.set(key, { status: "in-progress", expires: tl.now + c.leaseMs, owner: api });
        req.claimed = true;
        tl.log({ actor: "store", kind: "note", text: expired ? `Key ${key} was in progress, but its ${c.leaseMs} ms lease has expired: this request takes it over.` : `Key ${key} inserted: this request owns the payment for ${c.leaseMs} ms.`, tone: expired ? "warn" : "info", ref: order });
      } else {
        tl.log({ actor: "store", kind: "note", text: `No row for key ${key}: not found.`, tone: "info", ref: order });
      }
      tl.after(NET.store, () => callProvider(api, req, expired ? (down.has(rec!.owner) ? 6 : 7) : 0));
    });
  }

  function causeOf(req: Req, tookOver: number) {
    if (!req.key) return 1;
    if (req.key !== firstKey) return 2;
    if (c.store === "none" && !c.forwardKey) return 3;
    if (c.store === "memory") return 4;
    if (c.store === "check-then-insert") return 5;
    return tookOver || 3;
  }

  function callProvider(api: string, req: Req, tookOver = 0) {
    const pkey = c.forwardKey ? req.key : undefined;
    const cause = causeOf(req, tookOver);
    tl.log({ actor: api, kind: "message", to: "provider", text: `Charge $40${pkey ? `, Idempotency-Key ${pkey}` : ""}`, tone: "info", ref: order });
    tl.after(NET.provider, () => {
      const known = pkey ? provider.get(pkey) : undefined;
      if (known) {
        tl.log({ actor: "provider", kind: "note", text: known.status === "done" ? `Key ${pkey} already charged (${known.charge}): no new charge, the original result is returned.` : `Key ${pkey} is still being charged: 409 Conflict.`, tone: "good", ref: order });
        return tl.after(NET.provider, () => providerAnswer(api, req, known.status === "done"));
      }
      if (pkey) provider.set(pkey, { status: "in-progress" });
      const work = providerCalls++ === 0 && p.slowFirstMs ? p.slowFirstMs : PROVIDER_MS;
      tl.after(work, () => {
        charges++;
        const charge = `ch_${charges}`;
        if (pkey) provider.set(pkey, { status: "done", charge });
        const duplicate = charges > 1;
        tl.log({ actor: "provider", kind: "effect", text: duplicate ? `Charges the card $40 again (${charge}). ${CAUSES[cause]}` : `Charges the card $40 (${charge}).`, tone: duplicate ? "bad" : "good", ref: order, data: { charges: 1, ...(duplicate ? { duplicates: 1, cause } : {}) } });
        tl.after(NET.provider, () => providerAnswer(api, req, true));
      });
    });
  }

  function providerAnswer(api: string, req: Req, ok: boolean) {
    if (down.has(api)) return;
    if (p.crashAfterCharge && !crashed && ok) {
      crashed = true;
      down.add(api);
      memory[api].clear();
      tl.log({ actor: api, kind: "fault", text: `${api} crashes after the provider charged, before saving the result or answering. The load balancer stops sending to it.`, tone: "bad", ref: order });
      return;
    }
    const key = req.key;
    if (!ok) {
      // The provider is still working on the first request: give up this claim, so a later retry can ask again.
      if (key && c.store === "memory") memory[api].delete(key);
      if (key && req.claimed) store.delete(key);
      return reply(api, req, 409, "409 Conflict: the provider is still charging this payment");
    }
    if (!key || c.store === "none") return finish(api, req);
    if (c.store === "memory") {
      memory[api].set(key, "done");
      return finish(api, req);
    }
    tl.log({ actor: api, kind: "message", to: "store", text: c.store === "atomic" ? `UPDATE key ${key}: done, save the response` : `INSERT key ${key}: done, save the response`, tone: "info", ref: order });
    tl.after(NET.store, () => {
      store.set(key, { status: "done", expires: Infinity, owner: api });
      tl.after(NET.store, () => finish(api, req));
    });
  }

  /** The API's own side effect: a receipt email, sent each time this code path completes a payment. */
  function finish(api: string, req: Req) {
    receipts++;
    tl.log({ actor: api, kind: "effect", text: receipts > 1 ? `Emails Ana a receipt again (receipt ${receipts}): the API didn't recognise this repeat.` : "Emails Ana a receipt.", tone: receipts > 1 ? "bad" : "good", ref: order, data: { receipts: 1 } });
    reply(api, req, 200, "200 OK, payment confirmed");
  }

  tl.at(0, () => submit(0));
  if (p.doubleClickMs) tl.at(p.doubleClickMs, () => submit(1));
  return tl.drain();
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["orders", "charges", "receipts", "duplicates", "confirmed", "attempts", "conflicts", "timeouts", "late", "gaveUp"]);
  const firstCause = events.find((e) => e.data?.cause)?.data?.cause ?? 0;
  const confirmedOrders = Math.min(f.orders, f.confirmed);
  return { ...f, cause: firstCause, unconfirmed: f.orders - confirmedOrders };
}

const scenario = (id: string, title: string, description: string, params: Record<string, number>): LabScenario => ({ id, title, description, seed: 1, params });

const scenarios = [
  scenario("lost-response", "The answer is lost", "The provider charges the card, but the API's “200 OK” to the customer's app is dropped by the network.", { lostResponses: 1 }),
  scenario("slow-provider", "The provider is slow", "The provider takes 1.5 s to answer the first charge, longer than the app waits.", { slowFirstMs: 1500 }),
  scenario("double-click", "A double click", "The customer presses Pay twice, 80 ms apart.", { doubleClickMs: 80 }),
  scenario("crash", "A server crashes mid-payment", "The API server handling the first attempt crashes after the provider charged, before saving or answering.", { crashAfterCharge: 1 }),
];

const pair = (s: LabScenario) => [
  { id: `${s.id}:once`, scenario: s.id, requirement: "The card is charged exactly once", passed: (f: Facts) => f.charges === 1, observed: (f: Facts) => `charged ${f.charges} ${f.charges === 1 ? "time" : "times"}` },
  { id: `${s.id}:receipt`, scenario: s.id, requirement: "Ana gets one receipt", passed: (f: Facts) => f.receipts === 1, observed: (f: Facts) => `${f.receipts} ${f.receipts === 1 ? "receipt" : "receipts"}` },
  { id: `${s.id}:confirmed`, scenario: s.id, requirement: "The customer sees the payment confirmed", passed: (f: Facts) => f.unconfirmed === 0, observed: (f: Facts) => (f.unconfirmed === 0 ? "confirmed" : f.gaveUp ? "the customer saw “Payment failed”" : "never confirmed") },
];

export const idempotencyLab: Lab = {
  id: "idempotent-payments",
  version: "1",
  title: "Build an idempotent payment API",
  summary: "A customer's payment request times out and the app retries. Find out when the card is charged twice, then make every retry safe.",
  story: [
    "Ana presses Pay. Her app sends the payment to your API, which asks the card provider to charge $40. If no answer comes back within a second, the app tries again: networks drop packets and servers restart, and the app can't tell “never arrived” from “arrived, but the answer got lost”.",
    "Retrying is the right instinct: without it, Ana sees an error for a payment that may have gone through. But each retry is a new request, and unless something recognises it as the same payment, it charges her again.",
  ],
  unit: "idempotency",
  view: { kind: "sequence", lanes: [{ id: "client", label: "Ana's app" }, { id: "api-1", label: "API server 1" }, { id: "api-2", label: "API server 2" }, { id: "store", label: "Key store" }, { id: "provider", label: "Card provider" }] },
  controls: [
    { id: "keyMode", type: "select", label: "Idempotency key", help: "A unique value sent with the request so a server can recognise a repeat.", options: [
      { value: "none", label: "No key" },
      { value: "per-attempt", label: "New key for every attempt" },
      { value: "per-click", label: "New key every time Pay is pressed" },
      { value: "per-order", label: "One key per order, created with the order" },
    ] },
    { id: "store", type: "select", label: "Where the API records keys", help: "How the API remembers which keys it has handled, and their results.", options: [
      { value: "none", label: "Nowhere" },
      { value: "memory", label: "In each server's memory" },
      { value: "check-then-insert", label: "Shared database: look up, charge, then save" },
      { value: "atomic", label: "Shared database: insert the key first (unique), then charge" },
    ] },
    { id: "forwardKey", type: "toggle", label: "Pass the key on to the card provider", help: "The provider then recognises a repeat of the same charge, as real processors that accept idempotency keys do." },
    { id: "retries", type: "number", label: "Retries", help: "Extra attempts after the first one fails or times out.", min: 0, max: 3, step: 1 },
    { id: "timeoutMs", type: "number", label: "Client timeout", help: "How long the app waits for each attempt's answer.", min: 500, max: 5000, step: 100, unit: "ms" },
    { id: "retryDelayMs", type: "number", label: "Wait before retrying", help: "Pause between a failed attempt and the next one.", min: 100, max: 3000, step: 100, unit: "ms" },
    { id: "leaseMs", type: "number", label: "In-progress lease", help: "With an atomic insert: how long a claimed key stays “in progress” before another request may take it over (in case its server died).", min: 500, max: 30000, step: 500, unit: "ms" },
  ],
  starter: { keyMode: "none", store: "none", forwardKey: false, retries: 2, timeoutMs: 1000, retryDelayMs: 300, leaseMs: 30000 },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "charges", label: "Card charges" },
    { key: "duplicates", label: "Duplicate charges", bad: "above-zero" },
    { key: "attempts", label: "Requests sent" },
    { key: "conflicts", label: "409 answers" },
    { key: "unconfirmed", label: "Orders not confirmed", bad: "above-zero" },
  ],
  checks: scenarios.flatMap(pair),
  prediction: {
    unit: "charges",
    answer: "charges",
    variants: [
      { id: "lost-1", question: "The app retries up to 2 times. The answer to the first attempt is lost. How many times is Ana's card charged?", scenario: scenarios[0] },
      { id: "lost-2", question: "The app retries up to 3 times. The answers to the first two attempts are lost. How many times is Ana's card charged?", scenario: { ...scenarios[0], id: "lost-twice", params: { lostResponses: 2 } }, config: { retries: 3 } },
      { id: "slow", question: "The provider takes 1.5 s on the first charge; the app waits 1 s per attempt and retries up to 2 times. How many times is Ana's card charged?", scenario: scenarios[1] },
    ],
  },
  questions: [
    {
      id: "exactly-once",
      prompt: "Your API now claims keys atomically and passes them to the provider. Does each payment request now run exactly once?",
      options: [
        { text: "Yes: idempotency keys give exactly-once execution.", why: "Not quite. Retries still arrive and are still processed; nothing can stop a client from sending a repeat it believes is needed." },
        { text: "No: repeats still arrive and are handled, but they replay the first result instead of charging again. The effect happens once.", correct: true, why: "Right. Idempotency makes repeats harmless, it doesn't prevent them. “Exactly once” describes the effect, not the number of executions." },
        { text: "Only if the network never loses a response.", why: "The design is meant for exactly that case: a lost response leads to a retry, which now replays the saved result." },
      ],
    },
    {
      id: "key-scope",
      prompt: "Why create the key with the order, rather than when each request is sent?",
      options: [
        { text: "Keys made per request are more likely to collide.", why: "Collisions aren't the issue; random keys of either kind practically never collide." },
        { text: "The key names the customer's intent: this payment. Everything sent for that intent (retries, a double click, a page reload) must carry the same key.", correct: true, why: "Right. A key made per attempt or per click turns each repeat into a new payment, which is the bug you're preventing." },
        { text: "It makes the request smaller.", why: "Size is unchanged: it's one header either way." },
      ],
    },
    {
      id: "check-then-insert",
      prompt: "A teammate suggests: “Look up the key; if it isn't there, charge, then save it.” What goes wrong?",
      options: [
        { text: "Nothing, as long as the database is shared.", why: "A shared database isn't enough: two requests can both look before either one saves." },
        { text: "Two requests can both find no key and both charge. Claim the key atomically first (an insert with a unique constraint), then do the work.", correct: true, why: "Right. Check-then-act is a race; a unique constraint makes the claim and the check one indivisible step." },
        { text: "It is too slow, because it reads the database twice.", why: "The extra read is cheap; the problem is correctness under concurrent requests." },
      ],
    },
    {
      id: "when-not",
      prompt: "Which request needs no idempotency key to be retried safely?",
      options: [
        { text: "PUT /users/7/name with “Ana”: setting a value again leaves the same result.", correct: true, why: "Right. Setting a value to a given state is naturally idempotent. Keys are for operations whose repeat changes something: charges, transfers, sending messages." },
        { text: "POST /transfers moving $50.", why: "Repeating a transfer moves another $50: it needs a key." },
        { text: "POST /messages sending an SMS.", why: "Each repeat sends another SMS: it needs a key (or the provider's deduplication)." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.duplicates > 0) parts.push(`The card was charged ${f.charges} times for one order. ${CAUSES[f.cause] ?? ""}`);
    else if (f.receipts > 1) parts.push(`The provider recognised the repeat and charged once, but the API emailed ${f.receipts} receipts: its own side effects ran again. Only the API can recognise repeats of its own work, so it needs its own record of the key.`);
    if (f.unconfirmed > 0) parts.push(c.retries === 0 ? "With no retries, one lost or slow answer leaves Ana with an error and no idea whether she paid." : f.conflicts > 0 ? "Every retry found the payment still “in progress”, until the app ran out of retries. A claim whose owner has died must be recoverable: a shorter lease, and a key the provider can recognise, let a later request finish the payment safely." : "Ana never saw a confirmation.");
    if (!parts.length) parts.push(f.attempts > 1 ? `Charged once and confirmed, although the app sent ${f.attempts} requests: the repeats were recognised and answered with the first result.` : "Charged once and confirmed, with a single request.");
    return parts.join(" ");
  },
  hints: [
    "First give every repeat of the same payment the same key. What identifies “the same payment”: the attempt, the click, or the order?",
    "Something must check the key. A server's memory isn't shared with the other server, and a look-up followed later by a save leaves a gap.",
    "Insert the key before charging, so the second request finds it at once. Then ask: what if the server that inserted it dies after charging? Who still knows the charge happened?",
  ],
  assumptions: [
    "One order of $40, two API servers behind a round-robin load balancer that stops using a crashed server at once.",
    "Fixed one-way delays: 40 ms app↔API, 1 ms API↔key store, 50 ms API↔provider. The provider takes 100 ms per charge (1.5 s for the first one in “The provider is slow”).",
    "The key store is a shared, durable database. “Memory” is per server and is lost if the server crashes.",
    "A provider given a key remembers it and replays the original result; a request with a key still being charged gets 409. Real processors that accept idempotency keys behave this way.",
    "When the app stops waiting it abandons that attempt: a late answer is ignored. A 409 counts as a failed attempt and is retried.",
  ],
  notModelled: [
    "A key reused with a different amount (real APIs refuse it by comparing a fingerprint of the request).",
    "How long keys are kept, the key store itself failing, or a network split between the API and its store.",
    "Refunds, currencies, fraud checks, authentication, and any other order in the same run.",
  ],
};
