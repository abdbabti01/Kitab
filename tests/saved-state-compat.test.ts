// A learner's saved state from before the IPv4 switchover, read by the new application: nothing is lost, rewritten or
// misread. The fixture is shaped exactly like the stores written by main before Lessons 1 and 2 joined the path.
import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { findLesson, journeys, lessons, replacedLessons } from "../src/learning/lessons/catalog.ts";
import { lessonStatus, loadLearning, recordLessonVisit, recordStep, saveLearning, LEARNING_KEY } from "../src/learning/lessons/progress.ts";
import { restoreNav } from "../src/learning/lessons/navigation.ts";
import { resolveTrack, safeParams } from "../src/learning/lessons/runtime.ts";
import { loadProgress, practiceState, PROGRESS_KEY } from "../src/learning/progress.ts";
import { loadMissionStore, MISSIONS_KEY } from "../src/practice/network/mission-progress.ts";
import { CHALLENGES_KEY } from "../src/practice/network/storage.ts";
import { activityState, findActivity, loadEvidence, recommend, type Evidence } from "../src/learning/networking-path.ts";

const position = (stepId: string, params: Record<string, string | number> = {}) => ({ params, track: "journey", stepId, journeyStepId: stepId });
const before = {
  [LEARNING_KEY]: {
    version: 1,
    lessons: {
      // The replaced lesson, completed, with its saved place.
      "ip-addressing": { lessonVersion: "1.1.0", visits: 4, lastVisitedAt: "2026-11-01T10:00:00.000Z", seen: ["choose-hop"], total: 13, chaptersSeen: ["address", "routes"], completedAt: "2026-11-01T10:00:00.000Z", experimentsCompleted: [], position: position("choose-hop", { prefix: 25, target: "printer" }), updated: false },
      // Lesson 1 part-way through.
      "ipv4-subnets": { lessonVersion: "1.0.0", visits: 1, lastVisitedAt: "2026-11-10T09:00:00.000Z", seen: ["meet-address"], total: 13, chaptersSeen: ["address-interface"], completedAt: null, experimentsCompleted: [], position: position("meet-address"), updated: false },
      // Lesson 2 completed in its four-chapter release.
      "local-delivery-routing": { lessonVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-14T16:00:00.000Z", seen: ["decide", "default-route"], total: 16, chaptersSeen: ["same-subnet", "arp-or-gateway", "two-addresses", "router-between-subnets"], completedAt: "2026-11-14T16:00:00.000Z", experimentsCompleted: [], position: position("default-route"), updated: false },
    },
  },
  [PROGRESS_KEY]: {
    version: 1,
    missions: {
      "tcp-lost-segment": { missionVersion: "1.1.0", visits: 3, lastVisitedAt: "2026-10-01T10:00:00.000Z", masteredAt: "2026-10-01T10:05:00.000Z", attempts: [], current: null },
      "ipv4-local-or-remote": { missionVersion: "1.0.0", visits: 2, lastVisitedAt: "2026-11-13T10:00:00.000Z", masteredAt: "2026-11-13T10:05:00.000Z", attempts: [], current: null },
    },
  },
  [MISSIONS_KEY]: { version: 1, missions: { neighbours: { missionVersion: "1.0.0", attempts: [], completedAt: "2026-11-02T10:00:00.000Z", masteredAt: "2026-11-02T10:10:00.000Z" } } },
  [CHALLENGES_KEY]: ["cable", "nat"],
};
const storage = () => {
  const data = new Map(Object.entries(before).map(([k, v]) => [k, JSON.stringify(v)]));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

test("every pre-switchover store loads without recovery, and the replaced lesson's record still reads as completed", () => {
  const s = storage();
  const { learning, recovered } = loadLearning(s);
  assert.equal(recovered, false);
  assert.deepEqual(learning, before[LEARNING_KEY]);
  assert.equal(lessonStatus(learning, findLesson("ip-addressing")!).state, "completed");
  assert.equal(lessonStatus(learning, findLesson("local-delivery-routing")!).state, "completed");
  assert.equal(lessonStatus(learning, findLesson("ipv4-subnets")!).state, "visited");
  assert.deepEqual(loadProgress(s).progress, before[PROGRESS_KEY]);
});

test("every saved place still opens: the replaced lesson, Lesson 1 and Lesson 2", () => {
  const { learning } = loadLearning(storage());
  for (const id of ["ip-addressing", "ipv4-subnets", "local-delivery-routing"]) {
    const lesson = findLesson(id)!,
      saved = learning.lessons[id];
    const nav = restoreNav(lesson, { lessonId: id, lessonVersion: saved.lessonVersion, ...saved.position! }, (p, t) => resolveTrack(lesson, p, t), (raw) => safeParams(lesson, raw));
    assert.ok(nav, id);
    assert.equal(nav!.stepId, saved.position!.stepId, id);
  }
});

test("visiting and stepping through the new lessons never rewrites another lesson's record, nor a completion", () => {
  const s = storage();
  let learning = loadLearning(s).learning;
  for (const id of ["ipv4-subnets", "local-delivery-routing", "ip-addressing"]) {
    const lesson = findLesson(id)!;
    learning = recordLessonVisit(learning, lesson, "2026-11-20T08:00:00.000Z");
    const track = resolveTrack(lesson, {}, "journey");
    for (const step of track.steps) learning = recordStep(learning, lesson, { lessonId: id, lessonVersion: lesson.version, params: {}, track: "journey", stepId: step.id, journeyStepId: step.id, level: null, replay: false } as never, track, "2026-11-20T08:05:00.000Z");
  }
  saveLearning(s, learning);
  const after = JSON.parse(s.data.get(LEARNING_KEY)!).lessons;
  // Completions keep their original dates; nothing is moved between lessons.
  assert.equal(after["ip-addressing"].completedAt, "2026-11-01T10:00:00.000Z");
  assert.equal(after["local-delivery-routing"].completedAt, "2026-11-14T16:00:00.000Z");
  assert.equal(after["ipv4-subnets"].completedAt, "2026-11-20T08:05:00.000Z", "Lesson 1 completes when actually finished");
  assert.deepEqual(Object.keys(after).sort(), ["ip-addressing", "ipv4-subnets", "local-delivery-routing"]);
  // The other stores are untouched by lesson activity.
  for (const key of [PROGRESS_KEY, MISSIONS_KEY, CHALLENGES_KEY]) assert.equal(s.data.get(key), JSON.stringify(before[key as keyof typeof before]), key);
});

test("the path reads the same records: mastery and challenge completions kept, the replaced lesson off the path", () => {
  const s = storage();
  const keys = [...s.data.keys()].sort();
  const evidence: Evidence = loadEvidence(s);
  // Reading progress never writes: no store is rewritten and the new visit store is not created by a read.
  assert.deepEqual([...s.data.keys()].sort(), keys);
  for (const [key, value] of Object.entries(before)) assert.equal(s.data.get(key), JSON.stringify(value), key);
  assert.deepEqual(evidence.visits, { version: 1, activities: {} }, "learners from before the visit store start with no visits");
  const state = (id: string) => activityState(findActivity(id)!, evidence);
  // Lesson 1 was opened and only its first step seen: opened, not in progress. It is still the one to continue.
  assert.equal(state("ipv4-subnets"), "visited");
  assert.equal(state("local-delivery-routing"), "completed");
  assert.equal(state("ipv4-local-or-remote"), "mastered");
  assert.equal(state("tcp-lost-segment"), "mastered");
  assert.equal(state("neighbours"), "mastered");
  assert.equal(state("no-connection"), "completed", "legacy challenge 'cable'");
  assert.equal(state("bring-reply-home"), "completed", "legacy challenge 'nat'");
  assert.equal(state("gateway-or-direct"), "not-started");
  assert.equal(practiceState(evidence.progress, "ipv4-local-or-remote", "1.0.0"), "mastered");
  assert.equal(findActivity("ip-addressing"), undefined);
  const r = recommend(evidence);
  assert.equal(r.kind, "continue");
  assert.equal(r.activity.id, "ipv4-subnets");
});

test("the replaced lesson stays in the catalog and names lessons that exist; Home's journeys lead Lesson 1 → 2 → Packet Journey", () => {
  assert.ok(lessons.some((l) => l.id === "ip-addressing"), "its URL, records and tutor requests keep working");
  for (const [old, ids] of Object.entries(replacedLessons)) {
    assert.ok(findLesson(old), old);
    for (const id of ids) assert.ok(findLesson(id), id);
    assert.ok(!journeys.some((j) => j.id === old), `${old} is no longer listed`);
  }
  assert.deepEqual(journeys.map((j) => j.id).slice(0, 3), ["ipv4-subnets", "local-delivery-routing", "hello-tcp"]);
  assert.equal(findLesson("ipv4-subnets")!.nextLessonId, "local-delivery-routing");
  assert.equal(findLesson("local-delivery-routing")!.nextLessonId, "hello-tcp");
  // Lesson versions are unchanged, so no record of them is set aside.
  assert.equal(findLesson("ipv4-subnets")!.version, "1.0.0");
  assert.equal(findLesson("local-delivery-routing")!.version, "1.0.0");
  assert.equal(findLesson("ip-addressing")!.version, "1.1.0");
});
