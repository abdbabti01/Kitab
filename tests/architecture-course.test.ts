import test from "node:test";
import assert from "node:assert/strict";
import { architectureLessons } from "../src/architecture/lessons.ts";
import { challenges } from "../src/architecture/challenges.ts";
import { challengeCatalog, lessonCatalog } from "../src/architecture/catalog.ts";
import { configSchemas, workloadSchema, COMPONENT_KINDS } from "../src/architecture/model.ts";
import { fieldsFor, workloadFields } from "../src/architecture/fields.ts";
import { simulate } from "../src/architecture/simulate.ts";
import { summarize } from "../src/architecture/metrics.ts";
import { validateDesign } from "../src/architecture/validate.ts";
import { parseRoute } from "../src/app/routes.ts";
import { findTrack, kindOf, locate, trackProgress } from "../src/learning/tracks.ts";
import { activityState, loadEvidence, type Evidence } from "../src/learning/networking-path.ts";
import { recordChallengeCheck, recordExperiment } from "../src/architecture/progress.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

test("the light catalog matches the lessons and challenges it stands for", () => {
  assert.deepEqual(lessonCatalog.map((l) => [l.id, l.title]), architectureLessons.map((l) => [l.id, l.title]));
  assert.deepEqual(challengeCatalog.map((c) => [c.id, c.title, c.version]), challenges.map((c) => [c.id, c.title, c.version]));
  for (const lesson of architectureLessons) assert.ok(challenges.some((c) => c.id === lesson.challenge), lesson.id);
});

test("routes: the track, its lessons, the playground and challenges", () => {
  assert.deepEqual(parseRoute("/learn/system-design"), { name: "learn", section: "system-design" });
  assert.deepEqual(parseRoute("/learn/system-design/fundamentals/"), { name: "architecture-lesson", id: "fundamentals" });
  assert.deepEqual(parseRoute("/practice/architecture"), { name: "architecture-playground" });
  assert.deepEqual(parseRoute("/practice/architecture/challenges/url-shortener"), { name: "architecture-challenge", id: "url-shortener" });
  for (const bad of ["/practice/architecture/challenges/%E0%A4%A", "/practice/architecture/x", "/learn/system-design/a/b"]) assert.equal(parseRoute(bad).name, "not-found", bad);
  // The Network Playground keeps its address.
  assert.deepEqual(parseRoute("/practice/network"), { name: "network-practice" });
});

test("the System Design track: six units, each a lesson then a design challenge", () => {
  const track = findTrack("system-design")!;
  assert.equal(track.stages.length, 6);
  for (const stage of track.stages) {
    assert.equal(stage.learn.length, 1);
    assert.equal(kindOf(stage.learn[0]), "Lesson");
    assert.equal(stage.practise.length, 1);
    assert.equal(kindOf(stage.practise[0]), "Design");
    assert.equal(locate(stage.practise[0].id)!.track.id, "system-design");
  }
});

test("lesson state follows its experiment; challenge state follows checks; nothing else is touched", () => {
  const storage = memory();
  const track = findTrack("system-design")!;
  const lesson = track.stages[0].learn[0];
  const challenge = track.stages[0].practise[0];
  const before: Evidence = loadEvidence(storage);
  assert.equal(activityState(lesson, before), "not-started");
  assert.equal(activityState(challenge, before), "not-started");
  recordExperiment(storage, "fundamentals");
  recordChallengeCheck(storage, "simple-web-app", "1", { passed: false, cost: 2, p95: 100 });
  let evidence = loadEvidence(storage);
  assert.equal(activityState(lesson, evidence), "completed");
  assert.equal(activityState(challenge, evidence), "in-progress");
  recordChallengeCheck(storage, "simple-web-app", "1", { passed: true, cost: 6, p95: 117 });
  evidence = loadEvidence(storage);
  assert.equal(activityState(challenge, evidence), "completed");
  assert.deepEqual(trackProgress(track, evidence), { total: 12, completed: 2, mastered: 0, started: true, percent: 17 });
  assert.deepEqual([...storage.data.keys()], ["kitab.architecture.progress.v1"]);
  assert.equal(trackProgress(findTrack("networking")!, evidence).completed, 0);
});

test("settings shown in the inspector have the schema's bounds and defaults", () => {
  for (const kind of COMPONENT_KINDS) {
    const schema = configSchemas[kind];
    const defaults = schema.parse({}) as Record<string, unknown>;
    assert.deepEqual(fieldsFor[kind].map((f) => f.field).sort(), Object.keys(defaults).sort(), kind);
    for (const field of fieldsFor[kind]) {
      if (field.type !== "number") continue;
      assert.ok(schema.safeParse({ [field.field]: field.min }).success && schema.safeParse({ [field.field]: field.max }).success, `${kind}.${field.field}`);
      assert.ok(!schema.safeParse({ [field.field]: field.max + 1 }).success && !schema.safeParse({ [field.field]: field.min - 1 }).success, `${kind}.${field.field}`);
    }
  }
  assert.deepEqual(workloadFields.map((f) => f.field).sort(), Object.keys(workloadSchema.parse({})).sort());
});

test("every experiment variant is valid and runs at every rate it offers", () => {
  for (const lesson of architectureLessons) {
    for (const variant of lesson.experiment.variants) {
      for (const rate of lesson.experiment.rates) {
        const design = variant.design();
        for (const node of design.nodes) if (node.kind === "client") (node.config as { rps: number }).rps = rate;
        assert.ok(validateDesign(design).ok, `${lesson.id}/${variant.id}`);
        assert.ok(simulate(design).events.length > 0);
      }
    }
  }
});

const run = (lessonId: string, variantId: string, rate: number) => {
  const design = architectureLessons.find((l) => l.id === lessonId)!.experiment.variants.find((v) => v.id === variantId)!.design();
  (design.nodes[0].config as { rps: number }).rps = rate;
  return summarize(simulate(design));
};

test("what the lessons say is what their experiments show", () => {
  // Fundamentals: a read takes 40 + 20 + 1 + 5 + 1 + 40 = 107 ms; past capacity the queue fills and refuses.
  assert.equal(run("fundamentals", "base", 20).p50, 107);
  assert.ok(run("fundamentals", "base", 140).p95! > run("fundamentals", "base", 100).p95!);
  assert.ok((run("fundamentals", "base", 250).failures["queue-full"] ?? 0) > 0);
  // Caching: 50 popular items hit about as often as 500 uniform ones.
  const small = run("storage-caching", "small", 300).nodes["cache-1"].hitRate!;
  const uniform = run("storage-caching", "uniform", 300).nodes["cache-1"].hitRate!;
  assert.ok(Math.abs(small - uniform) < 0.1, `${small} vs ${uniform}`);
  assert.ok(run("storage-caching", "large", 300).nodes["sql-1"].utilisation![0] < run("storage-caching", "none", 300).nodes["sql-1"].utilisation![0]);
  // Scalability: three servers carry 500/s that one cannot.
  assert.ok(run("scalability", "apis-1", 500).successRate < 0.6);
  assert.equal(run("scalability", "apis-3", 500).successRate, 1);
  // Distributed: the client's latency doesn't depend on the workers.
  assert.equal(run("distributed", "workers-1", 200).p95, run("distributed", "workers-6", 200).p95);
  // Reliability: spare capacity with health checks loses least during the failure.
  assert.ok(run("reliability-security", "spare", 300).successRate > run("reliability-security", "checks", 300).successRate);
  // Projects: the simplest design can't take 1,000/s; both bigger designs can.
  assert.ok(run("design-projects", "simple", 1000).successRate < 0.9);
  assert.equal(run("design-projects", "cache", 1000).successRate, 1);
  assert.equal(run("design-projects", "nosql", 1000).successRate, 1);
});
