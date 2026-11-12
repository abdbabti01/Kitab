// The Exchange view's messages are read from the trace alone: across every starter scenario and every mission
// version, each arrow is one packet id, from the device that created it to the devices a frame carrying it
// reached, and nothing is drawn that the trace does not record.
import test from "node:test";
import assert from "node:assert/strict";
import { activeMessage, exchangeOf, type Exchange } from "../src/practice/network/exchange.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { starter } from "../src/practice/network/starters.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Network, Trace } from "../src/practice/network/model.ts";

const runs: { name: string; network: Network; trace: Trace }[] = [
  ...scenarios(),
  ...missions.flatMap((m) =>
    m.variants.map((v) => {
      const network = v.build();
      return { name: `${m.id}/${v.id}`, network, trace: runSequence(network, [v.probe]) };
    }),
  ),
];
const run = (name: string) => {
  const r = runs.find((x) => x.name === name)!;
  return { ...r, x: exchangeOf(r.trace.events, r.network) };
};
const brief = (x: Exchange) => x.messages.map((m) => `${m.label}: ${m.from} → ${m.reached.map((r) => `${r.device} ${r.how}`).join(", ")}`);
const delivers = new Set(["Deliver IP payload", "Save ARP mapping", "Apply DHCP lease"]);

test("every message, arrow and receiver is recorded in the trace", () => {
  let arrows = 0;
  for (const { name, network, trace } of runs) {
    const ev = trace.events;
    const x = exchangeOf(ev, network);
    const ids = [...new Set(ev.flatMap((e) => (e.packet ? [e.packet] : [])))];
    // One message per packet id: none invented, none drawn twice.
    assert.deepEqual(x.messages.map((m) => m.id).sort(), [...ids].sort(), name);
    let previous = -1;
    for (const m of x.messages) {
      const where = `${name} ${m.id}`;
      const mine = ev.flatMap((e, i) => (e.packet === m.id ? [i] : []));
      // In the order they were first sent (or created, if never sent).
      assert.ok((m.sent ?? m.first) > previous, where);
      previous = m.sent ?? m.first;
      assert.equal(m.first, mine[0], where);
      assert.equal(m.from, ev[m.first].actor, where);
      // Every transmission of it, and only those.
      assert.deepEqual(m.hops, mine.filter((i) => ev[i].hop?.from === ev[i].actor), where);
      assert.equal(m.sent, m.hops[0], where);
      assert.deepEqual(m.via, [...new Set(m.hops.map((i) => ev[i].actor).filter((d) => d !== m.from))], where);
      // A device is reached only where a frame carrying the message arrived, and it did not send it on afterwards.
      for (const r of m.reached) {
        arrows += 1;
        const arrivals = m.hops.filter((h) => ev[h].frame && ev[h].hop!.to === r.device);
        assert.ok(arrivals.length, `${where}: ${r.device} reached without a frame arriving`);
        assert.ok(!m.hops.some((h) => h > arrivals.at(-1)! && ev[h].actor === r.device), `${where}: ${r.device} sent it on`);
        assert.ok(ev[r.at].packet === m.id && (ev[r.at].actor === r.device || ev[r.at].hop?.to === r.device), where);
        if (r.how === "delivered") assert.ok(delivers.has(ev[r.at].title), where);
        else assert.ok(!mine.some((i) => ev[i].actor === r.device && delivers.has(ev[i].title)), `${where}: ${r.device} delivered it`);
        if (r.how === "discarded") assert.match(ev[r.at].title, /^Discard/, where);
        if (r.how === "received") assert.ok(!["switch", "ap"].includes(network.devices.find((d) => d.id === r.device)!.kind) && !m.id.startsWith("ip-"), where);
      }
      // Every device a frame reached and that did not send it on is shown: no receiver is left out.
      const ends = new Set(m.hops.filter((h) => ev[h].frame && !m.hops.some((k) => k > h && ev[k].actor === ev[h].hop!.to)).map((h) => ev[h].hop!.to));
      assert.deepEqual(new Set(m.reached.map((r) => r.device)), ends, where);
      // A lost message is the transmission recorded without a frame; it reaches no one on that link.
      const drop = m.hops.find((h) => !ev[h].frame);
      assert.equal(m.lost?.at, drop, where);
      if (m.lost) assert.ok(!m.reached.some((r) => r.device === m.lost!.to), where);
      if (!m.hops.length) assert.deepEqual(m.reached, [], `${where}: never sent, so it reached no one`);
      const frame = ev[m.hops.find((h) => ev[h].frame) ?? -1]?.layers.find((l) => /frame$/.test(l.name));
      assert.equal(m.broadcast, frame?.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff", where);
      assert.equal(m.flooded, mine.some((i) => ev[i].title.startsWith("Unknown MAC")), where);
      // A retransmission points to an earlier lost segment with the same sequence number from the same port.
      if (m.resends) {
        const old = x.messages.find((o) => o.id === m.resends)!;
        assert.ok(old.lost && old.first < m.first, where);
        const tcp = (i: number) => ev[i].layers.find((l) => l.name === "TCP segment")!.fields;
        assert.equal(tcp(old.lost!.at).Sequence, tcp(m.sent!).Sequence, where);
        assert.equal(tcp(old.lost!.at)["Source port"], tcp(m.sent!)["Source port"], where);
      }
    }
    // Lifelines are exactly the devices that sent, were reached, lost a frame on the way to them, or stopped the run.
    const used = new Set(x.messages.flatMap((m) => [m.from, ...m.reached.map((r) => r.device), ...(m.lost ? [m.lost.to] : [])]));
    if (x.stop) used.add(x.stop.device);
    assert.deepEqual(new Set(x.participants), used, name);
    assert.equal(x.participants.length, used.size, name);
    assert.deepEqual(x.stop, trace.success ? undefined : { at: ev.length - 1, device: ev.at(-1)!.actor }, name);
  }
  assert.ok(arrows > 500, `only ${arrows} arrows checked`);
});

test("the active message follows the Journey, and selecting a message puts the Journey on its own event", () => {
  for (const { name, network, trace } of runs) {
    const ev = trace.events;
    const x = exchangeOf(ev, network);
    ev.forEach((e, i) => assert.equal(activeMessage(x, ev, i)?.id, e.packet, `${name} step ${i}`));
    for (const m of x.messages) assert.equal(activeMessage(x, ev, m.sent ?? m.first), m, `${name} ${m.id}`);
  }
});

test("ARP: a broadcast request every host on the LAN receives, and a unicast reply delivered to the asker", () => {
  const { x, trace } = run("internet: HTTP by name");
  const [request, reply] = x.messages;
  assert.equal(request.label, "ARP request");
  assert.equal(request.detail, "Who has 192.168.1.1?");
  assert.ok(request.broadcast);
  assert.deepEqual(new Set(request.reached.map((r) => `${r.device} ${r.how}`)), new Set(["router received", "phone received"]));
  assert.deepEqual(request.via, ["switch", "ap"]);
  assert.equal(reply.label, "ARP reply");
  assert.ok(!reply.broadcast);
  assert.deepEqual(brief({ ...x, messages: [reply] }), ["ARP reply: router → pc delivered"]);
  // The reply is the one the trace creates, after the request reached the router.
  assert.equal(trace.events[reply.first].title, "ARP reply");
  assert.ok(reply.first > request.reached.find((r) => r.device === "router")!.at);
});

test("DHCP: Discover, Offer, Request and ACK, each broadcast, in that order, between the phone and the router", () => {
  const { x } = run("wifi: phone DHCP");
  assert.deepEqual(
    x.messages.map((m) => `${m.label} ${m.from}${m.broadcast ? " broadcast" : ""}`),
    ["DHCP Discover phone broadcast", "DHCP Offer router broadcast", "DHCP Request phone broadcast", "DHCP ACK router broadcast"],
  );
  // Every host on the LAN gets the broadcast; only the phone applies the lease.
  assert.deepEqual(brief(x).at(-1), "DHCP ACK: router → pc received, phone delivered");
});

test("DNS and TCP: query and answer, then SYN, SYN-ACK, ACK, data and acknowledgements, forwarded through switches and routers", () => {
  const { x } = run("internet: HTTP by name");
  const ip = x.messages.filter((m) => m.id.startsWith("ip-"));
  assert.deepEqual(
    ip.slice(0, 7).map((m) => `${m.label}: ${m.from} → ${m.reached.map((r) => r.device).join()}`),
    [
      "DNS query: pc → dns",
      "DNS answer: dns → pc",
      "TCP SYN: pc → server",
      "TCP SYN-ACK: server → pc",
      "TCP ACK: pc → server",
      "HTTP request · TCP PSH, ACK: pc → server",
      "TCP ACK: server → pc",
    ],
  );
  assert.equal(ip[2].detail, "Seq 1000 · Ack 0");
  assert.equal(ip[3].detail, "Seq 7000 · Ack 1001");
  // Forwarding devices are named in order, not drawn as receivers.
  assert.deepEqual(ip[0].via, ["switch", "router", "isp", "remote"]);
  assert.deepEqual(ip[1].via, ["remote", "isp", "router", "switch"]);
  assert.ok(ip.every((m) => m.reached.length === 1 && m.reached[0].how === "delivered"));
});

test("loss and retransmission: the lost segment reaches no one and the resend is linked to it", () => {
  const { x } = run("internet: HTTP with one loss");
  const lost = x.messages.filter((m) => m.lost);
  assert.equal(lost.length, 1);
  assert.deepEqual(lost[0].lost && { from: lost[0].lost.from, to: lost[0].lost.to }, { from: "pc", to: "switch" });
  assert.deepEqual(lost[0].reached, []);
  const again = x.messages.filter((m) => m.resends);
  assert.deepEqual(again.map((m) => m.resends), [lost[0].id]);
  assert.equal(again[0].label, lost[0].label);
  assert.deepEqual(again[0].reached.map((r) => `${r.device} ${r.how}`), ["server delivered"]);
});

test("flooding, loops and stops: copies are not a single receiver, and a message that stopped is not shown arriving", () => {
  const flood = run("lan: unknown unicast flood").x.messages[0];
  assert.ok(flood.flooded && !flood.broadcast);
  assert.deepEqual(new Set(flood.reached.map((r) => `${r.device} ${r.how}`)), new Set(["extra discarded", "server delivered"]));
  // Broadcast copies leave a switch on different links: not a loop. A routing loop crosses the same link again.
  assert.ok(!run("internet: HTTP by name").x.messages.some((m) => m.loops));
  const loop = run("fail: routing loop").x;
  const looped = loop.messages.find((m) => m.loops)!;
  assert.deepEqual(looped.reached.map((r) => `${r.device} ${r.how}`), ["r2 no-further"]);
  assert.deepEqual(loop.stop?.device, "r2");
  // TTL expired at the router: the echo request went no further than the router.
  const ttl = run("fail: TTL 1").x;
  assert.deepEqual(brief(ttl).at(-1), "Echo request: pc → router no-further");
  // A cable is missing: the ARP request went no further than the switch, and the echo request was never sent.
  const cable = run("fail: lan cable missing").x;
  assert.deepEqual(brief(cable), ["Echo request: pc → ", "ARP request: pc → switch no-further"]);
  assert.equal(cable.messages[0].sent, undefined);
  // Nothing was sent at all: no messages, only the stop.
  const none = run("fail: no gateway").x;
  assert.deepEqual(none.messages, []);
  assert.deepEqual(none.participants, ["pc"]);
});

test("lifelines follow the diagram from left to right", () => {
  const { x, network } = run("internet: HTTP by name");
  const xs = x.participants.map((id) => network.devices.find((d) => d.id === id)!.x);
  assert.deepEqual(xs, [...xs].sort((a, b) => a - b));
  // The internet starter's devices really are spread out, so the order is meaningful.
  assert.ok(new Set(starter("internet").devices.map((d) => d.x)).size > 3);
});

test("the exchange of the largest run is computed quickly", () => {
  const largest = runs.reduce((a, b) => (b.trace.events.length > a.trace.events.length ? b : a));
  const t0 = performance.now();
  const x = exchangeOf(largest.trace.events, largest.network);
  const ms = performance.now() - t0;
  assert.ok(largest.trace.events.length > 2000 && x.messages.length > 90);
  assert.ok(ms < 250, `${ms} ms for ${largest.trace.events.length} events`);
  console.log(`# exchange of ${largest.name}: ${largest.trace.events.length} events, ${x.messages.length} messages, ${ms.toFixed(1)} ms`);
});
