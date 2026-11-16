import test from "node:test";
import assert from "node:assert/strict";
import { activityState, findActivity, isRequired, loadEvidence, networkingPath, pathPosition, recommend, stageProgress, type Evidence } from "../src/learning/networking-path.ts";
import { missions as networkMissions } from "../src/practice/network/missions.ts";
import { loadMissionStore } from "../src/practice/network/mission-progress.ts";
import { CHALLENGES_KEY } from "../src/practice/network/storage.ts";
import { starterOptions } from "../src/practice/network/starters.ts";
import { missions as frameworkMissions } from "../src/learning/missions/catalog.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { loadLearning } from "../src/learning/lessons/progress.ts";
import { loadProgress } from "../src/learning/progress.ts";
import { loadVisits } from "../src/learning/visits.ts";

const activities = networkingPath.flatMap((stage) => [...stage.learn, ...stage.practise]);
const ids = activities.map((activity) => activity.id);
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};
const empty = (): Evidence => ({ learning: { version: 1, lessons: {} }, progress: { version: 1, missions: {} }, network: { version: 1, missions: {} }, visits: { version: 1, activities: {} }, architecture: { version: 1, challenges: {}, lessons: {} }, labs: { version: 1, labs: {}, units: {} } });
const visit = (e: Evidence, id: string, at = "2026-11-10T10:00:00.000Z") => {
  e.visits.activities[id] = { first: at, last: at, count: 1 };
};
/** A lesson part-way through: steps seen beyond the first, a saved place, last opened at `at`. */
const lessonPartway = (e: Evidence, id: string, seen: number, at: string) => {
  const lesson = findLesson(id)!;
  e.learning.lessons[id] = {
    lessonVersion: lesson.version, visits: 2, lastVisitedAt: at, seen: Array.from({ length: seen }, (_, i) => `s${i}`), total: 13, chaptersSeen: [], completedAt: null, experimentsCompleted: [],
    position: { params: {}, track: "journey", stepId: `s${seen - 1}`, journeyStepId: `s${seen - 1}` }, updated: false,
  };
};
const tcpOpened = (e: Evidence, id: string, at: string) => {
  const m = frameworkMissions.find((x) => x.id === id)!;
  e.progress.missions[id] = { missionVersion: m.version, visits: 1, lastVisitedAt: at, masteredAt: null, current: null, attempts: [] };
};
const lessonDone = (e: Evidence, id = "ipv4-subnets") => {
  const lesson = findLesson(id)!;
  e.learning.lessons[id] = { lessonVersion: lesson.version, visits: 1, lastVisitedAt: "t", seen: [], total: 0, chaptersSeen: [], completedAt: "t", experimentsCompleted: [], position: null, updated: false };
};
// Framework missions on the path: the TCP missions and the two IPv4 lessons' practice missions.
const pathConcepts = ["tcp", "ipv4-subnets", "local-delivery-routing"];
const netDone = (e: Evidence, id: string, mastered = false) => {
  const m = networkMissions.find((x) => x.id === id)!;
  e.network.missions[id] = { missionVersion: m.version, attempts: [], completedAt: "t", masteredAt: mastered ? "t" : null };
};
const tcpDone = (e: Evidence, id: string, mastered = false) => {
  const m = frameworkMissions.find((x) => x.id === id)!;
  e.progress.missions[id] = {
    missionVersion: m.version, visits: 1, lastVisitedAt: "t", masteredAt: mastered ? "t" : null, current: null,
    attempts: [{ attemptId: "a", number: 1, variantId: "v", scenarioKey: "k", status: "done", predictionCorrect: true, explanationCorrect: true, reasoning: "", at: "t" }],
  };
};

test("every path activity resolves to existing content, once, with matching titles and versions", () => {
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const activity of activities) {
    if (activity.id.startsWith("starter:")) {
      const option = starterOptions.find((s) => `starter:${s.id}` === activity.id);
      assert.ok(option, activity.id);
      assert.equal(activity.title, option.name);
    }
    if (activity.track === "network-mission") {
      const m = networkMissions.find((x) => x.id === activity.id)!;
      assert.equal(activity.title, m.title, `${m.id} title`);
      assert.equal(activity.version, m.version, `${m.id} version: update networking-path.ts when a mission version changes`);
    }
    for (const need of activity.needs ?? []) {
      assert.ok(findActivity(need), `${activity.id} needs ${need}`);
      assert.ok(ids.indexOf(need) < ids.indexOf(activity.id), `${need} comes before ${activity.id}`);
    }
  }
});

test("every networking mission and every TCP and IPv4 mission is in the path exactly once, in an order that respects prerequisites", () => {
  const net = activities.filter((a) => a.track === "network-mission").map((a) => a.id);
  assert.deepEqual([...net].sort(), networkMissions.map((m) => m.id).sort());
  const levels = net.map((id) => networkMissions.find((m) => m.id === id)!.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), "networking missions keep their level order");
  const framework = activities.filter((a) => a.track === "mission").map((a) => a.id);
  assert.deepEqual([...framework].sort(), frameworkMissions.filter((m) => pathConcepts.includes(m.concept)).map((m) => m.id).sort());
  // DHCP is explored before the subnet lesson; the DHCP troubleshooting mission comes after it.
  assert.ok(ids.indexOf("starter:wifi") < ids.indexOf("ipv4-subnets"));
  assert.ok(ids.indexOf("ipv4-subnets") < ids.indexOf("join-and-address"));
  // Lesson 1 and its practice come before Lesson 2, and each lesson before the missions that practise it.
  assert.ok(ids.indexOf("join-and-address") < ids.indexOf("local-delivery-routing"));
  for (const id of ["gateway-or-direct", "leave-the-lan", "bring-reply-home"]) assert.ok(ids.indexOf("local-delivery-routing") < ids.indexOf(id), id);
  // The replaced lesson is no longer on the path.
  assert.equal(findActivity("ip-addressing"), undefined);
  // The investigation of a lost segment follows the mission that teaches cumulative ACKs.
  assert.ok(ids.indexOf("tcp-lost-segment") < ids.indexOf("missing-segment"));
});

test("explorations are only ever visited, and never count towards a stage's completion", () => {
  const e = empty();
  for (const id of ["connections", "starter:lan", "subnet-explorer", "hello-tcp", "starter:internet", "concept:dns"]) {
    assert.equal(isRequired(findActivity(id)!), false, id);
    assert.equal(activityState(findActivity(id)!, e), "not-started");
    visit(e, id);
    assert.equal(activityState(findActivity(id)!, e), "visited", `${id}: a visit is never completion`);
  }
  assert.deepEqual(stageProgress(networkingPath[0], e), { tracked: 0, completed: 0, mastered: 0, explorations: 1, explored: 1 });
  lessonDone(e);
  netDone(e, "neighbours", true);
  assert.deepEqual(stageProgress(networkingPath[2], e), { tracked: 5, completed: 2, mastered: 1, explorations: 1, explored: 1 });
});

test("opening a lesson or mission is a visit, not progress", () => {
  const e = empty();
  visit(e, "no-connection");
  tcpOpened(e, "ipv4-network-address", "2026-11-10T10:00:00.000Z");
  assert.equal(activityState(findActivity("no-connection")!, e), "visited");
  assert.equal(activityState(findActivity("ipv4-network-address")!, e), "visited");
  assert.deepEqual(stageProgress(networkingPath[1], e), { tracked: 1, completed: 0, mastered: 0, explorations: 2, explored: 0 });
});

test("progress is read from the existing stores, including legacy challenges and damaged data", () => {
  const storage = memory({
    [CHALLENGES_KEY]: JSON.stringify(["cable"]),
    "kitab.learning.v1": "{not json",
    "kitab.progress.v1": JSON.stringify({ version: 2 }),
  });
  const e: Evidence = { learning: loadLearning(storage).learning, progress: loadProgress(storage).progress, network: loadMissionStore(storage), visits: loadVisits(storage), architecture: { version: 1, challenges: {}, lessons: {} }, labs: { version: 1, labs: {}, units: {} } };
  assert.equal(activityState(findActivity("no-connection")!, e), "completed", "an earlier challenge counts as completed");
  assert.equal(activityState(findActivity("ipv4-subnets")!, e), "not-started");
  assert.equal(activityState(findActivity("tcp-lost-segment")!, e), "not-started");
});

test("recommend: a first-time learner starts at the very first activity", () => {
  const r = recommend(empty());
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["start", "connections", "home"]);
});

test("recommend: explorations are walked forward once, never sent back to after later progress", () => {
  const e = empty();
  // Visiting Stage 1's explorer moves on to the next exploration, in order.
  visit(e, "connections");
  let r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["next", "starter:lan"]);
  // Opening a later exploration out of curiosity does not skip what comes before it.
  visit(e, "starter:internet");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["next", "starter:lan"]);

  // A learner who completed Lesson 1 without ever opening Stage 1 or 2 is not sent back there.
  const later = empty();
  lessonDone(later);
  r = recommend(later);
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["next", "subnet-explorer", "addresses"]);
  visit(later, "subnet-explorer");
  r = recommend(later);
  assert.deepEqual([r.kind, r.activity.id], ["next", "ipv4-network-address"]);
});

test("recommend: a learner part-way through IPv4 Lesson 1 continues it, even after opening other things", () => {
  const e = empty();
  lessonPartway(e, "ipv4-subnets", 5, "2026-11-12T09:00:00.000Z");
  // The audit's case: the lesson in progress, then a TCP mission only opened afterwards.
  tcpOpened(e, "tcp-send-window", "2026-11-12T09:30:00.000Z");
  visit(e, "tcp-send-window", "2026-11-12T09:30:00.000Z");
  const r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["continue", "ipv4-subnets", "addresses"]);
  assert.equal(activityState(findActivity("ipv4-subnets")!, e), "in-progress");
  assert.equal(activityState(findActivity("tcp-send-window")!, e), "visited");
});

test("recommend: of several things in progress, the most recently active is continued", () => {
  const e = empty();
  lessonPartway(e, "ipv4-subnets", 5, "2026-11-12T09:00:00.000Z");
  e.network.missions["neighbours"] = { missionVersion: "1.0.0", attempts: [{ variant: "pc-mask", startedAt: "2026-11-13T09:00:00.000Z", completedAt: null, diagnosis: null, evidence: false, explanation: null, prediction: null, hints: 0 }], completedAt: null, masteredAt: null };
  let r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["continue", "neighbours"], "the unfinished mission was touched last");
  // Returning to the lesson makes it the most recent again.
  lessonPartway(e, "ipv4-subnets", 6, "2026-11-14T09:00:00.000Z");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["continue", "ipv4-subnets"]);
});

test("recommend: an unfinished framework mission is continued; one only opened is not", () => {
  const e = empty();
  lessonDone(e);
  tcpOpened(e, "ipv4-network-address", "2026-11-12T10:00:00.000Z");
  let r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["next", "subnet-explorer"], "opened only: not offered as continue");
  e.progress.missions["ipv4-network-address"].attempts.push({ attemptId: "a", number: 1, variantId: "v", scenarioKey: "k", status: "running", predictionCorrect: true, explanationCorrect: null, reasoning: "", at: "2026-11-12T10:05:00.000Z" });
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["continue", "ipv4-network-address"]);
});

test("recommend: honest next steps through the whole path, then mastery, then done", () => {
  const e = empty();
  netDone(e, "no-connection");
  let r = recommend(e);
  // Past the first mission, the next activity still to do: Lesson 1.
  assert.deepEqual([r.kind, r.activity.id], ["next", "ipv4-subnets"]);
  lessonDone(e);
  tcpDone(e, "ipv4-network-address");
  r = recommend(e);
  // The explorer behind the frontier is not offered again; the next mission is.
  assert.deepEqual([r.kind, r.activity.id], ["next", "ipv4-local-or-remote"]);
  tcpDone(e, "ipv4-local-or-remote");
  netDone(e, "neighbours");
  netDone(e, "join-and-address");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["next", "local-delivery-routing", "routing"]);
  lessonDone(e, "local-delivery-routing");
  tcpDone(e, "gateway-or-direct");
  for (const id of ["leave-the-lan", "bring-reply-home"]) netDone(e, id);
  r = recommend(e);
  // DNS is met as a reading before the first activity that looks up a name.
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["next", "concept:dns", "internet"]);

  for (const id of ["tcp-lost-segment", "tcp-send-window", "tcp-lab"]) tcpDone(e, id);
  netDone(e, "missing-segment");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["mastery", "no-connection"]);

  for (const m of networkMissions) netDone(e, m.id, true);
  for (const id of ["tcp-lost-segment", "tcp-send-window", "tcp-lab", "ipv4-network-address", "ipv4-local-or-remote", "gateway-or-direct"]) tcpDone(e, id, true);
  assert.equal(recommend(e).kind, "done");
});

test("recommend: required work skipped earlier is offered once everything ahead is done", () => {
  const e = empty();
  // Everything from Stage 3 on is completed; Stage 2's mission was skipped.
  lessonDone(e);
  lessonDone(e, "local-delivery-routing");
  for (const id of ["ipv4-network-address", "ipv4-local-or-remote", "gateway-or-direct", "tcp-lost-segment", "tcp-send-window", "tcp-lab"]) tcpDone(e, id);
  for (const id of ["neighbours", "join-and-address", "leave-the-lan", "bring-reply-home", "missing-segment"]) netDone(e, id);
  const r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["next", "no-connection"]);
});

test("a mission version bump keeps completion but not mastery, as on the missions page", () => {
  const e = empty();
  e.network.missions["neighbours"] = { missionVersion: "0.9.0", attempts: [], completedAt: "t", masteredAt: "t" };
  assert.equal(activityState(findActivity("neighbours")!, e), "completed");
});

test("pathPosition gives the stage, the next activity in order and prerequisites", () => {
  const p = pathPosition("join-and-address")!;
  assert.equal(p.stageNumber, 3);
  assert.equal(p.next?.id, "local-delivery-routing");
  assert.deepEqual(p.needs.map((a) => a.id), ["starter:wifi", "ipv4-subnets"]);
  assert.equal(pathPosition("ipv4-subnets")!.next?.id, "subnet-explorer");
  assert.equal(pathPosition("local-delivery-routing")!.stageNumber, 4);
  assert.deepEqual(pathPosition("gateway-or-direct")!.needs.map((a) => a.id), ["local-delivery-routing"]);
  assert.equal(pathPosition("ip-addressing"), undefined);
  assert.equal(pathPosition("connections")!.next?.id, "starter:lan");
  assert.equal(pathPosition("bring-reply-home")!.next?.id, "concept:dns");
  assert.equal(pathPosition("concept:dns")!.next?.id, "starter:internet");
  assert.equal(pathPosition("concept:dns")!.activity.path, "/concepts/dns");
  assert.equal(pathPosition("tcp-lab")!.next, undefined);
  assert.equal(pathPosition("array-insert"), undefined);
});

test("reading progress for display never writes, even when a store is damaged", () => {
  const writes: string[] = [];
  const data = new Map([["kitab.learning.v1", "{not json"], ["kitab.visits.v1", "{also broken"], ["kitab.progress.v1", JSON.stringify({ version: 9 })]]);
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string) => void writes.push(`set ${k}`), removeItem: (k: string) => void writes.push(`remove ${k}`) };
  const e = loadEvidence(storage);
  assert.deepEqual(writes, []);
  assert.deepEqual(e.learning, { version: 1, lessons: {} });
  assert.deepEqual(e.visits, { version: 1, activities: {} });
  assert.equal(recommend(e).kind, "start");
});
