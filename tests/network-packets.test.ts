import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { changesAt, glossary, headerFields, packetNumber, resends, shown, trip } from "../src/practice/network/packets.ts";

const all = scenarios();
const run = (name: string) => all.find((s) => s.name === name)!;

test("one IP packet keeps its identity across every link, router and NAT; its frames do not", () => {
  const { trace } = run("internet: HTTP by name");
  const query = trace.events.find((e) => e.title === "Choose a route")!.packet;
  const hops = trip(trace.events, query);
  assert.deepEqual(hops.map((h) => `${h.from}>${h.to}`), ["pc>switch", "switch>router", "router>isp", "isp>remote", "remote>dns"]);
  // A new frame on every link; the switch passes a frame on without rewriting its addresses.
  assert.equal(new Set(hops.map((h) => h.frame)).size, hops.length);
  assert.equal(hops[0].fields["Destination MAC"], hops[1].fields["Destination MAC"]);
  assert.notEqual(hops[1].fields["Destination MAC"], hops[2].fields["Destination MAC"]);
  // IP: the destination never changes; the source changes once, at NAT; TTL drops at each router.
  assert.deepEqual([...new Set(hops.map((h) => h.fields["Destination IP"]))], ["198.51.100.53"]);
  assert.deepEqual(hops.map((h) => h.fields["Source IP"]), ["192.168.1.10", "192.168.1.10", "203.0.113.2", "203.0.113.2", "203.0.113.2"]);
  assert.deepEqual(hops.map((h) => h.fields.TTL), [64, 64, 63, 62, 62]);
});

test("changes since the previous hop are the real rewrites, each with its reason", () => {
  const { trace, network } = run("internet: HTTP by name");
  const query = trace.events.find((e) => e.title === "Choose a route")!.packet;
  const [, acrossSwitch, leavingHome] = trip(trace.events, query);
  assert.deepEqual(changesAt(trace.events, acrossSwitch.index, network), [], "a switch forwards the frame unchanged");
  const changed = changesAt(trace.events, leavingHome.index, network);
  assert.deepEqual(changed.map((c) => c.field).sort(), ["Destination MAC", "Source IP", "Source MAC", "Source port", "TTL"]);
  assert.match(changed.find((c) => c.field === "Source IP")!.why, /Home router translated the private source/);
  assert.match(changed.find((c) => c.field === "TTL")!.why, /Home router forwarded the packet as a router/);
  assert.match(changed.find((c) => c.field === "Source MAC")!.why, /built a new frame for the next link/);
  // The reply is restored on its way back in.
  const answer = trace.events.find((e) => e.title === "Restore reply destination")!.packet;
  const back = trip(trace.events, answer);
  const restored = back.findIndex((h) => h.fields["Destination IP"] === "192.168.1.10");
  assert.ok(restored > 0);
  assert.match(changesAt(trace.events, back[restored].index, network).find((c) => c.field === "Destination IP")!.why, /restore the private destination/);
});

test("a broadcast is one message carried in separate frames, one per link", () => {
  const { trace } = run("wifi: phone DHCP");
  const discover = trace.events.find((e) => e.title === "DHCP Discover")!.packet;
  const hops = trip(trace.events, discover);
  assert.ok(hops.length >= 4);
  assert.equal(new Set(hops.map((h) => h.frame)).size, hops.length);
  assert.ok(hops.every((h) => h.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff"));
  // The ARP reply is its own message, not part of the request.
  const lan = run("lan: ping").trace;
  const ids = new Set(lan.events.map((e) => e.packet).filter((p) => p?.startsWith("arp-")));
  assert.deepEqual([...ids].map((p) => p!.endsWith("-reply")).sort(), [false, true]);
});

test("a retransmission is a new packet that resends the lost segment's bytes", () => {
  const { trace } = run("internet: HTTP with one loss");
  const drop = trace.events.findIndex((e) => e.title === "Drop TCP data segment");
  const retry = trace.events.findIndex((e, i) => i > drop && e.title === "Wrap in a link frame" && e.actor === "pc");
  assert.notEqual(trace.events[retry].packet, trace.events[drop].packet);
  const firstHop = trip(trace.events, trace.events[retry].packet)[0].index;
  assert.equal(resends(trace.events, firstHop), drop);
  assert.equal(packetNumber(trace.events, trace.events[drop].packet) + 1 <= packetNumber(trace.events, trace.events[retry].packet), true);
});

test("every header field the engine emits has a glossary entry, and coded fields show their codes", () => {
  const fields = new Set<string>();
  for (const s of all) for (const e of s.trace.events) for (const l of e.layers) for (const k of Object.keys(l.fields)) fields.add(k);
  for (const f of fields) assert.ok(glossary[f], `no glossary entry for ${f}`);
  assert.equal(shown("Carries", "ARP"), "ARP (0x0806)");
  assert.equal(shown("Type", "Echo reply"), "0 (Echo reply)");
  assert.equal(shown("Protocol", "UDP"), "UDP (17)");
  assert.ok(!("Medium" in headerFields(run("lan: ping").trace.events[3].layers)), "lab context is not a header field");
});
