import type { D1Database } from "./env.ts";
import { today } from "./http.ts";

export type Reservation = { scope: string; subject: string; limit: number };

/**
 * Reserves one call in a single conditional UPSERT. D1 executes each
 * statement atomically, so two concurrent requests that both observe
 * count 19 cannot both be admitted under a limit of 20: the second
 * statement's WHERE fails and RETURNING yields no row.
 */
async function reserveOne(db: D1Database, item: Reservation, day: string) {
  if (item.limit <= 0) return false;
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (scope, subject, day, count, tokens) VALUES (?, ?, ?, 1, 0)
       ON CONFLICT(scope, subject, day) DO UPDATE SET count = count + 1
       WHERE usage_counters.count < ?
       RETURNING count`,
    )
    .bind(item.scope, item.subject, day, item.limit)
    .first<{ count: number }>();
  return row !== null;
}

async function releaseOne(db: D1Database, item: Reservation, day: string) {
  await db.prepare("UPDATE usage_counters SET count = count - 1 WHERE scope = ? AND subject = ? AND day = ? AND count > 0").bind(item.scope, item.subject, day).run();
}

/** Per-IP / per-session / per-endpoint call limits: every scope or none; a failed later scope releases the earlier ones. */
export async function reserve(db: D1Database, items: Reservation[], day = today()) {
  const taken: Reservation[] = [];
  for (const item of items) {
    const ok = await reserveOne(db, item, day);
    if (!ok) {
      await Promise.all(taken.map((done) => releaseOne(db, done, day).catch(() => undefined)));
      return { ok: false as const, exhausted: item.scope };
    }
    taken.push(item);
  }
  return { ok: true as const, release: () => Promise.all(taken.map((done) => releaseOne(db, done, day))) };
}

// ---------------------------------------------------------------- shared AI Neuron allowance

/**
 * The one daily row every inference call (drafts, tutor, composition, and every retry) draws on. The
 * `tokens` column of this row holds Neurons, Cloudflare's billing unit; the day is UTC, as is Cloudflare's
 * daily reset.
 */
export const NEURON_SCOPE = "ai-neurons";

/**
 * Neurons per million input and output tokens, from the Workers AI pricing page (checked 2026-10-27).
 * A model missing here cannot be bounded, so it is never called.
 */
export const MODEL_NEURONS: Record<string, { input: number; output: number }> = {
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { input: 13_778, output: 26_128 },
};

export function neuronsFor(model: string, inputTokens: number, outputTokens: number) {
  const rate = MODEL_NEURONS[model];
  return rate ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : null;
}

/**
 * Upper-bound estimate for one call, or null for an unpriced model: input characters / 3 (tokenizers average
 * roughly 4 characters per English token, so this over-counts; the response schema is counted as input too)
 * plus the full `max_tokens` output allowance, at the model's Neuron rates.
 */
export function estimateNeurons(model: string, input: { messages?: unknown; response_format?: unknown; max_tokens?: unknown }) {
  const chars = JSON.stringify(input.messages ?? "").length + JSON.stringify(input.response_format ?? "").length;
  const output = typeof input.max_tokens === "number" && input.max_tokens > 0 ? input.max_tokens : 256;
  const neurons = neuronsFor(model, Math.ceil(chars / 3), output);
  return neurons === null ? null : Math.ceil(neurons);
}

/**
 * Reserves `neurons` against the daily budget in one statement, on both the first insert of the day and
 * every later update: nothing is written unless reserved total + `neurons` ≤ budget. A budget of 0 admits
 * nothing, even on a fresh database.
 *
 * `settle(actual)` replaces the reservation with the Neurons computed from model-reported usage. When usage
 * is not reported (`null`: timeout, transport error, missing `usage`), the reservation stands, so inference
 * is never recorded as free.
 */
export async function reserveNeurons(db: D1Database, neurons: number, budget: number, day = today()) {
  const amount = Math.max(1, Math.ceil(neurons));
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (scope, subject, day, count, tokens)
       SELECT ?, 'global', ?, 1, ? WHERE ? <= ?
       ON CONFLICT(scope, subject, day) DO UPDATE SET count = count + 1, tokens = tokens + excluded.tokens
       WHERE usage_counters.tokens + excluded.tokens <= ?
       RETURNING tokens`,
    )
    .bind(NEURON_SCOPE, day, amount, amount, budget, budget)
    .first<{ tokens: number }>();
  if (!row) return { ok: false as const };
  return {
    ok: true as const,
    reserved: amount,
    settle: async (actual: number | null) => {
      if (actual === null || !Number.isFinite(actual)) return;
      const delta = Math.max(0, Math.ceil(actual)) - amount;
      if (delta !== 0) await db.prepare("UPDATE usage_counters SET tokens = MAX(0, tokens + ?) WHERE scope = ? AND subject = 'global' AND day = ?").bind(delta, NEURON_SCOPE, day).run();
    },
  };
}
