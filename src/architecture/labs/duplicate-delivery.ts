// Lab: an at-least-once queue delivers some messages twice; the consumer awards loyalty points twice. Fixes:
// deduplicate by the event's id in the same transaction as the effect, or make the effect itself idempotent.
// Modelled: a broker with a visibility timeout (a delivered, unacknowledged message becomes visible again after it),
// two consumers, a database with transactions and a unique constraint, and one fault per scenario: a crash at a
// given point, processing slower than the visibility timeout, or a producer that published an event twice.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { ack: "before" | "after"; dedup: "none" | "memory" | "separate" | "same-tx"; key: "delivery" | "event"; effect: "increment" | "upsert"; visibilityMs: number };

const NET = 5;
const DB = 5;
const WORK = 50;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  type Msg = { delivery: string; event: string; order: number; deliveries: number; acked: boolean; visibleAt: number; inFlight: boolean };
  const queue: Msg[] = [];
  const consumers = ["consumer-1", "consumer-2"];
  const busy = new Set<string>();
  const down = new Set<string>();
  const memory: Record<string, Set<string>> = { "consumer-1": new Set(), "consumer-2": new Set() };
  const processed = new Set<string>();
  const awarded = new Map<number, number>();
  const pendingClaims = new Map<string, () => void>();
  let turn = 0;
  let deliverySeq = 0;
  let crashed = false;
  let slowed = false;

  const publish = (order: number, again = false) => {
    const msg: Msg = { delivery: `m-${++deliverySeq}`, event: `e-${order}`, order, deliveries: 0, acked: false, visibleAt: tl.now, inFlight: false };
    queue.push(msg);
    tl.log({ actor: "producer", kind: "message", to: "broker", text: `${again ? "Publishes again (its earlier attempt timed out)" : "Publishes"} OrderPlaced for order ${order}: event id ${msg.event}, broker message ${msg.delivery}.`, tone: again ? "warn" : "info", ref: `order-${order}`, data: again ? {} : { orders: 1 } });
    dispatch();
  };

  function dispatch() {
    for (const msg of queue) {
      if (msg.acked || msg.inFlight || msg.visibleAt > tl.now) continue;
      const free = consumers.map((_, i) => consumers[(turn + i) % consumers.length]).find((name) => !busy.has(name) && !down.has(name));
      if (!free) return;
      turn++;
      deliver(msg, free);
    }
  }

  function deliver(msg: Msg, consumer: string) {
    msg.inFlight = true;
    msg.deliveries++;
    busy.add(consumer);
    const deadline = tl.now + c.visibilityMs;
    msg.visibleAt = deadline;
    const ref = `order-${msg.order}`;
    tl.log({ actor: "broker", kind: "message", to: consumer, text: `Delivers ${msg.delivery} (order ${msg.order})${msg.deliveries > 1 ? `, delivery ${msg.deliveries}` : ""}; hidden from others for ${c.visibilityMs} ms unless acknowledged.`, tone: msg.deliveries > 1 ? "warn" : "info", ref, data: msg.deliveries > 1 ? { redeliveries: 1 } : {} });
    tl.at(deadline, () => {
      if (msg.acked || !msg.inFlight) return;
      msg.inFlight = false;
      tl.log({ actor: "broker", kind: "note", text: `${msg.delivery} wasn't acknowledged within ${c.visibilityMs} ms: it is visible again.`, tone: "warn", ref });
      dispatch();
    });
    tl.after(NET, () => handle(msg, consumer));
  }

  const ack = (msg: Msg, consumer: string, then?: () => void) => {
    tl.log({ actor: consumer, kind: "message", to: "broker", text: `Acknowledges ${msg.delivery}.`, tone: "info", ref: `order-${msg.order}` });
    tl.after(NET, () => {
      msg.acked = true;
      msg.inFlight = false;
      then?.();
    });
  };
  const done = (consumer: string) => {
    busy.delete(consumer);
    dispatch();
  };
  const crash = (consumer: string, msg: Msg, when: string) => {
    crashed = true;
    down.add(consumer);
    busy.delete(consumer);
    memory[consumer].clear();
    tl.log({ actor: consumer, kind: "fault", text: `${consumer} crashes ${when}. It restarts 500 ms later with empty memory.`, tone: "bad", ref: `order-${msg.order}` });
    tl.after(500, () => {
      down.delete(consumer);
      dispatch();
    });
  };

  function handle(msg: Msg, consumer: string) {
    if (down.has(consumer)) return;
    const ref = `order-${msg.order}`;
    const key = c.key === "event" ? msg.event : msg.delivery;
    const first = msg.order === p.faultOrder && !crashed;
    const afterAck = () => {
      if (c.dedup === "memory" && memory[consumer].has(key)) {
        tl.log({ actor: consumer, kind: "note", text: `Already handled ${key} (in this consumer's memory): skips it.`, tone: "good", ref });
        return finish();
      }
      if (c.dedup === "same-tx") {
        tl.log({ actor: consumer, kind: "message", to: "db", text: `BEGIN; INSERT INTO processed (id) VALUES ('${key}')`, tone: "info", ref });
        return tl.after(DB, () => claim());
      }
      if (c.dedup === "separate") {
        tl.log({ actor: consumer, kind: "message", to: "db", text: `SELECT 1 FROM processed WHERE id = '${key}'`, tone: "info", ref });
        return tl.after(DB, () => {
          if (processed.has(key)) {
            tl.log({ actor: "db", kind: "note", text: `${key} is already in processed: skip.`, tone: "good", ref });
            return finish();
          }
          tl.log({ actor: "db", kind: "note", text: `${key} not found: go ahead.`, tone: "info", ref });
          work();
        });
      }
      work();
    };
    // Same transaction: the insert either succeeds (we own the event), waits for a concurrent owner, or fails.
    const claim = () => {
      if (processed.has(key)) {
        tl.log({ actor: "db", kind: "note", text: `Duplicate key ${key}: the insert fails, the transaction rolls back. Already processed.`, tone: "good", ref });
        return finish();
      }
      if (pendingClaims.has(key)) {
        tl.log({ actor: "db", kind: "note", text: `Another transaction is inserting ${key}: this one waits for it to commit or roll back.`, tone: "info", ref });
        const previous = pendingClaims.get(key)!;
        pendingClaims.set(key, () => {
          previous();
          claim();
        });
        return;
      }
      pendingClaims.set(key, () => {});
      work();
    };
    const work = () => {
      const slow = msg.order === p.slowOrder && !slowed;
      if (slow) slowed = true;
      const ms = slow ? p.slowMs : WORK;
      if (slow) tl.log({ actor: consumer, kind: "note", text: `Processing order ${msg.order} is slow this time: ${ms} ms.`, tone: "warn", ref });
      tl.after(ms, () => {
        if (down.has(consumer)) return;
        if (first && p.crashAt === 1) {
          // The open transaction rolls back: its claim on the id goes, and anyone waiting on it tries again.
          const waiters = pendingClaims.get(key);
          pendingClaims.delete(key);
          crash(consumer, msg, "in the middle of processing, before committing anything");
          return waiters?.();
        }
        const effect = c.effect === "increment" ? `UPDATE customers SET points = points + 10 (order ${msg.order})` : `INSERT INTO awards (order_id, points) VALUES (${msg.order}, 10) ON CONFLICT DO NOTHING`;
        tl.log({ actor: consumer, kind: "message", to: "db", text: `${effect}; COMMIT${c.dedup === "same-tx" ? " (with the processed row)" : ""}`, tone: "info", ref });
        tl.after(DB, () => {
          const times = (awarded.get(msg.order) ?? 0) + 1;
          if (c.effect === "upsert" && times > 1) tl.log({ actor: "db", kind: "note", text: `Order ${msg.order} already has its award row: nothing changes.`, tone: "good", ref });
          else {
            awarded.set(msg.order, times);
            tl.log({ actor: "db", kind: "effect", text: times > 1 ? `Adds 10 points for order ${msg.order} again (${times * 10} in total).` : `Adds 10 points for order ${msg.order}.`, tone: times > 1 ? "bad" : "good", ref, data: { awards: 1, ...(times > 1 ? { duplicates: 1 } : { awarded: 1 }) } });
          }
          if (c.dedup === "same-tx") {
            processed.add(key);
            const waiters = pendingClaims.get(key);
            pendingClaims.delete(key);
            waiters?.();
          }
          if (first && p.crashAt === 2) return crash(consumer, msg, "right after committing, before recording or acknowledging anything else");
          if (c.dedup === "separate") {
            tl.log({ actor: consumer, kind: "message", to: "db", text: `INSERT INTO processed (id) VALUES ('${key}'); COMMIT (a second transaction)`, tone: "info", ref });
            return tl.after(DB, () => {
              processed.add(key);
              finish();
            });
          }
          if (c.dedup === "memory") memory[consumer].add(key);
          finish();
        });
      });
    };
    const finish = () => {
      if (c.ack === "after") ack(msg, consumer, () => done(consumer));
      else done(consumer);
    };
    if (c.ack === "before") {
      ack(msg, consumer);
      tl.after(NET, afterAck);
    } else afterAck();
  }

  const orders = p.orders ?? 3;
  for (let o = 1; o <= orders; o++) tl.at((o - 1) * 100, () => publish(o));
  if (p.republish) tl.at(p.republishAt, () => publish(p.republish, true));
  tl.drain(60_000);
  for (let o = 1; o <= orders; o++) if (!awarded.has(o)) tl.log({ actor: "db", kind: "note", text: `Order ${o} never got its points.`, tone: "bad", ref: `order-${o}`, data: { lost: 1 } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  return sumData(events, ["orders", "awards", "awarded", "duplicates", "lost", "redeliveries"]);
}

const scenarios: LabScenario[] = [
  { id: "crash-after-commit", title: "Crash after the commit", description: "The consumer handling order 2 crashes right after its database commit, before acknowledging.", seed: 1, params: { faultOrder: 2, crashAt: 2 } },
  { id: "crash-before-commit", title: "Crash mid-processing", description: "The consumer handling order 2 crashes while processing, before committing anything.", seed: 1, params: { faultOrder: 2, crashAt: 1 } },
  { id: "slow", title: "Slower than the visibility timeout", description: "Processing order 2 takes 2.5 s once (a slow database moment).", seed: 1, params: { slowOrder: 2, slowMs: 2500 } },
  { id: "republished", title: "The producer publishes twice", description: "The producer's publish of order 2 timed out, so it published the same event again: same event id, a new broker message.", seed: 1, params: { republish: 2, republishAt: 130 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:once`, scenario: s.id, requirement: "No order's points are awarded twice", passed: (f: Facts) => f.duplicates === 0, observed: (f: Facts) => (f.duplicates ? `${f.duplicates} duplicate awards` : "no duplicates") },
  { id: `${s.id}:all`, scenario: s.id, requirement: "Every order's points are awarded", passed: (f: Facts) => f.lost === 0, observed: (f: Facts) => (f.lost ? `${f.lost} order${f.lost > 1 ? "s" : ""} never awarded` : "all awarded") },
];

export const duplicateDeliveryLab: Lab = {
  id: "duplicate-delivery",
  version: "1",
  title: "Prevent duplicate order processing",
  summary: "Every order earns 10 loyalty points, awarded by a queue consumer. The queue delivers at least once, so sometimes twice. Make each order award its points exactly once.",
  story: [
    "When an order is placed, the shop publishes an OrderPlaced event. A consumer takes it from the queue, adds 10 points to the customer's account, and acknowledges the message so the queue deletes it.",
    "If the queue doesn't hear the acknowledgement in time (a crash, a slow database), it assumes the consumer died and delivers the message again. That's what “at-least-once” means: nothing is lost, but anything can arrive twice. Producers can also publish twice. The consumer has to cope.",
  ],
  unit: "messaging",
  view: { kind: "sequence", lanes: [{ id: "producer", label: "Order service" }, { id: "broker", label: "Queue" }, { id: "consumer-1", label: "Consumer 1" }, { id: "consumer-2", label: "Consumer 2" }, { id: "db", label: "Database" }] },
  controls: [
    { id: "ack", type: "select", label: "When to acknowledge", help: "Acknowledging deletes the message from the queue.", options: [
      { value: "after", label: "After processing (at-least-once)" },
      { value: "before", label: "Before processing (at-most-once)" },
    ] },
    { id: "dedup", type: "select", label: "Deduplication", help: "How the consumer recognises a message it has already handled.", options: [
      { value: "none", label: "None" },
      { value: "memory", label: "Remember ids in the consumer's memory" },
      { value: "separate", label: "Processed table: check first, record in a separate transaction after the effect" },
      { value: "same-tx", label: "Processed table: insert the id (unique) in the same transaction as the effect" },
    ] },
    { id: "key", type: "select", label: "Deduplicate by", help: "Which id identifies “the same message”.", options: [
      { value: "delivery", label: "The broker's message id" },
      { value: "event", label: "The event's own id, set by the producer" },
    ] },
    { id: "effect", type: "select", label: "The effect", help: "How the points are written.", options: [
      { value: "increment", label: "points = points + 10" },
      { value: "upsert", label: "Insert an award row keyed by order id (ignore if present)" },
    ] },
    { id: "visibilityMs", type: "number", label: "Visibility timeout", help: "How long a delivered message stays hidden from other consumers while it isn't acknowledged.", min: 500, max: 30000, step: 500, unit: "ms" },
  ],
  starter: { ack: "after", dedup: "none", key: "delivery", effect: "increment", visibilityMs: 2000 },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "orders", label: "Orders" },
    { key: "awarded", label: "Orders awarded" },
    { key: "duplicates", label: "Duplicate awards", bad: "above-zero" },
    { key: "lost", label: "Orders never awarded", bad: "above-zero" },
    { key: "redeliveries", label: "Redeliveries" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "awards",
    answer: "awards",
    variants: [
      { id: "crash", question: "3 orders. The consumer handling order 2 crashes right after committing the points, before acknowledging. How many times are points added in total?", scenario: scenarios[0] },
      { id: "slow", question: "3 orders. Processing order 2 takes 2.5 s once, and the visibility timeout is 2 s. How many times are points added in total?", scenario: scenarios[2] },
      { id: "ack-before", question: "3 orders, acknowledged before processing. The consumer handling order 2 crashes mid-processing. How many times are points added in total?", scenario: scenarios[1], config: { ack: "before" } },
    ],
  },
  questions: [
    {
      id: "same-tx",
      prompt: "Why must the processed-id insert be in the same transaction as the points update?",
      options: [
        { text: "It's faster.", why: "It saves a round trip, but that's not the reason." },
        { text: "So both commit or neither does. With two transactions, a crash between them leaves points added but the id unrecorded, and the redelivery adds them again.", correct: true, why: "Right. The record of having done the work must be atomic with the work." },
        { text: "Because the queue requires it.", why: "The queue knows nothing about your database." },
      ],
    },
    {
      id: "which-id",
      prompt: "Why deduplicate by the event's id rather than the broker's message id?",
      options: [
        { text: "A producer that publishes the same event twice creates two broker messages with different ids; only the event's own id is the same in both.", correct: true, why: "Right. The id must identify the business event, which is what must happen once." },
        { text: "The broker's id is longer.", why: "Length doesn't matter." },
        { text: "Broker ids change on every redelivery.", why: "Most brokers keep the message id across redeliveries; the problem is duplicates that are different messages." },
      ],
    },
    {
      id: "ack-before",
      prompt: "Acknowledging before processing removes every duplicate here. Why isn't it the answer?",
      options: [
        { text: "It is the answer when duplicates are worse than losses.", why: "That's true for some data (metrics you can afford to drop), but for loyalty points a lost award is a bug too." },
        { text: "It turns duplicates into losses: a crash after the acknowledgement and before the work drops the message for good.", correct: true, why: "Right. At-most-once trades duplicates for losses; most business events need at-least-once plus idempotent processing." },
        { text: "Brokers don't allow it.", why: "They do; it's the at-most-once mode." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.duplicates) parts.push(`Points were added ${f.awards} times for ${f.orders} orders: ${f.duplicates} duplicate${f.duplicates > 1 ? "s" : ""}. ${c.dedup === "none" ? "Nothing recognised the second delivery." : c.dedup === "memory" ? "The consumer that saw the first delivery forgot it in its crash, or the duplicate went to the other consumer." : c.dedup === "separate" ? "The record of processing wasn't atomic with the points: a crash or a concurrent delivery got between them." : c.key === "delivery" ? "The duplicate was a different broker message, so its id didn't match." : ""}`);
    if (f.lost) parts.push(`${f.lost} order${f.lost > 1 ? "s" : ""} never got points: the message was acknowledged before the work was done, and the work was lost in the crash.`);
    if (!parts.length) parts.push(`Every order got its points once${f.redeliveries ? `, although the queue redelivered ${f.redeliveries} time${f.redeliveries > 1 ? "s" : ""}` : ""}.`);
    return parts.join(" ");
  },
  hints: [
    "Which scenarios deliver something twice, and which lose something? Acknowledging early trades one for the other.",
    "If the consumer remembers what it processed, where does that memory live, and does it survive a crash and reach the other consumer?",
    "The record “I processed this” and the effect must commit together. And which id stays the same when the producer publishes twice? Or: can the effect itself be written so a repeat changes nothing?",
  ],
  assumptions: [
    "3 orders, published 100 ms apart; two consumers take messages in turn. One-way messages take 5 ms, database statements 5 ms, processing 50 ms.",
    "A delivered message stays hidden for the visibility timeout; if it isn't acknowledged by then, the queue delivers it again (to whichever consumer is free).",
    "A crashed consumer restarts after 500 ms with empty memory; its unacknowledged messages reappear when their visibility timeout ends.",
    "A unique constraint makes a second insert of the same id wait for the first transaction and then fail; a rollback undoes the whole transaction.",
  ],
  notModelled: [
    "Ordering between messages, partitions and consumer groups (see the hot-partition lab), and poison messages.",
    "Broker failures, lost acknowledgements, and how long processed ids must be kept.",
    "Effects outside the database (emails, card charges), which need their own idempotency.",
  ],
};
