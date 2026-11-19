// Data structures & programming labs: the learner's JavaScript runs for real in the sandbox and is judged by tests
// that call it with real inputs, edge cases included.
import type { CodeLab, ComputerStep } from "../model.ts";

const runSteps: ComputerStep[] = [
  { title: "Kitab saves your code", detail: "Before anything runs, your code is saved in this browser, so a crash can't lose it.", observed: true },
  { title: "A fresh sandbox starts", detail: "Kitab creates an isolated frame with no access to the page, your saved progress or the network, and starts a Web Worker (a separate thread) inside it.", observed: false },
  { title: "The engine compiles your code", detail: "The browser's JavaScript engine (V8 in Chrome and Edge, SpiderMonkey in Firefox, JavaScriptCore in Safari) parses your text into a program. A syntax error stops here, before any line runs.", observed: true },
  { title: "Your program runs", detail: "Statements execute top to bottom. Each function call pushes a frame on the call stack; returning pops it. console.log sends a line back to Kitab.", observed: true },
  { title: "Check runs the tests", detail: "On Check, the lab's tests call your functions with real inputs and compare what comes back. Every test is reported, pass or fail.", observed: true },
  { title: "The sandbox is thrown away", detail: "When the program finishes, fails, or passes the time limit, Kitab removes the frame, which stops the Worker and everything in it.", observed: false },
];

const sandboxConfig = {
  name: "Execution time limit",
  what: "How long Kitab lets one run take before stopping it.",
  why: "A program that never finishes (an infinite loop, a missing base case in a loop) would otherwise keep a CPU core busy forever.",
  where: "Real platforms set the same kind of limit: AWS Lambda's function timeout, a CI job's timeout-minutes, an HTTP server's request timeout.",
  who: "Whoever runs the code: the platform operator, or the team that owns the service.",
  change: "Here it is fixed per lab. On a platform, it's a setting (for example timeout: 30 in a Lambda configuration).",
  verify: "Write while (true) {} and press Run: Kitab reports that the run was stopped at the limit.",
  effect: "Too low and slow-but-correct programs are killed; too high and runaway programs waste resources for longer.",
  kitab: "Real: Kitab removes the sandbox at the limit, which terminates the Worker.",
};

export const structuresLabs: CodeLab[] = [
  {
    kind: "code",
    id: "run-javascript",
    version: 1,
    subject: "structures",
    title: "Run your first program",
    summary: "Execute JavaScript, read its output and errors, and finish a function so the tests pass.",
    difficulty: "beginner",
    minutes: 10,
    modes: ["real-execution"],
    modeNote: "Your code runs on this browser's own JavaScript engine in an isolated sandbox. The output, errors and test results all come from that run.",
    objective: "Run a program, tell its printed output apart from a function's return value, read an error, and make a function correct for every input, including an empty list.",
    problem: "A weather station sends batches of temperature readings. The dashboard needs a count, a total and an average for each batch, and some batches arrive empty.",
    build: "Finish summarize(numbers) so it returns { count, sum, average }. For an empty list, average must be null: there is no average of nothing.",
    canChange: "Everything in summarize.js. The lines at the bottom only print examples; change them to try other inputs.",
    tools: "Run executes your program and shows what it prints. Check runs the lab's tests against summarize().",
    verify: "Press Run and read the console. Then press Check: each test shows the input, what it expected and what your function returned.",
    success: "Every test passes, including the empty list.",
    computer: runSteps,
    configs: [sandboxConfig],
    terms: ["frame"],
    related: [
      { label: "Learn: values, indexes and memory", path: "/learn/array-insert", kind: "learn" },
      { label: "Playground: Data Structures & Recursion", path: "/practice/structures", kind: "playground" },
    ],
    stages: [],
    file: "summarize.js",
    starter: `// summarize(numbers) returns { count, sum, average } for a list of numbers.
// Press Run to execute this file, then finish summarize() so Check passes.

function summarize(numbers) {
  let sum = 0;
  for (const n of numbers) {
    sum += n;
  }
  // TODO: also return the average. For an empty list it must be null.
  return { count: numbers.length, sum };
}

const readings = [12.5, 14, 9.5, 16];
console.log("Readings:", readings);
console.log("Summary:", summarize(readings));
console.log("Empty batch:", summarize([]));
`,
    solution: `function summarize(numbers) {
  let sum = 0;
  for (const n of numbers) {
    sum += n;
  }
  const average = numbers.length === 0 ? null : sum / numbers.length;
  return { count: numbers.length, sum, average };
}

const readings = [12.5, 14, 9.5, 16];
console.log("Readings:", readings);
console.log("Summary:", summarize(readings));
console.log("Empty batch:", summarize([]));
`,
    exports: ["summarize"],
    tests: `
test("four readings: count, sum and average", () => {
  assert.equal(lab.summarize([12.5, 14, 9.5, 16]), { count: 4, sum: 52, average: 13 }, "summarize([12.5, 14, 9.5, 16])");
});
test("one reading is its own average", () => {
  assert.equal(lab.summarize([7]), { count: 1, sum: 7, average: 7 }, "summarize([7])");
});
test("an empty batch has no average", () => {
  assert.equal(lab.summarize([]), { count: 0, sum: 0, average: null }, "summarize([])");
});
test("negative numbers work too", () => {
  assert.equal(lab.summarize([-4, 4, -6]), { count: 3, sum: -6, average: -2 }, "summarize([-4, 4, -6])");
});
test("the input list is not changed", () => {
  const input = [1, 2, 3];
  lab.summarize(input);
  assert.equal(input, [1, 2, 3], "the list after summarize()");
});
`,
    timeoutMs: 2000,
    hints: [
      "Press Run first. The console shows { count: 4, sum: 52 }: there is no average yet.",
      "The average is the sum divided by the count. Add it to the returned object as average.",
      "Dividing by zero gives NaN in JavaScript, not an error. Check numbers.length === 0 first and use null.",
      "To see an error for yourself, misspell summarize in one console.log line and press Run: a ReferenceError names the line.",
    ],
  },
  {
    kind: "code",
    id: "arrays",
    version: 1,
    subject: "structures",
    title: "Insert, remove and search in an array",
    summary: "Implement insertion, removal and search by moving values slot by slot, with invalid indexes rejected.",
    difficulty: "beginner",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "Your functions run for real and are tested on real arrays. JavaScript arrays can grow by themselves; the rules below make you do the moving a fixed-size array needs.",
    objective: "See why inserting or removing in the middle of an array moves every later value, and handle the indexes that are out of range.",
    problem: "A playlist is stored as an array. Users insert songs anywhere, remove songs, and search for one. The code must never lose a song or accept a position that doesn't exist.",
    build: "Fix insertAt(array, index, value) and write removeAt(array, index). Use only array[i] reads and writes and array.length: no splice, push, pop, shift, unshift or built-in searching. Any index outside the valid range throws a RangeError.",
    canChange: "Everything in arrays.js. indexOf is already correct: read it as an example.",
    tools: "Run shows what your functions do to the example array. Check tests the middle, both ends, empty arrays, duplicates and invalid indexes.",
    verify: "Run first: the starter's insertAt overwrites values. Fix it, then Check.",
    success: "All tests pass: values move without being overwritten, removal shortens the array, and invalid indexes are refused with a RangeError while the array stays unchanged.",
    computer: [
      ...runSteps.slice(0, 3),
      { title: "Each assignment writes one slot", detail: "array[i + 1] = array[i] copies one value one slot to the right. Inserting at index 1 of 5 values needs 4 such moves, then 1 write.", observed: true },
      ...runSteps.slice(4),
    ],
    configs: [],
    terms: ["complexity", "reference"],
    related: [
      { label: "Learn: inserting into an array", path: "/learn/array-insert", kind: "learn" },
      { label: "Playground: watch an insert shift values", path: "/practice/structures?structure=array&op=insert&value=99&index=1", kind: "playground" },
      { label: "Practice: predict how many values shift", path: "/missions/array-insert-shift", kind: "practice" },
    ],
    stages: [{ track: "data-structures", stage: "arrays" }],
    file: "arrays.js",
    starter: `// insertAt(array, index, value): put value at index, moving later values one slot right.
//   Valid indexes: 0 to array.length (array.length appends). Returns the new length.
// removeAt(array, index): take out the value at index, moving later values one slot left.
//   Valid indexes: 0 to array.length - 1. Returns the removed value.
// indexOf(array, value): the first index holding value, or -1.
// Rules: change the array in place with array[i] and array.length only.
// An invalid index (outside the range, or not a whole number) throws a RangeError.

function insertAt(array, index, value) {
  // TODO: throw a RangeError for an invalid index.
  // This loop moves values right to make room. Run the file and look closely at the result.
  const n = array.length;
  for (let i = index; i < n; i++) {
    array[i + 1] = array[i];
  }
  array[index] = value;
  return array.length;
}

function removeAt(array, index) {
  // TODO: check the index, keep the value, move later values left,
  // then shorten the array with array.length = array.length - 1.
}

function indexOf(array, value) {
  for (let i = 0; i < array.length; i++) {
    if (array[i] === value) return i;
  }
  return -1;
}

const songs = ["intro", "verse", "chorus", "outro"];
console.log("insertAt returned", insertAt(songs, 1, "NEW"), songs);
console.log("removeAt returned", removeAt(songs, 1), songs);
console.log("indexOf chorus:", indexOf(songs, "chorus"));
`,
    solution: `function checkIndex(index, max) {
  if (!Number.isInteger(index) || index < 0 || index > max) {
    throw new RangeError("Index " + index + " is outside 0.." + max);
  }
}

function insertAt(array, index, value) {
  checkIndex(index, array.length);
  // Move from the end backwards, so no value is overwritten before it has moved.
  for (let i = array.length; i > index; i--) {
    array[i] = array[i - 1];
  }
  array[index] = value;
  return array.length;
}

function removeAt(array, index) {
  checkIndex(index, array.length - 1);
  const removed = array[index];
  for (let i = index; i < array.length - 1; i++) {
    array[i] = array[i + 1];
  }
  array.length = array.length - 1;
  return removed;
}

function indexOf(array, value) {
  for (let i = 0; i < array.length; i++) {
    if (array[i] === value) return i;
  }
  return -1;
}

const songs = ["intro", "verse", "chorus", "outro"];
console.log("insertAt returned", insertAt(songs, 1, "NEW"), songs);
console.log("removeAt returned", removeAt(songs, 1), songs);
console.log("indexOf chorus:", indexOf(songs, "chorus"));
`,
    exports: ["insertAt", "removeAt", "indexOf"],
    tests: `
// Arrays whose shortcut methods refuse to work, so the moving has to be done slot by slot.
function guarded(values) {
  const array = values.slice();
  for (const name of ["splice", "push", "pop", "shift", "unshift", "indexOf", "includes", "findIndex", "copyWithin"]) {
    Object.defineProperty(array, name, { value() { throw new Error("Move values with array[i] instead of " + name + "()"); } });
  }
  return array;
}
test("insert in the middle moves later values right", () => {
  const a = guarded(["a", "b", "c", "d"]);
  assert.equal(lab.insertAt(a, 1, "X"), 5, "insertAt(['a','b','c','d'], 1, 'X') return value");
  assert.equal([...a], ["a", "X", "b", "c", "d"], "the array after inserting at 1");
});
test("insert at the start and at the end", () => {
  const a = guarded([2, 3]);
  lab.insertAt(a, 0, 1);
  lab.insertAt(a, 3, 4);
  assert.equal([...a], [1, 2, 3, 4], "insert at 0, then at length");
});
test("insert into an empty array", () => {
  const a = guarded([]);
  assert.equal(lab.insertAt(a, 0, "only"), 1, "new length");
  assert.equal([...a], ["only"], "the array");
});
test("insert refuses invalid indexes and leaves the array unchanged", () => {
  for (const index of [-1, 5, 1.5, NaN]) {
    const a = guarded(["a", "b", "c", "d"]);
    assert.throws(() => lab.insertAt(a, index, "X"), RangeError, "insertAt(array of 4, " + index + ") should throw a RangeError");
    assert.equal([...a], ["a", "b", "c", "d"], "the array after a refused insert at " + index);
  }
});
test("remove from the middle moves later values left", () => {
  const a = guarded(["a", "b", "c", "d"]);
  assert.equal(lab.removeAt(a, 1), "b", "removeAt(['a','b','c','d'], 1) return value");
  assert.equal([...a], ["a", "c", "d"], "the array after removing index 1");
});
test("remove the first and the last value", () => {
  const a = guarded([1, 2, 3]);
  assert.equal(lab.removeAt(a, 2), 3, "removing the last value");
  assert.equal(lab.removeAt(a, 0), 1, "removing the first value");
  assert.equal([...a], [2], "what is left");
});
test("remove refuses invalid indexes, including any index of an empty array", () => {
  const a = guarded(["a", "b"]);
  for (const index of [2, -1, 0.5]) {
    assert.throws(() => lab.removeAt(a, index), RangeError, "removeAt(array of 2, " + index + ") should throw a RangeError");
  }
  assert.equal([...a], ["a", "b"], "the array after refused removals");
  assert.throws(() => lab.removeAt(guarded([]), 0), RangeError, "removeAt([], 0) should throw a RangeError");
});
test("indexOf finds the first match, or -1", () => {
  const a = guarded([5, 7, 5]);
  assert.equal(lab.indexOf(a, 5), 0, "indexOf([5,7,5], 5)");
  assert.equal(lab.indexOf(a, 7), 1, "indexOf([5,7,5], 7)");
  assert.equal(lab.indexOf(a, 9), -1, "indexOf([5,7,5], 9)");
});
`,
    timeoutMs: 2000,
    hints: [
      "Run the starter. After insertAt(songs, 1, 'NEW') the array holds 'verse' three times: values were overwritten before they moved.",
      "Copy from the end backwards: start at i = array.length and copy array[i - 1] into array[i], going down to index + 1.",
      "Valid insert indexes are 0..array.length; valid remove indexes are 0..array.length - 1. Number.isInteger rejects 1.5 and NaN.",
      "For removeAt: save array[index], copy each later value one slot left, then set array.length one smaller.",
    ],
  },
  {
    kind: "code",
    id: "stacks-queues",
    version: 1,
    subject: "structures",
    title: "Stacks and queues",
    summary: "Build a stack and a queue, prove LIFO and FIFO with tests, then use a stack to check brackets.",
    difficulty: "beginner",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "Your classes run for real; the tests push, pop, enqueue and dequeue on them and check the order that comes out.",
    objective: "Implement last-in-first-out and first-in-first-out behaviour, handle empty structures, and use a stack to solve a real problem.",
    problem: "An editor's undo history is a stack (the last change is undone first). A print spooler is a queue (the first document sent prints first). A code editor uses a stack to match brackets.",
    build: "Stack is done: read it. Fix Queue so dequeue returns the oldest item, and write balanced(text), which says whether every bracket ( [ { is closed in the right order.",
    canChange: "Everything in structures.js.",
    tools: "Run prints what comes out of each structure. Check verifies order, empty behaviour, separate instances and bracket matching.",
    verify: "Run: the starter's queue hands back the newest item first. That's a stack, not a queue.",
    success: "All tests pass: the stack is LIFO, the queue is FIFO, both return undefined when empty, and balanced() handles nesting and mismatches.",
    computer: runSteps,
    configs: [],
    terms: ["frame", "complexity"],
    related: [
      { label: "Playground: stacks and queues", path: "/practice/structures?structure=stack&op=push&value=7&index=0", kind: "playground" },
      { label: "Learn: choose the right structure", path: "/concepts/data-structures", kind: "learn" },
    ],
    stages: [{ track: "data-structures", stage: "choose-structure" }],
    file: "structures.js",
    starter: `class Stack {
  constructor() { this.items = []; }
  push(value) { this.items.push(value); }
  pop() { return this.items.pop(); }          // undefined when empty
  peek() { return this.items[this.items.length - 1]; }
  get size() { return this.items.length; }
}

class Queue {
  constructor() { this.items = []; }
  enqueue(value) { this.items.push(value); }
  // Should remove and return the OLDEST item (undefined when empty).
  dequeue() { return this.items.pop(); }
  peek() { return this.items[this.items.length - 1]; }
  get size() { return this.items.length; }
}

// balanced(text): true when every ( [ { is closed by the matching ) ] } in the right order.
function balanced(text) {
  // TODO: use a Stack. Push each opening bracket; on a closing bracket, pop and compare.
  return true;
}

const q = new Queue();
q.enqueue("first"); q.enqueue("second"); q.enqueue("third");
console.log("dequeue:", q.dequeue(), q.dequeue(), q.dequeue());
console.log("balanced('(a[b]{c})'):", balanced("(a[b]{c})"));
console.log("balanced('(]'):", balanced("(]"));
`,
    solution: `class Stack {
  constructor() { this.items = []; }
  push(value) { this.items.push(value); }
  pop() { return this.items.pop(); }
  peek() { return this.items[this.items.length - 1]; }
  get size() { return this.items.length; }
}

class Queue {
  constructor() { this.items = []; this.head = 0; }
  enqueue(value) { this.items.push(value); }
  dequeue() {
    if (this.head === this.items.length) return undefined;
    const value = this.items[this.head];
    this.items[this.head] = undefined; // let it be garbage collected
    this.head += 1;
    if (this.head === this.items.length) { this.items = []; this.head = 0; }
    return value;
  }
  peek() { return this.head < this.items.length ? this.items[this.head] : undefined; }
  get size() { return this.items.length - this.head; }
}

function balanced(text) {
  const pairs = { ")": "(", "]": "[", "}": "{" };
  const open = new Stack();
  for (const ch of text) {
    if (ch === "(" || ch === "[" || ch === "{") open.push(ch);
    else if (ch in pairs && open.pop() !== pairs[ch]) return false;
  }
  return open.size === 0;
}

const q = new Queue();
q.enqueue("first"); q.enqueue("second"); q.enqueue("third");
console.log("dequeue:", q.dequeue(), q.dequeue(), q.dequeue());
console.log("balanced('(a[b]{c})'):", balanced("(a[b]{c})"));
console.log("balanced('(]'):", balanced("(]"));
`,
    exports: ["Stack", "Queue", "balanced"],
    tests: `
test("a stack is last in, first out", () => {
  const s = new lab.Stack();
  s.push(1); s.push(2); s.push(3);
  assert.equal([s.pop(), s.pop(), s.pop()], [3, 2, 1], "pops after pushing 1, 2, 3");
});
test("an empty stack pops and peeks undefined", () => {
  const s = new lab.Stack();
  assert.equal(s.pop(), undefined, "pop() on an empty stack");
  assert.equal(s.peek(), undefined, "peek() on an empty stack");
  assert.equal(s.size, 0, "size of an empty stack");
});
test("a queue is first in, first out", () => {
  const q = new lab.Queue();
  q.enqueue("a"); q.enqueue("b"); q.enqueue("c");
  assert.equal([q.dequeue(), q.dequeue(), q.dequeue()], ["a", "b", "c"], "dequeues after enqueueing a, b, c");
});
test("peek shows the next item without removing it", () => {
  const q = new lab.Queue();
  q.enqueue(1); q.enqueue(2);
  assert.equal(q.peek(), 1, "queue peek()");
  assert.equal(q.size, 2, "queue size after peek()");
});
test("an empty queue dequeues undefined, and works again afterwards", () => {
  const q = new lab.Queue();
  assert.equal(q.dequeue(), undefined, "dequeue() on an empty queue");
  q.enqueue("x");
  assert.equal(q.dequeue(), "x", "dequeue() after enqueueing again");
  assert.equal(q.size, 0, "size after emptying");
});
test("mixed enqueues and dequeues keep arrival order", () => {
  const q = new lab.Queue();
  const out = [];
  q.enqueue(1); q.enqueue(2); out.push(q.dequeue());
  q.enqueue(3); out.push(q.dequeue()); q.enqueue(4);
  out.push(q.dequeue(), q.dequeue());
  assert.equal(out, [1, 2, 3, 4], "order out of an interleaved queue");
});
test("two queues don't share items", () => {
  const a = new lab.Queue(), b = new lab.Queue();
  a.enqueue("a");
  assert.equal(b.size, 0, "a new queue's size after enqueueing on another");
});
test("balanced() matches nested brackets", () => {
  for (const text of ["", "()", "([]{})", "(a[b]{c})", "{[()()]}"]) assert.equal(lab.balanced(text), true, "balanced(" + JSON.stringify(text) + ")");
});
test("balanced() rejects wrong order, extra closers and unclosed openers", () => {
  for (const text of ["(]", "([)]", ")(", "((", "{[}", "())"]) assert.equal(lab.balanced(text), false, "balanced(" + JSON.stringify(text) + ")");
});
`,
    timeoutMs: 2000,
    hints: [
      "pop() takes from the end of the array: the newest item. A queue needs the oldest, at the front.",
      "The simplest fix is this.items.shift(). It works, but moves every remaining item one slot left each time. Keeping a head index avoids the moving.",
      "For balanced(): push each opening bracket. On a closing bracket, pop and check that it's the matching opener. At the end, nothing may be left open.",
    ],
  },
  {
    kind: "code",
    id: "recursion",
    version: 1,
    subject: "structures",
    title: "Recursion and a real stack overflow",
    summary: "Watch a recursion without a base case overflow this browser's real call stack, then fix it and recurse into nested data.",
    difficulty: "intermediate",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "The stack overflow you'll see is real: the browser's engine stops the program when its call stack is full. Kitab doesn't draw the stack here; the Playground shows a simulated one.",
    objective: "Write a base case and a recursive case, understand what each call returns to the one that made it, and recognise a stack overflow.",
    problem: "Menus, folders and comment threads are nested: a folder holds files and folders. Code that walks them is naturally recursive, and one missing base case crashes it.",
    build: "Give sumTo(n) a base case (and refuse negative n with a RangeError), then write depth(value): 0 for a non-array, otherwise 1 more than the deepest item inside.",
    canChange: "Everything in recursion.js. The probe at the bottom measures this browser's real stack depth.",
    tools: "Run shows the real error and the measured stack limit. Check tests values, the base case, nested arrays and that sumTo really recurses.",
    verify: "Run the starter: it ends with RangeError: Maximum call stack size exceeded.",
    success: "All tests pass, including one that proves sumTo uses one stack frame per call (a huge n still overflows).",
    computer: [
      ...runSteps.slice(0, 3),
      { title: "Every call pushes a stack frame", detail: "Calling sumTo(3) pushes a frame holding n = 3, which calls sumTo(2), and so on. Each frame waits for the call it made to return.", observed: false },
      { title: "The base case starts the returns", detail: "sumTo(0) returns 0 without calling anything. Then sumTo(1) can finish (1 + 0), then sumTo(2) (2 + 1), and the frames pop in reverse.", observed: false },
      { title: "Without it, the stack fills", detail: "The engine reserves a fixed amount of stack memory. When frames fill it, it throws RangeError and unwinds every frame. The probe at the bottom measures how many calls fit here.", observed: true },
      ...runSteps.slice(4),
    ],
    configs: [
      {
        name: "Stack size",
        what: "How much memory a thread reserves for call frames.",
        why: "Every call needs space for its arguments, local variables and where to return to.",
        where: "Set by the runtime: node --stack-size, a thread's stack size in Java (-Xss) or C#, ulimit -s for native programs. Browsers choose their own and don't let pages change it.",
        who: "The runtime and operating system; for servers, whoever starts the process.",
        change: "In Node.js: node --stack-size=2000 app.js (in KB). In a browser: you can't.",
        verify: "Run the probe in this lab: it counts how many nested calls fit before the RangeError.",
        effect: "A bigger stack allows deeper recursion but uses more memory per thread. Deep recursion is usually better rewritten as a loop.",
        kitab: "Real: the overflow and the measured depth come from this browser's engine.",
      },
    ],
    terms: ["frame"],
    related: [
      { label: "Learn: recursion and the call stack", path: "/concepts/recursion", kind: "learn" },
      { label: "Playground: a recursion without a base case (simulated stack)", path: "/practice/structures?structure=recursion&fn=factorial&n=5&base=0&limit=8", kind: "playground" },
      { label: "Practice: with and without a base case", path: "/missions/recursion-base-case", kind: "practice" },
    ],
    stages: [{ track: "data-structures", stage: "recursion" }],
    file: "recursion.js",
    starter: `// sumTo(n): 1 + 2 + ... + n, recursively. sumTo(0) is 0. Negative n throws a RangeError.
function sumTo(n) {
  return n + sumTo(n - 1);
}

// depth(value): how deeply arrays are nested.
//   depth(5) = 0, depth([]) = 1, depth([1, 2]) = 1, depth([1, [2, [3]]]) = 3
function depth(value) {
  // TODO
}

// How many nested calls does this browser allow? A real measurement.
let deepest = 0;
function probe(level) { deepest = level; probe(level + 1); }
try { probe(1); } catch (error) { console.log(error.name + " after about " + deepest + " nested calls"); }

console.log("sumTo(3) =", sumTo(3));
console.log("depth([1, [2, [3]]]) =", depth([1, [2, [3]]]));
`,
    solution: `function sumTo(n) {
  if (n < 0) throw new RangeError("n must be 0 or more");
  if (n === 0) return 0;          // base case: no further call
  return n + sumTo(n - 1);        // recursive case: a smaller problem
}

function depth(value) {
  if (!Array.isArray(value)) return 0;
  let deepestChild = 0;
  for (const item of value) deepestChild = Math.max(deepestChild, depth(item));
  return 1 + deepestChild;
}

let deepest = 0;
function probe(level) { deepest = level; probe(level + 1); }
try { probe(1); } catch (error) { console.log(error.name + " after about " + deepest + " nested calls"); }

console.log("sumTo(3) =", sumTo(3));
console.log("depth([1, [2, [3]]]) =", depth([1, [2, [3]]]));
`,
    exports: ["sumTo", "depth"],
    tests: `
test("the base case: sumTo(0) is 0", () => {
  assert.equal(lab.sumTo(0), 0, "sumTo(0)");
});
test("small and larger sums", () => {
  assert.equal(lab.sumTo(1), 1, "sumTo(1)");
  assert.equal(lab.sumTo(3), 6, "sumTo(3)");
  assert.equal(lab.sumTo(100), 5050, "sumTo(100)");
});
// Engines word a stack overflow differently: V8 "Maximum call stack size exceeded", Firefox "too much recursion".
const overflow = (e) => e !== null && /call stack|too much recursion/i.test(String(e && e.message));
test("negative n is refused with a RangeError, not a stack overflow", () => {
  let error = null;
  try { lab.sumTo(-1); } catch (e) { error = e; }
  assert.ok(error instanceof RangeError, "sumTo(-1) should throw a RangeError");
  assert.ok(!overflow(error), "sumTo(-1) overflowed the stack instead of refusing n < 0 itself");
});
test("sumTo really recurses: one frame per call, so a huge n overflows", () => {
  let error = null;
  try { lab.sumTo(1e6); } catch (e) { error = e; }
  assert.ok(overflow(error), "sumTo(1000000) should overflow the stack (a loop wouldn't)");
});
test("depth of a non-array is 0", () => {
  assert.equal(lab.depth(5), 0, "depth(5)");
  assert.equal(lab.depth("text"), 0, "depth('text')");
});
test("depth of flat and nested arrays", () => {
  assert.equal(lab.depth([]), 1, "depth([])");
  assert.equal(lab.depth([1, 2]), 1, "depth([1, 2])");
  assert.equal(lab.depth([1, [2, [3]]]), 3, "depth([1, [2, [3]]])");
  assert.equal(lab.depth([[[]], [1]]), 3, "depth([[[]], [1]])");
});
`,
    timeoutMs: 3000,
    hints: [
      "Run the starter and read the last error: RangeError: Maximum call stack size exceeded. sumTo never stops calling itself.",
      "A base case returns without recursing. For sumTo, n === 0 returns 0.",
      "Check for n < 0 before the base case and throw new RangeError(\"n must be 0 or more\").",
      "depth: if the value isn't an array, return 0. Otherwise find the largest depth among its items and add 1.",
    ],
  },
  {
    kind: "code",
    id: "debugging",
    version: 1,
    subject: "structures",
    title: "Debug a binary search that never finishes",
    summary: "A search hangs on some inputs. Read the failure, form a hypothesis, test it with output, fix one line and verify.",
    difficulty: "intermediate",
    minutes: 20,
    modes: ["real-execution"],
    modeNote: "The hang is real: Kitab stops the run at the time limit. Output you add with console.log is real output from your program.",
    objective: "Practise a debugging loop: read the failure, inspect state, test one hypothesis at a time, change one thing, and verify the fix against every case.",
    problem: "A product catalogue uses binary search to find prices by id. Most lookups work, but some requests never finish and pile up until the server is restarted.",
    build: "Find and fix the bug in binarySearch. Don't rewrite it: the fix is one line.",
    canChange: "Everything in search.js. Adding console.log lines inside the loop is encouraged; output stops after 200 lines, which is fine.",
    tools: "Run executes the examples. Check tests found and missing values at every position, empty and one-item arrays, and stops a hanging test at the time limit.",
    verify: "1. Run and read the failure. 2. Print lo, mid and hi inside the loop. 3. Say why the loop can't end. 4. Change one line. 5. Run, then Check.",
    success: "Every test passes, and none of them hits the time limit.",
    computer: [
      ...runSteps.slice(0, 4),
      { title: "A loop that can't end keeps the CPU busy", detail: "The loop's condition stays true forever, so the Worker never finishes. The page stays responsive because the loop runs on the sandbox's thread, not the page's.", observed: true },
      { title: "The time limit stops it", detail: "After the limit, Kitab removes the sandbox. In a real server there is often no such limit, which is why one bad input can exhaust a whole server.", observed: true },
    ],
    configs: [sandboxConfig],
    terms: ["complexity"],
    related: [
      { label: "Learn: trees and search", path: "/concepts/trees", kind: "learn" },
      { label: "Practice: count comparisons in a search tree", path: "/missions/ds-bst-search", kind: "practice" },
    ],
    stages: [{ track: "data-structures", stage: "trees" }],
    file: "search.js",
    starter: `// binarySearch(sorted, target): the index of target in a sorted array, or -1.
function binarySearch(sorted, target) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] === target) return mid;
    if (sorted[mid] < target) lo = mid;
    else hi = mid - 1;
  }
  return -1;
}

const ids = [3, 8, 15, 21, 42];
console.log("find 15 ->", binarySearch(ids, 15));
console.log("find 42 ->", binarySearch(ids, 42));
`,
    solution: `function binarySearch(sorted, target) {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (sorted[mid] === target) return mid;
    // mid has been checked, so the next range must exclude it, or the range may never shrink.
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

const ids = [3, 8, 15, 21, 42];
console.log("find 15 ->", binarySearch(ids, 15));
console.log("find 42 ->", binarySearch(ids, 42));
`,
    exports: ["binarySearch"],
    tests: `
const ids = [3, 8, 15, 21, 42];
test("finds the middle value", () => {
  assert.equal(lab.binarySearch(ids, 15), 2, "binarySearch([3,8,15,21,42], 15)");
});
test("finds every value at every position", () => {
  ids.forEach((id, i) => assert.equal(lab.binarySearch(ids, id), i, "binarySearch([3,8,15,21,42], " + id + ")"));
});
test("missing values return -1: below, between and above", () => {
  for (const target of [1, 10, 50]) assert.equal(lab.binarySearch(ids, target), -1, "binarySearch([3,8,15,21,42], " + target + ")");
});
test("an empty array returns -1", () => {
  assert.equal(lab.binarySearch([], 7), -1, "binarySearch([], 7)");
});
test("a one-item array", () => {
  assert.equal(lab.binarySearch([7], 7), 0, "binarySearch([7], 7)");
  assert.equal(lab.binarySearch([7], 9), -1, "binarySearch([7], 9)");
});
test("a two-item array, both values", () => {
  assert.equal(lab.binarySearch([4, 9], 4), 0, "binarySearch([4, 9], 4)");
  assert.equal(lab.binarySearch([4, 9], 9), 1, "binarySearch([4, 9], 9)");
});
`,
    timeoutMs: 2000,
    hints: [
      "Run it. 'find 15' prints, then the run is stopped at the time limit: 'find 42' never returns.",
      "Add console.log(lo, mid, hi) as the first line inside the while loop and Run again. Look at the last lines before the output stops.",
      "Once lo is 3 and hi is 4, mid is 3 every time, and lo = mid sets lo to 3 again. The range never gets smaller.",
      "sorted[mid] has already been compared, so the next range should start after it: lo = mid + 1.",
    ],
  },
];
