// Which learning activities have been opened, and when: explorations, starter networks, readings and every
// lesson or mission page. A separate, additive store: the lesson, mission and networking stores are never read
// or written here. A visit is only a visit; it never counts as completing anything.
import { z } from "zod";
import { readStore, updateStore } from "./keyed-store.ts";

export const VISITS_KEY = "kitab.visits.v1";
const MAX = 300;

const entry = z.object({ first: z.string().max(40), last: z.string().max(40), count: z.number().int().min(1) }).strict();
const schema = z.object({ version: z.literal(1), activities: z.record(z.string().max(160), entry) }).strict();
export type Visits = z.infer<typeof schema>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const emptyVisits = (): Visits => ({ version: 1, activities: {} });

/** Readable visits; a damaged or newer entry is kept as it is (see keyed-store.ts), never silently dropped. */
export function loadVisits(storage: StorageLike): Visits {
  return { version: 1, activities: readStore(storage, VISITS_KEY, 1, { activities: entry }).records.activities };
}

/** If storage is full or unavailable, the visit is simply not remembered. */
export function recordVisit(storage: StorageLike, id: string, now = new Date().toISOString()): Visits {
  let next = emptyVisits();
  updateStore(storage, VISITS_KEY, 1, { activities: entry }, (records) => {
    const previous = records.activities[id];
    records.activities[id] = { first: previous?.first ?? now, last: now, count: (previous?.count ?? 0) + 1 };
    // Keep the most recent visits when the store is full.
    const old = Object.entries(records.activities).sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(MAX);
    for (const [key] of old) delete records.activities[key];
    next = { version: 1, activities: records.activities };
  });
  return next;
}
