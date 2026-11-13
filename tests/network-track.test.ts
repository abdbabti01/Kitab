// The unified track draws only recorded link crossings, never a sender-to-destination shortcut, and its windows keep
// every event reachable.
import test from "node:test";
import assert from "node:assert/strict";
import { carrying, trackOf, windowOf } from "../src/practice/network/track.ts";
import { exchangeOf } from "../src/practice/network/exchange.ts";
import { stagesOf } from "../src/practice/network/stages.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Network, Trace } from "../src/practice/network/model.ts";

const runs = (): { name: string; network: Network; trace: Trace }[] => [
  ...scenarios().map((s) => ({ name: s.name, network: s.network, trace: s.trace })),
  ...missions.flatMap((m) => m.variants.map((v) => ({ name: `${m.id}/${v.id}`, network: v.build(), trace: runSequence(v.build(), [v.probe]) }))),
];

test("every arrow is one recorded link crossing, and every crossing has exactly one arrow", () => {
  for (const { name, network, trace } of runs()) {
    const t = trackOf(trace.events, network);
    const crossings = trace.events.flatMap((e, i) => (e.hop && e.packet ? [i] : []));
    assert.deepEqual(t.arrows.map((a) => a.index), crossings, name);
    for (const a of t.arrows) {
      const e = trace.events[a.index];
      assert.equal(a.from, e.hop!.from, `${name} event ${a.index}`);
      assert.equal(a.to, e.hop!.to, `${name} event ${a.index}`);
      // A crossing joins two devices that share a link: never a shortcut from sender to destination.
      assert.ok(network.links.some((l) => l.id === e.hop!.link && [l.a.device, l.b.device].sort().join() === [a.from, a.to].sort().join()), `${name} event ${a.index}: not a real link`);
      assert.ok(t.lanes.includes(a.from) && t.lanes.includes(a.to), name);
    }
  }
});

test("forwarding, broadcast, loss, retransmission and stops are told apart from the recorded events", () => {
  for (const { name, network, trace } of runs()) {
    const t = trackOf(trace.events, network);
    const x = exchangeOf(trace.events, network);
    for (const a of t.arrows) {
      const m = x.messages.find((mm) => mm.id === a.message)!;
      assert.equal(a.forwarded, m.from !== a.from, `${name} event ${a.index}`);
      assert.equal(a.lost, trace.events[a.index].title === "Drop TCP data segment", name);
      assert.equal(a.retransmit, !!m.resends, name);
    }
    const stop = trace.events.at(-1)?.error;
    assert.equal(t.marks.some((m) => m.how === "stopped"), !!stop, name);
    for (const m of t.marks) assert.ok(m.index >= 0 && m.index < trace.events.length, name);
  }
  // A lost segment and its retransmission exist in the scenarios and are both marked.
  const all = runs().flatMap((r) => trackOf(r.trace.events, r.network).arrows);
  assert.ok(all.some((a) => a.lost) && all.some((a) => a.retransmit) && all.some((a) => a.forwarded) && all.some((a) => a.broadcast));
});

test("windows always hold the current event, stay put within a stage, and together reach every event", () => {
  for (const { name, network, trace } of runs()) {
    const stages = stagesOf(trace.events, network);
    const last = trace.events.length - 1;
    for (const cap of [20, 60, 120]) {
      const reached = new Set<number>();
      let moves = 0,
        prev: [number, number] | null = null;
      for (let i = 0; i <= last; i++) {
        const [a, b] = windowOf(stages, i, last, cap);
        assert.ok(a <= i && i <= b && a >= 0 && b <= last && b - a + 1 <= cap, `${name} cap ${cap} event ${i}: [${a}, ${b}]`);
        for (let k = a; k <= b; k++) reached.add(k);
        if (prev && (prev[0] !== a || prev[1] !== b)) moves++;
        prev = [a, b];
      }
      assert.equal(reached.size, last + 1, `${name}: some events are never shown`);
      // Played from start to end, the window moves at most once per stage plus once per page of a long stage.
      const pages = stages.reduce((n, s) => n + Math.ceil((s.end - s.start + 1) / cap), 0);
      assert.ok(moves <= pages, `${name} cap ${cap}: ${moves} moves for ${pages} pages`);
    }
  }
});

test("what crosses a link is named from its own recorded layers, outside in, and nothing else", () => {
  assert.equal(carrying([{ name: "ARP reply" }, { name: "Ethernet frame" }]), "Ethernet frame carrying an ARP reply");
  assert.equal(carrying([{ name: "ARP request" }, { name: "Wi-Fi frame" }]), "Wi-Fi frame carrying an ARP request");
  assert.equal(
    carrying([{ name: "HTTP request" }, { name: "TCP segment" }, { name: "IPv4 packet" }, { name: "Ethernet frame" }]),
    "Ethernet frame carrying an IPv4 packet, which carries a TCP segment with an HTTP request",
  );
  assert.equal(carrying([{ name: "DHCP Discover" }, { name: "UDP datagram" }, { name: "IPv4 packet" }, { name: "Wi-Fi frame" }]), "Wi-Fi frame carrying an IPv4 packet, which carries a UDP datagram with a DHCP Discover");
  assert.equal(carrying([{ name: "HTTP request" }, { name: "TCP segment" }, { name: "IPv4 packet" }]), "IPv4 packet carrying a TCP segment, which carries an HTTP request");
  for (const { name, network, trace } of runs())
    for (const a of trackOf(trace.events, network).arrows) {
      const layers = trace.events[a.index].layers.map((l) => l.name);
      // Every recorded layer is named, outermost first, and no protocol the event does not carry.
      let at = -1;
      for (const l of [...layers].reverse()) {
        const k = a.what.indexOf(l, at + 1);
        assert.ok(k > at, `${name} event ${a.index}: "${a.what}" misses or misorders ${l}`);
        at = k;
      }
      for (const p of ["Ethernet", "Wi-Fi", "IPv4", "TCP", "UDP", "ICMP", "ARP"]) if (a.what.includes(p)) assert.ok(layers.some((l) => l.includes(p)), `${name} event ${a.index}: ${p} in "${a.what}"`);
      assert.ok(!/IP frame/.test(a.what));
    }
});
