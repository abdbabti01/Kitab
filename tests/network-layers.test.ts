// Every layer change shown is read from two recorded steps of the same message: across every starter
// scenario and every mission version, nothing is added, removed or rewritten that the trace does not show.
import test from "node:test";
import assert from "node:assert/strict";
import { layerStep } from "../src/practice/network/packets.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Trace, TraceEvent } from "../src/practice/network/model.ts";

const runs: { name: string; trace: Trace }[] = [
  ...scenarios().map((s) => ({ name: s.name, trace: s.trace })),
  ...missions.flatMap((m) => m.variants.map((v) => ({ name: `${m.id}/${v.id}`, trace: runSequence(v.build(), [v.probe]) }))),
];
const run = (name: string) => runs.find((r) => r.name === name)!.trace.events;
const at = (events: TraceEvent[], actor: string, title: string, packet?: string) =>
  events.findIndex((e) => e.actor === actor && e.title === title && (!packet || e.packet === packet));
const describe = (events: TraceEvent[], i: number) =>
  layerStep(events, i).changes.map((c) =>
    c.kind === "field" ? `${c.field}: ${c.before} → ${c.after}` : c.kind === "replaced" ? `replaced ${c.from} → ${c.to}${c.fields.map((f) => ` ${f.field}`).join("")}` : `${c.kind} ${c.layer}`,
  );
const bridgeDecision = (e: TraceEvent) => /^(Forward broadcast on LAN|Forward using MAC table|Unknown MAC)/.test(e.title);

test("every change compares two recorded steps of the same message at the same device", () => {
  let changed = 0;
  for (const { name, trace } of runs)
    trace.events.forEach((e, i) => {
      const s = layerStep(trace.events, i);
      if (s.basis === undefined) return assert.equal(s.changes.length, 0, `${name} step ${i}`);
      const b = trace.events[s.basis];
      const where = `${name} step ${i} (${e.title}) against ${s.basis} (${b.title})`;
      assert.ok(s.basis < i, where);
      assert.ok(!bridgeDecision(b) && !bridgeDecision(e), `${where}: a bridge decision is recorded without its frame`);
      // Same message: the same id at this device (or the link that brought it), or the step just before by the
      // same device, before the message has an id, whose layers this step extends.
      if (b.packet) assert.ok(b.packet === e.packet && (b.actor === e.actor || b.hop?.to === e.actor), where);
      else {
        assert.equal(s.basis, i - 1, where);
        assert.equal(b.actor, e.actor, where);
        assert.deepEqual(e.layers.slice(0, b.layers.length).map((l) => l.name), b.layers.map((l) => l.name), where);
      }
      for (const c of s.changes) {
        changed += 1;
        const has = (x: TraceEvent, layer: string) => x.layers.some((l) => l.name === layer);
        if (c.kind === "added") assert.ok(has(e, c.layer) && !has(b, c.layer), where);
        if (c.kind === "removed") assert.ok(has(b, c.layer) && !has(e, c.layer), where);
        if (c.kind === "field") {
          assert.equal(b.layers.find((l) => l.name === c.layer)!.fields[c.field], c.before, where);
          assert.equal(e.layers.find((l) => l.name === c.layer)!.fields[c.field], c.after, where);
        }
        if (c.kind === "replaced" || c.kind === "kept") {
          // Only when leaving on a link, compared with the frame this message arrived in at this device.
          assert.equal(e.hop?.from, e.actor, where);
          const arrived = trace.events.slice(0, i).filter((x) => x.packet === e.packet && x.hop?.to === e.actor).at(-1)!;
          const inFrame = arrived.layers.find((l) => /frame$/.test(l.name))!;
          if (c.kind === "replaced") {
            assert.equal(c.from, inFrame.name, where);
            for (const f of c.fields) assert.equal(inFrame.fields[f.field], f.before, where);
          }
        }
      }
    });
  assert.ok(changed > 1000, `only ${changed} changes checked`);
});

test("a host builds its message layer by layer, and frames it to send", () => {
  const ev = run("lan: HTTP");
  const segment = ev.findIndex((e) => e.title === "Create TCP segment");
  assert.deepEqual(describe(ev, segment), ["added TCP segment"]);
  assert.deepEqual(describe(ev, segment + 1), ["added IPv4 packet"]);
  const packet = ev[segment + 2].packet!;
  assert.deepEqual(describe(ev, ev.findIndex((e) => e.packet === packet && e.hop)), ["added Ethernet frame"]);
  // The receiving host removes the frame; the trace does not record TCP or IPv4 being removed per message.
  const deliver = ev.findIndex((e) => e.packet === packet && e.title === "Deliver IP payload");
  assert.deepEqual(describe(ev, deliver), ["removed Ethernet frame"]);
  // Reading the reassembled request is not tied to one message, so it is not shown as unwrapping.
  const reads = ev.findIndex((e) => e.title === "Server reads HTTP request");
  assert.equal(layerStep(ev, reads).basis, undefined);
});

test("a router removes the frame, lowers the TTL, translates with NAT and sends a new frame; a switch sends the same frame", () => {
  const ev = run("internet: HTTP by IP");
  assert.deepEqual(describe(ev, at(ev, "router", "Decrease TTL", "ip-1")), ["removed Ethernet frame", "TTL: 64 → 63"]);
  assert.deepEqual(describe(ev, at(ev, "router", "Translate source with NAT", "ip-1")), ["Source port: 51514 → 62000", "Source IP: 192.168.1.10 → 203.0.113.2"]);
  const out = ev.findIndex((e) => e.packet === "ip-1" && e.hop?.from === "router");
  assert.deepEqual(describe(ev, out), ["replaced Ethernet frame → Ethernet frame Source MAC Destination MAC"]);
  assert.deepEqual(describe(ev, ev.findIndex((e) => e.packet === "ip-1" && e.hop?.from === "switch")), ["kept Ethernet frame"]);
  // On the way back the router restores the private destination.
  assert.deepEqual(describe(ev, at(ev, "router", "Restore reply destination")).slice(1), ["Destination port: 62000 → 51514", "Destination IP: 203.0.113.2 → 192.168.1.10"]);
  // An access point re-frames between Ethernet and Wi-Fi, keeping the MAC addresses.
  const toPhone = ev.findIndex((e) => e.hop?.from === "ap" && e.hop.to === "phone");
  assert.deepEqual(describe(ev, toPhone), ["replaced Ethernet frame → Wi-Fi frame"]);
});

test("messages without TCP keep their own layers: ICMP, ARP, DHCP and DNS", () => {
  const added = (events: TraceEvent[]) => new Set(events.flatMap((_, i) => layerStep(events, i).changes.flatMap((c) => (c.kind === "added" ? [c.layer] : []))));
  const ping = run("lan: ping");
  assert.ok(!ping.some((e) => e.layers.some((l) => l.name === "TCP segment")));
  assert.equal(layerStep(ping, at(ping, "pc", "Choose a route", "ip-1")).origin, true);
  // The echo reply is a new message, not the request rewritten.
  assert.equal(layerStep(ping, at(ping, "server", "Create ICMP echo reply")).basis, undefined);
  assert.deepEqual([...added(ping)], ["Ethernet frame"]);
  const dhcp = run("wifi: phone DHCP");
  assert.deepEqual(dhcp[at(dhcp, "phone", "DHCP Discover")].layers.map((l) => l.name), ["DHCP Discover", "UDP datagram", "IPv4 packet"]);
  assert.equal(layerStep(dhcp, at(dhcp, "phone", "DHCP Discover")).origin, true);
  for (const e of run("internet: HTTP by name").filter((x) => x.packet?.startsWith("arp-"))) assert.ok(!e.layers.some((l) => l.name === "IPv4 packet"));
});

test("a lost segment is never shown arriving or being unwrapped, and steps without recorded layers show nothing", () => {
  const ev = run("internet: HTTP with one loss");
  const drop = ev.findIndex((e) => e.title === "Drop TCP data segment");
  assert.deepEqual(describe(ev, drop), []);
  assert.ok(!ev.slice(drop + 1).some((e) => e.packet === ev[drop].packet));
  for (const { name, trace } of runs)
    trace.events.forEach((e, i) => {
      if (!e.layers.length || bridgeDecision(e)) assert.deepEqual(layerStep(trace.events, i), { origin: false, by: e.actor, changes: [] }, `${name} step ${i}`);
    });
});
