// Browser-local stores of keyed records, { version, <collection>: { id: record } }, read and written record by
// record. A record this Kitab can't read (damaged, or written by a newer Kitab) is left out of what is returned
// and written back untouched on the next save, so it never costs the learner the others. A store with another
// version is never overwritten. Every save reads the store again and changes only what the caller changes, so a
// second tab's records are never replaced by this tab's stale copy. Only zod types: this loads on every page.
import type { z } from "zod";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;
type Collections = Record<string, z.ZodType>;
export type Records<C extends Collections> = { [K in keyof C]: Record<string, z.output<C[K]>> };
/** ok: every record read. partial: some records unreadable (kept). unreadable: not this format (kept aside). */
export type StoreStatus = "empty" | "ok" | "partial" | "unreadable" | "newer" | "unavailable";
export type Read<C extends Collections> = { records: Records<C>; status: StoreStatus };

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const empty = <C extends Collections>(collections: C) => Object.fromEntries(Object.keys(collections).map((name) => [name, {}])) as Records<C>;

/** A copy of data this Kitab can't use, beside it. An earlier copy is never replaced. False if storage refused. */
export function keepAside(storage: StorageLike, key: string, raw: string) {
  try {
    const existing = storage.getItem(`${key}.corrupt`);
    if (existing === raw) return true;
    storage.setItem(existing === null ? `${key}.corrupt` : `${key}.corrupt.${Date.now()}`, raw);
    return true;
  } catch {
    return false;
  }
}

type Parsed<C extends Collections> = { top: Record<string, unknown>; records: Records<C>; unread: Record<string, Record<string, unknown>>; status: StoreStatus; raw: string | null };

function parse<C extends Collections>(storage: StorageLike, key: string, version: number, collections: C): Parsed<C> {
  const records = empty(collections);
  const unread: Record<string, Record<string, unknown>> = {};
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { top: {}, records, unread, status: "unavailable", raw: null };
  }
  if (raw === null) return { top: {}, records, unread, status: "empty", raw };
  let top: unknown;
  try {
    top = JSON.parse(raw);
  } catch {
    return { top: {}, records, unread, status: "unreadable", raw };
  }
  if (!isObject(top) || !Object.keys(collections).every((name) => top[name] === undefined || isObject(top[name]))) return { top: {}, records, unread, status: "unreadable", raw };
  if (top.version !== version) return { top, records, unread, status: "newer", raw };
  let status: StoreStatus = "ok";
  for (const [name, schema] of Object.entries(collections)) {
    unread[name] = {};
    for (const [id, value] of Object.entries((top[name] ?? {}) as Record<string, unknown>)) {
      const result = schema.safeParse(value);
      if (result.success) (records[name] as Record<string, unknown>)[id] = result.data;
      else (unread[name][id] = value), (status = "partial");
    }
  }
  return { top, records, unread, status, raw };
}

/** Every readable record. Data that can't be used as it is gets a copy kept aside; nothing is ever removed. */
export function readStore<C extends Collections>(storage: StorageLike, key: string, version: number, collections: C): Read<C> {
  const { records, status, raw } = parse(storage, key, version, collections);
  if (raw !== null && status !== "ok") keepAside(storage, key, raw);
  return { records, status };
}

/**
 * Read the store again, apply `change` to its readable records and write it back with every unreadable record
 * and unknown field untouched. Not written (saved: false) when storage refuses, the store has another version,
 * or it can't be read and a copy couldn't be kept aside first. The changed records are returned either way.
 */
export function updateStore<C extends Collections>(storage: StorageLike, key: string, version: number, collections: C, change: (records: Records<C>) => void): { records: Records<C>; saved: boolean } {
  const { top, records, unread, status, raw } = parse(storage, key, version, collections);
  change(records);
  if (status === "unavailable" || status === "newer") return { records, saved: false };
  if (status === "unreadable" && raw !== null && !keepAside(storage, key, raw)) return { records, saved: false };
  const next: Record<string, unknown> = { ...(status === "unreadable" ? {} : top), version };
  for (const name of Object.keys(collections)) next[name] = { ...unread[name], ...records[name] };
  try {
    storage.setItem(key, JSON.stringify(next));
    return { records, saved: true };
  } catch {
    return { records, saved: false };
  }
}
