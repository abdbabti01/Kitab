// Lab: reads from asynchronous replicas show a user stale data: her own change disappears after saving (no
// read-your-writes), and a later page shows an older value than an earlier one (no monotonic reads). Routing and
// session consistency techniques fix it without sending every read to the primary.
// Modelled: one primary and two replicas. Each write commits on the primary and is applied on each replica after
// that replica's lag (asynchronous), or on all replicas before the commit returns (synchronous). One user (Ana)
// writes and reads on a fixed script; other users' reads (300 a second) are counted for load only.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { routing: "replicas" | "primary" | "sticky"; afterWrite: "nothing" | "window" | "lsn"; windowMs: number; replication: "async" | "sync" };

const NET = 2;
const OTHER_READS_PER_S = 300;
const WRITE_TIMEOUT = 1000;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  const ref = "ana";
  const replicas = ["replica-a", "replica-b"] as const;
  const lag: Record<string, number> = { "replica-a": p.lagA, "replica-b": p.lagB };
  const applied: Record<string, number> = { primary: 0, "replica-a": 0, "replica-b": 0 };
  const down = (r: string) => r === "replica-b" && tl.now >= (p.bDownFrom ?? Infinity);
  const values = ["“Ana”", "“Ana Bell”", "“Ana Bell”, new photo pending", "“Ana Bell”, new photo approved"];
  let turn = 0;
  let lastWritten = 0;
  let lastSeen = 0;
  let windowUntil = -1;
  const sticky = "replica-b";

  const pickReplica = () => {
    const up = replicas.filter((r) => !down(r));
    if (c.routing === "sticky") return up.includes(sticky) ? sticky : up[0];
    return up[turn++ % up.length];
  };

  const replicate = () => {
    const version = applied.primary;
    for (const r of replicas) {
      tl.at(tl.now + lag[r], () => {
        if (down(r)) return;
        applied[r] = Math.max(applied[r], version);
        tl.log({ actor: r, kind: "note", text: `Applies change ${version} (${lag[r]} ms after the primary).`, tone: "info", ref });
      });
    }
  };

  /** Someone else changes Ana's profile: a moderator approves her photo. Ana didn't write it. */
  function moderate(version: number) {
    tl.log({ actor: "primary", kind: "note", text: `A moderator approves Ana's new photo (change ${version}).`, tone: "info", ref });
    applied.primary = version;
    replicate();
  }

  function write(version: number) {
    tl.log({ actor: "app", kind: "message", to: "primary", text: `Ana saves her profile: ${values[version]}.`, tone: "info", ref });
    const start = tl.now;
    tl.after(NET, () => {
      applied.primary = version;
      if (c.replication === "async") replicate();
      const confirm = () => {
        const took = tl.now + NET - start;
        lastWritten = version;
        lastSeen = Math.max(lastSeen, version);
        if (c.afterWrite === "window") windowUntil = tl.now + c.windowMs;
        tl.log({ actor: "primary", kind: "message", to: "app", text: `Saved (change ${version})${c.replication === "sync" ? `, after every replica applied it (${took} ms)` : ""}.`, tone: took > 300 ? "warn" : "good", ref, data: { writes: 1, writeMs: took, slowWrites: took > 300 ? 1 : 0 } });
      };
      if (c.replication === "async") return tl.after(NET, confirm);
      // Synchronous: wait for every replica to apply it, up to the write timeout.
      const live = replicas.filter((r) => !down(r));
      const waitFor = replicas.some((r) => down(r)) ? WRITE_TIMEOUT : Math.max(...live.map((r) => lag[r]));
      tl.after(Math.min(waitFor, WRITE_TIMEOUT), () => {
        if (waitFor >= WRITE_TIMEOUT) {
          tl.log({ actor: "primary", kind: "note", text: `A replica didn't confirm within ${WRITE_TIMEOUT} ms: the write is rolled back. Ana sees “Couldn't save”.`, tone: "bad", ref, data: { failedWrites: 1, writes: 1, writeMs: WRITE_TIMEOUT, slowWrites: 1 } });
          applied.primary = version - 1;
          return;
        }
        for (const r of live) applied[r] = version;
        tl.log({ actor: "primary", kind: "note", text: `Every replica has applied change ${version}.`, tone: "info", ref });
        confirm();
      });
    });
  }

  function read(label: string) {
    let target: string = c.routing === "primary" || (c.afterWrite === "window" && tl.now < windowUntil) ? "primary" : pickReplica();
    let why = target === "primary" ? (c.routing === "primary" ? "all reads go to the primary" : "she wrote recently") : c.routing === "sticky" ? "her session's replica" : "the next replica in turn";
    const go = () => {
      tl.log({ actor: "app", kind: "message", to: target, text: `Ana ${label}: read her profile from ${target === "primary" ? "the primary" : target} (${why}).`, tone: "info", ref });
      tl.after(NET, () => {
        const v = applied[target];
        const stale = v < lastWritten;
        const backwards = v < lastSeen;
        lastSeen = Math.max(lastSeen, v);
        tl.log({ actor: target, kind: "effect", text: stale ? `Returns ${values[v]}: her own change is missing.` : backwards ? `Returns ${values[v]}: older than what she saw before.` : `Returns ${values[v]}.`, tone: stale || backwards ? "bad" : "good", ref, data: { anaReads: 1, ryw: stale ? 1 : 0, monotonic: backwards && !stale ? 1 : 0, anaPrimary: target === "primary" ? 1 : 0 } });
      });
    };
    if (c.afterWrite === "lsn" && target !== "primary") {
      // Session consistency: only a replica that has applied everything Ana has written or seen may answer.
      const needed = Math.max(lastWritten, lastSeen);
      const ready = replicas.filter((r) => !down(r) && applied[r] >= needed);
      if (!ready.includes(target as (typeof replicas)[number])) {
        if (ready.length) {
          target = ready[0];
          why = `the first replica that has applied change ${needed}`;
        } else {
          target = "primary";
          why = `no replica has applied change ${needed} yet`;
        }
      }
    }
    go();
  }

  // Ana's script: save, reload a few times, save again, reload.
  tl.at(0, () => write(1));
  for (const [t, label] of [[60, "reloads the page"], [250, "opens her profile"], [700, "checks again"], [1300, "returns to her profile"]] as const) tl.at(t, () => read(label));
  tl.at(2000, () => write(2));
  tl.at(2600, () => moderate(3));
  for (const [t, label] of [[2080, "reloads the page"], [2400, "opens her profile"], [2700, "refreshes"], [3200, "checks again"]] as const) tl.at(t, () => read(label));
  if (p.bDownFrom !== undefined) tl.at(p.bDownFrom, () => tl.log({ actor: "replica-b", kind: "fault", text: "Replica B goes down.", tone: "bad" }));
  tl.drain(10_000);

  // Everyone else: 300 reads a second for 4 s, routed by the same policy (they wrote nothing, so no window applies).
  const others = (OTHER_READS_PER_S * 4000) / 1000;
  const toPrimary = c.routing === "primary" ? others : 0;
  tl.log({ actor: "app", kind: "note", text: `Other users made ${others.toLocaleString("en")} reads in the same 4 s; ${toPrimary.toLocaleString("en")} of them went to the primary.`, tone: "info", data: { otherReads: others, otherPrimary: toPrimary } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["anaReads", "ryw", "monotonic", "anaPrimary", "otherReads", "otherPrimary", "writes", "failedWrites", "slowWrites"]);
  const reads = f.anaReads + f.otherReads;
  const writeMs = events.filter((e) => e.data?.writeMs !== undefined).map((e) => e.data!.writeMs);
  return { ...f, primaryShare: reads ? Math.round(((f.anaPrimary + f.otherPrimary) / reads) * 100) : 0, slowestWrite: writeMs.length ? Math.max(...writeMs) : 0 };
}

const scenarios: LabScenario[] = [
  { id: "normal", title: "A normal day", description: "Replica A lags 30 ms behind the primary, replica B 80 ms.", seed: 1, params: { lagA: 30, lagB: 80 } },
  { id: "lagging", title: "Replica B falls behind", description: "A batch job loads replica B: it applies changes 1.2 s after the primary. Replica A lags 30 ms.", seed: 1, params: { lagA: 30, lagB: 1200 } },
  { id: "replica-down", title: "Replica B goes down", description: "Replica B lags 80 ms, then goes down at 1.5 s and stays down.", seed: 1, params: { lagA: 30, lagB: 80, bDownFrom: 1500 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:ryw`, scenario: s.id, requirement: "Ana always sees her own saved changes", passed: (f: Facts) => f.ryw === 0, observed: (f: Facts) => (f.ryw ? `${f.ryw} of her ${f.anaReads} reads missed her own change` : "she always saw her changes") },
  { id: `${s.id}:monotonic`, scenario: s.id, requirement: "Ana never sees an older value after a newer one", passed: (f: Facts) => f.monotonic === 0, observed: (f: Facts) => (f.monotonic ? `${f.monotonic} reads went back in time` : "never went back") },
  { id: `${s.id}:offload`, scenario: s.id, requirement: "At most 10% of all reads go to the primary", passed: (f: Facts) => f.primaryShare <= 10, observed: (f: Facts) => `${f.primaryShare}% on the primary` },
  { id: `${s.id}:writes`, scenario: s.id, requirement: "Every save succeeds within 300 ms", passed: (f: Facts) => f.slowWrites === 0, observed: (f: Facts) => (f.failedWrites ? `${f.failedWrites} save failed` : `slowest save ${f.slowestWrite} ms`) },
];

export const replicationLagLab: Lab = {
  id: "replication-lag",
  version: "1",
  title: "Scale reads without stale surprises",
  summary: "Profile reads go to replicas to spare the primary. Then Ana saves her new name, reloads, and sees the old one. Keep the replicas doing the work and still give each user a consistent view.",
  story: [
    "The profile service has a primary database for writes and two read replicas that receive its changes asynchronously, a little later. Spreading reads over the replicas keeps the primary free for writes.",
    "Asynchronous means “not yet”: a read that reaches a replica before it has applied a change returns the old value. To other users that's harmless for a moment; to Ana, who just pressed Save, her change has vanished. And reading one replica, then a more lagging one, can make time appear to run backwards.",
  ],
  unit: "consistency",
  view: { kind: "sequence", lanes: [{ id: "app", label: "App (Ana's session)" }, { id: "primary", label: "Primary" }, { id: "replica-a", label: "Replica A" }, { id: "replica-b", label: "Replica B" }] },
  controls: [
    { id: "routing", type: "select", label: "Where reads go", help: "The default route for every read.", options: [
      { value: "replicas", label: "Replicas, in turn" },
      { value: "sticky", label: "Each user's session sticks to one replica" },
      { value: "primary", label: "Always the primary" },
    ] },
    { id: "afterWrite", type: "select", label: "After a user writes", help: "Extra care for the user who just changed something.", options: [
      { value: "nothing", label: "Nothing special" },
      { value: "window", label: "Read from the primary for a while" },
      { value: "lsn", label: "Read only from a replica that has applied the user's latest write (log position)" },
    ] },
    { id: "windowMs", type: "number", label: "Primary window after a write", help: "With “read from the primary for a while”: how long.", min: 100, max: 10000, step: 100, unit: "ms" },
    { id: "replication", type: "select", label: "Replication", help: "When the primary confirms a write.", options: [
      { value: "async", label: "Asynchronous: confirm at once, replicas follow" },
      { value: "sync", label: "Synchronous: confirm once every replica has applied it" },
    ] },
  ],
  starter: { routing: "replicas", afterWrite: "nothing", windowMs: 1000, replication: "async" },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "ryw", label: "Own change missing", bad: "above-zero" },
    { key: "monotonic", label: "Went back in time", bad: "above-zero" },
    { key: "primaryShare", label: "Reads on the primary (%)" },
    { key: "slowestWrite", label: "Slowest save (ms)" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "reads",
    answer: "ryw",
    variants: [
      { id: "lagging", question: "Replica B lags 1.2 s; reads alternate between the replicas. Ana makes 8 reads after her saves. How many of them miss her own latest change?", scenario: scenarios[1] },
      { id: "sticky", question: "Replica B lags 1.2 s and Ana's session sticks to replica B. How many of her 8 reads miss her own latest change?", scenario: scenarios[1], config: { routing: "sticky" } },
      { id: "normal", question: "On a normal day (lags of 30 and 80 ms), reads alternate between the replicas. How many of Ana's 8 reads miss her own latest change?", scenario: scenarios[0] },
    ],
  },
  questions: [
    {
      id: "ryw-vs-strong",
      prompt: "Read-your-writes is satisfied. Does every user now see the latest data?",
      options: [
        { text: "Yes: if Ana sees her change, everyone does.", why: "Other users still read replicas that may not have applied it." },
        { text: "No: it's a per-session guarantee. Ana sees her own changes; others may briefly see older data, which is fine for a profile but not for, say, a bank balance someone else changed.", correct: true, why: "Right. Session guarantees are cheaper than strong consistency, and weaker." },
        { text: "Only with synchronous replication.", why: "Synchronous replication would help everyone, at the cost of slow or failing writes; read-your-writes doesn't need it." },
      ],
    },
    {
      id: "sync-cost",
      prompt: "Synchronous replication removes staleness. Why didn't it pass?",
      options: [
        { text: "Every save waits for the slowest replica, and fails if one is down: you trade write latency and availability for consistency.", correct: true, why: "Right. That's the latency/availability side of the trade-off PACELC describes." },
        { text: "It sends every read to the primary.", why: "Reads can still go to replicas; the cost is on writes." },
        { text: "It loses writes when a replica is down.", why: "It refuses them (they fail) rather than losing them silently." },
      ],
    },
    {
      id: "monotonic",
      prompt: "What breaks monotonic reads when reads alternate between replicas?",
      options: [
        { text: "Replicas apply changes in a different order.", why: "Each replica applies the primary's changes in the same order; they're just at different points." },
        { text: "The replicas are at different points in the log: reading a fresher one, then a staler one, shows an older value after a newer one. Pinning a session to one replica, or tracking the newest position it has seen, prevents it.", correct: true, why: "Right. Each replica is internally ordered; the jump between replicas is what goes backwards." },
        { text: "The primary sends old values.", why: "The primary always has the newest committed value." },
      ],
    },
  ],
  explain: (f) => {
    const parts: string[] = [];
    if (f.ryw) parts.push(`${f.ryw} of Ana's reads reached a replica that hadn't applied her save yet: her change seemed to vanish.`);
    if (f.monotonic) parts.push(`${f.monotonic} read${f.monotonic > 1 ? "s" : ""} showed an older value than one she had already seen: a fresher replica, then a staler one.`);
    if (f.primaryShare > 10) parts.push(`${f.primaryShare}% of all reads went to the primary: the replicas aren't relieving it.`);
    if (f.slowWrites) parts.push(f.failedWrites ? "A save failed: synchronous replication waited for a replica that was down." : `Saves took up to ${f.slowestWrite} ms: synchronous replication waits for the slowest replica.`);
    if (!parts.length) parts.push(`Ana always saw her own changes and never went back in time; only ${f.primaryShare}% of reads reached the primary, and saves took at most ${f.slowestWrite} ms.`);
    return parts.join(" ");
  },
  hints: [
    "Line Ana's reads up against when each replica applied her change. Which reads came too early?",
    "Only Ana needs to see Ana's change at once. Can her reads, just after she saves, go somewhere that's certainly up to date, while everyone else keeps using replicas?",
    "Instead of guessing how long lag lasts, the app can remember how far the log has to have got (her write's position) and pick a replica that's there.",
  ],
  assumptions: [
    "A primary and two replicas; messages take 2 ms. Asynchronous replication applies each change on a replica after that replica's lag; synchronous replication confirms only once every replica has applied it, and fails after 1 s if one never does.",
    "Ana saves at 0 s and 2 s and reads 8 times on a fixed script; at 2.6 s a moderator approves her photo (a change she didn't make). Sticky sessions pin her to replica B (falling back to A if B is down).",
    "“Log position” routing tracks the newest change Ana has written or read; if no replica has applied it, the read goes to the primary.",
    "Other users' 300 reads a second follow the default route; they wrote nothing, so the window and log-position rules don't affect them.",
  ],
  notModelled: [
    "Failover of the primary (and the writes an async replica may not have yet), and replicas catching up after an outage.",
    "Other users' views of Ana's changes, multi-leader replication and conflicting writes.",
    "Replica capacity: replicas are assumed to keep up with the reads they get.",
  ],
};
