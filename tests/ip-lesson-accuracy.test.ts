// IP lesson accuracy fixes A1–A5 (ip-addressing-audit-proposal.md). Wording only: the lesson keeps version 1.1.0, so
// existing completion is untouched, and every value is still computed by the engine.
import test from "node:test";
import assert from "node:assert/strict";
import "../src/learning/engines/index.ts";
import { findLesson } from "../src/learning/lessons/catalog.ts";
import { validateLessonContent } from "../src/learning/lessons/runtime.ts";
import { ipTerms } from "../src/learning/lessons/ip-terms.ts";
import { ipAddressing } from "../src/learning/lessons/ip-addressing.ts";

const term = (id: string) => ipTerms.find((t) => t.id === id)!;

test("A1: a next hop is the next IP device, never a switch or access point", () => {
  const { definition } = term("hop");
  assert.match(definition, /next IP device/);
  assert.match(definition, /a router, or the destination itself/);
  assert.match(definition, /Switches and access points .* are not hops/);
  assert.doesNotMatch(definition, /^The device that receives the packet next/);
});

test("A2: the prefix control says it changes every device, not only the PC", () => {
  const control = ipAddressing.controls!.find((c) => c.key === "prefix")!;
  assert.equal(control.label, "LAN prefix (every device)");
  assert.doesNotMatch(control.label, /^PC /);
  // The help already describes a real split; the label now agrees with it.
  assert.match(control.help, /every device uses the new prefix/);
});

test("A3: prefix notation and the longest-match rule are cited to the sections that state them", () => {
  const source = ipAddressing.sources.find((s) => s.id === "cidr-blocks")!.text;
  assert.match(source, /RFC 4632 §3\.1\./);
  assert.match(source, /RFC 1812 §5\.2\.4\.3 \(Longest Match\)/);
  assert.match(source, /RFC 4632 §5\.1/);
  assert.doesNotMatch(source, /RFC 4632 §3\. /);
});

test("A4: a private address names the three RFC 1918 ranges", () => {
  const { definition } = term("private");
  for (const range of ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) assert.ok(definition.includes(range), range);
  assert.match(definition, /RFC 1918/);
});

test("A5: an IP address can be static or from DHCP, not only assigned by the network", () => {
  const { definition } = term("ip-address");
  assert.match(definition, /by hand \(a static address\)/);
  assert.match(definition, /DHCP/);
  assert.doesNotMatch(definition, /by the network it joins/);
});

test("the lesson keeps version 1.1.0 and all its content still resolves", () => {
  const lesson = findLesson("ip-addressing")!;
  assert.equal(lesson.version, "1.1.0");
  assert.equal(lesson.engine.version, "1.1.0");
  assert.deepEqual(validateLessonContent(lesson), []);
});
