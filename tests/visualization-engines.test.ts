import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertVisualizationSpec,
  buildGraphLevels,
  engineKinds,
  hasEngineEvidence,
  normalizeVisualization,
  selectEngineKind,
} from "../src/visual-engine/core/visualization-spec.ts";
import { visualizationForChapter } from "../src/visual-engine/lessons/curated-visualizations.ts";
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

test("the home page exposes one reviewed example for every engine", () => {
  const home = readFileSync(new URL("../src/v2-app.tsx", import.meta.url), "utf8");
  const examples = [
    "Protocols",
    "Request pipelines",
    "Memory & data structures",
    "Trees & graphs",
    "Execution & call stacks",
    "Concurrency",
    "Distributed systems",
    "State machines",
  ];
  examples.forEach((label) => assert.ok(home.includes(`label: "${label}"`), `Missing visible engine: ${label}`));
  assert.match(home, /id="engines"/);
  assert.match(home, /data-engine=\{item\.id\}/);
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

test("engine layouts use document flow and responsive contracts", () => {
  const css = readFileSync(new URL("../src/visual-engine/engines/engine-canvas.css", import.meta.url), "utf8");
  const component = readFileSync(new URL("../src/visual-engine/engines/EngineCanvas.tsx", import.meta.url), "utf8");
  for (const breakpoint of [980, 620, 420]) assert.match(css, new RegExp(`max-width:${breakpoint}px`));
  assert.doesNotMatch(css, /position:(?:absolute|fixed)/);
  assert.doesNotMatch(css, /height:calc\([^;]*100vh/i);
  assert.match(css, /minmax\(0,1fr\)/);
  assert.match(component, /aria-live="polite"/);
  for (const engine of engineKinds) assert.ok(component.includes(`spec.engine === "${engine}"`));
});

test("Workers AI is constrained to semantic engine data", () => {
  const worker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  for (const engine of engineKinds) assert.ok(worker.includes(`"${engine}"`));
  assert.match(worker, /Do not generate drawing coordinates, CSS, SVG, HTML or executable code/);
  assert.match(worker, /required: \["engine", "title", "actors", "links", "events"\]/);
  assert.match(worker, /schemaVersion/);
  assert.match(worker, /Ignoring stale or off-topic generated lesson/);
  assert.match(worker, /applyEnginePolicy\(concept/);
});
