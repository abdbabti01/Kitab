import test from "node:test";
import assert from "node:assert/strict";
import {
  challenges,
  assessChallenge,
  type Challenge,
} from "../src/practice/network/challenges.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { connect } from "../src/practice/network/topology.ts";
import type { Action, Network } from "../src/practice/network/model.ts";

const get = (id: string) => challenges().find((c) => c.id === id)!; // fresh networks on every call
const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
function judge(c: Challenge, n: Network, action: Action = c.action) {
  return assessChallenge(c, action, simulate(n, newSession(), action), n);
}
/** The intended correction for each challenge. */
const fixes: Record<string, (n: Network) => Network | void> = {
  cable: (n) =>
    connect(n, { device: "switch", port: "p2" }, { device: "server", port: "eth0" }, "ethernet"),
  subnet: (n) => void (dev(n, "pc").interfaces[0].prefix = 24),
  wifi: (n) => void (dev(n, "phone").password = "learn123"),
  route: (n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.1"),
  nat: (n) => void (dev(n, "router").nat = true),
  loss: () => undefined,
};

test("no challenge is complete before the learner changes anything", () => {
  for (const c of challenges()) {
    const v = judge(c, c.network);
    assert.notEqual(v.status, "passed", c.id);
    assert.ok(v.message.length > 20, `${c.id} explains why: ${v.message}`);
  }
});

test("every challenge passes with its intended correction and says what was proved", () => {
  for (const c of challenges()) {
    const n = fixes[c.id](c.network) ?? c.network;
    const action = c.id === "loss" ? { ...c.action, dropOnce: true } : c.action;
    const v = judge(c, n, action);
    assert.equal(v.status, "passed", `${c.id}: ${v.message}`);
    assert.equal(v.message, c.proved);
    assert.equal(judge(c, n, { ...action, source: "server" }).status, "incomplete", `${c.id} wrong source`);
  }
});

test("HTTP targets are judged by the server reached, not by how the URL is typed", () => {
  const c = get("nat");
  dev(c.network, "router").nat = true;
  for (const target of ["http://kitab.test/", "http://kitab.test", "kitab.test", "HTTP://KITAB.TEST/", "http://198.51.100.20/"])
    assert.equal(judge(c, c.network, { ...c.action, target }).status, "passed", target);
  const loss = get("loss");
  for (const target of ["http://192.168.1.20", "192.168.1.20", "http://192.168.1.20/"])
    assert.equal(judge(loss, loss.network, { ...loss.action, target, dropOnce: true }).status, "passed", target);
});

test("NAT is not credited when an ISP static route to the private LAN does the work", () => {
  const c = get("nat");
  dev(c.network, "isp").routes.push({ network: "192.168.1.0", prefix: 24, via: "203.0.113.2", port: "lan" });
  const v = judge(c, c.network);
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /route to your private network/);
  assert.match(v.message, /RFC 1918/);
});

test("the NAT challenge's broken start explains private addresses instead of recommending an ISP route", () => {
  const c = get("nat");
  const v = judge(c, c.network);
  assert.equal(v.status, "failed");
  assert.match(v.message, /private address \(RFC 1918\)/);
  assert.doesNotMatch(v.message, /matching static route/);
});

test("a ping that works through a mask mismatch does not count as fixing the subnet", () => {
  const c = get("subnet");
  dev(c.network, "pc").interfaces[0].ip = "192.168.1.140"; // still /25, server /24
  const v = judge(c, c.network);
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /masks still disagree/);
  // One consistent /25 for both devices is a valid single subnet, so it is accepted.
  dev(c.network, "server").interfaces[0].prefix = 25;
  assert.equal(judge(c, c.network).status, "passed");
});

test("Wi-Fi is joined from the phone, not by removing the access point's password", () => {
  const c = get("wifi");
  dev(c.network, "ap").password = "";
  const v = judge(c, c.network);
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /changed the access point/);
});

test("the loss challenge needs an actual lost segment", () => {
  const c = get("loss");
  const v = judge(c, c.network);
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /no segment was lost/);
});

test("re-addressing the server and pinging a different address does not pass a ping challenge", () => {
  const c = get("subnet");
  for (const id of ["pc", "server"]) dev(c.network, id).interfaces[0].prefix = 25;
  dev(c.network, "server").interfaces[0].ip = "192.168.1.20";
  const v = judge(c, c.network, { ...c.action, target: "192.168.1.20" });
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /needs a ping to 192\.168\.1\.130/);
  // A consistent /25 that still reaches .130 is a legitimate single subnet.
  const ok = get("subnet");
  dev(ok.network, "server").interfaces[0].prefix = 25;
  dev(ok.network, "pc").interfaces[0].ip = "192.168.1.140";
  assert.equal(judge(ok, ok.network).status, "passed");
});

test("a reply from the wrong device is named", () => {
  const c = get("cable");
  const v = judge(c, c.network, { ...c.action, target: "192.168.1.10" }); // the PC itself
  assert.equal(v.status, "incomplete");
  assert.match(v.message, /Your PC answered, but this challenge needs a reply from Local server/);
});
