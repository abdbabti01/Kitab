import test from "node:test";
import assert from "node:assert/strict";
import { deleteDesign, DESIGNS_KEY, loadDesigns, saveDesign, updateDesign } from "../src/architecture/persistence.ts";
import { newDesign } from "../src/architecture/model.ts";

let n = 0;
const fresh = () => newDesign("Untitled design", `d-test-${++n}`);

// Saved architecture designs: autosave never brings back a deleted design, and a list written by another Kitab
// version, or one that can't be read, is never overwritten without a whole copy kept aside.

const memory = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

test("autosave updates a saved design and never re-creates one deleted elsewhere", () => {
  const s = memory();
  const design = fresh();
  assert.equal(saveDesign(s, design), true);
  assert.equal(updateDesign(s, { ...design, name: "Edited" }), "saved");
  assert.equal(loadDesigns(s).designs[0].name, "Edited");
  // Another tab deletes it; this tab's next autosave must not bring it back.
  deleteDesign(s, design.id);
  assert.equal(updateDesign(s, { ...design, name: "Edited again" }), "gone");
  assert.deepEqual(loadDesigns(s).designs, []);
});

test("a design list from another Kitab version is never written", () => {
  const newer = JSON.stringify({ version: 2, designs: [{ id: "d-future" }] });
  const s = memory({ [DESIGNS_KEY]: newer });
  assert.equal(saveDesign(s, fresh()), false);
  assert.equal(deleteDesign(s, "d-future"), false);
  assert.equal(s.data.get(DESIGNS_KEY), newer);
});

test("an unreadable design list is kept aside whole before anything is saved over it", () => {
  const big = `{broken ${"x".repeat(600_000)}`;
  const s = memory({ [DESIGNS_KEY]: big });
  assert.equal(saveDesign(s, fresh()), true);
  assert.equal(s.data.get(`${DESIGNS_KEY}.corrupt`), big, "the whole text, not 500 KB of it");
  const refusing = { getItem: (k: string) => (k === DESIGNS_KEY ? big : null), setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
  assert.equal(saveDesign(refusing, fresh()), false);
});
