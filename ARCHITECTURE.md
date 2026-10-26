# Kitab architecture

Kitab is a learning platform built around **missions**: a reviewed question
about a real mechanism, answered by running a deterministic engine. The loop is
**inspect → predict → run → explain → retry**, with Kitab, an animated guide,
beside the scene.

Stack: React 19 + TypeScript + Vite (client), one Cloudflare Worker (API +
static assets), Workers AI (optional drafts and tutoring), D1 (content,
versions, quotas, feedback, audit).

## Non-negotiable rules

1. Engines are pure TypeScript with no React or DOM imports.
2. One frame object is the source of truth for scene, narration, inspector,
   prediction check and tutor context. Animation projects it; it never decides
   outcomes.
3. Correct answers are engine facts, never a position in an option list.
4. AI never grades, never draws, never mutates a simulation, never publishes.
   Its output is accepted only after strict validation, otherwise a reviewed
   fallback is shown.
5. Unreviewed and illustrative content is labelled in plain language.
6. Migrations are append-only.

## Layers

```text
src/visual-engine/…            pure engines (TCP, data structures, recursion)
        ↓
src/learning/engines/*.ts      adapters: zod params → frames, facts, entities, outcome, claim checks
src/learning/registry.ts       registerEngine / buildTrace (validated, frozen, cached, fact deltas)
        ↓
src/learning/missions/catalog  missions = validated config (mission-schema.ts)
src/learning/assessment.ts     answers from outcome facts, stable per-attempt option order,
                               validateMissionContent (every variant, exactly one correct option,
                               no outcome text before prediction, evidence frame exists)
src/learning/mission-controller.ts  phase + attempt reducer (separate from playback)
src/learning/progress.ts       validated local progress (visits ≠ attempts ≠ mastery)
src/learning/guide.ts          topic-independent guide event → mood/message/target
src/learning/tutor.ts          tutor request/response contract, context builder,
                               fallback, validator, prompt (shared by client + Worker)
src/learning/draft-contract.ts kitab.draft/3: the Worker → client draft contract
        ↓
src/mission/MissionPage.tsx    generic shell (no topic branches)
src/mission/scenes/            one scene module per engine id (+ optional Reference)
src/mission/{PhasePanel,Playback,Inspector,KitabGuide,KitabAvatar,motion}.tsx
src/app/                       router (History API, legacy redirects), home, concept, draft pages
worker/                        index (routes) · generation · tutor · feedback · quota · ai · http · env
```

### Adding content

- **A new scenario of an existing mechanism**: add a mission object to
  `src/learning/missions/catalog.ts`. `npm test` validates it against the
  engine for every variant. No shell, scene or guide change.
  (`tests/missions.test.ts` registers one at runtime to prove this.)
- **A new mechanism**: write a pure engine, an adapter (`EngineAdapter`) and a
  scene module, then register both. The shell and guide stay unchanged.

## Missions and assessment

A mission defines objective, review status, engine id/version, base scenario,
retry **variants**, optional learner-editable parameters (labs), a prediction
(`choice` options whose values reference `outcome.*`/`param.*`, or `numeric`),
an evidence frame, an evidence question, a hint ladder (flagged safe before
prediction), misconception messages, and reviewed source excerpts.

- Before prediction only frame 0 is shown and playback is locked.
- **Mastery** = correct prediction **and** correct evidence choice in the same
  attempt, with the run completed. Watching without predicting, Next clicks,
  autoplay and the optional reflection never grant it.
- Retry moves to the next variant, so the computed answer changes.

## Playback and motion

`usePlayback(trace)` keys position to `trace.scenarioKey`; a stale index from a
previous scenario is ignored in the same render (the old TCP crash class).
`frameAt()` clamps any index. `useFlip` animates elements sharing a
`data-flip` id between frames (container-relative FLIP), fades in new ones,
cancels in-flight animations each frame, resets on a new attempt, and is
disabled under `prefers-reduced-motion` (CSS transitions also collapse).

## Kitab guide

`guideReducer` maps learner events (`mission-opened`, `object-selected`,
`prediction-*`, `run-*`, `hint-requested`, `misconception-identified`,
`explanation-assessed`, `mastered`, `retry-started`, `tutor-*`) to one of eight
moods, a message, optional detail and an optional entity id. The shell only
highlights that id if it exists in the current frame. Messages are announced
once through a polite live region; the guide never moves focus.
`KitabAvatar` is a code-native SVG ("book spirit": the open book is the face,
the ribbon bookmark is the pointer) animated with CSS keyframes.

## AI

| Capability | What AI may do | What decides correctness |
|---|---|---|
| Concept drafts (`POST /api/concept`) | Write schema-bound explanatory content | Nothing is verified. Drafts are labelled “not reviewed”; walkthroughs are illustrative. The engine family is chosen once in the Worker (`applyEnginePolicy`). |
| Tutor (`POST /api/tutor`) | Explain/hint using provided facts | The engine trace. The Worker rebuilds it from validated params, withholds outcome and future frames before prediction, and rejects output that fails schema, evidence-id, attention-id, misconception-code, numeric-grounding, adapter contradiction, topic or spoiler checks. |
| Scenario composition (`POST /api/scenario`, labs only) | Map a learner's description onto the mission's declared controls (JSON schema derived from them) | `validateComposedParams`: keys must be declared controls, values allowed options or on-range/step, the engine must build a complete trace without downgrading or normalizing anything. Only then is it saved (`composed_scenarios`) and applied. The mechanism's correctness still comes from the engine; no second model is asked. |

Fallbacks (reviewed hints, frame narration, misconception messages) are
returned on timeout, invalid output, missing binding, D1 failure or quota
exhaustion. No inference runs on playback, hover or idle.

Model: `AI_MODEL` var, default `@cf/meta/llama-3.1-8b-instruct-fp8`
($0.152 / $0.287 per M input/output tokens on Cloudflare's pricing page,
checked 2026-10-25; the previous `-fast` id is no longer listed).

## Reliability and cost controls

- **Atomic allowance**: one conditional UPSERT per scope (`usage_counters`),
  per IP, per session and global, plus a global daily token budget; partial
  reservations are released.
- **Coalescing**: identical concurrent misses share one promise per instance
  and one D1 lease (`generation_jobs`) across instances; followers poll and
  reserve nothing. Instance memory alone is not relied on.
- **Persistence**: concept, immutable `lesson_versions` row, audit
  (`generation_requests`, with prompt/schema version, calls, latency, tokens)
  and job state commit in one `DB.batch` transaction. A failed save publishes
  nothing. Old drafts without a version row are repaired on read.
- **Cache identity**: `draft-prompt/3:2:<normalized concept>`; saved drafts are
  re-validated against the current policy and refused with `409` when stale.
  Learner text is never cached or stored in audit rows.
- Bounded retries (≤ 3 inference calls per draft, 1 for the tutor), timeouts
  (25 s / 8 s, `AI_TIMEOUT_MS`), body size limits, structured error codes.

## Storage (D1)

`concepts`, `concept_aliases`, `lesson_versions`, `generation_requests`,
`lesson_feedback` (draft version + frame), `generation_limits` (legacy, unused)
from 0001–0002; `usage_counters`, `generation_jobs`, `mission_feedback`
(mission version + engine version + scenario + frame), `learning_events`
(prediction submitted / mastered only), `tutor_requests` (audit, no learner
text) from 0003.

## Routes

`/` · `/missions/:id` · `/concepts/:slug` · `/drafts/:slug`. Legacy
`/lesson/tcp`, `/visual-lab` → `/missions/tcp-lab`; `/lesson/data-structures` →
`/missions/ds-lab`. Malformed encodings render “Not found”.

## Known simplifications (declared in content)

TCP: segment 1 travels alone for inspection; timeout recovery rather than fast
retransmit; windows counted in segments. Data structures: fixed fixtures.
Recursion: factorial/sum with a configurable stack limit.
