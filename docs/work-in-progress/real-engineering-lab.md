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
5. [ ] UI: catalog page, lab page (code + HTTP workspaces), nav entry, roadmap links, styles
6. [ ] Browser tests (journeys, security, layout at 5 widths), screenshots
7. [ ] Full verification: npm test, typecheck, build, all 5 Playwright projects
8. [ ] Docs (ARCHITECTURE.md section, routes), final report, push

## Next action

Build `src/lab/ui/` (LabsPage, LabPage, CodeWorkspace, HttpWorkspace, lab.css), wire routes in `src/app/App.tsx`,
add "Lab" to `SiteHeader`, then update `e2e/site-shell.spec.ts` for the fourth navigation entry.
