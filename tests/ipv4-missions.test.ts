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
