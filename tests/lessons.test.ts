import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { findLesson, lessons } from "../src/learning/lessons/catalog.ts";
import { createNav, currentStep, navReducer, restoreNav, type NavAction, type NavState } from "../src/learning/lessons/navigation.ts";
import { LEARNING_KEY, lessonStatus, loadLearning, recordLessonVisit, recordStep, saveLearning } from "../src/learning/lessons/progress.ts";
import { JOURNEY, resolveTrack, safeParams, validateLessonContent } from "../src/learning/lessons/runtime.ts";
import { parseLesson } from "../src/learning/lessons/schema.ts";
import { buildLessonTutorContext, fallbackLessonTutor, validateLessonTutorOutput } from "../src/learning/lessons/tutor.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { loadProgress, missionStatus, PROGRESS_KEY } from "../src/learning/progress.ts";
import type { FactValue } from "../src/learning/types.ts";

// The generic lesson runtime is exercised on the IP lesson (Packet Journey is a standalone page).
const ip = findLesson("ip-addressing")!;
const array = findLesson("array-insert")!;
const trackFor = (lesson = ip) => (params: Record<string, FactValue>, id: string) => resolveTrack(lesson, params, id);
const run = (state: NavState, actions: NavAction[], lesson = ip) => actions.reduce((current, action) => navReducer(current, action, trackFor(lesson)), state);

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

test("every lesson validates for every reachable scenario, including multi-byte messages", () => {
  for (const lesson of lessons) assert.deepEqual(validateLessonContent(lesson, (id) => Boolean(findMission(id))), [], lesson.id);
});

test("validation catches content that would show something the engine did not compute", () => {
  const broken = structuredClone(ip) as typeof ip;
  broken.chapters[0].steps[0].what = "The message has {fact:no-such-fact} bytes.";
  assert.ok(validateLessonContent(parseLesson(broken)).some((problem) => problem.includes("no-such-fact")));
  const skipping = structuredClone(ip) as typeof ip;
  skipping.chapters.splice(0, 1); // drop the LAN chapter
  assert.ok(validateLessonContent(parseLesson(skipping)).some((problem) => problem.includes("frame lan is never shown")));
});

test("the array walkthrough runs on the existing data-structures engine through the same runtime", () => {
  for (const [index, shifts] of [[1, 4], [3, 2]] as const) {
    const track = resolveTrack(array, safeParams(array, { index }));
    assert.equal(track.trace.engine.id, "data-structures");
    assert.equal(track.trace.outcome.shifts, shifts);
    assert.equal(track.steps.filter((step) => step.id.startsWith("shift~")).length, shifts);
    assert.match(track.steps.at(-1)!.what, new RegExp(`^${shifts} values moved`));
  }
  // Practice stays fresh: the walkthrough's insert positions are not among the mission's variants.
  const mission = findMission("array-insert-shift")!;
  const practiced = new Set(mission.variants.map((variant) => variant.params.index));
  for (const control of array.controls) if (control.control === "choice") for (const option of control.options) assert.ok(!practiced.has(option.value));
});

test("Back, Next and rapid input stay inside the track", () => {
  const start = createNav(ip, resolveTrack(ip, {}));
  const track = resolveTrack(ip, {});
  assert.equal(run(start, [{ type: "BACK" }]).stepId, track.steps[0].id);
  const end = run(start, Array.from({ length: 200 }, () => ({ type: "NEXT" }) as const));
  assert.equal(end.stepId, track.steps.at(-1)!.id);
  const mixed = run(start, [...Array.from({ length: 10 }, () => ({ type: "NEXT" }) as const), { type: "BACK" }, { type: "BACK" }, { type: "NEXT" }]);
  assert.equal(mixed.stepId, track.steps[9].id);
  assert.equal(run(start, [{ type: "GOTO", stepId: "nope" }]), start);
  assert.equal(run(start, [{ type: "REPLAY" }, { type: "REPLAY" }]).replay, 2);
});

test("opening a level keeps the place, exploring stays on that level, and returning restores the journey step", () => {
  const start = run(createNav(ip, resolveTrack(ip, {})), Array.from({ length: 4 }, () => ({ type: "NEXT" }) as const));
  const opened = run(start, [{ type: "OPEN_LEVEL", levelId: "forwarding" }]);
  assert.equal(opened.stepId, start.stepId);
  assert.equal(opened.level?.stage, "intro");
  const exploring = run(opened, [{ type: "EXPLORE_LEVEL" }, { type: "NEXT" }, { type: "NEXT" }]);
  const track = resolveTrack(ip, {});
  assert.equal(currentStep(exploring, track).level, "forwarding");
  const back = run(exploring, [{ type: "CLOSE_LEVEL", resume: "return" }]);
  assert.equal(back.stepId, start.stepId);
  assert.equal(back.level, null);
  const here = run(exploring, [{ type: "CLOSE_LEVEL", resume: "here" }]);
  assert.equal(here.stepId, exploring.stepId);
});

test("changing an array scenario keeps a valid step", () => {
  // Array: a shift step that doesn't exist for the new position falls back to the start of the same chapter.
  const arrayTrack = resolveTrack(array, {});
  const shift4 = run(createNav(array, arrayTrack), [{ type: "GOTO", stepId: "shift~frame-4" }], array);
  const moved = run(shift4, [{ type: "SET_PARAMS", params: safeParams(array, { index: 3 }) }], array);
  assert.equal(moved.stepId, "request");
});

test("saved positions restore safely; unknown steps, tracks or parameters start cleanly", () => {
  const safe = (raw: unknown) => safeParams(ip, raw);
  const stepId = resolveTrack(ip, {}).steps[8].id;
  const restored = restoreNav(ip, { lessonId: ip.id, lessonVersion: ip.version, params: {}, track: JOURNEY, stepId, journeyStepId: stepId }, trackFor(), safe)!;
  assert.equal(restored.stepId, stepId);
  assert.deepEqual(restored.params, {});
  const junk = restoreNav(ip, { lessonId: ip.id, lessonVersion: ip.version, params: { message: 42, evil: "x" } as never, track: "hack", stepId: "gone", journeyStepId: "gone" }, trackFor(), safe)!;
  assert.equal(junk.track, JOURNEY);
  assert.equal(junk.stepId, resolveTrack(ip, {}).steps[0].id);
  assert.deepEqual(junk.params, {});
  assert.equal(restoreNav(ip, { lessonId: ip.id, lessonVersion: "0.0.1" }, trackFor(), safe), null);
});

test("learning progress: completion needs every chapter, changed content resets, corrupt data recovers, mastery is untouched", () => {
  const storage = memory();
  const track = resolveTrack(ip, {});
  let learning = recordLessonVisit(loadLearning(storage).learning, ip);
  // Jumping straight to the last step is not completing the walkthrough.
  const last = { ...createNav(ip, track), stepId: track.steps.at(-1)!.id };
  learning = recordStep(learning, ip, last, track);
  assert.equal(learning.lessons[ip.id].completedAt, null);
  for (const step of track.steps) learning = recordStep(learning, ip, { ...last, stepId: step.id }, track);
  assert.ok(learning.lessons[ip.id].completedAt);
  assert.deepEqual(lessonStatus(learning, ip), { state: "completed", seen: track.steps.length, total: track.steps.length });
  saveLearning(storage, learning);
  // Learning lives under its own key: no mission attempt or mastery was written.
  assert.equal(storage.getItem(PROGRESS_KEY), null);
  assert.equal(missionStatus(loadProgress(storage).progress, "tcp-lost-segment", findMission("tcp-lost-segment")!.version), "new");

  const changed = { ...ip, version: "9.9.9" };
  const after = recordLessonVisit(loadLearning(storage).learning, changed);
  assert.equal(after.lessons[ip.id].completedAt, null);
  assert.equal(after.lessons[ip.id].position, null);
  assert.equal(after.lessons[ip.id].updated, true);
  assert.equal(lessonStatus(loadLearning(storage).learning, changed).state, "visited");

  const corrupt = memory({ [LEARNING_KEY]: "{not json" });
  const loaded = loadLearning(corrupt);
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.learning.lessons, {});
  assert.ok(corrupt.getItem(`${LEARNING_KEY}.corrupt`));
});

const split = { prefix: 25, target: "printer" };
const askAbout = (patch: Record<string, unknown> = {}) =>
  buildLessonTutorContext({ lessonId: ip.id, lessonVersion: ip.version, params: split, track: JOURNEY, stepId: "choose-hop", level: null, question: "Why does it go to the router?", ...patch } as never);

test("lesson tutor context is rebuilt from validated input; grounded answers pass and invented numbers fail", () => {
  const context = askAbout();
  assert.equal(context.facts.find((fact) => fact.id === "next-hop")?.value, "192.168.1.1");
  const fallback = fallbackLessonTutor(context);
  assert.match(fallback.explanation, /The next hop is 192\.168\.1\.1/);
  assert.ok(validateLessonTutorOutput(fallback, context).ok);
  const good = { explanation: "The printer at 192.168.1.130 is outside the PC's /25 subnet, so the PC sends the packet to its gateway 192.168.1.1, the next hop.", evidence: ["next-hop", "destination-ip"], misconception: null, attention: "route", action: "none" };
  assert.ok(validateLessonTutorOutput(good, context).ok);
  for (const bad of [
    { ...good, explanation: "The printer is outside the PC's /23 subnet, so the PC sends the packet to its gateway." },
    { ...good, explanation: "Photosynthesis converts light energy into chemical energy." },
    { ...good, attention: "r9" },
    { ...good, misconception: "made-up" },
  ]) assert.equal(validateLessonTutorOutput(bad, context).ok, false);
  assert.throws(() => askAbout({ lessonVersion: "0.0.0" }), /changed/);
  assert.throws(() => askAbout({ stepId: "nope" }), /not part/);
});

test("tutor evidence ids copied with the prompt's brackets are read as ids, and unknown ids still fail", () => {
  // Observed from the real model: evidence ["[packet-seq]"] for the fact listed as "- [packet-seq] …".
  const context = askAbout();
  const answer = (evidence: string[]) => ({ explanation: "The PC sends the packet to its gateway because the printer is in another subnet.", evidence, misconception: null, attention: null, action: "none" });
  const bracketed = validateLessonTutorOutput(answer(["[next-hop]"]), context);
  assert.ok(bracketed.ok);
  assert.deepEqual(bracketed.ok && bracketed.response.evidence, ["next-hop"]);
  assert.equal(validateLessonTutorOutput(answer(["[no-such-fact]"]), context).ok, false);
});
