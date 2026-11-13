// Playback time is read from the trace and changes presentation only: every event keeps a place and a time,
// a frame crossing a link always gets the time to move, and only repeats of a step already seen go quickly.
import test from "node:test";
import assert from "node:assert/strict";
import { BEAT_MS, beatsOf, durationsOf, motionAt, stageEndMs } from "../src/practice/network/motion.ts";
import { stagesOf } from "../src/practice/network/stages.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Network, Trace } from "../src/practice/network/model.ts";

function runs(): { name: string; network: Network; trace: Trace }[] {
  const out = scenarios().map((s) => ({ name: s.name, network: s.network, trace: s.trace }));
  for (const m of missions)
    for (const v of m.variants) {
      const network = v.build();
      out.push({ name: `${m.id}/${v.id}`, network, trace: runSequence(network, [v.probe]) });
    }
  return out;
}

test("every event gets a time, and each beat follows from what the event shows", () => {
  for (const { name, network, trace } of runs()) {
    const stages = stagesOf(trace.events, network);
    const beats = beatsOf(trace.events, network);
    const ms = durationsOf(trace.events, network, stages);
    assert.equal(ms.length, trace.events.length, name);
    const seen = new Set<string>();
    trace.events.forEach((e, i) => {
      const m = motionAt(trace.events, i, network);
      const where = `${name} step ${i}: ${e.title}`;
      assert.ok(ms[i] >= BEAT_MS.routine, where);
      if (e.error) assert.equal(beats[i], "stop", where);
      else if (m.packet) assert.equal(beats[i], "hop", where);
      else if (beats[i] === "routine") assert.ok(seen.has(JSON.stringify([e.actor, e.title])), `${where}: routine on first sight`);
      seen.add(JSON.stringify([e.actor, e.title]));
    });
    for (const s of stages) assert.ok(ms[s.end] >= stageEndMs(s.summary), `${name}: stage "${s.title}" ends too quickly to read`);
  }
});

test("a long run plays faster than one fixed time per event, and still moves every frame for at least a second", () => {
  const internet = runs().find((r) => r.trace.events.length > 400)!;
  const ms = durationsOf(internet.trace.events, internet.network, stagesOf(internet.trace.events, internet.network));
  const beats = beatsOf(internet.trace.events, internet.network);
  assert.ok(ms.reduce((a, b) => a + b, 0) < internet.trace.events.length * 1100);
  beats.forEach((b, i) => b === "hop" && assert.ok(ms[i] >= 1000));
});
