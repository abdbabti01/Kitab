// Behaviour baseline recorded before Phase 2 (explanations and journey UX).
// Phase 2 may add metadata to events but must not change what the network does:
// event order, acting device, hops, headers, state snapshots, outcomes, and each practice mission's starting run.
// Regenerate deliberately with BASELINE_WRITE=1 and justify every difference in the commit.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { scenarios } from "./support/network-scenarios.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import type { Trace } from "../src/practice/network/model.ts";

const file = new URL("./fixtures/network-baseline.json", import.meta.url);
const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 10);
/** One line per event: what happened, where, on which link, and a digest of its headers and state snapshot. */
const project = (t: Trace) => ({
  success: t.success,
  events: t.events.map((e) =>
    [e.title, e.actor, e.location, e.hop ? `${e.hop.from}>${e.hop.to}@${e.hop.link}` : "", e.error ? "error" : "", hash([e.layers, e.snapshot, e.dhcpContext ?? null])].join(" | "),
  ),
});

// Each mission version's first probe on its broken network: outcome, reason, length and where it stopped.
function missionStarts() {
  const out: Record<string, string> = {};
  for (const m of missions)
    for (const v of m.variants) {
      const t = runSequence(v.build(), [v.probe]);
      out[`${m.id}/${v.id}`] = [t.success, t.reason ?? "", t.events.length, t.events.at(-1)!.actor].join(" | ");
    }
  return out;
}

const current = () => ({
  scenarios: Object.fromEntries(scenarios().map((s) => [s.name, project(s.trace)])),
  missions: missionStarts(),
});

test("networking behaviour matches the recorded baseline", () => {
  const now = current();
  if (process.env.BASELINE_WRITE) writeFileSync(file, `${JSON.stringify(now, null, 1)}\n`);
  const recorded = JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof current>;
  assert.deepEqual(Object.keys(now.scenarios), Object.keys(recorded.scenarios));
  for (const [name, run] of Object.entries(recorded.scenarios)) {
    const actual = now.scenarios[name];
    assert.equal(actual.success, run.success, name);
    const at = run.events.findIndex((line, i) => actual.events[i] !== line);
    assert.equal(actual.events.length, run.events.length, `${name}: event count`);
    assert.equal(at, -1, `${name}: first difference at event ${at}\n  was: ${run.events[at]}\n  now: ${actual.events[at]}`);
  }
  assert.deepEqual(now.missions, recorded.missions);
});

test("the same input always produces the same trace", () => {
  const [a, b] = [scenarios(), scenarios()];
  for (const [i, s] of a.entries()) assert.deepEqual(project(s.trace), project(b[i].trace), s.name);
});
