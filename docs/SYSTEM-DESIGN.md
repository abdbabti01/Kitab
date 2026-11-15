# System Design & Architecture track

The third track: six units, each a lesson with a simulator experiment, then a design challenge, plus the
Architecture Playground (`/practice/architecture`). Everything lives in `src/architecture/`; the Network Playground
and its engine are untouched.

## Layers

```text
model.ts        component kinds, connection rules, design document schema (kitab.architecture v1), bounds
validate.ts     parseDesign (untrusted → design, or DesignFormatError) · validateDesign (errors block a run, warnings teach)
simulate.ts     pure discrete-event simulator: design → SimRun { events }   (no React, no DOM)
metrics.ts      fold(events) → component state, transit, totals, series; summarize = fold to the end
explain.ts      one sentence per event; findings computed from the summary
challenges.ts   challenges, scenarios, checks on outcomes; evaluate(challenge, design)
lessons.ts      lesson content and experiments          catalog.ts  titles/versions for the always-loaded track
editor.ts       editing reducer with undo/redo          fields.ts   inspector settings (bounds = schema, tested)
persistence.ts  saved designs (kitab.architecture.designs.v1), import/export
progress.ts     lessons and challenges (kitab.architecture.progress.v1), zod only
coach.ts        AI coach contract shared with worker/architecture-coach.ts
ui/             lazy-loaded pages: ArchitecturePlayground, ChallengePage, ArchitectureLessonPage, Workspace,
                DesignCanvas, Inspector, SimulationPanel, Coach, useRun (playback)
```

One run produces one event stream. The diagram, inspector, metrics, chart, timeline and findings all read the fold
of that stream (`foldEvents`/`foldTo`), never a second model.

## Components and what the simulator does with them

| Component | Modelled | Settings (bounds) |
|---|---|---|
| Client | Open-loop arrivals (steady, or Poisson from the seed); reads / writes / static files by percentage; item chosen uniformly or Zipf (s = 1); timeout per attempt; retries with doubling backoff; late answers counted as wasted | 1–2000 req/s, timeout 50–10 000 ms, 0–3 retries, backoff 0–5000 ms |
| CDN | LRU file store with optional expiry, starts empty; miss → object storage (or the API); reads/writes passed to its API origin | 0–100 000 files, TTL 0–3600 s |
| Load balancer | Round-robin or least-outstanding; with health checks, a failed server is skipped from the first check after it fails until the first check after it recovers | interval 500–30 000 ms |
| API server | Slots (concurrency) and a bounded FIFO queue; own work time, then cache-aside read / write-through-delete / publish to queue; a slot is held while waiting on downstream calls | 1–64 slots, 1–2000 ms, queue 0–1000 |
| Cache | Cache-aside LRU with optional expiry, starts empty, cleared by a failure; a failed cache counts as a miss | 0–100 000 items, TTL 0–3600 s |
| SQL database | Slots and queue, separate read/write times; primary takes writes; reads rotate over primary + replicas the server is connected to; every write is applied on each replica (costing it a slot) | 1–200 slots, 1–2000 ms, queue 0–5000 |
| NoSQL database | Partitions by key hash, each with its own slots and queue | 1–16 partitions × 1–64 slots |
| Message queue | Durable bounded list; refuses when full (backpressure); hands messages to free workers in turn | depth 1–100 000 |
| Worker | Slots; work time, then a database write (and cache delete); failure → redelivery after a delay, dead letter after N receives; a crash returns its messages | 1–64 slots, 1–5000 ms, 1–10 receives |
| Object storage | Fixed response time, no capacity limit | 5–1000 ms |

Fixed constants (`SIM_CONSTANTS`): client↔origin 40 ms one way, client↔CDN 10 ms, CDN↔origin 30 ms, internal
hops 1 ms, cache/queue/LB operations 1 ms; work may finish up to 30 s after arrivals stop. A failed component
refuses connections immediately and loses work in progress.

Connections: **request** (waits for an answer), **async** (API → queue → worker) and **replication**
(SQL → SQL, one level). Only rule-table pairs are allowed; clients can never reach a database, cache or queue.

Bounds on work: ≤ 40 components, ≤ 80 connections, ≤ 15 000 arrivals per run (refused before running),
≤ 500 000 events (the run is marked cut short), ≤ 10 planned failures, imported files ≤ 200 KB.

## Not modelled

Data contents (so no stale reads or consistency anomalies), replication lag, network loss/jitter/bandwidth, CPU or
memory contention, variance in service times, hung or slow-but-alive servers, failover of a primary, autoscaling,
ordering guarantees, duplicate side effects, authentication, encryption and attacks, and money. Numbers are this
model's arithmetic, never real cloud performance; the UI says so wherever it shows capacity or results.

## Challenges

Each fixes the settings that would make it trivial (`fixed`), locks the client, runs its scenarios (including
"each API server down in turn") with seeded Poisson arrivals, and judges observable outcomes: success rate, p95
latency (per operation where relevant), database utilisation, messages processed with no dead letters, retry load,
and cost in abstract units. `tests/architecture-challenges.test.ts` proves, for every challenge, that the starter
fails, two different designs pass and a plausible wrong design fails.

## AI coach

`POST /api/architecture-coach` reuses the tutor's response schema, its per-IP/session/global scopes and the shared
Neuron budget (`runBudgeted`); no budget, binding or migration is added. The Worker rebuilds every design fact from
the submitted document (no simulation runs server-side, to stay within Workers CPU limits). The browser may add only
booleans per check and numbers from its last run, labelled "reported by their browser" in the prompt. Output is
accepted after schema, evidence-id, component-id, number-grounding, topic and markup checks; otherwise the reviewed
fallback (first unmet requirement + next hint) is returned. The coach never grades. Audit rows go to
`tutor_requests` as `architecture:<challenge>` without learner text or the design.

## Persistence and compatibility

Designs: `{ version: 1, designs: [...] }`, each `format: "kitab.architecture", version: 1`. Missing settings take
defaults (older designs load); newer versions, unknown kinds or fields and out-of-range values are refused with a
reason; unreadable entries are reported and kept unchanged when other designs are saved; a damaged store is copied
to `<key>.corrupt`. Edits save 400 ms after the last change and immediately on `pagehide` or when another design is
opened. Progress records carry the challenge version; a new version starts a fresh record.
