import test from "node:test";
import assert from "node:assert/strict";
import { activityState, findActivity, networkingPath, pathPosition, recommend, stageProgress, type Evidence } from "../src/learning/networking-path.ts";
import { missions as networkMissions } from "../src/practice/network/missions.ts";
import { loadMissionStore } from "../src/practice/network/mission-progress.ts";
import { CHALLENGES_KEY } from "../src/practice/network/storage.ts";
import { starterOptions } from "../src/practice/network/starters.ts";
import { missions as frameworkMissions } from "../src/learning/missions/catalog.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { loadLearning } from "../src/learning/lessons/progress.ts";
import { loadProgress } from "../src/learning/progress.ts";

const activities = networkingPath.flatMap((stage) => [...stage.learn, ...stage.practise]);
const ids = activities.map((activity) => activity.id);
const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};
const empty = (): Evidence => ({ learning: { version: 1, lessons: {} }, progress: { version: 1, missions: {} }, network: { version: 1, missions: {} } });
const ip = findLesson("ip-addressing")!;
const lessonDone = (e: Evidence) => {
  e.learning.lessons[ip.id] = { lessonVersion: ip.version, visits: 1, lastVisitedAt: "t", seen: [], total: 0, chaptersSeen: [], completedAt: "t", experimentsCompleted: [], position: null, updated: false };
};
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

test("every networking mission and TCP mission is in the path exactly once, in an order that respects prerequisites", () => {
  const net = activities.filter((a) => a.track === "network-mission").map((a) => a.id);
  assert.deepEqual([...net].sort(), networkMissions.map((m) => m.id).sort());
  const levels = net.map((id) => networkMissions.find((m) => m.id === id)!.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), "networking missions keep their level order");
  const tcp = activities.filter((a) => a.track === "mission").map((a) => a.id);
  assert.deepEqual([...tcp].sort(), frameworkMissions.filter((m) => m.concept === "tcp").map((m) => m.id).sort());
  // DHCP is explored before the subnet lesson; the DHCP troubleshooting mission comes after it.
  assert.ok(ids.indexOf("starter:wifi") < ids.indexOf("ip-addressing"));
  assert.ok(ids.indexOf("ip-addressing") < ids.indexOf("join-and-address"));
  // The investigation of a lost segment follows the mission that teaches cumulative ACKs.
  assert.ok(ids.indexOf("tcp-lost-segment") < ids.indexOf("missing-segment"));
});

test("untracked activities never count as completed", () => {
  const e = empty();
  for (const id of ["connections", "starter:lan", "hello-tcp", "starter:internet"]) assert.equal(activityState(findActivity(id)!, e), null);
  assert.deepEqual(stageProgress(networkingPath[0], e), { tracked: 0, completed: 0, mastered: 0 });
  lessonDone(e);
  netDone(e, "neighbours", true);
  assert.deepEqual(stageProgress(networkingPath[2], e), { tracked: 5, completed: 2, mastered: 1 });
});

test("progress is read from the existing stores, including legacy challenges and damaged data", () => {
  const storage = memory({
    [CHALLENGES_KEY]: JSON.stringify(["cable"]),
    "kitab.learning.v1": "{not json",
    "kitab.progress.v1": JSON.stringify({ version: 2 }),
  });
  const e: Evidence = { learning: loadLearning(storage).learning, progress: loadProgress(storage).progress, network: loadMissionStore(storage) };
  assert.equal(activityState(findActivity("no-connection")!, e), "completed", "an earlier challenge counts as completed");
  assert.equal(activityState(findActivity("ip-addressing")!, e), "not-started");
  assert.equal(activityState(findActivity("tcp-lost-segment")!, e), "not-started");
});

test("recommend: honest next steps from recorded progress", () => {
  const e = empty();
  let r = recommend(e);
  assert.equal(r.kind, "start");
  assert.equal(r.activity.id, "connections");

  // Progress elsewhere does not skip the exploration that comes first.
  lessonDone(e);
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["suggested", "connections"]);

  // Past the first tracked checkpoint: the starter between the lesson and the next mission is suggested.
  netDone(e, "no-connection");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["suggested", "starter:routed"]);

  // A mission already started is continued instead.
  e.network.missions["neighbours"] = { missionVersion: "1.0.0", attempts: [{ variant: "pc-mask", startedAt: "s", completedAt: null, diagnosis: null, evidence: false, explanation: null, prediction: null, hints: 0 }], completedAt: null, masteredAt: null };
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["continue", "neighbours"]);

  // Untracked activities between two tracked ones are suggested, not assumed done.
  netDone(e, "neighbours");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["next", "join-and-address"]);
  for (const id of ["join-and-address", "leave-the-lan", "bring-reply-home"]) netDone(e, id);
  r = recommend(e);
  // DNS is met as a concept before the first activity that looks up a name.
  assert.deepEqual([r.kind, r.activity.id, r.stage.id], ["suggested", "concept:dns", "internet"]);

  for (const id of ["tcp-lost-segment", "tcp-send-window", "tcp-lab"]) tcpDone(e, id);
  netDone(e, "missing-segment");
  r = recommend(e);
  assert.deepEqual([r.kind, r.activity.id], ["mastery", "no-connection"]);

  for (const m of networkMissions) netDone(e, m.id, true);
  for (const id of ["tcp-lost-segment", "tcp-send-window", "tcp-lab"]) tcpDone(e, id, true);
  assert.equal(recommend(e).kind, "done");
});

test("a mission version bump keeps completion but not mastery, as on the missions page", () => {
  const e = empty();
  e.network.missions["neighbours"] = { missionVersion: "0.9.0", attempts: [], completedAt: "t", masteredAt: "t" };
  assert.equal(activityState(findActivity("neighbours")!, e), "completed");
});

test("pathPosition gives the stage, the next activity in order and prerequisites", () => {
  const p = pathPosition("join-and-address")!;
  assert.equal(p.stageNumber, 3);
  assert.equal(p.next?.id, "leave-the-lan");
  assert.deepEqual(p.needs.map((a) => a.id), ["starter:wifi", "ip-addressing"]);
  assert.equal(pathPosition("connections")!.next?.id, "starter:lan");
  assert.equal(pathPosition("bring-reply-home")!.next?.id, "concept:dns");
  assert.equal(pathPosition("concept:dns")!.next?.id, "starter:internet");
  assert.equal(pathPosition("concept:dns")!.activity.path, "/concepts/dns");
  assert.equal(pathPosition("tcp-lab")!.next, undefined);
  assert.equal(pathPosition("array-insert"), undefined);
});
