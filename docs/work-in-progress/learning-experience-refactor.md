# Learning Experience Refactor: work in progress

Branch `feature/learning-experience-refactor` from `origin/main` ce180e5 (after PR #90). Not merged, not deployed.

Resume instruction: “Resume Kitab's Learning Experience Refactor from docs/work-in-progress/learning-experience-refactor.md
and continue autonomously until complete.”

## Ownership model

| Mode | Owns | Does not own |
|---|---|---|
| Learn (`/concepts/*`, `/learn/*`) | Explanation, one small demonstration from a fixed setup, misconception, one-question check (records nothing) | Changing inputs, playback, scrubbers, memory tables, free runs |
| Playground (`/practice/structures`, `/practice/network`, `/practice/architecture`) | Every control: inputs, operations, playback, memory, free runs, saved designs | Grading |
| Practice (missions, challenges, labs of the SD track) | Predictions, troubleshooting, validated evidence, mastery | Long explanations |
| Engineering Lab (`/lab/*`) | Real JavaScript execution and real HTTP requests | Simulation |

Guided Predict → Experiment → Explain cycles stay where they are: they are assessed experiments, not duplicated widgets.

## Decisions

1. **Concept pages** (`ConceptPage.tsx`) read their extras from `src/learning/concept-learn.ts` (pure data).
   Data-structures concepts replace the hand-authored EngineCanvas walkthrough (trace console, "state after event",
   scrubber) with `LessonDemo`: the Playground's engine and scene on a fixed setup, Previous/Next only. The Explore link
   is derived from the same setup (`exploreFor`), so the lesson and Playground run the same scenario key.
2. **Recursion** is the reference design: six short sections, the factorial code (engine rule `n <= 1`),
   `RecursionDemo` (7-step call/return sequence + conceptual frames) derived from `buildRecursionTimeline` via
   `recursionSteps`, misconception, check, Explore to `?structure=recursion&fn=factorial&n=3&base=1&limit=8`.
3. **Non-engine concepts** (DNS, web request, TCP, queues, …) keep their reviewed illustration, now labelled
   "CONCEPTUAL ILLUSTRATION", with a fixed request-track layout (words no longer break) and, where a Playground fits, one
   Explore link. DNS and web-request gain a misconception and a check.
4. **System Design lessons**: a lesson with a guided cycle no longer embeds a second "Explore freely" mini-playground;
   `ExploreDesigns` links each lesson design into the Architecture Playground (`?lesson=&variant=&rate=`), built by
   `lessonDesign` (shared with the lesson's free experiment), saved like a template copy, with "Back to the lesson".
   `design-projects` has no cycle, so its free experiment stays: it is the lesson's experiment and completion source.
5. **Hand-offs**: `PathNext` takes `playground={false}` when the page already has its Explore link (no duplicate);
   after a practice step it adds "Try a real implementation" from `unitLabs` (only units with labs). The Structures
   Playground's result adds "Test your understanding in a mission" (`unitForStructure`).
6. **Progress**: concept pages only record visits (App.tsx), unchanged. No ids, keys or completion rules changed.
   SD lessons complete by running their experiment, as before (the guided run records it; free Playground runs never did
   count for anything but the lesson's own free mode, which only `design-projects` keeps).

## Milestones

- [x] Audit (routes, components, tests that depend on them)
- [x] Recursion lesson refactor, DS concept pages, DNS/web-request content, canvas label and layout fix
- [x] System Design lesson / Architecture Playground hand-off
- [x] Playground → Practice, Practice → Lab links
- [x] Unit tests (`tests/learning-modes.test.ts`), e2e (`e2e/learning-modes.spec.ts`), updated SD/DS specs
- [ ] Full Playwright suite on all projects, build, bundle measurement, screenshots
- [ ] Docs (`docs/LEARNING-MODES.md`), final commit and push

## Next action

Run `npm run build` and `npx playwright test` (all projects), fix any failures, measure bundles, then write docs and push.
