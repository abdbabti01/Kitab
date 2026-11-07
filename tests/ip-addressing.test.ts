import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
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
  assert.ok(findLesson(lesson.nextLessonId));
  assert.deepEqual(validateLessonContent(lesson), []);
  for (const prefix of [24, 25]) {
    for (const target of ["phone", "printer", "web"]) {
      const { steps } = resolveTrack(lesson, { prefix, target });
      assert.equal(steps.length, 11);
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
