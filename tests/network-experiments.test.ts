// Break and compare: each experiment changes exactly one setting, both runs come from the real engine with the
// same starting state and action, the fault is offered only when the engine shows it changes the outcome, and the
// first difference shown is the earliest point where a device's recorded decisions differ.
import test from "node:test";
import assert from "node:assert/strict";
import { divergence, experimentsFor, type Experiment } from "../src/practice/network/experiments.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { starter } from "../src/practice/network/starters.ts";
import type { Action, Network, Session, Trace, TraceEvent } from "../src/practice/network/model.ts";

/** Every setting as a path, so two networks can be compared setting by setting. */
function settings(n: Network) {
  const out: Record<string, string> = {};
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    else out[path] = JSON.stringify(v);
  };
  for (const d of n.devices) walk(d, d.id);
  for (const l of n.links) out[`link ${l.id}`] = JSON.stringify(l);
  return out;
}
const changed = (a: Network, b: Network) => {
  const [x, y] = [settings(a), settings(b)];
  // A route (its network, prefix, next hop and port) and a DHCP pool (its first and last address) are one setting each.
  const setting = (k: string) => k.replace(/\.routes\.(\d+)\..*$/, ".routes.$1").replace(/\.dhcp\.(start|end)$/, ".dhcp.pool");
  return [...new Set([...Object.keys(x), ...Object.keys(y)].filter((k) => x[k] !== y[k]).map(setting))];
};
const decision = (e: TraceEvent) => JSON.stringify([e.title, e.reason ?? "", e.facts ?? {}, e.hop ? [e.hop.from, e.hop.to] : [], e.layers.map((l) => [l.name, l.fields])]);

type Case = { name: string; network: Network; action: Action; session: Session };
const http = (source: string, target: string): Action => ({ kind: "http", source, target });
const ping = (source: string, target: string): Action => ({ kind: "ping", source, target });
function afterDhcp(id: string) {
  const network = starter(id);
  return simulate(network, newSession(), { kind: "dhcp", source: "phone", target: "" }).session;
}
const longBody = () => {
  const n = starter("internet");
  n.devices.find((d) => d.id === "server")!.web.body = "x".repeat(4096);
  return n;
};
const cases: Case[] = [
  { name: "internet: HTTP by name", network: starter("internet"), action: http("pc", "http://kitab.test/"), session: newSession() },
  { name: "internet: HTTP by IP", network: starter("internet"), action: http("pc", "http://198.51.100.20/"), session: newSession() },
  { name: "internet: ping", network: starter("internet"), action: ping("pc", "198.51.100.20"), session: newSession() },
  { name: "internet: long HTTP response", network: longBody(), action: http("pc", "http://kitab.test/"), session: newSession() },
  { name: "lan: ping", network: starter("lan"), action: ping("pc", "192.168.1.20"), session: newSession() },
  { name: "lan: HTTP", network: starter("lan"), action: http("pc", "http://192.168.1.20/"), session: newSession() },
  { name: "wifi: DHCP", network: starter("wifi"), action: { kind: "dhcp", source: "phone", target: "" }, session: newSession() },
  { name: "wifi: ping from the phone after DHCP", network: starter("wifi"), action: ping("phone", "192.168.1.10"), session: afterDhcp("wifi") },
  { name: "routed: ping", network: starter("routed"), action: ping("pc", "192.168.2.20"), session: newSession() },
  { name: "routed: HTTP", network: starter("routed"), action: http("pc", "http://192.168.2.20/"), session: newSession() },
];
const all = cases.map((c) => {
  const before = structuredClone(c.network);
  const t0 = performance.now();
  const found = experimentsFor(c.network, c.action, c.session);
  return { ...c, before, found, ms: performance.now() - t0 };
});
const kinds = (name: string) => all.find((c) => c.name === name)!.found.experiments.map((x) => x.fault.kind);
const one = (name: string, kind: string) => all.find((c) => c.name === name)!.found.experiments.find((x) => x.fault.kind === kind)!;

test("each experiment changes exactly one setting, runs the same action with the real engine, and changes the outcome", () => {
  let count = 0;
  for (const { name, network, action, session, before, found } of all) {
    // The learner's network is never touched.
    assert.deepEqual(network, before, `${name}: original changed`);
    assert.deepEqual(found.working, simulate(network, session, action), `${name}: working run`);
    for (const x of found.experiments) {
      count += 1;
      const where = `${name}: ${x.fault.label}`;
      const diff = changed(network, x.network);
      assert.equal(diff.length, 1, `${where}: ${diff.join(", ")}`);
      // The same fault applied again gives the same copy, and the broken run is the engine's run of that copy.
      const again = structuredClone(network);
      x.fault.apply(again);
      assert.deepEqual(again, x.network, where);
      assert.deepEqual(x.working, found.working, where);
      assert.deepEqual(x.broken, simulate(x.network, session, action), where);
      assert.ok(x.working.success && (!x.broken.success || x.broken.reason !== x.working.reason), `${where}: outcome unchanged`);
    }
    // At most one experiment per kind of fault.
    assert.equal(new Set(found.experiments.map((x) => x.fault.kind)).size, found.experiments.length, name);
  }
  assert.ok(count >= 20, `only ${count} experiments`);
});

test("the first difference is where a device's recorded decisions first differ, and nowhere earlier", () => {
  for (const { name, found } of all)
    for (const x of found.experiments) {
      const where = `${name}: ${x.fault.label}`;
      const d = x.divergence!;
      assert.ok(d, where);
      const w = x.working.events,
        b = x.broken.events;
      const mine = (t: TraceEvent[], device: string) => t.flatMap((e, i) => (e.actor === device ? [i] : []));
      const ws = mine(w, d.device),
        bs = mine(b, d.device);
      const k = d.working !== undefined ? ws.indexOf(d.working) : bs.indexOf(d.broken!);
      assert.ok(k >= 0, where);
      if (d.working !== undefined) assert.equal(w[d.working].actor, d.device, where);
      if (d.broken !== undefined) assert.equal(b[d.broken].actor, d.device, where);
      // The device made the same decisions in both runs up to this point, and this one differs.
      for (let j = 0; j < k; j++) assert.equal(decision(w[ws[j]]), decision(b[bs[j]]), `${where}: earlier step ${j}`);
      assert.notEqual(d.working === undefined ? "" : decision(w[d.working]), d.broken === undefined ? "" : decision(b[d.broken]), where);
      // No other device's decisions differ any earlier.
      const rank = Math.min(d.working ?? Infinity, d.broken ?? Infinity);
      for (const device of new Set([...w, ...b].map((e) => e.actor))) {
        const a = mine(w, device).filter((i) => i < rank),
          c = mine(b, device).filter((i) => i < rank);
        assert.deepEqual(a.map((i) => decision(w[i])), c.map((i) => decision(b[i])), `${where}: ${device} differs earlier`);
      }
      // Every difference shown is read from the two events.
      for (const diff of d.differences) {
        const we = d.working === undefined ? undefined : w[d.working],
          be = d.broken === undefined ? undefined : b[d.broken];
        if (diff.what === "Step") {
          assert.equal(diff.working, we?.title ?? "nothing further", where);
          assert.equal(diff.broken, be?.title ?? "nothing further", where);
        } else if (diff.what === "Reason") assert.equal(diff.broken, be?.reason, where);
        else if (diff.what === "Sent to") assert.deepEqual([diff.working, diff.broken], [we?.hop?.to ?? "nowhere", be?.hop?.to ?? "nowhere"], where);
        else if (we?.facts && diff.what in we.facts) assert.deepEqual([diff.working, diff.broken], [String(we.facts[diff.what]), String(be?.facts?.[diff.what] ?? "none")], where);
        else assert.match(diff.what, /\(.+\)$/, `${where}: ${diff.what}`);
      }
    }
});

test("a different interleaving of devices is not a difference", () => {
  const t = simulate(starter("internet"), newSession(), http("pc", "http://kitab.test/"));
  const swap = t.events.findIndex((e, i) => i > 0 && e.actor !== t.events[i - 1].actor);
  const reordered: Trace = { ...t, events: [...t.events] };
  [reordered.events[swap - 1], reordered.events[swap]] = [reordered.events[swap], reordered.events[swap - 1]];
  assert.equal(divergence(t, reordered), null);
  assert.equal(divergence(t, t), null);
});

test("only meaningful experiments are offered for each network and action", () => {
  assert.deepEqual(kinds("internet: HTTP by name"), ["mask", "no-gateway", "wrong-gateway", "cable", "route", "nat"]);
  // A LAN has no gateway, router route or NAT to break, and the DHCP pool only matters to a DHCP request.
  for (const name of ["lan: ping", "lan: HTTP"]) assert.deepEqual(kinds(name), ["mask", "cable"], name);
  assert.deepEqual(kinds("wifi: DHCP"), ["cable", "dhcp-pool"]);
  assert.ok(!kinds("routed: ping").includes("nat") && !kinds("routed: ping").includes("dhcp-pool"));
  // A mask that still covers the gateway changes nothing for this request, so a narrower one is offered.
  const n = starter("internet");
  const narrow = structuredClone(n);
  narrow.devices.find((d) => d.id === "pc")!.interfaces[0].prefix = 28;
  const req = http("pc", "http://kitab.test/");
  assert.equal(simulate(narrow, newSession(), req).success, true);
  assert.equal(one("internet: HTTP by name", "mask").fault.after, "/30 (255.255.255.252)");
  // A request that already fails is not a starting point.
  const broken = starter("internet");
  broken.devices.find((d) => d.id === "pc")!.interfaces[0].gateway = "";
  const none = experimentsFor(broken, req);
  assert.equal(none.working.success, false);
  assert.deepEqual(none.experiments, []);
});

test("what learners see: the changed setting, the first difference and the engine's reason", () => {
  const nat = one("internet: HTTP by name", "nat");
  assert.equal(nat.fault.label, "Turn off NAT on Home router");
  assert.equal(nat.divergence!.device, "router");
  assert.deepEqual(nat.divergence!.differences, [{ what: "Step", working: "Translate source with NAT", broken: "ARP: discover the next-hop MAC" }]);
  assert.match(nat.broken.failure!.message, /could not get back to Your PC/);
  const gw = one("routed: ping", "wrong-gateway");
  assert.deepEqual(gw.divergence!.differences, [{ what: "Next hop", working: "192.168.1.1", broken: "192.168.1.99" }]);
  assert.equal(gw.broken.reason, "ARP_NO_OWNER");
  const pool = one("wifi: DHCP", "dhcp-pool");
  assert.equal(pool.fault.label, "Shrink Home router's DHCP pool to 192.168.1.10, which Your PC already uses");
  assert.deepEqual(pool.divergence!.differences, [
    { what: "Step", working: "DHCP Offer", broken: "Delivery stopped" },
    { what: "Reason", working: "none", broken: "DHCP_POOL_EMPTY" },
  ]);
  const route = one("internet: HTTP by name", "route");
  assert.equal(route.fault.before, "0.0.0.0/0 via 203.0.113.1");
  assert.equal(route.divergence!.device, "router");
  const cable = one("lan: ping", "cable");
  assert.equal(cable.fault.label, "Unplug the cable between Your PC and Switch");
  assert.deepEqual(cable.divergence!.differences.find((d) => d.what === "Sent to"), undefined);
  assert.equal(cable.broken.reason, "ARP_NO_PATH");
});

test("long TCP and HTTP runs stay quick", () => {
  const long = all.find((c) => c.name === "internet: long HTTP response")!;
  assert.ok(long.found.working.events.length > 1000, `${long.found.working.events.length} events`);
  assert.ok(long.ms < 3000, `${long.ms} ms`);
  const t0 = performance.now();
  for (const x of long.found.experiments) divergence(x.working, x.broken);
  const ms = performance.now() - t0;
  assert.ok(ms < 200, `${ms} ms`);
  console.log(`# long run: ${long.found.working.events.length} events, ${long.found.experiments.length} experiments found in ${long.ms.toFixed(0)} ms, divergences in ${ms.toFixed(1)} ms`);
});
