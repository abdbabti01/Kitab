import { z } from "zod";
import {
  buildDataStructureSimulation,
  defaultConfig,
  structureInfo,
  structureKinds,
  type SimulationFrame,
  MAX_VALUES,
  MAX_CAPACITY,
  startingValues,
  treeHeight,
  type StructureKind,
  type StructureSnapshot,
} from "../../visual-engine/data-structures/model.ts";

/** "8, 3, 12" → [8, 3, 12]; anything that is not an integer is dropped. "" is an empty structure. */
export function parseValues(text: string): number[] {
  return text.split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isInteger);
}
import type { EngineAdapter, Entity, Fact, Trace } from "../types.ts";
import { normalizeNumberWords } from "../claims.ts";

/** "3 elements shift", "No array elements need to move", "all 5 values are moved" → the claimed count. */
const MOVE_CLAIM = /\b(no|zero|a single|one|\d+|all \d+)\s+(?:existing\s+|array\s+|later\s+|other\s+)?(?:elements?|values?|items?|numbers?)\s+(?:\w+\s+){0,3}?(?:shift|move|get shifted|are shifted|are moved|is shifted|is moved)/gi;

/**
 * Array insertion/deletion claims checked against the engine's computed shift count. Supported claim shapes
 * only: how many existing elements move, and whether an insert overwrites a slot. Anything else is not judged.
 */
function arrayClaims(text: string, trace: Trace): string[] {
  const { kind, operation } = trace.params;
  const shifts = trace.outcome.shifts;
  if (kind !== "array" || (operation !== "insert" && operation !== "delete") || typeof shifts !== "number") return [];
  const normalized = normalizeNumberWords(text);
  const problems: string[] = [];
  for (const match of normalized.matchAll(MOVE_CLAIM)) {
    const head = match[1].toLowerCase();
    const claimed = head === "no" || head === "zero" ? 0 : head === "a single" || head === "one" ? 1 : Number(/\d+/.exec(head)![0]);
    if (claimed !== shifts) problems.push(`Claims ${claimed} element(s) move; the engine shifted ${shifts}.`);
  }
  // Affirmative "overwrite/replace the slot|value" only; "would destroy", "not", "instead of" phrasing is not a claim that it happens.
  const overwrite = /(?<!\b(?:not|never|n't|instead of|rather than|without)\s+(?:\w+\s+)?)\b(?:overwrites?|replaces?)\s+(?:the|that|an?)\s+(?:indexed\s+|existing\s+|target\s+|old\s+)?(?:slot|value|element)/i;
  if (operation === "insert" && shifts > 0 && overwrite.test(normalized)) {
    problems.push(`Claims the insert overwrites a slot; the engine shifted ${shifts} element(s) first and kept every existing value.`);
  }
  return problems;
}

const params = z
  .object({
    kind: z.enum(structureKinds).default("array"),
    operation: z.string().optional(),
    value: z.unknown().optional(),
    index: z.unknown().optional(),
    /** Starting contents, "8,3,12" or a number list; absent means the fixture the missions use. */
    values: z.union([z.string().max(80), z.array(z.number()).max(MAX_VALUES)]).optional(),
    /** Array only: slots in the backing block; absent means the model's default (so mission keys are unchanged). */
    capacity: z.unknown().optional(),
  })
  .strict()
  .transform((input) => {
    const base = defaultConfig(input.kind);
    const allowed = structureInfo[input.kind].operations.map((operation) => operation.id) as string[];
    const operation = allowed.includes(input.operation ?? "") ? input.operation! : base.operation;
    const value = Number(input.value ?? base.value);
    const index = Number(input.index ?? base.index);
    const normalized: Record<string, string | number> = {
      kind: input.kind,
      operation,
      value: Number.isFinite(value) ? Math.max(-99, Math.min(99, Math.trunc(value))) : base.value,
      // Out-of-range indexes reach the engine, which refuses them in a frame of their own.
      index: Number.isFinite(index) ? Math.max(0, Math.min(MAX_VALUES + 2, Math.trunc(index))) : base.index,
    };
    // Only present when given, so the missions' scenario keys (saved in progress) are unchanged.
    if (input.values !== undefined && input.kind !== "graph") {
      const list = typeof input.values === "string" ? parseValues(input.values) : input.values;
      normalized.values = startingValues(input.kind, list).join(",");
    }
    const capacity = Number(input.capacity);
    if (input.capacity !== undefined && input.kind === "array" && Number.isFinite(capacity)) {
      normalized.capacity = Math.max(1, Math.min(MAX_CAPACITY, Math.trunc(capacity)));
    }
    return normalized;
  });

export type DataStructureFrameData = { frame: SimulationFrame; kind: StructureKind; operation: string };

function allItems(snapshot: StructureSnapshot) {
  return [...snapshot.items, ...(snapshot.buckets?.flatMap((bucket) => bucket.items) ?? [])];
}

function entitiesFor(kind: StructureKind, snapshot: StructureSnapshot): Entity[] {
  return allItems(snapshot).map((item, index) => ({
    id: item.id,
    label: item.detached ? `unlinked node ${item.value}` : kind === "array" ? `index ${index} (value ${item.value})` : kind === "graph" ? `vertex ${item.value}` : kind === "hash-table" ? `key ${item.value}` : `value ${item.value}`,
    kind: kind === "graph" ? "vertex" : kind === "array" ? "slot" : "item",
  }));
}

function factsFor(kind: StructureKind, frame: SimulationFrame): Fact[] {
  const s = frame.snapshot;
  const facts: Fact[] = [
    { id: "state", label: "State after step", value: frame.state },
    { id: "comparisons", label: "Comparisons so far", value: frame.metrics.comparisons },
    { id: "reads", label: "Reads so far", value: frame.metrics.reads },
    { id: "writes", label: "Writes so far", value: frame.metrics.writes },
    { id: "pointer-changes", label: "Pointer changes so far", value: frame.metrics.pointerChanges },
  ];
  if (kind === "graph") {
    facts.push(
      { id: "visited", label: "Visited set", value: s.visitedValues.join(", ") || "none" },
      s.frontier === "stack"
        ? { id: "stack", label: "DFS stack (bottom first, top last)", value: s.frontierValues.join(", ") || "empty" }
        : { id: "queue", label: "BFS queue (front first)", value: s.frontierValues.join(", ") || "empty" },
    );
  } else if (kind === "hash-table") {
    const keys = s.buckets!.reduce((sum, bucket) => sum + bucket.items.length, 0);
    facts.push({ id: "load-factor", label: "Load factor (keys ÷ buckets)", value: `${keys} ÷ ${s.buckets!.length} = ${(keys / s.buckets!.length).toFixed(2)}` });
    facts.push({ id: "buckets", label: "Occupied buckets", value: s.buckets!.filter((bucket) => bucket.items.length).map((bucket) => `${bucket.index}:[${bucket.items.map((item) => item.value).join(",")}]`).join(" ") });
  } else {
    const live = s.items.filter((item) => !item.detached);
    facts.push(
      { id: "values", label: "Values in order", value: live.map((item) => item.value).join(", ") || "empty" },
      { id: "length", label: "Length", value: live.length },
    );
    if (s.block) facts.push({ id: "capacity", label: "Capacity (slots in the block)", value: s.block.capacity }, { id: "block", label: "Array refers to the block at", value: s.oldBlock?.reachable ? s.oldBlock.base : s.block.base });
    if (s.oldBlock) facts.push({ id: "old-block", label: `Old block at ${s.oldBlock.base}`, value: s.oldBlock.reachable ? "still referenced by the array" : "unreachable (eligible for collection)" });
    if (kind === "binary-tree") facts.push({ id: "height", label: "Height (edges on the longest root-to-leaf path)", value: treeHeight(s.items, s.root) });
  }
  s.items.forEach((item, index) => {
    if (kind === "array") {
      facts.push(
        { id: `slot-${index}`, label: `Index ${index} at ${item.address}`, value: item.value, entityId: item.id },
        { id: `addr-${index}`, label: `Address of index ${index}`, value: item.address, entityId: item.id },
      );
    }
    if (kind === "binary-tree") {
      const name = (id?: string | null) => (id ? String(s.items.find((other) => other.id === id)?.value ?? "?") : "null");
      facts.push({ id: `tree-${item.id}`, label: `Node ${item.value} at ${item.address}`, value: `left ${name(item.left)} · right ${name(item.right)}`, entityId: item.id });
    }
    if (kind === "linked-list") facts.push({ id: `node-${item.address}`, label: `${item.detached ? "Unlinked node" : "Node"} at ${item.address}`, value: `${item.value} → ${item.next ?? "NULL"}`, entityId: item.id });
  });
  return facts;
}

export const dataStructuresAdapter: EngineAdapter<Record<string, string | number>, DataStructureFrameData> = {
  id: "data-structures",
  version: "2.0.0",
  title: "Data structures",
  params: params as never,
  vocabulary: ["array", "index", "slot", "shift", "address", "write", "read", "node", "pointer", "queue", "stack", "bucket", "hash", "vertex", "visit", "bfs", "dfs", "depth", "frontier", "capacity", "grow", "copy", "block", "successor", "child", "leaf", "height", "tree", "compare", "element", "neighbor", "edge", "path", "root", "subtree", "left", "right", "smaller", "larger", "key", "list", "insert", "delet", "search", "collision", "head", "front", "rear", "top", "memory"],
  checkClaims: (text, _facts, trace) => arrayClaims(text, trace),
  build(input) {
    const kind = input.kind as StructureKind;
    const values = typeof input.values === "string" ? parseValues(input.values) : undefined;
    const capacity = input.capacity === undefined ? undefined : Number(input.capacity);
    const simulation = buildDataStructureSimulation({ kind, operation: input.operation as never, value: Number(input.value), index: Number(input.index), values, capacity });
    const frames = simulation.frames.map((frame) => ({
      id: frame.id,
      title: frame.title,
      narration: frame.detail,
      technical: frame.code,
      chapter: frame.action,
      facts: factsFor(kind, frame),
      focus: frame.snapshot.focusIds,
      entities: entitiesFor(kind, frame.snapshot),
      durationMs: 1250,
      invariant: structureInfo[kind].invariant,
      data: { frame, kind, operation: String(input.operation) },
    }));
    const final = simulation.frames.at(-1)!;
    const extra = simulation.outcome ?? {};
    const status = String(extra.status ?? "done");
    return {
      frames,
      outcome: {
        ...extra,
        status,
        verdict: status === "found" && "dequeues" in extra ? `found-${extra.dequeues}` : status,
        writes: final.metrics.writes,
        reads: final.metrics.reads,
        comparisons: final.metrics.comparisons,
        pointerChanges: final.metrics.pointerChanges,
        length: final.snapshot.items.filter((item) => !item.detached).length,
        result: simulation.result,
        complexity: simulation.complexity,
        lastFrame: final.id,
      },
      outcomeLabels: {
        result: "Result",
        writes: "Memory writes",
        reads: "Memory reads",
        comparisons: "Comparisons",
        pointerChanges: "Pointer changes",
        complexity: "Cost",
        shifts: "Elements shifted",
        dequeues: "Vertices dequeued",
        pops: "Stack pops",
        copies: "Elements copied while growing",
        capacity: "Capacity after the operation",
        height: "Tree height after the operation",
        distance: "Edges from vertex 1",
      },
    };
  },
};
