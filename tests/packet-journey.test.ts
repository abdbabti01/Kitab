import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { findLesson, lessons } from "../src/learning/lessons/catalog.ts";
import type { PacketJourneyData } from "../src/learning/engines/packet-journey.ts";
import sources from "../src/content/packet-journey/sources.json" with { type: "json" };
import { resolveTrack } from "../src/learning/lessons/runtime.ts";

test("Packet Journey replaces the HELLO walkthrough at the existing lesson ID", () => {
  const lesson = findLesson("hello-tcp")!;
  assert.equal(lesson.title, "Packet Journey");
  assert.equal(lesson.version, "2.0.0");
  assert.deepEqual(lessons.map(({ id }) => id), ["hello-tcp", "array-insert"]);
  const track = resolveTrack(lesson, {});
  assert.equal(track.trace.engine.id, "packet-journey");
  assert.equal(track.steps.length, 130);
  assert.match(track.steps.at(-1)!.what, /Hello Babti/);
});

test("the recorded request adds headers, forwards with a smaller TTL, and unwraps the same bytes", () => {
  const track = resolveTrack(findLesson("hello-tcp")!, {});
  const frames = track.trace.frames.map((frame) => frame.data as PacketJourneyData);
  for (const frame of frames) {
    assert.ok(sources[frame.event.source as keyof typeof sources][frame.event.line - 1]);
  }

  const start = frames.findIndex(({ event }) => event.phase === 2 && event.title === "Hand app bytes to TCP");
  const app = frames[start];
  const tcp = frames[start + 1];
  const ip = frames[start + 3];
  const routed = frames[start + 5];
  const unwrapped = frames[start + 6];
  const buffered = frames[start + 8];
  assert.deepEqual([app.payload.length, app.showTcp, app.showIp], [49, false, false]);
  assert.deepEqual([tcp.payload.length, tcp.showTcp, tcp.showIp], [32, true, false]);
  assert.deepEqual([ip.event.wire.packetLength, ip.showTcp, ip.showIp], [72, true, true]);
  assert.deepEqual([ip.event.wire.ttl, routed.event.wire.ttl, routed.location], [64, 63, "IPv4 forwarding"]);
  assert.deepEqual([unwrapped.showTcp, unwrapped.showIp], [true, false]);
  assert.deepEqual([buffered.showTcp, buffered.showIp], [false, false]);
  for (const frame of [ip, routed, unwrapped, buffered]) assert.equal(frame.payload, tcp.payload);
  assert.equal(track.trace.outcome.body, "Hello Babti");
});
