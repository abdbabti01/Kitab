import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { stagesOf } from "../src/practice/network/stages.ts";
import { neighbours } from "../src/practice/journey-nav.ts";

const s = scenarios().find((x) => x.name === "internet: HTTP by name")!;
const stages = stagesOf(s.trace.events, s.network);
const last = s.trace.events.length - 1;

test("Summary moves by stage end, Every event by one event, both on the one event index", () => {
  // From the end of stage 1, each Next lands on the end of the following stage.
  let i = stages[0].end;
  const ends: number[] = [];
  for (let k = 1; k < stages.length; k++) {
    i = neighbours("summary", stages, i, last).next;
    ends.push(i);
  }
  assert.deepEqual(ends, stages.slice(1).map((x) => x.end));
  // Mid-stage, Next first completes the current stage; Previous goes back to the previous stage's end.
  const arp = stages[2];
  assert.deepEqual(neighbours("summary", stages, arp.start + 3, last), { prev: stages[1].end, next: arp.end });
  assert.deepEqual(neighbours("events", stages, 10, last), { prev: 9, next: 11 });
  assert.deepEqual(neighbours("summary", stages, 0, last).prev, 0);
  assert.deepEqual(neighbours("summary", stages, last, last).next, last);
  assert.deepEqual(neighbours("summary", [], 0, 0), { prev: 0, next: 0 });
});

