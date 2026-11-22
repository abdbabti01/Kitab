// Engine extensions for Data Structures Mastery: dynamic-array growth, BST deletion, depth-first search and BFS
// distances. Each is checked against an independent reference, not against the engine's own narration.
import assert from "node:assert/strict";
import test from "node:test";
import { buildDataStructureSimulation, buildGraphSearch, graphFixture, treeHeight, type SimulationConfig, type StructureItem } from "../src/visual-engine/data-structures/model.ts";
import { buildTrace } from "../src/learning/registry.ts";
import "../src/learning/engines/index.ts";

const run = (config: Partial<SimulationConfig> & Pick<SimulationConfig, "kind" | "operation">) => buildDataStructureSimulation({ value: 7, index: 0, ...config });
const last = (sim: ReturnType<typeof run>) => sim.frames.at(-1)!;

test("array: a full block doubles, copies every element once, then switches the reference", () => {
  const sim = run({ kind: "array", operation: "insert", value: 7, index: 4, values: [8, 3, 12, 1], capacity: 4 });
  assert.equal(sim.outcome!.copies, 4);
  assert.equal(sim.outcome!.capacity, 8);
  assert.equal(sim.outcome!.shifts, 0);
  const end = last(sim);
  assert.deepEqual(end.snapshot.items.map((i) => i.value), [8, 3, 12, 1, 7]);
  assert.deepEqual(end.snapshot.block, { base: "0x2000", capacity: 8 });
  assert.equal(end.snapshot.oldBlock, undefined, "the old block is gone from the picture after the switch");
  end.snapshot.items.forEach((item, i) => assert.equal(item.address, `0x${(0x2000 + i * 4).toString(16).toUpperCase()}`));
  // 4 copies + 1 reference write + value + length.
  assert.equal(end.metrics.writes, 7);
  assert.equal(end.metrics.reads, 4);
  assert.equal(end.metrics.pointerChanges, 1);
  const actions = sim.frames.map((f) => f.action);
  assert.deepEqual(actions, ["INITIALIZE", "CHECK CAPACITY", "ALLOCATE", "READ + WRITE", "READ + WRITE", "READ + WRITE", "READ + WRITE", "WRITE REFERENCE", "WRITE"]);
  // While copying, the array still refers to the old block; at the switch it no longer does.
  const copying = sim.frames.filter((f) => f.title.startsWith("Copy"));
  for (const [i, frame] of copying.entries()) {
    assert.equal(frame.snapshot.oldBlock!.reachable, true);
    assert.deepEqual(frame.snapshot.oldBlock!.items.map((x) => x.value), [8, 3, 12, 1], "the old block keeps its values while copying");
    assert.equal(frame.snapshot.items.length, i + 1, "one more slot of the new block is filled per copy");
  }
  assert.equal(sim.frames.find((f) => f.action === "WRITE REFERENCE")!.snapshot.oldBlock!.reachable, false);
  assert.match(sim.complexity, /amortized O\(1\)/);
});

test("array: growth before a middle insert still shifts the later elements, in the new block", () => {
  const sim = run({ kind: "array", operation: "insert", value: 9, index: 0, values: [1, 2], capacity: 2 });
  assert.equal(sim.outcome!.copies, 2);
  assert.equal(sim.outcome!.shifts, 2);
  assert.deepEqual(last(sim).snapshot.items.map((i) => i.value), [9, 1, 2]);
  assert.equal(last(sim).metrics.writes, 2 + 1 + 2 + 2);
  // Empty block of one slot: inserting grows it to two.
  const tiny = run({ kind: "array", operation: "insert", value: 4, index: 0, values: [], capacity: 1 });
  assert.equal(tiny.outcome!.copies, 0);
  assert.equal(tiny.outcome!.capacity, 1, "an empty one-slot block has room");
});

test("array: capacity is never fewer than the values, defaults to 8, and delete never shrinks it", () => {
  assert.deepEqual(run({ kind: "array", operation: "search", values: [1, 2, 3], capacity: 1 }).frames[0].snapshot.block, { base: "0x1000", capacity: 3 });
  assert.equal(run({ kind: "array", operation: "search" }).frames[0].snapshot.block!.capacity, 8);
  const del = run({ kind: "array", operation: "delete", index: 0, values: [1, 2, 3], capacity: 3 });
  assert.equal(last(del).snapshot.block!.capacity, 3);
  // The missions' fixture (5 values, default capacity) never grows, so their counts are unchanged.
  for (const index of [0, 2, 4, 5]) assert.equal(run({ kind: "array", operation: "insert", index }).outcome!.copies, 0);
});

test("array and list scans highlight the exact elements inspected, even with repeated values", () => {
  const sim = run({ kind: "array", operation: "search", value: 1, values: [5, 1, 5] });
  assert.deepEqual(last(sim).snapshot.visitedIds, ["array-0", "array-1"]);
  const list = run({ kind: "linked-list", operation: "search", value: 1, values: [5, 1, 5] });
  assert.deepEqual(last(list).snapshot.visitedIds, ["node-0", "node-1"]);
});

// ---- Binary search tree deletion, against a plain pointer-based reference ----

type Ref = { value: number; left?: Ref; right?: Ref };
function refInsert(root: Ref | undefined, value: number): Ref {
  if (!root) return { value };
  if (value < root.value) root.left = refInsert(root.left, value);
  else if (value > root.value) root.right = refInsert(root.right, value);
  return root;
}
function refDelete(root: Ref | undefined, value: number): Ref | undefined {
  if (!root) return undefined;
  if (value < root.value) root.left = refDelete(root.left, value);
  else if (value > root.value) root.right = refDelete(root.right, value);
  else {
    if (!root.left) return root.right;
    if (!root.right) return root.left;
    let s = root.right;
    while (s.left) s = s.left;
    root.value = s.value;
    root.right = refDelete(root.right, s.value);
  }
  return root;
}
const shape = (n?: Ref): string => (n ? `(${shape(n.left)} ${n.value} ${shape(n.right)})` : ".");
function engineShape(items: StructureItem[], root: string | null | undefined): string {
  const byId = new Map(items.map((i) => [i.id, i]));
  const walk = (id: string | null | undefined): string => {
    const n = id ? byId.get(id) : undefined;
    return n ? `(${walk(n.left)} ${n.value} ${walk(n.right)})` : ".";
  };
  return walk(root);
}
function caseOf(root: Ref | undefined, value: number) {
  let n = root;
  while (n && n.value !== value) n = value < n.value ? n.left : n.right;
  return !n ? "absent" : n.left && n.right ? "two-children" : n.left || n.right ? "one-child" : "leaf";
}

test("BST delete matches the textbook algorithm on every value of many trees, and every node keeps its id", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const trees: number[][] = [[8, 3, 12, 1, 6, 10, 14], [1, 2, 3, 4, 5], [5, 4, 3, 2, 1], []];
  for (let t = 0; t < 40; t++) trees.push(Array.from({ length: 1 + Math.floor(random() * 8) }, () => Math.floor(random() * 40) - 20));
  for (const values of trees) {
    const unique = [...new Set(values)];
    for (const target of [...unique, 99]) {
      let ref: Ref | undefined;
      for (const v of unique) ref = refInsert(ref, v);
      const expectedCase = caseOf(ref, target);
      ref = refDelete(ref, target);
      const sim = run({ kind: "binary-tree", operation: "delete", value: target, values });
      const end = last(sim).snapshot;
      assert.equal(engineShape(end.items, end.root), shape(ref), `delete ${target} from [${unique}]`);
      assert.equal(sim.outcome!.status, expectedCase === "absent" ? "absent" : "removed");
      if (expectedCase !== "absent") assert.equal(sim.outcome!.case, expectedCase);
      assert.equal(last(sim).metrics.writes, { absent: 0, leaf: 1, "one-child": 1, "two-children": 2 }[expectedCase]);
      assert.equal(treeHeight(end.items, end.root), sim.outcome!.height);
      // Surviving nodes keep the id and address they started with.
      const start = new Map(sim.frames[0].snapshot.items.map((i) => [i.id, i.address]));
      for (const item of end.items) assert.equal(start.get(item.id), item.address);
      // Rebuilding from the items' order gives the same tree, so "start the next operation from this result" is exact.
      let rebuilt: Ref | undefined;
      for (const item of end.items) rebuilt = refInsert(rebuilt, item.value);
      assert.equal(shape(rebuilt), shape(ref), `rebuild after deleting ${target} from [${unique}]`);
    }
  }
});

test("BST delete with two children walks to the in-order successor and copies its value into the same node", () => {
  const sim = run({ kind: "binary-tree", operation: "delete", value: 8 });
  assert.deepEqual(sim.frames.map((f) => f.action), ["READ ROOT", "COMPARE", "FIND SUCCESSOR", "FIND SUCCESSOR", "WRITE VALUE", "WRITE CHILD POINTER"]);
  const copy = sim.frames.find((f) => f.action === "WRITE VALUE")!;
  // Mid-delete, the successor's value appears twice: the same node now holds 10, and the old 10 node is still linked.
  assert.deepEqual(copy.snapshot.items.filter((i) => i.value === 10).map((i) => i.id).sort(), ["tree-0", "tree-5"]);
  assert.equal(last(sim).snapshot.root, "tree-0", "the root node keeps its identity");
  assert.equal(last(sim).snapshot.items.find((i) => i.id === "tree-0")!.value, 10);
});

test("BST search and insert still compare once per node on the path; height is reported", () => {
  assert.equal(last(run({ kind: "binary-tree", operation: "search", value: 6 })).metrics.comparisons, 3);
  assert.equal(run({ kind: "binary-tree", operation: "search", value: 8, values: [1, 2, 3, 4, 5, 6, 7, 8] }).outcome!.height, 7);
  assert.equal(run({ kind: "binary-tree", operation: "search", value: 6 }).outcome!.height, 2);
  assert.equal(run({ kind: "binary-tree", operation: "delete", value: 3, values: [] }).outcome!.status, "absent");
});

// ---- Graph traversals ----

function recursiveDfs(adjacency: Record<number, number[]>, start: number) {
  const seen = new Set<number>();
  const order: number[] = [];
  const visit = (v: number) => { seen.add(v); order.push(v); for (const n of adjacency[v]) if (!seen.has(n)) visit(n); };
  visit(start);
  return order;
}
function bfsDistance(adjacency: Record<number, number[]>, start: number) {
  const dist = new Map([[start, 0]]);
  const queue = [start];
  while (queue.length) { const v = queue.shift()!; for (const n of adjacency[v]) if (!dist.has(n)) { dist.set(n, dist.get(v)! + 1); queue.push(n); } }
  return dist;
}

test("DFS visits vertices in the same order as a recursive depth-first search", () => {
  const full = run({ kind: "graph", operation: "dfs", value: 99 });
  assert.equal(full.outcome!.status, "absent");
  assert.equal(full.outcome!.order, recursiveDfs(graphFixture, 1).join(","));
  assert.equal(full.outcome!.order, "1,3,6,10,8,12");
  assert.ok(full.frames.some((f) => f.action === "POP + SKIP"), "8 is pushed twice and skipped the second time");
  assert.equal(run({ kind: "graph", operation: "dfs", value: 15 }).outcome!.status, "unreachable");
  assert.equal(run({ kind: "graph", operation: "dfs", value: 10 }).outcome!.status, "found");
  // Random graphs: same order as the recursive reference.
  let seed = 3;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let g = 0; g < 30; g++) {
    const adjacency: Record<number, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
    for (let e = 0; e < 7; e++) {
      const a = 1 + Math.floor(random() * 6), b = 1 + Math.floor(random() * 6);
      if (a !== b && !adjacency[a].includes(b)) { adjacency[a].push(b); adjacency[b].push(a); }
    }
    const sim = buildGraphSearch({ kind: "graph", operation: "dfs", value: 99, index: 0 }, adjacency);
    assert.equal(sim.outcome!.order, recursiveDfs(adjacency, 1).join(","));
    const frontier = sim.frames.map((f) => f.snapshot.frontier);
    assert.ok(frontier.every((kind) => kind === "stack"));
  }
});

test("BFS reports the shortest edge count to the target", () => {
  const dist = bfsDistance(graphFixture, 1);
  for (const [vertex, d] of dist) {
    const sim = run({ kind: "graph", operation: "bfs", value: vertex });
    assert.equal(sim.outcome!.distance, d, `distance to ${vertex}`);
    assert.match(sim.result, new RegExp(`${d} edge`));
  }
  assert.equal(run({ kind: "graph", operation: "bfs", value: 15 }).outcome!.distance, undefined);
});

test("the adapter accepts capacity for arrays only and leaves mission scenario params unchanged", () => {
  const withCap = buildTrace("data-structures", { kind: "array", operation: "insert", value: 7, index: 4, values: "8,3,12,1", capacity: 4 });
  assert.equal(withCap.params.capacity, 4);
  assert.equal(withCap.outcome.copies, 4);
  assert.equal(buildTrace("data-structures", { kind: "array", operation: "insert", value: 7, index: 2 }).params.capacity, undefined);
  assert.equal(buildTrace("data-structures", { kind: "stack", operation: "push", capacity: 4 }).params.capacity, undefined);
  assert.equal(buildTrace("data-structures", { kind: "array", operation: "insert", capacity: 999 }).params.capacity, 16);
  const tree = buildTrace("data-structures", { kind: "binary-tree", operation: "delete", value: 8 });
  assert.ok(tree.frames.at(-1)!.facts.some((f) => f.id === "height"));
  const dfs = buildTrace("data-structures", { kind: "graph", operation: "dfs", value: 12 });
  assert.ok(dfs.frames[0].facts.some((f) => f.id === "stack"));
});
