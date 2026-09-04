# Kitab

A React/Vite and Cloudflare Workers learning platform with deterministic reference simulations, specialized concept-family renderers, and AI-assisted draft lessons.

## Visualization system

Kitab no longer draws every concept as the same generic graph. It chooses one of eight responsive engines:

- Protocols: endpoints, layers, packets and network paths
- Requests: ordered browser, DNS, API and database traces
- Memory: cells, addresses, buckets, nodes and references
- Trees and graphs: deterministic levels and traversal decisions
- Execution: code traces and runtime frames
- Concurrency: actors on a shared time axis
- Distributed systems: services and a message ledger
- State machines: states and named transitions

The thirteen built-in chapters have reviewed engine blueprints, including a Data Structures overview plus visible examples for distributed systems and state machines. The home page exposes all eight engine families in an “Explore by system” browser. A new search asks Workers AI for semantic actors, links and events, validates all references and topic relevance, deterministically selects the appropriate engine, and saves the draft in D1. AI engine labels are treated only as hints.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev`.

Open `/lesson/tcp` for the reference TCP learning system. The former
`/visual-lab` address redirects to the same rebuilt experience.

## Deploy to Cloudflare Pages

Push this folder to a GitHub repository, then create a Cloudflare Pages project with:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`

## Enable “search any concept”

The search feature uses Cloudflare Workers AI directly. No external AI API key is required.

1. Create a Cloudflare D1 database named `kitab-db`.
2. Copy its database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
3. Run `npx wrangler d1 migrations apply kitab-db --remote` after every release that adds a migration.
4. Redeploy the Worker. The `AI` binding in `wrangler.jsonc` connects the site to Workers AI automatically.

Important: every time you download a fresh Kitab package, replace the placeholder D1 ID in `wrangler.jsonc` with your real database ID before deploying.

If search reports that the database is not connected, verify the D1 ID and run:

`npx wrangler d1 migrations apply kitab-db --remote`

Every search checks D1 first. Saved matches appear in the library as the learner types. Only a missing, outdated or rejected concept calls Workers AI; the generated draft is validated, versioned, stored, and reused. Generated schema version 2 automatically prevents older unverified drafts from being reused. AI provides semantic actors, structural links and chronological events, while Kitab owns engine choice, layout and playback. Each IP can generate at most 20 new lessons per UTC day, while saved lessons remain unlimited.

## Verification

Run `npm test` for the TCP invariants, deterministic engine routing, off-topic lesson rejection, visible examples, compatibility, graph-layout, responsive-layout and Workers AI contract checks. `npm run build` runs the full test suite automatically before the production build.

Cloudflare build settings:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production command: `npx wrangler versions upload`
