// The Data Structures & Recursion Playground's setups: what the URL holds, how it is read back, and the guided
// experiments each unit of the data-structures track opens. Pure: no React, no DOM.
import { fixtures, MAX_CAPACITY, structureInfo, structureKinds, type OperationKind, type StructureKind } from "../visual-engine/data-structures/model.ts";
import { normalizeRecursionConfig, type RecursionConfig } from "../visual-engine/engines/execution/recursion-engine.ts";

export const PLAYGROUND_PATH = "/practice/structures";

export type StructureSetup = { structure: StructureKind; operation: OperationKind; value: number; index: number; values?: number[]; /** Array only: slots in the backing block. */ capacity?: number };
export type RecursionSetup = { structure: "recursion" } & RecursionConfig;
export type Setup = StructureSetup | RecursionSetup;

export const isRecursion = (setup: Setup): setup is RecursionSetup => setup.structure === "recursion";

/** The engine id and params a setup runs on (the same adapters the missions use). */
export function engineParams(setup: Setup): { engine: "data-structures" | "recursion"; params: Record<string, unknown> } {
  if (isRecursion(setup)) return { engine: "recursion", params: { fn: setup.fn, n: setup.n, baseCase: setup.baseCase, stackLimit: setup.stackLimit } };
  const params: Record<string, unknown> = { kind: setup.structure, operation: setup.operation, value: setup.value, index: setup.index };
  if (setup.values) params.values = setup.values.join(",");
  if (setup.capacity !== undefined && setup.structure === "array") params.capacity = setup.capacity;
  return { engine: "data-structures", params };
}

export function defaultSetup(structure: StructureKind | "recursion"): Setup {
  if (structure === "recursion") return { structure, ...normalizeRecursionConfig({}) };
  return { structure, ...structureInfo[structure].defaults };
}

const int = (raw: string | null, fallback: number) => {
  const value = Number(raw);
  return raw !== null && raw !== "" && Number.isFinite(value) ? Math.trunc(value) : fallback;
};

/** Reads a setup from the query. Unknown or missing values fall back to the structure's defaults; nothing throws. */
export function parseSetup(search: string): Setup {
  const query = new URLSearchParams(search);
  const structure = query.get("structure");
  if (structure === "recursion") {
    return {
      structure,
      ...normalizeRecursionConfig({
        fn: query.get("fn") === "sum" ? "sum" : "factorial",
        n: int(query.get("n"), 4),
        baseCase: query.get("base") !== "0",
        stackLimit: int(query.get("limit"), 8),
      }),
    };
  }
  const kind = (structureKinds as readonly string[]).includes(structure ?? "") ? (structure as StructureKind) : "array";
  const base = defaultSetup(kind) as StructureSetup;
  const operation = structureInfo[kind].operations.some((op) => op.id === query.get("op")) ? (query.get("op") as OperationKind) : base.operation;
  const setup: StructureSetup = {
    structure: kind,
    operation,
    value: Math.max(-99, Math.min(99, int(query.get("value"), base.value))),
    index: Math.max(0, Math.min(10, int(query.get("index"), base.index))),
  };
  const values = query.get("values");
  if (values !== null && kind !== "graph") setup.values = values.split(",").filter((v) => v.trim() !== "").map(Number).filter(Number.isInteger);
  const capacity = query.get("capacity");
  if (capacity !== null && kind === "array") setup.capacity = Math.max(1, Math.min(MAX_CAPACITY, int(capacity, 8)));
  return setup;
}

/** A same-site path to return to, or null: only "/…" paths, never "//host" or a scheme. */
export function safeReturn(from: string | null): string | null {
  return from && /^\/(?!\/)[\w\-./#?=&%]*$/.test(from) && from.length <= 200 ? from : null;
}

export function setupPath(setup: Setup, from?: string | null): string {
  const query = new URLSearchParams({ structure: setup.structure });
  if (isRecursion(setup)) {
    query.set("fn", setup.fn);
    query.set("n", String(setup.n));
    query.set("base", setup.baseCase ? "1" : "0");
    query.set("limit", String(setup.stackLimit));
  } else {
    query.set("op", setup.operation);
    query.set("value", String(setup.value));
    query.set("index", String(setup.index));
    if (setup.values) query.set("values", setup.values.join(","));
    if (setup.capacity !== undefined && setup.structure === "array") query.set("capacity", String(setup.capacity));
  }
  const back = safeReturn(from ?? null);
  if (back) query.set("from", back);
  return `${PLAYGROUND_PATH}?${query}`;
}

/** A guided experiment (predict, then test) in the Playground, with an optional same-site page to return to. */
export function cyclePath(id: string, from?: string | null): string {
  const query = new URLSearchParams({ experiment: id });
  const back = safeReturn(from ?? null);
  if (back) query.set("from", back);
  return `${PLAYGROUND_PATH}?${query}`;
}

/** Does this operation use the index control, the value control, or neither? */
export function inputsFor(setup: StructureSetup) {
  const { structure: kind, operation } = setup;
  const index = operation === "insert" && (kind === "array" || kind === "linked-list") || operation === "delete" && kind === "array";
  const value = !index || operation === "insert";
  const usesValue = value && !["pop", "dequeue", "peek"].includes(operation);
  return { index, value: usesValue };
}

export type Experiment = { id: string; unit: string; title: string; detail: string; setup: Setup };

/** Guided experiments, in the order of the data-structures track's units. Every one is a real engine run. */
export const experiments: Experiment[] = [
  { id: "array-insert-middle", unit: "arrays", title: "Make room in the middle", detail: "Insert 7 at index 2 and count the values that shift right.", setup: { structure: "array", operation: "insert", value: 7, index: 2 } },
  { id: "array-delete-front", unit: "arrays", title: "Delete the first element", detail: "Every later value moves one slot left to close the gap.", setup: { structure: "array", operation: "delete", value: 0, index: 0 } },
  { id: "array-out-of-range", unit: "arrays", title: "Ask for an index that isn't there", detail: "Delete index 5 of a five-element array: nothing changes.", setup: { structure: "array", operation: "delete", value: 0, index: 5 } },
  { id: "array-grow", unit: "arrays", title: "Append to a full array", detail: "Four values fill a four-slot block: watch it double, copy, then append.", setup: { structure: "array", operation: "insert", value: 7, index: 4, values: [8, 3, 12, 1], capacity: 4 } },
  { id: "list-insert-head", unit: "linked-lists", title: "Insert at the head", detail: "Allocate a node, point it at the old first node, then move HEAD.", setup: { structure: "linked-list", operation: "insert", value: 5, index: 0 } },
  { id: "list-delete-middle", unit: "linked-lists", title: "Unlink a middle node", detail: "Walk to 12, then rewrite one pointer to skip it.", setup: { structure: "linked-list", operation: "delete", value: 12, index: 0 } },
  { id: "hash-collision", unit: "hash-tables", title: "Collide in bucket 1", detail: "22 mod 7 = 1, where 15 and 8 already live.", setup: { structure: "hash-table", operation: "insert", value: 22, index: 0 } },
  { id: "hash-duplicate", unit: "hash-tables", title: "Insert a key twice", detail: "15 is already stored: the table finds it and writes nothing.", setup: { structure: "hash-table", operation: "insert", value: 15, index: 0 } },
  { id: "bst-search", unit: "trees", title: "Search a balanced tree", detail: "Find 6 in three comparisons, discarding a subtree each time.", setup: { structure: "binary-tree", operation: "search", value: 6, index: 0 } },
  { id: "bst-skewed", unit: "trees", title: "Search a skewed tree", detail: "Values inserted in sorted order make a chain: 8 comparisons to find 8.", setup: { structure: "binary-tree", operation: "search", value: 8, index: 0, values: [1, 2, 3, 4, 5, 6, 7, 8] } },
  { id: "bst-delete-two-children", unit: "trees", title: "Delete a node with two children", detail: "Delete the root 8: its in-order successor 10 takes its place.", setup: { structure: "binary-tree", operation: "delete", value: 8, index: 0 } },
  { id: "bst-delete-leaf", unit: "trees", title: "Delete a leaf", detail: "Delete 1: one child pointer becomes null.", setup: { structure: "binary-tree", operation: "delete", value: 1, index: 0 } },
  { id: "graph-unreachable", unit: "trees", title: "Far away or unreachable?", detail: "Breadth-first search for 15, a vertex with no edges.", setup: { structure: "graph", operation: "bfs", value: 15, index: 0 } },
  { id: "graph-dfs", unit: "trees", title: "Depth-first instead of breadth-first", detail: "Search for 12 with a stack: the walk goes deep along one path first.", setup: { structure: "graph", operation: "dfs", value: 12, index: 0 } },
  { id: "recursion-factorial", unit: "recursion", title: "Watch factorial(4) unwind", detail: "Four frames pushed, then returned in reverse order.", setup: { structure: "recursion", fn: "factorial", n: 4, baseCase: true, stackLimit: 8 } },
  { id: "recursion-no-base", unit: "recursion", title: "Remove the base case", detail: "Nothing stops the calls until the stack limit.", setup: { structure: "recursion", fn: "factorial", n: 3, baseCase: false, stackLimit: 6 } },
  { id: "recursion-too-deep", unit: "recursion", title: "A base case too deep to reach", detail: "factorial(6) needs six frames; the limit is four.", setup: { structure: "recursion", fn: "factorial", n: 6, baseCase: true, stackLimit: 4 } },
  { id: "stack-vs-queue", unit: "choose-structure", title: "Stack or queue: who leaves first?", detail: "Remove one item from a queue, then switch to a stack and compare.", setup: { structure: "queue", operation: "dequeue", value: 0, index: 0 } },
];

export const findExperiment = (id: string) => experiments.find((experiment) => experiment.id === id);

/** The experiment a unit of the data-structures track opens first. */
export const experimentForUnit = (unit: string) => experiments.find((experiment) => experiment.unit === unit);

/** Readable labels for the structure picker, recursion included. */
export const structureChoices: { id: StructureKind | "recursion"; label: string }[] = [
  ...structureKinds.map((kind) => ({ id: kind, label: structureInfo[kind].label })),
  { id: "recursion", label: "Recursion" },
];

export const fixtureFor = (kind: StructureKind) => (kind === "graph" ? [] : [...fixtures[kind]]);
