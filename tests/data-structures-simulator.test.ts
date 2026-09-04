import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildDataStructureSimulation,
  defaultConfig,
  structureInfo,
  structureKinds,
} from "../src/visual-engine/data-structures/model.ts";

test("every data-structure model produces a complete deterministic timeline", () => {
  for (const kind of structureKinds) {
    const simulation = buildDataStructureSimulation(defaultConfig(kind));
    assert.ok(simulation.frames.length >= 2, `${kind} needs more than an initial frame`);
    assert.equal(new Set(simulation.frames.map((frame) => frame.id)).size, simulation.frames.length);
    assert.ok(simulation.result.length > 0);
    simulation.frames.forEach((frame, index) => {
      assert.ok(frame.detail.length > 20);
      assert.ok(frame.state.length > 0);
      if (index === 0) return;
      const previous = simulation.frames[index - 1].metrics;
      assert.ok(frame.metrics.comparisons >= previous.comparisons);
      assert.ok(frame.metrics.reads >= previous.reads);
      assert.ok(frame.metrics.writes >= previous.writes);
      assert.ok(frame.metrics.pointerChanges >= previous.pointerChanges);
    });
  }
});

test("every exposed operation has a terminal state and valid snapshots", () => {
  for (const kind of structureKinds) {
    for (const operation of structureInfo[kind].operations) {
      const base = defaultConfig(kind);
      const simulation = buildDataStructureSimulation({ ...base, operation: operation.id });
      assert.ok(simulation.frames.length >= 2, `${kind}.${operation.id} ended before it explained the result`);
      assert.ok(simulation.frames.at(-1)!.state.length > 0);
      simulation.frames.forEach((frame) => {
        assert.equal(new Set(frame.snapshot.items.map((item) => item.id)).size, frame.snapshot.items.length);
      });
    }
  }
});

test("array insertion shifts values and writes the requested index", () => {
  const simulation = buildDataStructureSimulation({ kind: "array", operation: "insert", value: 7, index: 2 });
  assert.deepEqual(simulation.frames.at(-1)!.snapshot.items.map((item) => item.value), [8, 3, 7, 12, 1, 6]);
  assert.deepEqual(simulation.frames.at(-1)!.snapshot.items.slice(0, 3).map((item) => item.address), ["0x1000", "0x1004", "0x1008"]);
  assert.match(simulation.complexity, /O\(n\)/);
  assert.ok(simulation.frames.at(-1)!.metrics.writes >= 4);
});

test("linked-list deletion preserves reachability and changes one pointer", () => {
  const simulation = buildDataStructureSimulation({ kind: "linked-list", operation: "delete", value: 6, index: 0 });
  const final = simulation.frames.at(-1)!;
  assert.deepEqual(final.snapshot.items.map((item) => item.value), [8, 3, 12, 1]);
  assert.equal(final.snapshot.items.at(-1)!.next, null);
  assert.equal(final.metrics.pointerChanges, 1);
});

test("hash insertion shows a real modulo collision chain", () => {
  const simulation = buildDataStructureSimulation({ kind: "hash-table", operation: "insert", value: 17, index: 0 });
  const bucket = simulation.frames.at(-1)!.snapshot.buckets!.find((item) => item.index === 3)!;
  assert.deepEqual(bucket.items.map((item) => item.value), [10, 17]);
  assert.match(simulation.frames.at(-1)!.detail, /collision/i);
});

test("BST search follows ordering and BFS records its frontier", () => {
  const tree = buildDataStructureSimulation({ kind: "binary-tree", operation: "search", value: 6, index: 0 });
  assert.deepEqual(tree.frames.at(-1)!.snapshot.visitedValues, [8, 3, 6]);
  assert.equal(tree.frames.at(-1)!.metrics.comparisons, 3);

  const graph = buildDataStructureSimulation({ kind: "graph", operation: "bfs", value: 10, index: 0 });
  assert.match(graph.result, /reached/);
  assert.ok(graph.frames.some((frame) => frame.snapshot.frontierValues.length > 1));
  assert.equal(new Set(graph.frames.at(-1)!.snapshot.visitedValues).size, graph.frames.at(-1)!.snapshot.visitedValues.length);
});

test("the reference lab is responsive and uses flow layout", () => {
  const css = readFileSync(new URL("../src/visual-engine/data-structures/data-structures-lab.css", import.meta.url), "utf8");
  const component = readFileSync(new URL("../src/visual-engine/data-structures/DataStructuresLab.tsx", import.meta.url), "utf8");
  for (const breakpoint of [1150, 900, 650, 400]) assert.match(css, new RegExp(`max-width:${breakpoint}px`));
  assert.doesNotMatch(css, /position:(?:absolute|fixed)/);
  assert.doesNotMatch(css, /height:calc\([^;]*100vh/i);
  assert.match(component, /BEFORE/);
  assert.match(component, /AFTER/);
  assert.match(component, /PREDICT BEFORE YOU RUN/);
  assert.match(component, /comparisons/);
  assert.match(component, /pointer changes/);
});
