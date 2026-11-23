// What a concept page (Learn) adds around its reading: one small demonstration, where to explore further, a common
// misconception and a short understanding check. Pure data.
//
// One source of truth: a data-structures demonstration is a fixed setup run by the same engine as the Playground,
// and its "Explore" link opens the Playground on exactly that setup. Nothing here re-describes an algorithm.
import { experiments, setupPath, type Setup } from "../structures/experiments.ts";
import { buildRecursionTimeline } from "../visual-engine/engines/execution/recursion-engine.ts";

export type CheckOption = { id: string; text: string; correct?: true; feedback: string };
export type UnderstandingCheck = { question: string; options: CheckOption[] };
export type ConceptLearn = {
  /** Short explanations shown before the demonstration, when the chapter's own steps are not the right outline. */
  sections?: { heading: string; body: string[]; code?: string }[];
  /** How many of `sections` come before the demonstration (the rest follow it). */
  demoAfter?: number;
  /** An engine-computed demonstration of one operation, from a fixed setup. */
  demo?: Setup;
  /** Where to explore the concept freely. Data-structures pages derive it from `demo`. */
  explore?: { label: string; detail: string; path: string };
  misconception?: { myth: string; truth: string };
  check?: UnderstandingCheck;
};

const experiment = (id: string) => experiments.find((e) => e.id === id)!.setup;

/** The recursion lesson's one example, also opened in the Playground: factorial(3) with its base case. */
export const recursionDemo: Setup = { structure: "recursion", fn: "factorial", n: 3, baseCase: true, stackLimit: 8 };

export const conceptLearn: Record<string, ConceptLearn> = {
  recursion: {
    sections: [
      {
        heading: "What recursion is",
        body: ["A recursive function solves a problem by calling itself on a smaller version of the same problem. factorial(3) is 3 × factorial(2), and factorial(2) is 2 × factorial(1)."],
        // Kitab's engine uses n <= 1, so the lesson, the Playground and the missions all run the same rule.
        code: "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)",
      },
      {
        heading: "Why a function can call itself",
        body: ["Each call is a new invocation of the same code, with its own parameter values. factorial(3) and factorial(2) are two separate calls: one has n = 3, the other n = 2. The runtime tracks every unfinished call in a call frame: its arguments, its local variables and where to continue when the call it made returns."],
      },
      {
        heading: "The base case stops it",
        body: ["The base case is an input small enough to answer directly, without another call. Here it is n <= 1: factorial(1) returns 1. Every recursive call must move closer to it."],
      },
      {
        heading: "Waiting, then returning",
        body: [
          "factorial(3) reaches n * factorial(n - 1) and cannot multiply until factorial(2) answers. So it waits, with n = 3 still in its frame. factorial(2) waits for factorial(1) in the same way.",
          "When the base case returns 1, each waiting call resumes in turn: factorial(2) computes 2 × 1 = 2 and returns it, then factorial(3) computes 3 × 2 = 6. The last call made is the first to return.",
        ],
      },
      {
        heading: "Stack overflow",
        body: ["Every waiting call keeps its frame. If no base case is reached, calls never stop, frames pile up and the runtime refuses to make another call: a stack overflow. Python raises RecursionError when its recursion limit is reached, Java throws StackOverflowError, and in .NET a stack overflow ends the process."],
      },
      {
        heading: "When recursion is useful",
        body: ["When the data is recursive itself: folders inside folders, trees, nested JSON, and divide-and-conquer algorithms such as merge sort. For a simple count like factorial, a loop does the same work without keeping a frame per step."],
      },
    ],
    demoAfter: 4,
    demo: recursionDemo,
    misconception: {
      myth: "All the calls share one n, so factorial(3) loses its n = 3 when it calls factorial(2).",
      truth: "Each call has its own n. factorial(3)'s frame still holds n = 3 while it waits, which is why it can finish 3 × 2 = 6 later.",
    },
    check: {
      question: "What happens if you delete the base case (if n <= 1: return 1) and call factorial(3)?",
      options: [
        { id: "zero", text: "It returns 0", feedback: "No call ever returns a value: without the base case, no call can answer without calling again." },
        { id: "overflow", text: "The calls never stop, frames pile up, and the runtime stops the program with a stack overflow", correct: true, feedback: "Right. Each call makes another, and every waiting call keeps its frame until the runtime's limit is reached." },
        { id: "same", text: "It still returns 6, only more slowly", feedback: "The base case is where the first value comes from. Without it there is no 1 to multiply, so nothing returns." },
      ],
    },
  },
  arrays: {
    demo: experiment("array-insert-middle"),
    misconception: {
      myth: "Inserting into an array is instant: you just put the value at its index.",
      truth: "That slot is already taken. Every later value is copied one slot right first, so inserting near the front of n values costs about n copies. Appending to a dynamic array with spare capacity is the cheap case; when the block is full it is copied into a bigger one.",
    },
    check: {
      question: "An array holds 1,000 values and has spare capacity. Which operation copies the most values?",
      options: [
        { id: "read", text: "Reading index 500", feedback: "Reading copies nothing: one address calculation (start + 500 × size) finds the slot." },
        { id: "front", text: "Inserting at index 0", correct: true, feedback: "Right. All 1,000 values move one slot right before the new value is written." },
        { id: "append", text: "Appending at the end", feedback: "With spare capacity, appending is one write into the next free slot." },
      ],
    },
  },
  "linked-lists": {
    demo: experiment("list-insert-head"),
    misconception: {
      myth: "A linked list reaches the 500th value as fast as an array does.",
      truth: "There is no address formula. Reaching position i means following i next pointers from HEAD, so it takes O(n). Relinking is cheap once you are at the right node; getting there is the cost.",
    },
    check: {
      question: "You delete the node holding 12 from the middle of a singly linked list. What does the program write?",
      options: [
        { id: "shift", text: "It moves every later value one place to the left", feedback: "That is what an array does. A list's nodes stay where they are." },
        { id: "pointer", text: "One pointer: the node before 12 now points to the node after it", correct: true, feedback: "Right. One pointer write skips the node; nothing else moves." },
        { id: "null", text: "Nothing: setting the node's value to null removes it", feedback: "The node would still be linked, and the walk would still visit it." },
      ],
    },
  },
  "hash-tables": {
    demo: experiment("hash-collision"),
    misconception: {
      myth: "A hash table always finds a key in one step.",
      truth: "Only on average, when keys spread across the buckets and the load factor stays low. Keys that collide share a bucket and each must be compared. If every key lands in one bucket, a lookup checks them all: O(n).",
    },
    check: {
      question: "A table with 7 buckets puts each key in bucket key mod 7. Which keys share a bucket with 15?",
      options: [
        { id: "8-22", text: "8 and 22", correct: true, feedback: "Right. 15, 8 and 22 all leave remainder 1, so all three land in bucket 1." },
        { id: "16-17", text: "16 and 17", feedback: "16 mod 7 = 2 and 17 mod 7 = 3: different buckets. Close keys don't have to collide." },
        { id: "none", text: "None: every key gets its own bucket", feedback: "With 7 buckets and more than 7 possible keys, some keys must share a bucket." },
      ],
    },
  },
  trees: {
    demo: experiment("bst-search"),
    misconception: {
      myth: "A binary search tree always finds a value in O(log n).",
      truth: "Only when it is balanced. Insert values in sorted order and each new node becomes the right child of the last: the tree is a chain and a search takes O(n). Self-balancing trees (red-black, AVL) keep the height near log n.",
    },
    check: {
      question: "A binary search tree has 8 at the root, 4 on its left and 12 on its right. You search for 10. Where does the search go after comparing with 8?",
      options: [
        { id: "left", text: "Left, to 4", feedback: "Values smaller than 8 are on the left. 10 is greater than 8." },
        { id: "right", text: "Right, to 12", correct: true, feedback: "Right. 10 > 8, so only the right subtree can hold it; the left subtree is never visited." },
        { id: "both", text: "Both ways, to be sure", feedback: "The ordering rule means only one subtree can hold 10; that is what makes the search fast." },
      ],
    },
  },
  "data-structures": {
    explore: { label: "Explore a stack and a queue in the Playground", detail: "Remove an item from each and compare who leaves first.", path: setupPath(experiment("stack-vs-queue"), "/concepts/data-structures") },
    misconception: {
      myth: "There is one best data structure, and good programmers always use it.",
      truth: "Each structure makes some operations cheap by making others expensive. Choose by the operations the program performs most: indexed reads, key lookups, insertions at one end, ordered traversal.",
    },
    check: {
      question: "A printer must print documents in the order they were sent. Which structure fits?",
      options: [
        { id: "queue", text: "A queue", correct: true, feedback: "Right. First in, first out: the oldest document is printed next." },
        { id: "stack", text: "A stack", feedback: "A stack hands back the newest item first: the last document sent would print first." },
        { id: "hash", text: "A hash table", feedback: "A hash table finds items by key; it keeps no order of arrival." },
      ],
    },
  },
  dns: {
    explore: { label: "Load a page across the Internet in the Network Playground", detail: "Watch the DNS query go out before the web request, then change a setting and send again.", path: "/practice/network?starter=internet" },
    misconception: {
      myth: "Every page load asks the root name servers.",
      truth: "Answers are cached by the browser, the operating system and the recursive resolver for as long as their TTL allows. The root, TLD and authoritative servers are asked only when no cache holds a fresh answer.",
    },
    check: {
      question: "Your recursive resolver already holds a fresh answer for kitab.test. Who does it ask?",
      options: [
        { id: "cache", text: "No one: it answers from its cache", correct: true, feedback: "Right. Until the TTL runs out, the cached answer is returned directly." },
        { id: "root", text: "A root server first, then the TLD server", feedback: "That chain is followed only when no cache holds a fresh answer." },
        { id: "auth", text: "The authoritative server, to check the answer", feedback: "A fresh cached answer is trusted until its TTL expires; that is what the TTL is for." },
      ],
    },
  },
  "web-request": {
    explore: { label: "Send a request across the Internet in the Network Playground", detail: "Follow DNS, the router, the provider and the server's reply, one step at a time.", path: "/practice/network?starter=internet" },
    misconception: {
      myth: "Once DNS has answered, the page is as good as loaded.",
      truth: "DNS only finds the address. The browser still connects (TCP, then TLS), sends the HTTP request, waits for the server's application and its database, then lays out and paints the page. Any of those can be the slow part.",
    },
    check: {
      question: "A page loads slowly, but the DNS lookup and the connection were both quick. Where do you look next?",
      options: [
        { id: "server", text: "The server: its application code and database queries", correct: true, feedback: "Right. Time spent between the request arriving and the response leaving is the server's." },
        { id: "dns", text: "DNS again: it must have been slower than it looked", feedback: "The timing already shows DNS was quick. Look at the parts that weren't measured as fast." },
        { id: "nothing", text: "Nowhere: a slow page is just the network", feedback: "The network was quick here. The remaining time is spent on the server or in rendering." },
      ],
    },
  },
  "message-queues": {
    explore: { label: "Run a queue with workers in the Architecture Playground", detail: "Accept orders, then change the number of workers and watch the queue.", path: "/practice/architecture?template=async-orders" },
  },
};

/** The Explore action of a concept page: an explicit one, or the Playground opened on the page's demonstration. */
export function exploreFor(slug: string): ConceptLearn["explore"] {
  const learn = conceptLearn[slug];
  if (!learn) return undefined;
  if (learn.explore) return learn.explore;
  if (!learn.demo) return undefined;
  const from = `/concepts/${slug}`;
  if (learn.demo.structure === "recursion") return { label: "Explore recursion in the Playground", detail: "Change n, remove the base case or lower the stack limit, and step through every frame.", path: setupPath(learn.demo, from) };
  const detail = learn.demo.structure === "array"
    ? "Change the values, the index and the capacity; fill the block and watch it grow."
    : "Change the values and the operation, and inspect memory step by step.";
  return { label: "Explore this in the Playground", detail, path: setupPath(learn.demo, from) };
}

export type RecursionStep = {
  id: string;
  /** One line of the call sequence, indented by `depth`. */
  line: string;
  depth: number;
  explain: string;
  /** The conceptual call frames after this step, top of the stack first; main() is always last. */
  frames: { label: string; detail: string; current: boolean }[];
};

/**
 * The recursion lesson's call-and-return sequence, read from the recursion engine's own events: the same timeline the
 * Playground and the missions show, told in fewer, plainer steps (each call, the base case, each return).
 */
export function recursionSteps(config: Parameters<typeof buildRecursionTimeline>[0]): RecursionStep[] {
  const timeline = buildRecursionTimeline(config);
  const fn = timeline.config.fn;
  const op = fn === "factorial" ? "×" : "+";
  const name = (n: number) => `${fn}(${n})`;
  const steps: RecursionStep[] = [];
  for (const event of timeline.events) {
    const top = event.stack.at(-1);
    const frames = [...event.stack].reverse().map((frame, i) => ({
      label: name(frame.n),
      detail: `n = ${frame.n} · ${frame.status === "waiting" ? "waiting" : frame.status === "returning" ? `result ${frame.returnValue}` : "running"}`,
      current: i === 0,
    }));
    const withMain = (main: string) => [...frames, { label: "main()", detail: main, current: frames.length === 0 }];
    if (event.kind === "call" && top) {
      const waiting = event.stack.slice(0, -1).map((f) => name(f.n));
      steps.push({
        id: event.id,
        line: `${name(top.n)} is called`,
        depth: event.stack.length - 1,
        explain: timeline.config.baseCase && top.n <= 1
          ? `A new call with its own n = ${top.n}. ${waiting.join(" and ")} ${waiting.length > 1 ? "are" : "is"} still waiting.`
          : `A new call with its own n = ${top.n}. n is not ≤ 1, so it needs ${name(top.n - 1)} first: it calls it and waits for the answer.`,
        frames: withMain(`waiting for ${name(timeline.config.n)}`),
      });
    } else if (event.kind === "base" && top) {
      steps.push({ id: event.id, line: `${name(top.n)} returns 1 (base case)`, depth: event.stack.length - 1, explain: "n ≤ 1: the base case. It answers directly, without another call, so the calls stop here.", frames: withMain(`waiting for ${name(timeline.config.n)}`) });
    } else if (event.kind === "return" && event.returned) {
      const received = event.returned.value;
      if (top) {
        steps.push({ id: event.id, line: `${name(top.n)} computes ${top.n} ${op} ${received} = ${top.returnValue}`, depth: event.stack.length - 1, explain: `The call it waited for returned ${received}, so ${name(top.n)} resumes where it stopped and finishes n ${op} ${fn}(n - 1): ${top.n} ${op} ${received} = ${top.returnValue}.`, frames: withMain(`waiting for ${name(timeline.config.n)}`) });
      } else {
        steps.push({ id: event.id, line: `${name(timeline.config.n)} returns ${received} to main()`, depth: 0, explain: `Every call has finished, in the reverse order they were made. main() receives ${received}.`, frames: withMain(`received ${received}`) });
      }
    } else if (event.kind === "overflow") {
      steps.push({ id: event.id, line: "Stack overflow", depth: event.stack.length - 1, explain: event.explanation, frames: withMain("crashed") });
    }
  }
  return steps;
}
