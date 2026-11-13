// Regression tests for milestone 3a: DHCP server selection, lease-expiry and DNS wording.
// Nothing here may add an Offer, renew a lease or change the saved-network format.
import test from "node:test";
import assert from "node:assert/strict";
import { starter, starterOptions } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { explainStep, failures } from "../src/practice/network/explanations.ts";
import { narrate } from "../src/practice/network/narration.ts";
import { checkpointsOf } from "../src/practice/network/predict.ts";
import { missions } from "../src/practice/network/missions.ts";
import { importNetwork } from "../src/practice/network/topology.ts";
import type { Network, Trace } from "../src/practice/network/model.ts";

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const dhcp = { kind: "dhcp" as const, source: "phone", target: "" };
const run = (n: Network) => simulate(n, newSession(), dhcp);
const offers = (t: Trace) => t.events.filter((e) => e.title === "DHCP Offer").map((e) => e.actor);
const lease = (t: Trace) => Object.values(t.session.leases).find((l) => l.device === "phone");
// The Discover as heard by one device.
const heard = (t: Trace, actor: string, phase = "Discover") =>
  t.events.findIndex((e) => e.actor === actor && e.title === "Receive frame" && e.layers.some((l) => l.name === `DHCP ${phase}`));

// The Internet starter with Your PC as a second DHCP server on the home LAN. Your PC is found first.
function twoServers(pool: { start: string; end: string }) {
  const n = starter("internet");
  Object.assign(dev(n, "pc").dhcp, { enabled: true, port: "eth0", gateway: "192.168.1.1", dns: "198.51.100.53", ...pool });
  return n;
}
const outsideSubnet = { start: "10.0.0.100", end: "10.0.0.110" },
  backwards = { start: "192.168.1.210", end: "192.168.1.200" },
  usable = { start: "192.168.1.200", end: "192.168.1.210" };

test("a server whose pool has no usable address stays silent, and another server's lease is used", () => {
  const n = twoServers(outsideSubnet);
  const t = run(n);
  assert.equal(t.success, true, t.summary);
  assert.deepEqual(offers(t), ["router"]);
  assert.equal(lease(t)?.server, "router");
  const ctx = t.events.find((e) => e.dhcpContext)!.dhcpContext!;
  assert.equal(ctx.server, "router");
  assert.deepEqual(ctx.silent, ["pc"]);
  assert.equal(ctx.others, undefined, "a silent server is not described as one that would answer");
});

test("a server with an invalid pool also stays silent", () => {
  const t = run(twoServers(backwards));
  assert.equal(t.success, true, t.summary);
  assert.equal(lease(t)?.server, "router");
  assert.deepEqual(t.events.find((e) => e.dhcpContext)!.dhcpContext!.silent, ["pc"]);
});

test("a disabled or unreachable server is skipped as before, and is not called silent", () => {
  const off = twoServers(usable);
  dev(off, "pc").dhcp.enabled = false;
  const unplugged = twoServers(usable);
  unplugged.links = unplugged.links.filter((l) => l.a.device !== "pc" && l.b.device !== "pc");
  const down = twoServers(usable);
  dev(down, "pc").interfaces[0].enabled = false;
  for (const n of [off, unplugged, down]) {
    const t = run(n);
    assert.equal(t.success, true, t.summary);
    assert.equal(lease(t)?.server, "router");
    const ctx = t.events.find((e) => e.dhcpContext)!.dhcpContext!;
    assert.equal(ctx.silent, undefined);
    assert.equal(ctx.others, undefined);
  }
});

test("with two servers that can both offer, the first is followed as before and the other is named", () => {
  const t = run(twoServers(usable));
  assert.equal(t.success, true);
  assert.deepEqual(offers(t), ["pc"]);
  const ctx = t.events.find((e) => e.dhcpContext)!.dhcpContext!;
  assert.deepEqual(ctx.others, ["router"]);
  assert.equal(ctx.silent, undefined);
});

test("when no server can offer, the reason and the first server's message are kept, and the other server is named", () => {
  const n = twoServers(outsideSubnet);
  Object.assign(dev(n, "router").dhcp, { start: "10.0.0.100", end: "10.0.0.110" });
  const t = run(n);
  assert.equal(t.reason, "DHCP_POOL_EMPTY");
  assert.match(t.summary, /Your PC's pool 10\.0\.0\.100–10\.0\.0\.110 has no address/);
  assert.match(t.summary, /Home router also runs a DHCP server/);
  assert.equal(offers(t).length, 0);
  // A single server with an empty pool reads exactly as before.
  const single = starter("internet");
  Object.assign(dev(single, "router").dhcp, { start: "10.0.0.100", end: "10.0.0.110" });
  const s = run(single);
  assert.equal(s.reason, "DHCP_POOL_EMPTY");
  assert.doesNotMatch(s.summary, /also runs/);
  const invalid = starter("internet");
  Object.assign(dev(invalid, "router").dhcp, backwards);
  assert.equal(run(invalid).reason, "DHCP_POOL_INVALID");
});

test("no Offer is invented: one exchange, every DHCP message from the followed server or the client", () => {
  for (const n of [twoServers(outsideSubnet), twoServers(backwards), twoServers(usable)]) {
    const t = run(n);
    const server = t.events.find((e) => e.dhcpContext)!.dhcpContext!.server;
    for (const title of ["DHCP Discover", "DHCP Offer", "DHCP Request", "DHCP ACK"])
      assert.equal(t.events.filter((e) => e.title === title).length, 1, title);
    assert.ok(t.events.filter((e) => e.title === "DHCP Offer" || e.title === "DHCP ACK").every((e) => e.actor === server));
  }
});

test("a silent server is narrated and explained as silent, not as sending an Offer", () => {
  const n = twoServers(outsideSubnet);
  const t = run(n);
  for (const phase of ["Discover", "Request"]) {
    const i = heard(t, "pc", phase);
    assert.ok(i >= 0, phase);
    const said = narrate(t.events, i, n).summary;
    assert.match(said, /no address it can offer/);
    assert.doesNotMatch(said, /not a DHCP server|Offer of its own/);
    const why = explainStep(t.events[i], n).why;
    assert.match(why, /no address it can offer/);
    assert.doesNotMatch(why, /Offer of its own/);
  }
});

test("the Offer discloses that the lab follows one exchange instead of competing Offers", () => {
  const n = twoServers(outsideSubnet);
  const t = run(n);
  const offer = t.events.find((e) => e.title === "DHCP Offer")!;
  const text = Object.values(explainStep(offer, n)).join(" ");
  assert.match(text, /follows a single exchange/);
  assert.match(text, /every server with a free address sends its own Offer/);
  assert.doesNotMatch(text, /client (chooses|picks|compares)/);
});

test("Predict still expects success when another server can offer", () => {
  const n = twoServers(outsideSubnet);
  const c = checkpointsOf(run(n), n).find((c) => c.kind === "dhcp");
  assert.match(c?.options.find((o) => o.id === c.answer)?.text ?? "", /^Yes/);
});

test("lease-expiry text explains T1 and T2 and says the lab renews only when DHCP is run again", () => {
  const info = failures.DHCP_LEASE_EXPIRED;
  const all = [info.why, info.rule, info.check, info.real ?? ""].join(" ");
  assert.match(all, /T1/);
  assert.match(all, /50 ?%/);
  assert.match(all, /T2/);
  assert.match(all, /87\.5 ?%/);
  assert.match(all, /only when you run DHCP again/);
  assert.doesNotMatch(all, /length of the transfer/);
  // The lesson and narration shown on the expiry step agree.
  const n = starter("internet");
  dev(n, "router").dhcp.leaseSeconds = 30;
  const first = simulate(n, newSession(), dhcp);
  const later = simulate(n, { ...first.session, time: first.session.time + 31_000 }, { kind: "ping", source: "phone", target: "192.168.1.1" });
  const i = later.events.findIndex((e) => e.title === "DHCP lease expired");
  assert.ok(i >= 0, "the lease lapses");
  const step = Object.values(explainStep(later.events[i], n)).join(" ") + narrate(later.events, i, n).real;
  assert.match(step, /T1/);
  assert.match(step, /only when you run DHCP again/);
});

// The Internet starter with the client's DNS server set to the web server, which holds one record.
function webServerAsDns() {
  const n = starter("internet");
  dev(n, "server").records = { "kitab.test": "198.51.100.20" };
  dev(n, "pc").interfaces[0].dns = "198.51.100.20";
  return n;
}

test("NXDOMAIN says the device has no record for the name, not that a DNS server is working", () => {
  const n = webServerAsDns();
  const t = simulate(n, newSession(), { kind: "http", source: "pc", target: "missing.test" });
  assert.equal(t.reason, "DNS_NO_RECORD");
  assert.doesNotMatch(t.summary, /reachable and working/);
  assert.match(t.summary, /no record for/);
  const info = failures.DNS_NO_RECORD;
  assert.doesNotMatch(info.why, /working DNS server/);
  assert.match(info.real ?? "", /at least one DNS record/);
  assert.match(info.real ?? "", /own records/);
});

test("a device without records says the lab's rule for running DNS", () => {
  const n = starter("internet");
  dev(n, "pc").interfaces[0].dns = "198.51.100.20";
  const t = simulate(n, newSession(), { kind: "http", source: "pc", target: "kitab.test" });
  assert.equal(t.reason, "DNS_NO_SERVICE");
  assert.match(t.summary, /no DNS records/);
  assert.match(failures.DNS_NO_SERVICE.real ?? "", /at least one DNS record/);
});

test("the saved-network format is unchanged: every starter and mission network has exactly the production fields", () => {
  const deviceKeys = "dhcp,group,id,inside,interfaces,kind,name,nat,outside,password,records,routes,ssid,web,x,y";
  const portKeys = "dns,enabled,gateway,id,ip,mac,medium,mode,prefix";
  const networks = [
    ...starterOptions.map((s) => starter(s.id)),
    ...missions.flatMap((m) => m.variants.map((v) => v.build())),
  ];
  for (const n of networks) {
    assert.deepEqual(Object.keys(n).sort().join(), "devices,links,name,version");
    for (const d of n.devices) {
      assert.equal(Object.keys(d).sort().join(), deviceKeys, d.id);
      for (const p of d.interfaces) assert.equal(Object.keys(p).sort().join(), portKeys);
    }
    assert.deepEqual(importNetwork(JSON.stringify(n)), n);
  }
});
