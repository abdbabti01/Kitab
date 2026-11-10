import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { findJourney, findLesson } from "../src/learning/lessons/catalog.ts";
import { resolveTrack, validateLessonContent } from "../src/learning/lessons/runtime.ts";

test("the subnet mask changes the route to the same printer", () => {
  const wide = buildTrace("ip-addressing", { prefix: 24, target: "printer" }).outcome;
  const narrow = buildTrace("ip-addressing", { prefix: 25, target: "printer" }).outcome;
  assert.deepEqual(wide, {
    mask: "255.255.255.0", clientNetwork: "192.168.1.0", destinationNetwork: "192.168.1.0",
    destination: "192.168.1.130", nextHop: "192.168.1.130", direct: true,
  });
  assert.deepEqual(narrow, {
    mask: "255.255.255.128", clientNetwork: "192.168.1.0", destinationNetwork: "192.168.1.128",
    destination: "192.168.1.130", nextHop: "192.168.1.1", direct: false,
  });
});

test("NAT maps the outbound source to the inbound destination and preserves the server endpoint", () => {
  const trace = buildTrace("ip-addressing", { prefix: 24, target: "web" });
  const facts = (id: string) => Object.fromEntries(trace.frames.find((frame) => frame.id === id)!.facts.map(({ id, value }) => [id, value]));
  const outbound = facts("nat-out");
  const inbound = facts("nat-in");
  assert.equal(outbound["packet-before"], "192.168.1.10:51514 → 198.51.100.20:80");
  assert.equal(outbound["packet-after"], "203.0.113.8:62001 → 198.51.100.20:80");
  assert.equal(inbound["packet-before"], "198.51.100.20:80 → 203.0.113.8:62001");
  assert.equal(inbound["packet-after"], "198.51.100.20:80 → 192.168.1.10:51514");
});

test("the IP lesson resolves every prefix and destination and leads to Packet Journey", () => {
  const lesson = findLesson("ip-addressing");
  assert.ok(lesson);
  assert.equal(lesson.nextLessonId, "hello-tcp");
  assert.equal(findJourney(lesson.nextLessonId)?.title, "Packet Journey");
  assert.deepEqual(validateLessonContent(lesson), []);
  for (const prefix of [24, 25]) {
    for (const target of ["phone", "printer", "web"]) {
      const { steps } = resolveTrack(lesson, { prefix, target });
      assert.equal(steps.length, 12);
      assert.ok(steps.findIndex((step) => step.id === "meet-subnet") < steps.findIndex((step) => step.id === "apply-mask"));
      assert.ok(steps.some((step) => step.what.includes("192.168.1.10")));
    }
  }
});

test("the networking glossary gives a definition, purpose and example for each term", () => {
  const { glossary } = findLesson("ip-addressing")!;
  for (const term of glossary) {
    assert.ok(term.definition && term.purpose && term.example, term.term);
  }
  const subnet = glossary.find((term) => term.id === "subnet")!;
  assert.match(subnet.definition, /block of IP addresses/);
  assert.match(subnet.purpose!, /directly/);
  assert.match(subnet.example!, /192\.168\.1\.0\/24/);
});

test("the lesson's /25 split and the Neighbours mission's mask mismatch follow the same rules", async () => {
  const { starter } = await import("../src/practice/network/starters.ts");
  const { newSession, simulate } = await import("../src/practice/network/engine.ts");
  const { missions } = await import("../src/practice/network/missions.ts");
  type Net = ReturnType<typeof starter>;
  const dev = (n: Net, id: string) => n.devices.find((d) => d.id === id)!;
  const ping = (n: Net) => simulate(n, newSession(), { kind: "ping", source: "pc", target: "192.168.1.130" });
  const firstArp = (t: ReturnType<typeof ping>) =>
    t.events.flatMap((e) => e.layers).find((l) => l.name === "ARP request")?.fields["Who has"];

  // /24: one subnet. The playground delivers directly, as the lesson says.
  const lesson24 = buildTrace("ip-addressing", { prefix: 24, target: "printer" });
  const flat = starter("lan");
  dev(flat, "server").interfaces[0].ip = "192.168.1.130";
  const t24 = ping(flat);
  assert.equal(t24.success, true, t24.summary);
  assert.equal(firstArp(t24), lesson24.outcome.nextHop);

  // /25: the lesson's split. Every device uses /25 and the router has an interface in each half.
  const lesson25 = buildTrace("ip-addressing", { prefix: 25, target: "printer" });
  const data = lesson25.frames[0].data as { routerLan: { address: string }[] };
  assert.deepEqual(data.routerLan.map((lan) => lan.address), ["192.168.1.1", "192.168.1.129"]);
  const split = starter("routed");
  Object.assign(dev(split, "pc").interfaces[0], { prefix: 25, gateway: data.routerLan[0].address });
  Object.assign(dev(split, "router").interfaces[0], { ip: data.routerLan[0].address, prefix: 25 });
  Object.assign(dev(split, "router").interfaces[1], { ip: data.routerLan[1].address, prefix: 25 });
  Object.assign(dev(split, "server").interfaces[0], { ip: "192.168.1.130", prefix: 25, gateway: data.routerLan[1].address });
  const t25 = ping(split);
  assert.equal(t25.success, true, t25.summary);
  assert.equal(firstArp(t25), lesson25.outcome.nextHop, "the PC hands the packet to the router, as the lesson says");
  assert.ok(t25.events.some((e) => e.title === "Decrease TTL" && e.actor === "router"));

  // The Neighbours mission's first version: only the PC uses /25 and there is no router. That is a mismatch, and it fails.
  const mismatch = missions.find((m) => m.id === "neighbours")!.variants.find((v) => v.id === "pc-mask")!.build();
  assert.equal(dev(mismatch, "pc").interfaces[0].prefix, 25);
  assert.equal(dev(mismatch, "server").interfaces[0].prefix, 24);
  assert.ok(!mismatch.devices.some((d) => d.kind === "router"));
  assert.equal(ping(mismatch).success, false);
});
