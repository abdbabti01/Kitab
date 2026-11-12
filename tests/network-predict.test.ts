// Predict as you go: every checkpoint is read from the real trace. The Journey waits at `ask`, before any event
// shows the outcome; the outcome is recorded at `at`; and the correct choice is what the trace records there.
import test from "node:test";
import assert from "node:assert/strict";
import { checkpointsOf, optionDevices, type Checkpoint } from "../src/practice/network/predict.ts";
import { missions } from "../src/practice/network/missions.ts";
import { runSequence } from "../src/practice/network/mission-assess.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Network, Trace, TraceEvent } from "../src/practice/network/model.ts";

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
  return { ...r, cs: checkpointsOf(r.trace, r.network) };
};
const right = (c: Checkpoint) => c.options.find((o) => o.id === c.answer)!.text;
const field = (e: TraceEvent, layer: string, name: string) => e.layers.find((l) => l.name === layer)?.fields[name];
const ip = (text: string) => text.split(" ")[0];

test("every checkpoint asks before its outcome, and its answer is what the trace records", () => {
  let count = 0;
  const kinds = new Set<string>();
  for (const { name, network, trace } of runs) {
    const ev = trace.events;
    const cs = checkpointsOf(trace, network);
    assert.deepEqual(checkpointsOf(trace, network), cs, `${name}: deterministic`);
    let previous = 0;
    for (const c of cs) {
      count += 1;
      kinds.add(c.kind);
      const where = `${name} ${c.id}`;
      const out = ev[c.at];
      // In order, never overlapping: answering one never shows the next one's outcome.
      assert.ok(c.ask >= previous && c.ask >= 0 && c.at > c.ask, where);
      previous = c.at;
      // Nothing the learner can see at the question is the step that shows the outcome.
      assert.ok(!ev.slice(0, c.ask + 1).some((e) => e.actor === out.actor && e.title === out.title && e.packet === out.packet), `${where}: outcome visible`);
      assert.equal(new Set(c.options.map((o) => o.text)).size, c.options.length, where);
      assert.ok(c.options.length >= 2 && c.options.some((o) => o.id === c.answer), where);
      assert.ok(c.explain.length > 20, where);
      const r = right(c);
      // The correct choice is read from the recorded outcome.
      switch (c.kind) {
        case "next-hop":
          assert.equal(out.title, "Choose a route");
          assert.equal(ip(r), out.facts!["Next hop"], where);
          break;
        case "arp-answer":
          if (out.title === "ARP reply") assert.equal(r, network.devices.find((d) => d.id === out.actor)!.name, where);
          else assert.ok(out.error && out.reason!.startsWith("ARP_") && r.startsWith("No device"), where);
          break;
        case "arp-cache":
          assert.equal(r.startsWith("It uses the MAC address already"), out.title === "ARP cache hit", where);
          break;
        case "flood": {
          assert.match(out.title, /^Unknown MAC/);
          const copies = ev.filter((e, h) => e.packet === out.packet && e.hop?.from === out.actor && ev[h - 1].title.startsWith("Unknown MAC"));
          for (const e of copies) assert.ok(r.includes(network.devices.find((d) => d.id === e.hop!.to)!.name), where);
          break;
        }
        case "dhcp":
          assert.equal(r.startsWith("Yes"), out.title === "Apply DHCP lease", where);
          if (!r.startsWith("Yes")) assert.ok(out.error && /^DHCP_(NO_SERVER|POOL_EMPTY)$/.test(out.reason!), where);
          break;
        case "router":
          if (r.startsWith("Forward")) assert.ok(out.title === "Choose a route" && ev.some((e, i) => i > c.at && e.packet === out.packet && e.hop?.from === out.actor), where);
          else if (r.startsWith("Keep")) assert.equal(out.title, "Deliver IP payload", where);
          else assert.ok(out.error && c.at === ev.length - 1 && out.actor === c.device, where);
          break;
        case "nat-out":
          assert.equal(ip(r), field(out, "IPv4 packet", "Source IP"), where);
          // The source the learner sees at the question is the one before the router decided.
          assert.ok(!ev.slice(0, c.ask + 1).some((e) => e.packet === out.packet && field(e, "IPv4 packet", "Source IP") === ip(r) && ip(r) !== field(ev[c.ask], "IPv4 packet", "Source IP")), where);
          break;
        case "nat-in":
          assert.equal(out.title, "Restore reply destination");
          assert.equal(ip(r), field(out, "IPv4 packet", "Destination IP"), where);
          assert.notEqual(field(ev[c.ask], "IPv4 packet", "Destination IP"), ip(r), where);
          break;
        case "ack":
          assert.equal(out.title, "Acknowledge received bytes");
          assert.equal(Number(r), field(out, "TCP segment", "Acknowledgement"), where);
          break;
        case "loss":
          assert.equal(out.title, "Retransmit TCP segment");
          assert.equal(field(out, "TCP segment", "Sequence"), field(ev[c.ask], "TCP segment", "Sequence"), where);
          assert.equal(ev[c.ask].title, "Drop TCP data segment");
          break;
      }
    }
  }
  assert.ok(count > 150, `only ${count} checkpoints`);
  assert.deepEqual([...kinds].sort(), ["ack", "arp-answer", "arp-cache", "dhcp", "flood", "loss", "nat-in", "nat-out", "next-hop", "router"]);
});

test("the correct choice has no telltale position or length", () => {
  const all = runs.flatMap((r) => checkpointsOf(r.trace, r.network));
  const positions = new Set(all.map((c) => c.options.findIndex((o) => o.id === c.answer)));
  assert.ok(positions.size >= 3, "the correct choice moves between positions");
  for (const p of positions) assert.ok(all.filter((c) => c.options.findIndex((o) => o.id === c.answer) === p).length < all.length * 0.6);
  const longest = all.filter((c) => c.options.every((o) => o.id === c.answer || o.text.length < right(c).length));
  assert.ok(longest.length < all.length * 0.5, `${longest.length} of ${all.length} correct choices are the longest`);
  // Addresses are labelled with their device on every choice or on none.
  for (const c of all.filter((x) => x.options.every((o) => /^\d+\.\d+\.\d+\.\d+/.test(o.text))))
    assert.equal(new Set(c.options.map((o) => / \(.+\)$/.test(o.text))).size, 1, c.id);
});

test("a web request by name: next hop, ARP, the router, NAT both ways, the ARP cache and a cumulative ACK", () => {
  const { cs, trace } = run("internet: HTTP by name");
  assert.deepEqual(cs.map((c) => c.kind), ["next-hop", "arp-answer", "router", "nat-out", "nat-in", "arp-cache", "ack"]);
  const by = (k: string) => cs.find((c) => c.kind === k)!;
  assert.equal(by("next-hop").question, "Your PC has a packet for 198.51.100.53. Which address will it send it to first?");
  assert.equal(right(by("next-hop")), "192.168.1.1 (Home router)");
  assert.equal(right(by("arp-answer")), "Home router");
  assert.equal(right(by("router")), "Forward it on towards 198.51.100.53");
  assert.equal(right(by("nat-out")), "203.0.113.2 (Home router)");
  assert.match(by("nat-out").explain, /192\.168\.1\.10:53000 with its public address 203\.0\.113\.2:62000/);
  assert.equal(right(by("nat-in")), "192.168.1.10 (Your PC)");
  assert.equal(right(by("ack")), "1056");
  assert.match(by("ack").question, /received 55 bytes starting at sequence number 1001/);
  // The ACK question is asked where the data is delivered, before the acknowledgement is created.
  assert.equal(trace.events[by("ack").ask].title, "Deliver IP payload");
});

test("loss, DHCP, flooding and failures", () => {
  const loss = run("internet: HTTP with one loss").cs;
  const l = loss.find((c) => c.kind === "loss")!;
  assert.equal(right(l), "Your PC sends the same 55 bytes again, starting at sequence 1001");
  assert.ok(loss.findIndex((c) => c.kind === "ack") > loss.indexOf(l), "the ACK after the retransmission comes after");
  assert.equal(right(run("wifi: phone DHCP").cs[0]), "Yes: a DHCP server offers one and Your phone applies it");
  assert.equal(right(run("fail: no DHCP server").cs.find((c) => c.kind === "dhcp")!), "No: no DHCP server answers on this LAN");
  assert.equal(right(run("fail: DHCP pool exhausted").cs.find((c) => c.kind === "dhcp")!), "No: the DHCP server has no free address to give");
  const flood = run("lan: unknown unicast flood").cs[0];
  assert.equal(right(flood), "A copy out of every other port: to Other PC and Local server");
  assert.match(flood.explain, /Other PC discarded it/);
  assert.equal(right(run("fail: TTL 1").cs.find((c) => c.kind === "router")!), "Drop it: it goes no further than Router");
  assert.equal(right(run("fail: wrong gateway").cs.find((c) => c.kind === "arp-answer")!), "No device: nobody on this LAN replies for 192.168.1.99");
  // NAT off: the packet leaves with its private source, which the trace shows.
  assert.equal(right(run("fail: NAT off ping").cs.find((c) => c.kind === "nat-out")!), "192.168.1.10 (Your PC)");
  // Nothing to predict when nothing was decided: no checkpoint is invented.
  assert.deepEqual(run("fail: no gateway").cs, []);
  assert.deepEqual(run("fail: wifi wrong password").cs, []);
});

test("every starter's own journey has something to predict, and checkpoints are quick to find", () => {
  for (const name of ["internet: HTTP by name", "lan: HTTP", "wifi: phone DHCP", "routed: ping"]) assert.ok(run(name).cs.length >= 1, name);
  const largest = runs.reduce((a, b) => (b.trace.events.length > a.trace.events.length ? b : a));
  const t0 = performance.now();
  checkpointsOf(largest.trace, largest.network);
  const ms = performance.now() - t0;
  assert.ok(ms < 100, `${ms} ms`);
  console.log(`# checkpoints of ${largest.name}: ${largest.trace.events.length} events in ${ms.toFixed(1)} ms`);
});

test("a wrong choice can say what it mixes up, using the same recorded values", () => {
  for (const { name, network, trace } of runs)
    for (const c of checkpointsOf(trace, network))
      for (const o of c.options.filter((x) => x.why)) {
        const where = `${name} ${c.id} ${o.text}`;
        assert.notEqual(o.id, c.answer, where);
        if (c.kind === "ack") assert.ok(o.why!.includes(right(c)), `${where}: names the real ACK`);
        if (c.kind === "next-hop") assert.ok(o.why!.includes(ip(right(c))), `${where}: names the real next hop`);
        if (c.kind === "arp-answer" && o.why!.includes("not broadcast")) {
          const reply = trace.events.find((e) => e.packet?.endsWith("-reply") && e.frame && e.layers.some((l) => l.name === "ARP reply"))!;
          assert.notEqual(field(reply, "Ethernet frame", "Destination MAC"), "ff:ff:ff:ff:ff:ff", where);
        }
      }
  const { cs } = run("internet: HTTP by name");
  const why = (kind: string, text: string) => cs.find((c) => c.kind === kind)!.options.find((o) => o.text === text)?.why;
  assert.match(why("next-hop", "198.51.100.53 (DNS server)")!, /is the destination address\. It stays in the packet's IPv4 header/);
  assert.match(why("arp-answer", "Your phone")!, /received the broadcast.*its reply is sent to Your PC alone, not broadcast/);
  assert.match(why("ack", "1001")!, /sequence number of the first byte that arrived/);
  assert.match(why("nat-out", "192.168.1.10 (Your PC)")!, /rewrites the source, not the destination/);
});

test("devices that can be tapped as answers are exactly the ones a choice names, each for one choice", () => {
  let tappable = 0;
  for (const { name, network, trace } of runs)
    for (const c of checkpointsOf(trace, network)) {
      const on = optionDevices(c, network);
      assert.equal(new Set(on.map((a) => a.device)).size, on.length, name);
      for (const a of on) {
        const text = c.options.find((o) => o.id === a.option)!.text;
        const d = network.devices.find((x) => x.id === a.device)!;
        assert.ok(text === d.name || text.endsWith(` (${d.name})`), `${name} ${c.id}: "${text}" is not ${d.name}`);
      }
      // A choice that names no device (or "No device: ...") is never put on the diagram.
      for (const o of c.options.filter((o) => !on.some((a) => a.option === o.id))) assert.ok(!network.devices.some((d) => o.text === d.name), `${name} ${c.id}: ${o.text}`);
      tappable += on.length;
    }
  assert.ok(tappable > 0);
  // The ARP question: the device that replied is the tappable right answer.
  const { cs, network } = run("internet: HTTP by name");
  const arp = cs.find((c) => c.kind === "arp-answer")!;
  assert.equal(network.devices.find((d) => d.id === optionDevices(arp, network).find((a) => a.option === arp.answer)!.device)!.name, right(arp));
});
