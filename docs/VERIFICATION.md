# Verification record

Environment: Windows 10, Node 22.14.0, npm 9.9.4, Playwright 1.64.1 with
headless Chromium 156. Run on branch `feature/kitab-missions-guide`.

## Commands and results (local run, learner-experience pass, 2026-10-26)

| Check | Command | Result |
|---|---|---|
| Unit, model, mission, tutor-eval, Worker integration | `npm test` | 114 passed, 0 failed |
| Typecheck (frontend, Worker + shared contracts, e2e) | `npm run typecheck` | clean |
| Production build | `npm run build` (tests + typecheck + Vite) | succeeds; largest chunk 306 kB (97 kB gzip) |
| Browser journeys, 4 widths + Worker integration | `npx playwright test` | 92 passed, 13 skipped (opt-in or width-specific) |

All AI in these checks is the scripted fake in `tests/support/fakes.ts` /
`vite.e2e.config.ts`. No real Workers AI call was made, and no D1 other than the
in-memory SQLite fake was used.

## Learner-experience pass (2026-10-26)

Missions were walked through in Chromium at 1440 × 900 and 390 × 844 (TCP
loss, array insertion and recursion depth, plus the TCP lab) before any
changes. Problems observed, by priority, and what changed:

1. **Playback out of reach.** On desktop, the controls sat below the fold while
   the system ran. On phones, the sticky bar took three rows and covered most
   of the scene. → One compact sticky bar beside the scene on every width (two
   rows on phones), with a visible state label: Locked / Playing n× / Paused /
   Run complete.
2. **Prediction not connected to evidence.** "Show me the evidence" changed
   content that was off-screen, especially on phones. → A strip in the scene
   header shows "You predicted …" during the run and "Engine computed …" after
   it. The evidence target is scrolled into view without moving keyboard focus.
   After "Test prediction" the page scrolls to the running scene; on phones the
   panel and Kitab previously filled the screen.
3. **Mobile order and chrome.** Kitab's explanation of a mistake sat below the
   whole scene, and the top bar wrapped onto two lines and clipped the heading.
   → Phone/tablet order is phase panel → Kitab → scene → inspector, and the top
   bar is one non-sticky line.
4. **Kitab's messages did not match the state.** It said "Run it…" while the
   run was already playing, and "That's the right evidence." after a missed
   prediction, with no next step. → Messages now follow the attempt: point to
   "Show me the evidence" after a miss; "Right evidence, but the prediction
   missed. Retry…"; a separate message for watch-only attempts; nothing that
   implies a correct answer unless mastery was earned. Idle avatar motion is
   now finite (only the "thinking" dots loop while a request is pending).
5. **Evidence placement.** The TCP byte stream, the evidence for both TCP
   missions, was below the layer stacks. The recursion call stack was hidden
   below the code on phones. → Both now come first.
6. **Screen-reader noise.** Every autoplay step was announced. → Steps are
   announced when the learner moves to them (paused or manual stepping), not
   during autoplay.

Regressions: `e2e/experience.spec.ts` covers:
- the scene and Pause on screen after predicting;
- evidence brought into view with focus unchanged;
- rapid stepping, seeking during play, run complete and Replay;
- no announcements during autoplay.

The guide message rules are unit-tested in `tests/learning-runtime.test.ts`.
Existing journeys (wrong prediction → evidence → changed retry → mastery, refresh restore, stale descriptions/tutor replies, keyboard, reduced motion, 200 % text, overflow and target sizes) still pass at all four widths.
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

Browser summary (local run): **92 passed, 13 skipped**. The skips are the
opt-in perf tests and width-specific tests on other projects. CI runs for
the pushed commits are on the repository's GitHub Actions page (CI workflow).

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

## Playback performance

Conditions for every comparison: headless Chromium 156 on this Windows
machine, the same viewport (1440 × 900 or 390 × 844), the same mission and
scenario, and CDP CPU throttling. *Before* is `dfa60da`; *after* is this pass.
Both were built for production and served with `vite preview`.

**Correction to the earlier report.** The 150–280 ms frames reported before
were measured on the Vite **development** server. There, React's development
JSX runtime (`jsxDEV`, `console.createTask`) dominated the profile. Re-measured
on the dev server at `dfa60da` with 4× throttling, step changes caused
119–225 ms long tasks. On a production build of the same commit the worst
frame was 50–83 ms, with 0–2 long tasks per 6 s of 2× playback.

**Main-thread work for 10 manual steps, 4× throttle, 1440 px.** Each cell is
the range over 3 runs.

| Mission | Build | Paint | Layout (passes) | Style | Script |
|---|---|---|---|---|---|
| TCP lab | before | 672–687 ms | 227–248 ms (217–225) | 127–190 ms | 212–233 ms |
| TCP lab | after | 163–208 ms | 136–161 ms (94–109) | 51–64 ms | 188–223 ms |
| TCP lab | after, but with the old motion helper | 346–354 ms | 219–227 ms (199–203) | 107–153 ms | 203–209 ms |
| Recursion | before | 518–562 ms | 297–314 ms (250–262) | 220–233 ms | 276–302 ms |
| Recursion | after | 430–458 ms | 278–282 ms (222–240) | 199–228 ms | 232–240 ms |

The A/B row isolates the motion change.
- **FLIP helper.** It called `getAnimations()` on every animated element at
  each step, forcing extra style and layout passes. It now cancels only the
  animations it started. This accounts for the halved layout passes, most of
  the style reduction, and about half of the TCP paint reduction.
- **Re-rendering.** The rest comes from memoising the phase panel and Kitab
  (stable handlers, so they no longer re-render at every playback step), one
  shared number formatter in the inspector, layout containment on the scene
  and inspector, and denser TCP layer rows.
- **Idle.** Neither build paints while idle on these pages.

**What the learner waits for**: click "Next step" → the next frame painted.
These are 4× throttle medians and p90 over 3 rounds of each scenario.

| | before | after |
|---|---|---|
| Desktop TCP / graph / array / recursion | 34 / 34 / 46 / 47 ms (p90 48–60) | 32 / 34 / 48 / 32 ms (p90 48–72) |
| Phone TCP / graph / array / recursion | 32 / 47 / 47 / 47 ms (p90 48–66) | 32 / 33 / 47 / 33 ms (p90 48–72) |

Step latency is quantised to display frames (16.7 ms) and stays at about 2–3
frames under 4× throttle in both builds. It did not measurably change; the
reduction is in main-thread work, not in an observed latency gain.
Unthrottled, every scenario held 16.7 ms frames with no long tasks before and
after.

Limits: this was emulated throttling on one desktop CPU, with no real phone or
GPU, and the samples are small (n = 12–90 steps per cell). This is **not** a
consistent 60 fps claim or real-device validation. The opt-in
`e2e/perf.spec.ts` uses the dev server, which overstates costs, as noted above.

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
