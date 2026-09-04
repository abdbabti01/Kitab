# Kitab system architecture

Kitab is a semantic learning-simulation platform. The learner interface renders
verified state; it does not treat AI output as drawing instructions.

## Non-negotiable rules

1. Simulation engines are pure TypeScript and do not import React.
2. The current simulation event is the only source of truth for the canvas,
   narration, inspector, timeline, and checkpoints.
3. AI may generate declarative lesson content, actors, and events. It may not
   generate HTML, CSS, SVG, coordinates, or executable code, and its engine
   label is only a hint. Kitab selects the renderer from semantic evidence.
4. Published reference lessons are versioned and schema validated.
5. Generated lessons are drafts until reviewed.
6. Text uses normal document layout. Moving visual tokens stay inside bounded
   semantic regions.

## Runtime pipeline

```text
LessonSpec
   ↓ validate
Concept engine + parameters
   ↓ deterministic events
Playback reducer
   ├── responsive visual scene
   ├── beginner narration
   ├── technical inspector
   ├── progress and chapters
   └── prediction checkpoints
```

The reducer owns `index`, `status`, `speed`, and `eventCount`. Renderers never
advance their own private step counters.

## Source boundaries

- `src/visual-engine/core/lesson-spec.ts`: versioned lesson schema.
- `src/visual-engine/core/simulation.ts`: generic playback state machine and
  timeline assertions.
- `src/visual-engine/core/visualization-spec.ts`: safe generated-data adapter,
  engine routing, reference validation, and deterministic graph levels.
- `src/visual-engine/engines/`: responsive concept-family projections.
- `src/visual-engine/lessons/`: reviewed learning metadata, semantic blueprints,
  and checkpoints.
- `src/visual-engine/tcp/`: specialized TCP projection and controls.
- `src/visual-engine/generic/`: safe renderer for AI-generated draft traces.
- `worker/index.ts`: D1 lookup, rate limiting, Workers AI generation, strict
  schema and topic validation, deterministic engine policy, stale-draft
  rejection, and version persistence.
- `migrations/`: append-only D1 schema history.

React Flow and ELK are not part of the learner runtime. Every engine uses normal
document flow, bounded grids, and semantic ordering. This prevents generated
labels from overlapping or escaping the learning surface.

## Concept-family strategy

New verified lessons must target a reusable engine family:

- `protocol`: endpoints, layers, messages, headers, paths, and loss.
- `request`: ordered browser, DNS, edge, API, database, and render traces.
- `memory`: cells, addresses, nodes, pointers, buckets, and mutation paths.
- `tree`: hierarchy, graph relationships, search paths, and traversal decisions.
- `execution`: instructions, calls, frames, returns, and runtime state.
- `concurrency`: actors, scheduling, shared resources, waiting, and ordering.
- `distributed`: services, replicas, brokers, caches, and message ledgers.
- `state-machine`: named states, cycles, comparisons, and transitions.

An engine owns correctness and invariants. A lesson owns the scenario,
explanation, objectives, glossary, and checkpoints. A renderer only projects
engine state.

Each engine has a visible reviewed example on the home page. The distributed
example follows durable message delivery; the state-machine example follows a
guarded application lifecycle. Internal capabilities must never exist only as
undiscoverable implementation details.

## Storage model

- `concepts`: current searchable concept record and cached generated content.
- `concept_aliases`: normalized alternative search terms.
- `lesson_versions`: immutable lesson specifications, engine identity,
  validation state, and checksum.
- `generation_requests`: Workers AI generation audit trail.
- `lesson_feedback`: feedback tied to a specific lesson version and event.
- `generation_limits`: daily new-generation limit per hashed IP.

Generated lesson JSON is versioned independently from the database schema.
Only schema-version-2 AI drafts that still pass engine and relevance checks are
reused. Older or off-topic drafts are ignored and replaced on the next search;
this policy requires no destructive D1 migration.

Schema changes are append-only. Never rewrite an applied migration.

## Layout contract

- No fixed page-height learning workspace.
- Desktop uses client, network, and server columns.
- Tablet and mobile stack these regions in semantic order.
- Every grid track that contains generated text uses `minmax(0, 1fr)`.
- Long labels wrap; packet tokens never determine the page width.
- Scroll is permitted only for bounded collections such as the chapter rail.
- Controls remain reachable and at least 42 CSS pixels tall.
- Motion respects `prefers-reduced-motion`.

## Quality gates

`npm run build` runs the architecture tests before TypeScript and Vite:

- every timeline reaches its declared terminal event;
- event identifiers are unique;
- TCP byte ranges are contiguous and total the configured payload;
- cumulative acknowledgments never move backward;
- send rounds respect the effective TCP window;
- loss retransmits the original byte range;
- reordering buffers bytes until a gap is filled;
- playback cannot stop before the final event;
- unsafe parameter values are normalized.
- every curated lesson resolves to a valid specialized engine;
- all eight generated engine identities are supported;
- semantic evidence overrides an incorrect AI engine suggestion;
- themed CRUD output cannot masquerade as a data-structures lesson;
- legacy saved visualization types map to the new engine registry;
- generated actor references are bounded and validated;
- cyclic graph input produces a finite, non-overlapping layout;
- engine canvases use responsive document flow without absolute positioning.

Every future engine must add equivalent domain-invariant tests. Browser-level
regression coverage should inspect 1440, 1024, 768, and 390 CSS pixels plus 200%
text enlargement before a reference lesson is marked reviewed.
