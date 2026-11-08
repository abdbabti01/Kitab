import test from "node:test";
import assert from "node:assert/strict";
import { sameConfiguration } from "../src/practice/network/editing.ts";
import { starter } from "../src/practice/network/starters.ts";
test("position-only undo keeps the simulation, while IP and cable edits invalidate it", () => {
  const a = starter("internet"),
    b = structuredClone(a);
  b.devices[0].x += 100;
  b.devices[0].y -= 20;
  assert.equal(sameConfiguration(a, b), true);
  b.devices[0].interfaces[0].prefix = 25;
  assert.equal(sameConfiguration(a, b), false);
  const c = structuredClone(a);
  c.links.pop();
  assert.equal(sameConfiguration(a, c), false);
});
