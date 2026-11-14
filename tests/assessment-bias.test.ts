// Answer choices must not give themselves away: not by position, not by length, and every wrong
// explanation gets feedback about the idea behind it.
import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { optionOrder } from "../src/learning/assessment.ts";
import { missions as engineMissions } from "../src/learning/missions/catalog.ts";
import { missions as networkMissions } from "../src/practice/network/missions.ts";

const explanations = [
  ...engineMissions.map((m) => ({ id: m.id, options: m.explanation.options, misconceptions: m.misconceptions })),
  ...networkMissions.map((m) => ({ id: m.id, options: m.explanation.options, misconceptions: m.misconceptions })),
];

test("an attempt's choice order is stable, and differs between attempts without favouring a position", () => {
  const ids = ["a", "b", "c", "d"];
  assert.deepEqual(optionOrder("m:2026-11-11T10:00:00.000Z:explain", ids), optionOrder("m:2026-11-11T10:00:00.000Z:explain", ids));
  const firsts = new Map<string, number>();
  for (let i = 0; i < 800; i += 1) {
    const order = optionOrder(`m:2026-11-${i}:explain`, ids);
    assert.deepEqual([...order].sort(), ids);
    firsts.set(order[0], (firsts.get(order[0]) ?? 0) + 1);
  }
  // Each option is shown first in roughly a quarter of attempts.
  for (const id of ids) assert.ok((firsts.get(id) ?? 0) > 140 && (firsts.get(id) ?? 0) < 260, `${id} first ${firsts.get(id)} times of 800`);
});

test("the correct explanation is not given away by its length", () => {
  // Accuracy comes first, so this is not a strict per-question limit: the correct answer may be the longest
  // sometimes, but not habitually, and never by a wide margin.
  let longest = 0;
  for (const m of explanations) {
    const correct = m.options.find((o) => o.correct)!.text.length;
    const others = Math.max(...m.options.filter((o) => !o.correct).map((o) => o.text.length));
    if (correct > others) longest += 1;
    assert.ok(correct <= others * 1.3, `${m.id}: correct explanation is ${correct} characters, the longest other is ${others}`);
  }
  assert.ok(longest <= explanations.length / 2, `the correct explanation is the longest in ${longest} of ${explanations.length} missions`);
});

test("every wrong explanation names a misconception with its own feedback", () => {
  for (const m of explanations)
    for (const o of m.options.filter((x) => !x.correct)) {
      assert.ok(o.misconception, `${m.id}/${o.id} has no misconception`);
      assert.ok(m.misconceptions[o.misconception!]?.message, `${m.id}/${o.id}: no message for ${o.misconception}`);
    }
});

test("assessment wording changes keep mission versions, so saved progress and mastery still apply", () => {
  // Changing a version drops mastery recorded under the old one (see mission-progress.ts and progress.ts).
  const versions = Object.fromEntries([...engineMissions, ...networkMissions].map((m) => [m.id, m.version]));
  assert.deepEqual(versions, {
    "tcp-lost-segment": "1.1.0",
    "tcp-send-window": "1.1.0",
    "tcp-lab": "1.0.1",
    ...Object.fromEntries(
      ["array-insert-shift", "ds-linked-list-delete", "ds-hash-insert", "ds-bst-search", "graph-bfs-reach", "recursion-depth", "recursion-base-case", "ds-lab", "ipv4-network-address", "ipv4-local-or-remote"]
        .concat(networkMissions.map((m) => m.id))
        .map((id) => [id, "1.0.0"]),
    ),
  });
});
