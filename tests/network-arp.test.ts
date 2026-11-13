// Milestone 2: a cached ARP entry decides the frame's destination MAC, and the frame goes where that MAC is.
// Nothing follows the IP address to whichever device uses it now.
import test from "node:test";
import assert from "node:assert/strict";
import { starter } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { explainStep } from "../src/practice/network/explanations.ts";
import { narrate } from "../src/practice/network/narration.ts";
import { exchangeOf } from "../src/practice/network/exchange.ts";
import { motionAt } from "../src/practice/network/motion.ts";
import { createDevice, type Network, type Session, type Trace } from "../src/practice/network/model.ts";

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const ping = (target: string, source = "pc") => ({ kind: "ping" as const, source, target });
const mac = (n: Network, id: string) => dev(n, id).interfaces[0].mac;
const titles = (t: Trace, title: string) => t.events.filter((e) => e.title === title);
const arpRequests = (t: Trace) => titles(t, "ARP: discover the next-hop MAC").length;
/** Destination MACs of every frame a device transmitted for IP packets. */
const ipFramesFrom = (t: Trace, device: string) =>
  t.events
    .filter((e) => e.hop?.from === device && e.packet?.startsWith("ip-"))
    .map((e) => e.layers.find((l) => l.kind === "link")!.fields["Destination MAC"]);

/** Your first LAN plus a spare server on switch port p3. */
function lanWithSpare() {
  const n = starter("lan");
  const spare = createDevice("server", "spare", 440, 430);
  spare.name = "Spare server";
  spare.interfaces[0].ip = "192.168.1.30";
  n.devices.push(spare);
  n.links.push({ id: "l9", a: { device: "switch", port: "p3" }, b: { device: "spare", port: "eth0" }, medium: "ethernet" });
  return n;
}
/** A first ping that fills the ARP caches and switch table, then the network changed with that session kept. */
function after(n: Network, change: (n: Network) => void, prepare?: (s: Session) => void) {
  const first = simulate(n, newSession(), ping("192.168.1.20"));
  const changed = structuredClone(n);
  change(changed);
  prepare?.(first.session);
  return { first, changed, oldMac: mac(n, "server"), t: simulate(changed, first.session, ping("192.168.1.20")) };
}
const moveAddress = (n: Network) => {
  dev(n, "server").interfaces[0].ip = "192.168.1.21";
  dev(n, "spare").interfaces[0].ip = "192.168.1.20";
};
const replaceCard = (n: Network) => void (dev(n, "server").interfaces[0].mac = "02:aa:bb:cc:dd:ee");

test("a correct cache entry is used without an ARP request and delivers to its owner", () => {
  const n = starter("lan");
  const first = simulate(n, newSession(), ping("192.168.1.20"));
  const t = simulate(n, first.session, ping("192.168.1.20"));
  assert.equal(t.success, true);
  assert.equal(arpRequests(t), 0);
  assert.ok(titles(t, "ARP cache hit").length >= 1);
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [mac(n, "server")]);
  assert.equal(titles(t, "Deliver IP payload")[0].actor, "server");
});

test("an address that moved: the frame goes to the cached MAC's device, which discards it", () => {
  const { t, changed, oldMac } = after(lanWithSpare(), moveAddress);
  assert.equal(t.success, false);
  assert.equal(t.reason, "ARP_STALE");
  assert.equal(arpRequests(t), 0, "no ARP request is invented");
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [oldMac]);
  assert.equal(titles(t, "Wrap in a link frame")[0].facts?.["Next-hop MAC"], oldMac);
  // The switch forwards by its MAC table toward the old owner; the device now using the IP never sees the packet.
  const pkt = titles(t, "Wrap in a link frame")[0].packet;
  assert.ok(t.events.some((e) => e.packet === pkt && e.title === "Forward using MAC table" && e.actor === "switch"));
  assert.ok(!t.events.some((e) => e.packet === pkt && (e.hop?.to === "spare" || e.actor === "spare")));
  assert.equal(t.events.at(-1)!.actor, "server");
  assert.match(t.summary, /Local server received a frame addressed to its MAC address/);
  assert.match(t.failure!.detail!, /Spare server uses 192\.168\.1\.20 now/);
  assert.match(t.failure!.detail!, new RegExp(`${oldMac} belongs to Local server`));
  void changed;
});

test("a replaced network card: no interface has the cached MAC, so the switch sends it to the learned port and it is lost", () => {
  const { t, oldMac } = after(starter("lan"), replaceCard);
  assert.equal(t.reason, "ARP_STALE");
  assert.equal(arpRequests(t), 0);
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [oldMac]);
  // The switch learned the old MAC on p2 and forwards only there; the server's new card discards the frame.
  const discards = titles(t, "Discard frame for another MAC").map((e) => e.actor);
  assert.deepEqual(discards, ["server"]);
  assert.ok(titles(t, "Forward using MAC table").some((e) => e.actor === "switch"));
  assert.equal(titles(t, "Deliver IP payload").length, 0);
  assert.match(t.summary, /No device on this LAN accepted the frame addressed to/);
  assert.match(t.failure!.detail!, /no device in this network has/);
});

test("an unknown destination MAC is flooded, and every receiver discards it", () => {
  const n = lanWithSpare();
  const { t, oldMac } = after(n, replaceCard, (s) => void (s.mac = {}));
  assert.equal(t.reason, "ARP_STALE");
  const pkt = titles(t, "Wrap in a link frame")[0].packet;
  assert.ok(t.events.some((e) => e.packet === pkt && e.title === "Unknown MAC: flood eligible ports"));
  assert.deepEqual(new Set(titles(t, "Discard frame for another MAC").map((e) => e.actor)), new Set(["server", "spare"]));
  assert.deepEqual([...new Set(ipFramesFrom(t, "switch"))], [oldMac], "flooding does not change the destination MAC");
});

test("clearing the ARP cache makes the next packet ask again and reach the device that uses the address now", () => {
  const n = lanWithSpare();
  const { t, changed } = after(n, moveAddress, (s) => void (s.arp = {}));
  assert.equal(t.success, true);
  assert.equal(titles(t, "ARP: discover the next-hop MAC")[0].actor, "pc");
  assert.equal(titles(t, "Deliver IP payload")[0].actor, "spare");
  assert.equal(t.session.arp["pc/eth0/192.168.1.20"], mac(changed, "spare"));
});

test("the stale entry stays in the device table, and the stop is drawn where the frame was discarded", () => {
  const { t, oldMac } = after(lanWithSpare(), moveAddress);
  const stop = t.events.at(-1)!;
  assert.equal(stop.snapshot.arp["pc/eth0/192.168.1.20"], oldMac);
  assert.deepEqual(motionAt(t.events, t.events.length - 1, lanWithSpare()).halt, { device: "server", kind: "stopped" });
});

test("the Exchange shows the echo request reaching the old owner, not delivered, and never the new owner", () => {
  const n = lanWithSpare();
  const { t, changed } = after(n, moveAddress);
  const x = exchangeOf(t.events, changed);
  const echo = x.messages.find((m) => m.label === "Echo request")!;
  assert.deepEqual(echo.reached.map((r) => r.device), ["server"]);
  assert.notEqual(echo.reached[0].how, "delivered");
  assert.equal(x.stop?.device, "server");
  assert.ok(!x.participants.includes("spare"));
});

test("explanations name the cached mapping and never claim an ARP request was sent", () => {
  for (const change of [moveAddress, replaceCard]) {
    const n = lanWithSpare();
    const { t, changed } = after(n, change);
    const last = t.events.length - 1;
    const ex = explainStep(t.events[last], changed);
    for (const text of [t.summary, ex.why, narrate(t.events, last, changed).summary])
      assert.doesNotMatch(text, /broadcast an ARP request|ARP received no reply/);
    assert.match(ex.why, /ARP cache/);
    const hit = t.events.findIndex((e) => e.title === "ARP cache hit" && e.actor === "pc");
    assert.match(narrate(t.events, hit, changed).summary, /sends no ARP request/);
  }
});

test("the frame narration names who has the MAC, and says when the entry is out of date", () => {
  const n = lanWithSpare();
  const { t, changed } = after(n, moveAddress);
  const wrap = t.events.findIndex((e) => e.title === "Wrap in a link frame" && e.actor === "pc");
  const summary = narrate(t.events, wrap, changed).summary;
  assert.match(summary, /the MAC address of Local server/);
  assert.match(summary, /Spare server uses 192\.168\.1\.20 now: the entry is out of date/);
  // A correct entry reads as before.
  const ok = simulate(starter("lan"), simulate(starter("lan"), newSession(), ping("192.168.1.20")).session, ping("192.168.1.20"));
  const w = ok.events.findIndex((e) => e.title === "Wrap in a link frame");
  assert.equal(narrate(ok.events, w, starter("lan")).summary, `Your PC puts the packet in a frame addressed to the MAC address of Local server, ${mac(starter("lan"), "server")}.`);
});

test("through a router: the router's stale entry for the server loses the frame on the far LAN", () => {
  const n = starter("routed");
  const first = simulate(n, newSession(), ping("192.168.2.20"));
  const changed = structuredClone(n);
  dev(changed, "server").interfaces[0].mac = "02:aa:bb:cc:dd:ee";
  const t = simulate(changed, first.session, ping("192.168.2.20"));
  assert.equal(t.reason, "ARP_STALE");
  assert.equal(arpRequests(t), 0);
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [mac(n, "router")], "the PC's entry for its gateway is still right");
  assert.deepEqual([...new Set(ipFramesFrom(t, "router"))], [mac(n, "server")]);
  assert.match(t.failure!.detail!, /^Router's ARP cache maps 192\.168\.2\.20/);
});

test("a router accepts a frame for its own MAC and forwards it, even after its gateway address changed", () => {
  const n = starter("routed");
  const first = simulate(n, newSession(), ping("192.168.2.20"));
  const changed = structuredClone(n);
  dev(changed, "router").interfaces[0].ip = "192.168.1.254";
  dev(changed, "server").interfaces[0].gateway = "192.168.2.1";
  // The PC still sends to its cached gateway MAC; a router routes whatever is addressed to its MAC.
  const t = simulate(changed, first.session, ping("192.168.2.20"));
  assert.equal(titles(t, "Deliver IP payload")[0]?.actor, "server");
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [mac(n, "router")]);
});

test("a stale entry on the reply path is reported as the reply's cause", () => {
  const n = starter("lan");
  const first = simulate(n, newSession(), ping("192.168.1.20"));
  const changed = structuredClone(n);
  dev(changed, "pc").interfaces[0].mac = "02:aa:bb:cc:dd:01";
  const t = simulate(changed, first.session, ping("192.168.1.20"));
  assert.equal(t.reason, "REPLY_NO_PATH");
  assert.equal(t.failure?.cause?.reason, "ARP_STALE");
});

test("without any edits: a lapsed DHCP lease leaves a cached entry that now leads to a device without that address", () => {
  const n = starter("internet");
  dev(n, "router").dhcp.leaseSeconds = 30;
  let s = simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" }).session;
  const ip = s.leases["phone/wlan0"].ip;
  while (s.leases["phone/wlan0"]) s = simulate(n, s, ping(ip)).session;
  const t = simulate(n, s, ping(ip));
  assert.equal(t.reason, "ARP_STALE");
  assert.equal(arpRequests(t), 0);
  assert.equal(t.events.at(-1)!.actor, "phone");
});

test("a correct entry with a broken path is a path problem, not a stale entry", () => {
  const n = starter("lan");
  const first = simulate(n, newSession(), ping("192.168.1.20"));
  const unplugged = structuredClone(n);
  unplugged.links = unplugged.links.filter((l) => l.b.device !== "server");
  const t = simulate(unplugged, first.session, ping("192.168.1.20"));
  assert.equal(t.reason, "ARP_NO_PATH");
  assert.equal(arpRequests(t), 0);
  assert.deepEqual([...new Set(ipFramesFrom(t, "pc"))], [mac(n, "server")], "the frame really is sent, to the right MAC");
  assert.match(t.failure!.detail!, /ARP cache is right/);
  assert.doesNotMatch(explainStep(t.events.at(-1)!, unplugged).why, /broadcast cannot reach it/);
  const off = structuredClone(n);
  dev(off, "server").interfaces[0].enabled = false;
  const t2 = simulate(off, first.session, ping("192.168.1.20"));
  assert.equal(t2.reason, "ARP_NO_PATH");
  assert.match(t2.failure!.detail!, /turned off/);
});

test("Break and compare finds the same failure reasons from a warm session as from a fresh one", async () => {
  const { experimentsFor } = await import("../src/practice/network/experiments.ts");
  const cases: [string, ReturnType<typeof ping> | { kind: "http"; source: string; target: string }][] = [
    ["lan", ping("192.168.1.20")],
    ["routed", ping("192.168.2.20")],
    // An IP address, not a name: a warm session also caches DNS, which rightly changes where an HTTP run fails.
    ["internet", ping("198.51.100.20")],
  ];
  for (const [id, action] of cases) {
    const n = starter(id);
    const warm = simulate(n, newSession(), action).session;
    const reasons = (s?: Session) => experimentsFor(n, action, s).experiments.map((x) => `${x.fault.label}: ${x.broken.reason}`);
    const fresh = reasons(), again = reasons(warm);
    assert.ok(fresh.length > 0, id);
    assert.deepEqual(again, fresh, id);
    assert.ok(!again.some((r) => r.endsWith("ARP_STALE")), id);
  }
});
