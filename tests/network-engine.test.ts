import test from "node:test";
import assert from "node:assert/strict";
import { starter } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";

test("local ping learns ARP/MAC without a TCP segment", () => {
  const n = starter("lan"),
    t = simulate(n, newSession(), {
      kind: "ping",
      source: "pc",
      target: "192.168.1.20",
    });
  assert.equal(t.success, true, t.summary);
  assert.ok(t.events.some((e) => e.title.includes("ARP")));
  assert.ok(Object.keys(t.session.mac).length);
  assert.ok(
    !t.events.some((e) => e.layers.some((l) => l.name === "TCP segment")),
  );
});
test("routed ping takes independently computed forward and return routes", () => {
  const n = starter("routed");
  assert.equal(
    simulate(n, newSession(), {
      kind: "ping",
      source: "pc",
      target: "192.168.2.20",
    }).success,
    true,
  );
  n.devices.find((d) => d.id === "server")!.interfaces[0].gateway = "";
  const t = simulate(n, newSession(), {
    kind: "ping",
    source: "pc",
    target: "192.168.2.20",
  });
  assert.equal(t.success, false);
  assert.match(t.summary, /route|gateway/i);
});
test("DHCP lease survives a subsequent HTTP action using DNS and NAT", () => {
  const n = starter("internet");
  const d = simulate(n, newSession(), {
    kind: "dhcp",
    source: "phone",
    target: "",
  });
  assert.equal(d.success, true, d.summary);
  assert.ok(d.session.leases["phone/wlan0"]);
  const t = simulate(n, d.session, {
    kind: "http",
    source: "phone",
    target: "http://kitab.test/",
  });
  assert.equal(t.success, true, t.summary);
  assert.ok(t.session.nat.length);
  assert.ok(t.events.some((e) => e.title.includes("DNS")));
  assert.ok(t.events.some((e) => e.title.includes("Restore")));
  assert.ok(
    t.events.some((e) => e.layers.some((l) => l.name === "Wi-Fi frame")),
  );
  assert.ok(
    t.events.some((e) => e.layers.some((l) => l.name === "TCP segment")),
  );
  assert.ok(t.events.at(-1)?.title.includes("complete"));
});
test("wrong gateway, disconnected cable and TTL stop traffic visibly", () => {
  const n = starter("routed");
  n.devices[0].interfaces[0].gateway = "192.168.1.99";
  const t = simulate(n, newSession(), {
    kind: "ping",
    source: "pc",
    target: "192.168.2.20",
  });
  assert.equal(t.success, false);
  assert.match(t.summary, /ARP/i);
  const m = starter("routed");
  assert.equal(
    simulate(m, newSession(), {
      kind: "ping",
      source: "pc",
      target: "192.168.2.20",
      ttl: 1,
    }).success,
    false,
  );
  const l = starter("lan");
  const first = simulate(l, newSession(), {
    kind: "ping",
    source: "pc",
    target: "192.168.1.20",
  });
  l.links = [];
  assert.equal(
    simulate(l, first.session, {
      kind: "ping",
      source: "pc",
      target: "192.168.1.20",
    }).success,
    false,
  );
});
test("one lost TCP data segment is retried without duplicate application data", () => {
  const n = starter("lan");
  const t = simulate(n, newSession(), {
    kind: "http",
    source: "pc",
    target: "http://192.168.1.20/",
    dropOnce: true,
  });
  assert.equal(t.success, true, t.summary);
  assert.equal(
    t.events.filter((e) => e.title === "Retransmit TCP segment").length,
    1,
  );
  assert.equal(
    t.events.filter((e) => e.title === "Server reads HTTP request").length,
    1,
  );
});
test("HTTP byte counts use UTF-8 and replay snapshots are independent", () => {
  const n = starter("lan");
  n.devices.find((d) => d.id === "server")!.web.body = "Bonjour 🌍";
  const t = simulate(n, newSession(), {
    kind: "http",
    source: "pc",
    target: "http://192.168.1.20/",
  });
  assert.equal(t.success, true);
  assert.ok(
    t.events.some((e) =>
      e.layers.some((l) => l.payload?.includes("Content-Length: 12")),
    ),
  );
  const first = JSON.stringify(t.events[0].snapshot);
  t.session.arp.changed = "x";
  assert.equal(JSON.stringify(t.events[0].snapshot), first);
});
test("wrong Wi-Fi credentials and expired lease are explained", () => {
  const n = starter("wifi");
  n.devices.find((d) => d.id === "phone")!.password = "wrong";
  assert.equal(
    simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" })
      .success,
    false,
  );
  n.devices.find((d) => d.id === "phone")!.password = "learn123";
  const d = simulate(n, newSession(), {
    kind: "dhcp",
    source: "phone",
    target: "",
  });
  d.session.time += 4000000;
  const t = simulate(n, d.session, {
    kind: "ping",
    source: "phone",
    target: "192.168.1.10",
  });
  assert.equal(t.success, false);
  assert.match(t.summary, /DHCP|lease/i);
});
test("an inaccessible target is not accepted merely because an address exists elsewhere", () => {
  const n = starter("lan");
  n.links.pop();
  const t = simulate(n, newSession(), {
    kind: "ping",
    source: "pc",
    target: "192.168.1.20",
  });
  assert.equal(t.success, false);
  assert.match(t.summary, /ARP/);
});
test("DHCP exhaustion and duplicate addresses fail explicitly", () => {
  const n = starter("wifi");
  const r = n.devices.find((d) => d.id === "router")!;
  r.dhcp.start = "192.168.1.10";
  r.dhcp.end = "192.168.1.10";
  assert.match(
    simulate(n, newSession(), { kind: "dhcp", source: "phone", target: "" })
      .summary,
    /pool/,
  );
  const m = starter("lan");
  m.devices.find((d) => d.id === "server")!.interfaces[0].ip = "192.168.1.10";
  assert.match(
    simulate(m, newSession(), {
      kind: "ping",
      source: "pc",
      target: "192.168.1.10",
    }).summary,
    /Duplicate IP/,
  );
});

test("requesting DHCP again renews the current lease in a one-address pool", () => {
  const n = starter("wifi");
  const r = n.devices.find((d) => d.id === "router")!;
  r.dhcp.start = r.dhcp.end = "192.168.1.100";
  const a = { kind: "dhcp" as const, source: "phone", target: "" };
  const first = simulate(n, newSession(), a),
    second = simulate(n, first.session, a);
  assert.equal(second.success, true, second.summary);
  assert.equal(second.session.leases["phone/wlan0"].ip, "192.168.1.100");
  assert.ok(
    second.session.leases["phone/wlan0"].expires >
      first.session.leases["phone/wlan0"].expires,
  );
});
test("DNS binds its source IP to the interface chosen by routing", () => {
  const n = starter("internet");
  const isp = n.devices.find((d) => d.id === "isp")!;
  isp.interfaces[0].dns = "198.51.100.53";
  n.devices.find((d) => d.id === "dns")!.interfaces[0].gateway = "";
  const t = simulate(n, newSession(), {
    kind: "http",
    source: "isp",
    target: "http://kitab.test/",
  });
  assert.equal(t.success, true, t.summary);
});
test("unknown unicast floods other switch ports and unrelated hosts discard it", () => {
  const n = starter("lan");
  const extra = structuredClone(n.devices.find((d) => d.id === "server")!);
  extra.id = "extra";
  extra.name = "Other PC";
  extra.interfaces[0].ip = "192.168.1.30";
  extra.interfaces[0].mac = "02:00:00:00:00:30";
  n.devices.push(extra);
  n.links.push({
    id: "extra-link",
    a: { device: "switch", port: "p3" },
    b: { device: "extra", port: "eth0" },
    medium: "ethernet",
  });
  const a = { kind: "ping" as const, source: "pc", target: "192.168.1.20" };
  const first = simulate(n, newSession(), a);
  first.session.mac = {};
  const t = simulate(n, first.session, a);
  assert.equal(t.success, true, t.summary);
  assert.ok(t.events.some((e) => e.hop?.to === "extra"));
  assert.ok(
    t.events.some(
      (e) => e.actor === "extra" && e.title === "Discard frame for another MAC",
    ),
  );
});
test("a learned MAC port actually controls forwarding", () => {
  const n = starter("lan");
  const a = { kind: "ping" as const, source: "pc", target: "192.168.1.20" };
  const first = simulate(n, newSession(), a);
  first.session.mac[
    `switch/${n.devices.find((d) => d.id === "server")!.interfaces[0].mac}`
  ] = "p6";
  const t = simulate(n, first.session, a);
  assert.equal(t.success, false);
  assert.match(t.summary, /MAC/);
});
test("a DHCP lease expiring during a long transfer stops using that address", () => {
  const n = starter("internet");
  n.devices.find((d) => d.id === "router")!.dhcp.leaseSeconds = 30;
  n.devices.find((d) => d.id === "server")!.web.body = "x".repeat(4096);
  const lease = simulate(n, newSession(), {
    kind: "dhcp",
    source: "phone",
    target: "",
  });
  const t = simulate(n, lease.session, {
    kind: "http",
    source: "phone",
    target: "http://kitab.test/",
  });
  assert.equal(t.success, false);
  assert.ok(t.events.some((e) => e.title === "DHCP lease expired"));
  assert.equal(t.session.leases["phone/wlan0"], undefined);
});
