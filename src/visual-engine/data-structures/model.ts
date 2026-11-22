export const structureKinds = [
  "array",
  "linked-list",
  "stack",
  "queue",
  "hash-table",
  "binary-tree",
  "graph",
] as const;

export type StructureKind = (typeof structureKinds)[number];
export type OperationKind =
  | "search"
  | "insert"
  | "delete"
  | "push"
  | "pop"
  | "peek"
  | "enqueue"
  | "dequeue"
  | "bfs"
  | "dfs";

export type StructureItem = {
  id: string;
  value: number;
  address: string;
  next?: string | null;
  /** A linked-list node that nothing reachable from HEAD points to (just allocated, or just unlinked). */
  detached?: boolean;
  /** Tree nodes: the ids of the left and right children (null for an empty branch). */
  left?: string | null;
  right?: string | null;
};

/** An array's backing block: where it starts and how many slots it has. */
export type ArrayBlock = { base: string; capacity: number };

export type Bucket = { index: number; items: StructureItem[] };
export type GraphEdge = { from: number; to: number };

export type StructureSnapshot = {
  items: StructureItem[];
  buckets?: Bucket[];
  edges?: GraphEdge[];
  focusIds: string[];
  visitedValues: number[];
  frontierValues: number[];
  /** The exact elements inspected so far, where values can repeat (array and list scans). Preferred over visitedValues. */
  visitedIds?: string[];
  /** Array only: the block the array refers to; `items` are its live slots (indexes 0 … length − 1). */
  block?: ArrayBlock;
  /**
   * Array only, while growing: the old block and the values it still holds. While it is present, `items`/`block` are
   * the new block being filled; `reachable` is true while the array still refers to the old block, false after the switch.
   */
  oldBlock?: ArrayBlock & { items: StructureItem[]; reachable: boolean };
  /** Tree only: the id of the root node, or null for an empty tree. */
  root?: string | null;
  /** Graph only: whether the frontier is BFS's queue (front first) or DFS's stack (bottom first, top last). */
  frontier?: "queue" | "stack";
};

export type OperationMetrics = {
  comparisons: number;
  reads: number;
  writes: number;
  pointerChanges: number;
};

export type SimulationFrame = {
  id: string;
  title: string;
  action: string;
  detail: string;
  state: string;
  code: string;
  delta: string;
  snapshot: StructureSnapshot;
  metrics: OperationMetrics;
};

export type SimulationConfig = {
  kind: StructureKind;
  operation: OperationKind;
  value: number;
  index: number;
  /** Starting contents; absent means the structure's fixture. Ignored by the graph. */
  values?: number[];
  /** Array only: slots in the backing block. Absent means DEFAULT_CAPACITY; never fewer than the starting length. */
  capacity?: number;
};

export type DataStructureSimulation = {
  config: SimulationConfig;
  frames: SimulationFrame[];
  complexity: string;
  result: string;
  /** Engine-computed facts about the result (for example shifts, status, dequeues). */
  outcome?: Record<string, string | number | boolean>;
};

export const structureInfo: Record<
  StructureKind,
  {
    label: string;
    short: string;
    mentalModel: string;
    invariant: string;
    operations: { id: OperationKind; label: string }[];
    defaults: Pick<SimulationConfig, "operation" | "value" | "index">;
  }
> = {
  array: {
    label: "Array",
    short: "Indexed contiguous slots",
    mentalModel: "The address of index i is base + i × element size.",
    invariant: "Elements occupy consecutive equal-size slots and indexes remain contiguous.",
    operations: [
      { id: "search", label: "Linear search" },
      { id: "insert", label: "Insert at index" },
      { id: "delete", label: "Delete at index" },
    ],
    defaults: { operation: "insert", value: 7, index: 2 },
  },
  "linked-list": {
    label: "Linked list",
    short: "Nodes joined by pointers",
    mentalModel: "Each node owns a value and the address of the next node.",
    invariant: "HEAD reaches every live node once, and the final next pointer is null.",
    operations: [
      { id: "search", label: "Traverse to value" },
      { id: "insert", label: "Insert at index" },
      { id: "delete", label: "Delete value" },
    ],
    defaults: { operation: "delete", value: 6, index: 2 },
  },
  stack: {
    label: "Stack",
    short: "Last in, first out",
    mentalModel: "Only the top item is directly added, removed or inspected.",
    invariant: "Pop always removes the most recently pushed live item.",
    operations: [
      { id: "push", label: "Push" },
      { id: "pop", label: "Pop" },
      { id: "peek", label: "Peek" },
    ],
    defaults: { operation: "push", value: 7, index: 0 },
  },
  queue: {
    label: "Queue",
    short: "First in, first out",
    mentalModel: "New work joins at the rear; old work leaves from the front.",
    invariant: "Dequeue preserves arrival order by removing the oldest live item.",
    operations: [
      { id: "enqueue", label: "Enqueue" },
      { id: "dequeue", label: "Dequeue" },
      { id: "peek", label: "Inspect front" },
    ],
    defaults: { operation: "dequeue", value: 7, index: 0 },
  },
  "hash-table": {
    label: "Hash table",
    short: "Keys mapped to buckets",
    mentalModel: "hash(key) chooses a bucket; equality checks find the key inside it.",
    invariant: "Every key is stored in the bucket selected by the same hash rule.",
    operations: [
      { id: "search", label: "Find key" },
      { id: "insert", label: "Insert key" },
      { id: "delete", label: "Delete key" },
    ],
    defaults: { operation: "insert", value: 17, index: 0 },
  },
  "binary-tree": {
    label: "Binary search tree",
    short: "Ordered branching search",
    mentalModel: "Smaller values go left; larger values go right.",
    invariant: "Every left subtree is smaller and every right subtree is larger than its node.",
    operations: [
      { id: "search", label: "Search" },
      { id: "insert", label: "Insert" },
      { id: "delete", label: "Delete" },
    ],
    defaults: { operation: "search", value: 6, index: 0 },
  },
  graph: {
    label: "Graph",
    short: "Vertices and relationships",
    mentalModel: "Vertices are joined by edges; a traversal follows edges from a start vertex and remembers where it has been.",
    invariant: "A vertex is visited at most once, so a cycle cannot cause endless work.",
    operations: [
      { id: "bfs", label: "Breadth-first search" },
      { id: "dfs", label: "Depth-first search" },
    ],
    defaults: { operation: "bfs", value: 10, index: 0 },
  },
};

export const complexityTable = [
  { structure: "Array", access: "O(1)", search: "O(n)", insert: "O(n)†", remove: "O(n)" },
  { structure: "Linked list", access: "O(n)", search: "O(n)", insert: "O(1)*", remove: "O(1)*" },
  { structure: "Stack / queue", access: "O(1) end", search: "O(n)", insert: "O(1)‡", remove: "O(1)" },
  { structure: "Hash table", access: "—", search: "O(1) avg", insert: "O(1) avg", remove: "O(1) avg" },
  { structure: "Balanced BST", access: "—", search: "O(log n)", insert: "O(log n)", remove: "O(log n)" },
  { structure: "Unbalanced BST", access: "—", search: "O(h), up to O(n)", insert: "O(h)", remove: "O(h)" },
  { structure: "Graph adjacency list", access: "—", search: "O(V + E)", insert: "O(1)", remove: "Depends" },
] as const;

const emptyMetrics = (): OperationMetrics => ({ comparisons: 0, reads: 0, writes: 0, pointerChanges: 0 });
const address = (index: number) => `0x${(4096 + index * 16).toString(16).toUpperCase()}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The starting contents each structure uses when the learner gives none (the missions' fixed fixtures). */
export const fixtures: Record<Exclude<StructureKind, "graph">, readonly number[]> = {
  array: [8, 3, 12, 1, 6],
  "linked-list": [8, 3, 12, 1, 6],
  stack: [8, 3, 12, 1],
  queue: [8, 3, 12, 1],
  "hash-table": [10, 15, 23, 8],
  "binary-tree": [8, 3, 12, 1, 6, 10, 14],
};

/** At most this many starting values, each within ±99, so every scene stays readable. */
export const MAX_VALUES = 8;

/** The array model's block size when none is chosen: room for every fixture, so the missions never grow. */
export const DEFAULT_CAPACITY = 8;
/** The largest block the learner can ask for. A growing array doubles, so it can reach 2 × this. */
export const MAX_CAPACITY = 16;

/** The block size the array starts with: the requested capacity, but never fewer slots than values. */
export function startingCapacity(length: number, capacity?: number) {
  const asked = Number.isFinite(capacity) ? Math.max(1, Math.min(MAX_CAPACITY, Math.trunc(capacity!))) : DEFAULT_CAPACITY;
  return Math.max(asked, length);
}

/**
 * The structure's starting contents: the fixture, or the learner's values truncated to integers in range. Keys of a
 * hash table and values of a BST are unique, so a repeated value is dropped (inserting it again would change nothing).
 */
export function startingValues(kind: Exclude<StructureKind, "graph">, values?: readonly number[]): number[] {
  if (!values) return [...fixtures[kind]];
  const clean = values.filter(Number.isFinite).map((value) => Math.max(-99, Math.min(99, Math.trunc(value))));
  const unique = kind === "hash-table" || kind === "binary-tree" ? [...new Set(clean)] : clean;
  return unique.slice(0, MAX_VALUES);
}

function items(values: number[], prefix = "item"): StructureItem[] {
  return values.map((value, index) => ({ id: `${prefix}-${index}`, value, address: address(index) }));
}

/** Array slots hold 4-byte integers: address(i) = base + i × 4, with the first block at 0x1000. */
export const arrayAddress = (index: number, base = 0x1000) => `0x${(base + index * 4).toString(16).toUpperCase()}`;
/** Where a grown array's new block starts: clear of any first block (at most 16 slots × 4 bytes). */
const GROWN_BASE = 0x2000;

function arrayItems(values: number[], base = 0x1000): StructureItem[] {
  return values.map((value, index) => ({
    id: `array-${index}`,
    value,
    address: arrayAddress(index, base),
  }));
}

const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`;

/** A deep copy of a snapshot with a patch applied. Optional fields stay absent rather than present-but-undefined. */
function snapshot(source: StructureSnapshot, patch: Partial<StructureSnapshot> = {}): StructureSnapshot {
  const old = "oldBlock" in patch ? patch.oldBlock : source.oldBlock;
  const block = patch.block ?? source.block;
  const copy: StructureSnapshot = {
    ...source,
    ...patch,
    items: (patch.items ?? source.items).map((item) => ({ ...item })),
    buckets: (patch.buckets ?? source.buckets)?.map((bucket) => ({
      index: bucket.index,
      items: bucket.items.map((item) => ({ ...item })),
    })),
    edges: (patch.edges ?? source.edges)?.map((edge) => ({ ...edge })),
    focusIds: [...(patch.focusIds ?? source.focusIds)],
    visitedValues: [...(patch.visitedValues ?? source.visitedValues)],
    frontierValues: [...(patch.frontierValues ?? source.frontierValues)],
    visitedIds: (patch.visitedIds ?? source.visitedIds)?.slice(),
    block: block && { ...block },
    oldBlock: old && { ...old, items: old.items.map((item) => ({ ...item })) },
  };
  for (const key of ["visitedIds", "block", "oldBlock", "frontier", "root", "buckets", "edges"] as const) if (copy[key] === undefined) delete copy[key];
  return copy;
}

function makeFrame(
  frames: SimulationFrame[],
  title: string,
  action: string,
  detail: string,
  state: string,
  code: string,
  delta: string,
  current: StructureSnapshot,
  metrics: OperationMetrics,
) {
  frames.push({
    id: `frame-${frames.length}`,
    title,
    action,
    detail,
    state,
    code,
    delta,
    snapshot: snapshot(current),
    metrics: { ...metrics },
  });
}

function arraySimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const values = startingValues("array", config.values);
  const length = values.length;
  let base = 0x1000;
  let capacity = startingCapacity(length, config.capacity);
  const view = (focusIds: string[], extra: Partial<StructureSnapshot> = {}): StructureSnapshot => ({
    items: arrayItems(values, base), block: { base: hex(base), capacity }, focusIds, visitedValues: [], frontierValues: [], ...extra,
  });
  let current = view([]);
  const spare = capacity - length;
  makeFrame(
    frames,
    "Read the array layout",
    "INITIALIZE",
    (length ? `${plural(length, "integer")} occupy adjacent four-byte slots. Indexes identify positions, not values.` : "The array is empty: its length is 0, so no index holds a value yet.")
      + ` The block has room for ${plural(capacity, "element")} (its capacity); ${spare ? `${plural(spare, "slot")} after the last element ${spare === 1 ? "is" : "are"} reserved but not yet part of the array` : "every slot is in use"}.`,
    length ? "Array ready" : "Array empty",
    `base = 0x1000 · length = ${length} · capacity = ${capacity}`,
    "No memory changed",
    current,
    metrics,
  );

  if (config.operation === "search") {
    let found = -1;
    for (let index = 0; index < length; index += 1) {
      metrics.reads += 1;
      metrics.comparisons += 1;
      current = snapshot(current, { focusIds: [`array-${index}`], visitedValues: values.slice(0, index + 1), visitedIds: values.slice(0, index + 1).map((_, i) => `array-${i}`) });
      const match = values[index] === config.value;
      makeFrame(frames, match ? "Target found" : `Compare index ${index}`, "READ + COMPARE", `Read ${values[index]} from ${arrayAddress(index)} and compare it with ${config.value}.`, match ? `Found at index ${index}` : "Continue right", `array[${index}] === ${config.value}`, match ? "Search terminates" : "One more slot inspected", current, metrics);
      if (match) { found = index; break; }
    }
    if (found < 0) {
      current = snapshot(current, { focusIds: [] });
      makeFrame(frames, "Reach the end", "RETURN NOT FOUND", length ? "Every live slot was inspected, so the target is not present. Slots beyond the length are never read: they are not part of the array." : "There are no slots to inspect, so the target is not present.", "Not found", "return -1", "No memory changed", current, metrics);
    }
    return { config, frames, complexity: "O(n) worst-case", result: found < 0 ? `${config.value} is absent` : `${config.value} found at index ${found}`, outcome: { status: found < 0 ? "absent" : "found", index: found } };
  }

  // Delete may name 0 … length − 1; insert may name 0 … length (length appends). Anything else is refused, not clamped.
  const last = config.operation === "delete" ? length - 1 : length;
  if (config.index > last) {
    makeFrame(
      frames,
      "Index out of range",
      "REJECT INDEX",
      config.operation === "delete"
        ? length ? `Valid indexes for a delete are 0 to ${last}. Index ${config.index} holds no element, so nothing is removed.` : "The array is empty, so there is no element to delete."
        : `An insert may target index 0 to ${length} (index ${length} appends). Index ${config.index} would leave a gap, so nothing is written.`,
      "Array unchanged",
      `${config.index} > ${last} → reject`,
      "No memory changed",
      current,
      metrics,
    );
    return { config, frames, complexity: "O(1) to check the index", result: `Index ${config.index} is out of range`, outcome: { status: "invalid-index", shifts: 0 } };
  }

  const at = config.index;
  let shifts = 0;
  if (config.operation === "delete") {
    const removed = values[at];
    for (let index = at; index < values.length - 1; index += 1) {
      metrics.reads += 1;
      metrics.writes += 1;
      shifts += 1;
      values[index] = values[index + 1];
      current = view([`array-${index}`]);
      makeFrame(frames, `Shift ${values[index]} left`, "READ + WRITE", `Copy the value from index ${index + 1} into index ${index} to close the gap.`, "Gap moves right", `array[${index}] = array[${index + 1}]`, `1 read · 1 write`, current, metrics);
    }
    values.pop();
    metrics.writes += 1;
    current = view([]);
    makeFrame(frames, "Reduce the logical length", "UPDATE LENGTH", `The final slot is excluded from the array's logical range. The capacity stays ${capacity}: the block is not shrunk, so the slot is spare again.`, `Length = ${values.length}`, "length -= 1", `Removed ${removed}`, current, metrics);
    return { config, frames, complexity: "O(n) because later elements shift", result: `Removed ${removed} from index ${at}`, outcome: { status: "removed", shifts } };
  }

  // Insert. A full block is first replaced by one twice the size: allocate, copy every element, switch the reference.
  let copies = 0;
  if (length === capacity) {
    const oldBase = base;
    const oldCapacity = capacity;
    const oldItems = arrayItems(values, oldBase);
    makeFrame(frames, "The block is full", "CHECK CAPACITY", `Length ${length} equals capacity ${capacity}: there is no reserved slot after the last element, and the memory right after the block may belong to something else. The array must move to a bigger block before it can make room.`, "Growth needed", "length === capacity → grow", "No memory changed", current, metrics);
    base = GROWN_BASE;
    capacity = oldCapacity * 2;
    const filled: number[] = [];
    const growing = (focusIds: string[], reachable = true): StructureSnapshot => ({
      items: arrayItems(filled, base), block: { base: hex(base), capacity }, focusIds, visitedValues: [], frontierValues: [],
      oldBlock: { base: hex(oldBase), capacity: oldCapacity, items: oldItems, reachable },
    });
    current = growing([]);
    makeFrame(frames, `Allocate a block of ${capacity}`, "ALLOCATE", `A new, empty block with room for ${capacity} elements (double the old capacity) is allocated at ${hex(base)}. The array still refers to the old block at ${hex(oldBase)}.`, "Two blocks exist", `newBlock = allocate(${capacity})`, "1 block allocated", current, metrics);
    for (let index = 0; index < length; index += 1) {
      metrics.reads += 1;
      metrics.writes += 1;
      copies += 1;
      filled.push(values[index]);
      current = growing([`array-${index}`]);
      makeFrame(frames, `Copy ${values[index]} to the new block`, "READ + WRITE", `Read index ${index} from ${arrayAddress(index, oldBase)} and write it to ${arrayAddress(index, base)}. Every element is copied once, in order.`, `${copies} of ${length} copied`, `newBlock[${index}] = oldBlock[${index}]`, "1 read · 1 write", current, metrics);
    }
    metrics.writes += 1;
    metrics.pointerChanges += 1;
    current = growing([], false);
    makeFrame(frames, "Point the array at the new block", "WRITE REFERENCE", `The array's reference changes from ${hex(oldBase)} to ${hex(base)}. Nothing refers to the old block any more: it is unreachable. A garbage-collected runtime (.NET, Java, Python) may reclaim it later; C++'s std::vector frees it immediately. Kitab does not simulate reclamation.`, `Capacity ${oldCapacity} → ${capacity}`, "array.block = newBlock", "1 reference write", current, metrics);
  }

  for (let index = length; index > at; index -= 1) {
    metrics.reads += 1;
    metrics.writes += 1;
    shifts += 1;
    values[index] = values[index - 1];
    current = view([`array-${index - 1}`, `array-${index}`]);
    makeFrame(frames, `Shift ${values[index]} right`, "READ + WRITE", `Copy index ${index - 1} into index ${index}; the original value remains until the final write.`, "Free slot moves left", `array[${index}] = array[${index - 1}]`, "One element shifted", current, metrics);
  }
  values[at] = config.value;
  // The new value and the length are two stores.
  metrics.writes += 2;
  current = view([`array-${at}`]);
  makeFrame(frames, `Write ${config.value}`, "WRITE", `Store the new value in the open slot and increase the logical length (capacity ${capacity}).`, `Inserted at index ${at}`, `array[${at}] = ${config.value} · length += 1`, `Length ${length} → ${length + 1}`, current, metrics);
  const complexity = copies
    ? "O(n): this insert grew the block and copied every element. Appends stay amortized O(1), because doubling makes growth rare."
    : shifts
      ? "O(n) because later elements shift"
      : "O(1) for this append: a spare slot and nothing to shift. Amortized O(1) appends; O(n) when the block must grow.";
  return { config, frames, complexity, result: `Inserted ${config.value} at index ${at}${copies ? ` after growing the capacity to ${capacity}` : ""}`, outcome: { status: "inserted", shifts, copies, capacity } };
}

function linkedItems(values: number[]): StructureItem[] {
  return values.map((value, index) => ({
    id: `node-${index}`,
    value,
    address: address(index * 3 + 1),
    next: index < values.length - 1 ? address((index + 1) * 3 + 1) : null,
  }));
}

function linkedSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  let nodes = linkedItems(startingValues("linked-list", config.values));
  // Reachable nodes in list order, then any node that nothing points to yet (or any more).
  const view = (focusIds: string[], visitedValues: number[] = [], detached: StructureItem[] = []): StructureSnapshot => ({
    items: [...nodes, ...detached.map((node) => ({ ...node, detached: true }))],
    focusIds,
    visitedValues,
    frontierValues: [],
    // The walk visits a prefix of the list, so the exact nodes are the first visitedValues.length ones.
    ...(visitedValues.length ? { visitedIds: nodes.slice(0, visitedValues.length).map((node) => node.id) } : {}),
  });
  let current = view([]);
  const count = nodes.length;
  makeFrame(frames, "Start from HEAD", "READ HEAD", count ? "The list stores only the address of its first node. Nodes do not need adjacent addresses." : "HEAD is NULL: the list has no nodes.", `HEAD → ${nodes[0]?.address ?? "NULL"}`, "current = HEAD", "No node changed", current, metrics);

  if (config.operation === "insert") {
    const at = config.index;
    if (at > count) {
      makeFrame(frames, "Position out of range", "REJECT POSITION", `Positions 0 to ${count} are valid (${count} links after the last node). Position ${at} has no predecessor, so nothing changes.`, "List unchanged", `${at} > ${count} → reject`, "No pointer changed", current, metrics);
      return { config, frames, complexity: "O(n) to reach the position", result: `Position ${at} is out of range`, outcome: { status: "invalid-index" } };
    }
    for (let index = 0; index < at; index += 1) {
      metrics.reads += 1;
      current = view([nodes[index].id], nodes.slice(0, index + 1).map((node) => node.value));
      const reached = index === at - 1;
      makeFrame(frames, `Walk to node ${nodes[index].value}`, "FOLLOW POINTER", `Read the next pointer stored at ${nodes[index].address}. Position ${at} is reached by following pointers from HEAD; there is no address arithmetic.`, reached ? "Predecessor found" : `Follow next → ${nodes[index].next ?? "NULL"}`, index === 0 ? "previous = HEAD" : "previous = previous.next", reached ? "Traversal stops" : "1 pointer read", current, metrics);
    }
    const fresh: StructureItem = { id: "node-new", value: config.value, address: "0x1FF0", next: null };
    metrics.writes += 1;
    current = view([fresh.id], [], [fresh]);
    makeFrame(frames, `Allocate a node for ${config.value}`, "ALLOCATE", `A new node at 0x1FF0 stores ${config.value}. Nothing points to it yet, so it is not part of the list.`, "New node not yet reachable", `node = new Node(${config.value})`, "1 node allocated · 1 value write", current, metrics);

    const successor = nodes[at];
    fresh.next = successor?.address ?? null;
    metrics.writes += 1;
    metrics.pointerChanges += 1;
    current = view(successor ? [fresh.id, successor.id] : [fresh.id], [], [fresh]);
    makeFrame(frames, "Point the new node at its successor", "WRITE POINTER", successor ? `The new node's next pointer is set to ${successor.address} (node ${successor.value}) first, so the rest of the list stays reachable when the link before it is redirected.` : "The new node will be the last node, so its next pointer is NULL.", `New node → ${fresh.next ?? "NULL"}`, at === 0 ? "node.next = HEAD" : "node.next = previous.next", "1 pointer write", current, metrics);

    const predecessor = nodes[at - 1];
    const old = predecessor ? predecessor.next : nodes[0]?.address ?? null;
    if (predecessor) predecessor.next = fresh.address;
    nodes.splice(at, 0, fresh);
    metrics.writes += 1;
    metrics.pointerChanges += 1;
    current = view(predecessor ? [fresh.id, predecessor.id] : [fresh.id]);
    makeFrame(
      frames,
      predecessor ? `Redirect node ${predecessor.value}` : "Redirect HEAD",
      "WRITE POINTER",
      predecessor
        ? `Node ${predecessor.value}'s next pointer changes from ${old ?? "NULL"} to 0x1FF0. No existing node moved in memory.`
        : `HEAD changes from ${old ?? "NULL"} to 0x1FF0.${old ? " The old first node is still reachable through the new node." : ""}`,
      `Inserted at position ${at}`,
      predecessor ? "previous.next = node" : "HEAD = node",
      "1 pointer write",
      current,
      metrics,
    );
    return { config, frames, complexity: "O(n) to reach the position · O(1) to link", result: `Inserted ${config.value} at position ${at}`, outcome: { status: "inserted" } };
  }

  let found = -1;
  for (let index = 0; index < count; index += 1) {
    metrics.reads += 2;
    metrics.comparisons += 1;
    const match = nodes[index].value === config.value;
    current = view([nodes[index].id], nodes.slice(0, index + 1).map((node) => node.value));
    makeFrame(frames, match ? `Found ${config.value}` : `Visit node ${nodes[index].value}`, "READ + COMPARE", `Read the value and next pointer stored at ${nodes[index].address}: ${nodes[index].value} ${match ? "equals" : "is not"} ${config.value}.`, match ? `Found at position ${index}` : `Follow next → ${nodes[index].next ?? "NULL"}`, `current.value === ${config.value}`, match ? "Traversal stops" : "Two fields read", current, metrics);
    if (match) { found = index; break; }
  }
  if (found < 0) {
    current = view([]);
    makeFrame(frames, "Reach NULL", "RETURN NOT FOUND", count ? "The last next pointer is NULL, so no later node can hold the target." : "HEAD is NULL, so there is nothing to search.", config.operation === "delete" ? "List unchanged" : "Not found", "current === NULL", "No pointer changed", current, metrics);
    return { config, frames, complexity: "O(n) traversal", result: `${config.value} is absent`, outcome: { status: "absent" } };
  }
  if (config.operation === "search") return { config, frames, complexity: "O(n) traversal", result: `${config.value} found after ${found + 1} node visits`, outcome: { status: "found", index: found } };

  const target = nodes[found];
  const predecessor = nodes[found - 1];
  if (predecessor) predecessor.next = target.next ?? null;
  nodes = nodes.filter((node) => node !== target);
  metrics.writes += 1;
  metrics.pointerChanges += 1;
  current = view(predecessor ? [predecessor.id, target.id] : [target.id], [], [target]);
  makeFrame(
    frames,
    predecessor ? `Bypass node ${config.value}` : "Move HEAD past the first node",
    "WRITE POINTER",
    predecessor
      ? `Node ${predecessor.value}'s next pointer changes from ${target.address} to ${target.next ?? "NULL"}, skipping node ${config.value}. That is the only write.`
      : `HEAD changes from ${target.address} to ${target.next ?? "NULL"}. That is the only write.`,
    "Node unlinked",
    predecessor ? "previous.next = current.next" : "HEAD = HEAD.next",
    "1 pointer write",
    current,
    metrics,
  );
  current = view(predecessor ? [predecessor.id] : nodes[0] ? [nodes[0].id] : []);
  makeFrame(frames, `Node ${config.value} is unreachable`, "RELEASE", `No pointer from HEAD reaches ${target.address} any more, so the node has left the list. In a garbage-collected runtime (.NET, Java, Python) an unreachable object becomes eligible for collection and may be reclaimed later; in C the program would call free(). Kitab does not simulate memory reclamation.`, `Length = ${nodes.length}`, "// node unreachable", "No further writes", current, metrics);
  return { config, frames, complexity: "O(n) to find · O(1) to unlink", result: `Removed ${config.value}`, outcome: { status: "removed", index: found } };
}

function linearEndSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const isStack = config.kind === "stack";
  const prefix = config.kind;
  // Each element keeps its id while it is stored, so a dequeue moves FRONT instead of relabelling every element.
  const list = items(startingValues(isStack ? "stack" : "queue", config.values), prefix);
  const view = (focusIds: string[]): StructureSnapshot => ({ items: list.map((item) => ({ ...item })), focusIds, visitedValues: [], frontierValues: [] });
  let current = view([]);
  const ends = () => isStack
    ? `TOP = ${list.at(-1)?.value ?? "none"}`
    : list.length ? `FRONT = ${list[0].value} · REAR = ${list.at(-1)!.value}` : "FRONT = REAR = none";
  makeFrame(frames, isStack ? "Locate TOP" : "Locate FRONT and REAR", "READ END MARKERS", list.length ? isStack ? "TOP identifies the only directly accessible element." : "FRONT identifies the next removal; REAR identifies where new work joins." : `The ${config.kind} is empty.`, ends(), isStack ? "top = length - 1" : "front = 0 · rear = length - 1", "No item changed", current, metrics);

  if (config.operation === "push" || config.operation === "enqueue") {
    const added = { id: `${prefix}-new`, value: config.value, address: address(list.length) };
    list.push(added);
    // One store of the value, one update of the end marker.
    metrics.writes += 2;
    current = view([added.id]);
    makeFrame(frames, `${isStack ? "Push" : "Enqueue"} ${config.value}`, isStack ? "WRITE AT TOP" : "WRITE AT REAR", isStack ? "Write the value into the slot above TOP, then move TOP to it. Nothing below it moves." : "Write the value into the slot after REAR, then move REAR to it. Nothing ahead of it moves.", ends(), `${isStack ? "stack.push" : "queue.enqueue"}(${config.value})`, "1 value write · 1 marker update", current, metrics);
    return { config, frames, complexity: "O(1) amortized", result: `${config.value} added at the ${isStack ? "top" : "rear"}`, outcome: { status: "added" } };
  }
  const remove = config.operation === "pop" || config.operation === "dequeue";
  if (!list.length) {
    makeFrame(frames, `Nothing to ${remove ? config.operation : "read"}`, "UNDERFLOW", `The ${config.kind} is empty, so there is no ${isStack ? "top" : "front"} element. Libraries either raise an error or return an empty marker such as undefined or null; Kitab stops without changing anything.`, `${isStack ? "Stack" : "Queue"} unchanged`, `length === 0 → underflow`, "No item changed", current, metrics);
    return { config, frames, complexity: "O(1)", result: `The ${config.kind} is empty`, outcome: { status: "empty" } };
  }
  const target = isStack ? list.at(-1)! : list[0];
  metrics.reads += 1;
  current = view([target.id]);
  makeFrame(frames, remove ? `Read ${target.value} before removal` : `Inspect ${target.value}`, "READ END", "The access rule chooses the element; no scan through the collection is required.", `Selected value ${target.value}`, isStack ? "value = items[top]" : "value = items[front]", "1 read", current, metrics);
  if (!remove) return { config, frames, complexity: "O(1)", result: `Read ${target.value} without removing it`, outcome: { status: "read" } };
  if (isStack) list.pop();
  else list.shift();
  metrics.writes += 1;
  current = view(list.length ? [isStack ? list.at(-1)!.id : list[0].id] : []);
  makeFrame(frames, `Remove ${target.value}`, "MOVE END MARKER", "The logical boundary moves past the removed element. Remaining order is preserved and no element moves.", list.length ? ends() : `The ${config.kind} is now empty`, isStack ? "top -= 1" : "front += 1", "1 boundary update", current, metrics);
  return { config, frames, complexity: "O(1)", result: `Removed ${target.value} from the ${isStack ? "top" : "front"}`, outcome: { status: "removed" } };
}

const BUCKETS = 7;
const bucketOf = (key: number) => ((key % BUCKETS) + BUCKETS) % BUCKETS;

function hashBuckets(entries: StructureItem[]): Bucket[] {
  const buckets = Array.from({ length: BUCKETS }, (_, index) => ({ index, items: [] as StructureItem[] }));
  for (const entry of entries) buckets[bucketOf(entry.value)].items.push(entry);
  return buckets;
}

function hashSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  // Keys are unique, so a key's id and entry address stay the same whatever else is inserted or deleted.
  let entries: StructureItem[] = startingValues("hash-table", config.values).map((value, index) => ({ id: `key-${value}`, value, address: address(index * 2 + 1) }));
  const bucketIndex = bucketOf(config.value);
  const complexity = "O(1) average · O(n) worst-case";
  let current: StructureSnapshot = { items: [], buckets: hashBuckets(entries), focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Compute the bucket", "HASH", `The deterministic rule ${config.value} mod 7 maps the key to bucket ${bucketIndex}.`, `bucket = ${bucketIndex}`, `index = hash(${config.value}) % 7`, "No bucket changed", current, metrics);
  const chain = current.buckets![bucketIndex].items;
  let match: StructureItem | undefined;
  for (const entry of chain) {
    metrics.reads += 1;
    metrics.comparisons += 1;
    current = snapshot(current, { focusIds: [entry.id], visitedValues: [...current.visitedValues, entry.value] });
    const equal = entry.value === config.value;
    makeFrame(frames, `Compare key ${entry.value}`, "CHECK COLLISION CHAIN", `Bucket ${bucketIndex} can contain multiple keys, so equality—not only the hash—decides whether this is the target.`, equal ? "Key matched" : "Collision: keep checking", `${entry.value} === ${config.value}`, equal ? "Search terminates" : "1 collision inspected", current, metrics);
    if (equal) { match = entry; break; }
  }

  if (config.operation === "search") {
    if (match) return { config, frames, complexity, result: `${config.value} found in bucket ${bucketIndex}`, outcome: { status: "found", bucket: bucketIndex } };
    makeFrame(frames, "Finish the bucket chain", "RETURN NOT FOUND", chain.length ? "Every key in the selected bucket was compared, so the requested key is absent." : "The selected bucket is empty, so the key is absent without a single comparison.", "Key not found", "return undefined", "No bucket changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} is absent from bucket ${bucketIndex}`, outcome: { status: "absent", bucket: bucketIndex } };
  }
  if (config.operation === "delete") {
    if (!match) {
      makeFrame(frames, "Keep the table unchanged", "DELETE MISSED", "The selected bucket contains no matching key, so deletion performs no write.", "Key not found", "return false", "No bucket changed", current, metrics);
      return { config, frames, complexity, result: `${config.value} is absent`, outcome: { status: "absent", bucket: bucketIndex } };
    }
    entries = entries.filter((entry) => entry !== match);
    metrics.writes += 1;
    current = { items: [], buckets: hashBuckets(entries), focusIds: [], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Unlink key ${config.value}`, "DELETE ENTRY", "Remove only the matching key from its bucket chain; colliding keys remain reachable at their own addresses.", `Bucket ${bucketIndex} updated`, `bucket.remove(${config.value})`, "1 bucket-chain write", current, metrics);
    return { config, frames, complexity, result: `Removed ${config.value} from bucket ${bucketIndex}`, outcome: { status: "removed", bucket: bucketIndex } };
  }
  if (match) {
    makeFrame(frames, "Key already present", "NO DUPLICATE", `${config.value} is already stored in bucket ${bucketIndex}. A hash table holds each key once, so this insert writes nothing. (A map would replace the key's value instead; Kitab stores keys only.)`, "Table unchanged", "return false // already present", "No bucket changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} is already in bucket ${bucketIndex}`, outcome: { status: "duplicate", bucket: bucketIndex } };
  }
  const inserted: StructureItem = { id: `key-${config.value}`, value: config.value, address: address(entries.length * 2 + 1) };
  entries = [...entries, inserted];
  metrics.writes += 1;
  current = { items: [], buckets: hashBuckets(entries), focusIds: [inserted.id], visitedValues: [], frontierValues: [] };
  makeFrame(frames, chain.length ? "Append after a collision" : "Store in the empty bucket", "WRITE ENTRY", chain.length ? "A collision placed the key in an occupied bucket, so separate chaining keeps both keys reachable in that bucket." : "The selected bucket has no existing chain.", `Key stored in bucket ${bucketIndex}`, `buckets[${bucketIndex}].append(${config.value})`, `1 write · load factor ${entries.length}/7`, current, metrics);
  return { config, frames, complexity, result: `Inserted ${config.value} in bucket ${bucketIndex}`, outcome: { status: "inserted", bucket: bucketIndex } };
}

type TreeNode = { id: string; value: number; address: string; left: string | null; right: string | null };

/** Height in edges of the longest root-to-leaf path: −1 for an empty tree, 0 for a single node. */
export function treeHeight(items: StructureItem[], root: string | null | undefined): number {
  const byId = new Map(items.map((item) => [item.id, item]));
  const height = (id: string | null | undefined): number => {
    const node = id ? byId.get(id) : undefined;
    return node ? 1 + Math.max(height(node.left), height(node.right)) : -1;
  };
  return height(root);
}

function treeSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const values = startingValues("binary-tree", config.values);
  const complexity = "O(h): O(log n) when balanced · O(n) when skewed (this tree never rebalances)";
  // Nodes keep their id and address for as long as they are in the tree; links are child ids, root is the root's id.
  const nodes: TreeNode[] = [];
  let root: string | null = null;
  const node = (id: string | null) => (id ? nodes.find((n) => n.id === id) : undefined);
  const attach = (value: number, id: string, addressIndex: number) => {
    const fresh: TreeNode = { id, value, address: address(addressIndex), left: null, right: null };
    let parent = node(root);
    if (!parent) root = id;
    while (parent) {
      const side = value < parent.value ? "left" : "right";
      if (!parent[side]) { parent[side] = id; break; }
      parent = node(parent[side]);
    }
    nodes.push(fresh);
  };
  values.forEach((value, index) => attach(value, `tree-${index}`, index));
  let pathIds: string[] = [];
  const view = (focusIds: string[]): StructureSnapshot => ({
    items: nodes.map((n) => ({ ...n })), root, focusIds, visitedValues: pathIds.map((id) => node(id)?.value ?? NaN).filter(Number.isFinite), visitedIds: [...pathIds], frontierValues: [],
  });
  let current = view([]);
  const height = () => treeHeight(nodes, root);
  makeFrame(frames, "Begin at the root", "READ ROOT", values.length ? `The root is the entry point. Ordering lets each comparison discard an entire subtree. This tree's height is ${height()} (its longest root-to-leaf path has ${height() + 1} nodes), so a search makes at most ${height() + 1} comparisons.` : "The tree is empty: root is null.", values.length ? `Current node = ${node(root)!.value}` : "root = null", "current = root", "No node changed", current, metrics);

  // The ordered walk from the root: compare, then go left or right, until a match or a null branch.
  let parent: TreeNode | undefined;
  let at = node(root);
  while (at) {
    metrics.reads += 1;
    metrics.comparisons += 1;
    pathIds.push(at.id);
    current = view([at.id]);
    const matched = at.value === config.value;
    const side = config.value < at.value ? "left" : "right";
    makeFrame(frames, matched ? `Match ${at.value}` : `Compare with ${at.value}`, "COMPARE", matched ? "The target equals the current node." : `${config.value} is ${config.value < at.value ? "smaller" : "larger"}, so the ${side === "left" ? "right" : "left"} subtree is discarded.`, matched ? "Target found" : `Move ${side}`, `compare(${config.value}, ${at.value})`, matched ? "Search terminates" : "One subtree eliminated", current, metrics);
    if (matched) break;
    parent = at;
    at = node(at[side]);
  }
  const target = at;
  const depth = pathIds.length - 1;
  const branch = parent === undefined ? "root" : `${config.value < parent.value ? "left" : "right"} child of ${parent.value}`;

  if (config.operation === "search") {
    if (target) return { config, frames, complexity, result: `${config.value} found in ${pathIds.length} comparisons`, outcome: { status: "found", depth, height: height() } };
    current = view([]);
    makeFrame(frames, "Reach an empty branch", "RETURN NOT FOUND", parent === undefined ? "There is no root, so the value is absent." : `The ${branch} is null. Had ${config.value} been inserted, it would be there, so it is absent.`, "Not found", "current === null", "No node changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} is absent`, outcome: { status: "absent", height: height() } };
  }

  if (config.operation === "insert") {
    if (target) {
      makeFrame(frames, `${config.value} is already in the tree`, "NO DUPLICATE", "A binary search tree holds each value once here, so the insert stops without writing.", "Tree unchanged", "return // already present", "No node changed", current, metrics);
      return { config, frames, complexity, result: `${config.value} already exists`, outcome: { status: "duplicate", height: height() } };
    }
    const id = `tree-${values.length}`;
    attach(config.value, id, values.length);
    metrics.writes += 1;
    metrics.pointerChanges += 1;
    current = view([id]);
    makeFrame(frames, `Attach ${config.value} as the ${branch}`, "WRITE CHILD POINTER", parent === undefined ? "The empty tree's root pointer now refers to the new node." : `The first missing branch on the ordered path becomes the new node's place; only its parent's child pointer is written. Height is now ${height()}.`, "BST ordering preserved", parent === undefined ? `root = new Node(${config.value})` : `parent.${config.value < parent.value ? "left" : "right"} = new Node(${config.value})`, "1 node allocation · 1 pointer write", current, metrics);
    return { config, frames, complexity, result: `Inserted ${config.value} after ${pathIds.length} comparisons`, outcome: { status: "inserted", depth: pathIds.length, height: height() } };
  }

  // Delete.
  if (!target) {
    current = view([]);
    makeFrame(frames, "Nothing to delete", "DELETE MISSED", parent === undefined ? "The tree is empty, so there is nothing to delete." : `The ${branch} is null, so ${config.value} is not in the tree. Nothing is written.`, "Tree unchanged", "return // not found", "No node changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} is absent`, outcome: { status: "absent", height: height() } };
  }
  const link = (owner: TreeNode | undefined, side: "left" | "right", to: string | null) => {
    if (owner) owner[side] = to;
    else root = to;
    metrics.writes += 1;
    metrics.pointerChanges += 1;
  };
  const sideOf = (owner: TreeNode | undefined, child: TreeNode) => (owner?.left === child.id ? "left" : "right");
  const remove = (gone: TreeNode) => nodes.splice(nodes.indexOf(gone), 1);
  const ownerLabel = (owner: TreeNode | undefined, side: "left" | "right") => (owner ? `node ${owner.value}'s ${side} pointer` : "the root pointer");

  if (!target.left || !target.right) {
    const child = node(target.left ?? target.right);
    const side = sideOf(parent, target);
    link(parent, side, child?.id ?? null);
    remove(target);
    pathIds = pathIds.filter((id) => id !== target.id);
    current = view([...(parent ? [parent.id] : []), ...(child ? [child.id] : [])]);
    makeFrame(
      frames,
      child ? `Link past ${config.value}` : `Unlink leaf ${config.value}`,
      "WRITE CHILD POINTER",
      child
        ? `${config.value} has one child (${child.value}), so ${ownerLabel(parent, side)} now refers to ${child.value} directly. ${child.value}'s whole subtree moves up one level without any node moving in memory, and ordering still holds. Node ${config.value} is no longer reachable from the root.`
        : `${config.value} is a leaf: ${ownerLabel(parent, side)} becomes null. Node ${config.value} is no longer reachable from the root.`,
      `Removed · height ${height()}`,
      parent ? `parent.${side} = ${child ? `node.${target.left ? "left" : "right"}` : "null"}` : `root = ${child ? `root.${target.left ? "left" : "right"}` : "null"}`,
      "1 pointer write",
      current,
      metrics,
    );
    return { config, frames, complexity, result: `Removed ${config.value} (${child ? "one child" : "a leaf"})`, outcome: { status: "removed", case: child ? "one-child" : "leaf", height: height() } };
  }

  // Two children: the in-order successor (smallest value in the right subtree) takes the value's place.
  let successorParent = target;
  let successor = node(target.right)!;
  metrics.reads += 1;
  pathIds.push(successor.id);
  current = view([successor.id]);
  makeFrame(frames, `Step right to ${successor.value}`, "FIND SUCCESSOR", `${config.value} has two children, so no single pointer can bypass it. Its replacement is the in-order successor: the smallest value larger than ${config.value}, which is the leftmost node of its right subtree.`, "Searching right subtree", "successor = node.right", "1 pointer read", current, metrics);
  while (successor.left) {
    successorParent = successor;
    successor = node(successor.left)!;
    metrics.reads += 1;
    pathIds.push(successor.id);
    current = view([successor.id]);
    makeFrame(frames, `Step left to ${successor.value}`, "FIND SUCCESSOR", "Smaller values are to the left, so the walk keeps going left until there is no left child.", `Candidate ${successor.value}`, "successor = successor.left", "1 pointer read", current, metrics);
  }
  const replaced = target.value;
  target.value = successor.value;
  metrics.writes += 1;
  current = view([target.id, successor.id]);
  makeFrame(frames, `Copy ${successor.value} into ${replaced}'s node`, "WRITE VALUE", `The node that held ${replaced} keeps its place, address and both children; only its value becomes ${successor.value}. Ordering still holds: ${successor.value} is larger than everything on the left and the smallest value on the right. The old ${successor.value} node is now a duplicate and is removed next.`, "Value replaced", `node.value = successor.value // ${successor.value}`, "1 value write", current, metrics);
  const side = successorParent === target ? "right" : "left";
  link(successorParent, side, successor.right);
  remove(successor);
  pathIds = pathIds.filter((id) => id !== successor.id);
  current = view([successorParent.id]);
  makeFrame(frames, `Remove the old ${successor.value} node`, "WRITE CHILD POINTER", `The successor has no left child, so it is removed like a node with at most one child: node ${successorParent.value}'s ${side} pointer now refers to ${successor.right ? `${node(successor.right)!.value}` : "null"}. The old node is no longer reachable from the root.`, `Removed · height ${height()}`, `${successorParent === target ? "node" : "successorParent"}.${side} = successor.right`, "1 pointer write", current, metrics);
  return { config, frames, complexity, result: `Removed ${replaced} (two children: replaced by successor ${successor.value})`, outcome: { status: "removed", case: "two-children", height: height() } };
}

/** Undirected fixture with a cycle (1-3-6-10-8-1) and an isolated vertex 15. */
export const graphFixture: Record<number, number[]> = {
  1: [3, 8],
  3: [1, 6],
  8: [1, 10],
  6: [3, 10],
  10: [8, 6, 12],
  12: [10],
  15: [],
};

/** Safety budget for dequeues. It interrupts runaway input; it never decides reachability. */
export const BFS_DEQUEUE_BUDGET = 64;

function graphSimulation(config: SimulationConfig, adjacency = graphFixture, budget = BFS_DEQUEUE_BUDGET): DataStructureSimulation {
  if (config.operation === "dfs") return depthFirst(config, adjacency, budget);
  const vertices = Object.keys(adjacency).map(Number);
  const edges = graphEdges(adjacency);
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const queue = [1];
  const visited = new Set([1]);
  // Edges from vertex 1 along the BFS tree: the first time a vertex is discovered is along a shortest path.
  const distance = new Map([[1, 0]]);
  let current: StructureSnapshot = { items: vertexItems(vertices), edges, focusIds: ["vertex-1"], visitedValues: [1], frontierValues: [1], frontier: "queue" };
  makeFrame(frames, "Seed the frontier", "ENQUEUE START", "Mark vertex 1 visited when it enters the queue. This prevents a cycle from enqueuing it again.", "Queue = [1]", "visited.add(1) · queue.enqueue(1)", "1 vertex discovered", current, metrics);
  let found = false;
  let dequeues = 0;
  while (queue.length && dequeues < budget) {
    const value = queue.shift()!;
    dequeues += 1;
    metrics.reads += 1;
    current = snapshot(current, { focusIds: [`vertex-${value}`], frontierValues: [...queue] });
    makeFrame(frames, `Visit vertex ${value}`, "DEQUEUE", `Remove ${value} from the frontier and inspect its adjacency list: [${adjacency[value].join(", ")}]. It is ${plural(distance.get(value)!, "edge")} from vertex 1.`, value === config.value ? `Target found, ${plural(distance.get(value)!, "edge")} away` : "Inspect neighbors", `current = queue.dequeue()`, "1 vertex read", current, metrics);
    if (value === config.value) { found = true; break; }
    for (const neighbor of adjacency[value]) {
      metrics.comparisons += 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        distance.set(neighbor, distance.get(value)! + 1);
        queue.push(neighbor);
        metrics.writes += 1;
      }
    }
    current = snapshot(current, { visitedValues: [...visited], frontierValues: [...queue], focusIds: queue.map((item) => `vertex-${item}`) });
    makeFrame(frames, `Expand neighbors of ${value}`, "DISCOVER + ENQUEUE", "Only unvisited neighbors join the rear of the queue, preserving increasing distance from the start.", `Queue = [${queue.join(", ")}]`, "for neighbor of adjacency[current]", `${visited.size} visited · ${queue.length} queued`, current, metrics);
  }
  const status = found ? "found" : queue.length ? "interrupted" : vertices.includes(config.value) ? "unreachable" : "absent";
  if (!found) notFound(frames, status, config.value, budget, queue.length, "dequeues", snapshot(current, { focusIds: [] }), metrics);
  const result = status === "found"
    ? `${config.value} reached by breadth-first search, ${plural(distance.get(config.value)!, "edge")} from 1 (a shortest path)`
    : resultFor(status, config.value, budget, "dequeues");
  return { config, frames, complexity: "O(V + E)", result, outcome: { status, dequeues, visited: visited.size, ...(found ? { distance: distance.get(config.value)! } : {}) } };
}

function vertexItems(vertices: number[]): StructureItem[] {
  return vertices.map((value, index) => ({ id: `vertex-${value}`, value, address: address(index) }));
}

function graphEdges(adjacency: Record<number, number[]>): GraphEdge[] {
  return Object.entries(adjacency).flatMap(([from, targets]) =>
    targets.filter((to) => Number(from) < to).map((to) => ({ from: Number(from), to })),
  );
}

function notFound(frames: SimulationFrame[], status: string, target: number, budget: number, left: number, removals: string, current: StructureSnapshot, metrics: OperationMetrics) {
  makeFrame(
    frames,
    status === "interrupted" ? "Stop at the safety budget" : "The frontier is empty",
    status === "interrupted" ? "INTERRUPTED" : "RETURN NOT FOUND",
    status === "interrupted"
      ? `The simulation stopped after ${budget} ${removals} with ${left} vertices still waiting. This is not evidence that the target is unreachable.`
      : status === "unreachable"
        ? `Vertex ${target} exists, but no edge path connects it to vertex 1, so it never entered the frontier.`
        : `Every vertex reachable from 1 was visited and ${target} is not a vertex in this graph.`,
    status === "interrupted" ? "Result unknown" : status === "unreachable" ? "Unreachable" : "Not in graph",
    status === "interrupted" ? "break // budget exhausted" : "return NOT_FOUND",
    "No vertex changed",
    current,
    metrics,
  );
}

function resultFor(status: string, target: number, budget: number, removals: string) {
  return status === "interrupted"
    ? `Stopped after ${budget} ${removals} before deciding whether ${target} is reachable`
    : status === "unreachable"
      ? `${target} is unreachable from 1`
      : `${target} is not in the graph`;
}

/**
 * Iterative depth-first search with an explicit stack. A vertex is marked visited when it is popped, and its
 * unvisited neighbors are pushed in reverse so the first neighbor is explored first (the order a recursive DFS
 * would use). A vertex can sit on the stack twice; the second copy is skipped when popped.
 */
function depthFirst(config: SimulationConfig, adjacency: Record<number, number[]>, budget: number): DataStructureSimulation {
  const vertices = Object.keys(adjacency).map(Number);
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const stack = [1];
  const visited = new Set<number>();
  const order: number[] = [];
  let current: StructureSnapshot = { items: vertexItems(vertices), edges: graphEdges(adjacency), focusIds: ["vertex-1"], visitedValues: [], frontierValues: [1], frontier: "stack" };
  makeFrame(frames, "Push the start vertex", "PUSH START", "Depth-first search keeps a stack of vertices to explore. Vertex 1 is pushed; it is marked visited when it is popped.", "Stack = [1]", "stack.push(1)", "1 vertex pushed", current, metrics);
  let found = false;
  let pops = 0;
  while (stack.length && pops < budget) {
    const value = stack.pop()!;
    pops += 1;
    metrics.reads += 1;
    metrics.comparisons += 1;
    if (visited.has(value)) {
      current = snapshot(current, { focusIds: [`vertex-${value}`], frontierValues: [...stack] });
      makeFrame(frames, `Skip ${value}: already visited`, "POP + SKIP", `${value} was pushed twice (by two different neighbors) and has been visited since, so this copy is discarded.`, `Stack = [${stack.join(", ")}]`, "if (visited.has(current)) continue", "1 pop, nothing visited", current, metrics);
      continue;
    }
    visited.add(value);
    order.push(value);
    current = snapshot(current, { focusIds: [`vertex-${value}`], visitedValues: [...order], frontierValues: [...stack] });
    makeFrame(frames, `Visit vertex ${value}`, "POP + VISIT", `Pop ${value} from the top of the stack and mark it visited. Visit order so far: ${order.join(" → ")}.`, value === config.value ? "Target found" : "Inspect neighbors", "current = stack.pop() · visited.add(current)", "1 vertex visited", current, metrics);
    if (value === config.value) { found = true; break; }
    const pushed: number[] = [];
    for (const neighbor of [...adjacency[value]].reverse()) {
      metrics.comparisons += 1;
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
        pushed.push(neighbor);
        metrics.writes += 1;
      }
    }
    current = snapshot(current, { frontierValues: [...stack], focusIds: [...new Set(pushed)].map((item) => `vertex-${item}`) });
    makeFrame(frames, `Push neighbors of ${value}`, "DISCOVER + PUSH", pushed.length ? `Unvisited neighbors are pushed in reverse order, so ${pushed.at(-1)} (first in the adjacency list) is on top and is explored next: the search goes deep before it goes wide.` : `Every neighbor of ${value} is already visited, so nothing is pushed. The search backtracks to whatever is on top of the stack.`, `Stack = [${stack.join(", ")}]`, "for neighbor of reversed(adjacency[current])", `${visited.size} visited · ${stack.length} on the stack`, current, metrics);
  }
  const status = found ? "found" : stack.length ? "interrupted" : vertices.includes(config.value) ? "unreachable" : "absent";
  if (!found) notFound(frames, status, config.value, budget, stack.length, "pops", snapshot(current, { focusIds: [] }), metrics);
  const result = status === "found" ? `${config.value} reached by depth-first search after visiting ${order.join(" → ")}` : resultFor(status, config.value, budget, "pops");
  return { config, frames, complexity: "O(V + E)", result, outcome: { status, pops, visited: visited.size, order: order.join(",") } };
}

export function buildGraphSearch(config: SimulationConfig, adjacency: Record<number, number[]>, budget = BFS_DEQUEUE_BUDGET) {
  return graphSimulation(config, adjacency, budget);
}

export function buildDataStructureSimulation(config: SimulationConfig): DataStructureSimulation {
  const safeConfig = {
    ...config,
    value: Number.isFinite(config.value) ? Math.trunc(config.value) : 7,
    index: Number.isFinite(config.index) ? Math.max(0, Math.trunc(config.index)) : 0,
  };
  if (safeConfig.kind === "array") return arraySimulation(safeConfig);
  if (safeConfig.kind === "linked-list") return linkedSimulation(safeConfig);
  if (safeConfig.kind === "stack" || safeConfig.kind === "queue") return linearEndSimulation(safeConfig);
  if (safeConfig.kind === "hash-table") return hashSimulation(safeConfig);
  if (safeConfig.kind === "binary-tree") return treeSimulation(safeConfig);
  return graphSimulation(safeConfig);
}

export function defaultConfig(kind: StructureKind): SimulationConfig {
  return { kind, ...structureInfo[kind].defaults };
}
