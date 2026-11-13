// Deterministic playground scenarios shared by the behaviour baseline and the explanation tests.
import { starter } from "../../src/practice/network/starters.ts";
import { newSession, simulate } from "../../src/practice/network/engine.ts";
import { createDevice, type Action, type Device, type Network, type Session, type Trace } from "../../src/practice/network/model.ts";

export type Scenario = { name: string; network: Network; trace: Trace };
const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const http = (source = "pc", target = "http://kitab.test/"): Action => ({ kind: "http", source, target });
const ping = (target: string, source = "pc", ttl?: number): Action => ({ kind: "ping", source, target, ttl });
const dhcp = (source = "phone"): Action => ({ kind: "dhcp", source, target: "" });

function one(name: string, id: string, action: Action, change?: (n: Network) => void, session: Session = newSession()): Scenario {
  const network = starter(id);
  change?.(network);
  return { name, network, trace: simulate(network, session, action) };
}
/** Runs actions in order on one network, carrying the session (e.g. DHCP, then HTTP). */
function chain(name: string, id: string, actions: Action[], change?: (n: Network) => void, between?: (s: Session, n: Network) => void): Scenario {
  const network = starter(id);
  change?.(network);
  let session = newSession(), trace!: Trace;
  for (const [i, action] of actions.entries()) {
    if (i) between?.(session, network);
    trace = simulate(network, session, action);
    session = trace.session;
  }
  return { name, network, trace };
}
const extraHost = (n: Network) => {
  const extra: Device = structuredClone(dev(n, "server"));
  Object.assign(extra, { id: "extra", name: "Other PC" });
  extra.interfaces[0].ip = "192.168.1.30";
  extra.interfaces[0].mac = "02:00:00:00:00:30";
  n.devices.push(extra);
  n.links.push({ id: "extra-link", a: { device: "switch", port: "p3" }, b: { device: "extra", port: "eth0" }, medium: "ethernet" });
};

/** Two routers on LAN B that each send 10.0.0.0/8 to the other. */
function twoRouterLoop(n: Network) {
  const sw = createDevice("switch", "lanb", 600, 240), r2 = createDevice("router", "r2", 600, 400);
  r2.name = "Router 2";
  Object.assign(r2.interfaces[0], { ip: "192.168.2.2", prefix: 24 });
  n.links = n.links.filter((l) => l.a.device !== "router" || l.a.port !== "wan");
  n.devices.push(sw, r2);
  n.links.push(
    { id: "b1", a: { device: "router", port: "wan" }, b: { device: "lanb", port: "p1" }, medium: "ethernet" },
    { id: "b2", a: { device: "lanb", port: "p2" }, b: { device: "server", port: "eth0" }, medium: "ethernet" },
    { id: "b3", a: { device: "lanb", port: "p3" }, b: { device: "r2", port: "lan" }, medium: "ethernet" },
  );
  dev(n, "router").routes.push({ network: "10.0.0.0", prefix: 8, via: "192.168.2.2", port: "wan" });
  r2.routes.push({ network: "10.0.0.0", prefix: 8, via: "192.168.2.1", port: "lan" });
}

export function scenarios(): Scenario[] {
  return [
    // Successful journeys
    one("internet: HTTP by name", "internet", http()),
    one("internet: HTTP by IP", "internet", http("pc", "http://198.51.100.20/")),
    one("internet: ping server", "internet", ping("198.51.100.20")),
    one("internet: HTTP with one loss", "internet", { ...http(), dropOnce: true }),
    chain("internet: phone DHCP then HTTP", "internet", [dhcp(), http("phone")]),
    chain("internet: HTTP twice (DNS cache)", "internet", [http(), http()]),
    one("lan: ping", "lan", ping("192.168.1.20")),
    one("lan: HTTP", "lan", http("pc", "http://192.168.1.20/")),
    chain("lan: unknown unicast flood", "lan", [ping("192.168.1.20"), ping("192.168.1.20")], extraHost, (s) => void (s.mac = {})),
    one("wifi: phone DHCP", "wifi", dhcp()),
    chain("wifi: DHCP renewal", "wifi", [dhcp(), dhcp()], (n) => void (dev(n, "router").dhcp.start = dev(n, "router").dhcp.end = "192.168.1.100")),
    chain("wifi: DHCP then ping by phone", "wifi", [dhcp(), ping("192.168.1.10", "phone")]),
    chain("wifi: DHCP then HTTP pc.home.arpa", "wifi", [dhcp(), http("phone", "http://pc.home.arpa/")], (n) => void (dev(n, "pc").web.enabled = true)),
    one("routed: ping", "routed", ping("192.168.2.20")),
    one("routed: HTTP", "routed", http("pc", "http://192.168.2.20/")),
    one("isp source: HTTP by name", "internet", http("isp"), (n) => {
      dev(n, "isp").interfaces[0].dns = "198.51.100.53";
      dev(n, "dns").interfaces[0].gateway = "";
    }),
    // Failures
    one("fail: lan cable missing", "lan", ping("192.168.1.20"), (n) => void n.links.pop()),
    one("fail: wrong gateway", "routed", ping("192.168.2.20"), (n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.99")),
    one("fail: no gateway", "routed", ping("192.168.2.20"), (n) => void (dev(n, "pc").interfaces[0].gateway = "")),
    one("fail: gateway outside subnet", "routed", ping("192.168.2.20"), (n) => void (dev(n, "pc").interfaces[0].gateway = "10.0.0.1")),
    one("fail: server has no return gateway", "routed", ping("192.168.2.20"), (n) => void (dev(n, "server").interfaces[0].gateway = "")),
    one("fail: TTL 1", "routed", ping("192.168.2.20", "pc", 1)),
    one("fail: mask mismatch", "lan", ping("192.168.1.130"), (n) => {
      dev(n, "pc").interfaces[0].prefix = 25;
      dev(n, "server").interfaces[0].ip = "192.168.1.130";
    }),
    one("fail: duplicate target IP", "lan", ping("192.168.1.10"), (n) => void (dev(n, "server").interfaces[0].ip = "192.168.1.10")),
    one("fail: duplicate next hop", "lan", ping("192.168.1.20"), (n) => {
      extraHost(n);
      dev(n, "extra").interfaces[0].ip = "192.168.1.20";
    }),
    one("fail: no source IP", "lan", ping("192.168.1.20"), (n) => void (dev(n, "pc").interfaces[0].ip = "")),
    one("fail: stale MAC table", "lan", ping("192.168.1.20"), undefined, (() => {
      const n = starter("lan"), first = simulate(n, newSession(), ping("192.168.1.20"));
      first.session.mac[`switch/${dev(n, "server").interfaces[0].mac}`] = "p6";
      return first.session;
    })()),
    one("fail: NAT off", "internet", http(), (n) => void (dev(n, "router").nat = false)),
    one("fail: NAT off ping", "internet", ping("198.51.100.20"), (n) => void (dev(n, "router").nat = false)),
    one("fail: no HTTP service", "lan", http("pc", "http://192.168.1.20/"), (n) => void (dev(n, "server").web.enabled = false)),
    one("fail: wifi wrong password", "wifi", dhcp(), (n) => void (dev(n, "phone").password = "wrong")),
    one("fail: wifi wrong SSID", "wifi", dhcp(), (n) => void (dev(n, "phone").ssid = "Neighbour")),
    one("fail: wifi not joined", "wifi", dhcp(), (n) => void (n.links = n.links.filter((l) => l.medium !== "wifi"))),
    one("fail: DHCP on static client", "wifi", dhcp(), (n) => void (dev(n, "phone").interfaces[0].mode = "static")),
    one("fail: no DHCP server", "wifi", dhcp(), (n) => void (dev(n, "router").dhcp.enabled = false)),
    one("fail: DHCP pool exhausted", "wifi", dhcp(), (n) => void (dev(n, "router").dhcp.start = dev(n, "router").dhcp.end = "192.168.1.10")),
    one("fail: DHCP pool invalid", "wifi", dhcp(), (n) => void (dev(n, "router").dhcp.end = "192.168.1.1")),
    chain("fail: lease expired before ping", "wifi", [dhcp(), ping("192.168.1.10", "phone")], undefined, (s) => void (s.time += 4000000)),
    chain("fail: lease expires mid-transfer", "internet", [dhcp(), http("phone")], (n) => {
      dev(n, "router").dhcp.leaseSeconds = 30;
      dev(n, "server").web.body = "x".repeat(4096);
    }),
    one("fail: DNS address unused", "internet", http(), (n) => void (dev(n, "pc").interfaces[0].dns = "198.51.100.99")),
    one("fail: DNS no service", "internet", http(), (n) => void (dev(n, "pc").interfaces[0].dns = "198.51.100.20")),
    one("fail: DNS no record", "internet", http("pc", "http://nope.test/")),
    one("fail: DNS unreachable", "internet", http(), (n) => void (n.links = n.links.filter((l) => !(l.b.device === "dns")))),
    one("fail: DNS reply unreachable", "internet", http(), (n) => void (dev(n, "dns").interfaces[0].gateway = "")),
    one("fail: no DNS configured", "internet", http(), (n) => void (dev(n, "pc").interfaces[0].dns = "")),
    one("fail: invalid URL", "internet", http("pc", "http://exa mple/")),
    one("fail: non-80 port", "internet", http("pc", "https://kitab.test/")),
    one("fail: switch as source", "lan", ping("192.168.1.20", "switch")),
    one("fail: routing loop", "routed", ping("10.9.9.9"), twoRouterLoop),
    one("fail: unsolicited inbound through NAT", "internet", http("isp", "http://203.0.113.2/")),
    one("fail: router has no route", "routed", ping("10.9.9.9")),
    one("fail: endpoint asked to forward", "routed", ping("10.9.9.9"), (n) => {
      dev(n, "router").routes.push({ network: "10.0.0.0", prefix: 8, via: "192.168.2.20", port: "wan" });
    }),
    // A matching route whose next hop is on no network the router is connected to.
    one("fail: static route next hop unusable", "routed", ping("10.0.3.20"), (n) => {
      dev(n, "router").routes.push({ network: "10.0.3.0", prefix: 24, via: "172.16.0.1", port: "wan" });
    }),
  ];
}
