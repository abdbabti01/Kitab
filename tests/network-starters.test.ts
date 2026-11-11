import test from "node:test";
import assert from "node:assert/strict";
import { starter, starterOptions } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { stagesOf } from "../src/practice/network/stages.ts";
import { narrate } from "../src/practice/network/narration.ts";

// Each starter's guided steps, run in order on one session, exactly as the playground runs them.
function runSteps(id: string) {
  const network = starter(id);
  const steps = starterOptions.find((s) => s.id === id)!.steps!;
  let session = newSession();
  return steps.map((step) => {
    const trace = simulate(network, session, step.action);
    assert.equal(trace.success, true, `${id}: ${trace.summary}`);
    session = trace.session;
    return { trace, stages: stagesOf(trace.events, network).map((s) => s.title) };
  });
}

test("every path starter has guided steps whose notes name the button that runs them", () => {
  for (const id of ["lan", "wifi", "routed", "internet"]) {
    const steps = starterOptions.find((s) => s.id === id)?.steps;
    assert.ok(steps?.length, id);
    for (const s of steps) assert.match(s.note, s.action.kind === "dhcp" ? /Configure automatically/ : /Send request/);
  }
});

test("Your first LAN pings a neighbour: ARP and the switch, no gateway, no TCP", () => {
  const [{ trace, stages }] = runSteps("lan");
  assert.deepEqual(stages, [
    "Send a ping · Your PC",
    "ARP · Your PC looks for 192.168.1.20",
    "Echo request · Your PC → Local server",
    "Echo reply · Local server → Your PC",
    "Ping complete",
  ]);
  assert.ok(trace.events.length < 60, `${trace.events.length} events`);
  assert.ok(trace.events.some((e) => e.actor === "switch"), "the switch forwards the frames");
  assert.ok(!trace.events.some((e) => e.layers.some((l) => l.name === "TCP segment")));
});

test("A wireless home joins Wi-Fi, then DHCP gives the phone an address", () => {
  const [{ trace, stages }] = runSteps("wifi");
  assert.deepEqual(stages, [
    "Join Wi-Fi · Your phone",
    "DHCP Discover · Your phone",
    "DHCP Offer · Home router",
    "DHCP Request · Your phone",
    "DHCP ACK · Home router",
  ]);
  assert.ok(trace.events.length < 80, `${trace.events.length} events`);
  assert.equal(trace.session.leases["phone/wlan0"]?.ip, "192.168.1.100");
});

test("the wireless home's PC uses the home router for DNS, like its DHCP clients", () => {
  const n = starter("wifi");
  const pc = n.devices.find((d) => d.id === "pc")!;
  const router = n.devices.find((d) => d.id === "router")!;
  assert.equal(pc.interfaces[0].dns, router.dhcp.dns);
  const t = simulate(n, newSession(), { kind: "http", source: "pc", target: "http://home.test/", ttl: 64 });
  assert.ok(stagesOf(t.events, n).some((s) => s.title === "Name resolved"), t.summary);
});

test("Two connected LANs pings across the router: the PC's gateway, then the router forwards", () => {
  const [{ trace, stages }] = runSteps("routed");
  assert.deepEqual(stages, [
    "Send a ping · Your PC",
    "ARP · Your PC looks for 192.168.1.1",
    "Echo request · Your PC → Router",
    "ARP · Router looks for 192.168.2.20",
    "Echo request · Router → Office server",
    "Echo reply · Office server → Your PC",
    "Ping complete",
  ]);
  assert.ok(trace.events.length < 60, `${trace.events.length} events`);
  assert.ok(!trace.events.some((e) => e.layers.some((l) => l.name === "TCP segment")));
});

test("A request across the Internet: the phone gets an address first, then loads the page over Wi-Fi", () => {
  const [dhcp, http] = runSteps("internet");
  assert.equal(dhcp.stages[0], "Join Wi-Fi · Your phone");
  assert.ok(dhcp.trace.session.leases["phone/wlan0"]);
  const t = http.trace;
  assert.ok(http.stages.includes("Look up the name · Your phone"), "the phone itself asks DNS");
  assert.ok(t.events.some((e) => e.layers.some((l) => l.name === "Wi-Fi frame")), "the phone sends over Wi-Fi");
  assert.ok(t.session.nat.length, "the home router translates with NAT");
  assert.ok(http.stages.includes("Name resolved"));
  assert.equal(http.stages.at(-1), "Page delivered");
});

test("a phone that already holds a lease is described as still on Wi-Fi, not joining again", () => {
  const [dhcp, http] = runSteps("internet");
  assert.equal(dhcp.stages[0], "Join Wi-Fi · Your phone");
  assert.equal(http.stages[0], "Still on Wi-Fi · Your phone");
  const n = starter("internet");
  assert.match(narrate(http.trace.events, 0, n).summary, /still on the Wi-Fi network .* keeps 192\.168\.1\.100 from its DHCP lease/);
  // Once the lease has expired the phone has no address to keep, so the original wording applies.
  const expired = structuredClone(dhcp.trace.session);
  expired.time += 4_000_000;
  const t = simulate(n, expired, { kind: "http", source: "phone", target: "http://kitab.test/", ttl: 64 });
  assert.ok(!stagesOf(t.events, n).some((s) => s.title.startsWith("Still on Wi-Fi")));
  const join = t.events.findIndex((e) => e.title === "Associate with Wi-Fi");
  assert.match(narrate(t.events, join, n).summary, /no IP settings from it/);
});
