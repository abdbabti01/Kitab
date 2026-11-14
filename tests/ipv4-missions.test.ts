// Lesson 1 practice missions: answers and wrong choices are the shared helper's results for real, named mistakes.
import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { assessPrediction, resolvePredictionOptions, traceFor, validateMissionContent } from "../src/learning/assessment.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { ipv4KeyIdeas } from "../src/learning/missions/ipv4.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { block, sameSubnet } from "../src/net/ipv4.ts";
import { blockStart } from "../src/net/subnet-practice.ts";

const network = findMission("ipv4-network-address")!;
const local = findMission("ipv4-local-or-remote")!;

test("both missions validate, need two versions for mastery and are linked from Lesson 1", () => {
  for (const m of [network, local]) {
    assert.deepEqual(validateMissionContent(m), [], m.id);
    assert.equal(m.masteryVariants, 2);
    assert.equal(m.engine.id, "ipv4-practice");
    assert.ok(ipv4KeyIdeas[m.id].length >= 4 && ipv4KeyIdeas[m.id].every(Boolean), m.id);
  }
  assert.deepEqual(findLesson("ipv4-subnets")!.practice.map((p) => p.missionId), ["ipv4-network-address", "ipv4-local-or-remote"]);
  assert.equal(findLesson("ipv4-subnets")!.version, "1.0.0");
});

test("network address: the answer is the helper's, and each wrong choice is the mistake it names", () => {
  const whole = new Set<number>();
  for (const variant of network.variants) {
    const { address, prefix } = variant.params as { address: string; prefix: number };
    const trace = traceFor(network, variant.params),
      b = block(address, prefix),
      byId = Object.fromEntries(resolvePredictionOptions(network, trace).map((o) => [o.id, o.value]));
    assert.equal(byId.network, b.network, variant.id);
    assert.equal(byId.broadcast, b.broadcast, variant.id);
    assert.equal(byId["octet-cut"], blockStart(block(address, Math.floor(prefix / 8) * 8)), variant.id);
    assert.equal(byId.unchanged, address, variant.id);
    assert.ok(prefix % 8 !== 0, `${variant.id}: the boundary falls inside an octet`);
    whole.add(Math.floor(prefix / 8) + 1);
    assert.equal(assessPrediction(network, trace, { optionId: "network" }).correct, true);
    assert.equal(assessPrediction(network, trace, { optionId: "octet-cut" }).misconception, "whole-octets");
    assert.equal(assessPrediction(network, trace, { optionId: "broadcast" }).misconception, "host-bits-to-one");
    assert.equal(assessPrediction(network, trace, { optionId: "unchanged" }).misconception, "keeps-host-bits");
  }
  // Boundaries inside the second, third and fourth octets.
  assert.deepEqual([...whole].sort(), [2, 3, 4]);
});

test("local or remote: the decision is sameSubnet's, and whole-octet thinking is wrong in both directions", () => {
  let octetSaysLocalWrongly = 0, octetSaysRemoteWrongly = 0;
  for (const variant of local.variants) {
    const { address, prefix, destination } = variant.params as { address: string; prefix: number; destination: string };
    const trace = traceFor(local, variant.params),
      same = sameSubnet(address, destination, prefix);
    assert.equal(trace.outcome.decision, same ? "direct" : "gateway", variant.id);
    assert.equal(assessPrediction(local, trace, { optionId: same ? "direct" : "gateway" }).correct, true, variant.id);
    assert.equal(assessPrediction(local, trace, { optionId: same ? "gateway" : "direct" }).misconception, same ? "looks-remote" : "looks-local");
    const firstThree = address.split(".").slice(0, 3).join(".") === destination.split(".").slice(0, 3).join(".");
    if (firstThree && !same) octetSaysLocalWrongly++;
    if (!firstThree && same) octetSaysRemoteWrongly++;
  }
  assert.ok(octetSaysLocalWrongly >= 1 && octetSaysRemoteWrongly >= 1);
});

test("a mission run shows only the frames for its decision, never a prediction of its own", () => {
  assert.deepEqual(traceFor(network, network.variants[0].params).frames.map((f) => f.id), ["and", "block"]);
  assert.deepEqual(traceFor(local, local.variants[0].params).frames.map((f) => f.id), ["mask", "compare"]);
});

test("mastery needs two distinct versions; the same version twice, or just watching, never masters; other progress is untouched", async () => {
  const { assessExplanation } = await import("../src/learning/assessment.ts");
  const { attemptStatus, createAttempt, createMissionState, missionReducer } = await import("../src/learning/mission-controller.ts");
  const { loadProgress, recordState } = await import("../src/learning/progress.ts");
  // The attempt number picks the version: attempt n + (number of versions) repeats attempt n's version.
  const solve = (mission: typeof network, number: number) => {
    let state = createMissionState(mission, createAttempt(mission, number, undefined, `a${number}`));
    const trace = traceFor(mission, state.attempt.params);
    const right = resolvePredictionOptions(mission, trace).find((o) => assessPrediction(mission, trace, { optionId: o.id }).correct)!;
    state = missionReducer(state, { type: "BEGIN_PREDICTION" });
    state = missionReducer(state, { type: "SUBMIT_PREDICTION", answer: { optionId: right.id }, result: assessPrediction(mission, trace, { optionId: right.id }), reasoning: "" });
    state = missionReducer(state, { type: "RUN_COMPLETED" });
    const choice = mission.explanation.options.find((o) => o.correct)!;
    return missionReducer(state, { type: "SUBMIT_EXPLANATION", choiceId: choice.id, ...assessExplanation(mission, choice.id) });
  };
  // Earlier progress: a mastered TCP mission and a completed Lesson 1, stored before these missions existed.
  const tcp = { missionVersion: "1.1.0", visits: 3, lastVisitedAt: "2026-11-01T10:00:00.000Z", masteredAt: "2026-11-01T10:05:00.000Z", attempts: [], current: null };
  const store = new Map([["kitab.progress.v1", JSON.stringify({ version: 1, missions: { "tcp-lost-segment": tcp } })]]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  for (const mission of [network, local]) {
    let progress = loadProgress(storage).progress;
    const first = solve(mission, 1);
    progress = recordState(progress, first, "key", attemptStatus(first.attempt), undefined, mission.masteryVariants);
    const again = solve(mission, 1 + mission.variants.length);
    assert.equal(again.attempt.variantId, first.attempt.variantId);
    progress = recordState(progress, again, "key", attemptStatus(again.attempt), undefined, mission.masteryVariants);
    assert.equal(progress.missions[mission.id].masteredAt, null, `${mission.id}: the same version twice`);
    const other = solve(mission, 2);
    assert.notEqual(other.attempt.variantId, first.attempt.variantId);
    progress = recordState(progress, other, "key", attemptStatus(other.attempt), undefined, mission.masteryVariants);
    assert.ok(progress.missions[mission.id].masteredAt, `${mission.id}: two distinct versions`);
    assert.deepEqual(progress.missions["tcp-lost-segment"], tcp);
  }
  // Just watching: the run is shown, but the attempt can't be mastered even with the right explanation.
  let watched = createMissionState(local, createAttempt(local, 1, undefined, "w"));
  watched = missionReducer(watched, { type: "SKIP_PREDICTION" });
  watched = missionReducer(watched, { type: "RUN_COMPLETED" });
  const right = local.explanation.options.find((o) => o.correct)!;
  watched = missionReducer(watched, { type: "SUBMIT_EXPLANATION", choiceId: right.id, correct: true });
  assert.equal(watched.attempt.mastered, false);
});
