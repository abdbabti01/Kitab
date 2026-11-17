import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SAVES, saveNamed, savedNetworks, SAVES_KEY } from "../src/practice/network/storage.ts";
import { starter, starterOptions } from "../src/practice/network/starters.ts";

// Named network saves are never replaced or dropped without the learner agreeing, and one unreadable save never
// hides or blocks the others.

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("a save with the same name is replaced only when asked", () => {
  const s = memory();
  const first = starter("internet");
  assert.equal(saveNamed(first, false, s), "saved");
  const other = { ...starter(starterOptions.find((o) => starter(o.id).devices.length !== first.devices.length)!.id), name: first.name };
  assert.equal(saveNamed(other, false, s), "exists");
  assert.equal(savedNetworks(s)[0].network.devices.length, first.devices.length, "the first save is untouched");
  assert.equal(saveNamed(other, true, s), "saved");
  assert.equal(savedNetworks(s).length, 1);
  assert.equal(savedNetworks(s)[0].network.devices.length, other.devices.length);
});

test("a full list never drops the oldest save without being asked", () => {
  const s = memory();
  for (let i = 0; i < MAX_SAVES; i++) assert.equal(saveNamed({ ...starter("internet"), name: `n${i}` }, false, s), "saved");
  const extra = { ...starter("internet"), name: "one more" };
  assert.equal(saveNamed(extra, false, s), "full");
  assert.equal(savedNetworks(s).length, MAX_SAVES);
  assert.ok(savedNetworks(s).some((e) => e.name === "n0"));
  assert.equal(saveNamed(extra, true, s), "saved");
  assert.equal(savedNetworks(s).length, MAX_SAVES);
  assert.ok(!savedNetworks(s).some((e) => e.name === "n0"), "the oldest goes, with consent");
});

test("an unreadable save is left out of the list, kept in storage, and doesn't block saving", () => {
  const damaged = { name: "broken", network: { devices: "nope" } };
  const s = memory({ [SAVES_KEY]: JSON.stringify([damaged]) });
  assert.deepEqual(savedNetworks(s), []);
  assert.equal(saveNamed(starter("internet"), false, s), "saved");
  assert.deepEqual(JSON.parse(s.data.get(SAVES_KEY)!)[1], damaged);
});
