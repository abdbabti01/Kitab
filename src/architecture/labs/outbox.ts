// Lab: an order service writes the order to its database and publishes OrderPlaced to a broker. Two separate
// systems can't commit together: a crash or failure between them loses the event or publishes a ghost. The
// transactional outbox (or change data capture) makes publication follow the commit, at least once.
// Modelled: three orders; a database with transactions; a broker that can be unavailable; a relay that polls the
// outbox table (or, for CDC, tails the commit log) and marks rows sent after publishing; a shipping consumer that
// creates a shipment per event, optionally deduplicating by event id in its own transaction.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { strategy: "after-commit" | "before-commit" | "outbox" | "cdc"; pollMs: number; dedup: boolean };

const NET = 5;
const DB = 5;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  const committed = new Set<number>();
  const shipped = new Map<number, number>();
  const seen = new Set<string>();
  const outbox: { order: number; sent: boolean; committedAt: number }[] = [];
  const brokerDown = (t: number) => t >= (p.brokerDownFrom ?? Infinity) && t < (p.brokerDownTo ?? -1);
  let relayCrashed = false;
  let relayUp = true;

  const ship = (order: number, eventAt: number) => {
    const ref = `order-${order}`;
    tl.log({ actor: "broker", kind: "message", to: "shipping", text: `Delivers OrderPlaced for order ${order} (event e-${order}).`, tone: "info", ref });
    tl.after(NET, () => {
      if (c.dedup && seen.has(`e-${order}`)) {
        tl.log({ actor: "shipping", kind: "note", text: `Already processed e-${order}: ignored.`, tone: "good", ref });
        return;
      }
      if (c.dedup) seen.add(`e-${order}`);
      const n = (shipped.get(order) ?? 0) + 1;
      shipped.set(order, n);
      const delay = Math.max(0, tl.now - eventAt);
      tl.log({ actor: "shipping", kind: "effect", text: n > 1 ? `Creates a second shipment for order ${order}.` : committed.has(order) ? `Creates a shipment for order ${order}, ${delay} ms after the order was committed.` : `Creates a shipment for order ${order}; the order hasn't committed yet.`, tone: n > 1 ? "bad" : "good", ref, data: { shipments: 1, ...(n > 1 ? { duplicates: 1 } : { shippedOrders: 1, delay }) } });
    });
  };

  const publish = (order: number, from: string, eventAt: number, onDone: (ok: boolean) => void) => {
    const ref = `order-${order}`;
    tl.log({ actor: from, kind: "message", to: "broker", text: `Publish OrderPlaced for order ${order}.`, tone: "info", ref, lost: brokerDown(tl.now) });
    tl.after(NET, () => {
      if (brokerDown(tl.now)) {
        tl.log({ actor: from, kind: "note", text: `The broker is unavailable: the publish fails.`, tone: "bad", ref });
        return onDone(false);
      }
      ship(order, eventAt);
      onDone(true);
    });
  };

  function place(order: number) {
    const ref = `order-${order}`;
    const crashHere = order === p.faultOrder && p.crashAfterCommit;
    const commitFails = order === p.faultOrder && p.commitFails;
    tl.log({ actor: "orders", kind: "note", text: `Order ${order} is placed.`, tone: "info", ref, data: { attempted: 1 } });
    const commit = (withOutbox: boolean, then: (ok: boolean) => void) => {
      tl.log({ actor: "orders", kind: "message", to: "db", text: withOutbox ? `BEGIN; INSERT order ${order}; INSERT outbox row (OrderPlaced e-${order}); COMMIT` : `BEGIN; INSERT order ${order}; COMMIT`, tone: "info", ref });
      tl.after(DB, () => {
        if (commitFails) {
          tl.log({ actor: "db", kind: "note", text: `The commit fails (a deadlock victim): order ${order} is rolled back. The customer is told to try again.`, tone: "warn", ref });
          return then(false);
        }
        committed.add(order);
        if (withOutbox) outbox.push({ order, sent: false, committedAt: tl.now });
        tl.log({ actor: "db", kind: "note", text: `Order ${order} committed.`, tone: "info", ref, data: { committed: 1 } });
        then(true);
      });
    };
    if (c.strategy === "before-commit") {
      return publish(order, "orders", tl.now, (sent) => {
        if (sent) return commit(false, () => {});
        tl.log({ actor: "orders", kind: "note", text: `The publish failed, so order ${order} isn't saved: the customer is told to try again.`, tone: "warn", ref });
      });
    }
    if (c.strategy === "after-commit") {
      return commit(false, (ok) => {
        if (!ok) return;
        if (crashHere) return tl.log({ actor: "orders", kind: "fault", text: "The order service crashes after the commit, before publishing.", tone: "bad", ref });
        publish(order, "orders", tl.now, (sent) => {
          if (!sent) tl.log({ actor: "orders", kind: "note", text: `Order ${order} is saved, but its event is gone: nothing will retry it.`, tone: "bad", ref });
        });
      });
    }
    commit(true, () => {
      if (crashHere) tl.log({ actor: "orders", kind: "fault", text: "The order service crashes after the commit. The event is safe in the outbox table.", tone: "warn", ref });
    });
  }

  /** The relay: polls the outbox (or tails the log), publishes unsent rows in order, then marks them sent. */
  let relayBusy = false;
  function relayTick() {
    if (!relayUp || relayBusy) return;
    relayBusy = true;
    const pending = outbox.filter((r) => !r.sent && r.committedAt <= tl.now);
    const next = () => {
      const row = pending.shift();
      if (!row) return void (relayBusy = false);
      publish(row.order, "relay", row.committedAt, (ok) => {
        if (!ok) return void (relayBusy = false);
        if (p.relayCrash && !relayCrashed && row.order === p.faultOrder) {
          relayCrashed = true;
          relayUp = false;
          relayBusy = false;
          tl.log({ actor: "relay", kind: "fault", text: `The relay crashes after publishing order ${row.order}, before marking it sent. It restarts 500 ms later and publishes it again.`, tone: "bad", ref: `order-${row.order}` });
          tl.after(500, () => {
            relayUp = true;
            relayTick();
          });
          return;
        }
        tl.after(DB, () => {
          row.sent = true;
          next();
        });
      });
    };
    next();
  }

  const orders = 3;
  for (let o = 1; o <= orders; o++) tl.at((o - 1) * 200, () => place(o));
  if (c.strategy === "outbox" || c.strategy === "cdc") {
    // CDC reads the commit log as it's written (a few ms); the poller looks every poll interval.
    const every = c.strategy === "cdc" ? 20 : c.pollMs;
    for (let t = every; t < 8000; t += every) tl.at(t, relayTick);
  }
  if (p.brokerDownFrom !== undefined) {
    tl.at(p.brokerDownFrom, () => tl.log({ actor: "broker", kind: "fault", text: `The broker is unavailable until ${(p.brokerDownTo / 1000).toFixed(1)} s.`, tone: "bad" }));
    tl.at(p.brokerDownTo, () => tl.log({ actor: "broker", kind: "note", text: "The broker is back.", tone: "info" }));
  }
  tl.drain(20_000);
  for (const order of shipped.keys()) if (!committed.has(order)) tl.log({ actor: "shipping", kind: "note", text: `Order ${order} was shipped, but it never committed: a shipment for an order that doesn't exist.`, tone: "bad", ref: `order-${order}`, data: { ghosts: 1, shippedOrders: -1 } });
  for (const order of committed) if (!shipped.has(order)) tl.log({ actor: "shipping", kind: "note", text: `Order ${order} was committed but never shipped.`, tone: "bad", ref: `order-${order}`, data: { missing: 1 } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["attempted", "committed", "shipments", "shippedOrders", "ghosts", "duplicates", "missing"]);
  const delays = events.filter((e) => e.data?.delay !== undefined).map((e) => e.data!.delay);
  return { ...f, maxDelay: delays.length ? Math.max(...delays) : 0 };
}

const scenarios: LabScenario[] = [
  { id: "crash", title: "Crash after the commit", description: "The order service crashes right after committing order 2.", seed: 1, params: { faultOrder: 2, crashAfterCommit: 1 } },
  { id: "commit-fails", title: "The commit fails", description: "Order 2's transaction is chosen as a deadlock victim and rolled back.", seed: 1, params: { faultOrder: 2, commitFails: 1 } },
  { id: "broker-down", title: "The broker is down", description: "The broker is unavailable from 150 ms to 1.2 s.", seed: 1, params: { brokerDownFrom: 150, brokerDownTo: 1200 } },
  { id: "relay-crash", title: "The relay crashes", description: "The relay crashes after publishing order 2, before marking it sent.", seed: 1, params: { faultOrder: 2, relayCrash: 1 } },
];

const checksFor = (s: LabScenario) => [
  ...(s.id === "broker-down" ? [{ id: "broker-down:accepted", scenario: s.id, requirement: "Customers can still place orders while the broker is down", passed: (f: Facts) => f.committed === f.attempted, observed: (f: Facts) => `${f.committed} of ${f.attempted} orders accepted` }] : []),
  { id: `${s.id}:shipped`, scenario: s.id, requirement: "Every committed order is shipped", passed: (f: Facts) => f.missing === 0, observed: (f: Facts) => (f.missing ? `${f.missing} committed order${f.missing > 1 ? "s" : ""} never shipped` : "all shipped") },
  { id: `${s.id}:ghost`, scenario: s.id, requirement: "Nothing is shipped for an order that doesn't exist", passed: (f: Facts) => f.ghosts === 0, observed: (f: Facts) => (f.ghosts ? `${f.ghosts} shipment for a rolled-back order` : "no ghost shipments") },
  { id: `${s.id}:once`, scenario: s.id, requirement: "No order is shipped twice", passed: (f: Facts) => f.duplicates === 0, observed: (f: Facts) => (f.duplicates ? `${f.duplicates} duplicate shipment` : "no duplicates") },
  { id: `${s.id}:prompt`, scenario: s.id, requirement: "Shipping hears of each order within 2 s of its commit", passed: (f: Facts) => f.maxDelay <= 2000, observed: (f: Facts) => `slowest ${f.maxDelay.toLocaleString("en")} ms` },
];

export const outboxLab: Lab = {
  id: "outbox",
  version: "1",
  title: "Design a reliable event publication workflow",
  summary: "The order service saves an order and publishes an event. Crash between the two and shipping never hears of it; publish first and a rolled-back order still ships. Make publication follow the commit, exactly as often as needed.",
  story: [
    "Placing an order is two writes to two systems: the order row in the service's database, and an OrderPlaced event on the broker that tells shipping. No transaction spans both.",
    "Publish after committing, and a crash in between leaves an order nobody ships. Publish before committing, and a failed commit leaves a shipment for an order that doesn't exist. This is the dual-write problem.",
  ],
  unit: "data-across-services",
  view: { kind: "sequence", lanes: [{ id: "orders", label: "Order service" }, { id: "db", label: "Orders database" }, { id: "relay", label: "Outbox relay" }, { id: "broker", label: "Broker" }, { id: "shipping", label: "Shipping" }] },
  controls: [
    { id: "strategy", type: "select", label: "How the event is published", help: "When and by whom OrderPlaced is sent.", options: [
      { value: "after-commit", label: "The service publishes after committing (dual write)" },
      { value: "before-commit", label: "The service publishes, then commits (dual write)" },
      { value: "outbox", label: "Transactional outbox: insert the event in the same transaction; a relay polls and publishes" },
      { value: "cdc", label: "Change data capture: a connector tails the database's log and publishes outbox rows" },
    ] },
    { id: "pollMs", type: "number", label: "Relay poll interval", help: "How often the outbox relay looks for unsent rows.", min: 50, max: 10000, step: 50, unit: "ms" },
    { id: "dedup", type: "toggle", label: "Shipping deduplicates by event id", help: "Shipping records processed event ids in the same transaction as the shipment (an inbox)." },
  ],
  starter: { strategy: "after-commit", pollMs: 5000, dedup: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "committed", label: "Orders committed" },
    { key: "shippedOrders", label: "Orders shipped" },
    { key: "missing", label: "Committed, never shipped", bad: "above-zero" },
    { key: "ghosts", label: "Ghost shipments", bad: "above-zero" },
    { key: "duplicates", label: "Duplicate shipments", bad: "above-zero" },
    { key: "maxDelay", label: "Slowest to ship (ms)" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "shipments",
    answer: "shipments",
    variants: [
      { id: "crash", question: "3 orders. The service publishes after committing, and crashes right after committing order 2. How many shipments are created?", scenario: scenarios[0] },
      { id: "before", question: "3 orders. The service publishes before committing, and order 2's commit fails. How many shipments are created?", scenario: scenarios[1], config: { strategy: "before-commit" } },
      { id: "relay", question: "3 orders through an outbox relay (polling every 100 ms) that crashes after publishing order 2 and before marking it sent. Shipping doesn't deduplicate. How many shipments are created?", scenario: scenarios[3], config: { strategy: "outbox", pollMs: 100 } },
    ],
  },
  questions: [
    {
      id: "why-outbox",
      prompt: "Why does the outbox fix the dual-write problem?",
      options: [
        { text: "Because the relay is more reliable than the service.", why: "The relay can crash too; what matters is what it reads." },
        { text: "The event is written in the same database transaction as the order, so both exist or neither does; the relay then only has to publish what's committed, and can retry until it succeeds.", correct: true, why: "Right. One atomic write, then at-least-once delivery from a durable record." },
        { text: "Because the broker becomes transactional.", why: "The broker is unchanged; the transaction is the database's." },
      ],
    },
    {
      id: "duplicates",
      prompt: "With the outbox in place, why must shipping still deduplicate?",
      options: [
        { text: "It doesn't: the outbox guarantees exactly-once.", why: "The relay can publish and crash before marking the row sent; it publishes again on restart." },
        { text: "The relay publishes at least once: a crash between publishing and marking the row sent republishes it.", correct: true, why: "Right. Outbox (and CDC) give at-least-once publication; consumers need an inbox or idempotent effects." },
        { text: "Because the broker reorders events.", why: "Ordering is a separate concern; duplicates come from the relay's retry." },
      ],
    },
    {
      id: "poll",
      prompt: "What does a relay that polls every 5 s cost, and how do teams avoid it?",
      options: [
        { text: "Events reach consumers up to 5 s after the commit. Poll more often (more database load), or use change data capture, which reads the log as it's written.", correct: true, why: "Right. Polling trades latency for load; CDC removes the trade at the cost of running a connector." },
        { text: "Events are lost if they wait longer than the poll interval.", why: "They wait in the table; nothing is lost, only delayed." },
        { text: "Nothing: polling interval doesn't matter.", why: "It sets the publication delay." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.missing) parts.push(`${f.missing} committed order${f.missing > 1 ? " was" : " was"} never shipped: the event was ${c.strategy === "after-commit" ? "meant to be sent after the commit, by a process that crashed or couldn't reach the broker; nothing retries it" : "never published"}.`);
    if (f.ghosts) parts.push(`Shipping created a shipment for an order that was rolled back: the event was published before the commit, and can't be taken back.`);
    if (f.duplicates) parts.push(`An order was shipped twice: the relay republished an event it had already sent, and shipping didn't recognise it.`);
    if (f.maxDelay > 2000) parts.push(`The slowest order reached shipping ${f.maxDelay.toLocaleString("en")} ms after its commit: the relay only looks every ${c.pollMs} ms.`);
    if (!parts.length) parts.push(`Every committed order was shipped once, nothing else was, and the slowest took ${f.maxDelay} ms.`);
    return parts.join(" ");
  },
  hints: [
    "Two systems, two commits: what's in each one if the process dies between them?",
    "What if the event were just another row, written in the same transaction as the order? Then something else can publish it, and retry.",
    "Whatever publishes from the table can crash after publishing and before noting it: who has to cope with that? And how long do events wait in the table?",
  ],
  assumptions: [
    "3 orders, 200 ms apart. Database statements take 5 ms, messages 5 ms.",
    "A crashed order service loses whatever it hadn't done yet; nothing in it retries a failed publish.",
    "The relay publishes unsent outbox rows in order and marks each sent after the broker accepts it; a failed publish is tried again at the next poll. CDC sees each commit within 20 ms.",
    "Shipping's deduplication commits the event id with the shipment, so it is exact.",
  ],
  notModelled: [
    "Ordering across several relay instances, outbox table growth and cleanup.",
    "The broker losing an accepted event (assumed durable).",
    "What the customer sees when a commit fails (here they're told to try again).",
  ],
};
