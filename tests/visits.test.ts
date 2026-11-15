import test from "node:test";
import assert from "node:assert/strict";
import { loadVisits, recordVisit, VISITS_KEY } from "../src/learning/visits.ts";

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("visits are added to their own key, counted, and keep the first time", () => {
  const s = memory({ "kitab.learning.v1": "{\"version\":1,\"lessons\":{}}" });
  recordVisit(s, "connections", "2026-11-01T10:00:00.000Z");
  const v = recordVisit(s, "connections", "2026-11-02T10:00:00.000Z");
  assert.deepEqual(v.activities.connections, { first: "2026-11-01T10:00:00.000Z", last: "2026-11-02T10:00:00.000Z", count: 2 });
  assert.deepEqual(loadVisits(s), v);
  assert.equal(s.data.get("kitab.learning.v1"), "{\"version\":1,\"lessons\":{}}", "no other store is touched");
});

test("a missing store reads as empty; damaged data is kept aside, never silently dropped", () => {
  assert.deepEqual(loadVisits(memory()), { version: 1, activities: {} });
  const s = memory({ [VISITS_KEY]: "{broken" });
  assert.deepEqual(loadVisits(s), { version: 1, activities: {} });
  assert.equal(s.data.get(`${VISITS_KEY}.corrupt`), "{broken");
  const wrongShape = memory({ [VISITS_KEY]: JSON.stringify({ version: 2, activities: {} }) });
  assert.deepEqual(loadVisits(wrongShape), { version: 1, activities: {} });
});

test("storage that refuses writes never throws", () => {
  const refusing = { getItem: () => null, setItem: () => { throw new Error("quota"); } };
  assert.equal(recordVisit(refusing, "connections").activities.connections.count, 1);
});

test("the store keeps the most recent visits when full", () => {
  const s = memory();
  for (let i = 0; i < 305; i++) recordVisit(s, `concept:c${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
  const v = loadVisits(s);
  assert.equal(Object.keys(v.activities).length, 300);
  assert.ok(v.activities["concept:c304"]);
  assert.equal(v.activities["concept:c0"], undefined);
});
