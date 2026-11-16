import test from "node:test";
import assert from "node:assert/strict";
import { labs, findLab } from "../src/architecture/labs/index.ts";
import { MAX_LAB_EVENTS, evaluateLab, parseConfig, predictionAnswer, predictionOptions, runLab, validValue, type LabConfig } from "../src/architecture/labs/kernel.ts";
import { conceptUnits } from "../src/architecture/concepts/index.ts";
import { labCatalog, unitCatalog } from "../src/architecture/catalog.ts";
import { findTrack } from "../src/learning/tracks.ts";
import { parseRoute } from "../src/app/routes.ts";
import { LABS_KEY, currentAttempt, labRecordFor, labState, loadLabProgress, recordAnswer, recordConceptCheck, recordLabCheck, recordPrediction, saveLabConfig, startAttempt } from "../src/architecture/labs/progress.ts";
import { activityState, loadEvidence, recommend } from "../src/learning/networking-path.ts";
import { labExpectations } from "./support/lab-designs.ts";

const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};
const failing = (lab: (typeof labs)[number], config: LabConfig) => evaluateLab(lab, { ...lab.starter, ...config }).checks.filter((c) => !c.passed).map((c) => c.id).sort();

test("catalogs, track and routes list every lab and concept unit", () => {
  assert.deepEqual(labCatalog.map((l) => [l.id, l.title, l.version]), labs.map((l) => [l.id, l.title, l.version]));
  assert.deepEqual(unitCatalog.map((u) => [u.id, u.title]), conceptUnits.map((u) => [u.id, u.title]));
  const track = findTrack("system-design")!;
  const ids = track.stages.flatMap((s) => [...s.learn, ...s.practise].map((a) => a.id));
  for (const lab of labs) {
    assert.ok(ids.includes(`lab:${lab.id}`), lab.id);
    assert.ok(conceptUnits.some((u) => u.id === lab.unit) || ids.includes(`sd:${lab.unit}`), `${lab.id} → ${lab.unit}`);
    assert.deepEqual(parseRoute(`/practice/architecture/labs/${lab.id}`), { name: "architecture-lab", id: lab.id });
  }
  for (const unit of conceptUnits) {
    assert.ok(ids.includes(`sd:${unit.id}`), unit.id);
    for (const id of unit.labs) assert.ok(findLab(id), `${unit.id} → ${id}`);
    for (const c of unit.concepts) if (c.lab) assert.ok(findLab(c.lab), `${unit.id}/${c.id} → ${c.lab}`);
  }
  assert.deepEqual(parseRoute("/practice/architecture/labs"), { name: "architecture-labs" });
  assert.equal(parseRoute("/practice/architecture/labs/a/b").name, "not-found");
});

for (const lab of labs) {
  test(`${lab.id}: controls, starter and saved configurations`, () => {
    for (const control of lab.controls) assert.ok(validValue(control, lab.starter[control.id]), `${control.id} starter`);
    assert.deepEqual(Object.keys(lab.starter).sort(), lab.controls.map((c) => c.id).sort());
    assert.deepEqual(parseConfig(lab, lab.starter), lab.starter);
    assert.equal(parseConfig(lab, { unknown: 1 }), null);
    for (const control of lab.controls) {
      if (control.type === "number") assert.equal(parseConfig(lab, { [control.id]: control.max + control.step }), null, control.id);
      if (control.type === "select") assert.equal(parseConfig(lab, { [control.id]: "nope" }), null, control.id);
    }
    assert.equal(parseConfig(lab, "x"), null);
  });

  test(`${lab.id}: runs are deterministic, ordered, bounded, and every number is a fold of the events`, () => {
    const configs = [lab.starter, ...labExpectations[lab.id].pass.map((c) => ({ ...lab.starter, ...c })), ...labExpectations[lab.id].fail.map((f) => ({ ...lab.starter, ...f.config }))];
    for (const config of configs) {
      for (const scenario of lab.scenarios) {
        const a = runLab(lab, config, scenario);
        const b = runLab(lab, config, scenario);
        assert.deepEqual(a, b, `${scenario.id} replays identically`);
        assert.ok(a.events.length > 0 && a.events.length < MAX_LAB_EVENTS, `${scenario.id}: ${a.events.length} events`);
        a.events.forEach((e, i) => {
          assert.equal(e.i, i);
          if (i) assert.ok(e.t >= a.events[i - 1].t, `${scenario.id}: time goes forward at ${i}`);
          if (lab.view.kind === "sequence") {
            assert.ok(lab.view.lanes.some((l) => l.id === e.actor), `${scenario.id}: lane ${e.actor}`);
            if (e.kind === "message") assert.ok(lab.view.lanes.some((l) => l.id === e.to), `${scenario.id}: lane ${e.to}`);
          }
        });
        assert.deepEqual(lab.facts(a.events), a.facts);
        // Every prefix folds (playback reads the fold up to the cursor).
        for (const cut of [0, 1, Math.floor(a.events.length / 2)]) assert.equal(typeof lab.facts(a.events.slice(0, cut)), "object");
        for (const shown of lab.shown) assert.equal(typeof a.facts[shown.key], "number", shown.key);
        assert.ok(lab.explain(a.facts, config).length > 20);
      }
    }
  });

  test(`${lab.id}: the starter fails; several different designs pass; plausible wrong designs fail for the right reason`, () => {
    assert.equal(evaluateLab(lab, lab.starter).passed, false);
    const expectation = labExpectations[lab.id];
    assert.ok(expectation.pass.length >= 2, "at least two passing designs");
    assert.equal(new Set(expectation.pass.map((c) => JSON.stringify(c))).size, expectation.pass.length);
    for (const config of expectation.pass) assert.deepEqual(failing(lab, config), [], JSON.stringify(config));
    assert.ok(expectation.fail.length >= 3, "at least three wrong designs");
    for (const wrong of expectation.fail) assert.deepEqual(failing(lab, wrong.config), [...wrong.failing].sort(), `${wrong.why}: ${JSON.stringify(wrong.config)}`);
    for (const check of lab.checks) assert.ok(lab.scenarios.some((s) => s.id === check.scenario), check.id);
    assert.equal(new Set(lab.checks.map((c) => c.id)).size, lab.checks.length);
  });

  test(`${lab.id}: predictions come from the engine; questions have one right answer`, () => {
    assert.ok(lab.prediction.variants.length >= 2);
    const answers = lab.prediction.variants.map((v) => predictionAnswer(lab, v));
    for (const [i, answer] of answers.entries()) {
      assert.ok(Number.isInteger(answer) && answer >= 0, `${lab.prediction.variants[i].id}: ${answer}`);
      const options = predictionOptions(answer);
      assert.equal(options.length, 4);
      assert.equal(options.filter((o) => o === answer).length, 1);
      assert.deepEqual(options, [...options].sort((a, b) => a - b));
      assert.equal(new Set(options).size, 4);
    }
    assert.ok(lab.questions.length >= 2);
    for (const q of lab.questions) {
      assert.equal(q.options.filter((o) => o.correct).length, 1, q.id);
      for (const o of q.options) assert.ok(o.why.length > 10, `${q.id}: ${o.text}`);
    }
    // The right answer isn't always in the same position.
    assert.ok(new Set(lab.questions.map((q) => q.options.findIndex((o) => o.correct))).size > 1, "correct position varies");
  });
}

test("concept units: every concept is complete and its check has exactly one right answer", () => {
  const ids = new Set<string>();
  for (const unit of conceptUnits) {
    assert.ok(unit.concepts.length >= 3, unit.id);
    for (const c of unit.concepts) {
      assert.ok(!ids.has(c.id), `concept id ${c.id} is unique`);
      ids.add(c.id);
      for (const field of ["plain", "why", "example", "failure", "solution"] as const) assert.ok(c[field].length > 30, `${c.id}.${field}`);
      assert.ok(c.mechanism.length >= 1 && c.tradeoffs.length >= 1 && c.avoid.length >= 1, c.id);
      assert.equal(c.check.options.filter((o) => o.correct).length, 1, c.id);
      assert.ok(c.check.options.length >= 3, c.id);
    }
    assert.ok(new Set(unit.concepts.map((c) => c.check.options.findIndex((o) => o.correct))).size > 1, `${unit.id}: the right answer moves`);
  }
});

test("lab progress: mastery needs a right prediction, a passing check and a right explanation in one attempt", () => {
  const lab = labs[0];
  const s = memory();
  const at = "2026-11-15T10:00:00.000Z";
  assert.equal(labState(undefined), "not-started");
  startAttempt(s, lab.id, lab.version, "v1", "q1", at);
  let record = labRecordFor(loadLabProgress(s), lab.id, lab.version)!;
  assert.equal(labState(record), "not-started", "opening an attempt isn't progress");
  // An answer before passing is ignored.
  recordAnswer(s, lab.id, lab.version, 1, true, at);
  assert.equal(currentAttempt(labRecordFor(loadLabProgress(s), lab.id, lab.version))!.answered, undefined);
  recordPrediction(s, lab.id, lab.version, 3, false, at);
  recordPrediction(s, lab.id, lab.version, 2, true, at);
  record = labRecordFor(loadLabProgress(s), lab.id, lab.version)!;
  assert.deepEqual(currentAttempt(record)!.predicted, { value: 3, correct: false }, "only the first prediction counts");
  assert.equal(labState(record), "in-progress");
  recordLabCheck(s, lab.id, lab.version, false, at);
  assert.equal(labState(labRecordFor(loadLabProgress(s), lab.id, lab.version)), "in-progress");
  recordLabCheck(s, lab.id, lab.version, true, at);
  recordAnswer(s, lab.id, lab.version, 1, true, at);
  record = labRecordFor(loadLabProgress(s), lab.id, lab.version)!;
  assert.equal(labState(record), "completed", "a wrong prediction means no mastery in this attempt");
  // A new attempt: right prediction, pass, wrong first answer → still completed; then a third attempt masters.
  saveLabConfig(s, lab.id, lab.version, { retries: 1 }, at);
  startAttempt(s, lab.id, lab.version, "v2", "q2", at);
  assert.equal(labRecordFor(loadLabProgress(s), lab.id, lab.version)!.config, undefined, "a new attempt starts from today's system");
  recordPrediction(s, lab.id, lab.version, 2, true, at);
  recordLabCheck(s, lab.id, lab.version, true, at);
  recordAnswer(s, lab.id, lab.version, 0, false, at);
  recordAnswer(s, lab.id, lab.version, 1, true, at);
  assert.equal(labState(labRecordFor(loadLabProgress(s), lab.id, lab.version)), "completed", "only the first answer counts");
  startAttempt(s, lab.id, lab.version, "v3", "q3", at);
  recordPrediction(s, lab.id, lab.version, 2, true, at);
  recordLabCheck(s, lab.id, lab.version, true, at);
  recordAnswer(s, lab.id, lab.version, 1, true, at);
  record = labRecordFor(loadLabProgress(s), lab.id, lab.version)!;
  assert.equal(labState(record), "mastered");
  assert.equal(record.attempts.length, 3);
  // The track reads it; nothing else is written.
  const activity = findTrack("system-design")!.stages.flatMap((st) => st.practise).find((a) => a.id === `lab:${lab.id}`)!;
  assert.equal(activityState(activity, loadEvidence(s)), "mastered");
  assert.deepEqual([...s.data.keys()], [LABS_KEY]);
  // A new lab version starts fresh.
  assert.equal(labRecordFor(loadLabProgress(s), lab.id, "999"), undefined);
});

test("lab progress: damaged data is kept aside, never thrown", () => {
  const s = memory();
  s.setItem(LABS_KEY, "{not json");
  assert.deepEqual(loadLabProgress(s), { version: 1, labs: {}, units: {} });
  assert.equal(s.getItem(`${LABS_KEY}.corrupt`), "{not json");
  s.setItem(LABS_KEY, JSON.stringify({ version: 2, labs: {}, units: {} }));
  assert.deepEqual(loadLabProgress(s), { version: 1, labs: {}, units: {} });
});

test("concept units complete when every check is answered right, and only then", () => {
  const unit = conceptUnits[0];
  const s = memory();
  const ids = unit.concepts.map((c) => c.id);
  const activity = findTrack("system-design")!.stages.flatMap((st) => st.learn).find((a) => a.id === `sd:${unit.id}`)!;
  assert.equal(activityState(activity, loadEvidence(s)), "not-started");
  recordConceptCheck(s, unit.id, ids[0], false, ids);
  assert.equal(activityState(activity, loadEvidence(s)), "in-progress");
  for (const id of ids.slice(0, -1)) recordConceptCheck(s, unit.id, id, true, ids);
  assert.equal(activityState(activity, loadEvidence(s)), "in-progress");
  recordConceptCheck(s, unit.id, ids.at(-1)!, true, ids);
  assert.equal(activityState(activity, loadEvidence(s)), "completed");
  // A later wrong answer doesn't undo completion.
  recordConceptCheck(s, unit.id, ids[0], false, ids);
  assert.equal(activityState(activity, loadEvidence(s)), "completed");
});

test("System Design recommends mastery only for what can be mastered", () => {
  const track = findTrack("system-design")!;
  const s = memory();
  const now = "2026-11-15T10:00:00.000Z";
  // Complete every lesson, challenge and lab without mastering anything.
  const evidence = loadEvidence(s);
  for (const stage of track.stages) {
    for (const a of stage.learn) evidence.architecture.lessons[a.id.slice(3)] = { experimentAt: now };
    for (const a of stage.practise) {
      if (a.track === "architecture-challenge") evidence.architecture.challenges[a.id.slice(10)] = { version: a.version!, attempts: 1, lastAt: now, passedAt: now };
      if (a.track === "architecture-lab") evidence.labs.labs[a.id.slice(4)] = { version: a.version!, lastAt: now, attempts: [{ variant: "x", question: "y", startedAt: now, predicted: { value: 1, correct: true }, passedAt: now }], passedAt: now };
    }
  }
  const r = recommend(evidence, track.stages);
  assert.equal(r.kind, "mastery");
  assert.equal(r.activity.track, "architecture-lab");
});
