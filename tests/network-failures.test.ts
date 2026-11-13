import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { starter } from "../src/practice/network/starters.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { explainStep, failures } from "../src/practice/network/explanations.ts";
import { createDevice, type FailureReason, type Network, type Trace } from "../src/practice/network/model.ts";

const all = scenarios();
const run = (name: string) => all.find((s) => s.name === name)!;
const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const chain = (t: Trace) => {
  const out: [FailureReason, string][] = [];
  for (let f = t.failure; f; f = f.cause) out.push([f.reason, f.device]);
  return out;
};

// Networks that are not in the shared baseline (one is 10,000 events long).
function extra(): { name: string; network: Network; trace: Trace }[] {
  const invalid = starter("lan");
  dev(invalid, "pc").interfaces[0].ip = "192.168.1.0"; // the network address, not a host
  // A 4 KB page across a chain of 30 switches needs more than 10,000 events.
  const huge = starter("lan");
  dev(huge, "server").web.body = "x".repeat(4096);
  huge.links = huge.links.filter((l) => l.b.device !== "server");
  let tail = "switch";
  for (let i = 0; i < 30; i++) {
    const sw = createDevice("switch", `s${i}`);
    huge.devices.push(sw);
    huge.links.push({ id: `c${i}`, a: { device: tail, port: tail === "switch" ? "p3" : "p2" }, b: { device: sw.id, port: "p1" }, medium: "ethernet" });
    tail = sw.id;
  }
  huge.links.push({ id: "end", a: { device: tail, port: "p2" }, b: { device: "server", port: "eth0" }, medium: "ethernet" });
  // The server thinks the PC's address is on its own LAN (/16), where another host uses it.
  const twin = starter("routed");
  const sw = createDevice("switch", "lanb"), other = createDevice("pc", "twin");
  other.name = "Twin PC";
  Object.assign(other.interfaces[0], { ip: "192.168.1.10", prefix: 16 });
  Object.assign(dev(twin, "server").interfaces[0], { prefix: 16 });
  twin.links = twin.links.filter((l) => l.a.device !== "router" || l.a.port !== "wan");
  twin.devices.push(sw, other);
  twin.links.push(
    { id: "t1", a: { device: "router", port: "wan" }, b: { device: "lanb", port: "p1" }, medium: "ethernet" },
    { id: "t2", a: { device: "lanb", port: "p2" }, b: { device: "server", port: "eth0" }, medium: "ethernet" },
    { id: "t3", a: { device: "lanb", port: "p3" }, b: { device: "twin", port: "eth0" }, medium: "ethernet" },
  );
  const ping = { kind: "ping" as const, source: "pc", target: "192.168.2.20" };
  return [
    { name: "invalid network", network: invalid, trace: simulate(invalid, newSession(), ping) },
    { name: "event limit", network: huge, trace: simulate(huge, newSession(), { kind: "http", source: "pc", target: "http://192.168.1.20/" }) },
    { name: "reply to a twin", network: twin, trace: simulate(twin, newSession(), ping) },
  ];
}

const expected: Record<string, FailureReason> = {
  "fail: lan cable missing": "ARP_NO_PATH",
  "fail: wrong gateway": "ARP_NO_OWNER",
  "fail: no gateway": "NO_GATEWAY",
  "fail: gateway outside subnet": "GATEWAY_NOT_LOCAL",
  "fail: server has no return gateway": "REPLY_NO_PATH",
  "fail: TTL 1": "TTL_EXPIRED",
  "fail: mask mismatch": "NO_GATEWAY",
  "fail: duplicate target IP": "DUPLICATE_IP",
  "fail: duplicate next hop": "DUPLICATE_IP",
  "fail: no source IP": "NO_ADDRESS",
  "fail: stale MAC table": "SWITCH_STALE_MAC",
  "fail: NAT off": "DNS_REPLY_UNREACHABLE",
  "fail: NAT off ping": "REPLY_NO_PATH",
  "fail: no HTTP service": "HTTP_NO_LISTENER",
  "fail: wifi wrong password": "WIFI_WRONG_PASSPHRASE",
  "fail: wifi wrong SSID": "WIFI_SSID_NOT_FOUND",
  "fail: wifi not joined": "WIFI_NOT_JOINED",
  "fail: DHCP on static client": "DHCP_CLIENT_STATIC",
  "fail: no DHCP server": "DHCP_NO_SERVER",
  "fail: DHCP pool exhausted": "DHCP_POOL_EMPTY",
  "fail: DHCP pool invalid": "DHCP_POOL_INVALID",
  "fail: lease expired before ping": "NO_ADDRESS",
  "fail: lease expires mid-transfer": "DHCP_LEASE_EXPIRED",
  "fail: DNS address unused": "DNS_SERVER_ADDRESS",
  "fail: DNS no service": "DNS_NO_SERVICE",
  "fail: DNS no record": "DNS_NO_RECORD",
  "fail: DNS unreachable": "DNS_UNREACHABLE",
  "fail: DNS reply unreachable": "DNS_REPLY_UNREACHABLE",
  "fail: no DNS configured": "DNS_NOT_CONFIGURED",
  "fail: invalid URL": "INPUT_URL",
  "fail: non-80 port": "INPUT_PORT",
  "fail: switch as source": "INPUT_SOURCE",
  "fail: routing loop": "ROUTING_LOOP",
  "fail: unsolicited inbound through NAT": "NAT_NO_MAPPING",
  "fail: router has no route": "ROUTER_NO_ROUTE",
  "fail: static route next hop unusable": "ROUTE_UNUSABLE",
  "fail: stale ARP entry, address moved": "ARP_STALE",
  "fail: stale ARP entry, card replaced": "ARP_STALE",
  "fail: endpoint asked to forward": "NOT_A_ROUTER",
  "invalid network": "INVALID_NETWORK",
  "event limit": "SIMULATION_LIMIT",
  "reply to a twin": "REPLY_MISDELIVERED",
};

test("every failure scenario stops with its own deterministic reason", () => {
  const runs = [...all, ...extra()];
  for (const s of runs.filter((s) => !s.trace.success)) {
    assert.equal(s.trace.reason, expected[s.name], s.name);
    const last = s.trace.events.at(-1)!;
    assert.equal(last.reason, s.trace.reason, `${s.name}: the stop event carries the reason`);
    assert.deepEqual(last.failure, s.trace.failure, s.name);
  }
  // Every reason the model defines is reachable from a real network.
  const seen = new Set(runs.flatMap((s) => chain(s.trace).map(([reason]) => reason)));
  for (const reason of Object.keys(failures)) assert.ok(seen.has(reason as FailureReason), `${reason} is never produced`);
});

test("every reason is explained with a cause, a rule and where to look", () => {
  for (const [reason, info] of Object.entries(failures)) {
    for (const field of ["title", "why", "rule", "check"] as const) assert.ok(info[field].length > 10, `${reason}.${field}`);
    if (!reason.startsWith("INPUT_") && !["INVALID_NETWORK", "SIMULATION_LIMIT", "DHCP_POOL_INVALID", "REPLY_MISDELIVERED"].includes(reason))
      assert.match(info.source ?? "", /^(RFC \d+|IEEE 802)/, `${reason} cites the standard it rests on`);
  }
  for (const s of all.filter((s) => !s.trace.success)) {
    const e = explainStep(s.trace.events.at(-1)!, s.network);
    assert.doesNotMatch(e.why, /A required condition for delivery is missing/, s.name);
    assert.equal(e.failure?.title, failures[s.trace.reason!].title, s.name);
    assert.ok(!e.outcome.includes(s.trace.summary), `${s.name}: the step does not repeat the message shown above it`);
  }
});

test("the stop is shown at the device that detected it, not the last one that forwarded a frame", () => {
  const at = (name: string) => run(name).trace.events.at(-1)!.actor;
  assert.equal(at("fail: lan cable missing"), "pc", "the PC's ARP got no answer; the switch did nothing wrong");
  assert.equal(at("fail: wrong gateway"), "pc");
  assert.equal(at("fail: lease expires mid-transfer"), "phone");
  assert.equal(at("fail: server has no return gateway"), "server");
  assert.equal(at("fail: routing loop"), "r2");
  assert.equal(at("fail: DNS unreachable"), "isp", "the ISP router could not find the DNS server");
});

test("a failure keeps the specific failure that caused it", () => {
  assert.deepEqual(chain(run("fail: NAT off").trace), [["DNS_REPLY_UNREACHABLE", "isp"], ["NO_ROUTE_PRIVATE", "isp"]]);
  assert.deepEqual(chain(run("fail: NAT off ping").trace), [["REPLY_NO_PATH", "isp"], ["NO_ROUTE_PRIVATE", "isp"]]);
  assert.deepEqual(chain(run("fail: DNS unreachable").trace), [["DNS_UNREACHABLE", "isp"], ["ARP_NO_PATH", "isp"]]);
  assert.deepEqual(chain(run("fail: DNS address unused").trace), [["DNS_SERVER_ADDRESS", "isp"], ["ARP_NO_OWNER", "isp"]]);
  assert.deepEqual(chain(run("fail: server has no return gateway").trace), [["REPLY_NO_PATH", "server"], ["NO_GATEWAY", "server"]]);
  const e = explainStep(run("fail: NAT off").trace.events.at(-1)!, run("fail: NAT off").network);
  assert.deepEqual(e.failure!.chain.map((c) => c.title), ["The DNS answer could not come back", "No route to a private address"]);
});

test("failure messages name the actual values that matter", () => {
  // What was observed, followed by the simulator's diagnosis that the playground shows.
  const said = (name: string) => {
    const t = run(name).trace;
    return `${t.summary} ${t.failure?.detail ?? ""}`;
  };
  assert.match(said("fail: mask mismatch"), /outside its subnet 192\.168\.1\.0\/25 \(192\.168\.1\.1–192\.168\.1\.126\)/);
  assert.match(said("fail: gateway outside subnet"), /default gateway 10\.0\.0\.1 is outside/);
  assert.match(said("fail: wrong gateway"), /No device in this network uses 192\.168\.1\.99/);
  assert.match(run("fail: wrong gateway").trace.failure!.advice!, /default gateway/);
  assert.match(said("fail: lan cable missing"), /Local server uses 192\.168\.1\.20, but no link-layer path/);
  assert.match(said("fail: wifi wrong SSID"), /no network named “Neighbour”/);
  assert.match(said("fail: unsolicited inbound through NAT"), /no mapping .* started inside/);
  assert.match(said("fail: lease expired before ping"), /set to get one from DHCP, but it has no current lease/);
});
