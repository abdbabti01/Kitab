// Accuracy audit: the claims the IPv4 lessons make, checked as properties of the lab's simulator rather than examples.
// Lesson 1's same-subnet arithmetic decides the next hop; switches change nothing; each router lowers TTL by one and
// writes its own egress MAC; only a NAT router changes addresses, and its restore mirrors its translation.
import test from "node:test";
import assert from "node:assert/strict";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { starter } from "../src/practice/network/starters.ts";
import type { Network, TraceEvent } from "../src/practice/network/model.ts";
import { sameSubnet } from "../src/net/ipv4.ts";

const ping = (target: string) => ({ kind: "ping" as const, source: "pc", target, ttl: 64 });
const packet = (e: TraceEvent) => e.layers.find((l) => "Source IP" in l.fields)?.fields;
const frame = (e: TraceEvent) => e.layers.find((l) => "Source MAC" in l.fields)?.fields;

test("the PC's next hop is Lesson 1's arithmetic with its own prefix; a gateway off its subnet gives no route", () => {
  const targets = ["192.168.1.1", "192.168.1.20", "192.168.1.127", "192.168.1.128", "192.168.1.200", "192.168.0.5", "192.168.2.20", "192.168.3.9", "10.0.0.1", "192.169.1.10", "192.168.1.11"];
  let checked = 0;
  for (let prefix = 16; prefix <= 30; prefix++)
    for (const target of targets) {
      const network = starter("routed");
      network.devices.find((d) => d.id === "pc")!.interfaces[0].prefix = prefix;
      const trace = simulate(network, newSession(), ping(target));
      const route = trace.events.find((e) => e.actor === "pc" && e.title === "Choose a route");
      const direct = sameSubnet("192.168.1.10", target, prefix);
      if (!route) {
        // Only a remote destination with a gateway the PC can't reach on its own subnet has no route.
        assert.ok(!direct && !sameSubnet("192.168.1.10", "192.168.1.1", prefix), `/${prefix} → ${target}: ${trace.summary}`);
        assert.match(trace.summary, /no route/);
        continue;
      }
      checked++;
      assert.equal(!String(route.facts!.Route).startsWith("Default"), direct, `/${prefix} → ${target}: ${route.facts!.Route}`);
      assert.equal(route.facts!["Next hop"], direct ? target : "192.168.1.1", `/${prefix} → ${target}`);
    }
  assert.ok(checked > 100);
});

test("forwarding: switches change nothing; routers lower TTL by one and send from their own egress MAC; only NAT changes addresses", () => {
  for (const [id, target] of [["lan", "192.168.1.20"], ["routed", "192.168.2.20"], ["internet", "198.51.100.20"]] as const) {
    const network: Network = starter(id);
    const trace = simulate(network, newSession(), ping(target));
    assert.ok(trace.success, id);
    const device = (d: string) => network.devices.find((x) => x.id === d)!;
    const sends = new Map<string, TraceEvent[]>();
    for (const e of trace.events) if (e.title === "Transmit over Ethernet" && packet(e) && e.packet) sends.set(e.packet, [...(sends.get(e.packet) ?? []), e]);
    let routerHops = 0;
    for (const list of sends.values())
      for (let i = 1; i < list.length; i++) {
        const [a, b] = [list[i - 1], list[i]],
          kind = device(b.actor).kind,
          addressesChanged = packet(a)!["Source IP"] !== packet(b)!["Source IP"] || packet(a)!["Destination IP"] !== packet(b)!["Destination IP"];
        if (kind === "switch" || kind === "ap") {
          assert.equal(packet(b)!.TTL, packet(a)!.TTL, `${id}: ${b.actor} is not a hop`);
          assert.deepEqual([frame(b)!["Source MAC"], frame(b)!["Destination MAC"]], [frame(a)!["Source MAC"], frame(a)!["Destination MAC"]], `${id}: ${b.actor} keeps the frame`);
          assert.ok(!addressesChanged);
        } else if (kind === "router") {
          routerHops++;
          assert.equal(Number(packet(b)!.TTL), Number(packet(a)!.TTL) - 1, `${id}: ${b.actor} lowers TTL`);
          const port = String(frame(b)!["Outgoing port"]);
          assert.equal(frame(b)!["Source MAC"], device(b.actor).interfaces.find((p) => p.id === port)!.mac, `${id}: ${b.actor} sends from its ${port} MAC`);
          if (addressesChanged) assert.ok(device(b.actor).nat, `${id}: only a NAT router changes addresses (${b.actor})`);
        }
      }
    assert.ok(id === "lan" ? routerHops === 0 : routerHops > 0, id);
    // NAT: the outside address is the router's own WAN address, and the restore mirrors the translation.
    for (const e of trace.events.filter((x) => x.title === "Translate source with NAT")) {
      assert.equal(String(e.facts!.Outside).split(":")[0], device(e.actor).interfaces.find((p) => p.id === "wan")!.ip);
      const back = trace.events.find((x) => x.title === "Restore reply destination" && x.facts!.Outside === e.facts!.Outside)!;
      assert.equal(back.facts!.Inside, e.facts!.Inside);
      assert.equal(packet(back)!["Destination IP"], String(e.facts!.Inside).split(":")[0]);
    }
  }
});

test("the lab models prefixes /1 to /30 only, so /0, /31 and /32 stay arithmetic (the explorer says so)", () => {
  for (const prefix of [0, 31, 32]) {
    const network = starter("lan");
    network.devices.find((d) => d.id === "pc")!.interfaces[0].prefix = prefix;
    assert.equal(simulate(network, newSession(), ping("192.168.1.20")).success, false, `/${prefix} isn't simulated`);
  }
});
