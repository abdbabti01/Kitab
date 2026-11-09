import test from "node:test";
import assert from "node:assert/strict";
import { accessJourney, technologies } from "../src/practice/network/access.ts";
import { parseRoute } from "../src/app/routes.ts";
test("all access and local-media combinations preserve request/reply addressing across NAT", () => {
  for (const tech of Object.keys(technologies) as (keyof typeof technologies)[])
    for (const local of ["wifi", "ethernet"] as const)
      for (const combined of [true, false]) {
        const stages = accessJourney(tech, local, combined),
          get = (id: string) => stages.find((s) => s.id === id)!;
        assert.equal(new Set(stages.map((s) => s.id)).size, stages.length);
        assert.equal(get("local-out").src, "192.168.1.100");
        assert.equal(get("access-out").src, "203.0.113.10");
        assert.equal(get("access-out").sourcePort, 62000);
        assert.equal(get("access-back").dst, "203.0.113.10");
        assert.equal(get("local-back").dst, "192.168.1.100");
        assert.equal(get("local-back").destPort, 51514);
        assert.equal(get("local-out").payload, get("access-out").payload);
        assert.notEqual(get("access-back").payload, get("access-out").payload);
        assert.equal(get("access-out").carrier, get("access-back").carrier);
        assert.equal(
          get("access-out").carrier.includes("Light"),
          tech === "fiber",
        );
        assert.equal(!!get("join"), local === "wifi");
        assert.equal(get("handoff").carrier.includes("Internal"), combined);
        assert.ok(
          stages.findIndex((s) => s.id === "dhcp") <
            stages.findIndex((s) => s.id === "request"),
        );
        assert.ok(!get("dhcp").payload);
        assert.deepEqual(get("local-back").hop, [1, 0]);
      }
});
test("technology explorer route resolves", () =>
  assert.deepEqual(parseRoute("/practice/connections"), {
    name: "access-explorer",
  }));
