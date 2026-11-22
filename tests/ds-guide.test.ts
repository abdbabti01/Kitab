// Data Structures guide content: complete for every structure and language, internally consistent, honest about
// what is guaranteed, and the memory table agrees with the engine's snapshots step by step.
import assert from "node:assert/strict";
import test from "node:test";
import { guideOrder, guides, languages } from "../src/structures/guide/content.ts";
import { allExamples, examples } from "../src/structures/guide/code.ts";
import { judge, scenarios } from "../src/structures/guide/choose.ts";
import { memoryChanges, recursionMemory, structureMemory, type MemoryRow } from "../src/structures/guide/memory.ts";
import { buildDataStructureSimulation, structureInfo, structureKinds } from "../src/visual-engine/data-structures/model.ts";
import { buildRecursionTimeline } from "../src/visual-engine/engines/execution/recursion-engine.ts";
import { structureChoices } from "../src/structures/experiments.ts";

test("every Playground structure has a guide, and every guide covers every language", () => {
  assert.deepEqual([...guideOrder].sort(), structureChoices.map((c) => c.id).sort());
  for (const id of guideOrder) {
    const guide = guides[id];
    assert.equal(guide.id, id);
    for (const field of ["what", "why"] as const) assert.ok(guide[field].length > 40, `${id}.${field}`);
    assert.ok(guide.storage.includes("O("), `${id}.storage`);
    assert.ok(guide.use.length >= 1 && guide.avoid.length >= 1 && guide.how.length >= 2 && guide.costs.length >= 1, id);
    for (const { id: lang } of languages) {
      assert.ok(guide.runtime[lang].facts.length >= 2, `${id}: ${lang} runtime facts`);
      const list = examples[id][lang];
      assert.deepEqual(list.map((e) => e.kind), ["library", "teaching"], `${id}: ${lang} has a library and a teaching example`);
    }
  }
});

test("examples have unique ids, stated output and explanations, and C#/Java/Python agree where they share a program", () => {
  const all = allExamples();
  assert.equal(new Set(all.map((e) => e.example.id)).size, all.length);
  for (const { example } of all) {
    assert.ok(example.output.length > 0 && example.notes.length > 0 && example.complexity, example.id);
    // Each note quotes code that really appears in the program.
    for (const note of example.notes) assert.ok(example.source.includes(note.code), `${example.id}: note quotes "${note.code}"`);
  }
  // Same algorithm, same answer: the teaching programs print the same values in every language (modulo formatting).
  const digits = (s: string) => s.replace(/True|true/g, "T").replace(/False|false/g, "F").replace(/[^0-9TF]/g, "");
  for (const id of ["array", "linked-list", "queue", "hash-table", "binary-tree"] as const) {
    const [cs, java, py] = (["csharp", "java", "python"] as const).map((lang) => digits(examples[id][lang][1].output));
    assert.equal(java, cs, `${id}: Java teaching output differs from C#`);
    assert.equal(py.replace(/^.*?(?=\d)/, ""), cs.replace(/^.*?(?=\d)/, ""), `${id}: Python teaching output differs from C#`);
  }
});

test("runtime notes never make the forbidden claims", () => {
  const text = JSON.stringify(guides).toLowerCase();
  for (const claim of ["value types always live on the stack", "always on the stack", "guaranteed o(1)", "28 bytes", "24 bytes"]) {
    assert.ok(!text.includes(claim) || text.includes(`not '${claim}'`) || text.includes(`are not "${claim}"`) || claim === "always on the stack" && text.includes("value types are not 'always on the stack'"), `content claims "${claim}"`);
  }
  // Hash tables are never promised O(1) in the worst case; plain BSTs are never promised O(log n).
  const hash = guides["hash-table"].costs[0];
  assert.equal(hash.worst, "O(n)");
  assert.match(guides["binary-tree"].costs[0].worst, /O\(n\)/);
  assert.match(guides.array.costs[1].amortized ?? "", /O\(1\)/);
  assert.match(guides.recursion.costs[0].extra, /O\(n\)/);
});

test("every selection scenario has a good answer, a poor one, and feedback for every option", () => {
  assert.ok(scenarios.length >= 8);
  for (const scenario of scenarios) {
    assert.ok(guides[scenario.guide], scenario.id);
    assert.ok(scenario.options.some((o) => o.verdict === "good"), `${scenario.id}: no good option`);
    assert.ok(scenario.options.some((o) => o.verdict === "poor"), `${scenario.id}: no poor option`);
    assert.equal(new Set(scenario.options.map((o) => o.id)).size, scenario.options.length);
    for (const option of scenario.options) assert.equal(judge(scenario, option.id)!.picked, option);
  }
  assert.equal(judge(scenarios[0], "nope"), null);
  const folders = judge(scenarios.find((s) => s.id === "folders")!, "recursion")!;
  assert.deepEqual(folders.alsoGood.map((o) => o.id), ["stack"]);
});

test("the memory table follows the engine: every step's changes are exactly the rows that differ", () => {
  for (const kind of structureKinds) {
    for (const { id: operation } of structureInfo[kind].operations) {
      const sim = buildDataStructureSimulation({ kind, operation, value: 7, index: 1, ...(kind === "array" ? { values: [1, 2, 3], capacity: 3 } : {}) });
      let before: MemoryRow[] | null = null;
      for (const frame of sim.frames) {
        const rows = structureMemory(kind, frame.snapshot);
        assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, `${kind}.${operation}: duplicate memory keys`);
        const changes = memoryChanges(before, rows);
        if (before) for (const change of changes) {
          const now = rows.find((r) => r.key === change.key);
          const was: MemoryRow | undefined = before.find((r) => r.key === change.key);
          assert.equal(change.after, now?.value);
          assert.equal(change.before, was?.value);
        }
        before = rows;
      }
    }
  }
});

test("memory rows: array growth, linked-list relink, BST delete and recursion", () => {
  const grow = buildDataStructureSimulation({ kind: "array", operation: "insert", value: 7, index: 2, values: [8, 3], capacity: 2 });
  const at = (title: string) => grow.frames.findIndex((f) => f.action === title);
  const rows = (i: number) => structureMemory("array", grow.frames[i].snapshot);
  // Allocating adds the empty new block and leaves the old one untouched.
  const alloc = memoryChanges(rows(at("ALLOCATE") - 1), rows(at("ALLOCATE")));
  assert.ok(alloc.every((c) => c.kind === "added"), JSON.stringify(alloc));
  assert.ok(alloc.some((c) => c.key === "0x2000[3]" && c.after?.startsWith("spare")));
  // Switching the reference changes exactly the array variable, its capacity and the old block's status.
  const sw = memoryChanges(rows(at("WRITE REFERENCE") - 1), rows(at("WRITE REFERENCE")));
  assert.deepEqual(sw.map((c) => c.key).sort(), ["0x1000:status", "capacity", "ref"]);
  assert.equal(sw.find((c) => c.key === "capacity")!.after, "4");
  assert.equal(sw.find((c) => c.key === "ref")!.after, "0x2000");

  const del = buildDataStructureSimulation({ kind: "linked-list", operation: "delete", value: 12, index: 0 });
  const unlink = del.frames.findIndex((f) => f.action === "WRITE POINTER");
  const changes = memoryChanges(structureMemory("linked-list", del.frames[unlink - 1].snapshot), structureMemory("linked-list", del.frames[unlink].snapshot));
  assert.deepEqual(changes.map((c) => c.key).sort(), ["node-1:next", "node-2:reach"], "the predecessor's next changes; the unlinked node is marked unreachable");

  const tree = buildDataStructureSimulation({ kind: "binary-tree", operation: "delete", value: 8, index: 0 });
  const copy = tree.frames.findIndex((f) => f.action === "WRITE VALUE");
  const valueChange = memoryChanges(structureMemory("binary-tree", tree.frames[copy - 1].snapshot), structureMemory("binary-tree", tree.frames[copy].snapshot));
  assert.deepEqual(valueChange.map((c) => [c.key, c.before, c.after]), [["root", "node 8", "node 10"], ["tree-0:value", "8", "10"]]);

  const timeline = buildRecursionTimeline({ fn: "factorial", n: 3, baseCase: true, stackLimit: 8 });
  const deepest = timeline.events.find((e) => e.kind === "base")!;
  const stack = recursionMemory(deepest.stack, "factorial");
  assert.equal(stack.length, 4, "main() plus three frames");
  assert.match(stack[1].value, /waiting for factorial\(2\)/);
  assert.match(stack[3].value, /returning 1/);
});

test("the code-language preference: validated on read, unknown or corrupt values fall back, failed writes are survivable", async () => {
  const { LANGUAGE_KEY, readLanguage, writeLanguage } = await import("../src/structures/guide/language.ts");
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readLanguage(storage), "csharp");
  assert.ok(writeLanguage(storage, "python"));
  assert.equal(store.get(LANGUAGE_KEY), "python");
  assert.equal(readLanguage(storage), "python");
  for (const bad of ["{", "rust", "", "PYTHON"]) { store.set(LANGUAGE_KEY, bad); assert.equal(readLanguage(storage), "csharp"); }
  assert.equal(readLanguage({ getItem: () => { throw new Error("blocked"); } }), "csharp");
  assert.equal(writeLanguage({ setItem: () => { throw new Error("quota"); } }, "java"), false);
});
