# Learning journeys: design note

Kitab teaches a mechanism from the basic parts upward by following one concrete example in small steps.
It explains before it assesses: missions remain the practice that follows.

## Plan (as implemented)

1. **Engine.** `packet-journey` replays a recorded C# simulation of a browser request and server reply.
2. **Runtime.** A lesson runtime: validated content, step resolution against engine frames, navigation and learning progress.
3. **Page.** `/learn/:id` in the dark "Inside the Layers" direction.
4. **Reuse.** A second lesson (array insertion) on the existing `data-structures` engine, built from content only.
5. **AI.** An optional follow-up question endpoint that rebuilds context on the server and shares the existing quotas and token allowance.
6. **Home and practice.** Home leads with the journey; missions are labelled as practice and link back to the walkthrough.

## What every step answers

| Learner question | Source |
|---|---|
| What are the parts? What problem is solved? | Chapter goal, scope card, glossary terms introduced at the step |
| Who acts? | `step.actor`, or the engine's `frame.actor` |
| What moves or changes? | `step.what` (templated from frame facts) and the computed before → after list |
| Why is it necessary? | `step.why` (reviewed prose) |
| At which level? | `step.level`, or the engine's `frame.level`; shown in the level rail and badge, and as the highlighted row in the scene |
| How does it connect? | Previous and next step titles; the chapter strip recommends the next chapter |

## Layers

```text
src/content/packet-journey/…                             recorded C# events and source snapshots
src/learning/engines/packet-journey.ts                  adapter: facts, entities (with origin), level/actor per frame, claim checks
src/learning/lessons/schema.ts                           lesson content contract (levels, glossary, kinds, chapters, steps, experiments, controls)
src/learning/lessons/runtime.ts                          resolveTrack, fillStepText, safeParams, stepDelta, validateLessonContent
src/learning/lessons/navigation.ts                       pure navigation reducer (Next/Back/level/experiment/params/replay) + restore
src/learning/lessons/progress.ts                         learning progress (kitab.learning.v1), separate from mission progress
src/learning/lessons/tutor.ts                            follow-up contract, context, fallback, validation (shares checkTutorResponse)
src/learning/lessons/catalog.ts                          reviewed lessons: hello-tcp, array-insert
src/lesson/LessonPage.tsx + lesson.css                   generic page; scenes come from the existing scene registry
src/mission/scenes/PacketJourneyScene.tsx                device close-ups, nested headers and source
worker/lesson-tutor.ts                                   POST /api/lesson-tutor
```

Steps bind to engine frames by id, or with `each` they expand over every matching frame (by id pattern or engine chapter).
Step text may only state values through `{fact:id}`, `{param.x}`, `{outcome.x}` and `{frame.title|narration}`.
`validateLessonContent` checks every reachable scenario: each choice option, plus sample texts that include multi-byte characters.
It confirms that every template resolves, every focus target exists, levels are lesson levels, steps never go back in the trace, every frame is shown, experiments share the journey's prefix, and every selectable kind is described.

## Decisions

- **Recorded Packet Journey.**
  The lesson replays 130 events from the C# simulation, including its source lines. The Kitab runtime resolves each event into a step, layer and inspectable facts.
  The example uses plain HTTP/1.1, one simulated IPv4 router and a pre-resolved server address. The TCP practice missions use separate interactive simulations.
  The existing `hello-tcp` route now opens Packet Journey. The new lesson version starts learners at the beginning of the new trace.
- **Learning ≠ mastery.**
  Learning progress lives under `kitab.learning.v1`: visits, steps seen, chapters seen, completion and experiments.
  It never writes `kitab.progress.v1`.
  The walkthrough counts as complete only at the final step with every chapter seen.
  The completion card shows the five states separately.
- **Fresh practice.**
  The array walkthrough offers insert positions 1 and 3; the practice mission's variants are 2, 0 and 4. A test enforces this.
  Packet Journey's practice is the 3,500-byte loss and window missions.
- **AI only when asked.**
  The step explanation, Kitab's line, terms and "Show me where" all use reviewed content.
  A typed follow-up calls `/api/lesson-tutor`.
  The Worker rebuilds the step from validated parameters, uses the mission tutor's scopes and `runBudgeted`, makes one call, validates with the shared `checkTutorResponse` plus the adapter's claim checks, and falls back to the reviewed step text.
  The client tags every request with track, scenario, step and level, aborts it on any change and drops late replies.
  A reply never changes navigation.
- **No migration.**
  Lesson tutor audits reuse `tutor_requests`, with `mission_id = "lesson:<id>"` and intent `lesson-follow-up`.

## Adding content

- **Another scenario of an existing mechanism:** add a lesson object (or a control option) to `src/learning/lessons/catalog.ts`. `npm test` validates it against the engine. The array lesson is this case: no new engine, adapter or scene.
- **A new mechanism:** write a pure engine, an adapter (declare `level` and `actor` per frame if useful) and a scene module, then register them. The page, navigation, progress and tutor stay unchanged.

## Mockup

The "Inside the Layers" mockup was not attached to the request, so the interface follows the written description: navy surface, restrained blue accents, chapter progression, a large central visual, a current-level indicator, an explanation beside the mechanism, Kitab, and Back/Next/Replay.
