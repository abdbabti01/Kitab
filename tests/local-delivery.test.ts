// Lesson 2 foundation: every networking value shown comes from a real simulator run, never from the lesson's own code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/learning/engines/index.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { EXPERIMENTS, RUNS, frameOf, packetOf, runOf, type ExperimentId, type LocalDeliveryData, type RunId } from "../src/learning/engines/local-delivery.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { findActivity } from "../src/learning/networking-path.ts";
import { JOURNEY, resolveTrack, validateLessonContent } from "../src/learning/lessons/runtime.ts";
import { buildLessonTutorContext, validateLessonTutorOutput } from "../src/learning/lessons/tutor.ts";
import { lessonStatus, loadLearning, recordLessonVisit, saveLearning, LEARNING_KEY } from "../src/learning/lessons/progress.ts";

const lesson = findLesson("local-delivery-routing")!;
const trace = buildTrace<LocalDeliveryData>("local-delivery", {});
const prefixOf = (run: RunId) => (run === "routed" ? "" : `${run}-`);
const fact = (frameId: string, id: string, t = trace) => t.frames.find((f) => f.id === frameId)!.facts.find((f) => f.id === id)?.value;
const experimentIds = Object.keys(EXPERIMENTS) as ExperimentId[];
const traceOf = (experiment: ExperimentId) => buildTrace<LocalDeliveryData>("local-delivery", { experiment });

test("the lesson is registered with its permanent id, six chapters, three experiments and its own engine", () => {
  assert.equal(lesson.id, "local-delivery-routing");
  // Unchanged on purpose: chapter 5 and the experiments only add steps, so 1.0.0 records (and completions) stay valid.
  assert.equal(lesson.version, "1.0.0");
  assert.deepEqual(lesson.chapters.map((c) => c.id), ["same-subnet", "arp-or-gateway", "two-addresses", "router-between-subnets", "leaving-home", "try-in-the-lab"]);
  assert.deepEqual(lesson.experiments.map((x) => x.id), ["wrong-gateway", "no-return-gateway", "nat-off"]);
  // Practice: the framework mission, and lab missions that exist in the networking path.
  assert.deepEqual(lesson.practice.map((p) => p.missionId), ["gateway-or-direct"]);
  assert.deepEqual(lesson.labPractice!.map((p) => findActivity(p.missionId)?.track), ["network-mission", "network-mission"]);
  assert.deepEqual(validateLessonContent(lesson), []);
  assert.equal(trace.frames.length, 22);
});

test("every packet, frame, ARP and decision value shown equals the simulator event it came from, in the journey and every experiment", () => {
  for (const frame of [trace, ...experimentIds.map(traceOf)].flatMap((t) => t.frames).filter((f) => !["settings", "change", "lab"].includes(f.data.view))) {
    const pairs: [RunId, number, string][] = [[frame.data.run, frame.data.index, frame.data.view === "compare" ? "after-" : ""]];
    if (frame.data.before) pairs.push([frame.data.before.run, frame.data.before.index, "before-"]);
    for (const [run, index, side] of pairs) {
      const event = runOf(run).trace.events[index],
        p = `${prefixOf(run)}${side}`,
        packet = packetOf(event),
        eth = frameOf(event);
      const value = (id: string) => frame.facts.find((f) => f.id === `${p}${id}`)?.value;
      if (packet) {
        assert.equal(value("source-ip"), packet["Source IP"], `${frame.id} ${p}source-ip`);
        assert.equal(value("destination-ip"), packet["Destination IP"], `${frame.id} ${p}destination-ip`);
        assert.equal(value("ttl"), packet.TTL, `${frame.id} ${p}ttl`);
      }
      if (eth) {
        assert.equal(value("source-mac"), eth["Source MAC"], `${frame.id} ${p}source-mac`);
        assert.equal(value("destination-mac"), eth["Destination MAC"], `${frame.id} ${p}destination-mac`);
      }
      for (const [key, v] of Object.entries(event.facts ?? {})) {
        const id = `${p}${key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
        assert.equal(value(id.slice(p.length)), v, `${frame.id} ${id}`);
      }
    }
  }
});

test("the engine writes no network values of its own: no MAC literals, and only the runs' own targets as IPs", () => {
  const source = readFileSync(new URL("../src/learning/engines/local-delivery.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /[0-9a-f]{2}(?::[0-9a-f]{2}){5}/i, "a MAC address literal");
  const ips = [...source.matchAll(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g)].map((m) => m[0]).sort();
  assert.deepEqual(ips, Object.values(RUNS).map((r) => r.action.target).sort());
  // The question's MAC choices are the run's own: the router's (from the PC's ARP cache), the server's, broadcast, the PC's.
  const q = trace.frames.find((f) => f.id === "pc-route")!.data.question!;
  const routed = runOf("routed").trace.events;
  const saved = routed.filter((e) => e.title === "Save ARP mapping").map((e) => String(e.facts!.MAC));
  for (const mac of saved) assert.ok(q.choices.some((c) => c.label.startsWith(mac)), mac);
  assert.equal(q.choices.find((c) => c.correct)!.label.split(" ")[0], String(routed.find((e) => e.actor === "pc" && e.title === "Save ARP mapping")!.facts!.MAC));
});

test("milestone steps exist exactly as the lesson expects, in the run's own order", () => {
  for (const run of ["routed", "lan", "internet"] as RunId[]) {
    const indexes = trace.frames.filter((f) => f.data.run === run).map((f) => f.data.index);
    const routedOrder = trace.frames.filter((f) => f.data.run === run && f.data.view !== "settings").map((f) => f.data.index);
    if (run === "routed") assert.deepEqual(routedOrder.slice(0, 5), [...routedOrder.slice(0, 5)].sort((a, b) => a - b));
    for (const i of indexes) assert.ok(i >= 0 && i < runOf(run).trace.events.length);
    assert.ok(runOf(run).trace.success, `${run} run succeeds`);
  }
  assert.equal(fact("pc-route", "next-hop"), "192.168.1.1");
  assert.equal(fact("router-route", "interface"), "wan");
  assert.match(String(fact("default-route", "internet-route")), /^Static 0\.0\.0\.0\/0$/);
});

test("chapter 3: the switch changes nothing, the router keeps the IPs, new MACs and TTL one lower, with NAT off", () => {
  for (const id of ["source-mac", "destination-mac", "source-ip", "destination-ip", "ttl"]) assert.equal(fact("switch-forwards", `lan-before-${id}`), fact("switch-forwards", `lan-after-${id}`), id);
  assert.equal(fact("router-forwards", "before-source-ip"), fact("router-forwards", "after-source-ip"));
  assert.equal(fact("router-forwards", "before-destination-ip"), fact("router-forwards", "after-destination-ip"));
  assert.notEqual(fact("router-forwards", "before-source-mac"), fact("router-forwards", "after-source-mac"));
  assert.notEqual(fact("router-forwards", "before-destination-mac"), fact("router-forwards", "after-destination-mac"));
  assert.equal(Number(fact("router-forwards", "after-ttl")), Number(fact("router-forwards", "before-ttl")) - 1);
  assert.equal(fact("router-forwards", "nat"), "off");
  // Before and after are the same packet, earlier and later in one simulator run (chapter 3, and NAT in chapter 5).
  for (const id of ["switch-forwards", "router-forwards", "nat-translate", "nat-restore"]) {
    const { run, index, before } = trace.frames.find((f) => f.id === id)!.data;
    const events = runOf(run).trace.events;
    assert.equal(before!.run, run, `${id}: same run`);
    assert.ok(before!.index < index, `${id}: before precedes after`);
    assert.ok(events[index].packet, `${id}: the event carries a packet id`);
    assert.equal(events[before!.index].packet, events[index].packet, `${id}: same packet`);
  }
});

test("deterministic: the same lesson trace every time", () => {
  assert.deepEqual(buildTrace("local-delivery", {}).frames.map((f) => f.facts), trace.frames.map((f) => f.facts));
});

test("chapter 5: the home router routes, then translates; the server sees and answers the public address; the reply is restored", () => {
  const events = runOf("internet").trace.events;
  const translate = trace.frames.find((f) => f.id === "nat-translate")!.data;
  assert.equal(events[translate.before!.index].title, "Choose a route");
  assert.equal(events[translate.index].title, "Translate source with NAT");
  assert.equal(translate.index, translate.before!.index + 1, "translation comes straight after the routing decision");
  const outside = String(fact("nat-translate", "internet-after-outside")).split(":")[0],
    inside = String(fact("nat-translate", "internet-after-inside")).split(":")[0];
  assert.equal(fact("nat-translate", "internet-before-source-ip"), inside);
  assert.equal(fact("nat-translate", "internet-after-source-ip"), outside);
  assert.equal(fact("nat-translate", "internet-before-destination-ip"), fact("nat-translate", "internet-after-destination-ip"));
  assert.equal(fact("server-sees", "internet-source-ip"), outside);
  assert.equal(fact("server-replies", "internet-destination-ip"), outside);
  assert.equal(fact("nat-restore", "internet-before-destination-ip"), outside);
  assert.equal(fact("nat-restore", "internet-after-destination-ip"), inside);
  assert.equal(fact("nat-home", "internet-delivered"), true);
  // The question's choices are the run's own addresses, and the right one is the address the server saw.
  const q = trace.frames.find((f) => f.id === "nat-translate")!.data.question!;
  assert.equal(q.choices.find((c) => c.correct)!.label.split(" ")[0], fact("server-sees", "internet-source-ip"));
  assert.ok(q.choices.some((c) => c.label.startsWith(`${inside} `)));
});

/** Every path at which two values differ, such as "devices.3.interfaces.0.gateway". */
function differences(a: unknown, b: unknown, path: string[] = []): string[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return [path.join(".")];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].flatMap((k) => differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k]));
}

test("each experiment changes exactly one setting, stops where the plan says, and the restored rerun matches the normal run", () => {
  const expected: Record<ExperimentId, { setting: string; reason: string; device: string; field: RegExp }> = {
    "wrong-gateway": { setting: "Default gateway", reason: "ARP_NO_OWNER", device: "pc", field: /\.interfaces\.\d+\.gateway$/ },
    "no-return-gateway": { setting: "Default gateway", reason: "REPLY_NO_PATH", device: "server", field: /\.interfaces\.\d+\.gateway$/ },
    "nat-off": { setting: "NAT", reason: "REPLY_NO_PATH", device: "isp", field: /\.nat$/ },
  };
  for (const x of experimentIds) {
    const base = runOf(EXPERIMENTS[x].base),
      broken = runOf(x),
      restored = runOf(`${x}-restored`);
    assert.ok(base.trace.success, `${x}: the normal run succeeds`);
    const changed = differences(base.network, broken.network);
    assert.equal(changed.length, 1, `${x}: one setting changed (${changed.join(", ")})`);
    assert.match(changed[0], expected[x].field, x);
    assert.equal(base.network.devices[Number(changed[0].split(".")[1])].id, broken.change!.device, `${x}: the change names its device`);
    assert.equal(broken.change!.setting, expected[x].setting);
    assert.equal(broken.trace.success, false);
    assert.equal(broken.trace.reason, expected[x].reason, x);
    assert.equal(broken.trace.failure!.device, expected[x].device, x);
    // Put back and run again: the same network and the same events as the normal run.
    assert.deepEqual(differences(base.network, restored.network), [], `${x}: restored network`);
    assert.ok(restored.trace.success);
    assert.deepEqual(restored.trace.events.map((e) => [e.actor, e.title, e.facts]), base.trace.events.map((e) => [e.actor, e.title, e.facts]), `${x}: rerun`);
  }
});

test("experiment steps: the change hides the result to predict, the stop shows the simulator's own failure, the compare table differs", () => {
  for (const x of experimentIds) {
    const t = traceOf(x),
      broken = runOf(x);
    assert.deepEqual(t.frames.slice(0, trace.frames.length).map((f) => f.id), trace.frames.map((f) => f.id), `${x}: the journey comes first, unchanged`);
    const ids = t.frames.slice(trace.frames.length).map((f) => f.id);
    assert.equal(ids[0], `${x}-baseline`);
    assert.equal(ids.at(-1), `${x}-restore`);
    assert.ok(!t.frames.find((f) => f.id === `${x}-change`)!.facts.some((f) => /succeeded|summary/.test(f.id)), `${x}: no result on the change`);
    const stop = t.frames.find((f) => f.id === `${x}-stop`)!;
    assert.equal(broken.trace.events[stop.data.index].title, "Delivery stopped");
    assert.equal(stop.facts.find((f) => f.id === "stop-reason")!.value, broken.trace.failure!.reason);
    assert.equal(stop.facts.find((f) => f.id === "stop-message")!.value, broken.trace.failure!.message);
    assert.deepEqual(stop.focus, [broken.trace.failure!.device]);
    assert.equal(t.outcome.pingSucceeded, false);
    assert.equal(t.outcome.delivered, false, `${x}: the tutor may not assert delivery`);
    for (const item of lesson.experiments.find((e) => e.id === x)!.compare) assert.ok(item.outcome in t.outcome);
  }
  const wrong = traceOf("wrong-gateway");
  assert.equal(wrong.outcome.nextHop, fact("wrong-gateway-diverge", "difference-next-hop-experiment", wrong));
  assert.notEqual(wrong.outcome.nextHop, trace.outcome.nextHop);
  assert.equal(traceOf("no-return-gateway").outcome.requestArrived, true);
  assert.equal(traceOf("nat-off").outcome.serverSawSource, fact("nat-translate", "internet-before-source-ip"));
  assert.notEqual(trace.outcome.serverSawSource, traceOf("nat-off").outcome.serverSawSource);
});

test("tutor: delivery may be asserted because the run succeeded; wrong MACs, a switch as a hop and NAT claims are rejected", () => {
  const at = (stepId: string) => buildLessonTutorContext({ lessonId: lesson.id, lessonVersion: lesson.version, params: {}, track: "journey", stepId, level: null, question: "Why?" });
  const say = (explanation: string, evidence: string[], stepId: string) =>
    validateLessonTutorOutput({ explanation, evidence, misconception: null, attention: null, action: "none" }, at(stepId)).ok;
  assert.equal(say("Your PC's frame goes to destination MAC 02:3b:27:36:10:00, the router, not the server.", ["destination-mac"], "the-frame"), true);
  assert.equal(say("The destination MAC is 02:3c:4d:ce:0a:00, the server's.", ["destination-mac"], "the-frame"), false);
  assert.equal(say("Here the switch is a hop on the way.", ["lan-after-ttl"], "switch-forwards"), false);
  assert.equal(say("The router translates the source IP to its own address.", ["nat"], "router-forwards"), false);
  assert.equal(say("The simulated ping succeeded: the reply arrived back at your PC.", ["delivered"], "complete"), true);
  // NAT: the server sees the public address, never the private one.
  assert.equal(say("The server sees 203.0.113.2, the home router's public address.", ["internet-after-source-ip"], "nat-translate"), true);
  assert.equal(say("The server sees 192.168.1.10 as the source.", ["internet-after-source-ip"], "nat-translate"), false);
  // In an experiment whose run fails, delivery can't be claimed.
  const claim = (explanation: string, stepId: string, track: string) =>
    validateLessonTutorOutput(
      { explanation, evidence: ["stop-reason"], misconception: null, attention: null, action: "none" },
      buildLessonTutorContext({ lessonId: lesson.id, lessonVersion: lesson.version, params: {}, track, stepId, level: null, question: "Why?" }),
    ).ok;
  assert.equal(claim("The ping arrived at the server anyway.", "wrong-gateway-stop", "wrong-gateway"), false);
  assert.equal(claim("The run stops at your PC: ARP got no reply, so it can't build the frame.", "wrong-gateway-stop", "wrong-gateway"), true);
});

test("visiting Lesson 2 keeps earlier lesson records byte-for-byte, and a completed Lesson 2 record stays completed", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const old = { lessonVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-13T10:00:00.000Z", seen: [], total: 13, chaptersSeen: [], completedAt: "2026-11-13T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false };
  storage.setItem(LEARNING_KEY, JSON.stringify({ version: 1, lessons: { "ipv4-subnets": old, "ip-addressing": { ...old, lessonVersion: "1.1.0" } } }));
  saveLearning(storage, recordLessonVisit(loadLearning(storage).learning, lesson));
  const saved = JSON.parse(store.get(LEARNING_KEY)!).lessons;
  assert.deepEqual(saved["ipv4-subnets"], old);
  assert.deepEqual(saved["ip-addressing"], { ...old, lessonVersion: "1.1.0" });
  assert.equal(saved["local-delivery-routing"].lessonVersion, "1.0.0");
  assert.ok(resolveTrack(lesson, {}, JOURNEY).steps.length === 22);
  // A learner who completed the four-chapter release keeps the completion, the steps seen and the position.
  const done = {
    lessonVersion: "1.0.0", visits: 1, lastVisitedAt: "2026-11-14T16:00:00.000Z", seen: ["decide", "complete", "default-route"], total: 16,
    chaptersSeen: ["same-subnet", "arp-or-gateway", "two-addresses", "router-between-subnets"], completedAt: "2026-11-14T16:00:00.000Z",
    experimentsCompleted: [], position: { params: {}, track: JOURNEY, stepId: "default-route", journeyStepId: "default-route" }, updated: false,
  };
  storage.setItem(LEARNING_KEY, JSON.stringify({ version: 1, lessons: { "local-delivery-routing": done } }));
  saveLearning(storage, recordLessonVisit(loadLearning(storage).learning, lesson, "2026-11-15T09:00:00.000Z"));
  assert.deepEqual(JSON.parse(store.get(LEARNING_KEY)!).lessons["local-delivery-routing"], { ...done, visits: 2, lastVisitedAt: "2026-11-15T09:00:00.000Z" });
  assert.ok(resolveTrack(lesson, {}, JOURNEY).steps.some((step) => step.id === done.position.stepId), "the saved position still exists");
  assert.equal(lessonStatus(loadLearning(storage).learning, lesson).state, "completed");
});
