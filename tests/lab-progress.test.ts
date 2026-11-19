// Saved Engineering Lab work: resumable code and drafts, completion that only grows, other tabs' work kept,
// damaged records kept aside, refused storage reported, and no run results stored.
import assert from "node:assert/strict";
import test from "node:test";
import { LAB_PROGRESS_KEY, lastLab, readLabs, rememberOpened, saveLab, stateOf } from "../src/lab/progress.ts";

class Memory {
  data = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) throw new Error("QuotaExceededError");
    this.data.set(key, value);
  }
}

test("no record is Not started; saved code is In progress; completion is Completed", () => {
  const storage = new Memory();
  assert.equal(stateOf(readLabs(storage).records.labs.arrays), "not-started");
  saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "let a = 1;" }));
  const saved = readLabs(storage).records.labs.arrays;
  assert.equal(saved.code, "let a = 1;");
  assert.equal(stateOf(saved), "in-progress");
  saveLab(storage, "arrays", 1, (r) => ({ ...r, completedAt: 5 }));
  assert.equal(stateOf(readLabs(storage).records.labs.arrays), "completed");
});

test("completion and passed tasks survive a reset and another tab's stale save", () => {
  const storage = new Memory();
  saveLab(storage, "http-inspector", 1, (r) => ({ ...r, tasksDone: ["get"], completedAt: 10 }));
  // A reset (or a tab that loaded before completion) writes a record without them: they're kept.
  saveLab(storage, "http-inspector", 1, (r) => ({ ...r, tasksDone: [], completedAt: undefined, drafts: {} }));
  const saved = readLabs(storage).records.labs["http-inspector"];
  assert.deepEqual(saved.tasksDone, ["get"]);
  assert.equal(saved.completedAt, 10);
});

test("saving one lab never touches another lab's record", () => {
  const storage = new Memory();
  saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "A" }));
  saveLab(storage, "recursion", 1, (r) => ({ ...r, code: "R" }));
  const { labs } = readLabs(storage).records;
  assert.equal(labs.arrays.code, "A");
  assert.equal(labs.recursion.code, "R");
});

test("a damaged record is kept as it was, and the rest still load and save", () => {
  const storage = new Memory();
  storage.setItem(LAB_PROGRESS_KEY, JSON.stringify({ version: 1, labs: { arrays: { labVersion: "nope" }, recursion: { labVersion: 1, tasksDone: [], hints: 0, attempted: false, updatedAt: 1, code: "R" } }, meta: {} }));
  const read = readLabs(storage);
  assert.equal(read.status, "partial");
  assert.equal(read.records.labs.recursion.code, "R");
  saveLab(storage, "recursion", 1, (r) => ({ ...r, code: "R2" }));
  const raw = JSON.parse(storage.getItem(LAB_PROGRESS_KEY)!);
  assert.deepEqual(raw.labs.arrays, { labVersion: "nope" });
  assert.equal(raw.labs.recursion.code, "R2");
});

test("unreadable data is copied aside before anything is saved over it", () => {
  const storage = new Memory();
  storage.setItem(LAB_PROGRESS_KEY, "{not json");
  const { saved } = saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "A" }));
  assert.equal(saved, true);
  assert.equal(storage.getItem(`${LAB_PROGRESS_KEY}.corrupt`), "{not json");
});

test("a refused save is reported, not hidden", () => {
  const storage = new Memory();
  storage.fail = true;
  assert.equal(saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "A" })).saved, false);
  assert.equal(rememberOpened(storage, "arrays"), false);
});

test("a store from a newer Kitab is never overwritten", () => {
  const storage = new Memory();
  const newer = JSON.stringify({ version: 2, labs: { arrays: { future: true } } });
  storage.setItem(LAB_PROGRESS_KEY, newer);
  assert.equal(saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "A" })).saved, false);
  assert.equal(storage.getItem(LAB_PROGRESS_KEY), newer);
});

test("the last opened lab is remembered, and forgotten if it no longer exists", () => {
  const storage = new Memory();
  rememberOpened(storage, "caching");
  assert.equal(lastLab(storage, (id) => id === "caching"), "caching");
  assert.equal(lastLab(storage, () => false), undefined);
});

test("fields a newer Kitab adds to a record are kept when this one saves", () => {
  const storage = new Memory();
  storage.setItem(LAB_PROGRESS_KEY, JSON.stringify({ version: 1, labs: { arrays: { labVersion: 1, tasksDone: [], hints: 0, attempted: false, updatedAt: 1, extra: "keep" } }, meta: {} }));
  saveLab(storage, "arrays", 1, (r) => ({ ...r, code: "A" }));
  assert.equal(JSON.parse(storage.getItem(LAB_PROGRESS_KEY)!).labs.arrays.extra, "keep");
});
