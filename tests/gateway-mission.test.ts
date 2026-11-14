// The gateway-or-direct practice mission: every MAC address and decision is from a real simulator run, the
// simulator agrees with the same-subnet arithmetic, and mastery needs two different versions.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/learning/engines/index.ts";
import { assessExplanation, assessPrediction, fillTemplate, resolvePredictionOptions, traceFor, validateMissionContent } from "../src/learning/assessment.ts";
import { VARIANTS, type VariantId } from "../src/learning/engines/gateway-practice.ts";
import { frameOf, runOf, type LocalDeliveryData } from "../src/learning/engines/local-delivery.ts";
import type { LearningFrame } from "../src/learning/types.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { gatewayKeyIdeas } from "../src/learning/missions/gateway.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { sameSubnet } from "../src/net/ipv4.ts";
import { buildTutorContext, tutorRequestSchema, validateTutorOutput } from "../src/learning/tutor.ts";

const mission = findMission("gateway-or-direct")!;
type P = { variant: VariantId; address: string; prefix: number; gateway: string; destination: string };

test("the mission validates, needs two versions for mastery, loads on demand and is linked from Lesson 2", () => {
  assert.deepEqual(validateMissionContent(mission), []);
  assert.equal(mission.masteryVariants, 2);
  assert.equal(mission.engine.id, "gateway-practice");
  assert.ok(gatewayKeyIdeas[mission.id].length === 5 && gatewayKeyIdeas[mission.id].every(Boolean));
  assert.deepEqual(mission.variants.map((v) => v.id).sort(), Object.keys(VARIANTS).sort());
  assert.ok(findLesson("local-delivery-routing")!.practice.some((p) => p.missionId === mission.id));
});

test("each version: the frame's destination MAC is the one ARP returned for the simulator's next hop, which the arithmetic predicts", () => {
  const decisions = new Set<string>();
  let looksLocalButRemote = 0,
    looksRemoteButLocal = 0;
  for (const variant of mission.variants) {
    const p = variant.params as P,
      trace = traceFor(mission, variant.params),
      { network, trace: run } = runOf(`practice-${p.variant}`),
      sent = run.events.find((e) => e.actor === "pc" && e.title === "Transmit over Ethernet" && e.layers.some((l) => "Source IP" in l.fields))!,
      reply = run.events.find((e) => e.title === "ARP reply")!,
      route = run.events.find((e) => e.actor === "pc" && e.title === "Choose a route")!;
    assert.ok(run.success, `${variant.id}: the simulated ping succeeds`);
    assert.equal(trace.outcome.frameMac, frameOf(sent)!["Destination MAC"], variant.id);
    assert.equal(trace.outcome.ownMac, frameOf(sent)!["Source MAC"], variant.id);
    assert.equal(trace.outcome.frameMac, reply.layers.find((l) => "Sender MAC" in l.fields)!.fields["Sender MAC"], `${variant.id}: learned by ARP`);
    assert.equal(trace.outcome.nextHop, route.facts!["Next hop"]);
    const owner = network.devices.flatMap((d) => d.interfaces).find((i) => i.ip === trace.outcome.nextHop)!;
    assert.equal(trace.outcome.frameMac, owner.mac, `${variant.id}: the next hop's own interface MAC`);
    // The simulator's decision agrees with Lesson 1's arithmetic, using only the PC's own prefix.
    const same = sameSubnet(p.address, p.destination, p.prefix);
    assert.equal(trace.outcome.decision, same ? "direct" : "gateway", variant.id);
    assert.equal(trace.outcome.frameMac, same ? trace.outcome.targetMac : trace.outcome.gatewayMac, variant.id);
    decisions.add(String(trace.outcome.decision));
    const firstThree = p.address.split(".").slice(0, 3).join(".") === p.destination.split(".").slice(0, 3).join(".");
    if (firstThree && !same) looksLocalButRemote++;
    if (!firstThree && same) looksRemoteButLocal++;
  }
  assert.deepEqual([...decisions].sort(), ["direct", "gateway"]);
  assert.ok(looksLocalButRemote >= 1 && looksRemoteButLocal >= 1, "look-alikes in both directions");
});

test("each wrong choice names the mistake it is, and its message is true for that version", () => {
  for (const variant of mission.variants) {
    const trace = traceFor(mission, variant.params),
      options = resolvePredictionOptions(mission, trace),
      direct = trace.outcome.decision === "direct";
    assert.equal(new Set(options.map((o) => o.value)).size, 4, variant.id);
    const right = direct ? "destination" : "gateway";
    assert.equal(assessPrediction(mission, trace, { optionId: right }).correct, true, variant.id);
    const wrong = direct ? "gateway" : "destination";
    const result = assessPrediction(mission, trace, { optionId: wrong });
    assert.equal(result.misconception, direct ? "always-gateway" : "final-destination", variant.id);
    assert.equal(assessPrediction(mission, trace, { optionId: "broadcast" }).misconception, "broadcast-frame");
    assert.equal(assessPrediction(mission, trace, { optionId: "own" }).misconception, "own-mac");
    // Every misconception message fills from this version's own run and names the right MAC.
    for (const [id, item] of Object.entries(mission.misconceptions)) {
      const message = fillTemplate(item.message, trace);
      if (id !== "own-mac") assert.ok(message.includes(String(trace.outcome.frameMac)) || message.includes(String(trace.outcome.nextHop)), `${variant.id}/${id}`);
    }
  }
  // The explanation's wrong choices are reached in every version; its "always the gateway" rule has a message true for both kinds.
  assert.equal(assessExplanation(mission, "always").misconception, "gateway-rule");
  assert.equal(assessExplanation(mission, "next-hop").correct, true);
});

test("before the prediction the learner sees only the PC's settings and the destination, never its decision", () => {
  for (const variant of mission.variants) {
    const first = traceFor(mission, variant.params).frames[0] as LearningFrame<LocalDeliveryData>;
    assert.equal(first.id, "task");
    assert.equal(first.data.view, "task");
    assert.deepEqual(first.facts.map((f) => f.id), ["pc-address", "gateway", "destination"]);
    assert.ok(!JSON.stringify(first.facts).match(/[0-9a-f]{2}(:[0-9a-f]{2}){5}/), "no MAC before the prediction");
  }
  assert.deepEqual(traceFor(mission, mission.variants[0].params).frames.map((f) => f.id), ["task", "pc-route", "arp-request", "arp-reply", "arp-saved", "the-frame", "arrives", "complete"]);
});

test("the engine writes no network results: no MAC literals, and only its own network settings as IP addresses", () => {
  const source = readFileSync(new URL("../src/learning/engines/gateway-practice.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[0-9a-f]{2}(?::[0-9a-f]{2}){5}/i);
  const configured = new Set(Object.values(VARIANTS).flatMap((v) => [v.target, ...v.settings.flatMap((s) => [("ip" in s ? s.ip : ""), ("gateway" in s ? s.gateway : "")])]));
  for (const [ip] of source.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)) assert.ok(configured.has(ip), `${ip} is a setting`);
  // A version whose parameters don't match its network is refused.
  assert.throws(() => traceFor(mission, { ...mission.variants[0].params, prefix: 16 }));
});

test("mastery needs two distinct versions; the same version twice, or just watching, never masters; other progress is untouched", async () => {
  const { attemptStatus, createAttempt, createMissionState, missionReducer } = await import("../src/learning/mission-controller.ts");
  const { loadProgress, recordState } = await import("../src/learning/progress.ts");
  const solve = (number: number) => {
    let state = createMissionState(mission, createAttempt(mission, number, undefined, `a${number}`));
    const trace = traceFor(mission, state.attempt.params);
    const right = resolvePredictionOptions(mission, trace).find((o) => assessPrediction(mission, trace, { optionId: o.id }).correct)!;
    state = missionReducer(state, { type: "BEGIN_PREDICTION" });
    state = missionReducer(state, { type: "SUBMIT_PREDICTION", answer: { optionId: right.id }, result: assessPrediction(mission, trace, { optionId: right.id }), reasoning: "" });
    state = missionReducer(state, { type: "RUN_COMPLETED" });
    return missionReducer(state, { type: "SUBMIT_EXPLANATION", choiceId: "next-hop", ...assessExplanation(mission, "next-hop") });
  };
  const ipv4 = { missionVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-13T10:00:00.000Z", masteredAt: "2026-11-13T10:05:00.000Z", attempts: [], current: null };
  const store = new Map([["kitab.progress.v1", JSON.stringify({ version: 1, missions: { "ipv4-local-or-remote": ipv4 } })]]);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  let progress = loadProgress(storage).progress;
  const first = solve(1);
  progress = recordState(progress, first, "key", attemptStatus(first.attempt), undefined, mission.masteryVariants);
  const again = solve(1 + mission.variants.length);
  assert.equal(again.attempt.variantId, first.attempt.variantId);
  progress = recordState(progress, again, "key", attemptStatus(again.attempt), undefined, mission.masteryVariants);
  assert.equal(progress.missions[mission.id].masteredAt, null, "the same version twice");
  const other = solve(2);
  assert.notEqual(other.attempt.variantId, first.attempt.variantId);
  progress = recordState(progress, other, "key", attemptStatus(other.attempt), undefined, mission.masteryVariants);
  assert.ok(progress.missions[mission.id].masteredAt, "two distinct versions");
  assert.deepEqual(progress.missions["ipv4-local-or-remote"], ipv4);
  let watched = createMissionState(mission, createAttempt(mission, 1, undefined, "w"));
  watched = missionReducer(watched, { type: "SKIP_PREDICTION" });
  watched = missionReducer(watched, { type: "RUN_COMPLETED" });
  watched = missionReducer(watched, { type: "SUBMIT_EXPLANATION", choiceId: "next-hop", correct: true });
  assert.equal(watched.attempt.mastered, false);
});

test("tutor: claims that contradict the run are refused", () => {
  const variant = mission.variants[1],
    trace = traceFor(mission, variant.params);
  const context = buildTutorContext(mission, tutorRequestSchema.parse({ missionId: mission.id, missionVersion: mission.version, params: variant.params, frameIndex: trace.frames.length - 1, intent: "explain-step", phase: "result", prediction: { optionId: "gateway" } }));
  const say = (explanation: string) => validateTutorOutput({ explanation, evidence: ["delivered"], misconception: null, attention: null, action: "none" }, context).ok;
  assert.equal(say(`The destination MAC is ${trace.outcome.targetMac}, the server's own address.`), false);
  assert.equal(say(`The destination MAC is ${trace.outcome.frameMac}, the router's: the server is on another subnet.`), true);
  assert.equal(say("The switch answers the ARP request for the server on this network."), false);
});
