# System Design & Architecture track

The third track: 17 units, the Architecture Playground (`/practice/architecture`) and 13 architecture labs
(`/practice/architecture/labs`). The original six units (a lesson with a playground experiment, then a design
challenge) are unchanged; eleven concept units sit among them, each followed by labs or, for security and
production, by reasoning checks and design decisions. Everything lives in `src/architecture/`; the Network
Playground and its engine are untouched. The playground is described first, then the labs and concept units.

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

## Architecture labs

The playground simulator models capacity and queueing, not data contents, duplicates, lag or locks. Each lab is a
separate, small, deterministic model of one mechanism, built on a shared kernel.

```text
labs/kernel.ts     Lab type, Timeline (event scheduler), prng (the playground's mulberry32), parseConfig,
                   evaluateLab (one run per scenario, checks judged from that run's facts), prediction options
labs/<lab>.ts      simulate(config, scenario) → LabEvent[]; facts(events) → numbers; checks, prediction variants,
                   reasoning questions, assumptions and "not modelled"
labs/progress.ts   kitab.architecture.labs.v1: lab attempts and concept-unit checks (zod, damaged data set aside)
ui/LabPage.tsx     the one page every lab uses; ui/ConceptUnitPage.tsx renders concept units and decisions
```

One run produces one event stream. The sequence view, the chart, the numbers, the explanation and every check read
`lab.facts(events)` (or a prefix of the events during playback). Tests prove the facts are a pure fold of the events,
that runs replay identically, stay ordered and bounded, and that every playback prefix folds.

| Lab | Unit | What is modelled | Passing designs (tests) |
|---|---|---|---|
| Build an idempotent payment API | Idempotency | Client timeouts and retries, two API servers, key store (memory, check-then-insert, atomic with lease), a provider that replays known keys, a receipt side effect; lost answer, slow provider, double click, crash after charge | Key per order, atomic claim, key forwarded, lease between the slow request and the retry window |
| Stop a retry storm | Resilience | Open-loop arrivals, fixed-capacity FIFO server, client timeouts with wasted work, retry policies, jitter, a Finagle-style budget; short and long outages, a reconnecting herd | Exponential backoff with full jitter and a timeout longer than the queue's wait |
| Retries at every layer | Resilience | Gateway → service → database, per-layer timeouts and retries, deadline propagation (per-attempt deadline), database slowdown or errors | Retries at one layer (or one each), timeouts sized to the deadline, propagation |
| Contain a failing dependency | Resilience | Shared worker pool, timeout, circuit breaker with a half-open trial, bulkhead, fallback; hang, fast errors, slow | Short timeout, breaker and fallback; or bulkhead, timeout, breaker and fallback |
| Correct concurrent inventory updates | Transactions | One row with row locks, lock timeouts, PostgreSQL READ COMMITTED / REPEATABLE READ; atomic, optimistic, pessimistic; slow work inside or before the critical section | Atomic update; `FOR UPDATE`, version checks or RR with retries once slow work moves first |
| Prevent duplicate order processing | Messaging | Visibility-timeout broker, two consumers, crashes, slow processing, producer republishing; inbox in or outside the effect's transaction | Inbox by event id in the same transaction; or an idempotent upsert |
| Handle an overloaded Kafka partition | Messaging | Keyed partitions (FNV-1a), consumers capped by partitions, per-order ordering; a big merchant at 30% and 50% | Order-id key; merchant plus an order-derived bucket (8) |
| Design a reliable event publication workflow | Data across services | Dual writes, an outbox relay with polling, CDC, broker outage, relay crash, consumer inbox | Outbox (poll ≤ 1.5 s) or CDC, with an inbox |
| Design a resilient order-processing system | Data across services | Reserve → charge → ship saga, compensations (none, once, retried), progress in memory, a log or outbox events, step idempotency keys | Retried compensations, durable progress, step keys |
| Scale reads without stale surprises | Consistency | Primary and two async replicas with lag, a replica outage, sync replication with a timeout; read-your-writes and monotonic reads for one user | Log-position routing, or a primary window longer than the lag |
| Make a distributed lock safe | Coordination | Leased lock with tokens; GC pause after the check, delayed write, slow clock, crashed holder; fencing on every operation, or compare-and-set | Fencing with a lease longer than a job; compare-and-set |
| Handle a cache stampede | Performance | Shared cache, 20-connection database, coalescing per server or cluster-wide, stale-while-revalidate, refresh-ahead, TTL jitter | Cluster-wide coalescing, SWR or refresh-ahead, 50% jitter |
| Protect an API from overload | Overload | Fixed-capacity server, bursty users, a scraper, a partner bursting around window boundaries, a viral spike; per-client limiters, shedding by expected wait | Sliding window, token bucket or a small fixed window, with shedding at about 200 ms |

`tests/support/lab-designs.ts` lists, for every lab, at least two passing designs and several plausible wrong designs
with the exact checks each must fail; the starter (today's broken system) must fail. Changing a lab's behaviour means
updating that table deliberately, and bumping the lab's version if saved attempts no longer mean the same thing.

**Mastery.** A lab attempt has a prediction variant (its answer is computed by running the starter in that variant's
scenario; the four options are in ascending order, so position carries no hint) and a reasoning question. Mastery
needs, in one attempt: the first prediction right, a configuration passing every check in every scenario, and the
first answer to the reasoning question right. Passing the checks alone completes the lab. "Try another variant"
starts a new attempt with the next variant and question, from today's system again. Opening or running a lab records
nothing.

**Honesty.** Each lab states its assumptions and what it leaves out, on the page. Numbers are the model's arithmetic
(fixed delays and capacities, seeded randomness), not measurements of real systems. Where a mechanism depends on a
product, the lab says whose behaviour it follows (PostgreSQL isolation, Finagle's retry budget, Kafka-style keyed
partitioning with FNV-1a standing in for murmur2).

## Concept units

`concepts/*.ts` hold eleven units. Every concept has a plain explanation, why the problem exists, a real example, the
mechanism, a failure, the recommended solution, trade-offs, when not to use it, optional common confusions, and one
check question with an explanation for every option. A unit completes when every check (and every decision) has been
answered right: completion, never mastery. Tests require every field, exactly one right option per question, and
that the right option's position varies within each unit and within each lab's questions.

Security and production have no labs: attacks, organisations and deployments can't be simulated honestly at this
scale. The production unit ends with four decisions (`Decision` in `concepts/types.ts`): a situation, choices of
which several may be acceptable, and reasons, of which the learner must pick at least `minReasons`, all of them
relevant. `judgeDecision` applies those rules; no model decides. Options are shown in a stable hashed order so the
authored order never leaks.

## Track and progress

Concept units are `sd:<unit>` activities (track `architecture-lesson`); labs are `lab:<id>` (track
`architecture-lab`, version from `catalog.ts`). The original units' and challenges' ids are unchanged. A lesson
completes by its experiment (original units) or by its checks (concept units). `recommend` offers "work towards
mastery" only for activities that can be mastered (missions, networking missions, labs); before, a completed System
Design lesson or challenge was offered it forever. `kitab.architecture.progress.v1` and saved designs are untouched;
`loadEvidence` reads the new store read-only, and only the lab or unit page that owns it repairs it.

## Known limits of the labs

- Each lab models one mechanism in isolation; interactions between them (a retry storm hitting a stampeding cache)
  are left to the lessons.
- Scenarios are scripted faults with fixed seeds: results are reproducible and cover chosen cases, not every case.
- Requirement thresholds (for example "at most 150 calls while failing") are calibrated so that the intended failure
  modes fail and several reasonable designs pass; they aren't industry standards.
- Labs have no AI coach; the reviewed hints and explanations are the help.
