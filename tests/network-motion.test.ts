// The diagram's animation is read from the trace: every moving frame, forwarding highlight and stop marker
// corresponds to an event the engine emitted, across every starter scenario and every mission version.
import test from "node:test";
import assert from "node:assert/strict";
import { motionAt } from "../src/practice/network/motion.ts";
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
const linkBetween = (n: Network, id: string, a: string, b: string) =>
  n.links.some((l) => l.id === id && [l.a.device, l.b.device].sort().join() === [a, b].sort().join());

test("a frame moves only where the engine transmitted one, on that link, in that direction", () => {
  let moved = 0,
    broadcasts = 0;
  for (const { name, network, trace } of runs())
    trace.events.forEach((e, i) => {
      const m = motionAt(trace.events, i, network);
      assert.equal(!!m.packet, !!(e.hop && e.packet), `${name} step ${i}: ${e.title}`);
      if (!m.packet) return;
      moved += 1;
      assert.deepEqual([m.packet.link, m.packet.from, m.packet.to], [e.hop!.link, e.hop!.from, e.hop!.to]);
      assert.ok(linkBetween(network, m.packet.link, m.packet.from, m.packet.to), `${name} step ${i}: no such cable`);
      // The kind is the engine's own message id; the label for IP traffic is the packet's Protocol field.
      assert.equal(m.packet.kind, e.packet!.startsWith("arp-") ? "arp" : e.packet!.startsWith("dhcp-") ? "dhcp" : "ip");
      if (m.packet.kind === "ip") assert.equal(m.packet.label, e.layers.find((l) => l.name === "IPv4 packet")?.fields.Protocol);
      const dst = e.layers.find((l) => /frame$/.test(l.name))?.fields["Destination MAC"];
      if (!m.packet.lost) assert.ok(dst, `${name} step ${i}: a transmitted frame has a destination MAC`);
      assert.equal(m.packet.broadcast, dst === "ff:ff:ff:ff:ff:ff");
      if (m.packet.broadcast) broadcasts += 1;
      assert.equal(m.packet.lost, e.title === "Drop TCP data segment");
    });
  assert.ok(moved > 500, `only ${moved} frames checked`);
  assert.ok(broadcasts > 20, `only ${broadcasts} broadcasts`);
});

test("forwarding highlights the port the MAC table chose, and floods highlight every copy actually sent", () => {
  const seen = { forward: 0, flood: 0 };
  for (const { name, network, trace } of runs())
    trace.events.forEach((e, i) => {
      const f = motionAt(trace.events, i, network).forward;
      if (!f) return;
      seen[f.kind] += 1;
      const sent = trace.events.filter((x, j) => j > i && x.packet === e.packet && x.hop?.from === e.actor).map((x) => x.hop!.link);
      if (f.kind === "forward") {
        assert.equal(e.title, "Forward using MAC table");
        // The very next copy of this frame the bridge transmits uses the highlighted link.
        assert.equal(f.links[0], sent[0], `${name} step ${i}`);
      } else {
        assert.match(e.title, /^(Forward broadcast on LAN|Unknown MAC)/);
        assert.ok(f.links.length >= 1, `${name} step ${i}: a flood with no copies`);
        for (const link of f.links) assert.ok(trace.events.some((x) => x.packet === e.packet && x.hop?.from === e.actor && x.hop.link === link), `${name} step ${i}: ${link} not sent`);
      }
    });
  assert.ok(seen.forward > 20 && seen.flood > 20, JSON.stringify(seen));
});

test("a stop is marked only where delivery stopped, and a discard only where a flooded copy was dropped", () => {
  for (const { name, network, trace } of runs())
    trace.events.forEach((e, i) => {
      const h = motionAt(trace.events, i, network).halt;
      assert.equal(h?.kind === "stopped", e.error === true, `${name} step ${i}`);
      assert.equal(h?.kind === "discarded", e.title === "Discard frame for another MAC", `${name} step ${i}`);
      if (h) assert.equal(h.device, e.actor);
    });
});

test("a frame is shown held at a device only while that device works on it", () => {
  for (const { name, network, trace } of runs())
    trace.events.forEach((e, i) => {
      const h = motionAt(trace.events, i, network).held;
      if (!h) return;
      assert.ok(e.packet && !e.hop && !e.error, `${name} step ${i}: ${e.title}`);
      assert.equal(h.device, e.actor);
    });
});
