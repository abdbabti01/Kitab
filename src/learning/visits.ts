// Which learning activities have been opened, and when: explorations, starter networks, readings and every
// lesson or mission page. A separate, additive store: the lesson, mission and networking stores are never read
// or written here. A visit is only a visit; it never counts as completing anything.
import { z } from "zod";

export const VISITS_KEY = "kitab.visits.v1";
const MAX = 300;

const entry = z.object({ first: z.string().max(40), last: z.string().max(40), count: z.number().int().min(1) }).strict();
const schema = z.object({ version: z.literal(1), activities: z.record(z.string().max(160), entry) }).strict();
export type Visits = z.infer<typeof schema>;
type StorageLike = Pick<Storage, "getItem" | "setItem">;

export const emptyVisits = (): Visits => ({ version: 1, activities: {} });

/** Damaged or unreadable data reads as no visits; it is kept aside, never silently dropped. */
export function loadVisits(storage: StorageLike): Visits {
  let raw: string | null = null;
  try {
    raw = storage.getItem(VISITS_KEY);
    if (!raw) return emptyVisits();
    return schema.parse(JSON.parse(raw));
  } catch {
    try {
      if (raw) storage.setItem(`${VISITS_KEY}.corrupt`, raw.slice(0, 50_000));
    } catch {
      // storage unavailable
    }
    return emptyVisits();
  }
}

export function recordVisit(storage: StorageLike, id: string, now = new Date().toISOString()): Visits {
  const visits = loadVisits(storage);
  const previous = visits.activities[id];
  const activities = { ...visits.activities, [id]: { first: previous?.first ?? now, last: now, count: (previous?.count ?? 0) + 1 } };
  // Keep the most recent visits when the store is full.
  const kept = Object.entries(activities).sort((a, b) => b[1].last.localeCompare(a[1].last)).slice(0, MAX);
  const next: Visits = { version: 1, activities: Object.fromEntries(kept) };
  try {
    storage.setItem(VISITS_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable: the visit is simply not remembered
  }
  return next;
}
