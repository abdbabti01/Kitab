// Lesson 2 foundation: every networking value shown comes from a real simulator run, never from the lesson's own code.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "../src/learning/engines/index.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { RUNS, frameOf, packetOf, runOf, type LocalDeliveryData, type RunId } from "../src/learning/engines/local-delivery.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { JOURNEY, resolveTrack, validateLessonContent } from "../src/learning/lessons/runtime.ts";
import { buildLessonTutorContext, validateLessonTutorOutput } from "../src/learning/lessons/tutor.ts";
import { loadLearning, recordLessonVisit, saveLearning, LEARNING_KEY } from "../src/learning/lessons/progress.ts";

const lesson = findLesson("local-delivery-routing")!;
const trace = buildTrace<LocalDeliveryData>("local-delivery", {});
const prefixOf = (run: RunId) => (run === "routed" ? "" : `${run}-`);
const fact = (frameId: string, id: string) => trace.frames.find((f) => f.id === frameId)!.facts.find((f) => f.id === id)?.value;

test("the lesson is registered with its permanent id, four chapters and its own engine", () => {
  assert.equal(lesson.id, "local-delivery-routing");
  assert.equal(lesson.version, "1.0.0");
  assert.deepEqual(lesson.chapters.map((c) => c.id), ["same-subnet", "arp-or-gateway", "two-addresses", "router-between-subnets"]);
  assert.deepEqual(validateLessonContent(lesson), []);
  assert.equal(trace.frames.length, 16);
});

test("every packet, frame, ARP and decision value shown equals the simulator event it came from", () => {
  for (const frame of trace.frames.filter((f) => f.data.view !== "settings")) {
    const pairs: [RunId, number, string][] = [[frame.data.run, frame.data.index, frame.data.view === "compare" ? "after-" : ""]];
    if (frame.data.before) pairs.push([frame.data.before.run, frame.data.before.index, "before-"]);
    for (const [run, index, side] of pairs) {
      const event = runOf(run).trace.events[index],
        p = `${prefixOf(run)}${side}`,
        packet = packetOf(event),
        eth = frameOf(event);
      const value = (id: string) => fact(frame.id, `${p}${id}`);
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
});

test("deterministic: the same lesson trace every time", () => {
  assert.deepEqual(buildTrace("local-delivery", {}).frames.map((f) => f.facts), trace.frames.map((f) => f.facts));
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
});

test("visiting Lesson 2 keeps earlier lesson records byte-for-byte", () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const old = { lessonVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-13T10:00:00.000Z", seen: [], total: 13, chaptersSeen: [], completedAt: "2026-11-13T10:00:00.000Z", experimentsCompleted: [], position: null, updated: false };
  storage.setItem(LEARNING_KEY, JSON.stringify({ version: 1, lessons: { "ipv4-subnets": old, "ip-addressing": { ...old, lessonVersion: "1.1.0" } } }));
  saveLearning(storage, recordLessonVisit(loadLearning(storage).learning, lesson));
  const saved = JSON.parse(store.get(LEARNING_KEY)!).lessons;
  assert.deepEqual(saved["ipv4-subnets"], old);
  assert.deepEqual(saved["ip-addressing"], { ...old, lessonVersion: "1.1.0" });
  assert.equal(saved["local-delivery-routing"].lessonVersion, "1.0.0");
  assert.ok(resolveTrack(lesson, {}, JOURNEY).steps.length === 16);
});
