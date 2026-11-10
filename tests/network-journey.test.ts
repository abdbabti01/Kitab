import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { stagesOf } from "../src/practice/network/stages.ts";
import { neighbours, place } from "../src/practice/journey-nav.ts";

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

test("the card is placed beside its device when that is clear, and never over a stage device when another spot is", () => {
  const box = { w: 300, h: 200 }, area = { w: 1000, h: 480 };
  assert.deepEqual(place({ x: 100, y: 240 }, box, area, [], []), { x: 166, y: 140 });
  // A device to the right blocks that side: the card moves to a clear spot instead.
  const spot = place({ x: 100, y: 240 }, box, area, [{ x: 250, y: 240 }], []);
  assert.ok(!(250 > spot.x - 55 && 250 < spot.x + 355 && 240 > spot.y - 50 && 240 < spot.y + 290));
  // Canvas controls stay uncovered.
  const zoom = { x: 860, y: 430, w: 130, h: 40 };
  const away = place({ x: 900, y: 300 }, box, area, [], [zoom]);
  assert.ok(away.x + box.w <= zoom.x || away.y + box.h <= zoom.y || away.x >= zoom.x + zoom.w);
});
