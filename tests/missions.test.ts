import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { buildTrace, frameAt } from "../src/learning/registry.ts";
import {
  assessExplanation,
  assessPrediction,
  optionOrder,
  resolvePredictionOptions,
  traceFor,
  validateMissionContent,
  variantFor,
} from "../src/learning/assessment.ts";
import { missions } from "../src/learning/missions/catalog.ts";
import { parseMission } from "../src/learning/mission-schema.ts";
import { structureInfo, structureKinds } from "../src/visual-engine/data-structures/model.ts";

test("every mission variant builds and has exactly one computed correct option", () => {
  assert.ok(missions.length >= 10);
  for (const mission of missions) assert.deepEqual(validateMissionContent(mission), [], mission.id);
});

test("the correct option is never fixed to a position and order is stable per attempt", () => {
  const firstPositions = new Set<number>();
  for (const mission of missions) {
    if (mission.prediction.kind !== "choice") continue;
    const ids = mission.prediction.options.map((option) => option.id);
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const seed = `${mission.id}:attempt-${attempt}`;
      assert.deepEqual(optionOrder(seed, ids), optionOrder(seed, ids));
      const trace = traceFor(mission, variantFor(mission, attempt).params);
      const correct = resolvePredictionOptions(mission, trace).find((option) => assessPrediction(mission, trace, { optionId: option.id }).correct)!;
      firstPositions.add(optionOrder(seed, ids).indexOf(correct.id));
    }
  }
  assert.ok(firstPositions.size >= 3, `correct answer appeared only at positions ${[...firstPositions]}`);
});

test("assessment reads engine facts: wrong options carry misconceptions, invalid answers fail", () => {
  const mission = missions.find((item) => item.id === "tcp-lost-segment")!;
  const trace = traceFor(mission, variantFor(mission, 1).params);
  assert.equal(trace.outcome.duplicateAck, trace.outcome.gapStart);
  const results = resolvePredictionOptions(mission, trace).map((option) => assessPrediction(mission, trace, { optionId: option.id }));
  assert.equal(results.filter((result) => result.correct).length, 1);
  assert.ok(results.filter((result) => !result.correct).every((result) => result.misconception));
  assert.equal(assessPrediction(mission, trace, { optionId: "made-up" }).correct, false);
  assert.equal(assessPrediction(mission, trace, { number: 2461 }).correct, false);
  assert.equal(assessExplanation(mission, "").correct, false);
  assert.equal(assessExplanation(mission, "buffered").correct, true);
});

test("numeric predictions require a finite exact number", () => {
  const mission = missions.find((item) => item.id === "tcp-lab")!;
  const trace = traceFor(mission, {});
  assert.equal(assessPrediction(mission, trace, { number: Number(trace.outcome.transmissions) }).correct, true);
  assert.equal(assessPrediction(mission, trace, { number: Number.NaN }).correct, false);
  assert.equal(assessPrediction(mission, trace, { optionId: "x" }).correct, false);
});

test("retry moves to a different variant with a different computed answer", () => {
  for (const mission of missions.filter((item) => item.variants.length > 1 && item.prediction.kind === "choice")) {
    const answers = new Set(mission.variants.map((variant) => String(traceFor(mission, variant.params).outcome[mission.prediction.answer.fact.split(".")[1]])));
    assert.ok(answers.size > 1, `${mission.id} retries ask the same answer`);
    assert.notEqual(variantFor(mission, 1).id, variantFor(mission, 2).id);
  }
});

test("traces are deterministic, frozen and expose consistent frame facts", () => {
  for (const mission of missions) {
    const a = traceFor(mission, mission.variants[0].params);
    const b = traceFor(mission, mission.variants[0].params);
    assert.equal(a, b);
    assert.ok(Object.isFrozen(a.frames[0]));
    for (const frame of a.frames) {
      const entities = new Set(frame.entities.map((entity) => entity.id));
      frame.focus.forEach((id) => assert.ok(entities.has(id)));
      frame.facts.forEach((fact) => fact.entityId && assert.ok(entities.has(fact.entityId), `${mission.id} ${frame.id} ${fact.id}`));
    }
  }
});

test("frameAt guards stale, negative and nonfinite indexes", () => {
  const long = buildTrace("tcp", { payloadBytes: 3500 });
  const short = buildTrace("tcp", { payloadBytes: 500 });
  assert.ok(long.frames.length > short.frames.length);
  assert.equal(frameAt(short, long.frames.length - 1), short.frames.at(-1));
  assert.equal(frameAt(short, -3), short.frames[0]);
  assert.equal(frameAt(short, Number.NaN), short.frames[0]);
});

test("every supported data-structure operation builds through the generic adapter", () => {
  for (const kind of structureKinds) for (const operation of structureInfo[kind].operations) {
    for (const value of [6, 99]) {
      const trace = buildTrace("data-structures", { kind, operation: operation.id, value, index: 2 });
      assert.equal(trace.params.operation, operation.id);
      assert.ok(trace.frames.length >= 2);
    }
  }
  // An operation that does not belong to the structure falls back to its default.
  assert.equal(buildTrace("data-structures", { kind: "stack", operation: "bfs" }).params.operation, "push");
  assert.throws(() => buildTrace("data-structures", { kind: "stack", hack: true }));
  assert.throws(() => buildTrace("nope", {}));
});

test("frame deltas are computed from facts, not authored", () => {
  const trace = buildTrace("data-structures", { kind: "array", operation: "insert", value: 7, index: 2 });
  assert.deepEqual(trace.frames[0].delta, []);
  assert.ok(trace.frames.at(-1)!.delta.some((line) => line.startsWith("Writes so far")));
});

test("a new scenario registers as content without touching the shell or guide", () => {
  const added = parseMission({
    ...structuredClone(missions.find((item) => item.id === "array-insert-shift")),
    id: "array-insert-front",
    title: "Insert at the front",
    variants: [{ id: "front", label: "Index 0", params: { index: 0 } }, { id: "back", label: "Index 4", params: { index: 4 } }],
  });
  assert.deepEqual(validateMissionContent(added), []);
  const trace = traceFor(added, added.variants[0].params);
  assert.equal(trace.outcome.shifts, 5);
});

test("mission content that reveals outcomes before prediction is rejected", () => {
  const leaky = parseMission({
    ...structuredClone(missions.find((item) => item.id === "array-insert-shift")),
    id: "leaky",
    hints: [
      { text: "The answer is {outcome.shifts}.", beforePrediction: true },
      { text: "Second hint.", beforePrediction: false },
    ],
  });
  assert.ok(validateMissionContent(leaky).some((problem) => problem.includes("reveals an outcome")));
  assert.throws(() => parseMission({ ...structuredClone(missions[0]), unexpected: 1 }));
});
