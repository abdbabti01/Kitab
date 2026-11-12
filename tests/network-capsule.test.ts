// The packet drawn on the diagram is the event's own layers, and every change it shows is one layerStep() records.
import test from "node:test";
import assert from "node:assert/strict";
import { capsuleAt, layerStep, layerTag } from "../src/practice/network/packets.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Trace } from "../src/practice/network/model.ts";

const runs = (): [string, Trace][] => [
  ...scenarios().map((s) => [s.name, s.trace] as [string, Trace]),
  ...missions.flatMap((m) => m.variants.map((v) => [`${m.id}/${v.id}`, runSequence(v.build(), [v.probe])] as [string, Trace])),
];

test("the packet shows exactly the layers the event carries, outermost first", () => {
  for (const [name, t] of runs())
    t.events.forEach((e, i) => {
      const c = capsuleAt(t.events, i);
      assert.deepEqual(c.segments.map((s) => s.name), [...e.layers].reverse().map((l) => l.name), `${name} step ${i}`);
      // No TCP or UDP on a message that has none (ARP, ICMP, and steps before the transport layer exists).
      const transport = e.layers.some((l) => l.kind === "transport");
      assert.equal(c.segments.some((s) => s.tag === "TCP" || s.tag === "UDP"), transport, `${name} step ${i}`);
    });
});

test("every mark, departing layer and note comes from a change the trace records", () => {
  for (const [name, t] of runs())
    t.events.forEach((_, i) => {
      const step = layerStep(t.events, i);
      const c = capsuleAt(t.events, i);
      const where = `${name} step ${i}`;
      for (const s of c.segments) {
        if (s.mark === "added") assert.ok(step.changes.some((x) => x.kind === "added" && x.layer === s.name), where);
        if (s.mark === "replaced") assert.ok(step.changes.some((x) => x.kind === "replaced" && x.to === s.name), where);
        if (s.mark === "changed") assert.ok(step.changes.some((x) => x.kind === "field" && x.layer === s.name), where);
      }
      assert.deepEqual(c.gone.map((g) => g.name), step.changes.flatMap((x) => (x.kind === "removed" ? [x.layer] : [])), where);
      // Each value in a note is a before or after value the trace recorded.
      const values = step.changes.flatMap((x) => (x.kind === "field" ? [String(x.before), String(x.after)] : []));
      for (const n of c.notes)
        for (const v of n.match(/\d+\.\d+\.\d+\.\d+|\b\d+\b/g) ?? []) assert.ok(values.some((x) => x === v), `${where}: "${n}" shows ${v}`);
      if (!step.changes.filter((x) => x.kind !== "kept").length) assert.deepEqual(c.notes, [], where);
    });
});

test("a router takes the frame off, lowers the TTL and sends the packet on in a new frame", () => {
  const ping = scenarios().find((s) => s.trace.events.some((e) => e.title === "Decrease TTL"))!;
  const at = ping.trace.events.findIndex((e) => e.title === "Decrease TTL");
  const c = capsuleAt(ping.trace.events, at);
  assert.deepEqual(c.gone.map((g) => g.tag), ["Eth"]);
  assert.ok(c.notes.includes("− Eth"));
  assert.ok(c.notes.some((n) => /^TTL \d+→\d+$/.test(n)));
  assert.equal(c.segments[0].tag, "IP");
  assert.equal(c.segments[0].mark, "changed");
  const out = ping.trace.events.findIndex((e, i) => i > at && e.actor === ping.trace.events[at].actor && e.hop);
  assert.ok(["added", "replaced"].includes(capsuleAt(ping.trace.events, out).segments[0].mark ?? ""), "the frame for the next link is new");
  assert.equal(layerTag("Wi-Fi frame"), "Wi-Fi");
  assert.equal(layerTag("DHCP Discover"), "DHCP");
});
