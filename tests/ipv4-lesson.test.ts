// Lesson 1 "Understanding IPv4 addresses and subnets": the engine shows only the shared helper's values, /0, /31 and /32
// are never described with addresses they don't have, inputs are validated, the tutor stays grounded, and earlier lesson
// records are untouched.
import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { buildTrace, getEngine } from "../src/learning/registry.ts";
import { findLesson, lessons } from "../src/learning/lessons/catalog.ts";
import { JOURNEY, checkParam, resolveTrack, safeParams, validateLessonContent } from "../src/learning/lessons/runtime.ts";
import { createNav } from "../src/learning/lessons/navigation.ts";
import { loadLearning, recordLessonVisit, recordStep, saveLearning, LEARNING_KEY } from "../src/learning/lessons/progress.ts";
import { buildLessonTutorContext, validateLessonTutorOutput } from "../src/learning/lessons/tutor.ts";
import { block, formatAddress, isAddress, sameSubnet, toBinary, parseAddress } from "../src/net/ipv4.ts";
import { blockStart, blockSummary } from "../src/net/subnet-practice.ts";
import { handle } from "../worker/index.ts";
import { context, envWith, FakeAi, FakeD1, post } from "./support/fakes.ts";

const lesson = findLesson("ipv4-subnets")!;
const adapter = getEngine("ipv4-subnets")!;
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}
const next = random(4242);
const addresses = ["0.0.0.0", "255.255.255.255", "127.255.255.255", "128.0.0.0", ...Array.from({ length: 300 }, () => formatAddress(Math.floor(next() * 2 ** 32)))];
const prefixes = Array.from({ length: 33 }, (_, p) => p);
const facts = (trace: ReturnType<typeof buildTrace>, frame: string) => Object.fromEntries(trace.frames.find((f) => f.id === frame)!.facts.map((f) => [f.id, f.value]));

test("the lesson is registered with its permanent id, its own engine and no change to existing lessons", () => {
  assert.equal(lesson.id, "ipv4-subnets");
  assert.equal(lesson.version, "1.0.0");
  assert.equal(lesson.chapters.length, 6);
  assert.equal(lesson.experiments.length, 3);
  assert.deepEqual(lessons.map((l) => l.id), ["ip-addressing", "array-insert", "ipv4-subnets"]);
  // The earlier lessons keep their ids, versions and controls; none of them uses the new range control.
  assert.equal(findLesson("ip-addressing")!.version, "1.1.0");
  assert.equal(findLesson("array-insert")!.version, "1.0.0");
  for (const id of ["ip-addressing", "array-insert"]) assert.ok(findLesson(id)!.controls.every((c) => c.control !== "range"));
  for (const l of lessons) assert.deepEqual(validateLessonContent(l), [], l.id);
});

test("every fact equals the shared helper's result, for every prefix /0–/32 on 304 addresses", () => {
  for (const address of addresses)
    for (const prefix of prefixes) {
      const destination = addresses[(addresses.indexOf(address) * 7 + prefix) % addresses.length];
      const trace = buildTrace("ipv4-subnets", { address, prefix, destination, experiment: "none" }),
        b = block(address, prefix);
      assert.equal(facts(trace, "bits").binary, toBinary(parseAddress(address)));
      assert.equal(facts(trace, "mask").mask, b.mask);
      assert.equal(facts(trace, "and")["block-start"], blockStart(b));
      const whole = facts(trace, "block");
      assert.equal(whole.block, b.cidr);
      assert.equal(whole["block-size"], b.size);
      assert.equal(whole.usable, b.usable);
      assert.equal(whole["block-summary"], blockSummary(b));
      const compare = facts(trace, "compare");
      assert.equal(compare["same-subnet"], sameSubnet(address, destination, prefix));
      assert.equal(compare["destination-network"], blockStart(block(destination, prefix)));
      assert.equal(trace.outcome.sameSubnet, sameSubnet(address, destination, prefix));
      // The prediction frames carry only the question's inputs, never the answer.
      assert.deepEqual(trace.frames.find((f) => f.id === "predict-network")!.facts.map((f) => f.id), ["cidr", "mask"]);
      assert.deepEqual(trace.frames.find((f) => f.id === "predict-local")!.facts.map((f) => f.id), ["cidr", "destination"]);
    }
});

test("/0, /31 and /32 frames never claim a network or broadcast address", () => {
  for (const address of addresses.slice(0, 80))
    for (const prefix of [0, 31, 32]) {
      const trace = buildTrace("ipv4-subnets", { address, prefix, destination: "10.0.0.1", experiment: "none" });
      const text = JSON.stringify(trace.frames.flatMap((f) => f.facts.map((x) => x.value))).replaceAll("no network or broadcast address", "");
      if (prefix === 0) assert.doesNotMatch(text, /broadcast \d/);
      else assert.doesNotMatch(text, /network \d+\.|broadcast \d+\.|network address|broadcast address/i, `${address}/${prefix}`);
    }
  const p2p = resolveTrack(lesson, {}, "p2p");
  assert.equal(p2p.trace.outcome.usable, 2);
  assert.match(String(facts(p2p.trace, "p2p-link")["block-summary"]), /both 203\.0\.113\.6 and 203\.0\.113\.7 are usable/);
});

test("the experiments: a mask mismatch makes the two devices disagree; a real split and a /20 behave as computed", () => {
  const mismatch = resolveTrack(lesson, {}, "mismatch").trace;
  assert.equal(mismatch.outcome.localForPc, true);
  assert.equal(mismatch.outcome.localForDestination, false);
  assert.equal(facts(mismatch, "mismatch-neighbour").agree, false);
  assert.match(String(facts(mismatch, "mismatch-split")["split-verdict"]), /^different subnet/);
  const third = resolveTrack(lesson, {}, "third-octet").trace;
  assert.equal(third.outcome.blockStart, "172.20.192.0");
  assert.equal(third.outcome.usable, 4094);
  // Experiments start after the journey's frames, which they share.
  const journey = resolveTrack(lesson, {}, JOURNEY).trace.frames.map((f) => f.id);
  assert.deepEqual(mismatch.frames.slice(0, journey.length).map((f) => f.id), journey);
});

test("text inputs are checked with the helper, and the range accepts only whole prefixes from 0 to 32", () => {
  for (const bad of ["01.2.3.4", "256.0.0.1", "1.2.3", "", "1.2.3.4.5", "héllo 👋"]) {
    assert.ok(checkParam(lesson, "address", bad), bad);
    assert.ok(checkParam(lesson, "destination", bad), bad);
    assert.deepEqual(safeParams(lesson, { address: bad }), {}, bad);
  }
  assert.equal(checkParam(lesson, "address", "192.168.1.10"), null);
  assert.equal(checkParam(lesson, "prefix", 99), null, "only text parameters are checked here");
  assert.match(checkParam(lesson, "address", "256.0.0.1")!, /256 is larger than 255/);
  for (const prefix of prefixes) assert.deepEqual(safeParams(lesson, { prefix }), { prefix });
  for (const bad of [-1, 33, 24.5, "24", NaN]) assert.deepEqual(safeParams(lesson, { prefix: bad }), {}, String(bad));
  assert.deepEqual(safeParams(lesson, { address: "172.16.5.4", prefix: 12, destination: "8.8.8.8" }), { address: "172.16.5.4", prefix: 12, destination: "8.8.8.8" });
  const range = lesson.controls.find((c) => c.control === "range")!;
  assert.deepEqual(range.control === "range" && range.presets, [8, 16, 24, 25, 26, 28, 30, 0, 31, 32]);
  assert.ok(isAddress(String(lesson.scenario.address)));
});

test("tutor claim checks catch invented subnet results, wrong verdicts and delivery claims", () => {
  const at = (stepId: string, params: Record<string, string | number | boolean> = {}) =>
    buildLessonTutorContext({ lessonId: lesson.id, lessonVersion: lesson.version, params, track: "journey", stepId, level: null, question: "Why?" });
  const answer = (explanation: string, evidence: string[]) => ({ explanation, evidence, misconception: null, attention: null, action: "none" });
  const block28 = at("whole-block");
  assert.equal(validateLessonTutorOutput(answer("10.20.30.77 is in 10.20.30.64/28: the network address is 10.20.30.64 and there are 14 usable addresses.", ["block"]), block28).ok, true);
  for (const wrong of [
    "The network address is 10.20.30.0 because the first three octets match.",
    "The broadcast address is 10.20.30.255.",
    "The block holds 254 usable addresses.",
  ])
    assert.equal(validateLessonTutorOutput(answer(wrong, ["block"]), block28).ok, false, wrong);
  const p2p = at("whole-block", { prefix: 31, address: "203.0.113.7" });
  assert.equal(validateLessonTutorOutput(answer("Its broadcast address is 203.0.113.7.", ["block"]), p2p).ok, false);
  assert.equal(validateLessonTutorOutput(answer("A /31 has no network or broadcast address: both 203.0.113.6 and 203.0.113.7 are usable.", ["block"]), p2p).ok, true);
  const decision = at("compare");
  assert.equal(validateLessonTutorOutput(answer("10.20.30.90 is on the same subnet as your PC.", ["same-subnet"]), decision).ok, false);
  assert.equal(validateLessonTutorOutput(answer("10.20.30.90 is on a different subnet, so your PC hands the packet to its default gateway.", ["same-subnet"]), decision).ok, true);
  assert.equal(validateLessonTutorOutput(answer("10.20.30.90 is on a different subnet, so the packet will arrive through the gateway.", ["same-subnet"]), decision).ok, false);
  // Invalid parameters never reach the facts: the tutor rebuilds the example from validated values only.
  assert.equal(at("meet-address", { address: "999.1.1.1" }).track.trace.params.address, "10.20.30.77");
});

test("lesson tutor through the Worker: a grounded answer is returned as ai, an invented one falls back, budgets still apply", async () => {
  const body = (explanation: string) => ({ lessonId: lesson.id, lessonVersion: lesson.version, params: { prefix: 28 }, track: "journey", stepId: "whole-block", level: null, question: "What is the network address?" });
  const ask = async (env: ReturnType<typeof envWith>, session = "0123456789abcdef0123") => {
    const ctx = context();
    const response = await handle(post("/api/lesson-tutor", body(""), { "x-kitab-session": session }), env, ctx);
    await ctx.settle();
    return (await response.json()) as { source: string; reason?: string; response: { explanation: string } };
  };
  const grounded = { explanation: "10.20.30.77 is in 10.20.30.64/28, so the network address is 10.20.30.64 and 14 addresses are usable.", evidence: ["block"], misconception: null, attention: "block", action: "none" };
  const db = new FakeD1();
  const ok = await ask(envWith({ DB: db, AI: new FakeAi(() => ({ response: grounded })) }));
  assert.equal(ok.source, "ai");
  assert.equal(db.rows<Record<string, unknown>>("SELECT * FROM tutor_requests")[0].mission_id, "lesson:ipv4-subnets");
  const invented = await ask(envWith({ DB: new FakeD1(), AI: new FakeAi(() => ({ response: { ...grounded, explanation: "The network address is 10.20.30.0." } })) }));
  assert.equal(invented.source, "fallback");
  assert.equal(invented.reason, "INVALID_OUTPUT");
  const broke = await ask(envWith({ DB: new FakeD1(), AI: new FakeAi(() => ({ response: grounded })), DAILY_NEURON_BUDGET: "0" }));
  assert.equal(broke.reason, "QUOTA_EXHAUSTED");
});

test("visiting the new lesson leaves earlier lesson records byte-for-byte unchanged", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const old = { lessonVersion: "1.1.0", visits: 3, lastVisitedAt: "2026-11-01T10:00:00.000Z", seen: ["meet-lan"], total: 12, chaptersSeen: ["home-lan"], completedAt: "2026-11-01T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false };
  storage.setItem(LEARNING_KEY, JSON.stringify({ version: 1, lessons: { "ip-addressing": old } }));
  const before = JSON.stringify(JSON.parse(store.get(LEARNING_KEY)!).lessons["ip-addressing"]);
  let { learning } = loadLearning(storage);
  learning = recordLessonVisit(learning, lesson);
  const track = resolveTrack(lesson, {}, JOURNEY);
  learning = recordStep(learning, lesson, createNav(lesson, track), track);
  saveLearning(storage, learning);
  const saved = JSON.parse(store.get(LEARNING_KEY)!);
  assert.equal(JSON.stringify(saved.lessons["ip-addressing"]), before);
  assert.equal(saved.lessons["ipv4-subnets"].lessonVersion, "1.0.0");
  assert.equal(saved.lessons["ipv4-subnets"].completedAt, null);
  // The stored shape is the existing schema, so an older release reads it back unchanged.
  assert.equal(loadLearning(storage).recovered, false);
  assert.deepEqual(Object.keys(saved.lessons).sort(), ["ip-addressing", "ipv4-subnets"]);
});
