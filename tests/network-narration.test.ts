import test from "node:test";
import assert from "node:assert/strict";
import { scenarios } from "./support/network-scenarios.ts";
import { narrate } from "../src/practice/network/narration.ts";

const all = scenarios();
const run = (name: string) => all.find((s) => s.name === name)!;
const told = (name: string) => {
  const s = run(name);
  return s.trace.events.map((_, i) => ({ event: s.trace.events[i], n: narrate(s.trace.events, i, s.network) }));
};

test("every event of every scenario is narrated from real values, with a rule for every protocol step", () => {
  const withoutRule = new Set(["Configuration complete", "Delivery stopped"]);
  for (const s of all)
    s.trace.events.forEach((e, i) => {
      const n = narrate(s.trace.events, i, s.network);
      const where = `${s.name} #${i} ${e.title}`;
      assert.ok(n.summary.length > 20, where);
      assert.doesNotMatch(n.summary, /undefined|NaN|\[object|\(\)|\(no device\)/, where);
      if (!withoutRule.has(e.title) && !e.error) assert.ok(n.rule, `${where} has no rule`);
      if (n.rule) assert.match(n.rule.source, /^(RFC \d+|IEEE 802)/, where);
      if (n.cause) assert.ok(n.cause.index < i, `${where}: a cause comes before its effect`);
    });
});

test("ARP is explained by the route decision that needed it", () => {
  const steps = told("internet: HTTP by name");
  const i = steps.findIndex((s) => s.event.title === "ARP: discover the next-hop MAC");
  const arp = steps[i].n;
  assert.match(arp.summary, /^Your PC knows the next hop is 198\.51\.100\.53|^Your PC knows the next hop is 192\.168\.1\.1/);
  assert.equal(steps[arp.cause!.index].event.title, "Choose a route");
  assert.match(arp.cause!.text, /chose next hop 192\.168\.1\.1, and its ARP cache had no MAC address for it/);
  // The route summary names the gateway because the DNS server is not local.
  assert.match(steps[arp.cause!.index].n.summary, /not on a connected network.*next hop 192\.168\.1\.1 \(Home router\)/);
});

test("NAT, TTL and TCP steps quote the values the engine actually used", () => {
  const steps = told("internet: HTTP by name");
  const translate = steps.find((s) => s.event.title === "Translate source with NAT")!;
  assert.match(translate.n.summary, /replaces the private source 192\.168\.1\.10:53000 with its public 203\.0\.113\.2:62000/);
  const restoreAt = steps.findIndex((s) => s.event.title === "Restore reply destination");
  const restore = steps[restoreAt].n;
  assert.equal(steps[restore.cause!.index].event.title, "Translate source with NAT");
  assert.equal(steps[restore.cause!.index].event.facts!.Outside, steps[restoreAt].event.facts!.Outside);
  const ttl = steps.find((s) => s.event.title === "Decrease TTL")!;
  assert.match(ttl.n.summary, /lowers the TTL from 64 to 63/);
  const synAck = steps.find((s) => s.event.title === "TCP SYN-ACK")!;
  assert.match(synAck.n.summary, /sequence number 7000 and acknowledgement 1001/);
});

test("DHCP narration says the client cannot use an offered address until its ACK arrives", () => {
  const steps = told("wifi: phone DHCP");
  assert.match(steps.find((s) => s.event.title === "DHCP Offer")!.n.summary, /offers 192\.168\.1\.100 to Your phone\. The client may not use it yet/);
  const apply = steps.find((s) => s.event.title === "Apply DHCP lease")!.n;
  assert.match(apply.summary, /now uses 192\.168\.1\.100\/24, gateway 192\.168\.1\.1 and DNS server 192\.168\.1\.1/);
  assert.equal(steps[apply.cause!.index].event.title, "DHCP ACK");
  assert.match(apply.real!, /check with ARP/);
});

test("a retransmission is linked to the loss that caused it", () => {
  const steps = told("internet: HTTP with one loss");
  const retry = steps.find((s) => s.event.title === "Retransmit TCP segment")!.n;
  assert.equal(steps[retry.cause!.index].event.title, "Drop TCP data segment");
  assert.match(retry.rule!.source, /RFC 9293 §3\.8\.1/);
});

test("a stopped delivery leads with its reason and points to the last step that worked", () => {
  const steps = told("fail: wrong gateway");
  const stop = steps.at(-1)!.n;
  assert.match(stop.summary, /^Nobody uses the next-hop address\. ARP received no reply for 192\.168\.1\.99/);
  assert.match(stop.cause!.text, /The last step that worked/);
  assert.equal(stop.rule!.source, "RFC 826");
});
