# Checkpoint: Identity, Authentication & Security track

Branch: `feature/identity-security-mastery` (from `origin/main` 52196ca, which already contains the Learning
Experience Refactor, PR #91).

Resume instruction: "Resume the Kitab Identity & Security Mastery project from
docs/work-in-progress/identity-security-mastery.md and continue autonomously until all deliverables are finished."

## Done
- Engine: `src/identity/` model (one event stream per run, fold `stateAt`, `outcomeOf`), ten scenarios in
  `flows/`, sync SHA-256 for real PKCE challenges, authorization policy engine (`authz.ts`), real Web Crypto JWT
  validation (`jwt.ts`). Tests: `tests/identity-engine.test.ts`.

## Next
Track integration, content units, Playground UI, Token Inspector, Authorization Playground, experiments,
challenges, labs, language examples, docs, browser tests.
