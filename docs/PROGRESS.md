# Progress ledger — feature/kitab-missions-guide

Start: branch `main` @ `8552fa48bb14ad09276e07e2a32bc6b59aeb9021`, clean tree. Baseline `npm test`: 29/29 pass.
Runtime: Node 22.14 (local), npm 9.9. No `wrangler`, no `gh` CLI locally. Playwright browsers present.

## Reproduced at baseline
- TCP: default timeline 37 events, payload 500 B → 31; old index 36 reads `undefined` (crash path).
- BFS target 12 reported unreachable (frame-count guard).
- rwnd = 1: independent ledger sees 2 unacked segments at `segment-2-sent`.
- Array search narration `0x1010` vs cell `0x1004`.
- Worker quota: read-then-increment (non-atomic); version/audit writes in `waitUntil`.
- Model `@cf/meta/llama-3.1-8b-instruct-fast` absent from current Cloudflare catalog/pricing (checked 2026-10-25).
- `npm audit`: 3 high (vite 8.2.2, zod 4.5.4, source-map-js).

## Decisions
- Default model `@cf/meta/llama-3.1-8b-instruct-fp8` ($0.152/M in, $0.287/M out per CF pricing page, 2026-10-25), overridable by `AI_MODEL`.
- Cross-instance coalescing via a D1 lease row, not instance memory.
- Missions are validated config; correct answers are engine facts, never option position.
- Guide art direction: code-native SVG "book spirit" (see DESIGN.md).

## Milestones
1. [x] Domain correctness (BFS, TCP ledger, addresses, recursion engine) — `07ff371`
2. [ ] Generic runtime: adapters, registry, mission schema, controller, progress, routes
3. [ ] Mission experience UI + scenes + motion
4. [ ] Kitab guide
5. [ ] Worker: atomic quota, coalescing, batch persistence, tutor, feedback, contract
6. [ ] QA: browser journeys, screenshots, CI, docs

## Remaining / blockers
- (updated as work proceeds)
