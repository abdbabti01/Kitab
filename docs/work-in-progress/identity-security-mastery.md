# Checkpoint: Identity, Authentication & Security track

Branch: `feature/identity-security-mastery`, from `origin/main` 52196ca (which already contains the Learning
Experience Refactor, PR #91). Not merged, not deployed.

Resume instruction: "Resume the Kitab Identity & Security Mastery project from
docs/work-in-progress/identity-security-mastery.md and continue autonomously until all deliverables are finished."
No scheduler or persistent runner is configured; resumption is manual.

## Done
- Engine (`src/identity/`): event-stream model, ten scenarios, sync SHA-256 (RFC 7636 vector tested), policy engine,
  Web Crypto JWT validation.
- Track integration: routes, Home card, Learn tab, roadmap, Practice, Playgrounds list, glossary (15 terms), progress
  (`kitab.identity.v1`), StepBar, System Design security unit links to the track.
- Twelve units with checks, decisions, walkthroughs, C#/Java/Python examples, sources.
- Identity Playground, Token Inspector, Authorization Playground, thirteen challenges, eight guided experiments.
- Engineering Lab subject `identity`: twelve code labs, one HTTP lab, `worker/identity-lab.ts`, fixtures (public key
  only), in-sandbox Web Crypto relay for Chromium, credential redaction in saved drafts.
- Language examples: all 15 verified locally (7 run with matching output, 8 build-only) with
  `npm run verify-identity-examples`.
- Tests: `tests/identity-engine.test.ts`, `tests/identity-course.test.ts`, `e2e/identity.spec.ts` (40/40 across the
  four viewport projects). Overflow checked on every identity page at 320 to 1440 px.
- Docs: `docs/IDENTITY.md`, `docs/IDENTITY-STANDARDS.md`, ARCHITECTURE.md, ENGINEERING-LAB.md.

## Standards checked (2026-11-23)
RFC 9700 (BCP 240), RFC 10017 (BCP, Aug 2026), RFC 7636, OIDC Core errata set 2, WebAuthn L3 (Recommendation,
25 Aug 2026), OAuth 2.1 still draft-17. See docs/IDENTITY-STANDARDS.md.

## Remaining
- None outstanding. Existing specs updated for the fourth subject (counts of subjects, Playgrounds, labs, missions);
  screenshots in docs/screenshots/identity; bundle and startup measured (see the final report).
