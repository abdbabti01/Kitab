// Guided experiments for the Data Structures & Recursion Playground: each runs the same engines and adapters as
// the missions (buildTrace), and reads every outcome from the trace: the values after the operation, the shifts,
// comparisons and pointer changes it counted, and the call stack it recorded. Pure: no React.
import "../learning/engines/eager.ts";
import { buildTrace } from "../learning/registry.ts";
import type { Trace } from "../learning/types.ts";
import { compareChoices, direction, type Choice, type Cycle, type Evidence, type Reading, type Trial } from "../learning/cycle.ts";
import { structureInfo } from "../visual-engine/data-structures/model.ts";
import { engineParams, fixtureFor, isRecursion, type RecursionSetup, type Setup, type StructureSetup } from "./experiments.ts";

const run = (setup: Setup): Trace => {
  const { engine, params } = engineParams(setup);
  return buildTrace(engine, params);
};
const out = (t: Trace) => t.outcome as Record<string, string | number | boolean | undefined>;
const fact = (t: Trace, frame: number, id: string) => t.frames.at(frame)?.facts.find((f) => f.id === id)?.value;
const valuesAfter = (t: Trace) => String(fact(t, -1, "values") ?? "");
const valuesBefore = (t: Trace) => String(fact(t, 0, "values") ?? "");
const num = (t: Trace, key: string) => Number(out(t)[key] ?? 0);
const kindOf = (t: Trace) => String(t.params.kind ?? "recursion");
const last = (t: Trace) => t.frames.length - 1;
const frameNamed = (t: Trace, id: unknown) => {
  const i = t.frames.findIndex((f) => f.id === id);
  return i >= 0 ? i : undefined;
};

/** The setup in words, from the setup alone (never from the run). */
function startOf(setup: Setup): Evidence[] {
  if (isRecursion(setup))
    return [
      { label: "Function", value: setup.fn === "factorial" ? "factorial(n) = n × factorial(n − 1)" : "sum(n) = n + sum(n − 1)" },
      { label: "Call", value: `${setup.fn}(${setup.n}) from main()` },
      { label: "Base case", value: setup.baseCase ? "if (n <= 1) return 1;" : "none" },
      { label: "Stack limit", value: `${setup.stackLimit} frames` },
    ];
  const info = structureInfo[setup.structure];
  const op = info.operations.find((o) => o.id === setup.operation)!.label;
  const values = setup.values ?? fixtureFor(setup.structure);
  const at = setup.operation === "insert" && (setup.structure === "array" || setup.structure === "linked-list");
  const operation = at ? `Insert ${setup.value} at ${setup.structure === "array" ? "index" : "position"} ${setup.index}` : ["pop", "dequeue", "peek"].includes(setup.operation) ? op : `${op}: ${setup.value}`;
  return [
    { label: "Structure", value: info.label },
    { label: setup.structure === "hash-table" ? "Keys stored" : "Starting values", value: values.length ? values.join(", ") : "empty" },
    { label: "Operation", value: operation },
  ];
}

/** What the trace recorded, the result first. */
function dsEvidence(t: Trace): Evidence[] {
  const o = out(t);
  if (t.engine.id === "recursion")
    return [
      { label: "Result", value: o.status === "overflow" ? "Stack overflow: no value returned" : `returned ${o.result} to main()`, at: last(t) },
      { label: "First call to return", value: o.firstReturn === "none" ? "none" : String(o.firstReturn), at: o.firstReturn === "none" ? undefined : frameNamed(t, o.turningFrame) },
      { label: "Deepest stack", value: `${o.maxDepth} frames (limit ${t.params.stackLimit})` },
      { label: "Calls made", value: String(o.calls) },
      { label: "Steps recorded", value: String(t.frames.length) },
    ];
  const e: Evidence[] = [{ label: "Result", value: String(o.result), at: last(t) }];
  if (valuesBefore(t)) e.push({ label: "Values before", value: valuesBefore(t), at: 0 });
  if (valuesAfter(t) && valuesAfter(t) !== valuesBefore(t)) e.push({ label: "Values after", value: valuesAfter(t), at: last(t) });
  if (fact(t, -1, "buckets")) e.push({ label: "Buckets after", value: String(fact(t, -1, "buckets")), at: last(t) });
  if (o.shifts !== undefined) e.push({ label: "Values moved (shifts)", value: String(o.shifts), at: Number(o.shifts) > 0 ? 1 : undefined });
  if (o.bucket !== undefined) e.push({ label: "Bucket", value: `${o.bucket} (key mod 7)` });
  if (kindOf(t) === "linked-list") e.push({ label: "Reference changes", value: String(o.pointerChanges) });
  e.push(
    { label: "Comparisons", value: String(o.comparisons) },
    { label: "Reads", value: String(o.reads) },
    { label: "Writes", value: String(o.writes) },
    { label: "Steps recorded", value: String(t.frames.length) },
    { label: "Cost", value: String(o.complexity) },
  );
  return e;
}

const reading = (label: string, read: (t: Trace) => number | null): Reading<Trace> => ({ label, read, format: (v) => String(v) });
const shifts = reading("Values moved", (t) => num(t, "shifts"));
const refs = reading("Reference changes", (t) => num(t, "pointerChanges"));
const writes = reading("Writes", (t) => num(t, "writes"));
const comparisons = reading("Comparisons", (t) => num(t, "comparisons"));
const steps = reading("Steps recorded", (t) => t.frames.length);

/** Choices that are lists of values; the outcome is the one the trace ends with. */
const valueChoices = (right: number[], wrong: [number[], string][]): Choice[] => [
  { id: right.join(","), text: right.join(", ") },
  ...wrong.map(([values, miss]) => ({ id: values.join(","), text: values.join(", "), miss })),
];
const listOutcome = (t: Trace) => valuesAfter(t).replace(/\s/g, "");

const array = (index: number): StructureSetup => ({ structure: "array", operation: "insert", value: 9, index, values: [4, 7, 12, 18] });
const insertReasons: Choice[] = [
  { id: "after", text: "Only the values after the insertion point move, so the count depends on where you insert." },
  { id: "relink", text: "A linked list moves no values: it changes two references to fit the new node in." },
  { id: "always-all", text: "Every insertion moves every value.", miss: "Values before the insertion point never move; in a linked list, none do." },
];
const insertVariation = (id: string, labelText: string, change: string, setup: StructureSetup): Trial<Setup, Trace> => ({
  id,
  label: labelText,
  change,
  setup,
  question: "Compared with inserting at index 2, how many values will move?",
  choices: compareChoices("Fewer", "The same number", "More"),
  outcome: (t, b) => direction(num(b!, "shifts"), num(t, "shifts"), 0),
  reasons: insertReasons,
  reason: (t) => (kindOf(t) === "linked-list" ? "relink" : "after"),
  explain: (t, b) =>
    kindOf(t) === "linked-list"
      ? `The array moved ${num(b!, "shifts")} values; the linked list moved none. It allocated a node for 9, pointed it at the old first node and moved HEAD: ${num(t, "pointerChanges")} reference changes, whatever the list's length. Reaching a position further along would still mean walking the list from HEAD.`
      : `Inserting at index ${t.params.index} moved ${num(t, "shifts")} values (index 2 moved ${num(b!, "shifts")}): every value from the insertion point to the end moves one slot right, the last one first. At the end of the array nothing moves; at the front everything does. That is why insertion is O(n) in the worst case.`,
});

const arrayInsert: Cycle<Setup, Trace> = {
  id: "ds-array-insert",
  version: 1,
  subject: "data-structures",
  unit: "arrays",
  title: "Make room in the middle of an array",
  concept: "An array keeps its values in consecutive slots, in index order.",
  scenario: "An array holds 4, 7, 12 and 18 at indexes 0 to 3, with spare slots after them (capacity 8), so no growth is needed. You insert 9 at index 2.",
  question: "What does the array hold afterwards, and what work did the insert do?",
  watch: "Which values move, in which order, and how many writes the insert needs.",
  terms: ["complexity"],
  limits: "Addresses are illustrative (base 0x1000, 4-byte integers) and the spare slot always exists: growing into a new, larger block is not shown.",
  hint: "Indexes start at 0, and an insert keeps every existing value: count the values from the insertion point to the end.",
  start: startOf,
  base: {
    id: "base",
    label: "Insert 9 at index 2",
    setup: array(2),
    question: "What will the array hold after inserting 9 at index 2?",
    choices: valueChoices([4, 7, 9, 12, 18], [
      [[4, 9, 7, 12, 18], "Index 2 is the third slot: indexes start at 0."],
      [[4, 7, 9, 18], "An insert doesn't overwrite: 12 moves right to make room."],
      [[4, 7, 12, 18, 9], "Insert puts the value at the index you give; adding at the end is a different operation."],
    ]),
    outcome: listOutcome,
    reasons: [
      { id: "shift", text: "Each value from index 2 onward moved one slot right, starting from the end, and then 9 was written into the free slot." },
      { id: "overwrite", text: "9 replaced the value that was at index 2.", miss: "Overwriting is assignment. An insert keeps every value, so the array grows by one." },
      { id: "sorted", text: "The array put 9 where it belongs in sorted order.", miss: "Arrays never sort themselves: 9 lands at the index you asked for, sorted or not." },
    ],
    reason: (t) => (num(t, "shifts") === num(t, "length") - 1 - Number(t.params.index) ? "shift" : "overwrite"),
    explain: (t) =>
      `To make room at index 2, the array moved ${num(t, "shifts")} values (12, then 18) one slot right, last value first so nothing was overwritten, then wrote 9: ${num(t, "writes")} writes and ${num(t, "reads")} reads. The values before index 2 didn't move. The work grows with how many values follow the insertion point.`,
  },
  variations: [
    insertVariation("front", "Insert at index 0", "Insert 9 at index 0 of the same array.", array(0)),
    insertVariation("end", "Insert at the end", "Insert 9 at index 4, the first free slot.", array(4)),
    insertVariation("list", "A linked list instead", "Insert 9 at the head (position 0) of a linked list holding 4, 7, 12, 18.", { structure: "linked-list", operation: "insert", value: 9, index: 0, values: [4, 7, 12, 18] }),
  ],
  run,
  evidence: dsEvidence,
  readings: [shifts, writes, refs, steps],
};

const tree = (value: number, values: number[]): StructureSetup => ({ structure: "binary-tree", operation: "search", value, index: 0, values });
const searchReasons: Choice[] = [
  { id: "chain", text: "Each value was inserted larger than all before it, so the tree is a chain: the search visits node after node." },
  { id: "halve", text: "Each comparison discards one subtree, about half of what's left in a balanced tree." },
  { id: "early", text: "The value sits at the root or near it, so the search stops early." },
  { id: "scan", text: "A binary search tree checks every value in insertion order.", miss: "A search follows one path from the root, left or right at each node; the tree's shape decides how long that path is." },
];
const searchReason = (t: Trace) => {
  const depth = num(t, "depth");
  if (num(t, "comparisons") <= 2) return "early";
  if (out(t).status === "found" && depth >= num(t, "length") - 1) return "chain";
  if (out(t).status === "absent" && num(t, "comparisons") >= num(t, "length")) return "chain";
  return "halve";
};
const bstSearch: Cycle<Setup, Trace> = {
  id: "ds-bst-shape",
  version: 1,
  subject: "data-structures",
  unit: "trees",
  title: "When a search tree isn't fast",
  concept: "A binary search tree keeps smaller keys to the left and larger to the right; a search follows one path down.",
  scenario: "The values 1, 2, 3, 4, 5, 6, 7 and 8 were inserted in that order into a binary search tree that never rebalances. You search for 8.",
  question: "How many comparisons does the search need, and what decides it?",
  watch: "The path the search takes from the root, and how many nodes it compares.",
  terms: ["complexity", "reference"],
  limits: "This tree never rebalances. Real libraries usually use self-balancing trees (red-black, AVL), which keep the height near log₂ n.",
  hint: "Draw the tree as the values arrive: where does each new, larger value go?",
  start: startOf,
  base: {
    id: "base",
    label: "Search for 8 in the sorted-insert tree",
    setup: tree(8, [1, 2, 3, 4, 5, 6, 7, 8]),
    question: "How many comparisons will the search for 8 make?",
    choices: [
      { id: "log", text: "About 3: each comparison halves what's left", miss: "Halving needs a balanced tree. Inserting values in increasing order makes each one the right child of the last." },
      { id: "some", text: "Between 4 and 7" },
      { id: "all", text: "8: one for every value" },
    ],
    outcome: (t) => (num(t, "comparisons") <= 3 ? "log" : num(t, "comparisons") < 8 ? "some" : "all"),
    reasons: searchReasons,
    reason: searchReason,
    explain: (t) => `Each value was larger than every value before it, so each became the right child of the last: the tree is a chain ${num(t, "length")} nodes long. The search for 8 compared ${num(t, "comparisons")} nodes, one per level. Search costs O(h), the tree's height; this tree's height is n − 1, so here search is O(n), no better than a list.`,
  },
  variations: [
    {
      id: "balanced",
      label: "Insert in a different order",
      change: "The same eight values inserted as 5, 3, 7, 2, 4, 6, 8, 1. Search for 8 again.",
      setup: tree(8, [5, 3, 7, 2, 4, 6, 8, 1]),
      question: "Compared with the sorted-insert tree, how many comparisons will the search for 8 make?",
      choices: compareChoices("Fewer", "The same", "More", { same: "Same values, different shape: the order of insertion decides the shape, and the shape decides the path." }),
      outcome: (t, b) => direction(num(b!, "comparisons"), num(t, "comparisons"), 0),
      reasons: searchReasons,
      reason: searchReason,
      explain: (t, b) => `Starting with 5 puts smaller values to its left and larger to its right, so the tree is only ${num(t, "depth") + 1} levels deep where 8 sits. The search compared ${num(t, "comparisons")} nodes instead of ${num(b!, "comparisons")}: each comparison discarded a whole subtree.`,
    },
    {
      id: "absent",
      label: "Search for a missing value",
      change: "Search the same sorted-insert tree for 9, which isn't in it.",
      setup: tree(9, [1, 2, 3, 4, 5, 6, 7, 8]),
      question: "Compared with finding 8, how many comparisons will the search for 9 make?",
      choices: compareChoices("Fewer", "The same", "More"),
      outcome: (t, b) => direction(num(b!, "comparisons"), num(t, "comparisons"), 0),
      reasons: searchReasons,
      reason: searchReason,
      explain: (t, b) => `9 would sit to the right of 8, so the search follows the same path as before (${num(b!, "comparisons")} comparisons) and finds no child there: ${num(t, "comparisons")} comparisons to learn that 9 is ${String(out(t).status)}. An unsuccessful search walks a full path to a missing child.`,
    },
  ],
  run,
  evidence: dsEvidence,
  readings: [comparisons, steps],
};

const rec = (n: number, baseCase: boolean, stackLimit: number): RecursionSetup => ({ structure: "recursion", fn: "factorial", n, baseCase, stackLimit });
const endReasons: Choice[] = [
  { id: "returns", text: "The base case was reached, so the deepest call returned first and the frames were removed in reverse order." },
  { id: "no-base", text: "Nothing stops the calls: frames pile up until the stack limit and the program crashes." },
  { id: "too-deep", text: "A base case exists, but reaching it needs more frames than the stack can hold." },
  { id: "loop", text: "The function loops forever without using more memory.", miss: "Every call adds a stack frame, so calls that never return use more and more of the stack." },
];
const endReason = (t: Trace) => (out(t).status === "returned" ? "returns" : t.params.baseCase ? "too-deep" : "no-base");
const outcomeChoices: Choice[] = [
  { id: "returned", text: "It returns a value to main()" },
  { id: "overflow", text: "The stack overflows and the program crashes" },
];
const recursion: Cycle<Setup, Trace> = {
  id: "ds-recursion-order",
  version: 1,
  subject: "data-structures",
  unit: "recursion",
  title: "Which call returns first?",
  concept: "Each call gets a stack frame; a call can only finish after the calls it made have returned.",
  scenario: "main() calls factorial(4). factorial(n) returns n × factorial(n − 1), and its base case returns 1 when n ≤ 1. The stack holds up to 8 frames.",
  question: "In what order do the calls finish, and what stops the recursion?",
  watch: "Frames pushed onto the stack, the moment the base case returns, and the frames popped after it.",
  terms: ["frame"],
  limits: "A teaching model of the call stack: one frame per call and a small, configurable limit. It doesn't run JavaScript or measure real memory; real stacks hold thousands of frames.",
  hint: "A call can't finish until the call it made has returned to it. Which call makes no further call?",
  start: startOf,
  base: {
    id: "base",
    label: "factorial(4) with a base case",
    setup: rec(4, true, 8),
    question: "Which call returns first?",
    choices: [
      { id: "factorial(4)", text: "factorial(4): it was called first", miss: "factorial(4) is waiting for factorial(3) to return, which is waiting for factorial(2)… The first call finishes last." },
      { id: "factorial(1)", text: "factorial(1): the base case" },
      { id: "none", text: "None: the calls never return" },
    ],
    outcome: (t) => (String(out(t).firstReturn) === "factorial(1)" ? "factorial(1)" : String(out(t).firstReturn) === "factorial(4)" ? "factorial(4)" : "none"),
    reasons: endReasons,
    reason: endReason,
    explain: (t) => `factorial(4) called factorial(3), which called factorial(2), which called factorial(1): ${out(t).maxDepth} frames on the stack, each waiting. factorial(1) makes no call (the base case), so it returned 1 first. Then factorial(2), factorial(3) and factorial(4) resumed and returned in turn, last in, first out, and main() received ${out(t).result}.`,
  },
  variations: [
    {
      id: "no-base",
      label: "Remove the base case",
      change: "The same call, factorial(4), with no base case. The stack still holds 8 frames.",
      setup: rec(4, false, 8),
      question: "What will happen this time?",
      choices: outcomeChoices,
      outcome: (t) => String(out(t).status),
      reasons: endReasons,
      reason: endReason,
      explain: (t) => `Without a base case, factorial(1) calls factorial(0), which calls factorial(−1), and so on: every call makes another. The stack reached its limit of ${t.params.stackLimit} frames after ${out(t).calls} calls and overflowed, and no value ever reached main().`,
    },
    {
      id: "too-deep",
      label: "A base case too deep to reach",
      change: "The base case is back, but the call is factorial(6) and the stack holds only 4 frames.",
      setup: rec(6, true, 4),
      question: "What will happen this time?",
      choices: outcomeChoices.map((c) => (c.id === "returned" ? { ...c, miss: "A base case only helps if the stack can hold every frame on the way to it." } : c)),
      outcome: (t) => String(out(t).status),
      reasons: endReasons,
      reason: endReason,
      explain: (t) => `factorial(6) needs 6 frames to reach factorial(1), but the stack holds ${t.params.stackLimit}. After ${out(t).calls} calls the stack was full and the next call overflowed it, before the base case was reached. Correct code can still overflow when the input is too large for the stack.`,
    },
  ],
  run,
  evidence: dsEvidence,
  readings: [reading("Deepest stack", (t) => num(t, "maxDepth")), reading("Calls made", (t) => num(t, "calls")), steps],
};

/** The value the operation took out: what the values before have that the values after don't. */
const removed = (t: Trace) => {
  const left = valuesBefore(t).split(", ");
  for (const v of valuesAfter(t).split(", ")) left.splice(left.indexOf(v), left.includes(v) ? 1 : 0);
  return left.length === 1 ? left[0] : "";
};
const orderReasons: Choice[] = [
  { id: "fifo", text: "A queue removes the value that has waited longest: first in, first out." },
  { id: "lifo", text: "A stack removes the value added most recently: last in, first out." },
  { id: "smallest", text: "It removes the smallest value.", miss: "Neither a stack nor a queue looks at the values: only the order they arrived in matters." },
];
const removeChoices: Choice[] = [
  { id: "8", text: "8, the first value added" },
  { id: "1", text: "1, the last value added" },
  { id: "12", text: "12, the largest value", miss: "Removal never compares values; it takes from one end." },
];
const stackQueue: Cycle<Setup, Trace> = {
  id: "ds-stack-queue",
  version: 1,
  subject: "data-structures",
  unit: "choose-structure",
  title: "Stack or queue: who leaves first?",
  concept: "Stacks and queues differ only in which end a value leaves from.",
  scenario: "The values 8, 3, 12 and 1 were added in that order (8 first, 1 last) to a queue.",
  question: "Which value does removing one item take, and why?",
  watch: "The FRONT, REAR or TOP marker, and which value is read and removed.",
  terms: ["complexity"],
  limits: "Both are backed by an array with markers; capacity growth and the queue's wrap-around are not shown.",
  hint: "Think of the order the values arrived in, not their size: which end does this structure remove from?",
  start: startOf,
  base: {
    id: "base",
    label: "Dequeue from the queue",
    setup: { structure: "queue", operation: "dequeue", value: 0, index: 0, values: [8, 3, 12, 1] },
    question: "Which value will dequeue remove?",
    choices: removeChoices.map((c) => (c.id === "1" ? { ...c, miss: "That's a stack's rule. A queue serves values in the order they arrived, like a line." } : c)),
    outcome: removed,
    reasons: orderReasons,
    reason: (t) => (kindOf(t) === "queue" ? "fifo" : "lifo"),
    explain: (t) => `The queue's FRONT was at 8, the value that arrived first, so dequeue read and removed 8 and moved FRONT on: ${valuesAfter(t)} remain. One read and one write, whatever the queue's length: O(1).`,
  },
  variations: [
    {
      id: "stack",
      label: "A stack instead",
      change: "The same values, added in the same order, but to a stack. Pop one.",
      setup: { structure: "stack", operation: "pop", value: 0, index: 0, values: [8, 3, 12, 1] },
      question: "Which value will pop remove?",
      choices: removeChoices.map((c) => (c.id === "8" ? { ...c, miss: "That's a queue's rule. A stack takes from the top: the value added last." } : c)),
      outcome: removed,
      reasons: orderReasons,
      reason: (t) => (kindOf(t) === "queue" ? "fifo" : "lifo"),
      explain: (t, b) => `The stack's TOP was 1, the value added last, so pop removed 1 and left ${valuesAfter(t)}; the queue removed ${removed(b!)}. Same values, same arrival order: only the end each structure removes from differs, and both take one step.`,
    },
  ],
  run,
  evidence: dsEvidence,
  readings: [reading("Value removed", (t) => Number(removed(t))), steps],
};

const hash = (value: number): StructureSetup => ({ structure: "hash-table", operation: "insert", value, index: 0 });
const bucketReasons: Choice[] = [
  { id: "collide", text: "The key's bucket (key mod 7) already held keys, so they were compared before it was added to the chain." },
  { id: "empty", text: "The key's bucket (key mod 7) was empty, so it was stored without comparing anything." },
  { id: "scan", text: "A hash table compares the new key with every stored key.", miss: "Only the keys in the key's own bucket are compared; the other buckets are never looked at." },
];
const hashCollision: Cycle<Setup, Trace> = {
  id: "ds-hash-collision",
  version: 1,
  subject: "data-structures",
  unit: "hash-tables",
  title: "Collide in a bucket",
  concept: "A hash table computes a key's bucket, then looks only in that bucket.",
  scenario: "A hash table with 7 buckets uses bucket = key mod 7 and chains keys that share a bucket. It holds 10, 15, 23 and 8. You insert 22.",
  question: "Where does 22 go, and how much work does it take?",
  watch: "The bucket computed for 22, and the keys compared there.",
  terms: ["complexity"],
  limits: "Seven buckets, keys only, and it never resizes. Real hash tables grow when they fill up, which keeps chains short.",
  hint: "Compute key mod 7 for every stored key and for the new one: which keys share its bucket?",
  start: startOf,
  base: {
    id: "base",
    label: "Insert 22",
    setup: hash(22),
    question: "How many stored keys will be compared before 22 is stored?",
    choices: [
      { id: "0", text: "None: it goes straight into its bucket", miss: "22 mod 7 = 1, and 15 and 8 are in bucket 1 already (15 mod 7 = 1, 8 mod 7 = 1)." },
      { id: "2", text: "Two: the keys already in its bucket" },
      { id: "4", text: "All four stored keys", miss: "Only the keys in 22's own bucket are compared." },
    ],
    outcome: (t) => String(num(t, "comparisons")),
    reasons: bucketReasons,
    reason: (t) => (num(t, "comparisons") > 0 ? "collide" : "empty"),
    explain: (t) => `22 mod 7 = ${out(t).bucket}. Bucket ${out(t).bucket} already held ${num(t, "comparisons")} keys (15 and 8), so the table compared 22 with each to make sure it wasn't already stored, then appended it to the chain: ${num(t, "comparisons")} comparisons. Average cost stays O(1) while chains are short; if every key landed in one bucket, it would be O(n).`,
  },
  variations: [
    {
      id: "empty",
      label: "A key with an empty bucket",
      change: "Insert 20 instead of 22. 20 mod 7 = 6.",
      setup: hash(20),
      question: "Compared with inserting 22, how many keys will be compared?",
      choices: compareChoices("Fewer", "The same number", "More"),
      outcome: (t, b) => direction(num(b!, "comparisons"), num(t, "comparisons"), 0),
      reasons: bucketReasons,
      reason: (t) => (num(t, "comparisons") > 0 ? "collide" : "empty"),
      explain: (t) => `20 mod 7 = ${out(t).bucket}, and bucket ${out(t).bucket} was empty, so 20 was stored with ${num(t, "comparisons")} comparisons. The cost depends on how many keys share the bucket, not on how many keys the table holds.`,
    },
  ],
  run,
  evidence: dsEvidence,
  readings: [comparisons, reading("Bucket", (t) => num(t, "bucket")), steps],
};

export const dsCycles = [arrayInsert, stackQueue, hashCollision, bstSearch, recursion];
export const findDsCycle = (id: string | null) => dsCycles.find((c) => c.id === id);
