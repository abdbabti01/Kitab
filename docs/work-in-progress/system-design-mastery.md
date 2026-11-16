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
- [x] P0 slice 3: lost update, duplicate delivery, hot partition; transactions + messaging units
- [ ] P1: outbox, saga, replication lag, cache stampede, hot partition, fencing tokens, rate limiting
- [ ] P1/P2: concept units (idempotency, resilience, overload, transactions, messaging, data across services,
      consistency, coordination, performance, security, production)
- [ ] Docs, e2e, full verification, report

## Status

Phase: P1 (outbox, saga, replication lag, cache stampede, fencing, rate limiting). Baseline 531/531 on b4dbcb8; 553/553 at df37ccf.

How labs are tuned: `tests/support/lab-designs.ts` lists passing designs and wrong designs with the exact
checks they must fail. Explore a lab with a scratch script that runs `evaluateLab` over candidate configs.
Test/edit helpers used: Playwright screenshots via `node_modules/playwright` against `npx vite --port 5391`.

## Resume

```sh
cd ~/source/repos/Kitab-sdm && git status && git log --oneline -5
# read this file; continue from the first unchecked phase
```
