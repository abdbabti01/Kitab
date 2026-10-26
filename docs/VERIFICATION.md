# Verification record

Environment: Windows 10, Node 22.14.0, npm 9.9.4, Playwright 1.64.1 with
headless Chromium 156. Run on branch `feature/kitab-missions-guide`.

## Commands and results (local run after the PR #1 review fixes)

| Check | Command | Result |
|---|---|---|
| Unit, model, mission, tutor-eval, Worker integration | `npm test` | 113 passed, 0 failed |
| Typecheck (frontend, Worker + shared contracts, e2e) | `npm run typecheck` | clean |
| Production build | `npm run build` (tests + typecheck + Vite) | succeeds; largest chunk 306 kB (97 kB gzip) |
| Browser journeys, 4 widths + Worker integration | `npx playwright test` | 76 passed, 13 skipped (opt-in or width-specific) |
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

Browser summary (local run): **76 passed, 13 skipped**. The skips are the
opt-in perf tests and width-specific tests on other projects. CI results for
the pushed head are linked from PR #1.

## Review findings from PR #1 (reviewed head `330f974`)

Each finding was reproduced on `330f974` before fixing. Findings 1, 2 and 4
were reproduced with a fake-binding script; finding 3 with the new browser
specs run in a temporary worktree of `330f974`.

| Finding | Reproduced on 330f974 | Fix | Regressions |
|---|---|---|---|
| 1. Token budget not shared or enforced | Zero budget still admitted a tutor call. Drafts and tutor kept separate token rows. Composition recorded 0 tokens. | One `ai-tokens` row; every call and retry reserves an upper-bound estimate atomically (insert and update paths), then reconciles to reported usage. Missing usage keeps the reservation. Per-IP/session call limits unchanged. | `tests/worker-budget.test.ts`: zero budget on a fresh DB; a draft exhausting the allowance, then tutor and composition refused; composition usage recorded; 6 concurrent calls behind a gate (peak reservation ≤ budget, the rest refused); a rejected retry charged; missing usage, failures and timeouts keep their reservation; per-IP limit still enforced. |
| 2. Tutor leak and false array explanation | "Three elements shift right…" passed before prediction, and "No array elements need to move. Overwrite…" passed afterwards. | No model call before a prediction (reviewed, answer-safe hints and narration only). Number words normalized for spoiler and grounding checks. An engine-derived array claim check compares claimed shift counts and "overwrite" claims with the computed `shifts`. | `tests/tutor-eval.test.ts`: both examples rejected; a legitimate hint and correct explanations accepted (for two variants with different counts); a wrong spelled-out count rejected. `tests/worker-tutor.test.ts`: zero AI calls and no quota before prediction. The reviewed fallback is still valid for every mission × variant × phase × intent. |
| 3. Delayed replies reset attempts | 4 of the 5 new browser specs failed: a slow reply after the prediction reset it, an out-of-order reply overwrote newer settings, a settings change did not cancel the pending reply, and a stale tutor reply was shown. | `APPLY_PARAMS` applies only if the latest state matches the request's attempt, parameters and pre-prediction phase (checked in the reducer and before dispatch). Description and tutor requests are aborted on context change or unmount. Stale tutor replies are dropped and announced. | `e2e/stale-replies.spec.ts` (5 specs, including a reload that keeps the submitted prediction and a leave-while-pending case) and reducer/guide tests in `tests/learning-runtime.test.ts`. |
| 4. Duplicate generation around lease completion | 2 inference calls, 2 versions and 2 quota charges. | After winning the lease the leader re-reads the cache. Valid current-policy content is returned, settling only its own lease, before any quota or AI. Stale content is still regenerated. | `tests/worker-budget.test.ts`: a deterministic `beforeLease` interleaving gives 1 inference, 1 version and 1 quota charge; stale content still regenerates. |

The tutor checks are bounded: they catch the claim shapes listed above and the
existing TCP/recursion rules. They do not establish that arbitrary model prose
is true. The fixtures exercise the validator, not live model quality.

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
- **Token-budget accuracy against real billing**: the allowance counts
  model-reported tokens (or the conservative reservation when none is
  reported), not Neurons. Its relation to Cloudflare's actual charges is
  unmeasured.
