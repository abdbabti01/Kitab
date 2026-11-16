// Lab: a lock with a lease protects a read-modify-write on shared storage, until a holder pauses, its write is
// delayed, or its clock runs slow, and it writes after its lease expired and someone else took over. Checking the
// lease yourself can't close the gap; the storage must reject stale writers (fencing tokens, or compare-and-set).
// Modelled: two workers that each add one to a shared counter (read, compute, write); a lock service granting
// leases with an increasing token; storage that applies writes, or rejects stale ones by token or by version.
// A rejected worker starts its job again. Faults are scripted per scenario for worker 1's first job.
import { Timeline, sumData, type Facts, type Lab, type LabConfig, type LabEvent, type LabScenario } from "./kernel.ts";

type Config = { lock: "none" | "lease" | "lease-check" | "fencing" | "cas"; leaseMs: number };

const NET = 10;
const COMPUTE = 600;

function simulate(raw: LabConfig, scenario: LabScenario): LabEvent[] {
  const c = raw as Config;
  const p = scenario.params;
  const tl = new Timeline();
  const storage = { value: 0, version: 0, maxToken: 0 };
  let holder: string | null = null;
  let leaseUntil = 0;
  let token = 0;
  let firstJob = true;
  const done = new Set<string>();
  const usesLock = c.lock !== "none";

  function acquire(worker: string, then: (token: number) => void) {
    if (!usesLock) return then(0);
    tl.log({ actor: worker, kind: "message", to: "lock", text: "Acquire the lock.", tone: "info", ref: worker });
    tl.after(NET, () => {
      if (holder && tl.now < leaseUntil) {
        tl.log({ actor: "lock", kind: "note", text: `Held by ${holder} until ${(leaseUntil / 1000).toFixed(2)} s: ${worker} must wait.`, tone: "info", ref: worker });
        return tl.after(200, () => acquire(worker, then));
      }
      if (holder && holder !== worker) tl.log({ actor: "lock", kind: "note", text: `${holder}'s lease has expired. The lock goes to ${worker}.`, tone: "warn", ref: worker });
      holder = worker;
      leaseUntil = tl.now + c.leaseMs;
      token++;
      const mine = token;
      tl.log({ actor: "lock", kind: "message", to: worker, text: `Granted to ${worker} for ${c.leaseMs} ms${c.lock === "fencing" ? `, fencing token ${mine}` : ""}.`, tone: "good", ref: worker });
      tl.after(NET, () => then(mine));
    });
  }

  function job(worker: string) {
    const slowFirst = worker === "worker-1" && firstJob;
    if (worker === "worker-1") firstJob = false;
    acquire(worker, (myToken) => {
      const grantedAt = tl.now;
      tl.log({ actor: worker, kind: "message", to: "storage", text: `Read the counter${c.lock === "fencing" ? ` with token ${myToken}` : ""}.`, tone: "info", ref: worker });
      tl.after(NET, () => {
        if (c.lock === "fencing") {
          // The token is presented on every operation: a newer holder's read already fences out older tokens.
          if (myToken < storage.maxToken) {
            tl.log({ actor: "storage", kind: "note", text: `Rejects ${worker}'s read: token ${myToken} is older than ${storage.maxToken}. It starts its job again.`, tone: "good", ref: worker, data: { rejected: 1 } });
            return tl.after(NET, () => job(worker));
          }
          storage.maxToken = myToken;
        }
        const seenValue = storage.value;
        const seenVersion = storage.version;
        tl.log({ actor: "storage", kind: "message", to: worker, text: `Counter = ${seenValue} (version ${seenVersion}).`, tone: "info", ref: worker });
        if (slowFirst && p.crashAfterRead) {
          tl.log({ actor: worker, kind: "fault", text: "Worker 1 crashes while holding the lock. It restarts 1 s later and starts its job again; the lock service still counts it as the holder until the lease runs out.", tone: "bad", ref: worker });
          return tl.after(1000, () => job(worker));
        }
        const computeMs = COMPUTE + (slowFirst ? p.slowComputeMs ?? 0 : 0);
        tl.after(NET + computeMs, () => {
          // Checking your own lease uses your own clock, which may run slow.
          if (c.lock === "lease-check") {
            const felt = (tl.now - grantedAt) * (slowFirst ? p.clockRate ?? 1 : 1);
            if (felt >= c.leaseMs) {
              tl.log({ actor: worker, kind: "note", text: `Its own clock says the lease has expired (${Math.round(felt)} ms): it gives up this attempt and starts again.`, tone: "warn", ref: worker });
              return tl.after(50, () => job(worker));
            }
            tl.log({ actor: worker, kind: "note", text: `Its own clock says the lease is still valid (${Math.round(felt)} ms of ${c.leaseMs}).`, tone: "info", ref: worker });
          }
          const pause = slowFirst ? p.pauseMs ?? 0 : 0;
          if (pause) tl.log({ actor: worker, kind: "fault", text: `A ${pause / 1000} s stop-the-world garbage-collection pause, just before writing.`, tone: "bad", ref: worker });
          tl.after(pause, () => {
            const delay = slowFirst ? p.networkDelayMs ?? 0 : 0;
            tl.log({ actor: worker, kind: "message", to: "storage", text: `Write counter = ${seenValue + 1}${c.lock === "fencing" ? ` with token ${myToken}` : c.lock === "cas" ? ` if version is still ${seenVersion}` : ""}${delay ? ` (the packet is delayed ${delay / 1000} s in the network)` : ""}.`, tone: delay ? "warn" : "info", ref: worker });
            tl.after(NET + delay, () => {
              const leaseValid = !usesLock || (holder === worker && tl.now < leaseUntil);
              const reject = (why: string) => {
                tl.log({ actor: "storage", kind: "note", text: `Rejects ${worker}'s write: ${why}. It starts its job again.`, tone: "good", ref: worker, data: { rejected: 1 } });
                tl.after(NET, () => job(worker));
              };
              if (c.lock === "fencing" && myToken < storage.maxToken) return reject(`token ${myToken} is older than token ${storage.maxToken}, already seen`);
              if (c.lock === "cas" && storage.version !== seenVersion) return reject(`the counter is at version ${storage.version}, not ${seenVersion}`);
              const overwrote = storage.value !== seenValue;
              storage.value = seenValue + 1;
              storage.version++;
              storage.maxToken = Math.max(storage.maxToken, myToken);
              tl.log({ actor: "storage", kind: "effect", text: overwrote ? `Counter = ${storage.value}: this overwrites another worker's increment (it was ${seenValue + 1 === storage.value && overwrote ? storage.value : seenValue}).${leaseValid ? "" : ` ${worker}'s lease had expired.`}` : `Counter = ${storage.value}.${leaseValid ? "" : ` ${worker}'s lease had expired, but nobody else wrote in between.`}`, tone: overwrote || !leaseValid ? "bad" : "good", ref: worker, data: { applied: 1, lost: overwrote ? 1 : 0, stale: leaseValid ? 0 : 1 } });
              tl.after(NET, () => {
                done.add(worker);
                tl.log({ actor: worker, kind: "note", text: "Its job is done.", tone: "good", ref: worker, data: { jobs: 1, doneAt: tl.now } });
                if (holder === worker && usesLock) {
                  holder = null;
                  leaseUntil = 0;
                }
              });
            });
          });
        });
      });
    });
  }

  tl.at(0, () => job("worker-1"));
  tl.at(100, () => job("worker-2"));
  tl.drain(20_000);
  if (done.size < 2) tl.log({ actor: "storage", kind: "note", text: `After 20 s, ${2 - done.size} job${done.size === 1 ? " is" : "s are"} still unfinished.`, tone: "bad", data: { unfinished: 2 - done.size } });
  tl.log({ actor: "storage", kind: "note", text: `Final counter: ${storage.value} (two jobs should make it 2).`, tone: storage.value === 2 ? "good" : "bad", data: { final: storage.value } });
  return tl.events;
}

function facts(events: LabEvent[]): Facts {
  const f = sumData(events, ["applied", "lost", "stale", "rejected", "jobs", "unfinished", "final"]);
  const finishes = events.filter((e) => e.data?.doneAt !== undefined).map((e) => e.data!.doneAt);
  return { ...f, lastDoneMs: f.unfinished || !finishes.length ? 20_000 : Math.max(...finishes) };
}

const scenarios: LabScenario[] = [
  { id: "normal", title: "A normal night", description: "No faults: worker 1 starts, worker 2 starts 100 ms later. Each job takes about 0.6 s.", seed: 1, params: {} },
  { id: "gc-pause", title: "A garbage-collection pause", description: "Worker 1 pauses for 3 s right before writing (after any check it makes).", seed: 1, params: { pauseMs: 3000 } },
  { id: "slow-network", title: "A delayed write", description: "Worker 1's write is held up in the network for 3 s.", seed: 1, params: { networkDelayMs: 3000 } },
  { id: "crash", title: "The holder crashes", description: "Worker 1 crashes right after reading, while holding the lock, and restarts 1 s later.", seed: 1, params: { crashAfterRead: 1 } },
  { id: "slow-clock", title: "A slow clock", description: "Worker 1's job takes 2.5 s longer than usual, and its clock runs at half speed, so it thinks less time has passed.", seed: 1, params: { slowComputeMs: 2500, clockRate: 0.5 } },
];

const checksFor = (s: LabScenario) => [
  { id: `${s.id}:no-lost`, scenario: s.id, requirement: "No finished job's increment is lost", passed: (f: Facts) => f.final === f.jobs && f.lost === 0, observed: (f: Facts) => `${f.jobs} jobs finished, counter ended at ${f.final}${f.lost ? `; ${f.lost} increment overwritten` : ""}` },
  { id: `${s.id}:finished`, scenario: s.id, requirement: "Both jobs finish within 5 s", passed: (f: Facts) => f.lastDoneMs <= 5000, observed: (f: Facts) => (f.unfinished ? `${f.unfinished} unfinished after 20 s` : `both finished by ${(f.lastDoneMs / 1000).toFixed(1)} s`) },
];

export const fencingLab: Lab = {
  id: "fencing-token",
  version: "1",
  title: "Make a distributed lock safe",
  summary: "Two workers take turns updating shared storage under a lock with a lease. A pause, a slow packet or a slow clock lets an expired holder write anyway. Make the storage itself refuse stale writers.",
  story: [
    "A nightly job updates a shared record: read it, compute, write it back. Two workers run it for redundancy, so they take a lock first; the lock has a lease, so a crashed worker can't hold it forever.",
    "A lease expires by the lock service's clock, but the worker only finds out if it checks, and checking isn't writing. A garbage-collection pause, a delayed packet or a slow clock lets a worker write after its lease has gone to someone else, overwriting their work. The lock alone isn't enough.",
  ],
  unit: "coordination",
  view: { kind: "sequence", lanes: [{ id: "worker-1", label: "Worker 1" }, { id: "worker-2", label: "Worker 2" }, { id: "lock", label: "Lock service" }, { id: "storage", label: "Storage" }] },
  controls: [
    { id: "lock", type: "select", label: "Protection", help: "How the workers keep out of each other's way.", options: [
      { value: "none", label: "No lock" },
      { value: "lease", label: "A lock with a lease" },
      { value: "lease-check", label: "A lock with a lease; check your lease before writing" },
      { value: "fencing", label: "A lock with a lease and a fencing token the storage checks" },
      { value: "cas", label: "A lock with a lease; the storage writes only if the version is unchanged (compare-and-set)" },
    ] },
    { id: "leaseMs", type: "number", label: "Lease length", help: "How long the lock is held before it expires on its own.", min: 200, max: 10000, step: 100, unit: "ms" },
  ],
  starter: { lock: "lease", leaseMs: 2000 },
  scenarios,
  simulate,
  facts,
  shown: [
    { key: "final", label: "Final counter (should be 2)" },
    { key: "lost", label: "Increments overwritten", bad: "above-zero" },
    { key: "stale", label: "Writes after the lease expired" },
    { key: "rejected", label: "Writes rejected" },
    { key: "jobs", label: "Jobs finished" },
  ],
  checks: scenarios.flatMap(checksFor),
  prediction: {
    unit: "",
    answer: "final",
    variants: [
      { id: "gc", question: "Worker 1 pauses 3 s right before writing; its 2 s lease expires and worker 2 runs its job meanwhile. Both add one to a counter that starts at 0. What is the final counter?", scenario: scenarios[1] },
      { id: "net", question: "Worker 1's write is held up in the network for 3 s; its 2 s lease expires and worker 2 runs its job meanwhile. Both add one to a counter starting at 0. What is the final counter?", scenario: scenarios[2] },
      { id: "nolock", question: "No lock at all: worker 1 and worker 2 each read the counter (0), compute for 0.6 s and write. They start 100 ms apart. What is the final counter?", scenario: scenarios[0], config: { lock: "none" } },
    ],
  },
  questions: [
    {
      id: "check",
      prompt: "Why doesn't checking “is my lease still valid?” right before writing make the lock safe?",
      options: [
        { text: "Because the check is too slow.", why: "Speed isn't the problem; any gap is." },
        { text: "Anything can happen between the check and the write landing (a pause, a delayed packet), and the worker's clock may be wrong. Only the storage, at the moment it applies the write, can reject it.", correct: true, why: "Right. The check-then-act gap is unavoidable on the worker's side." },
        { text: "Because leases can't be checked.", why: "They can; the result is just stale by the time it matters." },
      ],
    },
    {
      id: "token",
      prompt: "How does a fencing token stop the stale write?",
      options: [
        { text: "The lock service tells the storage who holds the lock.", why: "The lock service and storage don't talk; the token travels with the write." },
        { text: "Each grant has a higher token; the storage remembers the highest token it has seen and rejects writes carrying a lower one.", correct: true, why: "Right. The storage becomes the judge, so delays and pauses on the worker can't matter." },
        { text: "The token makes the lease longer.", why: "It doesn't change the lease at all." },
      ],
    },
    {
      id: "lease-length",
      prompt: "With fencing in place, why not make the lease very short to recover from crashes faster?",
      options: [
        { text: "A lease shorter than a normal job expires mid-job every time: every write is rejected and no job finishes.", correct: true, why: "Right. Safety comes from fencing; liveness still needs leases longer than normal work (plus margin)." },
        { text: "Short leases are unsafe.", why: "With fencing they're safe, just not useful when too short." },
        { text: "Lock services don't allow short leases.", why: "They do; the cost is in your jobs." },
      ],
    },
  ],
  explain: (f, cfg) => {
    const c = cfg as Config;
    const parts: string[] = [];
    if (f.final !== 2 || f.lost) parts.push(`The counter ended at ${f.final}, not 2: ${f.lost ? "a write computed from an old read overwrote another worker's increment" : "an increment never happened"}.`);
    if (f.stale) parts.push(`${f.stale} write${f.stale > 1 ? "s were" : " was"} applied from a worker whose lease had expired${c.lock === "lease-check" ? ", even though it checked: the gap between checking and writing (or a wrong clock) let it through" : ""}.`);
    if (f.unfinished) parts.push(`${f.unfinished} job${f.unfinished > 1 ? "s" : ""} never finished: the lease (${c.leaseMs} ms) is shorter than a normal job, so the lock expired every time and the storage rejected the writes.`);
    if (!parts.length) parts.push(`Both jobs finished and the counter reached 2${f.rejected ? `; the storage rejected ${f.rejected} stale write${f.rejected > 1 ? "s" : ""}, and those workers redid their jobs` : ""}.`);
    return parts.join(" ");
  },
  hints: [
    "In the pause scenario, follow worker 1: when did its lease expire, and when did its write arrive?",
    "The worker can't know it's stale at the moment its write lands. Who can?",
    "Give every lock grant a number that only goes up, and let the storage refuse anything older than what it has seen. Then check that a normal job fits in the lease.",
  ],
  assumptions: [
    "Each job reads the counter, computes for 0.6 s and writes the counter plus one; messages take 10 ms. Worker 2 starts 100 ms after worker 1 and retries the lock every 200 ms.",
    "The lock service grants a lease measured by its own clock; each grant gets the next token. A worker releases the lock after its write is acknowledged.",
    "Fencing: the token is sent with every read and write; storage rejects any operation whose token is lower than the highest it has seen. Compare-and-set: storage applies a write only if the version is still the one the worker read.",
    "A worker whose write is rejected, or whose own check fails, starts its job again from the lock.",
  ],
  notModelled: [
    "The lock service's own replication and failover (real lock services such as ZooKeeper or etcd use consensus).",
    "Storage that can't check tokens or versions (then a lease alone can't be made safe).",
    "Many workers, lock queues and fairness.",
  ],
};
