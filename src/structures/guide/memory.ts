// The conceptual memory table for one Playground step, and what changed since the step before. Pure: derived only
// from the engine's snapshot (or the recursion engine's stack), so it can never show something the engine did not do.
import type { StructureKind, StructureSnapshot } from "../../visual-engine/data-structures/model.ts";
import type { CallFrame } from "../../visual-engine/engines/execution/recursion-engine.ts";

/** One line of the memory table. `key` is stable across steps (an element's id, a marker's name), so diffs line up. */
export type MemoryRow = { key: string; group: string; label: string; value: string };
export type MemoryChange = { key: string; kind: "added" | "changed" | "removed"; label: string; before?: string; after?: string };

const valueOf = (items: StructureSnapshot["items"], id: string | null | undefined) =>
  id ? String(items.find((item) => item.id === id)?.value ?? "?") : "null";

export function structureMemory(kind: StructureKind, s: StructureSnapshot): MemoryRow[] {
  const rows: MemoryRow[] = [];
  const add = (key: string, group: string, label: string, value: string | number) => rows.push({ key, group, label, value: String(value) });
  if (kind === "array") {
    const old = s.oldBlock;
    add("ref", "Variables", "array (reference to its block)", old?.reachable ? old.base : s.block?.base ?? "0x1000");
    // While the array still refers to the old block, its length and capacity are the old block's.
    add("length", "Variables", "length", old?.reachable ? old.items.length : s.items.length);
    if (s.block) add("capacity", "Variables", "capacity", old?.reachable ? old.capacity : s.block.capacity);
    // Slots are keyed by their block, so filling a new block never reads as overwriting the old one.
    const block = (base: string, items: StructureSnapshot["items"], capacity: number, group: string) => {
      items.forEach((item, i) => add(`${base}[${i}]`, group, `[${i}] at ${item.address}`, item.value));
      for (let i = items.length; i < capacity; i++) add(`${base}[${i}]`, group, `[${i}]`, "spare");
    };
    if (old) {
      add(`${old.base}:status`, `Old block at ${old.base}`, "status", old.reachable ? "the array refers to it" : "unreachable: nothing refers to it");
      block(old.base, old.items, old.capacity, `Old block at ${old.base}`);
    }
    const base = s.block?.base ?? "0x1000";
    block(base, s.items, s.block?.capacity ?? s.items.length, old ? `New block at ${base}` : `Block at ${base}`);
  } else if (kind === "linked-list") {
    const live = s.items.filter((item) => !item.detached);
    add("head", "Variables", "HEAD", live[0]?.address ?? "NULL");
    for (const item of s.items) {
      add(`${item.id}:value`, "Nodes (any address)", `node at ${item.address} · value`, item.value);
      add(`${item.id}:next`, "Nodes (any address)", `node at ${item.address} · next`, item.next ?? "NULL");
      add(`${item.id}:reach`, "Nodes (any address)", `node at ${item.address} · reachable from HEAD`, item.detached ? "no" : "yes");
    }
  } else if (kind === "stack" || kind === "queue") {
    add("length", "Variables", "length", s.items.length);
    if (kind === "stack") add("top", "Variables", "TOP", s.items.at(-1)?.value ?? "none (empty)");
    else {
      add("front", "Variables", "FRONT", s.items[0]?.value ?? "none (empty)");
      add("rear", "Variables", "REAR", s.items.at(-1)?.value ?? "none (empty)");
    }
    s.items.forEach((item, i) => add(item.id, "Elements (oldest first)", `position ${i}`, item.value));
  } else if (kind === "hash-table") {
    const keys = s.buckets?.reduce((sum, bucket) => sum + bucket.items.length, 0) ?? 0;
    add("count", "Variables", "keys stored", keys);
    add("load", "Variables", "load factor (keys ÷ buckets)", (keys / (s.buckets?.length || 1)).toFixed(2));
    for (const bucket of s.buckets ?? []) add(`bucket-${bucket.index}`, "Buckets (key mod 7)", `bucket ${bucket.index}`, bucket.items.map((item) => item.value).join(" → ") || "empty");
  } else if (kind === "binary-tree") {
    add("root", "Variables", "root", s.root ? `node ${valueOf(s.items, s.root)}` : "null");
    for (const item of s.items) {
      add(`${item.id}:value`, "Nodes", `node at ${item.address} · value`, item.value);
      add(`${item.id}:links`, "Nodes", `node at ${item.address} · left / right`, `${valueOf(s.items, item.left)} / ${valueOf(s.items, item.right)}`);
    }
  } else {
    add("visited", "Traversal state", s.frontier === "stack" ? "visited (in order)" : "visited set", s.visitedValues.join(", ") || "none");
    add("frontier", "Traversal state", s.frontier === "stack" ? "stack (bottom → top)" : "queue (front → rear)", s.frontierValues.join(", ") || "empty");
    const edges = s.edges ?? [];
    for (const item of s.items) {
      const neighbors = edges.flatMap((e) => (e.from === item.value ? [e.to] : e.to === item.value ? [e.from] : [])).sort((a, b) => a - b);
      add(`adj-${item.value}`, "Adjacency list", `vertex ${item.value}`, neighbors.join(", ") || "no edges");
    }
  }
  return rows;
}

export function recursionMemory(stack: CallFrame[], fn: string): MemoryRow[] {
  const rows: MemoryRow[] = [{ key: "main", group: "Call stack (bottom → top)", label: "main()", value: stack.length ? `waiting for ${fn}(${stack[0].n})` : "running" }];
  stack.forEach((frame, i) => {
    const caller = i === 0 ? "main()" : `${fn}(${stack[i - 1].n})`;
    const status = frame.status === "running" ? "running" : frame.status === "waiting" ? `waiting for ${fn}(${stack[i + 1]?.n})` : `returning ${frame.returnValue}`;
    rows.push({ key: frame.id, group: "Call stack (bottom → top)", label: `${fn}(${frame.n}) · n = ${frame.n} · returns to ${caller}`, value: status });
  });
  return rows;
}

/** Rows added, changed or removed between two steps, matched by key. */
export function memoryChanges(before: MemoryRow[] | null, after: MemoryRow[]): MemoryChange[] {
  if (!before) return [];
  const old = new Map(before.map((row) => [row.key, row]));
  const now = new Map(after.map((row) => [row.key, row]));
  const changes: MemoryChange[] = [];
  for (const row of after) {
    const was = old.get(row.key);
    if (!was) changes.push({ key: row.key, kind: "added", label: row.label, after: row.value });
    else if (was.value !== row.value) changes.push({ key: row.key, kind: "changed", label: row.label, before: was.value, after: row.value });
  }
  for (const row of before) if (!now.has(row.key)) changes.push({ key: row.key, kind: "removed", label: row.label, before: row.value });
  return changes;
}
