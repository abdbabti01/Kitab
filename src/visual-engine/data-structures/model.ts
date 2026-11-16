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
  | "bfs";

export type StructureItem = {
  id: string;
  value: number;
  address: string;
  next?: string | null;
  /** A linked-list node that nothing reachable from HEAD points to (just allocated, or just unlinked). */
  detached?: boolean;
};

export type Bucket = { index: number; items: StructureItem[] };
export type GraphEdge = { from: number; to: number };

export type StructureSnapshot = {
  items: StructureItem[];
  buckets?: Bucket[];
  edges?: GraphEdge[];
  focusIds: string[];
  visitedValues: number[];
  frontierValues: number[];
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
    ],
    defaults: { operation: "search", value: 6, index: 0 },
  },
  graph: {
    label: "Graph",
    short: "Vertices and relationships",
    mentalModel: "Breadth-first search explores every neighbor at the current distance first.",
    invariant: "A vertex enters the visited set once, preventing cycles from causing endless work.",
    operations: [{ id: "bfs", label: "Breadth-first search" }],
    defaults: { operation: "bfs", value: 10, index: 0 },
  },
};

export const complexityTable = [
  { structure: "Array", access: "O(1)", search: "O(n)", insert: "O(n)", remove: "O(n)" },
  { structure: "Linked list", access: "O(n)", search: "O(n)", insert: "O(1)*", remove: "O(1)*" },
  { structure: "Stack / queue", access: "O(1) end", search: "O(n)", insert: "O(1)", remove: "O(1)" },
  { structure: "Hash table", access: "—", search: "O(1) avg", insert: "O(1) avg", remove: "O(1) avg" },
  { structure: "Balanced BST", access: "—", search: "O(log n)", insert: "O(log n)", remove: "O(log n)" },
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

/** Array slots hold 4-byte integers: address(i) = 0x1000 + i × 4. */
export const arrayAddress = (index: number) => `0x${(4096 + index * 4).toString(16).toUpperCase()}`;

function arrayItems(values: number[]): StructureItem[] {
  return values.map((value, index) => ({
    id: `array-${index}`,
    value,
    address: arrayAddress(index),
  }));
}

function snapshot(source: StructureSnapshot, patch: Partial<StructureSnapshot> = {}): StructureSnapshot {
  return {
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
  };
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
  let current: StructureSnapshot = { items: arrayItems(values), focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(
    frames,
    "Read the array layout",
    "INITIALIZE",
    length ? `${plural(length, "integer")} occupy adjacent four-byte slots. Indexes identify positions, not values.` : "The array is empty: its length is 0, so no index holds a value yet.",
    length ? "Array ready" : "Array empty",
    `base = 0x1000 · length = ${length}`,
    "No memory changed",
    current,
    metrics,
  );

  if (config.operation === "search") {
    let found = -1;
    for (let index = 0; index < length; index += 1) {
      metrics.reads += 1;
      metrics.comparisons += 1;
      current = snapshot(current, { focusIds: [`array-${index}`], visitedValues: values.slice(0, index + 1) });
      const match = values[index] === config.value;
      makeFrame(frames, match ? "Target found" : `Compare index ${index}`, "READ + COMPARE", `Read ${values[index]} from ${arrayAddress(index)} and compare it with ${config.value}.`, match ? `Found at index ${index}` : "Continue right", `array[${index}] === ${config.value}`, match ? "Search terminates" : "One more slot inspected", current, metrics);
      if (match) { found = index; break; }
    }
    if (found < 0) {
      current = snapshot(current, { focusIds: [] });
      makeFrame(frames, "Reach the end", "RETURN NOT FOUND", length ? "Every live slot was inspected, so the target is not present." : "There are no slots to inspect, so the target is not present.", "Not found", "return -1", "No memory changed", current, metrics);
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
  if (config.operation === "delete") {
    const removed = values[at];
    for (let index = at; index < values.length - 1; index += 1) {
      metrics.reads += 1;
      metrics.writes += 1;
      values[index] = values[index + 1];
      current = { items: arrayItems(values), focusIds: [`array-${index}`], visitedValues: [], frontierValues: [] };
      makeFrame(frames, `Shift ${values[index]} left`, "READ + WRITE", `Copy the value from index ${index + 1} into index ${index} to close the gap.`, "Gap moves right", `array[${index}] = array[${index + 1}]`, `1 read · 1 write`, current, metrics);
    }
    values.pop();
    metrics.writes += 1;
    current = { items: arrayItems(values), focusIds: [], visitedValues: [], frontierValues: [] };
    makeFrame(frames, "Reduce the logical length", "UPDATE LENGTH", "The unused final slot is excluded from the array's logical range.", `Length = ${values.length}`, "length -= 1", `Removed ${removed}`, current, metrics);
    return { config, frames, complexity: "O(n) because later elements shift", result: `Removed ${removed} from index ${at}`, outcome: { status: "removed", shifts: frames.length - 2 } };
  }

  // Insert. The model assumes the block has a spare slot after the last element (a dynamic array's extra capacity).
  for (let index = length; index > at; index -= 1) {
    metrics.reads += 1;
    metrics.writes += 1;
    values[index] = values[index - 1];
    current = { items: arrayItems(values), focusIds: [`array-${index - 1}`, `array-${index}`], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Shift ${values[index]} right`, "READ + WRITE", `Copy index ${index - 1} into index ${index}; the original value remains until the final write.`, "Free slot moves left", `array[${index}] = array[${index - 1}]`, "One element shifted", current, metrics);
  }
  values[at] = config.value;
  // The new value and the length are two stores.
  metrics.writes += 2;
  current = { items: arrayItems(values), focusIds: [`array-${at}`], visitedValues: [], frontierValues: [] };
  makeFrame(frames, `Write ${config.value}`, "WRITE", "Store the new value in the open slot and increase the logical length.", `Inserted at index ${at}`, `array[${at}] = ${config.value} · length += 1`, `Length ${length} → ${length + 1}`, current, metrics);
  return { config, frames, complexity: "O(n) because later elements shift", result: `Inserted ${config.value} at index ${at}`, outcome: { status: "inserted", shifts: frames.length - 2 } };
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
  makeFrame(frames, `Node ${config.value} is unreachable`, "RELEASE", `No pointer from HEAD reaches ${target.address} any more, so the node has left the list. A garbage-collected language reclaims that memory later; in C the program would call free(). Kitab does not simulate memory reclamation.`, `Length = ${nodes.length}`, "// node unreachable", "No further writes", current, metrics);
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

function bstPath(target: number, values: number[]) {
  type Node = { value: number; left?: Node; right?: Node };
  let root: Node | undefined;
  for (const value of values) {
    if (!root) { root = { value }; continue; }
    let node = root;
    while (true) {
      if (value < node.value) {
        if (!node.left) { node.left = { value }; break; }
        node = node.left;
      } else if (value > node.value) {
        if (!node.right) { node.right = { value }; break; }
        node = node.right;
      } else break;
    }
  }
  const path: number[] = [];
  let node = root;
  while (node) {
    path.push(node.value);
    if (node.value === target) break;
    node = target < node.value ? node.left : node.right;
  }
  return path;
}

function treeSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const values = startingValues("binary-tree", config.values);
  const complexity = "O(h): O(log n) when balanced · O(n) when skewed (this tree never rebalances)";
  let current: StructureSnapshot = { items: items(values, "tree"), focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Begin at the root", "READ ROOT", values.length ? "The root is the entry point. Ordering lets each comparison discard an entire subtree." : "The tree is empty: root is null.", values.length ? `Current node = ${values[0]}` : "root = null", "current = root", "No node changed", current, metrics);
  const path = bstPath(config.value, values);
  path.forEach((value, index) => {
    metrics.reads += 1;
    metrics.comparisons += 1;
    current = snapshot(current, { focusIds: [`tree-${values.indexOf(value)}`], visitedValues: path.slice(0, index + 1) });
    const matched = value === config.value;
    const side = config.value < value ? "left" : "right";
    makeFrame(frames, matched ? `Match ${value}` : `Compare with ${value}`, "COMPARE", matched ? "The target equals the current node." : `${config.value} is ${config.value < value ? "smaller" : "larger"}, so the ${side === "left" ? "right" : "left"} subtree is discarded.`, matched ? "Target found" : `Move ${side}`, `compare(${config.value}, ${value})`, matched ? "Search terminates" : "One subtree eliminated", current, metrics);
  });
  const found = path.at(-1) === config.value;
  const parent = path.at(-1);
  const branch = parent === undefined ? "root" : `${config.value < parent ? "left" : "right"} child of ${parent}`;
  if (config.operation === "search") {
    if (found) return { config, frames, complexity, result: `${config.value} found in ${path.length} comparisons`, outcome: { status: "found", depth: path.length - 1 } };
    current = snapshot(current, { focusIds: [] });
    makeFrame(frames, "Reach an empty branch", "RETURN NOT FOUND", parent === undefined ? "There is no root, so the value is absent." : `The ${branch} is null. Had ${config.value} been inserted, it would be there, so it is absent.`, "Not found", "current === null", "No node changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} is absent`, outcome: { status: "absent" } };
  }
  if (found) {
    makeFrame(frames, `${config.value} is already in the tree`, "NO DUPLICATE", "A binary search tree holds each value once here, so the insert stops without writing.", "Tree unchanged", "return // already present", "No node changed", current, metrics);
    return { config, frames, complexity, result: `${config.value} already exists`, outcome: { status: "duplicate" } };
  }
  values.push(config.value);
  metrics.writes += 1;
  metrics.pointerChanges += 1;
  current = { items: items(values, "tree"), focusIds: [`tree-${values.length - 1}`], visitedValues: path, frontierValues: [] };
  makeFrame(frames, `Attach ${config.value} as the ${branch}`, "WRITE CHILD POINTER", parent === undefined ? "The empty tree's root pointer now refers to the new node." : "The first missing branch on the ordered path becomes the new node's place; only its parent's child pointer is written.", "BST ordering preserved", parent === undefined ? `root = new Node(${config.value})` : `parent.${config.value < parent ? "left" : "right"} = new Node(${config.value})`, "1 node allocation · 1 pointer write", current, metrics);
  return { config, frames, complexity, result: `Inserted ${config.value} after ${path.length} comparisons`, outcome: { status: "inserted", depth: path.length } };
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
  const vertices = Object.keys(adjacency).map(Number);
  const edges = Object.entries(adjacency).flatMap(([from, targets]) =>
    targets.filter((to) => Number(from) < to).map((to) => ({ from: Number(from), to })),
  );
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const queue = [1];
  const visited = new Set([1]);
  let current: StructureSnapshot = { items: vertices.map((value, index) => ({ id: `vertex-${value}`, value, address: address(index) })), edges, focusIds: ["vertex-1"], visitedValues: [1], frontierValues: [1] };
  makeFrame(frames, "Seed the frontier", "ENQUEUE START", "Mark vertex 1 visited when it enters the queue. This prevents a cycle from enqueuing it again.", "Queue = [1]", "visited.add(1) · queue.enqueue(1)", "1 vertex discovered", current, metrics);
  let found = false;
  let dequeues = 0;
  while (queue.length && dequeues < budget) {
    const value = queue.shift()!;
    dequeues += 1;
    metrics.reads += 1;
    current = snapshot(current, { focusIds: [`vertex-${value}`], frontierValues: [...queue] });
    makeFrame(frames, `Visit vertex ${value}`, "DEQUEUE", `Remove ${value} from the frontier and inspect its adjacency list: [${adjacency[value].join(", ")}].`, value === config.value ? "Target found" : "Inspect neighbors", `current = queue.dequeue()`, "1 vertex read", current, metrics);
    if (value === config.value) { found = true; break; }
    for (const neighbor of adjacency[value]) {
      metrics.comparisons += 1;
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
        metrics.writes += 1;
      }
    }
    current = snapshot(current, { visitedValues: [...visited], frontierValues: [...queue], focusIds: queue.map((item) => `vertex-${item}`) });
    makeFrame(frames, `Expand neighbors of ${value}`, "DISCOVER + ENQUEUE", "Only unvisited neighbors join the rear of the queue, preserving increasing distance from the start.", `Queue = [${queue.join(", ")}]`, "for neighbor of adjacency[current]", `${visited.size} visited · ${queue.length} queued`, current, metrics);
  }
  const status = found ? "found" : queue.length ? "interrupted" : vertices.includes(config.value) ? "unreachable" : "absent";
  if (!found) {
    current = snapshot(current, { focusIds: [] });
    makeFrame(
      frames,
      status === "interrupted" ? "Stop at the safety budget" : "The frontier is empty",
      status === "interrupted" ? "INTERRUPTED" : "RETURN NOT FOUND",
      status === "interrupted"
        ? `The simulation stopped after ${budget} dequeues with ${queue.length} vertices still queued. This is not evidence that the target is unreachable.`
        : status === "unreachable"
          ? `Vertex ${config.value} exists, but no edge path connects it to vertex 1, so it never entered the queue.`
          : `Every vertex reachable from 1 was visited and ${config.value} is not a vertex in this graph.`,
      status === "interrupted" ? "Result unknown" : status === "unreachable" ? "Unreachable" : "Not in graph",
      status === "interrupted" ? "break // budget exhausted" : "return NOT_FOUND",
      "No vertex changed",
      current,
      metrics,
    );
  }
  const result = status === "found"
    ? `${config.value} reached by breadth-first search`
    : status === "interrupted"
      ? `Stopped after ${budget} dequeues before deciding whether ${config.value} is reachable`
      : status === "unreachable"
        ? `${config.value} is unreachable from 1`
        : `${config.value} is not in the graph`;
  return { config, frames, complexity: "O(V + E)", result, outcome: { status, dequeues, visited: visited.size } };
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
