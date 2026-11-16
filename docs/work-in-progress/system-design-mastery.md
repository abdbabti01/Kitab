# System Design mastery: work in progress

Branch `feature/system-design-mastery` (worktree `~/source/repos/Kitab-sdm`), from `origin/main` b4dbcb8.

## Objective

Extend the six-unit System Design track into a full architecture curriculum (reliability, data correctness,
distributed systems, messaging, scalability, security, production) with deterministic, tested labs and
mastery challenges. UNDERSTAND → OBSERVE → FIX → MASTER. Reading or opening never grants mastery.

## Constraints

- Keep: lesson/challenge ids (`sd:*`, `challenge:*`), `kitab.architecture.progress.v1`, saved designs,
  the playground simulator's results, networking and data-structures tracks, Worker/AI budgets.
- No new dependencies. Pure engines (no React/DOM). New storage is additive and versioned.
- E2E: run with `KITAB_UI_PORT`/`KITAB_API_PORT` set to free ports; other worktrees may hold 5174/5175 and
  `reuseExistingServer` would test the wrong checkout.

## Decisions

1. **Labs are a separate engine** (`src/architecture/labs/`), not playground extensions. The playground
   simulator models queueing and capacity but explicitly not data contents, duplicates or lag; the correctness
   labs need state (charges, rows, versions, offsets). Each lab is a pure `run(config, scenario) → LabRun`
   (one event stream + facts), seeded, bounded, with declared controls, scenarios, checks, prediction,
   reasoning questions, assumptions and "not modelled".
2. **Mastery for a lab** = in one attempt: first prediction correct (answer computed by the engine for that
   attempt's variant) + a configuration that passes every check in every scenario + the reasoning question
   right first time. Passing checks alone = completed. Retry rotates the prediction variant and question.
3. **New progress store** `kitab.architecture.labs.v1` (labs + unit concept checks). The v1 store is strict and
   left untouched.
4. **New units** are concept lessons (`src/architecture/concepts/`): every concept has plain explanation, why,
   example, mechanism, failure, solution, trade-offs, when not to use, and a check question. Unit completes
   when all its checks are answered correctly. Security and production are lessons + reasoning only (no
   pretend simulation).
5. Recommendation "mastery" now only targets masterable activities (missions, network missions, labs); before,
   a completed System Design lesson or challenge would be offered "work towards mastery" forever.

## Phases

- [x] P0 slice 1: lab kernel, progress store, lab page UI, idempotent payments lab, track wiring, tests (19df229)
- [x] P0 slice 2: retry storm (backoff/jitter), retries across layers (timeouts/deadlines), circuit breaker + bulkhead (df37ccf)
- [x] P0 slice 3: lost update, duplicate delivery, hot partition; transactions + messaging units (a03e066)
- [x] P1: outbox + saga (63c6d35), replication lag (58f91f9), fencing (89828af), cache stampede (4ea6389),
      rate limiting (ce5028c); their concept units
- [x] P2: security and production units with design decisions (059ae36)
- [x] e2e/architecture-labs.spec.ts (a28d590), docs (ced7d6b), lazy-loaded concept units (22a3671)
- [x] Full Playwright suite, CI-style (one project at a time, CI=1, 4 workers): all pass after updating two specs
      that pinned the old track size (architecture.spec, practice.spec). Running all five projects at once on
      this machine crashed Playwright's Vite server mid-run (connection refused afterwards); run one at a time.

## Status

13 labs, 11 concept units (76 concepts), 4 decisions. `npm run build` passes (590 unit tests, typechecks, Vite).
New spec: 32/32 across desktop, laptop, tablet, phone. Bundle: index 527 → 538 kB (+3.4 kB gzip); lab and concept
pages are lazy (59 kB and 66 kB gzip). Done: ready for review.

How labs are tuned: `tests/support/lab-designs.ts` lists passing designs and wrong designs with the exact
checks they must fail. Explore a lab with a scratch script that runs `evaluateLab` over candidate configs.
Test/edit helpers used: Playwright screenshots via `node_modules/playwright` against `npx vite --port 5391`.

## Resume

```sh
cd ~/source/repos/Kitab-sdm && git status && git log --oneline -5
# read this file; continue from the first unchecked phase
```
