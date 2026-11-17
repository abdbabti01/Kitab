import test from "node:test";
import assert from "node:assert/strict";
import { diagnostics, isStaleChunk } from "../src/app/diagnostics.ts";

test("a page chunk missing after a deploy is recognised in every browser's words, and nothing else is", () => {
  for (const message of [
    "Failed to fetch dynamically imported module: https://kitab.lesdeserts.ca/assets/ChallengePage-Unk5fgjO.js",
    "error loading dynamically imported module: https://kitab.lesdeserts.ca/assets/LabPage-x.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /assets/architecture-abc.css",
    "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
  ]) assert.equal(isStaleChunk(new Error(message)), true, message);
  for (const message of ["Cannot read properties of undefined (reading 'busyArea')", "Invariant: component \"sql-1\" is not part of this run"]) assert.equal(isStaleChunk(new Error(message)), false);
  assert.equal(isStaleChunk("Failed to fetch dynamically imported module"), false, "only errors");
});

test("diagnostics carry the build, page, area, kind and a bounded message, and nothing else", () => {
  const d = diagnostics(new Error("x".repeat(1000)), "architecture-run", "/practice/architecture");
  assert.deepEqual(Object.keys(d).sort(), ["area", "build", "kind", "message", "page"]);
  assert.equal(d.kind, "render");
  assert.equal(d.message.length, 300);
  assert.equal(d.build, "dev");
});
