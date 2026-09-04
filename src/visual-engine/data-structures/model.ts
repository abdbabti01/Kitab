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
};

export type DataStructureSimulation = {
  config: SimulationConfig;
  frames: SimulationFrame[];
  complexity: string;
  result: string;
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

function items(values: number[], prefix = "item"): StructureItem[] {
  return values.map((value, index) => ({ id: `${prefix}-${index}`, value, address: address(index) }));
}

function arrayItems(values: number[]): StructureItem[] {
  return values.map((value, index) => ({
    id: `array-${index}`,
    value,
    address: `0x${(4096 + index * 4).toString(16).toUpperCase()}`,
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
  let values = [8, 3, 12, 1, 6];
  let current: StructureSnapshot = { items: arrayItems(values), focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Read the array layout", "INITIALIZE", "Five integers occupy adjacent four-byte slots. Indexes identify positions, not values.", "Array ready", "base = 0x1000 · length = 5", "No memory changed", current, metrics);

  if (config.operation === "search") {
    let found = -1;
    for (let index = 0; index < values.length; index += 1) {
      metrics.reads += 1;
      metrics.comparisons += 1;
      current = snapshot(current, { focusIds: [`array-${index}`], visitedValues: values.slice(0, index + 1) });
      const match = values[index] === config.value;
      makeFrame(frames, match ? "Target found" : `Compare index ${index}`, "READ + COMPARE", `Read ${values[index]} from ${address(index)} and compare it with ${config.value}.`, match ? `Found at index ${index}` : "Continue right", `array[${index}] === ${config.value}`, match ? "Search terminates" : "One more slot inspected", current, metrics);
      if (match) { found = index; break; }
    }
    if (found < 0) makeFrame(frames, "Reach the end", "RETURN NOT FOUND", "Every live slot was inspected, so the target is not present.", "Not found", "return -1", "No memory changed", current, metrics);
    return { config, frames, complexity: "O(n) worst-case", result: found < 0 ? `${config.value} is absent` : `${config.value} found at index ${found}` };
  }

  const safeIndex = Math.max(0, Math.min(values.length - (config.operation === "delete" ? 1 : 0), config.index));
  if (config.operation === "delete") {
    const removed = values[safeIndex];
    for (let index = safeIndex; index < values.length - 1; index += 1) {
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
    return { config, frames, complexity: "O(n) because later elements shift", result: `Removed ${removed} from index ${safeIndex}` };
  }

  values.push(0);
  metrics.writes += 1;
  for (let index = values.length - 1; index > safeIndex; index -= 1) {
    metrics.reads += 1;
    metrics.writes += 1;
    values[index] = values[index - 1];
    current = { items: arrayItems(values), focusIds: [`array-${index - 1}`, `array-${index}`], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Shift ${values[index]} right`, "READ + WRITE", `Copy index ${index - 1} into index ${index}; the original value remains until the final write.`, "Free slot moves left", `array[${index}] = array[${index - 1}]`, "One element shifted", current, metrics);
  }
  values[safeIndex] = config.value;
  metrics.writes += 1;
  current = { items: arrayItems(values), focusIds: [`array-${safeIndex}`], visitedValues: [], frontierValues: [] };
  makeFrame(frames, `Write ${config.value}`, "WRITE", "Store the new value in the open slot and increase the logical length.", `Inserted at index ${safeIndex}`, `array[${safeIndex}] = ${config.value}`, `Length ${values.length - 1} → ${values.length}`, current, metrics);
  return { config, frames, complexity: "O(n) because later elements shift", result: `Inserted ${config.value} at index ${safeIndex}` };
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
  let nodes = linkedItems([8, 3, 12, 1, 6]);
  let current: StructureSnapshot = { items: nodes, focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Start from HEAD", "READ HEAD", "The list exposes the address of its first node. Nodes do not need adjacent addresses.", "HEAD → 0x1010", "current = HEAD", "No node changed", current, metrics);

  const foundIndex = nodes.findIndex((node) => node.value === config.value);
  const destination = config.operation === "insert" ? Math.max(0, Math.min(nodes.length, config.index)) : foundIndex;
  const traverseTo = config.operation === "insert"
    ? destination - 1
    : foundIndex >= 0 ? foundIndex : nodes.length - 1;
  for (let index = 0; index <= traverseTo && index < nodes.length; index += 1) {
    metrics.reads += 2;
    metrics.comparisons += config.operation === "insert" ? 0 : 1;
    current = { items: nodes, focusIds: [nodes[index].id], visitedValues: nodes.slice(0, index + 1).map((node) => node.value), frontierValues: [] };
    makeFrame(frames, `Visit node ${nodes[index].value}`, "DEREFERENCE", `Read the value and next pointer stored at ${current.items[index].address}.`, index === traverseTo ? "Position reached" : `Follow next → ${current.items[index].next}`, `current = current.next`, index === traverseTo ? "Traversal stops" : "Two fields read", current, metrics);
    if (config.operation === "search" && nodes[index].value === config.value) return { config, frames, complexity: "O(n) traversal", result: `${config.value} found after ${index + 1} node visits` };
  }

  if (config.operation === "search") {
    makeFrame(frames, "Reach null", "RETURN NOT FOUND", "The final next pointer is null, so no later node can contain the target.", "Not found", "current === null", "No node changed", current, metrics);
    return { config, frames, complexity: "O(n) traversal", result: `${config.value} is absent` };
  }
  if (config.operation === "delete") {
    if (foundIndex < 0) {
      makeFrame(frames, "Reach null", "RETURN NOT FOUND", "The final node points to null, so the requested value is not in the list.", "List unchanged", "current === null", "No pointer changed", current, metrics);
      return { config, frames, complexity: "O(n) traversal", result: `${config.value} is absent` };
    }
    const removed = nodes[foundIndex];
    nodes = nodes.filter((_, index) => index !== foundIndex).map((node, index, remaining) => ({
      ...node,
      next: remaining[index + 1]?.address ?? null,
    }));
    metrics.pointerChanges += 1;
    metrics.writes += 1;
    current = { items: nodes, focusIds: foundIndex > 0 ? [nodes[foundIndex - 1].id] : nodes[0] ? [nodes[0].id] : [], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Bypass node ${config.value}`, "WRITE POINTER", foundIndex === 0 ? `HEAD changes from ${removed.address} to ${nodes[0]?.address ?? "NULL"}.` : "The predecessor's next pointer is changed to the removed node's successor.", "List connected without removed node", foundIndex === 0 ? "HEAD = HEAD.next" : "previous.next = current.next", "1 pointer changed", current, metrics);
    return { config, frames, complexity: "O(n) to find · O(1) to unlink", result: `Removed ${config.value}` };
  }

  const newNode: StructureItem = { id: `node-new-${config.value}`, value: config.value, address: "0x1FF0" };
  nodes.splice(destination, 0, newNode);
  nodes = nodes.map((node, index) => ({ ...node, next: nodes[index + 1]?.address ?? null }));
  metrics.writes += 2;
  metrics.pointerChanges += destination === 0 ? 1 : 2;
  current = { items: nodes, focusIds: [newNode.id], visitedValues: [], frontierValues: [] };
  makeFrame(frames, `Link the new node`, "ALLOCATE + WRITE POINTERS", "The new node points to its successor; HEAD or the predecessor is then redirected to the new address.", `Inserted at position ${destination}`, "new.next = successor · previous.next = new", `${metrics.pointerChanges} pointer write${metrics.pointerChanges === 1 ? "" : "s"}`, current, metrics);
  return { config, frames, complexity: "O(n) to locate · O(1) to link", result: `Inserted ${config.value} at position ${destination}` };
}

function linearEndSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  let values = config.kind === "stack" ? [8, 3, 12, 1] : [8, 3, 12, 1];
  const prefix = config.kind;
  let current: StructureSnapshot = { items: items(values, prefix), focusIds: [], visitedValues: [], frontierValues: [] };
  const isStack = config.kind === "stack";
  makeFrame(frames, isStack ? "Locate TOP" : "Locate FRONT and REAR", "READ END MARKERS", isStack ? "TOP identifies the only directly accessible element." : "FRONT identifies the next removal; REAR identifies where new work joins.", isStack ? `TOP = ${values.at(-1)}` : `FRONT = ${values[0]} · REAR = ${values.at(-1)}`, isStack ? "top = length - 1" : "front = 0 · rear = length - 1", "No item changed", current, metrics);
  if (config.operation === "push" || config.operation === "enqueue") {
    values.push(config.value);
    metrics.writes += 1;
    current = { items: items(values, prefix), focusIds: [`${prefix}-${values.length - 1}`], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `${isStack ? "Push" : "Enqueue"} ${config.value}`, "WRITE AT REAR", "Write one value into the next available end position and move the end marker.", isStack ? `TOP = ${config.value}` : `REAR = ${config.value}`, `${isStack ? "stack.push" : "queue.enqueue"}(${config.value})`, "1 write · length + 1", current, metrics);
    return { config, frames, complexity: "O(1) amortized", result: `${config.value} added at the ${isStack ? "top" : "rear"}` };
  }
  const remove = config.operation === "pop" || config.operation === "dequeue";
  const targetIndex = isStack ? values.length - 1 : 0;
  metrics.reads += 1;
  current = snapshot(current, { focusIds: [`${prefix}-${targetIndex}`] });
  makeFrame(frames, remove ? `Read ${values[targetIndex]} before removal` : `Inspect ${values[targetIndex]}`, "READ END", "The access rule chooses the element; no scan through the collection is required.", `Selected value ${values[targetIndex]}`, isStack ? "value = items[top]" : "value = items[front]", "1 read", current, metrics);
  if (remove) {
    const removed = isStack ? values.pop()! : values.shift()!;
    metrics.writes += 1;
    current = { items: items(values, prefix), focusIds: [], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Remove ${removed}`, "MOVE END MARKER", "The logical boundary moves past the removed element. Remaining order is preserved.", `Length = ${values.length}`, isStack ? "top -= 1" : "front += 1", "1 boundary update", current, metrics);
    return { config, frames, complexity: "O(1)", result: `Removed ${removed} from the ${isStack ? "top" : "front"}` };
  }
  return { config, frames, complexity: "O(1)", result: `Read ${values[targetIndex]} without removing it` };
}

function hashBuckets(values: number[], bucketCount = 7): Bucket[] {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({ index, items: [] as StructureItem[] }));
  values.forEach((value, index) => {
    const bucket = ((value % bucketCount) + bucketCount) % bucketCount;
    buckets[bucket].items.push({ id: `key-${value}-${index}`, value, address: address(index * 2 + 1) });
  });
  return buckets;
}

function hashSimulation(config: SimulationConfig): DataStructureSimulation {
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  let values = [10, 15, 23, 8];
  const bucketIndex = ((config.value % 7) + 7) % 7;
  let buckets = hashBuckets(values);
  let current: StructureSnapshot = { items: [], buckets, focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Compute the bucket", "HASH", `The deterministic rule ${config.value} mod 7 maps the key to bucket ${bucketIndex}.`, `bucket = ${bucketIndex}`, `index = hash(${config.value}) % 7`, "No bucket changed", current, metrics);
  const chain = buckets[bucketIndex].items;
  for (const entry of chain) {
    metrics.reads += 1;
    metrics.comparisons += 1;
    current = snapshot(current, { focusIds: [entry.id], visitedValues: [...current.visitedValues, entry.value] });
    makeFrame(frames, `Compare key ${entry.value}`, "CHECK COLLISION CHAIN", `Bucket ${bucketIndex} can contain multiple keys, so equality—not only the hash—decides whether this is the target.`, entry.value === config.value ? "Key matched" : "Collision: keep checking", `${entry.value} === ${config.value}`, entry.value === config.value ? "Search terminates" : "1 collision inspected", current, metrics);
    if (entry.value === config.value && config.operation === "search") return { config, frames, complexity: "O(1) average · O(n) worst-case", result: `${config.value} found in bucket ${bucketIndex}` };
  }
  if (config.operation === "search") {
    makeFrame(frames, "Finish the bucket chain", "RETURN NOT FOUND", "Every key in the selected bucket was compared, so the requested key is absent.", "Key not found", "return undefined", "No bucket changed", current, metrics);
    return { config, frames, complexity: "O(1) average · O(n) worst-case", result: `${config.value} is absent from bucket ${bucketIndex}` };
  }
  if (config.operation === "delete") {
    const position = values.indexOf(config.value);
    if (position < 0) {
      makeFrame(frames, "Keep the table unchanged", "DELETE MISSED", "The selected bucket contains no matching key, so deletion performs no write.", "Key not found", "return false", "No bucket changed", current, metrics);
      return { config, frames, complexity: "O(1) average · O(n) worst-case", result: `${config.value} is absent` };
    }
    values.splice(position, 1);
    metrics.writes += 1;
    buckets = hashBuckets(values);
    current = { items: [], buckets, focusIds: [], visitedValues: [], frontierValues: [] };
    makeFrame(frames, `Unlink key ${config.value}`, "DELETE ENTRY", "Remove only the matching key from its bucket chain; colliding keys remain reachable.", `Bucket ${bucketIndex} updated`, `bucket.remove(${config.value})`, "1 bucket-chain write", current, metrics);
    return { config, frames, complexity: "O(1) average · O(n) worst-case", result: `Removed ${config.value} from bucket ${bucketIndex}` };
  }
  values.push(config.value);
  metrics.writes += 1;
  buckets = hashBuckets(values);
  const inserted = buckets[bucketIndex].items.at(-1)!;
  current = { items: [], buckets, focusIds: [inserted.id], visitedValues: [], frontierValues: [] };
  makeFrame(frames, chain.length ? "Append after a collision" : "Store in the empty bucket", "WRITE ENTRY", chain.length ? "A collision placed the key in an occupied bucket, so separate chaining keeps both keys reachable in that bucket." : "The selected bucket has no existing chain.", `Key stored in bucket ${bucketIndex}`, `buckets[${bucketIndex}].append(${config.value})`, `1 write · load factor ${values.length}/7`, current, metrics);
  return { config, frames, complexity: "O(1) average · O(n) worst-case", result: `Inserted ${config.value} in bucket ${bucketIndex}` };
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
  const values = [8, 3, 12, 1, 6, 10, 14];
  let current: StructureSnapshot = { items: items(values, "tree"), focusIds: [], visitedValues: [], frontierValues: [] };
  makeFrame(frames, "Begin at the root", "READ ROOT", "The root is the entry point. Ordering lets each comparison discard an entire subtree.", "Current node = 8", "current = root", "No node changed", current, metrics);
  const path = bstPath(config.value, values);
  path.forEach((value, index) => {
    metrics.reads += 1;
    metrics.comparisons += 1;
    current = snapshot(current, { focusIds: [`tree-${values.indexOf(value)}`], visitedValues: path.slice(0, index + 1) });
    const matched = value === config.value;
    makeFrame(frames, matched ? `Match ${value}` : `Compare with ${value}`, "COMPARE", matched ? "The target equals the current node." : `${config.value} is ${config.value < value ? "smaller" : "larger"}, so the opposite subtree is discarded.`, matched ? "Target found" : `Move ${config.value < value ? "left" : "right"}`, `compare(${config.value}, ${value})`, matched ? "Search terminates" : "One subtree eliminated", current, metrics);
  });
  const found = values.includes(config.value);
  if (config.operation === "search") return { config, frames, complexity: "O(log n) balanced · O(n) skewed", result: found ? `${config.value} found in ${path.length} comparisons` : `${config.value} is absent` };
  if (!found) {
    values.push(config.value);
    metrics.writes += 1;
    metrics.pointerChanges += 1;
    current = { items: items(values, "tree"), focusIds: [`tree-${values.length - 1}`], visitedValues: path, frontierValues: [] };
    makeFrame(frames, `Attach ${config.value} at the null branch`, "WRITE CHILD POINTER", "The first missing branch on the ordered path becomes the new node's parent link.", "BST ordering preserved", `${config.value < path.at(-1)! ? "parent.left" : "parent.right"} = new Node(${config.value})`, "1 node allocation · 1 pointer write", current, metrics);
  }
  return { config, frames, complexity: "O(log n) balanced · O(n) skewed", result: found ? `${config.value} already exists` : `Inserted ${config.value} after ${path.length} comparisons` };
}

function graphSimulation(config: SimulationConfig): DataStructureSimulation {
  const adjacency: Record<number, number[]> = {
    1: [3, 8],
    3: [1, 6],
    8: [1, 10],
    6: [3, 10],
    10: [8, 6, 12],
    12: [10],
  };
  const vertices = Object.keys(adjacency).map(Number);
  const edges = Object.entries(adjacency).flatMap(([from, targets]) =>
    targets.filter((to) => Number(from) < to).map((to) => ({ from: Number(from), to })),
  );
  const frames: SimulationFrame[] = [];
  const metrics = emptyMetrics();
  const queue = [1];
  const visited = new Set([1]);
  let current: StructureSnapshot = { items: items(vertices, "vertex"), edges, focusIds: ["vertex-0"], visitedValues: [1], frontierValues: [1] };
  makeFrame(frames, "Seed the frontier", "ENQUEUE START", "Mark vertex 1 visited when it enters the queue. This prevents a cycle from enqueuing it again.", "Queue = [1]", "visited.add(1) · queue.enqueue(1)", "1 vertex discovered", current, metrics);
  let found = false;
  while (queue.length && frames.length < 10) {
    const value = queue.shift()!;
    metrics.reads += 1;
    current = snapshot(current, { focusIds: [`vertex-${vertices.indexOf(value)}`], frontierValues: [...queue] });
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
    current = snapshot(current, { visitedValues: [...visited], frontierValues: [...queue], focusIds: queue.map((item) => `vertex-${vertices.indexOf(item)}`) });
    makeFrame(frames, `Expand neighbors of ${value}`, "DISCOVER + ENQUEUE", "Only unvisited neighbors join the rear of the queue, preserving increasing distance from the start.", `Queue = [${queue.join(", ")}]`, "for neighbor of adjacency[current]", `${visited.size} visited · ${queue.length} queued`, current, metrics);
  }
  return { config, frames, complexity: "O(V + E)", result: found ? `${config.value} reached by breadth-first search` : `${config.value} is unreachable` };
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
