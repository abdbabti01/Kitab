// Lab: one huge merchant overloads the partition its key hashes to; the choice of partition key decides both load
// balance and which events stay in order.
// Modelled: a topic with N partitions; producers choose a partition by hashing the record key (FNV-1a) modulo N;
// a consumer group whose consumers each process a fixed number of events per second, partitions assigned
// round-robin (a partition is read by one consumer; extra consumers sit idle); each order produces three events
// that must be processed in order. Ten-millisecond steps; which merchant each order belongs to comes from the seed.
import { prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { key: "merchant" | "order" | "random" | "merchant-salt" | "merchant-bucket"; partitions: number; consumers: number; buckets: number };

const STEP = 10;
const BUCKET = 250;
const DURATION = 8000;
const PER_CONSUMER = 300;
const MERCHANTS = 400;
const GAP = 40;

/** FNV-1a, as a stand-in for a producer's key hash. */
function hash(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const events: LabEvent[] = [];
  type Rec = { order: number; seq: number; at: number };
  const parts: Rec[][] = Array.from({ length: c.partitions }, () => []);
  const heads = new Array(c.partitions).fill(0);
  const owner = (part: number) => part % Math.min(c.consumers, c.partitions);
  const pending: { at: number; part: number; rec: Rec }[] = [];
  const lastSeq = new Map<number, number>();
  const violated = new Set<number>();
  let orders = 0;
  let produced = 0;
  let processed = 0;
  let maxLag = 0;
  let worstPartition = 0;
  let bucket = { produced: 0, processed: 0, lagMs: 0, hotLagMs: 0, violations: 0 };
  const loads = new Array(c.partitions).fill(0);
  let credit = 0;

  const partitionOf = (merchant: number, order: number) => {
    const key =
      c.key === "merchant" ? `m${merchant}`
      : c.key === "order" ? `o${order}`
      : c.key === "merchant-salt" ? `m${merchant}#${Math.floor(random() * c.buckets)}`
      : c.key === "merchant-bucket" ? `m${merchant}#${hash(`o${order}`) % c.buckets}`
      : null;
    return key === null ? Math.floor(random() * c.partitions) : hash(key) % c.partitions;
  };

  const ordersPerStep = (p.ordersPerS * STEP) / 1000;
  for (let t = 0; t < DURATION + 4000; t += STEP) {
    if (t < DURATION) {
      credit += ordersPerStep;
      while (credit >= 1) {
        credit -= 1;
        const order = ++orders;
        const merchant = random() < p.hotShare ? 0 : 1 + Math.floor(random() * MERCHANTS);
        // Three events per order (authorised, captured, settled). With a random or salted key each one picks its
        // own partition; otherwise all three share it.
        for (let seq = 0; seq < 3; seq++) pending.push({ at: t + seq * GAP, part: partitionOf(merchant, order), rec: { order, seq, at: t + seq * GAP } });
      }
    }
    // Records reach their partitions at their time.
    for (let i = 0; i < pending.length; ) {
      if (pending[i].at <= t) {
        parts[pending[i].part].push(pending[i].rec);
        loads[pending[i].part]++;
        produced++;
        bucket.produced++;
        pending[i] = pending[pending.length - 1];
        pending.pop();
      } else i++;
    }
    // Each consumer works through its partitions in turn, up to its capacity.
    const active = Math.min(c.consumers, c.partitions);
    for (let consumer = 0; consumer < active; consumer++) {
      let budget = (PER_CONSUMER * STEP) / 1000;
      const mine = parts.map((_, i) => i).filter((i) => owner(i) === consumer);
      let progress = true;
      while (budget >= 1 && progress) {
        progress = false;
        for (const part of mine) {
          if (budget < 1) break;
          if (heads[part] >= parts[part].length) continue;
          const rec = parts[part][heads[part]++];
          budget -= 1;
          progress = true;
          processed++;
          bucket.processed++;
          const last = lastSeq.get(rec.order) ?? -1;
          if (rec.seq < last && !violated.has(rec.order)) {
            violated.add(rec.order);
            bucket.violations++;
          }
          lastSeq.set(rec.order, Math.max(last, rec.seq));
        }
      }
      // Carry fractional capacity is ignored: 300 per second is exactly 3 per step.
    }
    // Lag: the age of the oldest unprocessed record in each partition.
    for (let part = 0; part < c.partitions; part++) {
      const head = parts[part][heads[part]];
      const lag = head ? t + STEP - head.at : 0;
      if (lag > bucket.lagMs) bucket.lagMs = lag;
      if (lag > maxLag) {
        maxLag = lag;
        worstPartition = part;
      }
      if (heads[part] > 2000) {
        parts[part].splice(0, heads[part]);
        heads[part] = 0;
      }
    }
    if ((t + STEP) % BUCKET === 0) {
      events.push({ i: 0, t: t + STEP - BUCKET, actor: "group", kind: "tick", tone: bucket.lagMs > 1000 ? "bad" : "info", text: `${bucket.produced * 4} events/s in, ${bucket.processed * 4} events/s processed; the most-behind partition is ${(bucket.lagMs / 1000).toFixed(2)} s behind.${bucket.violations ? ` ${bucket.violations} orders processed out of order.` : ""}`, data: { ...bucket, inRate: bucket.produced * 4, outRate: bucket.processed * 4, lagS: Math.round(bucket.lagMs / 10) / 100, limit: 1 } });
      bucket = { produced: 0, processed: 0, lagMs: 0, hotLagMs: 0, violations: 0 };
    }
  }
  const busiest = Math.max(...loads);
  events.push({ i: 0, t: DURATION + 4000, actor: "group", kind: "note", tone: "info", text: `Totals: ${orders.toLocaleString("en")} orders, ${produced.toLocaleString("en")} events. The busiest partition received ${Math.round((busiest / produced) * 100)}% of all events (an even share would be ${Math.round(100 / c.partitions)}%). ${c.consumers > c.partitions ? `${c.consumers - c.partitions} consumers had no partition and sat idle.` : ""}`, data: { orders, maxLag, busiestShare: Math.round((busiest / Math.max(1, produced)) * 100), idle: Math.max(0, c.consumers - c.partitions), consumers: c.consumers, unprocessed: produced - processed, worstPartition } });
  return events.map((e, i) => ({ ...e, i }));
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["orders", "violations", "idle", "consumers", "busiestShare", "unprocessed"]);
  const lag = Math.max(0, ...events.map((e) => e.data?.lagMs ?? 0));
  return { ...f, maxLagMs: lag, maxLagS: Math.round(lag / 10) / 100 };
}

const scenarios: LabScenario[] = [
  { id: "normal", title: "A normal day", description: "600 orders a second; one large merchant accounts for 30% of them.", seed: 31, params: { ordersPerS: 600, hotShare: 0.3 } },
  { id: "sale", title: "The big merchant's sale", description: "800 orders a second; the large merchant now accounts for 50%.", seed: 32, params: { ordersPerS: 800, hotShare: 0.5 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:lag`, scenario: s.id, requirement: "No partition ever falls more than 1 s behind", passed: (f: Facts) => f.maxLagMs <= 1000, observed: (f: Facts) => `worst lag ${f.maxLagS} s` },
  { id: `${s.id}:order`, scenario: s.id, requirement: "Every order's events are processed in the order they happened", passed: (f: Facts) => f.violations === 0, observed: (f: Facts) => (f.violations ? `${f.violations.toLocaleString("en")} orders out of order` : "all in order") },
  { id: `${s.id}:cost`, scenario: s.id, requirement: "At most 12 consumers", passed: (f: Facts) => f.consumers <= 12, observed: (f: Facts) => `${f.consumers} consumers${f.idle ? `, ${f.idle} idle` : ""}` },
];

export const hotPartitionLab: Lab = {
  id: "hot-partition",
  version: "1",
  title: "Handle an overloaded Kafka partition",
  summary: "Payment events are keyed by merchant, and one merchant is huge. Its partition falls minutes behind while others idle. Choose a key that spreads the load and still keeps each order's events in order.",
  story: [
    "Every order produces three events: authorised, captured, settled. They go to a topic with 8 partitions, keyed by merchant id, read by a consumer group. Each consumer handles 300 events a second.",
    "One merchant brings 30% of all orders. All of its events hash to one partition, so one consumer gets far more than it can handle, however many consumers you add. Changing the key fixes the balance, but a careless key breaks something else: the three events of an order must be processed in order.",
  ],
  unit: "messaging",
  view: { kind: "series", lines: [{ key: "lagS", label: "Most-behind partition (seconds)" }], limit: { key: "limit", label: "1 s" } },
  controls: [
    { id: "key", type: "select", label: "Partition key", help: "The value hashed to choose each event's partition.", options: [
      { value: "merchant", label: "Merchant id" },
      { value: "order", label: "Order id" },
      { value: "random", label: "None (a random partition per event)" },
      { value: "merchant-salt", label: "Merchant id plus a random salt per event" },
      { value: "merchant-bucket", label: "Merchant id plus a bucket chosen from the order id" },
    ] },
    { id: "partitions", type: "number", label: "Partitions", help: "How many partitions the topic has.", min: 1, max: 32, step: 1 },
    { id: "consumers", type: "number", label: "Consumers in the group", help: "Each processes 300 events a second; a partition is read by one consumer only.", min: 1, max: 32, step: 1 },
    { id: "buckets", type: "number", label: "Salt or bucket count", help: "With a salted or bucketed key: how many sub-keys each merchant is split into.", min: 2, max: 16, step: 1 },
  ],
  starter: { key: "merchant", partitions: 8, consumers: 8, buckets: 4 },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "maxLagS", label: "Worst lag (s)" },
    { key: "busiestShare", label: "Busiest partition's share (%)" },
    { key: "violations", label: "Orders out of order", bad: "above-zero" },
    { key: "idle", label: "Idle consumers", bad: "above-zero" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "consumers",
    answer: "idle",
    variants: [
      { id: "more-consumers", question: "To catch up, you scale the group from 8 to 16 consumers. The topic still has 8 partitions. How many consumers sit idle?", scenario: scenarios[0], config: { consumers: 16 } },
      { id: "twelve", question: "The topic has 8 partitions and you run 12 consumers. How many consumers sit idle?", scenario: scenarios[0], config: { consumers: 12 } },
      { id: "more-parts", question: "The topic has 12 partitions and you run 20 consumers. How many consumers sit idle?", scenario: scenarios[0], config: { partitions: 12, consumers: 20 } },
    ],
  },
  questions: [
    {
      id: "more-consumers",
      prompt: "Why didn't adding consumers fix the lag with the merchant key?",
      options: [
        { text: "Consumers were too slow to start.", why: "They started at once; most had nothing to do." },
        { text: "All of the big merchant's events go to one partition, and a partition is read by one consumer; the others can't share its load.", correct: true, why: "Right. The hot partition, not the group size, is the limit." },
        { text: "Kafka limits a group to 8 consumers.", why: "There's no such limit; the partition count caps useful consumers." },
      ],
    },
    {
      id: "salt",
      prompt: "Salting the merchant key with a random value per event balanced the load. What did it break?",
      options: [
        { text: "Nothing.", why: "Look at the order of events." },
        { text: "The three events of one order can land in different partitions and be processed out of order. A bucket derived from the order id keeps them together.", correct: true, why: "Right. The salt must be stable for whatever must stay ordered." },
        { text: "It made the topic use more disk.", why: "The number of events is the same." },
      ],
    },
    {
      id: "order-key",
      prompt: "Keying by order id is balanced and keeps each order's events in order. When would it be the wrong key?",
      options: [
        { text: "When a consumer needs all of a merchant's events in order (say, a running balance per merchant).", correct: true, why: "Right. The key must match the scope that needs ordering; then you'd need the merchant key and another way to spread the hot merchant (a dedicated topic, or more capacity for that partition's consumer)." },
        { text: "When there are many orders.", why: "Many distinct keys is what makes it balance." },
        { text: "Never: a unique key is always best.", why: "It's best only if per-order ordering is all you need." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.maxLagMs > 1000) parts.push(`The most-behind partition fell ${f.maxLagS} s behind: it received ${f.busiestShare}% of all events, more than one consumer can process${c.key === "merchant" ? ", because every event of the big merchant hashes to it" : ""}.`);
    if (f.violations) parts.push(`${f.violations.toLocaleString("en")} orders had events processed out of order: their three events went to different partitions, which are consumed independently.`);
    if (f.idle) parts.push(`${f.idle} consumers had no partition to read: a group can't use more consumers than partitions.`);
    if (f.consumers > 12) parts.push(`${f.consumers} consumers is over the budget of 12.`);
    if (!parts.length) parts.push(`Balanced and ordered: the busiest partition got ${f.busiestShare}% of events, the worst lag was ${f.maxLagS} s, and every order's events were processed in order.`);
    return parts.join(" ");
  },
  hints: [
    "Look at the busiest partition's share. Which key sends everything from one merchant to one place?",
    "What must stay in order: everything from a merchant, or the events of one order?",
    "If you split a merchant across several partitions, the split must keep an order's three events together.",
  ],
  assumptions: [
    "Orders arrive evenly; each belongs to the big merchant with the scenario's probability, otherwise to one of 400 others (from a fixed seed). Its three events are 40 ms apart.",
    "The partition is the key's FNV-1a hash modulo the partition count, as a stand-in for Kafka's murmur2. A random key picks a random partition.",
    "Each consumer processes 300 events a second, sharing its time between its partitions in turn. Partitions are assigned round-robin; consumers beyond the partition count get none.",
    "An order is out of order if any of its events is processed after a later one.",
  ],
  notModelled: [
    "Rebalancing pauses, broker limits, replication and producer batching.",
    "Changing the partition count of a live topic (existing keys would move).",
    "Per-event processing cost differences and retries.",
  ],
};
