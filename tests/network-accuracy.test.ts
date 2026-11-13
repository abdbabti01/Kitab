// Regression tests for the networking accuracy audit of d0f9f60 (milestone 1: diagnostics and explanations).
// Each test reproduces an audited inaccuracy; none of them changes what the network does.
import test from "node:test";
import assert from "node:assert/strict";
import { starter } from "../src/practice/network/starters.ts";
import * as engine from "../src/practice/network/engine.ts";
const { newSession, simulate } = engine;
const routingTable: typeof engine.routingTable = (...a) => engine.routingTable(...a);
import { explainStep, failures } from "../src/practice/network/explanations.ts";
import { narrate } from "../src/practice/network/narration.ts";
import { checkpointsOf } from "../src/practice/network/predict.ts";
import { glossary } from "../src/practice/network/packets.ts";
import type { Network } from "../src/practice/network/model.ts";

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const ping = (target: string) => ({ kind: "ping" as const, source: "pc", target });
const row = (rows: [string, string][], key: string) => rows.find(([k]) => k === key)?.[1];

// Two connected LANs, and a router route to 10.0.3.0/24 whose next hop is on no network the router is connected to.
function offSubnetRoute() {
  const n = starter("routed");
  dev(n, "router").routes.push({ network: "10.0.3.0", prefix: 24, via: "172.16.0.1", port: "wan" });
  return n;
}

test("a matching static route with an unusable next hop is diagnosed as unusable, not as missing", () => {
  const n = offSubnetRoute();
  const t = simulate(n, newSession(), ping("10.0.3.20"));
  assert.equal(t.reason, "ROUTE_UNUSABLE");
  assert.match(t.summary, /10\.0\.3\.0\/24/);
  assert.match(t.summary, /172\.16\.0\.1/);
  assert.match(t.summary, /192\.168\.2\.0\/24/);
  assert.doesNotMatch(t.summary, /None of its/);
  assert.doesNotMatch(explainStep(t.events.at(-1)!, n).why, /No entry/);
});

test("a static route out of a turned-off interface is unusable, and says why", () => {
  const n = starter("routed");
  const r = dev(n, "router");
  r.routes.push({ network: "10.0.3.0", prefix: 24, via: "192.168.2.254", port: "wan" });
  r.interfaces[1].enabled = false;
  const t = simulate(n, newSession(), ping("10.0.3.20"));
  assert.equal(t.reason, "ROUTE_UNUSABLE");
  assert.match(t.summary, /turned off/);
});

test("without a gateway, a host's unusable static route is named instead of only the missing gateway", () => {
  const n = starter("routed");
  const pc = dev(n, "pc");
  pc.interfaces[0].gateway = "";
  pc.routes.push({ network: "192.168.2.0", prefix: 24, via: "10.9.9.9", port: "eth0" });
  const t = simulate(n, newSession(), ping("192.168.2.20"));
  assert.equal(t.reason, "ROUTE_UNUSABLE");
  assert.match(t.summary, /10\.9\.9\.9/);
});

test("when a less specific route is used instead, the route choice says why the static route was skipped", () => {
  const n = starter("routed");
  dev(n, "pc").routes.push({ network: "192.168.2.0", prefix: 24, via: "10.9.9.9", port: "eth0" });
  const t = simulate(n, newSession(), ping("192.168.2.20"));
  assert.equal(t.success, true);
  const choice = t.events.find((e) => e.title === "Choose a route" && e.actor === "pc")!;
  assert.match(choice.explanation, /Static 192\.168\.2\.0\/24 also matches but is not used/);
});

test("routes that are still usable are diagnosed and chosen exactly as before", () => {
  const t = simulate(starter("routed"), newSession(), ping("10.9.9.9"));
  assert.equal(t.reason, "ROUTER_NO_ROUTE");
  const choice = simulate(starter("routed"), newSession(), ping("192.168.2.20")).events.find((e) => e.title === "Choose a route")!;
  assert.doesNotMatch(choice.explanation, /not used/);
});

test("the routing table marks an unusable static route inactive", () => {
  const n = offSubnetRoute();
  const rows = routingTable(dev(n, "router"), newSession());
  assert.equal(row(rows, "192.168.1.0/24"), "connected · lan");
  assert.equal(row(rows, "192.168.2.0/24"), "connected · wan");
  assert.match(row(rows, "10.0.3.0/24")!, /^172\.16\.0\.1 · wan · inactive: /);
});

test("the routing table marks a turned-off interface's network and gateway inactive", () => {
  const n = starter("routed");
  const pc = dev(n, "pc");
  pc.interfaces[0].enabled = false;
  const rows = routingTable(pc, newSession());
  assert.match(row(rows, "192.168.1.0/24")!, /inactive: eth0 is turned off/);
  assert.match(row(rows, "default")!, /inactive: eth0 is turned off/);
  // And routing agrees: the PC has no usable route.
  assert.equal(simulate(n, newSession(), ping("192.168.2.20")).reason, "NO_ADDRESS");
});

// The Internet starter with Your PC as a second (rogue) DHCP server on the same LAN as the home router.
function twoDhcpServers() {
  const n = starter("internet");
  Object.assign(dev(n, "pc").dhcp, { enabled: true, port: "eth0", start: "192.168.1.200", end: "192.168.1.210", gateway: "192.168.1.254", dns: "198.51.100.53" });
  return n;
}

test("an enabled DHCP server the lab did not follow is never called 'not a DHCP server'", () => {
  const n = twoDhcpServers();
  const t = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" });
  const offers = t.events.filter((e) => e.title === "DHCP Offer").map((e) => e.actor);
  assert.deepEqual(offers, ["pc"], "the engine still follows one server; only the narration changes");
  const heard = t.events.flatMap((e, i) =>
    e.actor === "router" && e.title === "Receive frame" && e.layers.some((l) => l.name === "DHCP Discover" || l.name === "DHCP Request") ? [i] : [],
  );
  assert.ok(heard.length >= 2);
  for (const i of heard) {
    const summary = narrate(t.events, i, n).summary;
    assert.doesNotMatch(summary, /not a DHCP server/);
    assert.match(summary, /also runs a DHCP server/);
    const why = explainStep(t.events[i], n).why;
    assert.doesNotMatch(why, /It is not the DHCP server handling this exchange, so it does not answer/);
    assert.match(why, /also runs a DHCP server/);
  }
});

test("a device without a DHCP server is still told apart from one with it", () => {
  const n = starter("internet");
  const t = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" });
  const i = t.events.findIndex((e) => e.actor === "pc" && e.title === "Receive frame" && e.layers.some((l) => l.name === "DHCP Discover"));
  assert.match(narrate(t.events, i, n).summary, /not a DHCP server/);
});

test("with no DHCP server, the explanation agrees that the Discover was broadcast", () => {
  const n = starter("wifi");
  dev(n, "router").dhcp.enabled = false;
  const t = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" });
  assert.equal(t.reason, "DHCP_NO_SERVER");
  assert.ok(t.events.some((e) => e.hop && e.layers.some((l) => l.name === "DHCP Discover")), "the trace transmits the Discover");
  assert.doesNotMatch(failures.DHCP_NO_SERVER.real ?? "", /before sending/);
  assert.doesNotMatch(explainStep(t.events.at(-1)!, n).detail, /stops before sending the Discover/);
});

test("renewing while a lease is held is not described as having no address", () => {
  const n = starter("internet");
  const first = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" });
  const ip = first.session.leases["phone/wlan0"].ip;
  // A first request: no address yet, as before.
  const d0 = first.events.findIndex((e) => e.title === "DHCP Discover");
  assert.match(narrate(first.events, d0, n).summary, /has no IP address yet/);
  const again = simulate(n, first.session, { kind: "dhcp", source: "phone", target: "" });
  const d = again.events.findIndex((e) => e.title === "DHCP Discover");
  const summary = narrate(again.events, d, n).summary;
  assert.doesNotMatch(summary, /no IP address yet/);
  assert.ok(summary.includes(ip));
  const question = checkpointsOf(again, n).find((c) => c.kind === "dhcp")?.question ?? "";
  assert.doesNotMatch(question, /no address yet/);
  assert.ok(question.includes(ip));
});

test("Destination MAC is the next IP hop's address, not the next device on the link", () => {
  const meaning = glossary["Destination MAC"].meaning;
  assert.doesNotMatch(meaning, /next device on this link/);
  assert.match(meaning, /next IP hop/);
  assert.match(meaning, /[Ss]witches and access points/);
  assert.match(glossary["Destination MAC"].source ?? "", /802\.11/);
  assert.match(glossary["Source MAC"].source ?? "", /802\.11/);
});

test("a router falls back to its usable default route past an unusable, more specific one", () => {
  const n = starter("internet");
  dev(n, "router").routes.push({ network: "198.51.100.0", prefix: 24, via: "10.9.9.9", port: "wan" });
  const t = simulate(n, newSession(), { kind: "http", source: "pc", target: "http://kitab.test/" });
  assert.equal(t.success, true);
  const choice = t.events.find((e) => e.title === "Choose a route" && e.actor === "router")!;
  assert.equal(choice.facts?.Route, "Static 0.0.0.0/0");
  assert.match(choice.explanation, /Static 198\.51\.100\.0\/24 also matches but is not used: its next hop 10\.9\.9\.9/);
});

test("of two routes to the same network, the usable one carries the packet and nothing is reported unusable", () => {
  const n = starter("routed");
  const r = dev(n, "router");
  r.routes.push({ network: "10.0.3.0", prefix: 24, via: "172.16.0.1", port: "wan" });
  r.routes.push({ network: "10.0.3.0", prefix: 24, via: "192.168.2.20", port: "wan" });
  const t = simulate(n, newSession(), ping("10.0.3.20"));
  assert.notEqual(t.reason, "ROUTE_UNUSABLE");
  const choice = t.events.find((e) => e.title === "Choose a route" && e.actor === "router")!;
  assert.equal(choice.facts?.["Next hop"], "192.168.2.20");
  assert.doesNotMatch(choice.explanation, /not used/);
});
