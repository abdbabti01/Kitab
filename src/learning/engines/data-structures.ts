import { z } from "zod";
import {
  buildDataStructureSimulation,
  defaultConfig,
  structureInfo,
  structureKinds,
  type SimulationFrame,
  type StructureKind,
  type StructureSnapshot,
} from "../../visual-engine/data-structures/model.ts";
import type { EngineAdapter, Entity, Fact } from "../types.ts";

const params = z
  .object({
    kind: z.enum(structureKinds).default("array"),
    operation: z.string().optional(),
    value: z.unknown().optional(),
    index: z.unknown().optional(),
  })
  .strict()
  .transform((input) => {
    const base = defaultConfig(input.kind);
    const allowed = structureInfo[input.kind].operations.map((operation) => operation.id) as string[];
    const operation = allowed.includes(input.operation ?? "") ? input.operation! : base.operation;
    const value = Number(input.value ?? base.value);
    const index = Number(input.index ?? base.index);
    return {
      kind: input.kind,
      operation,
      value: Number.isFinite(value) ? Math.max(-99, Math.min(99, Math.trunc(value))) : base.value,
      index: Number.isFinite(index) ? Math.max(0, Math.min(5, Math.trunc(index))) : base.index,
    } as Record<string, string | number>;
  });

export type DataStructureFrameData = { frame: SimulationFrame; kind: StructureKind; operation: string };

function allItems(snapshot: StructureSnapshot) {
  return [...snapshot.items, ...(snapshot.buckets?.flatMap((bucket) => bucket.items) ?? [])];
}

function entitiesFor(kind: StructureKind, snapshot: StructureSnapshot): Entity[] {
  return allItems(snapshot).map((item, index) => ({
    id: item.id,
    label: kind === "array" ? `index ${index} (value ${item.value})` : kind === "graph" ? `vertex ${item.value}` : kind === "hash-table" ? `key ${item.value}` : `value ${item.value}`,
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
      { id: "queue", label: "BFS queue (front first)", value: s.frontierValues.join(", ") || "empty" },
    );
  } else if (kind === "hash-table") {
    facts.push({ id: "buckets", label: "Occupied buckets", value: s.buckets!.filter((bucket) => bucket.items.length).map((bucket) => `${bucket.index}:[${bucket.items.map((item) => item.value).join(",")}]`).join(" ") });
  } else {
    facts.push(
      { id: "values", label: "Values in order", value: s.items.map((item) => item.value).join(", ") || "empty" },
      { id: "length", label: "Length", value: s.items.length },
    );
  }
  s.items.forEach((item, index) => {
    if (kind === "array") facts.push({ id: `slot-${index}`, label: `Index ${index} at ${item.address}`, value: item.value, entityId: item.id });
    if (kind === "linked-list") facts.push({ id: `node-${item.address}`, label: `Node at ${item.address}`, value: `${item.value} → ${item.next ?? "NULL"}`, entityId: item.id });
  });
  return facts;
}

export const dataStructuresAdapter: EngineAdapter<Record<string, string | number>, DataStructureFrameData> = {
  id: "data-structures",
  version: "2.0.0",
  title: "Data structures",
  params: params as never,
  vocabulary: ["array", "index", "slot", "shift", "address", "write", "read", "node", "pointer", "queue", "stack", "bucket", "hash", "vertex", "visit", "bfs", "frontier", "tree", "compare", "element", "neighbor", "edge", "path", "root", "subtree", "left", "right", "smaller", "larger", "key", "list", "insert", "delet", "search", "collision", "head", "front", "rear", "top", "memory"],
  build(input) {
    const kind = input.kind as StructureKind;
    const simulation = buildDataStructureSimulation({ kind, operation: input.operation as never, value: Number(input.value), index: Number(input.index) });
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
        length: final.snapshot.items.length,
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
      },
    };
  },
};
