# Guided experiments: predict, then test

A guided experiment asks the learner to commit to a prediction, runs one of Kitab's real simulators, shows what it
recorded, asks which reason the evidence supports, and then offers a variation to predict and compare. It is the
same cycle in all three subjects; only the engine and the view differ.

## Pieces

| Piece | File | Role |
|---|---|---|
| Model and rules | `src/learning/cycle.ts` | `Cycle<S, R>` content type, `reduceCycle`, `validateCycle`, `direction` |
| Saved attempts | `src/learning/cycle-progress.ts` | `kitab.experiments.v1`, one record per `<id>@<version>`, resume |
| Catalog | `src/learning/cycle-catalog.ts` | titles and addresses for links, without loading any engine |
| Panel | `src/ui/PredictCycle.tsx`, `src/ui/cycle.css` | `useCycle` (state, saving, runs) and `CyclePanel` |
| System Design | `src/architecture/cycles.ts` | lesson designs → `simulate()` → `summarize()` |
| Data Structures | `src/structures/cycles.ts` | Playground setups → `buildTrace()` (the missions' adapters) |
| Networking | `src/practice/network/cycles.ts`, `src/practice/GuidedNetwork.tsx` | starter networks → `simulate()` |

## The cycle

```text
ready ──predict──▶ running ──observed(attempt, trial)──▶ observed ──explain──▶ explained ──finish──▶ completed
  ▲                                                                              │   ▲                  │
  └──────────── vary (a variation; needs the first run explained) ◀──────────────┘   └──── vary ────────┘
again ("Start again", offered once a result is explained): a new attempt (attempt + 1) back at ready
```

- **Understand**: concept, scenario, the question, terms from the shared glossary, and the starting configuration,
  read from the setup alone (never from a run), plus what to watch for.
- **Predict**: one committed choice per trial. The host shows no result before it: the System Design lesson has no
  run yet, the Data Structures scene stays at its starting state with no playback or step count, and the Network
  Playground keeps Send closed for the experiment's network.
- **Test**: the content's `run(setup)` is the real engine. The result is accepted only for the attempt and trial that
  asked for it, so a late result can't land on a newer attempt.
- **Observe**: the outcome the run supports, then its evidence (most important first, the rest on demand). Evidence
  with a step or event (`at`) can move the run view there. Variations add a first-run vs this-run table.
- **Explain**: an optional free-text box (not graded, not saved) and a structured choice of reasons; exactly one is
  supported by the run. The explanation is built from the run's own values, followed by what the model doesn't show.
- **Change one thing**: each variation names its one change and asks a comparison question; `direction()` reads the
  answer from both runs (lower / about the same / higher, with a stated tolerance).

Completed = the first run predicted, run and explained, plus one variation when the experiment has any.
Understood = in the same attempt, the first run's outcome predicted and its supported reason chosen. Neither feeds
mission mastery, challenge results or lesson completion. (A System Design lesson still counts as done when its
experiment runs, as it always has.)

## Experiments

| Subject | Id | Question | Variations |
|---|---|---|---|
| System Design | `sd-capacity` | 20 → 200 req/s on 4 slots: what do users see? | double the slots; queue 500; faster database |
| System Design | `sd-cache-hit-rate` | hit rate of a 500-item cache, every item equally likely | popular items with 50 or 500 items; no cache |
| System Design | `sd-bottleneck` | which component limits one API server at 500 req/s? | 2 or 3 servers behind a load balancer; bigger database |
| System Design | `sd-queue` | does a slow worker slow the shopper? | three workers; bigger Orders API |
| System Design | `sd-failover` | share of requests failing while one server is down | health checks; no retries; 300 ms backoff |
| Data Structures | `ds-array-insert` | `[4, 7, 12, 18]` after inserting 9 at index 2 | index 0; the end; a linked list |
| Data Structures | `ds-stack-queue` | which value dequeue removes | a stack |
| Data Structures | `ds-hash-collision` | comparisons to insert 22 into chained buckets | key 20 (empty bucket) |
| Data Structures | `ds-bst-shape` | comparisons to find 8 after sorted inserts | balanced insert order; a missing key |
| Data Structures | `ds-recursion-order` | which call of factorial(4) returns first | no base case; a base case too deep |
| Networking | `net-arp-first` | what the PC transmits before its first ping | ping again; an unused address |
| Networking | `net-dhcp-order` | the order of DHCP messages | DHCP service off |
| Networking | `net-gateway-frame` | the destination MAC of the first frame to another subnet | no gateway; ping the router itself |

Some runs contradict a common belief, and the feedback says why: a longer queue *raises* failures at 200 req/s
(306 refused → 730 timed out), a bigger database changes nothing when the API server is the bottleneck, a
50-item cache of popular items matches a 500-item cache of uniform ones, and correct recursion with a base case still
overflows a 4-frame stack.

## Saved attempts

`kitab.experiments.v1` through `keyed-store.ts`: damaged or newer records are kept, other tabs' records survive, a
newer store is never overwritten, and a refused save is reported on the panel. A record holds the attempt count, the
first completion and understanding dates (never rewritten, kept when starting again) and the current state (answers
only). Resume validates the state against this version's ids and runs the engine again: if the stored outcome no
longer matches, the learner starts a new attempt instead of seeing stale feedback. A new experiment version gets a
new record; the old one stays. Nothing else is read or written.

## Adding an experiment

Write a `Cycle` in the subject's module, add it to that module's list and to `cycle-catalog.ts`. `tests/cycles.test.ts`
checks the catalog, runs `validateCycle` against the real engine, checks evidence steps exist and that the starting
configuration doesn't show the answer.

## Limits

- Free-text explanations are not evaluated; reasoning is judged only by the structured reason choice.
- Reasons are statements authored per experiment; the run decides which one holds, but a learner may hold a correct
  reason that isn't listed.
- Thresholds that name an outcome ("slower" = 95th percentile above 1.3× the 20 req/s run; "about the same" = within
  2 requests or 5%) are stated in the content and tested; they are teaching boundaries, not universal rules.
- Each simulator's own simplifications apply (fixed network delays, no stale cache contents, illustrative addresses,
  a small recursion stack, ARP entries that never expire); each experiment states the ones that matter to it.
