import test from "node:test";
import assert from "node:assert/strict";
import { starter } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { explainStep } from "../src/practice/network/explanations.ts";
import type { Network } from "../src/practice/network/model.ts";

const load = (n: Network, url = "http://kitab.test/") =>
  simulate(n, newSession(), { kind: "http", source: "pc", target: url });
const pc = (n: Network) => n.devices.find((d) => d.id === "pc")!;
const generic = /A required condition for delivery is missing/;

function stopped(n: Network, url?: string) {
  const t = load(n, url);
  assert.equal(t.success, false);
  const last = t.events.at(-1)!;
  assert.equal(last.reason, t.reason);
  const why = explainStep(last, n);
  assert.doesNotMatch(why.why, generic);
  return { t, last, why };
}

test("a working DNS lookup still resolves and caches the name", () => {
  const t = load(starter("internet"));
  assert.equal(t.success, true, t.summary);
  assert.equal(t.session.dns["pc/kitab.test"], "198.51.100.20");
});

test("DNS pointed at a device that does not run DNS is not blamed on missing records", () => {
  const n = starter("internet");
  pc(n).interfaces[0].dns = "198.51.100.20"; // the web server
  const { t, last, why } = stopped(n);
  assert.equal(t.reason, "DNS_NO_SERVICE");
  assert.equal(last.actor, "server", "the device that received the query is highlighted");
  assert.match(t.summary, /does not run a DNS service/);
  // Pointing at the setting is advice: the playground shows it, missions leave it to the learner.
  assert.doesNotMatch(t.summary, /DNS server setting/);
  assert.match(t.failure!.advice!, /DNS server setting/);
  assert.doesNotMatch(t.summary, /Add the record/i);
  assert.match(why.detail, /port 53|service/);
});

test("a real DNS server without the record answers NXDOMAIN, and the answer travels back", () => {
  const n = starter("internet");
  const { t, last } = stopped(n, "http://nothere.test/");
  assert.equal(t.reason, "DNS_NO_RECORD");
  assert.match(t.summary, /NXDOMAIN/);
  assert.equal(last.actor, "pc", "the client learns the name does not exist");
  assert.ok(
    t.events.some((e) => e.actor === "pc" && e.layers.some((l) => l.name === "DNS error")),
    "the NXDOMAIN reply reaches the client",
  );
});

test("a DNS server address no device has is reported as a wrong setting", () => {
  for (const address of ["198.51.100.99", "192.168.1.53"]) {
    const n = starter("internet");
    pc(n).interfaces[0].dns = address;
    const { t } = stopped(n);
    assert.equal(t.reason, "DNS_SERVER_ADDRESS", address);
    assert.match(t.summary, new RegExp(`No device in this network has the address ${address.replaceAll(".", "\\.")}`));
  }
});

test("a DNS server that exists but cannot be reached is a path problem, not a DNS problem", () => {
  const n = starter("internet");
  n.links = n.links.filter((l) => l.a.device !== "dns" && l.b.device !== "dns");
  const { t } = stopped(n);
  assert.equal(t.reason, "DNS_UNREACHABLE");
  assert.match(t.summary, /could not reach DNS server at 198\.51\.100\.53/);
  assert.match(t.summary, /ARP received no reply/, "the underlying cause is kept");
});

test("a lost DNS reply without NAT explains private addresses instead of suggesting an ISP route", () => {
  const n = starter("internet");
  n.devices.find((d) => d.id === "router")!.nat = false;
  const { t, why } = stopped(n);
  assert.equal(t.reason, "DNS_REPLY_UNREACHABLE");
  assert.match(t.summary, /answered the DNS query, but the reply could not get back/);
  assert.match(t.summary, /private address \(RFC 1918\)/);
  assert.doesNotMatch(t.summary, /matching static route/);
  assert.match(why.detail, /reply/);
});

test("a DNS server learned from DHCP works the same way", () => {
  const n = starter("wifi");
  const lease = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" });
  const t = simulate(n, lease.session, { kind: "http", source: "phone", target: "http://pc.home.arpa/" });
  // The home router answers DNS (it has a record), then the PC at pc.home.arpa has no web service.
  assert.equal(t.session.dns["phone/pc.home.arpa"], "192.168.1.10");
  assert.match(t.summary, /no HTTP service/);
});
