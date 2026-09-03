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

The search feature calls OpenAI from the Cloudflare Worker so the API key is never exposed in the browser.

1. Create a Cloudflare D1 database named `code-atlas-db`.
2. Copy its database ID into `wrangler.jsonc`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.
3. Run `npx wrangler d1 migrations apply code-atlas-db --remote` once to create the tables.
4. Create an OpenAI API key at `platform.openai.com/api-keys` (API billing is separate from a ChatGPT subscription).
5. In Cloudflare, open this Worker → Settings → Variables and Secrets.
6. Add an encrypted secret named `OPENAI_API_KEY`.
7. Redeploy the Worker.

Every search checks D1 first. Only a missing concept calls OpenAI; the generated lesson is then stored and reused. Each IP can generate at most 20 new lessons per UTC day, while saved lessons remain unlimited.

Cloudflare build settings:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production command: `npx wrangler versions upload`
