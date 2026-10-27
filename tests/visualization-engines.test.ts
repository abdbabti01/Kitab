import assert from "node:assert/strict";
import test from "node:test";
import {
  assertVisualizationSpec,
  buildGraphLevels,
  engineKinds,
  executionStack,
  hasEngineEvidence,
  normalizeVisualization,
  selectEngineKind,
} from "../src/visual-engine/core/visualization-spec.ts";
import { visualizationForChapter } from "../src/visual-engine/lessons/curated-visualizations.ts";
import { chapters } from "../src/content/chapters.ts";
import { applyEnginePolicy, lessonMatchesConcept } from "../worker/index.ts";

const expectedCuratedEngines = {
  tcp: "protocol",
  "web-request": "request",
  dns: "request",
  "data-structures": "memory",
  arrays: "memory",
  "linked-lists": "memory",
  recursion: "execution",
  "hash-tables": "memory",
  trees: "tree",
  "database-indexes": "tree",
  "processes-threads": "concurrency",
  "message-queues": "distributed",
  "state-machines": "state-machine",
} as const;

test("every curated concept resolves to a valid specialized engine", () => {
  for (const [slug, engine] of Object.entries(expectedCuratedEngines)) {
    const chapter = {
      slug,
      title: slug,
      family: "Computer science",
      mode: "network",
      summary: "summary",
      analogy: "analogy",
      experiment: "experiment",
      normal: "normal",
      changed: "changed",
      steps: Array.from({ length: slug === "dns" ? 6 : 4 }, (_, index) => ({
        title: `Step ${index + 1}`,
        detail: `Detail ${index + 1}`,
        state: `State ${index + 1}`,
      })),
    };
    const spec = visualizationForChapter(chapter as never);
    assert.equal(spec.engine, engine);
    assert.equal(spec.events.length, chapter.steps.length);
    assert.doesNotThrow(() => assertVisualizationSpec(spec));
  }
});

test("explicit generated engine choices cover all renderer families", () => {
  for (const engine of engineKinds) {
    assert.equal(selectEngineKind({ engine }), engine);
  }
});

test("semantic evidence overrides an incorrect AI engine suggestion", () => {
  assert.equal(
    selectEngineKind({
      engine: "protocol",
      title: "Data Structures",
      category: "Computer Science",
    }),
    "memory",
  );
  assert.equal(
    selectEngineKind({ engine: "memory", title: "TCP congestion control" }),
    "protocol",
  );
});

test("a themed catalog CRUD story is rejected as a data-structures lesson", () => {
  const badDraft = {
    schemaVersion: 2,
    title: "Data Structures",
    category: "Computer Science",
    level: "Beginner",
    summary: "Manage books in a library catalog.",
    analogy: "A librarian adds and removes books.",
    sections: [
      { heading: "Add Book", body: "Add a book to the catalog." },
      { heading: "Search Book", body: "Find a book in the catalog." },
      { heading: "Delete Book", body: "Delete a book from the catalog." },
    ],
    terms: [
      { term: "Book", definition: "A catalog item." },
      { term: "Library", definition: "Stores books." },
      { term: "Catalog", definition: "Organizes book titles." },
    ],
    visualization: {
      engine: "protocol",
      title: "Library catalog",
      actors: [
        { label: "Library", role: "Stores books" },
        { label: "Catalog", role: "Lists titles" },
      ],
      links: [{ from: 0, to: 1, label: "contains" }],
      events: Array.from({ length: 4 }, (_, index) => ({
        from: 0,
        to: 1,
        label: `Catalog action ${index + 1}`,
        detail: "Change a book record.",
        state: "Catalog updated",
        payload: "Book title",
      })),
    },
    tryIt: ["Add a book", "Find a book", "Delete a book"],
  } as const;
  const governed = applyEnginePolicy("data structure", badDraft as never);
  assert.equal(governed.visualization.engine, "memory");
  assert.equal(lessonMatchesConcept("data structure", governed), false);
  assert.equal(hasEngineEvidence("memory", "array slots, linked nodes and hash buckets", 2), true);
  assert.equal(hasEngineEvidence("memory", "add and delete books in a library catalog"), false);
});

test("older cached visualization types are routed by their mechanism", () => {
  assert.equal(selectEngineKind({ type: "flow", title: "HTTP request" }), "request");
  assert.equal(selectEngineKind({ type: "network", title: "UDP datagram" }), "protocol");
  assert.equal(selectEngineKind({ type: "stack", title: "Recursive call" }), "execution");
  assert.equal(selectEngineKind({ type: "tree", title: "B-tree index" }), "tree");
  assert.equal(selectEngineKind({ type: "timeline", title: "Thread scheduler" }), "concurrency");
  assert.equal(selectEngineKind({ type: "cycle", title: "Object lifecycle" }), "state-machine");
});

test("generated data is normalized into bounded safe references", () => {
  const spec = normalizeVisualization(
    {
      engine: "distributed",
      title: "Service flow",
      actors: [
        { label: "Browser", role: "Caller" },
        { label: "API", role: "Handles the call" },
      ],
      links: [{ from: 0, to: 99, label: "invalid and ignored" }, { from: 0, to: 1, label: "HTTP" }],
      events: [{ from: -4, to: 99, label: "Call", detail: "Send request", state: "Received", payload: "GET" }],
    },
    { title: "API" },
  );
  assert.equal(spec.events[0].from, "actor-0");
  assert.equal(spec.events[0].to, "actor-1");
  assert.equal(spec.links.length, 1);
  assert.doesNotThrow(() => assertVisualizationSpec(spec));
});

test("tree layout assigns every actor once even when links contain a cycle", () => {
  const spec = normalizeVisualization(
    {
      engine: "tree",
      actors: [
        { label: "A", role: "root" },
        { label: "B", role: "child" },
        { label: "C", role: "child" },
      ],
      links: [
        { from: 0, to: 1, label: "left" },
        { from: 1, to: 2, label: "next" },
        { from: 2, to: 0, label: "cycle" },
      ],
      events: [{ from: 0, to: 1, label: "Visit", detail: "Traverse", state: "Visited", payload: "A→B" }],
    },
    { title: "Graph" },
  );
  const ids = buildGraphLevels(spec).flat();
  assert.equal(ids.length, spec.actors.length);
  assert.equal(new Set(ids).size, spec.actors.length);
});

test("the generic execution renderer pushes on calls and pops on returns", () => {
  const recursion = chapters.find((chapter) => chapter.slug === "recursion")!;
  const spec = visualizationForChapter(recursion);
  const stacks = spec.events.map((_, index) => executionStack(spec, index));
  assert.deepEqual(stacks.map((stack) => stack.length), [2, 3, 4, 4, 1]);
  assert.deepEqual(stacks.at(-1), ["caller"]);
  // A synthetic trace: call, call, return, call, return, return.
  const synthetic = { ...spec, events: [["a", "b"], ["b", "c"], ["c", "b"], ["b", "d"], ["d", "b"], ["b", "a"]].map(([from, to], index) => ({ id: String(index), from, to, label: "", detail: "", state: "" })) };
  assert.deepEqual(synthetic.events.map((_, index) => executionStack(synthetic, index).join(">")), ["a>b", "a>b>c", "a>b", "a>b>d", "a>b", "a"]);
});

test("generic memory actors are never given invented addresses", () => {
  for (const chapter of chapters) {
    const spec = visualizationForChapter(chapter);
    if (spec.engine !== "memory") continue;
    const mentioned = JSON.stringify(spec).match(/0x[0-9A-F]+/gi) ?? [];
    // Addresses may appear only where the reviewed blueprint wrote them.
    for (const address of mentioned) assert.ok(JSON.stringify(spec.actors).includes(address), address);
  }
});

test("a trusted server engine choice is not re-derived on the client", () => {
  const spec = normalizeVisualization({ engine: "tree", title: "Binary search", actors: [{ label: "Array", role: "sorted array of slots" }, { label: "Middle", role: "index" }], events: [{ from: 0, to: 1, label: "Probe", detail: "Compare with the middle index", state: "Half discarded", payload: "mid" }] }, { title: "binary search", trustedEngine: "tree" });
  assert.equal(spec.engine, "tree");
  assert.equal(normalizeVisualization({ actors: [{ label: "Array", role: "array slots" }, { label: "x", role: "y" }] }, { title: "array memory" }).engine, "memory");
});
