import test from "node:test";
import assert from "node:assert/strict";
import { fieldsFor, workloadFields } from "../src/architecture/fields.ts";
import { COMPONENT_KINDS } from "../src/architecture/model.ts";
import { realComponents, realSettings, realWorkload } from "../src/architecture/real-world.ts";
import { realDevices } from "../src/practice/network/real-world.ts";
import { glossary, type GlossaryTerm } from "../src/learning/glossary.ts";
import { identityUnits } from "../src/identity/content/index.ts";
import { conceptUnits } from "../src/architecture/concepts/index.ts";
import { HTTP_WALKTHROUGH_PATH, parseRoute } from "../src/app/routes.ts";
import { masteryGaps, successCriteria } from "../src/practice/network/mission-progress.ts";
import { missions } from "../src/practice/network/missions.ts";
import { challengeDesign, findChallenge } from "../src/architecture/challenges.ts";
import { limitSettings } from "../src/architecture/explain.ts";

// The explanations are tied to what the simulators and assessments actually have: a setting can't lack an
// explanation, an explanation can't outlive its setting, links lead somewhere real, and success criteria are read
// from the assessment rules, never restated.

test("every Playground setting has a real-world explanation, and every explanation has a setting", () => {
  for (const kind of COMPONENT_KINDS) {
    assert.deepEqual(Object.keys(realSettings[kind]).sort(), fieldsFor[kind].map((f) => f.field).sort(), kind);
    assert.ok(realComponents[kind].software && realComponents[kind].runsOn && realComponents[kind].talks, kind);
  }
  assert.deepEqual(Object.keys(realWorkload).sort(), workloadFields.map((f) => f.field).sort());
});

test("offered load and measured times are never presented as server settings", () => {
  for (const field of ["rps", "writePercent", "assetPercent"]) assert.equal(realSettings.client[field].kind, "workload", field);
  // Times per operation are properties of code and hardware; timeouts, back-off and intervals are settings.
  for (const kind of COMPONENT_KINDS) {
    for (const field of fieldsFor[kind]) {
      if (field.type !== "number" || field.unit !== "ms") continue;
      const configured = ["timeoutMs", "backoffMs", "retryDelayMs", "checkIntervalMs"].includes(field.field);
      assert.equal(realSettings[kind][field.field].kind, configured ? "setting" : "property", `${kind}.${field.field}`);
    }
  }
  assert.equal(realWorkload.seed.kind, "simulation");
});

test("every snippet is labelled as representative of one technology", () => {
  const examples = [...COMPONENT_KINDS.flatMap((k) => Object.values(realSettings[k])), ...Object.values(realWorkload), ...Object.values(realDevices)].flatMap((s) => (s.example ? [s.example] : []));
  assert.ok(examples.length >= 10);
  for (const e of examples) assert.match(e.label, /^Representative: /, e.label);
});

test("every network device kind says where its settings live and who sets them", () => {
  for (const kind of ["pc", "phone", "switch", "router", "ap", "server"] as const) {
    assert.ok(realDevices[kind].where.length > 0 && realDevices[kind].who, kind);
  }
});

test("every glossary term explains itself and links to a page or concept that exists", () => {
  const concepts = new Set(conceptUnits.flatMap((u) => u.concepts.map((c) => `${u.id}#${c.id}`)));
  const identityConcepts = new Set(identityUnits.flatMap((u) => u.concepts.map((c) => `${u.id}#${c.id}`)));
  for (const term of Object.values(glossary) as GlossaryTerm[]) {
    assert.ok(term.definition && term.purpose && term.example, term.id);
    if (!term.more) continue;
    const [path, hash] = term.more.href.split("#");
    const route = parseRoute(path);
    if (route.name === "architecture-lesson") assert.ok(concepts.has(`${route.id}#${hash}`), term.more.href);
    else if (route.name === "identity-unit") assert.ok(identityConcepts.has(`${route.id}#${hash}`), term.more.href);
    else if (route.name === "lesson") assert.equal(path, HTTP_WALKTHROUGH_PATH, `${term.more.href} is not a lesson`);
    else assert.equal(route.name, "learn", term.more.href);
  }
});

test("a network mission's success criteria are its assessment rules, in the same words", () => {
  for (const mission of missions) {
    const { complete, master } = successCriteria(mission);
    const fresh = { variant: mission.variants[0].id, startedAt: "", completedAt: null, diagnosis: null, evidence: false, explanation: null, prediction: null, hints: 3 } as const;
    assert.deepEqual([complete, ...master], masteryGaps(fresh, mission), mission.id);
    // An attempt meeting every listed criterion has no gap left: nothing is required that isn't listed.
    const perfect = { ...fresh, completedAt: "t", diagnosis: "first-try" as const, evidence: true, explanation: true, hints: 0 };
    assert.deepEqual(masteryGaps(perfect, mission), [], mission.id);
  }
});

test("a bottleneck names the settings behind its limit with the values the run used", () => {
  const challenge = findChallenge("scale-behind-lb")!;
  const run = challengeDesign(challenge, challenge.starter());
  const api = run.nodes.find((n) => n.kind === "api")!;
  assert.equal(limitSettings(api), "Requests at once 8, Own work per request 25 ms");
  assert.equal(limitSettings(run.nodes.find((n) => n.kind === "client")!), "");
});
