import assert from "node:assert/strict";
import test from "node:test";
import { buildDataStructureSimulation, structureInfo, structureKinds, type SimulationConfig } from "../src/visual-engine/data-structures/model.ts";
import { buildRecursionTimeline } from "../src/visual-engine/engines/execution/recursion-engine.ts";
import { buildTrace } from "../src/learning/registry.ts";
import "../src/learning/engines/index.ts";

const run = (config: Partial<SimulationConfig> & Pick<SimulationConfig, "kind" | "operation">) =>
  buildDataStructureSimulation({ value: 7, index: 0, ...config });
const final = (sim: ReturnType<typeof run>) => sim.frames.at(-1)!;
const liveValues = (sim: ReturnType<typeof run>) => final(sim).snapshot.items.filter((item) => !item.detached).map((item) => item.value);

test("every operation is deterministic and on every structure size from empty to full", () => {
  for (const kind of structureKinds) {
    for (const { id } of structureInfo[kind].operations) {
      for (const values of [[], [5], [5, 5], [4, 9, 2, 7, 1, 8, 3, 6]]) {
        for (const index of [0, 1, 4, 9]) {
          const config = { kind, operation: id, value: 5, index, values };
          const a = buildDataStructureSimulation(config);
          assert.deepEqual(buildDataStructureSimulation(config), a, `${kind}.${id} is not deterministic`);
          assert.ok(a.frames.length >= 2, `${kind}.${id} on ${values.length} values ends without a result frame`);
          for (const frame of a.frames) {
            const ids = [...frame.snapshot.items, ...(frame.snapshot.buckets?.flatMap((b) => b.items) ?? [])].map((item) => item.id);
            assert.equal(new Set(ids).size, ids.length, `${kind}.${id}: duplicate ids in ${frame.id}`);
            for (const focus of frame.snapshot.focusIds) assert.ok(ids.includes(focus), `${kind}.${id}: ${frame.id} focuses missing ${focus}`);
          }
        }
      }
    }
  }
});

test("array: invalid indexes are refused, never clamped, and leave the array unchanged", () => {
  const del = run({ kind: "array", operation: "delete", index: 5 });
  assert.equal(del.outcome!.status, "invalid-index");
  assert.deepEqual(liveValues(del), [8, 3, 12, 1, 6]);
  assert.equal(final(del).metrics.writes, 0);
  assert.equal(run({ kind: "array", operation: "delete", index: 0, values: [] }).outcome!.status, "invalid-index");
  assert.equal(run({ kind: "array", operation: "insert", index: 6 }).outcome!.status, "invalid-index");
  // Index = length appends with no shifts; length + 1 would leave a gap.
  const append = run({ kind: "array", operation: "insert", index: 5, value: 9 });
  assert.deepEqual(liveValues(append), [8, 3, 12, 1, 6, 9]);
  assert.equal(append.outcome!.shifts, 0);
  assert.equal(final(append).metrics.writes, 2);
  const empty = run({ kind: "array", operation: "insert", index: 0, value: 4, values: [] });
  assert.deepEqual(liveValues(empty), [4]);
});

test("array: writes are shifts plus the value and length stores; delete closes the gap", () => {
  const insert = run({ kind: "array", operation: "insert", index: 1, value: 9 });
  assert.deepEqual(liveValues(insert), [8, 9, 3, 12, 1, 6]);
  assert.equal(insert.outcome!.shifts, 4);
  assert.equal(final(insert).metrics.writes, 6);
  // No write is counted before the first shift happens.
  assert.equal(insert.frames[1].metrics.writes, 1);
  const del = run({ kind: "array", operation: "delete", index: 1 });
  assert.deepEqual(liveValues(del), [8, 12, 1, 6]);
  assert.equal(del.outcome!.shifts, 3);
  assert.equal(final(del).metrics.writes, 4);
  const dupes = run({ kind: "array", operation: "search", value: 5, values: [1, 5, 5] });
  assert.equal(dupes.outcome!.index, 1, "linear search stops at the first match");
});

test("linked list: insert writes the new node's pointer before redirecting its predecessor", () => {
  for (const [index, expected] of [[0, [7, 8, 3, 12, 1, 6]], [2, [8, 3, 7, 12, 1, 6]], [5, [8, 3, 12, 1, 6, 7]]] as const) {
    const sim = run({ kind: "linked-list", operation: "insert", index });
    assert.deepEqual(liveValues(sim), expected);
    assert.equal(final(sim).metrics.pointerChanges, 2, `insert at ${index}: new.next and one incoming pointer`);
    const pointing = sim.frames.find((frame) => frame.title === "Point the new node at its successor")!;
    const fresh = pointing.snapshot.items.find((item) => item.id === "node-new")!;
    assert.equal(fresh.detached, true, "the new node is unreachable until its predecessor is redirected");
    // Every live node's next pointer names the following live node; the last is NULL.
    const nodes = final(sim).snapshot.items;
    nodes.forEach((node, i) => assert.equal(node.next, nodes[i + 1]?.address ?? null));
  }
  assert.equal(run({ kind: "linked-list", operation: "insert", index: 6 }).outcome!.status, "invalid-index");
  assert.deepEqual(liveValues(run({ kind: "linked-list", operation: "insert", index: 0, values: [] })), [7]);
});

test("linked list: delete rewrites exactly one pointer and keeps every other node's address", () => {
  for (const value of [8, 12, 6]) {
    const sim = run({ kind: "linked-list", operation: "delete", value });
    const before = new Map(sim.frames[0].snapshot.items.map((n) => [n.id, n.address]));
    assert.equal(final(sim).metrics.pointerChanges, 1);
    assert.ok(!liveValues(sim).includes(value));
    for (const node of final(sim).snapshot.items) assert.equal(node.address, before.get(node.id));
  }
  const absent = run({ kind: "linked-list", operation: "delete", value: 99 });
  assert.equal(final(absent).metrics.pointerChanges, 0);
  assert.equal(absent.outcome!.status, "absent");
  assert.deepEqual(liveValues(run({ kind: "linked-list", operation: "delete", value: 4, values: [4] })), []);
  // Duplicates: only the first match is removed.
  assert.deepEqual(liveValues(run({ kind: "linked-list", operation: "delete", value: 4, values: [4, 2, 4] })), [2, 4]);
});

test("stack and queue: LIFO/FIFO with stable element identity and honest underflow", () => {
  const dequeue = run({ kind: "queue", operation: "dequeue" });
  assert.deepEqual(liveValues(dequeue), [3, 12, 1]);
  // 3 kept its id: the front moved, the elements were not relabelled.
  assert.equal(final(dequeue).snapshot.items[0].id, dequeue.frames[0].snapshot.items[1].id);
  assert.deepEqual(liveValues(run({ kind: "stack", operation: "pop" })), [8, 3, 12]);
  const push = run({ kind: "stack", operation: "push", value: 9 });
  assert.deepEqual(liveValues(push), [8, 3, 12, 1, 9]);
  assert.equal(final(push).metrics.writes, 2, "a value store and a TOP update, like pop's one TOP update");
  assert.equal(final(push).action, "WRITE AT TOP");
  for (const [kind, operation] of [["stack", "pop"], ["stack", "peek"], ["queue", "dequeue"], ["queue", "peek"]] as const) {
    const sim = run({ kind, operation, values: [] });
    assert.equal(sim.outcome!.status, "empty");
    assert.equal(final(sim).metrics.writes, 0);
  }
  assert.deepEqual(liveValues(run({ kind: "queue", operation: "enqueue", value: 2, values: [] })), [2]);
});

test("hash table: lookups stop at the match, keys are unique, entries keep their addresses", () => {
  // 15 and 8 share bucket 1. Deleting 15 compares one key, not the whole chain.
  const del = run({ kind: "hash-table", operation: "delete", value: 15 });
  assert.equal(final(del).metrics.comparisons, 1);
  const before = del.frames[0].snapshot.buckets!.flatMap((b) => b.items);
  const after = final(del).snapshot.buckets!.flatMap((b) => b.items);
  for (const entry of after) assert.equal(entry.address, before.find((e) => e.id === entry.id)!.address);
  const dup = run({ kind: "hash-table", operation: "insert", value: 8 });
  assert.equal(dup.outcome!.status, "duplicate");
  assert.equal(final(dup).metrics.writes, 0);
  assert.equal(final(dup).snapshot.buckets![1].items.filter((e) => e.value === 8).length, 1);
  assert.equal(run({ kind: "hash-table", operation: "insert", value: 22 }).frames.at(-1)!.metrics.comparisons, 2);
  // Negative keys still land in 0…6.
  assert.equal(run({ kind: "hash-table", operation: "insert", value: -3 }).outcome!.bucket, 4);
  assert.equal(run({ kind: "hash-table", operation: "search", value: 1, values: [] }).frames.at(-1)!.metrics.comparisons, 0);
});

test("binary search tree: absent searches end at a null branch; duplicates and empty trees", () => {
  const miss = run({ kind: "binary-tree", operation: "search", value: 7 });
  assert.equal(miss.outcome!.status, "absent");
  assert.deepEqual(final(miss).snapshot.visitedValues, [8, 3, 6]);
  assert.match(final(miss).detail, /right child of 6 is null/);
  const dup = run({ kind: "binary-tree", operation: "insert", value: 12 });
  assert.equal(dup.outcome!.status, "duplicate");
  assert.equal(final(dup).metrics.writes, 0);
  const root = run({ kind: "binary-tree", operation: "insert", value: 5, values: [] });
  assert.equal(final(root).code, "root = new Node(5)");
  const skewed = run({ kind: "binary-tree", operation: "search", value: 8, values: [1, 2, 3, 4, 5, 6, 7, 8] });
  assert.equal(final(skewed).metrics.comparisons, 8, "a skewed tree degrades to a linear walk");
});

test("graph: BFS distinguishes found, unreachable and absent", () => {
  assert.equal(run({ kind: "graph", operation: "bfs", value: 12 }).outcome!.status, "found");
  assert.equal(run({ kind: "graph", operation: "bfs", value: 15 }).outcome!.status, "unreachable");
  assert.equal(run({ kind: "graph", operation: "bfs", value: 99 }).outcome!.status, "absent");
});

test("the adapter keeps mission scenario keys and passes learner values through", () => {
  const mission = buildTrace("data-structures", { kind: "linked-list", operation: "delete", value: 6 });
  assert.equal(mission.scenarioKey.includes("values"), false);
  const custom = buildTrace("data-structures", { kind: "array", operation: "insert", value: 1, index: 0, values: "4, 2 ,x,9" });
  assert.equal(custom.params.values, "4,2,9");
  assert.equal(custom.outcome.length, 4);
  // An index beyond the array is refused by the engine, not silently clamped by the adapter.
  assert.equal(buildTrace("data-structures", { kind: "array", operation: "delete", index: 7 }).outcome.status, "invalid-index");
  const hash = buildTrace("data-structures", { kind: "hash-table", operation: "search", values: "3,3,10" });
  assert.equal(hash.params.values, "3,10");
});

test("recursion: frames push one per call, return in reverse, and values flow back correctly", () => {
  const t = buildRecursionTimeline({ fn: "factorial", n: 5, baseCase: true, stackLimit: 8 });
  assert.equal(t.outcome.result, 120);
  assert.equal(t.outcome.maxDepth, 5);
  assert.equal(t.outcome.firstReturn, "factorial(1)");
  const returned = t.events.filter((e) => e.returned).map((e) => e.returned!.value);
  assert.deepEqual(returned, [1, 2, 6, 24, 120]);
  const depths = t.events.map((e) => e.stack.length);
  assert.deepEqual(depths, [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0, 0]);
  // Only the top frame runs while calls are being made.
  for (const e of t.events.filter((e) => e.kind === "call")) assert.deepEqual(e.stack.map((f) => f.status), [...e.stack.slice(1).map(() => "waiting"), "running"]);
  assert.equal(buildRecursionTimeline({ fn: "sum", n: 4, baseCase: true, stackLimit: 8 }).outcome.result, 10);
  assert.equal(buildRecursionTimeline({ fn: "factorial", n: 1, baseCase: true, stackLimit: 4 }).outcome.maxDepth, 1);
});

test("recursion: overflow at the limit, explained correctly with and without a base case", () => {
  const none = buildRecursionTimeline({ fn: "factorial", n: 3, baseCase: false, stackLimit: 6 });
  assert.equal(none.outcome.status, "overflow");
  assert.equal(none.outcome.maxDepth, 6);
  assert.match(none.events.find((e) => e.kind === "overflow")!.explanation, /No base case/);
  const tooDeep = buildRecursionTimeline({ fn: "factorial", n: 6, baseCase: true, stackLimit: 4 });
  assert.equal(tooDeep.outcome.status, "overflow");
  const overflow = tooDeep.events.find((e) => e.kind === "overflow")!;
  assert.doesNotMatch(overflow.explanation, /No base case/);
  assert.match(overflow.explanation, /2 more calls away/);
  // A depth exactly at the limit still returns.
  assert.equal(buildRecursionTimeline({ fn: "factorial", n: 4, baseCase: true, stackLimit: 4 }).outcome.status, "returned");
});
