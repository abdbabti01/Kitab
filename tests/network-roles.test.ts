import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { deviceRole } from "../src/practice/network/roles.ts";
import { boxRoles, technologies } from "../src/practice/network/access.ts";

const all = scenarios();
const run = (name: string) => all.find((s) => s.name === name)!;
const role = (name: string, id: string, index?: number) => {
  const s = run(name);
  return deviceRole(s.network.devices.find((d) => d.id === id)!, s.network, s.trace.events, index ?? s.trace.events.length - 1);
};

test("a device's role reflects what it actually did in this run, up to the current step", () => {
  const router = role("internet: HTTP by name", "router");
  assert.match(router.what, /Here it also runs a DHCP server and NAT/);
  assert.ok(router.did.some((l) => /Translated \d+ outgoing packets to its public address \(NAT\)/.test(l)));
  assert.ok(router.did.some((l) => /Static 0\.0\.0\.0\/0 → 203\.0\.113\.1/.test(l)));
  // Before the request leaves the PC, the router has done nothing yet.
  assert.deepEqual(role("internet: HTTP by name", "router", 1).did, []);
  const sw = role("lan: ping", "switch");
  assert.ok(sw.did.some((l) => /Learned where 2 MAC addresses are/.test(l)));
  assert.match(sw.not, /does not read IP addresses/);
  // Only the DNS server is credited with answering DNS, not the routers that forwarded the answer.
  assert.ok(role("internet: HTTP by name", "dns").did.includes("Answered 1 DNS query."));
  assert.ok(!role("internet: HTTP by name", "router").did.some((l) => l.includes("DNS query")));
  // A bystander that only overheard broadcasts says so.
  const pc = role("wifi: phone DHCP", "pc");
  assert.deepEqual(pc.did, []);
});

test("the table entry shown is the one behind the device's latest decision", () => {
  const s = run("internet: HTTP by name");
  const i = s.trace.events.findIndex((e) => e.title === "Translate source with NAT");
  const r = role("internet: HTTP by name", "router", i);
  assert.deepEqual(r.entry, { table: "NAT table", row: "192.168.1.10:53000 ↔ 203.0.113.2:62000" });
  assert.match(r.now, /replaces the private source/);
  const phone = role("wifi: phone DHCP", "phone");
  assert.match(phone.entry!.row, /Joined “Kitab Wi-Fi”|192\.168\.1\.100\/24 from Home router/);
});

test("the connection explorer never gives a modem or ONT a router's jobs", () => {
  for (const tech of Object.keys(technologies) as (keyof typeof technologies)[])
    for (const combined of [true, false]) {
      const [, router, terminal, provider] = boxRoles(tech, combined);
      assert.equal(terminal.name, technologies[tech].terminal);
      assert.match(terminal.not, /does not route, hand out addresses or translate them with NAT/);
      assert.match(router.does.join(" "), /NAT/);
      assert.ok(provider.what.includes(technologies[tech].provider));
      assert.match(router.what, combined ? /here also the/ : /separate/);
    }
  assert.match(boxRoles("fiber", true)[2].what, /OLT tells each ONT when it may send/);
  assert.match(boxRoles("cable", false)[2].what, /CMTS/);
  assert.match(boxRoles("dsl", false)[2].what, /DSLAM/);
});
