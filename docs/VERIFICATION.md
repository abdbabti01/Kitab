# Verification record

Environment: Windows 10, Node 22.14.0, npm 9.9.4, Playwright 1.64.1 with
headless Chromium 156. Run on branch `feature/kitab-missions-guide`.

## Commands and results (final run)

| Check | Command | Result |
|---|---|---|
| Unit, model, mission, tutor-eval, Worker integration | `npm test` | 100 passed, 0 failed |
| Typecheck (frontend, Worker + shared contracts, e2e) | `npm run typecheck` | clean |
| Production build | `npx vite build` | succeeds; largest chunk 411 kB (127 kB gzip) |
| Browser journeys, 4 widths + Worker integration | `npx playwright test` | 67 passed, 13 skipped (opt-in or width-specific) |
| Frame timing (opt-in) | `KITAB_PERF=1 npx playwright test perf --workers=1` | see below |
| Dependency audit | `npm audit` | 0 vulnerabilities |

## What the tests cover

- **Model correctness** (`tests/domain-correctness.test.ts`): BFS for every
  fixture vertex against an independent BFS oracle, absent vs unreachable vs
  budget-interrupted, cycles; array addresses in narration/labels/snapshots;
  computed shift counts; TCP across 144 configurations with an independent
  sender ACK ledger (never more unacknowledged segments than the window),
  monotonic cumulative ACKs on segment boundaries, loss retransmission of the
  original range, duplicate ACK before timeout, reordering buffers; recursion
  push/pop counts, LIFO unwinding vs a factorial/sum oracle, overflow at the limit.
- **Missions** (`tests/missions.test.ts`): every variant builds; exactly one
  option equals the computed answer; correct option position varies by
  attempt but is stable per attempt; retries change the answer; outcome text
  is rejected before prediction; a new scenario registers as content only.
- **Learning runtime** (`tests/learning-runtime.test.ts`): wrong → run →
  evidence → retry → mastery; skip/blank/Next never master; visits vs attempts
  vs mastery; refresh restore; corrupt/tampered/unavailable storage; guide
  moods and non-repetition.
- **Tutor evaluation fixtures** (`tests/tutor-eval.test.ts`) — *fixture checks
  of Kitab's validator, not a live model*: contradictory TCP ACK numbers, ACKs
  that skip the gap, "retransmit everything", "routers retransmit", "ACK counts
  packets", wrong topic, unknown evidence/attention/misconception ids, extra
  properties (DOM command, grade), over-long and non-object output, spoilers
  before prediction, prompt-injection quoting; the reviewed fallback is valid
  for every mission × variant × phase × intent.
- **Worker integration** (`tests/worker*.test.ts`, `tests/compose.test.ts`)
  on a SQLite-backed fake D1 running the real migrations and a scripted fake
  AI: concurrent reservations at 19/20 admit exactly one (and the old
  read-then-write pattern is shown to over-admit on the same fake); distinct
  concurrent misses → one 200 + one 429; same-query coalescing in one instance
  and across simulated instances via the D1 lease; batch rollback on save
  failure; bounded retries; timeouts; AI errors; missing bindings; D1 down;
  version association and repair of version-less drafts; draft and mission
  feedback; tutor fallbacks for invalid output/timeout/quota/token budget;
  audit rows without learner text; scenario composition validation.
- **Browser** (`e2e/`): the learning journey above in a real browser, legacy
  redirects, refresh and back/forward, the old TCP crash path (shrink payload
  after a completed run), selection stability and inspector/scene agreement,
  keyboard-only operation with focus moves, guide hint/fallback/attention/
  collapse, no horizontal overflow and ≥ 44 px controls at 1440/1024/768/390,
  200 % text at 1440 and 390, reduced motion (no script animations), FLIP
  motion present when allowed, and UI↔Worker contracts (draft creation,
  refresh, feedback, AI tutor label, described lab scenario).

Browser summary (final run): **67 passed, 13 skipped** (skips are perf tests,
which are opt-in, and width-specific tests on other projects).

## Frame timing (headless Chromium on this machine, TCP lab at 2×, 6 s)

| Profile | p50 | p95 | max | frames > 50 ms |
|---|---|---|---|---|
| 1440 px, no throttle | 16.7 ms | 33.3 ms | 66.7 ms | 1 |
| 1440 px, 4× CPU throttle | 16.7 ms | 33.4 ms | 233 ms | 9 |
| 390 px, no throttle | 16.7 ms | 16.8 ms | 16.8 ms | 0 |
| 390 px, 4× CPU throttle | 16.7 ms | 16.8 ms | 167 ms | 8 |

Long frames coincide with step transitions (React re-render + FLIP measure).
This is **not** a 60 fps claim and **not** real-device validation.

## Not verified (and how to verify)

- **Live Workers AI quality and the fp8 model's JSON-schema adherence**: no
  staging environment was configured, so no live inference was run and no
  production quota or D1 was touched. To smoke-test on staging:
  `npx wrangler dev --remote` with a staging D1, then
  `curl -X POST localhost:8787/api/tutor -d @fixture.json` for the fixtures in
  `tests/tutor-eval.test.ts`, and `POST /api/concept` for a few concepts.
- **`wrangler` runtime**: not installed locally; the Worker was bundle-checked
  with Vite SSR and exercised through `handle()` with fake bindings, not in
  workerd. Run `npx wrangler dev` before deploying.
- **Migration 0003 on real D1**: verified on SQLite only.
- **Real devices, screen readers, touch hardware**: only emulated viewports,
  emulated touch and Playwright accessibility queries. No NVDA/VoiceOver pass.
- **CI**: `.github/workflows/ci.yml` is added but has not run until the branch
  is pushed.
