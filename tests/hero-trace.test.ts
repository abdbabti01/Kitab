// The homepage's demonstration is a recording of the simulator, not an illustration: the file it loads must equal
// what the engine produces now, and every crossing it animates must be a real hop on a real link.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { heroTrace } from "../src/practice/network/hero.ts";
import { starter } from "../src/practice/network/starters.ts";

const file = JSON.parse(fs.readFileSync(new URL("../src/app/hero-trace.json", import.meta.url), "utf8"));

test("the homepage's recording is exactly what the engine produces (npm run hero-trace rewrites it)", () => {
  assert.deepEqual(file, heroTrace());
});

test("every crossing it animates joins two devices that share a link, through the router in the middle", () => {
  const network = starter("routed");
  for (const c of file.crossings) {
    assert.ok(network.links.some((l) => [l.a.device, l.b.device].sort().join() === [c.from, c.to].sort().join()), `${c.from} → ${c.to}`);
    assert.ok(file.devices.some((d: { id: string }) => d.id === c.from) && file.devices.some((d: { id: string }) => d.id === c.to));
  }
  // A sender, an intermediate device and a destination: the PC never reaches the server directly.
  assert.ok(!file.crossings.some((c: { from: string; to: string }) => [c.from, c.to].sort().join() === "pc,server"));
  assert.ok(file.crossings.some((c: { from: string }) => c.from === "router"));
  assert.ok(file.crossings.length >= 6 && file.events > file.crossings.length);
});
