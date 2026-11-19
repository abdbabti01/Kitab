# Checkpoint: Real Engineering Lab

Resume with: "Resume the Kitab Real Engineering Lab project from `docs/work-in-progress/real-engineering-lab.md` and
continue autonomously until completion."

- Branch: `feature/real-engineering-lab` (from `origin/main` at 5be70b4, PR #88 merged). Worktree: `../Kitab-lab`.
- Automatic continuation: none configured (no persistent runner available in this environment).

## Decisions (full record: docs/ENGINEERING-LAB.md)

- Code labs: learner JS runs in a Worker inside an `<iframe sandbox="allow-scripts">` (opaque origin) whose CSP
  blocks all network; fresh frame per run; hard kill at the time limit. Harness: `src/lab/harness.ts`; protocol:
  `src/lab/sandbox.ts`; launcher: `src/lab/run.ts`.
- HTTP labs: real `fetch` to same-origin `/api/lab/*` (`worker/lab.ts`), no outbound calls, no D1/AI. Dev and
  preview serve the same handler (`vite.config.ts` plugin).
- Persistence: `kitab.engineering-labs.v1` via `keyed-store` (`src/lab/progress.ts`).
- Routes: `/lab`, `/lab/:subject/:id` (subjects networking | structures | architecture).

## Milestones

1. [x] Audit, ADR + threat model
2. [x] Typed contracts (`src/lab/model.ts`), catalog (15 labs + 8 unavailable), worker endpoints
3. [x] Harness, sandbox protocol, HTTP client, persistence
4. [x] Node tests: lab-content (solutions pass / starters fail against the real harness and handler),
   lab-endpoints, lab-harness, lab-progress
5. [x] UI: catalog page, lab page (code + HTTP workspaces), nav entry, roadmap links, styles
6. [x] Browser tests (`e2e/engineering-lab.spec.ts`, shell + design specs updated); screenshots 40–46 in docs/screenshots
7. [x] Full verification: npm test 732/732, typecheck, build, all 5 Playwright projects (failures under local load rerun green with one worker)
8. [x] Docs (ARCHITECTURE.md section, routes, docs/ENGINEERING-LAB.md), push

## Status

Complete and pushed. Not merged or deployed (PR creation, CI and merge are handled outside this session).
Local Playwright note: this machine runs many other sessions' dev servers; use free ports
(`KITAB_UI_PORT=7811 KITAB_API_PORT=7812`) and fewer workers.
