import test from "node:test";
import assert from "node:assert/strict";
import { chapters } from "../src/content/chapters.ts";
import { missions as frameworkMissions } from "../src/learning/missions/catalog.ts";
import { missions as networkMissions } from "../src/practice/network/missions.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import type { Evidence } from "../src/learning/networking-path.ts";
import { activeTrack, dataStructuresPath, findTrack, hasHistory, kindOf, locate, nextLink, recommendFor, trackProgress, tracks } from "../src/learning/tracks.ts";

const all = tracks.flatMap((track) => track.stages.flatMap((stage) => [...stage.learn, ...stage.practise]));
const empty = (): Evidence => ({ learning: { version: 1, lessons: {} }, progress: { version: 1, missions: {} }, network: { version: 1, missions: {} }, visits: { version: 1, activities: {} } });

test("every activity id is unique across tracks, and every mission is in exactly one track", () => {
  const ids = all.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const m of frameworkMissions) assert.equal(ids.filter((id) => id === m.id).length, 1, m.id);
  for (const m of networkMissions) assert.equal(ids.filter((id) => id === m.id).length, 1, m.id);
});

test("the data-structures track uses only existing lessons, readings and missions, each reading before its practice", () => {
  const ds = findTrack("data-structures")!;
  assert.equal(ds.stages, dataStructuresPath);
  for (const stage of ds.stages) {
    assert.ok(stage.learn.length > 0 && stage.practise.length > 0, `${stage.id} has something to learn and to practise`);
    for (const a of [...stage.learn, ...stage.practise]) {
      if (a.track === "lesson") assert.ok(findLesson(a.id), a.id);
      if (a.track === "mission") assert.equal(frameworkMissions.find((m) => m.id === a.id)?.title, a.title, a.id);
      if (a.id.startsWith("concept:")) assert.ok(chapters.some((c) => `concept:${c.slug}` === a.id), a.id);
      for (const need of a.needs ?? []) assert.ok(locate(need), `${a.id} needs ${need}`);
    }
  }
  assert.deepEqual(locate("array-insert-shift")!.needs.map((a) => a.id), ["array-insert"]);
});

test("locate gives track, unit, step, role and neighbours within the same track only", () => {
  const at = locate("ipv4-network-address")!;
  assert.deepEqual([at.track.id, at.stage.id, at.stageNumber, at.stepNumber, at.stepCount, at.role], ["networking", "addresses", 3, 3, 6, "practise"]);
  assert.equal(at.previous?.id, "subnet-explorer");
  assert.equal(at.next?.id, "ipv4-local-or-remote");
  assert.equal(locate("tcp-lab")!.next, undefined, "the networking track ends; it does not run into the next track");
  assert.equal(locate("array-insert")!.previous, undefined);
  assert.equal(locate("connections")!.role, "learn");
  assert.equal(locate("ip-addressing"), undefined, "the replaced lesson is in no track");
  assert.deepEqual(["hello-tcp", "concept:dns", "starter:lan", "tcp-lab", "neighbours", "gateway-or-direct"].map((id) => kindOf(locate(id)!.activity)), ["Lesson", "Reading", "Explore", "Challenge", "Troubleshoot", "Predict"]);
});

test("track progress counts lessons and missions only, and the active track follows the latest activity", () => {
  const e = empty();
  assert.equal(hasHistory(e), false);
  assert.equal(activeTrack(e).id, "networking");
  e.visits.activities["concept:arrays"] = { first: "2026-11-01T00:00:00.000Z", last: "2026-11-01T00:00:00.000Z", count: 1 };
  assert.equal(hasHistory(e), true);
  assert.equal(activeTrack(e).id, "data-structures");
  const ds = findTrack("data-structures")!;
  assert.deepEqual(trackProgress(ds, e), { total: 9, completed: 0, mastered: 0, started: false, percent: 0 }, "a reading opened is not progress");
  const m = frameworkMissions.find((x) => x.id === "ds-hash-insert")!;
  e.progress.missions[m.id] = { missionVersion: m.version, visits: 1, lastVisitedAt: "2026-11-02T00:00:00.000Z", masteredAt: "2026-11-02T00:00:00.000Z", current: null, attempts: [] };
  assert.deepEqual(trackProgress(ds, e), { total: 9, completed: 1, mastered: 1, started: true, percent: 11 });
  assert.equal(trackProgress(findTrack("networking")!, e).total, 14);
});

test("each track recommends from its own steps", () => {
  const e = empty();
  const ds = findTrack("data-structures")!;
  assert.deepEqual(nextLink(recommendFor(ds, e), ds), { label: "Start: Make room in an array", path: "/learn/array-insert" });
  const net = findTrack("networking")!;
  assert.deepEqual(nextLink(recommendFor(net, e), net), { label: "Start: How your home connects", path: "/practice/connections" });
});
