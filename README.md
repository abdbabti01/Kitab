# Code Atlas

A standalone React/Vite website with interactive beginner-friendly visualizations of TCP, web requests, and data structures.

## Run locally

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Run `npm run dev`.

## Deploy to Cloudflare Pages

Push this folder to a GitHub repository, then create a Cloudflare Pages project with:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`

## Enable “search any concept”

The search feature uses Cloudflare Workers AI directly. No external AI API key is required.

1. Create a Cloudflare D1 database named `code-atlas-db`.
2. Copy its database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
3. Run `npx wrangler d1 migrations apply code-atlas-db --remote` once to create the tables.
4. Redeploy the Worker. The `AI` binding in `wrangler.jsonc` connects the site to Workers AI automatically.

Important: every time you download a fresh Code Atlas package, replace the placeholder D1 ID in `wrangler.jsonc` with your real database ID before deploying.

If search reports that the database is not connected, verify the D1 ID and run:

`npx wrangler d1 migrations apply code-atlas-db --remote`

Every search checks D1 first. Only a missing concept calls Workers AI; the generated lesson is then stored and reused. Each IP can generate at most 20 new lessons per UTC day, while saved lessons remain unlimited.

Cloudflare build settings:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production command: `npx wrangler versions upload`
