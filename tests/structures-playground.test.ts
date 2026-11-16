import assert from "node:assert/strict";
import test from "node:test";
import { parseRoute } from "../src/app/routes.ts";
import { playgrounds, PLAYGROUNDS_PATH } from "../src/app/playgrounds.ts";
import { dataStructuresPath } from "../src/learning/tracks.ts";
import { buildTrace } from "../src/learning/registry.ts";
import "../src/learning/engines/index.ts";
import { engineParams, experimentForUnit, experiments, inputsFor, parseSetup, safeReturn, setupPath, type StructureSetup } from "../src/structures/experiments.ts";

test("the Playground routes parse, and the three Playgrounds open existing tools", () => {
  assert.deepEqual(parseRoute(PLAYGROUNDS_PATH), { name: "playgrounds" });
  assert.deepEqual(parseRoute("/practice/structures"), { name: "structures-playground" });
  assert.deepEqual(parseRoute("/practice/network"), { name: "network-practice" });
  assert.deepEqual(playgrounds.map((p) => parseRoute(p.path).name), ["network-practice", "structures-playground", "architecture-playground"]);
});

test("every guided experiment survives the URL round trip and builds a real trace", () => {
  for (const experiment of experiments) {
    const path = setupPath(experiment.setup);
    assert.deepEqual(parseSetup(path.slice(path.indexOf("?"))), experiment.setup, experiment.id);
    const { engine, params } = engineParams(experiment.setup);
    assert.ok(buildTrace(engine, params).frames.length >= 2, experiment.id);
  }
});

test("every data-structures unit opens an experiment from its lessons", () => {
  for (const stage of dataStructuresPath) assert.ok(experimentForUnit(stage.id), `unit ${stage.id} has no experiment`);
});

test("malformed queries fall back to safe defaults", () => {
  assert.deepEqual(parseSetup("?structure=nope&op=fly&value=abc&index=-4"), { structure: "array", operation: "insert", value: 7, index: 0 });
  assert.deepEqual(parseSetup("?structure=recursion&n=99&limit=1&base=0"), { structure: "recursion", fn: "factorial", n: 6, baseCase: false, stackLimit: 4 });
  assert.deepEqual((parseSetup("?structure=array&values=") as StructureSetup).values, [], "an empty list is an empty array, not the fixture");
  assert.equal((parseSetup("?structure=graph&values=1,2") as StructureSetup).values, undefined);
});

test("the return link only accepts same-site paths", () => {
  assert.equal(safeReturn("/learn/data-structures#unit-arrays"), "/learn/data-structures#unit-arrays");
  for (const bad of ["//evil.example", "https://evil.example", "javascript:alert(1)", "learn", null]) assert.equal(safeReturn(bad), null, String(bad));
  assert.match(setupPath(experiments[0].setup, "/concepts/arrays"), /from=%2Fconcepts%2Farrays/);
  assert.doesNotMatch(setupPath(experiments[0].setup, "//evil.example"), /from=/);
});

test("controls appear only for the inputs an operation uses", () => {
  const io = (structure: StructureSetup["structure"], operation: StructureSetup["operation"]) => inputsFor({ structure, operation, value: 0, index: 0 });
  assert.deepEqual(io("array", "insert"), { index: true, value: true });
  assert.deepEqual(io("array", "delete"), { index: true, value: false });
  assert.deepEqual(io("linked-list", "delete"), { index: false, value: true });
  assert.deepEqual(io("stack", "pop"), { index: false, value: false });
  assert.deepEqual(io("queue", "enqueue"), { index: false, value: true });
});
