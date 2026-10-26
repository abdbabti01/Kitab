import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { assessExplanation, assessPrediction, resolvePredictionOptions, traceFor } from "../src/learning/assessment.ts";
import { attemptStatus, createAttempt, createMissionState, missionReducer, type MissionState } from "../src/learning/mission-controller.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { PROGRESS_KEY, loadProgress, missionStatus, recordState, recordVisit, restoreState, saveProgress } from "../src/learning/progress.ts";
import { guideReducer, initialGuide, type GuideEvent } from "../src/learning/guide.ts";

const mission = findMission("tcp-lost-segment")!;

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}

function play(state: MissionState, optionPick: "right" | "wrong", explanation: "right" | "wrong") {
  const trace = traceFor(mission, state.attempt.params);
  const options = resolvePredictionOptions(mission, trace);
  const option = options.find((item) => assessPrediction(mission, trace, { optionId: item.id }).correct === (optionPick === "right"))!;
  let next = missionReducer(state, { type: "BEGIN_PREDICTION" });
  next = missionReducer(next, { type: "SUBMIT_PREDICTION", answer: { optionId: option.id }, result: assessPrediction(mission, trace, { optionId: option.id }), reasoning: "  because the ACK is cumulative  " });
  next = missionReducer(next, { type: "RUN_COMPLETED" });
  const choice = mission.explanation.options.find((item) => item.correct === (explanation === "right"))!;
  return missionReducer(next, { type: "SUBMIT_EXPLANATION", choiceId: choice.id, ...assessExplanation(mission, choice.id) });
}

test("wrong prediction → run → evidence → retry on a new variant → mastery", () => {
  let state = createMissionState(mission, createAttempt(mission, 1, undefined, "a1"));
  state = play(state, "wrong", "right");
  assert.equal(state.phase, "result");
  assert.equal(state.attempt.mastered, false);
  assert.equal(attemptStatus(state.attempt), "prediction-missed");
  assert.ok(state.attempt.prediction!.misconception);
  assert.equal(state.attempt.prediction!.reasoning, "because the ACK is cumulative");

  const retry = createAttempt(mission, 2, undefined, "a2");
  assert.notEqual(retry.variantId, state.attempt.variantId);
  state = missionReducer(state, { type: "NEW_ATTEMPT", attempt: retry });
  assert.equal(state.phase, "inspect");
  state = play(state, "right", "right");
  assert.equal(state.attempt.mastered, true);
});

test("navigation, autoplay, skipping and blank answers never grant mastery", () => {
  let state = createMissionState(mission, createAttempt(mission, 1, undefined, "s"));
  // Running before predicting is impossible.
  assert.equal(missionReducer(state, { type: "RUN_COMPLETED" }).phase, "inspect");
  state = missionReducer(state, { type: "SKIP_PREDICTION" });
  state = missionReducer(state, { type: "RUN_COMPLETED" });
  const right = mission.explanation.options.find((item) => item.correct)!;
  state = missionReducer(state, { type: "SUBMIT_EXPLANATION", choiceId: right.id, correct: true });
  assert.equal(state.attempt.mastered, false);
  assert.equal(attemptStatus(state.attempt), "watched");

  let blank = missionReducer(createMissionState(mission), { type: "BEGIN_PREDICTION" });
  const before = blank;
  blank = missionReducer(blank, { type: "SUBMIT_EXPLANATION", choiceId: "", correct: true });
  assert.equal(blank, before);
  assert.equal(play(createMissionState(mission), "right", "wrong").attempt.mastered, false);
});

test("progress separates visits, attempts and mastery and survives refresh", () => {
  const storage = memoryStorage();
  let { progress } = loadProgress(storage);
  progress = recordVisit(progress, mission.id, mission.version);
  assert.equal(missionStatus(progress, mission.id, mission.version), "visited");

  let state = createMissionState(mission, createAttempt(mission, 1, undefined, "p1"));
  state = missionReducer(state, { type: "BEGIN_PREDICTION" });
  progress = recordState(progress, state, "key", attemptStatus(state.attempt));
  saveProgress(storage, progress);
  const reloaded = loadProgress(storage).progress;
  const restored = restoreState(reloaded, mission.id, mission.version)!;
  assert.equal(restored.phase, "predict");
  assert.deepEqual(restored.attempt.optionOrder, state.attempt.optionOrder);

  state = play(createMissionState(mission, createAttempt(mission, 1, undefined, "p2")), "right", "right");
  progress = recordState(reloaded, state, "key", attemptStatus(state.attempt));
  assert.equal(missionStatus(progress, mission.id, mission.version), "mastered");
  assert.equal(progress.missions[mission.id].attempts.at(-1)!.reasoning, "because the ACK is cumulative");
  // A new mission version does not inherit mastery or an in-progress attempt.
  assert.equal(missionStatus(recordVisit(progress, mission.id, "2.0.0"), mission.id, "2.0.0"), "practiced");
  assert.equal(restoreState(progress, mission.id, "2.0.0"), null);
});

test("malformed, tampered or unavailable storage recovers to a clean state", () => {
  for (const raw of ["{not json", JSON.stringify({ version: 1, missions: { x: { mastered: true } } }), JSON.stringify({ version: 99 })]) {
    const storage = memoryStorage({ [PROGRESS_KEY]: raw });
    const result = loadProgress(storage);
    assert.equal(result.recovered, true);
    assert.deepEqual(result.progress.missions, {});
    assert.equal(storage.data.get(`${PROGRESS_KEY}.corrupt`), raw);
  }
  const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
  assert.deepEqual(loadProgress(throwing).progress.missions, {});
  assert.equal(saveProgress(throwing, { version: 1, missions: {} }), false);
});

test("guide moods follow learner events and never praise a wrong prediction", () => {
  const sequence: [GuideEvent, string][] = [
    [{ type: "mission-opened", objective: "o", returning: false }, "welcoming"],
    [{ type: "prediction-started" }, "thinking"],
    [{ type: "prediction-submitted" }, "thinking"],
    [{ type: "run-started" }, "idle"],
    [{ type: "run-completed", correct: false }, "pointing"],
    [{ type: "misconception-identified", label: "l", message: "m", target: "segment-2" }, "pointing"],
    [{ type: "hint-requested", text: "h" }, "explaining"],
    [{ type: "retry-started", variantLabel: "v" }, "encouraging"],
    [{ type: "tutor-pending" }, "thinking"],
    [{ type: "tutor-failed", fallbackText: "f" }, "unavailable"],
    [{ type: "mastered" }, "celebrating"],
  ];
  let state = initialGuide;
  for (const [event, mood] of sequence) {
    state = guideReducer(state, event);
    assert.equal(state.mood, mood, event.type);
  }
  const wrong = guideReducer(initialGuide, { type: "run-completed", correct: false });
  assert.doesNotMatch(wrong.message, /great|correct|well done|nice/i);
  assert.equal(guideReducer(initialGuide, { type: "misconception-identified", label: "l", message: "m", target: "segment-2" }).target, "segment-2");
});

test("repeating an event does not re-announce the same message", () => {
  const once = guideReducer(initialGuide, { type: "run-paused" });
  const twice = guideReducer(once, { type: "run-paused" });
  assert.equal(twice, once);
  const collapsed = guideReducer(once, { type: "toggle-collapsed" });
  assert.equal(collapsed.collapsed, true);
  assert.equal(collapsed.seq, once.seq);
});
