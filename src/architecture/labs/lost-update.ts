// Lab: concurrent purchases read the stock, subtract one and write it back; some decrements are lost and the shop
// oversells. Fixes: an atomic conditional update, optimistic concurrency (a version check), or a row lock.
// Modelled: one stock row in a database with row-level write locks (first come, first served, with a lock wait
// timeout) and committed versions. Isolation follows PostgreSQL: under READ COMMITTED a plain read sees the latest
// committed value and an UPDATE that waited for a lock proceeds; under REPEATABLE READ a transaction whose row was
// changed by another committed transaction after its snapshot fails with a serialization error. Buyers' arrival
// times and the app's pause between reading and writing come from the scenario's seed.
import { Timeline, prng, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Strategy = "read-write" | "atomic" | "optimistic" | "pessimistic";
type Config = { strategy: Strategy; isolation: "read-committed" | "repeatable-read"; retries: number; lockTimeoutMs: number; slowFirst: boolean };

const COMMIT_MS = 1;
const HOP = 1;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const random = prng(scenario.seed);
  const tl = new Timeline();
  const row = { value: p.stock, version: 0 };
  let lockOwner: number | null = null;
  const waiters: { tx: number; granted: () => void; since: number; timedOut: boolean }[] = [];
  let txSeq = 0;

  const note = (actor: string, text: string, tone: LabEvent["tone"], ref?: string, data?: Record<string, number>) => {
    tl.log({ actor, kind: data ? "effect" : "note", text, tone, ref, data });
  };

  const lock = (tx: number, granted: () => void, timedOut: () => void) => {
    if (lockOwner === null) {
      lockOwner = tx;
      return granted();
    }
    const w = { tx, granted, since: tl.now, timedOut: false };
    waiters.push(w);
    tl.after(c.lockTimeoutMs, () => {
      const i = waiters.indexOf(w);
      if (i === -1) return;
      waiters.splice(i, 1);
      w.timedOut = true;
      timedOut();
    });
  };
  const unlock = () => {
    lockOwner = null;
    const next = waiters.shift();
    if (next) {
      lockOwner = next.tx;
      next.granted();
    }
  };

  function buyer(b: number) {
    const ref = `buyer-${b}`;
    const start = tl.now;
    // The app's pause between reading and writing; a slow check sits inside it unless it's done first.
    const inWindow = p.thinkMs + (c.slowFirst ? 0 : p.slowMs ?? 0);
    const think = () => Math.round(inWindow * (0.6 + 0.8 * random()));
    const answer = (kind: "confirmed" | "sold-out" | "error", why: string) => {
      const latency = tl.now - start;
      note("app", `Buyer ${b}: ${kind === "confirmed" ? "“Purchase confirmed”" : kind === "sold-out" ? "“Sold out”" : "“Something went wrong, try again”"}. ${why}`, kind === "confirmed" ? "good" : kind === "sold-out" ? "info" : "bad", ref, {
        confirmed: kind === "confirmed" ? 1 : 0, soldOut: kind === "sold-out" ? 1 : 0, errors: kind === "error" ? 1 : 0, slow: latency > 1000 ? 1 : 0, latency,
      });
    };

    function attempt(n: number) {
      const tx = ++txSeq;
      const retry = (why: string, code: "conflicts" | "lockTimeouts") => {
        tl.log({ actor: "db", kind: "note", text: `Buyer ${b}: ${why}`, tone: "warn", ref, data: { [code]: 1 } });
        if (n <= c.retries) tl.after(5, () => attempt(n + 1));
        else answer("error", "No retries left.");
      };
      const commitWrite = (value: number, how: string) => {
        tl.after(COMMIT_MS, () => {
          const before = row.value;
          row.value = value;
          row.version++;
          note("db", `Buyer ${b} commits stock = ${value} (${how}; it was ${before}).`, before - value === 1 ? "info" : "bad", ref);
          unlock();
          tl.after(HOP, () => answer("confirmed", ""));
        });
      };

      if (c.strategy === "atomic") {
        tl.after(think(), () => {
          note("app", `Buyer ${b}: UPDATE stock = stock − 1 WHERE stock > 0.`, "info", ref);
          lock(tx, () => {
            if (row.value <= 0) {
              unlock();
              return tl.after(HOP, () => answer("sold-out", "The update matched no row: stock was 0."));
            }
            commitWrite(row.value - 1, "the database subtracted one from the current value");
          }, () => retry("lock wait timed out.", "lockTimeouts"));
        });
        return;
      }

      if (c.strategy === "pessimistic") {
        note("app", `Buyer ${b}: SELECT stock … FOR UPDATE.`, "info", ref);
        lock(tx, () => {
          const seen = row.value;
          note("db", `Buyer ${b} holds the row lock and reads stock = ${seen}.`, "info", ref);
          tl.after(think(), () => {
            if (seen <= 0) {
              unlock();
              return tl.after(HOP, () => answer("sold-out", "Read 0 under the lock."));
            }
            commitWrite(seen - 1, "written under the lock it has held since reading");
          });
        }, () => retry("waited too long for the row lock.", "lockTimeouts"));
        return;
      }

      // Read, pause in the app, then write.
      const seen = row.value;
      const seenVersion = row.version;
      note("db", `Buyer ${b} reads stock = ${seen}${c.strategy === "optimistic" ? ` (version ${seenVersion})` : ""}.`, "info", ref);
      tl.after(think(), () => {
        if (seen <= 0) return tl.after(HOP, () => answer("sold-out", `Read stock = ${seen}.`));
        note("app", c.strategy === "optimistic" ? `Buyer ${b}: UPDATE stock = ${seen - 1}, version = ${seenVersion + 1} WHERE version = ${seenVersion}.` : `Buyer ${b}: UPDATE stock = ${seen - 1}.`, "info", ref);
        lock(tx, () => {
          if (c.strategy === "optimistic" && row.version !== seenVersion) {
            unlock();
            return retry(`version is now ${row.version}, not ${seenVersion}: the update matched no row (conflict).`, "conflicts");
          }
          if (c.strategy === "read-write" && c.isolation === "repeatable-read" && row.version !== seenVersion) {
            unlock();
            return retry("could not serialize access due to concurrent update (the row changed after its snapshot).", "conflicts");
          }
          commitWrite(seen - 1, row.value === seen ? "computed from its read" : `computed from a stale read of ${seen}`);
        }, () => retry("lock wait timed out.", "lockTimeouts"));
      });
    }
    if (c.slowFirst && p.slowMs) {
      note("app", `Buyer ${b}: runs the fraud check first, before touching the stock.`, "info", ref);
      tl.after(Math.round(p.slowMs * (0.6 + 0.8 * random())), () => attempt(1));
    } else attempt(1);
  }

  for (let b = 1; b <= p.buyers; b++) {
    const at = Math.round(random() * p.spreadMs);
    tl.at(at, () => buyer(b));
  }
  tl.at(0, () => tl.log({ actor: "db", kind: "note", text: `Stock starts at ${p.stock}. ${p.buyers} buyers arrive over ${p.spreadMs} ms.`, tone: "info", data: { initial: p.stock } }));
  tl.drain(120_000);
  tl.log({ actor: "db", kind: "note", text: `Final stock: ${row.value}.`, tone: "info", data: { final: row.value } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["initial", "final", "confirmed", "soldOut", "errors", "conflicts", "lockTimeouts", "slow"]);
  const ended = events.some((e) => e.data?.final !== undefined);
  const latencies = events.filter((e) => e.data?.latency !== undefined).map((e) => e.data!.latency).sort((a, b) => a - b);
  const decreased = ended ? f.initial - f.final : 0;
  return {
    ...f,
    lostUpdates: ended ? Math.max(0, f.confirmed - decreased) : 0,
    oversold: Math.max(0, f.confirmed - f.initial),
    refusedWithStock: ended && f.final > 0 ? f.soldOut + f.errors : f.errors,
    p95: latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] : 0,
  };
}

const scenarios: LabScenario[] = [
  { id: "flash-sale", title: "A flash sale", description: "5 left in stock; 20 buyers press Buy within 50 ms. The app pauses 5–15 ms between reading and writing.", seed: 21, params: { stock: 5, buyers: 20, spreadMs: 50, thinkMs: 10 } },
  { id: "busy-day", title: "A busy afternoon", description: "200 in stock; 60 buyers over 6 s, each with a 12–28 ms pause between reading and writing.", seed: 22, params: { stock: 200, buyers: 60, spreadMs: 6000, thinkMs: 20 } },
  { id: "slow-check", title: "A slow fraud check", description: "200 in stock; 40 buyers over 2 s. Each purchase also waits 180–420 ms for a fraud check, after reading the stock unless the app does it first.", seed: 23, params: { stock: 200, buyers: 40, spreadMs: 2000, thinkMs: 10, slowMs: 300 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:consistent`, scenario: s.id, requirement: "Stock goes down by exactly one per confirmed purchase", passed: (f: Facts) => f.lostUpdates === 0, observed: (f: Facts) => (f.lostUpdates ? `${f.confirmed} confirmed, but stock fell by only ${f.initial - f.final}: ${f.lostUpdates} decrements lost` : `${f.confirmed} confirmed, stock fell by ${f.initial - f.final}`) },
  { id: `${s.id}:oversell`, scenario: s.id, requirement: "No more purchases are confirmed than there was stock", passed: (f: Facts) => f.oversold === 0, observed: (f: Facts) => (f.oversold ? `${f.oversold} more sold than existed` : `${f.confirmed} confirmed of ${f.initial}`) },
  { id: `${s.id}:answered`, scenario: s.id, requirement: "No buyer gets an error, or “sold out” while stock remains", passed: (f: Facts) => f.refusedWithStock === 0, observed: (f: Facts) => (f.refusedWithStock ? `${f.refusedWithStock} buyers turned away while ${f.final} remained${f.errors ? ` (${f.errors} errors)` : ""}` : "every buyer got a correct answer") },
  { id: `${s.id}:fast`, scenario: s.id, requirement: "95% of buyers are answered within 1 s", passed: (f: Facts) => f.p95 <= 1000, observed: (f: Facts) => `95% answered within ${f.p95.toLocaleString("en")} ms` },
];

export const lostUpdateLab: Lab = {
  id: "lost-update",
  version: "1",
  title: "Correct concurrent inventory updates",
  summary: "Twenty buyers want the last five items. Read-then-write loses updates and oversells; find the concurrency control that stays correct, and fast enough, in every scenario.",
  story: [
    "The shop's code is simple: read the stock, check it's above zero, write back stock minus one. Tested by one person clicking Buy, it's always right.",
    "With buyers at the same moment, two of them can read the same 5, both write 4, and both be told “confirmed”: one sale has vanished from the count. In a flash sale, that is how a shop sells items it doesn't have.",
  ],
  unit: "transactions",
  view: { kind: "sequence", lanes: [{ id: "app", label: "Shop app" }, { id: "db", label: "Database (stock row)" }] },
  controls: [
    { id: "strategy", type: "select", label: "How a purchase updates the stock", help: "The SQL the app runs for each purchase.", options: [
      { value: "read-write", label: "Read the stock, then write stock − 1" },
      { value: "atomic", label: "One atomic UPDATE … SET stock = stock − 1 WHERE stock > 0" },
      { value: "optimistic", label: "Optimistic: read stock and version, UPDATE … WHERE version matches" },
      { value: "pessimistic", label: "Pessimistic: SELECT … FOR UPDATE, then write" },
    ] },
    { id: "isolation", type: "select", label: "Transaction isolation", help: "PostgreSQL's behaviour for read-then-write. The other strategies behave the same under both.", options: [
      { value: "read-committed", label: "READ COMMITTED (the default in PostgreSQL)" },
      { value: "repeatable-read", label: "REPEATABLE READ" },
    ] },
    { id: "retries", type: "number", label: "Retries after a conflict or error", help: "How many times the app re-runs the whole purchase after a version conflict, a serialization failure or a lock timeout.", min: 0, max: 8, step: 1 },
    { id: "slowFirst", type: "toggle", label: "Run the fraud check before touching the stock", help: "Do the slow work first, so the read-to-write window (and any lock) is short." },
    { id: "lockTimeoutMs", type: "number", label: "Lock wait timeout", help: "How long a transaction waits for another's row lock before giving up.", min: 50, max: 10000, step: 50, unit: "ms" },
  ],
  starter: { strategy: "read-write", isolation: "read-committed", retries: 0, lockTimeoutMs: 2000, slowFirst: false },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "confirmed", label: "Purchases confirmed" },
    { key: "lostUpdates", label: "Lost decrements", bad: "above-zero" },
    { key: "oversold", label: "Oversold", bad: "above-zero" },
    { key: "conflicts", label: "Conflicts retried" },
    { key: "refusedWithStock", label: "Wrongly turned away", bad: "above-zero" },
    { key: "p95", label: "95% answered within (ms)" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "purchases",
    answer: "confirmed",
    variants: [
      { id: "flash-rc", question: "5 left, 20 buyers within 50 ms, each reading the stock then writing stock − 1 under READ COMMITTED. How many buyers are told “Purchase confirmed”?", scenario: scenarios[0] },
      { id: "flash-rr", question: "Same flash sale, but under REPEATABLE READ with no retries. How many buyers are told “Purchase confirmed”?", scenario: scenarios[0], config: { isolation: "repeatable-read" } },
      { id: "small-rc", question: "3 left, 8 buyers within 30 ms, read-then-write under READ COMMITTED. How many buyers are told “Purchase confirmed”?", scenario: { id: "small", title: "A small rush", description: "3 left; 8 buyers within 30 ms.", seed: 5, params: { stock: 3, buyers: 8, spreadMs: 30, thinkMs: 10 } } },
    ],
  },
  questions: [
    {
      id: "why-lost",
      prompt: "Under READ COMMITTED each UPDATE waits for the row lock. Why are decrements still lost?",
      options: [
        { text: "The lock is released too early.", why: "Locks are held to commit; the problem is the value being written." },
        { text: "Each transaction writes a value it computed from an earlier read; the lock orders the writes but each one overwrites the other's result with a stale number.", correct: true, why: "Right. Locking the write doesn't help if the new value came from a read taken before the other write committed." },
        { text: "READ COMMITTED allows dirty reads.", why: "It doesn't: it never shows uncommitted data. Lost updates happen anyway." },
      ],
    },
    {
      id: "choose",
      prompt: "When is optimistic concurrency a worse choice than a pessimistic lock?",
      options: [
        { text: "When conflicts are frequent: many transactions do the work, fail the version check and redo it.", correct: true, why: "Right. Optimistic control wins when conflicts are rare; under heavy contention a queue (a lock, or one atomic statement) wastes less." },
        { text: "When conflicts are rare.", why: "That's where optimistic shines: no locks held, almost no retries." },
        { text: "Never: optimistic is always faster.", why: "Retries cost real work; with contention they can dominate." },
      ],
    },
    {
      id: "lock-cost",
      prompt: "SELECT … FOR UPDATE is correct here. What did the slow fraud check reveal about it?",
      options: [
        { text: "It deadlocks.", why: "There's one row, so there's no lock cycle to deadlock on." },
        { text: "The lock is held for the whole slow check, so purchases queue behind each other one at a time, and waits grow beyond users' patience.", correct: true, why: "Right. Hold locks for as short a time as possible; do slow work before taking them." },
        { text: "It allows lost updates under READ COMMITTED.", why: "The value is read under the lock, so no other write can slip in between." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.lostUpdates) parts.push(`${f.confirmed} purchases were confirmed, but the stock went down by only ${f.initial - f.final}: ${f.lostUpdates} decrements were overwritten by writes computed from stale reads.`);
    if (f.oversold) parts.push(`That's ${f.oversold} more items sold than existed.`);
    if (f.errors) parts.push(`${f.errors} buyers got an error: ${c.strategy === "pessimistic" ? "they waited too long for the row lock while others held it through their pause" : `the conflict ${c.retries ? "kept recurring past the retries" : "wasn't retried"}`}.`);
    else if (f.refusedWithStock) parts.push(`${f.refusedWithStock} buyers were told “sold out” although stock remained.`);
    if (f.p95 > 1000) parts.push(`Answers were slow: 95% within ${f.p95.toLocaleString("en")} ms.`);
    if (!parts.length) parts.push(`Correct: ${f.confirmed} confirmed, stock ${f.initial} → ${f.final}, ${f.conflicts} conflicts retried; 95% answered within ${f.p95} ms.`);
    return parts.join(" ");
  },
  hints: [
    "Follow two buyers who read the same number. What does each write?",
    "Either let the database do the arithmetic on the current value, or make a write fail if the row changed since you read it.",
    "Correct isn't enough: in the slow scenario, how long is the row locked, and how many buyers wait behind it? If you detect conflicts, what do you do with them?",
  ],
  assumptions: [
    "One stock row. Writes take a row lock held until commit (1 ms after the write); waiters are served first come, first served, and give up after the lock wait timeout.",
    "PostgreSQL semantics: READ COMMITTED reads the latest committed value; under REPEATABLE READ a write to a row changed after the snapshot fails with a serialization error.",
    "Each buyer arrives at a time drawn from the seed and pauses between reading and writing (app work, a fraud check) for a time drawn around the scenario's average.",
    "A retry re-runs the whole purchase (a fresh read) after 5 ms.",
  ],
  notModelled: [
    "Many rows, deadlocks between rows, indexes, write skew across rows (see the Transactions lesson), and SERIALIZABLE's predicate checks.",
    "Network delays to the database beyond 1 ms, connection pools, and a replicated database.",
    "Reserving stock in a cart, or compensating oversold orders later.",
  ],
};
