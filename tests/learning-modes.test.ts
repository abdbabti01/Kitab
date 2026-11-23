// Learn, Playground, Practice and Lab: what each concept page shows, that it agrees with the engine the Playground
// runs, and that every hand-off between modes opens the intended place.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "../src/learning/engines/eager.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { chapters } from "../src/content/chapters.ts";
import { conceptLearn, exploreFor, recursionDemo, recursionSteps } from "../src/learning/concept-learn.ts";
import { buildRecursionTimeline } from "../src/visual-engine/engines/execution/recursion-engine.ts";
import { engineParams, experimentForUnit, parseSetup, structureChoices, unitForStructure } from "../src/structures/experiments.ts";
import { dataStructuresPath, locate, tracks } from "../src/learning/tracks.ts";
import { architectureLessons, lessonDesign, lessonPlaygroundPath } from "../src/architecture/lessons.ts";
import { cycleForLesson } from "../src/architecture/cycles.ts";
import { validateDesign } from "../src/architecture/validate.ts";
import { unitLabs } from "../src/lab/links.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every concept's Learn content belongs to a real chapter, and every check has one right answer with feedback for each option", () => {
  for (const [slug, learn] of Object.entries(conceptLearn)) {
    assert.ok(chapters.some((c) => c.slug === slug), slug);
    if (learn.check) {
      assert.equal(learn.check.options.filter((o) => o.correct).length, 1, `${slug}: exactly one right answer`);
      assert.equal(new Set(learn.check.options.map((o) => o.id)).size, learn.check.options.length, `${slug}: option ids`);
      for (const option of learn.check.options) assert.ok(option.feedback.length > 20, `${slug}.${option.id}: feedback`);
    }
    if (learn.demoAfter !== undefined) assert.ok(learn.sections && learn.demoAfter <= learn.sections.length, slug);
  }
  // Every data-structures lesson in the track teaches with a demonstration or illustration, a misconception and a check.
  for (const slug of ["arrays", "linked-lists", "hash-tables", "trees", "recursion", "data-structures", "dns"]) {
    assert.ok(conceptLearn[slug].misconception && conceptLearn[slug].check, slug);
  }
});

test("a lesson's demonstration is computed by the Playground's engine, and its Explore link opens exactly that setup", () => {
  for (const [slug, learn] of Object.entries(conceptLearn)) {
    if (!learn.demo) continue;
    const { engine, params } = engineParams(learn.demo);
    const trace = buildTrace(engine, params);
    assert.ok(trace.frames.length >= 3, `${slug}: a walkthrough of several steps`);
    const explore = exploreFor(slug)!;
    const url = new URL(explore.path, "https://kitab.test");
    assert.equal(url.pathname, "/practice/structures", slug);
    assert.deepEqual(parseSetup(url.search), learn.demo, `${slug}: the Playground opens on the lesson's setup`);
    assert.equal(url.searchParams.get("from"), `/concepts/${slug}`, `${slug}: with a way back to the lesson`);
    // The same trace, so the lesson and the Playground can't disagree.
    const opened = engineParams(parseSetup(url.search));
    assert.equal(buildTrace(opened.engine, opened.params).scenarioKey, trace.scenarioKey);
  }
  // The data-structures units use the same setup the end-of-page link has always used.
  for (const slug of ["arrays", "linked-lists", "hash-tables", "trees"]) {
    const unit = locate(`concept:${slug}`)!.stage.id;
    assert.deepEqual(conceptLearn[slug].demo, experimentForUnit(unit)!.setup, slug);
  }
});

test("the recursion lesson follows factorial(3) call by call and return by return, as the engine computes it", () => {
  const steps = recursionSteps(recursionDemo as Parameters<typeof recursionSteps>[0]);
  assert.deepEqual(steps.map((s) => [s.depth, s.line]), [
    [0, "factorial(3) is called"],
    [1, "factorial(2) is called"],
    [2, "factorial(1) is called"],
    [2, "factorial(1) returns 1 (base case)"],
    [1, "factorial(2) computes 2 × 1 = 2"],
    [0, "factorial(3) computes 3 × 2 = 6"],
    [0, "factorial(3) returns 6 to main()"],
  ]);
  const timeline = buildRecursionTimeline(recursionDemo as Parameters<typeof buildRecursionTimeline>[0]);
  assert.equal(timeline.outcome.result, 6);
  // Frames: the engine's stack (top first) plus main(); the deepest point holds three calls.
  assert.deepEqual(steps[2].frames.map((f) => f.label), ["factorial(1)", "factorial(2)", "factorial(3)", "main()"]);
  assert.deepEqual(steps[2].frames.map((f) => f.current), [true, false, false, false]);
  assert.match(steps[1].frames[1].detail, /n = 3 · waiting/);
  assert.deepEqual(steps.at(-1)!.frames.map((f) => [f.label, f.detail]), [["main()", "received 6"]]);
  // Without a base case the same view ends in the engine's overflow.
  const broken = recursionSteps({ fn: "factorial", n: 3, baseCase: false, stackLimit: 5 });
  assert.equal(broken.at(-1)!.line, "Stack overflow");
  assert.equal(broken.filter((s) => s.line.endsWith("is called")).length, 5);
  // The lesson's code uses the engine's base case, and the Playground opens on factorial(3).
  assert.match(conceptLearn.recursion.sections![0].code!, /if n <= 1:/);
  assert.match(exploreFor("recursion")!.path, /structure=recursion&fn=factorial&n=3&base=1&limit=8&from=%2Fconcepts%2Frecursion$/);
});

test("Learn pages no longer mount the full simulator: data-structures concepts use the compact demonstration", () => {
  const page = read("src/app/ConceptPage.tsx");
  assert.match(page, /learn\.demo \?/);
  for (const component of ["RecursionDemo", "LessonDemo"]) assert.match(read(`src/ui/${component}.tsx`), /export function/);
  // The compact demonstrations have no playback, scrubber, memory table or parameter controls.
  for (const file of ["src/ui/LessonDemo.tsx", "src/ui/RecursionDemo.tsx"]) {
    const source = read(file);
    for (const heavy of ["PlaybackBar", "usePlayback", 'type="range"', "StructureGuide", "SetupPanel", "<select"]) assert.ok(!source.includes(heavy), `${file} uses ${heavy}`);
  }
  // A check and a demonstration record nothing: Learn pages only record the visit (App.tsx), as before.
  for (const file of ["src/ui/UnderstandingCheck.tsx", "src/ui/ExploreLink.tsx", "src/ui/LessonDemo.tsx", "src/ui/RecursionDemo.tsx", "src/learning/concept-learn.ts", "src/app/ConceptPage.tsx"]) {
    assert.ok(!/localStorage|safeStorage|record[A-Z]/.test(read(file)), `${file} writes progress`);
  }
});

test("a System Design lesson's designs open in the Playground built by the lesson's own code", () => {
  for (const lesson of architectureLessons) {
    for (const variant of lesson.experiment.variants) {
      for (const rate of lesson.experiment.rates) {
        const design = lessonDesign(lesson.id, variant.id, rate)!;
        assert.ok(design, `${lesson.id}/${variant.id}@${rate}`);
        assert.ok(design.nodes.filter((n) => n.kind === "client").every((n) => (n.config as { rps: number }).rps === rate));
        assert.ok(validateDesign(design).ok, `${lesson.id}/${variant.id} is a valid design`);
        const url = new URL(lessonPlaygroundPath(lesson.id, variant.id, rate), "https://kitab.test");
        assert.equal(url.pathname, "/practice/architecture");
        assert.deepEqual(lessonDesign(url.searchParams.get("lesson")!, url.searchParams.get("variant")!, Number(url.searchParams.get("rate"))), design);
      }
    }
  }
  // Anything else opens nothing from a lesson (the Playground falls back to its usual choice).
  assert.equal(lessonDesign("scalability", "apis-9", 150), null);
  assert.equal(lessonDesign("scalability", "apis-1", 151), null);
  assert.equal(lessonDesign("nope", "apis-1", 150), null);
  // Lessons with a guided experiment run it on the page and explore in the Playground; the one without keeps its free runs.
  const page = read("src/architecture/ui/ArchitectureLessonPage.tsx");
  assert.ok(!page.includes("Explore freely</button>"), "no second, free-run mode inside a guided lesson");
  assert.deepEqual(architectureLessons.filter((l) => !cycleForLesson(l.id)).map((l) => l.id), ["design-projects"]);
});

test("each mode leads to the next: Playground to Practice for every structure, Practice to an existing Lab", () => {
  for (const { id } of structureChoices) {
    const stage = dataStructuresPath.find((s) => s.id === unitForStructure[id]);
    assert.ok(stage && stage.practise.length > 0, `${id}: a unit with missions`);
  }
  // The Lab line appears after a practice step only for units that really have labs.
  for (const key of Object.keys(unitLabs)) {
    const [trackId, unit] = key.split("/");
    assert.ok(tracks.find((t) => t.id === trackId)?.stages.some((s) => s.id === unit), `${key} is a real unit`);
  }
  const path = read("src/app/NetworkingPath.tsx");
  assert.match(path, /at\.role === "practise"/);
});
