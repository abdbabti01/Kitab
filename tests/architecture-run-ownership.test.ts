import test from "node:test";
import assert from "node:assert/strict";
import { build } from "../src/architecture/templates.ts";
import { simulate } from "../src/architecture/simulate.ts";
import { slotLimits, utilisation } from "../src/architecture/metrics.ts";
import { challengeDesign, findChallenge } from "../src/architecture/challenges.ts";
import { foldAt } from "../src/architecture/ui/useRun.ts";

// A run's fold describes the design that run simulated, and nothing else. Production crashed with "Cannot read
// properties of undefined (reading 'busyArea')" when a rerun of the simple-web-app challenge (a database added
// after the first run) was paired with the first run's fold: the selected database was not in it.

const apiOnly = build("notes", [["client-1", "client", "Users", 0, 0, { rps: 30, writePercent: 20 }], ["api-1", "api", "API", 0, 0]], [["client-1", "api-1"]], { durationS: 2 });
const withDb = build("notes", [["client-1", "client", "Users", 0, 0, { rps: 30, writePercent: 20 }], ["api-1", "api", "API", 0, 0], ["sql-1", "sql", "DB", 0, 0]], [["client-1", "api-1"], ["api-1", "sql-1"]], { durationS: 2 });

test("a fold kept from one run is never reused for another run", () => {
  const first = simulate(apiOnly);
  const end = { count: first.events.length, t: first.endMs };
  const kept = { run: first, fold: foldAt(first, end, null) };
  const second = simulate(withDb);
  // The old cursor (end of the first run) on the new, longer run: before #85 this pairing reached the fold.
  assert.ok(second.events.length > end.count);
  const fold = foldAt(second, end, kept);
  assert.notEqual(fold, kept.fold);
  assert.equal(fold.design, second.design);
  assert.ok(fold.nodes["sql-1"], "the new run's database is in its fold");
  assert.doesNotThrow(() => utilisation(fold, "sql-1"));
});

test("going forward in the same run reuses the fold; going back rebuilds it", () => {
  const run = simulate(withDb);
  const early = foldAt(run, { count: 10, t: run.events[9].t }, null);
  const later = foldAt(run, { count: 40, t: run.events[39].t }, { run, fold: early });
  assert.equal(later, early, "forward: incremental");
  const back = foldAt(run, { count: 5, t: run.events[4].t }, { run, fold: later });
  assert.notEqual(back, later, "back: rebuilt");
  assert.equal(back.next, 5);
});

test("a cursor past the end of its run is an invariant breach, not a silent read of undefined", () => {
  const run = simulate(apiOnly);
  assert.throws(() => foldAt(run, { count: run.events.length + 1, t: run.endMs }, null), /Invariant/);
});

test("utilisation reads only the fold's own design and names a component that is not part of the run", () => {
  const fold = foldAt(simulate(apiOnly), { count: 20, t: 500 }, null);
  assert.throws(() => utilisation(fold, "sql-1"), /Invariant: component "sql-1" is not part of this run/);
});

test("in a challenge, a run's limits are the fixed settings, not the editor's defaults", () => {
  const challenge = findChallenge("scale-behind-lb")!;
  const editor = challenge.starter();
  // A second database added in the editor gets the default 10 queries at once; the challenge fixes 40.
  const added = { ...editor, nodes: [...editor.nodes, { id: "sql-2", kind: "sql" as const, label: "Replica", x: 0, y: 0, config: { concurrency: 10, readMs: 5, writeMs: 15, queueLimit: 100 } }] };
  const run = simulate(challengeDesign(challenge, added));
  const fold = foldAt(run, { count: run.events.length, t: run.endMs }, null);
  assert.deepEqual(slotLimits(added, "sql-2"), [10]);
  assert.deepEqual(slotLimits(fold.design, "sql-2"), [40]);
  for (const node of fold.design.nodes) for (const share of utilisation(fold, node.id) ?? []) assert.ok(share >= 0 && share <= 1, `${node.id} in use ${share}`);
});
