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

const hello = findLesson("hello-tcp")!;
const array = findLesson("array-insert")!;
const trackFor = (lesson = hello) => (params: Record<string, FactValue>, id: string) => resolveTrack(lesson, params, id);
const run = (state: NavState, actions: NavAction[], lesson = hello) => actions.reduce((current, action) => navReducer(current, action, trackFor(lesson)), state);

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

test("every lesson validates for every reachable scenario, including multi-byte messages", () => {
  for (const lesson of lessons) assert.deepEqual(validateLessonContent(lesson, (id) => Boolean(findMission(id))), [], lesson.id);
});

test("validation catches content that would show something the engine did not compute", () => {
  const broken = structuredClone(hello) as typeof hello;
  broken.chapters[0].steps[0].what = "The message has {fact:no-such-fact} bytes.";
  assert.ok(validateLessonContent(parseLesson(broken)).some((problem) => problem.includes("no-such-fact")));
  const skipping = structuredClone(hello) as typeof hello;
  skipping.chapters[4].steps.splice(1, 1); // drop R1's forwarding step
  assert.ok(validateLessonContent(parseLesson(skipping)).some((problem) => problem.includes("r1-forwards is never shown")));
});

test("every number a beginner reads in the HELLO journey comes from the engine (or is a stated constant)", () => {
  const constants = new Set(["0", "1", "2", "3", "4", "8", "46", "255", "256"]);
  for (const message of ["HELLO", "héllo 👋"]) {
    for (const trackId of [JOURNEY, "lose-data"]) {
      const track = resolveTrack(hello, safeParams(hello, { message }), trackId);
      for (const step of track.steps) {
        const frame = track.trace.frames[step.frameIndex];
        const known = new Set([...frame.facts.map((fact) => String(fact.value)), ...Object.values(track.trace.outcome).map(String), ...Object.values(track.trace.params).map(String)].join(" ").match(/\d+/g) ?? []);
        for (const number of `${step.what} ${step.why}`.match(/\d+/g) ?? []) {
          assert.ok(known.has(number) || constants.has(number), `${trackId}/${step.id} (${message}): ${number} is not computed`);
        }
      }
    }
  }
  const utf8 = resolveTrack(hello, {}).steps.find((step) => step.id === "utf8")!;
  assert.match(utf8.what, /5 bytes: 72 69 76 76 79/);
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
  const start = createNav(hello, resolveTrack(hello, {}));
  const track = resolveTrack(hello, {});
  assert.equal(run(start, [{ type: "BACK" }]).stepId, track.steps[0].id);
  const end = run(start, Array.from({ length: 200 }, () => ({ type: "NEXT" }) as const));
  assert.equal(end.stepId, track.steps.at(-1)!.id);
  const mixed = run(start, [...Array.from({ length: 10 }, () => ({ type: "NEXT" }) as const), { type: "BACK" }, { type: "BACK" }, { type: "NEXT" }]);
  assert.equal(mixed.stepId, track.steps[9].id);
  assert.equal(run(start, [{ type: "GOTO", stepId: "nope" }]), start);
  assert.equal(run(start, [{ type: "REPLAY" }, { type: "REPLAY" }]).replay, 2);
});

test("opening a level keeps the place, exploring stays on that level, and returning restores the journey step", () => {
  const start = run(createNav(hello, resolveTrack(hello, {})), Array.from({ length: 4 }, () => ({ type: "NEXT" }) as const));
  const opened = run(start, [{ type: "OPEN_LEVEL", levelId: "network" }]);
  assert.equal(opened.stepId, start.stepId);
  assert.equal(opened.level?.stage, "intro");
  const exploring = run(opened, [{ type: "EXPLORE_LEVEL" }, { type: "NEXT" }, { type: "NEXT" }]);
  const track = resolveTrack(hello, {});
  assert.equal(currentStep(exploring, track).level, "network");
  const back = run(exploring, [{ type: "CLOSE_LEVEL", resume: "return" }]);
  assert.equal(back.stepId, start.stepId);
  assert.equal(back.level, null);
  const here = run(exploring, [{ type: "CLOSE_LEVEL", resume: "here" }]);
  assert.equal(here.stepId, exploring.stepId);
});

test("an experiment returns to the journey step it started from; changing the scenario keeps a valid step", () => {
  const start = run(createNav(hello, resolveTrack(hello, {})), Array.from({ length: 12 }, () => ({ type: "NEXT" }) as const));
  const inExperiment = run(start, [{ type: "START_EXPERIMENT", id: "lose-data" }, { type: "NEXT" }]);
  assert.equal(inExperiment.track, "lose-data");
  assert.equal(run(inExperiment, [{ type: "END_EXPERIMENT" }]).stepId, start.stepId);
  const edited = run(start, [{ type: "SET_PARAMS", params: safeParams(hello, { message: "héllo" }) }]);
  assert.equal(edited.stepId, start.stepId);
  // Array: a shift step that doesn't exist for the new position falls back to the start of the same chapter.
  const arrayTrack = resolveTrack(array, {});
  const shift4 = run(createNav(array, arrayTrack), [{ type: "GOTO", stepId: "shift~frame-4" }], array);
  const moved = run(shift4, [{ type: "SET_PARAMS", params: safeParams(array, { index: 3 }) }], array);
  assert.equal(moved.stepId, "request");
});

test("saved positions restore safely; unknown steps, tracks or parameters start cleanly", () => {
  const safe = (raw: unknown) => safeParams(hello, raw);
  const restored = restoreNav(hello, { lessonId: hello.id, lessonVersion: hello.version, params: { message: "Hi" }, track: JOURNEY, stepId: "segment", journeyStepId: "segment" }, trackFor(), safe)!;
  assert.equal(restored.stepId, "segment");
  assert.equal(restored.params.message, "Hi");
  const junk = restoreNav(hello, { lessonId: hello.id, lessonVersion: hello.version, params: { message: 42, evil: "x" } as never, track: "hack", stepId: "gone", journeyStepId: "gone" }, trackFor(), safe)!;
  assert.equal(junk.track, JOURNEY);
  assert.equal(junk.stepId, resolveTrack(hello, {}).steps[0].id);
  assert.deepEqual(junk.params, {});
  assert.equal(restoreNav(hello, { lessonId: hello.id, lessonVersion: "0.0.1" }, trackFor(), safe), null);
});

test("learning progress: completion needs every chapter, changed content resets, corrupt data recovers, mastery is untouched", () => {
  const storage = memory();
  const track = resolveTrack(hello, {});
  let learning = recordLessonVisit(loadLearning(storage).learning, hello);
  // Jumping straight to the last step is not completing the walkthrough.
  const last = { ...createNav(hello, track), stepId: track.steps.at(-1)!.id };
  learning = recordStep(learning, hello, last, track);
  assert.equal(learning.lessons[hello.id].completedAt, null);
  for (const step of track.steps) learning = recordStep(learning, hello, { ...last, stepId: step.id }, track);
  assert.ok(learning.lessons[hello.id].completedAt);
  assert.deepEqual(lessonStatus(learning, hello), { state: "completed", seen: track.steps.length, total: track.steps.length });
  saveLearning(storage, learning);
  // Learning lives under its own key: no mission attempt or mastery was written.
  assert.equal(storage.getItem(PROGRESS_KEY), null);
  assert.equal(missionStatus(loadProgress(storage).progress, "tcp-lost-segment", findMission("tcp-lost-segment")!.version), "new");

  const changed = { ...hello, version: "9.9.9" };
  const after = recordLessonVisit(loadLearning(storage).learning, changed);
  assert.equal(after.lessons[hello.id].completedAt, null);
  assert.equal(after.lessons[hello.id].position, null);
  assert.equal(after.lessons[hello.id].updated, true);
  assert.equal(lessonStatus(loadLearning(storage).learning, changed).state, "visited");

  const corrupt = memory({ [LEARNING_KEY]: "{not json" });
  const loaded = loadLearning(corrupt);
  assert.equal(loaded.recovered, true);
  assert.deepEqual(loaded.learning.lessons, {});
  assert.ok(corrupt.getItem(`${LEARNING_KEY}.corrupt`));
});

test("lesson tutor context is rebuilt from validated input; grounded answers pass and invented numbers fail", () => {
  const context = buildLessonTutorContext({ lessonId: hello.id, lessonVersion: hello.version, params: { message: "HELLO" }, track: JOURNEY, stepId: "r1-forwards", level: null, question: "Why does TTL go down?" });
  assert.equal(context.facts.find((fact) => fact.id === "ip-ttl")?.value, 63);
  const fallback = fallbackLessonTutor(context);
  assert.match(fallback.explanation, /TTL is now 63/);
  assert.ok(validateLessonTutorOutput(fallback, context).ok);
  const good = { explanation: "Each router lowers the TTL by one, so after R1 it is 63. That stops a packet from looping forever if routes are wrong.", evidence: ["ip-ttl", "ip-forwarding"], misconception: null, attention: "hdr-ip", action: "none" };
  assert.ok(validateLessonTutorOutput(good, context).ok);
  for (const bad of [
    { ...good, explanation: "Each router lowers the TTL by one, so after R1 it is 60 and the packet is resent." },
    { ...good, explanation: "Routers retransmit the packet if the TTL reaches zero, so delivery is guaranteed by the network." },
    { ...good, attention: "r9" },
    { ...good, misconception: "made-up" },
  ]) assert.equal(validateLessonTutorOutput(bad, context).ok, false);
  assert.throws(() => buildLessonTutorContext({ lessonId: hello.id, lessonVersion: "0.0.0", params: {}, track: JOURNEY, stepId: "syn", level: null, question: "why?" }), /changed/);
  assert.throws(() => buildLessonTutorContext({ lessonId: hello.id, lessonVersion: hello.version, params: {}, track: JOURNEY, stepId: "nope", level: null, question: "why?" }), /not part/);
});

test("a message that looks like a template token is shown verbatim, never re-read as content", () => {
  for (const message of ["{value}", "{fact:tcp-seq}", "{frame.title}", "{param.message}", "a{b}c"]) {
    const params = safeParams(hello, { message });
    assert.equal(params.message, message);
    const track = resolveTrack(hello, params);
    assert.equal(track.steps.find((step) => step.id === "b-reads")!.title, `Program B reads “${message}”`);
    assert.match(track.steps.find((step) => step.id === "done")!.what, new RegExp(`“${message.replace(/[{}]/g, "\$&")}” arrived`));
  }
});

test("lesson tutor ACK and TTL claims must match the current step, not a value from elsewhere in the run", () => {
  const ask = (stepId: string) => buildLessonTutorContext({ lessonId: hello.id, lessonVersion: hello.version, params: { message: "HELLO" }, track: JOURNEY, stepId, level: null, question: "why?" });
  const answer = (explanation: string, evidence: string) => ({ explanation, evidence: [evidence], misconception: null, attention: null, action: "none" });
  const r1 = ask("r1-forwards");
  assert.ok(validateLessonTutorOutput(answer("The router lowers the TTL from 64 to 63, so the TTL is now 63.", "ip-ttl"), r1).ok);
  // 64 and 62 both occur in this run (at A and at R2) but are wrong at R1.
  for (const wrong of ["After R1 the TTL is now 64.", "R1 forwards the packet with TTL 62."]) {
    const result = validateLessonTutorOutput(answer(wrong, "ip-ttl"), r1);
    assert.equal(result.ok, false, wrong);
    assert.ok(!result.ok && result.problems.some((problem) => /TTL .* not the TTL at this step/.test(problem)), wrong);
  }
  const synAck = ask("syn-ack");
  assert.equal(synAck.facts.find((fact) => fact.id === "tcp-ack")?.value, 1001);
  assert.ok(validateLessonTutorOutput(answer("B sends ACK 1001 to confirm A's SYN.", "tcp-ack"), synAck).ok);
  // 1006 is B's final acknowledgment later in the run, not this step's.
  const lateAck = validateLessonTutorOutput(answer("B sends ACK 1006 to confirm A's SYN.", "tcp-ack"), synAck);
  assert.ok(!lateAck.ok && lateAck.problems.some((problem) => /ACK 1006 is not an acknowledgment at this step/.test(problem)));
});

test("tutor evidence ids copied with the prompt's brackets are read as ids, and unknown ids still fail", () => {
  // Observed from the real model: evidence ["[packet-seq]"] for the fact listed as "- [packet-seq] …".
  const context = buildLessonTutorContext({ lessonId: hello.id, lessonVersion: hello.version, params: { message: "HELLO" }, track: JOURNEY, stepId: "r1-forwards", level: null, question: "why?" });
  const answer = (evidence: string[]) => ({ explanation: "Each router lowers the TTL so a packet cannot loop forever, then forwards it toward B.", evidence, misconception: null, attention: null, action: "none" });
  const bracketed = validateLessonTutorOutput(answer(["[ip-ttl]"]), context);
  assert.ok(bracketed.ok);
  assert.deepEqual(bracketed.ok && bracketed.response.evidence, ["ip-ttl"]);
  assert.equal(validateLessonTutorOutput(answer(["[no-such-fact]"]), context).ok, false);
});
