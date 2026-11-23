# Learn, Playground, Practice and Lab

Kitab has four modes. They can share an engine, but each has its own job and its own interface.

| Mode | Job | Has | Doesn't have |
|---|---|---|---|
| **Learn**: concept pages `/concepts/*`, lessons `/learn/*` | Understand | Explanation, one small demonstration from a fixed setup, a common misconception, a one-question check (nothing is recorded), one link into the Playground | Input controls, playback bars, scrubbers, memory tables, free runs |
| **Playground**: `/practice/structures`, `/practice/network`, `/practice/architecture` | Explore | Every control: inputs, operations, playback, memory, free runs, saved designs | Grading |
| **Practice**: missions, troubleshooting, design challenges, architecture labs | Apply and validate | Predictions, evidence-based feedback, completion and mastery | Long explanations |
| **Engineering Lab**: `/lab/*` | Build and execute | Real JavaScript execution and real HTTP requests, both labelled as real | Simulation |

**Guided experiments.** The Predict → Experiment → Explain cycles stay where they are, including inside System
Design lessons. They are assessed experiments, not duplicates of the Playground.

## How it works

- `src/learning/concept-learn.ts` (pure data) holds what a concept page adds to its chapter text:
  - sections,
  - a `demo` setup,
  - an `explore` link,
  - a misconception,
  - a check.
- A demonstration is never authored separately from the engine:
  - `LessonDemo` runs the Playground's engine (`buildTrace`) and draws the Playground's scene (`sceneFor`) on a fixed setup, stepped with Previous and Next.
  - `RecursionDemo` shows `recursionSteps(config)`, a plain call-and-return reading of `buildRecursionTimeline`.
- `exploreFor(slug)` derives the Playground link from the same setup. The lesson and the Playground therefore produce the same scenario key, which `tests/learning-modes.test.ts` checks.
- The data-structures demonstrations use the same setup as each unit's existing Playground experiment (`experimentForUnit`).
- Concepts without an engine (DNS, the web request, TCP, queues and others) keep their reviewed illustration. It is now labelled **Conceptual illustration**.
- System Design lessons:
  - A lesson with a guided cycle runs that cycle on the page.
  - The lesson's designs open in the Architecture Playground through `?lesson=&variant=&rate=`, built by `lessonDesign` (the same function the lesson's own free experiment uses) and saved like a template copy.
  - The Playground shows "Back to the lesson".
  - `design-projects` has no cycle, so its free experiment stays on the page. It is that lesson's experiment and what completes it.

## The hand-offs

| From | To | Where |
|---|---|---|
| Concept page | Playground, on the page's own setup, with `from=` for the way back | `ExploreLink` under the demonstration or illustration |
| SD lesson | Architecture Playground, one link per lesson design | `ExploreDesigns` in the lesson's experiment |
| Structures Playground (after a run) | The unit's missions | `.sp-practise` in the result |
| Practice step in a track | The unit's Engineering Lab, only where one exists (`unitLabs`) | `PathNext`, `.path-lab` |

`PathNext` takes `playground={false}` on pages that already have their own Explore link, so the end of a page never repeats it.

## Before and after: recursion

**Before**, `/concepts/recursion` had:
- a five-step hand-authored `EngineCanvas` with an "Execution trace" console,
- "Runtime frames",
- "State after event",
- a scrubber.

These repeated what the Playground's recursion run shows, but its frames were hand-written labels, not computed from any run.

**After**, the page has:
- six short sections (what, why it can call itself, the base case, waiting and returning, stack overflow, when to use it),
- the factorial code, using the engine's rule `n <= 1`,
- a seven-step call-and-return sequence with the conceptual frames still waiting, computed from the engine,
- a note that real runtimes lay out stacks differently,
- a misconception and a check,
- "Explore recursion in the Playground", which opens `factorial(3)` with every control.

## Progress

- Concept pages still record only a visit (`App.tsx`). The checks and demonstrations write nothing.
- No lesson, chapter, step, mission, challenge or lab id changed, and no storage key changed.
- System Design lessons complete as before, when their experiment runs.
- Free runs in the Architecture Playground never complete a lesson.
