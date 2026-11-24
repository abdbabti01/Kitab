import test from "node:test";
import assert from "node:assert/strict";
import { canFinish, direction, initialCycle, reduceCycle, understood, validateCycle, type AnyCycle, type CycleAction, type CycleState } from "../src/learning/cycle.ts";
import { CYCLES_KEY, cycleStatus, loadCycleRecords, recordKey, resumeState, saveCycleState } from "../src/learning/cycle-progress.ts";
import { cycleCatalog } from "../src/learning/cycle-catalog.ts";
import { runSetup, sdCycles } from "../src/architecture/cycles.ts";
import { dsCycles } from "../src/structures/cycles.ts";
import { netCycles } from "../src/practice/network/cycles.ts";
import { identityCycles } from "../src/identity/cycles.ts";
import { PROGRESS_KEY as ARCH_KEY } from "../src/architecture/progress.ts";
import { findArchitectureLesson } from "../src/architecture/lessons.ts";
import { tracks } from "../src/learning/tracks.ts";

// The guided experiment (predict → run → observe → explain → change one thing): its rules, its storage, and every
// experiment's answers read from the real engines, never fixed.

const all: AnyCycle[] = [...sdCycles, ...dsCycles, ...netCycles, ...identityCycles];
const capacity = sdCycles.find((c) => c.id === "sd-capacity")!;

function memory(initial: Record<string, string> = {}, fail = false) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) throw new DOMException("full", "QuotaExceededError");
      data.set(key, value);
    },
  };
}
const reduce = (cycle: AnyCycle, state: CycleState, ...actions: CycleAction[]) => actions.reduce((s, a) => reduceCycle(cycle, s, a), state);
/** What the cycle's own engine supports for a trial: the result a real run would deliver. */
function observed(cycle: AnyCycle, state: CycleState): CycleAction {
  const trial = state.trial === "base" ? cycle.base : cycle.variations.find((v) => v.id === state.trial)!;
  const base = cycle.run(cycle.base.setup, null);
  const run = trial.id === "base" ? base : cycle.run(trial.setup, base);
  const before = trial.id === "base" ? null : base;
  return { type: "observed", attempt: state.attempt, trial: state.trial, outcome: trial.outcome(run, before), supported: trial.reason(run, before) };
}
/** One full trial: predict `choice`, the run's result arrives, explain with `reason` (or the supported one). */
function trial(cycle: AnyCycle, state: CycleState, choice: string, reason?: string) {
  const predicted = reduce(cycle, state, { type: "predict", choice });
  const seen = reduce(cycle, predicted, observed(cycle, predicted));
  return reduce(cycle, seen, { type: "explain", reason: reason ?? seen.supported! });
}

test("every guided experiment is valid against its own engine: each outcome and reason resolves for the real run", () => {
  for (const cycle of all) assert.deepEqual(validateCycle(cycle), [], cycle.id);
  assert.ok(sdCycles.length >= 4 && dsCycles.length >= 4 && netCycles.length >= 3);
});

test("the catalog lists exactly the experiments that exist, with their unit, title and version", () => {
  assert.deepEqual(
    cycleCatalog.map(({ id, version, subject, unit, title }) => ({ id, version, subject, unit, title })).sort((a, b) => a.id.localeCompare(b.id)),
    all.map(({ id, version, subject, unit, title }) => ({ id, version, subject, unit, title })).sort((a, b) => a.id.localeCompare(b.id)),
  );
  // Each belongs to something real: a System Design lesson with an experiment, or a unit of its track.
  for (const c of cycleCatalog) {
    if (c.subject === "system-design") assert.ok(findArchitectureLesson(c.unit), c.id);
    else assert.ok(tracks.find((t) => t.id === c.subject)!.stages.some((s) => s.id === c.unit), c.id);
  }
});

test("answers are read from the run, not fixed: the same question gets a different answer from a different run", () => {
  // Capacity: the 200 req/s run fails some requests; at 20 it keeps up; at 140 it slows down without failing.
  const at = (rate: number) => runSetup({ lesson: "fundamentals", variant: "base", rate });
  assert.equal(capacity.base.outcome(at(200), null), "fails");
  assert.equal(capacity.base.outcome(at(20), null), "keeps-up");
  assert.equal(capacity.base.outcome(at(140), null), "slower");
  assert.equal(capacity.base.reason(at(20), null), "headroom");
  // A bigger queue makes things worse here; that is the run's verdict, not the content's.
  const queue = capacity.variations.find((v) => v.id === "queue-500")!;
  const base = at(200);
  assert.equal(queue.outcome(capacity.run(queue.setup, base), base), "higher");
  assert.ok(capacity.run(queue.setup, base).summary.timeouts > 0);
  // Variations compare with the first run: swapping the two flips the direction.
  const slots = capacity.variations.find((v) => v.id === "slots-8")!;
  const better = capacity.run(slots.setup, base);
  assert.equal(slots.outcome(better, base), "lower");
  assert.equal(slots.outcome(base, better), "higher");
  assert.equal(direction(10, 10.4, 0.5), "same");
  assert.equal(direction(null, 3, 0), "same");
});

test("evidence is the run's own, and every step it points to exists in that run", () => {
  for (const cycle of all) {
    const base = cycle.run(cycle.base.setup, null);
    for (const t of [cycle.base, ...cycle.variations]) {
      const run = t.id === "base" ? base : cycle.run(t.setup, base);
      const size = "frames" in run ? run.frames.length : "trace" in run ? run.trace.events.length : Infinity;
      for (const e of cycle.evidence(run, t.id === "base" ? null : base)) {
        assert.ok(e.value.length > 0, `${cycle.id}/${t.id}: ${e.label}`);
        if (e.at !== undefined) assert.ok(e.at >= 0 && e.at < size, `${cycle.id}/${t.id}: ${e.label} points at ${e.at}`);
      }
    }
  }
});

test("the starting configuration never shows the answer", () => {
  for (const cycle of all) {
    const base = cycle.run(cycle.base.setup, null);
    const right = cycle.base.choices.find((c) => c.id === cycle.base.outcome(base, null))!;
    for (const shown of cycle.start(cycle.base.setup)) assert.notEqual(shown.value, right.text, `${cycle.id}: ${shown.label}`);
  }
});

test("a prediction is committed once, before the run, and only the current attempt's run is accepted", () => {
  let s = initialCycle();
  assert.equal(reduce(capacity, s, { type: "predict", choice: "made-up" }), s, "unknown choice");
  assert.equal(reduce(capacity, s, observed(capacity, s)).phase, "ready", "no result before a prediction");
  s = reduce(capacity, s, { type: "predict", choice: "slower" });
  assert.equal(s.phase, "running");
  assert.equal(reduce(capacity, s, { type: "predict", choice: "fails" }).prediction, "slower", "the prediction can't be changed once committed");
  // A late result from an earlier attempt, or for another trial, is ignored.
  assert.equal(reduce(capacity, s, { ...observed(capacity, s), attempt: 0 } as CycleAction), s);
  assert.equal(reduce(capacity, s, { ...observed(capacity, s), trial: "slots-8" } as CycleAction), s);
  assert.equal(reduce(capacity, s, { ...observed(capacity, s), outcome: "made-up" } as CycleAction), s);
  s = reduce(capacity, s, observed(capacity, s));
  assert.deepEqual([s.phase, s.prediction, s.outcome], ["observed", "slower", "fails"]);
  // Starting again mid-run: the old run's result can't land on the new attempt.
  const again = reduce(capacity, reduce(capacity, initialCycle(), { type: "predict", choice: "fails" }), { type: "again" });
  assert.equal(again.attempt, 2);
  assert.equal(reduce(capacity, again, { type: "observed", attempt: 1, trial: "base", outcome: "fails", supported: "api" }), again);
});

test("completion needs the first run explained and one variation explained; understanding needs prediction and reason", () => {
  let s = trial(capacity, initialCycle(), "fails");
  assert.equal(s.phase, "explained");
  assert.equal(understood(s), true);
  assert.equal(canFinish(capacity, s), false, "a cycle with variations needs one");
  assert.equal(reduce(capacity, s, { type: "finish" }), s);
  assert.equal(reduce(capacity, s, { type: "vary", trial: "base" }), s, "the first run isn't a variation");
  s = reduce(capacity, s, { type: "vary", trial: "queue-500" });
  assert.deepEqual([s.trial, s.phase, s.prediction], ["queue-500", "ready", null]);
  s = trial(capacity, s, "lower");
  assert.equal(s.done.length, 2);
  s = reduce(capacity, s, { type: "finish" });
  assert.equal(s.phase, "completed");
  // Right prediction, wrong reason: not understood. Wrong prediction, right reason: not understood either.
  assert.equal(understood(trial(capacity, initialCycle(), "fails", "network")), false);
  assert.equal(understood(trial(capacity, initialCycle(), "slower")), false);
  // A variation can't start before the first run is explained.
  const early = reduce(capacity, initialCycle(), { type: "predict", choice: "fails" });
  assert.equal(reduce(capacity, early, { type: "vary", trial: "slots-8" }), early);
});

test("progress: saved per experiment version, resumed, never losing completion; other stores untouched", () => {
  const other = JSON.stringify({ version: 1, challenges: {}, lessons: { fundamentals: { experimentAt: "2026-11-01T00:00:00.000Z" } } });
  const s = memory({ [ARCH_KEY]: other });
  let state = trial(capacity, initialCycle(), "fails");
  state = trial(capacity, reduce(capacity, state, { type: "vary", trial: "slots-8" }), "lower");
  state = reduce(capacity, state, { type: "finish" });
  const first = saveCycleState(s, capacity, state, "2026-11-18T10:00:00.000Z");
  assert.equal(first.saved, true);
  assert.equal(first.record.completedAt, "2026-11-18T10:00:00.000Z");
  assert.equal(first.record.understoodAt, "2026-11-18T10:00:00.000Z");
  assert.equal(cycleStatus(first.record), "understood");
  // Starting again keeps the dates; only the attempt and where the learner is change.
  const again = reduce(capacity, state, { type: "again" });
  const second = saveCycleState(s, capacity, again, "2026-11-19T10:00:00.000Z");
  assert.equal(second.record.completedAt, "2026-11-18T10:00:00.000Z");
  assert.equal(second.record.attempts, 1, "an attempt counts once a prediction is committed");
  assert.deepEqual(resumeState(capacity, loadCycleRecords(s)[recordKey(capacity)]), again);
  assert.equal(s.data.get(ARCH_KEY), other, "lesson and challenge progress are not touched");
  // No event stream is stored: the record is small and holds answers only.
  assert.ok(s.data.get(CYCLES_KEY)!.length < 1500);
  // A new version of the experiment starts a fresh record; the old one stays.
  const v2 = { ...capacity, version: 2 };
  saveCycleState(s, v2, initialCycle(), "2026-11-20T10:00:00.000Z");
  assert.deepEqual(Object.keys(loadCycleRecords(s)).sort(), ["sd-capacity@1", "sd-capacity@2"]);
});

test("resume: a mid-run attempt runs again; unusable or outdated saved answers start a new attempt safely", () => {
  const running = reduce(capacity, initialCycle(), { type: "predict", choice: "fails" });
  const record = (state: unknown) => ({ attempts: 1, lastAt: "t", state }) as never;
  assert.deepEqual(resumeState(capacity, record(running)), running, "the deterministic run is simply run again");
  // A choice this version doesn't have, a missing field for the phase, or an outcome the engine no longer gives.
  assert.deepEqual(resumeState(capacity, record({ ...running, prediction: "gone" })), initialCycle(2));
  assert.deepEqual(resumeState(capacity, record({ ...running, phase: "observed" })), initialCycle(2));
  const seen = reduce(capacity, running, observed(capacity, running));
  assert.deepEqual(resumeState(capacity, record(seen)), seen);
  assert.deepEqual(resumeState(capacity, record({ ...seen, outcome: "keeps-up" })), initialCycle(2), "the engine disagrees with the saved outcome");
  assert.deepEqual(resumeState(capacity, undefined), initialCycle());
});

test("storage: damaged records are kept, another tab's records survive, and a refused save is reported", () => {
  const damaged = { attempts: "many" };
  const s = memory({ [CYCLES_KEY]: JSON.stringify({ version: 1, cycles: { "other@1": damaged, "tab-two@1": { attempts: 2, lastAt: "t" } } }) });
  assert.deepEqual(Object.keys(loadCycleRecords(s)), ["tab-two@1"]);
  saveCycleState(s, capacity, reduce(capacity, initialCycle(), { type: "predict", choice: "fails" }));
  const saved = JSON.parse(s.data.get(CYCLES_KEY)!);
  assert.deepEqual(saved.cycles["other@1"], damaged);
  assert.deepEqual(saved.cycles["tab-two@1"], { attempts: 2, lastAt: "t" });
  assert.ok(saved.cycles["sd-capacity@1"]);
  assert.equal(saveCycleState(memory({}, true), capacity, initialCycle()).saved, false);
  // A store from a newer Kitab is never overwritten.
  const newer = JSON.stringify({ version: 2, cycles: {} });
  const n = memory({ [CYCLES_KEY]: newer });
  assert.equal(saveCycleState(n, capacity, initialCycle()).saved, false);
  assert.equal(n.data.get(CYCLES_KEY), newer);
});
