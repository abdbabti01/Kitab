# Kitab

Learn how systems work by predicting, running and explaining them. Each
**mission** asks one practical question about a real mechanism — TCP loss and
windows, array insertion, linked lists, hashing, BST search, breadth-first
search, recursion — and checks your prediction against a deterministic engine.
**Kitab**, an animated guide, points at the evidence, offers hints and explains
steps from the same state you see.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and
[docs/VERIFICATION.md](docs/VERIFICATION.md) for what has been tested.

## Run locally

Requires Node 22.12+ (`.nvmrc`).

```sh
npm ci
npm run dev            # UI only; /api calls fail and Kitab uses reviewed fallbacks
npm run preview:local   # http://localhost:5175 — UI + the real Worker handler with fake D1/AI (scripted, not real AI)
```

## Checks

```sh
npm test               # engines, missions, tutor evaluation fixtures, Worker integration (fake D1/AI)
npm run typecheck      # frontend, Worker + shared contracts, e2e
npm run build          # tests + typecheck + production build
npx playwright install chromium && npx playwright test     # browser journeys at 1440/1024/768/390
KITAB_PERF=1 npx playwright test perf --workers=1          # optional frame-timing measurement
```

## Deploy (Cloudflare)

- Build command: `npm run build` · Deploy: `npx wrangler deploy` · Preview: `npx wrangler versions upload`
- Bindings in `wrangler.jsonc`: `AI`, `DB` (D1 `kitab-db`), `ASSETS`. Model and limits are `vars`.
- `dist/` is no longer committed; the build command produces it.
- **Before deploying this release, apply the new migration** (append-only):

```sh
npx wrangler d1 migrations list kitab-db --remote
npx wrangler d1 migrations apply kitab-db --remote   # applies 0003_missions_ai_reliability.sql
```

Without AI or D1 bindings, missions still work fully; drafts are unavailable and
the tutor uses reviewed fallbacks.
