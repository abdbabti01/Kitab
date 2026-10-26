import type { D1Database } from "./env.ts";
import { today } from "./http.ts";

export type Reservation = { scope: string; subject: string; limit: number };

/**
 * Reserves one unit in a single conditional UPSERT. D1 executes each
 * statement atomically, so two concurrent requests that both observe
 * count 19 cannot both be admitted under a limit of 20: the second
 * statement's WHERE fails and RETURNING yields no row.
 */
async function reserveOne(db: D1Database, item: Reservation, tokenBudget: number | null, day: string) {
  if (item.limit <= 0) return false;
  const row = await db
    .prepare(
      `INSERT INTO usage_counters (scope, subject, day, count, tokens) VALUES (?, ?, ?, 1, 0)
       ON CONFLICT(scope, subject, day) DO UPDATE SET count = count + 1
       WHERE usage_counters.count < ? AND (? IS NULL OR usage_counters.tokens < ?)
       RETURNING count`,
    )
    .bind(item.scope, item.subject, day, item.limit, tokenBudget, tokenBudget)
    .first<{ count: number }>();
  return row !== null;
}

async function releaseOne(db: D1Database, item: Reservation, day: string) {
  await db.prepare("UPDATE usage_counters SET count = count - 1 WHERE scope = ? AND subject = ? AND day = ? AND count > 0").bind(item.scope, item.subject, day).run();
}

/**
 * Reserves every scope or none. A failed later scope releases the earlier
 * ones. `tokenBudget` applies to the global scope (last item) only.
 */
export async function reserve(db: D1Database, items: Reservation[], tokenBudget: number | null = null, day = today()) {
  const taken: Reservation[] = [];
  for (const [index, item] of items.entries()) {
    const ok = await reserveOne(db, item, index === items.length - 1 ? tokenBudget : null, day);
    if (!ok) {
      await Promise.all(taken.map((done) => releaseOne(db, done, day).catch(() => undefined)));
      return { ok: false as const, exhausted: item.scope };
    }
    taken.push(item);
  }
  return { ok: true as const, release: () => Promise.all(taken.map((done) => releaseOne(db, done, day))) };
}

export async function recordTokens(db: D1Database, scope: string, tokens: number, day = today()) {
  if (!tokens) return;
  await db.prepare("UPDATE usage_counters SET tokens = tokens + ? WHERE scope = ? AND subject = 'global' AND day = ?").bind(tokens, scope, day).run();
}
