# Progress ledger — feature/kitab-missions-guide

Start: branch `main` @ `8552fa48bb14ad09276e07e2a32bc6b59aeb9021`, clean tree. Baseline `npm test`: 29/29 pass.
Runtime: Node 22.14 (local), npm 9.9. No `wrangler`, no `gh` CLI locally. Playwright browsers available.

## Reproduced at baseline
- TCP: default timeline 37 events, payload 500 B → 31; old index 36 reads `undefined` (crash path).
- BFS target 12 reported unreachable (frame-count guard).
- rwnd = 1: independent ledger sees 2 unacked segments at `segment-2-sent`.
- Array search narration `0x1010` vs cell `0x1004`.
- Worker quota: read-then-increment (non-atomic); version/audit writes in `waitUntil`.
- Model `@cf/meta/llama-3.1-8b-instruct-fast` absent from current Cloudflare catalog/pricing (checked 2026-10-25).
- `npm audit`: 3 high (vite 8.2.2, zod 4.5.4, source-map-js).

## Decisions
- Default model `@cf/meta/llama-3.1-8b-instruct-fp8` ($0.152/M in, $0.287/M out), overridable by `AI_MODEL`.
- Cross-instance coalescing via a D1 lease row, not instance memory.
- Missions are validated config; correct answers are engine facts, never option position.
- Retry moves to the next variant so the answer changes.
- Guide art direction: code-native SVG "book spirit" (DESIGN.md).
- Legacy shells (LearningStudio, TcpReferenceLesson, DataStructuresLab, VisualLab, flow canvas) removed after
  confirming every route is served by the new app; `/lesson/*` and `/visual-lab` redirect.
- `dist/` and build artifacts untracked; deploy builds them.

## Milestones
1. [x] Domain correctness — `07ff371`
2. [x] Generic runtime — `6c16ab2`; tutor contract — `2ce0f3b`
3. [x] Mission experience, scenes, motion, guide, routes, browser journeys — `2987352`
4. [x] Worker: atomic quota, coalescing, batch persistence, tutor, feedback, contract — `f4b159e`
5. [x] Route splitting, router tests, UI↔Worker harness, frame timing — `3ea1413`
6. [x] Scenario composition, light canvas theme, docs, CI — (this commit)

## Remaining limits (see docs/VERIFICATION.md)
- No live Workers AI / staging run; no `wrangler dev`; migration 0003 verified on SQLite only.
- No real-device or screen-reader pass.
- 4× CPU-throttled playback shows 150–280 ms long frames on step transitions.
