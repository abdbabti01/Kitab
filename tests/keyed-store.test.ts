import test from "node:test";
import assert from "node:assert/strict";
import { loadProgress, PROGRESS_KEY, saveProgress, type Progress } from "../src/learning/progress.ts";
import { loadLearning, LEARNING_KEY, saveLearning } from "../src/learning/lessons/progress.ts";
import { loadMissionStore, MISSIONS_KEY, saveMissionStore } from "../src/practice/network/mission-progress.ts";
import { loadArchitectureProgress, PROGRESS_KEY as ARCH_KEY, recordExperiment, saveChallengeDesign } from "../src/architecture/progress.ts";
import { LABS_KEY, loadLabProgress, saveLabConfig } from "../src/architecture/labs/progress.ts";
import { loadVisits, recordVisit, VISITS_KEY } from "../src/learning/visits.ts";

// Saved learner progress is never lost to one damaged record, a newer Kitab's data, a second tab, or a full
// storage quota. Every store of keyed records goes through src/learning/keyed-store.ts.

function memory(initial: Record<string, string> = {}, quota = Infinity) {
  const data = new Map(Object.entries(initial));
  const size = () => [...data].reduce((n, [k, v]) => n + k.length + v.length, 0);
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      const before = data.get(key);
      data.set(key, value);
      if (size() > quota) {
        before === undefined ? data.delete(key) : data.set(key, before);
        throw new DOMException("full", "QuotaExceededError");
      }
    },
    removeItem: (key: string) => void data.delete(key),
  };
}

const mission = (id: string) => ({ missionVersion: "1", visits: 1, lastVisitedAt: "2026-11-01", masteredAt: null, attempts: [], current: null });
const progressWith = (ids: string[]): Progress => ({ version: 1, missions: Object.fromEntries(ids.map((id) => [id, mission(id)])) });

test("one damaged record never costs the others, and is written back exactly as it was", () => {
  const damaged = { missionVersion: "1", visits: "lots" };
  const s = memory({ [PROGRESS_KEY]: JSON.stringify({ version: 1, missions: { good: mission("good"), bad: damaged } }) });
  const { progress, recovered } = loadProgress(s);
  assert.deepEqual(Object.keys(progress.missions), ["good"]);
  assert.equal(recovered, true);
  assert.equal(saveProgress(s, progressWith(["new"]), ["new"]), true);
  const stored = JSON.parse(s.data.get(PROGRESS_KEY)!);
  assert.deepEqual(stored.missions.bad, damaged);
  assert.deepEqual(Object.keys(stored.missions).sort(), ["bad", "good", "new"]);
});

test("a store written by a newer Kitab is never overwritten", () => {
  const newer = JSON.stringify({ version: 2, missions: { a: { future: true } } });
  for (const [key, save] of [
    [PROGRESS_KEY, (s: ReturnType<typeof memory>) => saveProgress(s, progressWith(["a"]))],
    [LEARNING_KEY, (s: ReturnType<typeof memory>) => saveLearning(s, { version: 1, lessons: {} })],
    [MISSIONS_KEY, (s: ReturnType<typeof memory>) => saveMissionStore(s, { version: 1, missions: {} })],
    [ARCH_KEY, (s: ReturnType<typeof memory>) => recordExperiment(s, "x").saved],
    [LABS_KEY, (s: ReturnType<typeof memory>) => saveLabConfig(s, "lab", "1", {}).saved],
  ] as const) {
    const s = memory({ [key]: newer });
    assert.equal(save(s), false, key);
    assert.equal(s.data.get(key), newer, `${key} untouched`);
  }
  const visits = memory({ [VISITS_KEY]: newer });
  recordVisit(visits, "home");
  assert.equal(visits.data.get(VISITS_KEY), newer);
});

test("a second tab's progress survives this tab saving its stale copy", () => {
  const s = memory();
  const tabA = loadProgress(s).progress;
  saveProgress(s, progressWith(["from-tab-b"]), ["from-tab-b"]);
  tabA.missions.mine = mission("mine");
  saveProgress(s, tabA, ["mine"]);
  assert.deepEqual(Object.keys(loadProgress(s).progress.missions).sort(), ["from-tab-b", "mine"]);

  const l = memory();
  const lessonsA = loadLearning(l).learning;
  const record = { lessonVersion: "1", visits: 1, lastVisitedAt: "", seen: [], total: 0, chaptersSeen: [], completedAt: null, experimentsCompleted: [], position: null, updated: false };
  saveLearning(l, { version: 1, lessons: { other: record } }, ["other"]);
  saveLearning(l, { ...lessonsA, lessons: { mine: record } }, ["mine"]);
  assert.deepEqual(Object.keys(loadLearning(l).learning.lessons).sort(), ["mine", "other"]);

  const n = memory();
  const storeA = loadMissionStore(n);
  const attempt = { missionVersion: "1", attempts: [], completedAt: "2026-11-01", masteredAt: null };
  saveMissionStore(n, { version: 1, missions: { other: attempt } }, ["other"]);
  saveMissionStore(n, { ...storeA, missions: { mine: attempt } }, ["mine"]);
  assert.deepEqual(Object.keys(loadMissionStore(n).missions).sort(), ["mine", "other"]);
});

test("unreadable data is kept aside whole, an earlier copy is never replaced, and nothing is overwritten without a copy", () => {
  const big = `{not json ${"x".repeat(120_000)}`;
  const s = memory({ [PROGRESS_KEY]: big, [`${PROGRESS_KEY}.corrupt`]: "an earlier copy" });
  loadProgress(s);
  assert.equal(s.data.get(`${PROGRESS_KEY}.corrupt`), "an earlier copy");
  assert.ok([...s.data].some(([k, v]) => k.startsWith(`${PROGRESS_KEY}.corrupt.`) && v === big), "the whole text, not 50 KB of it");
  assert.equal(s.data.get(PROGRESS_KEY), big, "reading never removes it");

  // No room for a copy: the unreadable data stays where it is and the save says so.
  const full = memory({ [PROGRESS_KEY]: big }, big.length + PROGRESS_KEY.length + 10);
  assert.equal(saveProgress(full, progressWith(["a"])), false);
  assert.equal(full.data.get(PROGRESS_KEY), big);
});

test("a full or blocked storage is reported, and what was stored stays", () => {
  const s = memory({}, 400);
  assert.equal(saveProgress(s, progressWith(["a"])), true);
  const before = s.data.get(PROGRESS_KEY);
  assert.equal(saveProgress(s, progressWith(["a", "b", "c", "d", "e", "f"])), false);
  assert.equal(s.data.get(PROGRESS_KEY), before);

  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(saveChallengeDesign(blocked, "c", "1", {}).saved, false);
  assert.deepEqual(loadArchitectureProgress(blocked), { version: 1, challenges: {}, lessons: {} });
  assert.deepEqual(loadLabProgress(blocked), { version: 1, labs: {}, units: {} });
  assert.deepEqual(loadVisits(blocked), { version: 1, activities: {} });
});

test("fields a newer Kitab added beside the records are kept on save", () => {
  const s = memory({ [ARCH_KEY]: JSON.stringify({ version: 1, challenges: {}, lessons: {}, future: { keep: true } }) });
  assert.equal(recordExperiment(s, "fundamentals").saved, true);
  assert.deepEqual(JSON.parse(s.data.get(ARCH_KEY)!).future, { keep: true });
});
