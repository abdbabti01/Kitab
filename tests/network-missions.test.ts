import test from "node:test";
import assert from "node:assert/strict";
import { missions, variantFor, type FixMission, type InvestigateMission, type Variant } from "../src/practice/network/missions.ts";
import { assessFix, diagnose, evidenceCredit, evidenceShows, stepKey, type Reveal, investigationAnswer, lockBroken, misconceptionStep, runSequence } from "../src/practice/network/mission-assess.ts";
import { connect } from "../src/practice/network/topology.ts";
import { failures } from "../src/practice/network/explanations.ts";
import { scenarios } from "./support/network-scenarios.ts";
import type { Failure, Network, TraceEvent } from "../src/practice/network/model.ts";

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const mission = (id: string) => missions.find((m) => m.id === id)!;
const fixMissions = missions.filter((m): m is FixMission => m.kind === "fix");
type Change = (n: Network) => Network | void;
/** Which settings (device and field path) differ between two networks. */
function changed(a: Network, b: Network) {
  const flat = (n: Network) => {
    const out: Record<string, string> = {};
    const walk = (v: unknown, path: string) => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      else out[path] = JSON.stringify(v);
    };
    for (const d of n.devices) walk({ ...d, x: 0, y: 0 }, d.id);
    out.links = JSON.stringify(n.links.map((l) => [l.a, l.b]));
    return out;
  };
  const [x, y] = [flat(a), flat(b)];
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]).map((k) => k.replace(/.d+./g, ".#.")).sort();
}
const apply = (v: Variant, change: Change) => {
  const n = v.build();
  return change(n) ?? n;
};

/** For every variant: the intended fix, other valid fixes, and changes that must not count. */
const cases: Record<string, Record<string, { fix: Change; also?: Change[]; not?: [Change, RegExp][]; secrets: string[] }>> = {
  "no-connection": {
    cable: {
      fix: (n) => connect(n, { device: "switch", port: "p2" }, { device: "server", port: "eth0" }, "ethernet"),
      also: [(n) => connect(n, { device: "switch", port: "p5" }, { device: "server", port: "eth0" }, "ethernet")],
      not: [[(n) => void (dev(n, "server").interfaces[0].ip = "192.168.1.21"), /addresses are correct/]],
      secrets: ["p2"],
    },
    port: {
      fix: (n) => void (dev(n, "server").interfaces[0].enabled = true),
      not: [[(n) => void (dev(n, "pc").interfaces[0].ip = "192.168.1.11"), /addresses are correct/]],
      secrets: ["enabled", "turned off"],
    },
    switches: {
      fix: (n) => connect(n, { device: "switch", port: "p3" }, { device: "room-switch", port: "p1" }, "ethernet"),
      also: [(n) => connect(n, { device: "switch", port: "p4" }, { device: "room-switch", port: "p3" }, "ethernet")],
      secrets: ["p3", "p1", "uplink", "connect the switches"],
    },
    wifi: {
      fix: (n) => connect(n, { device: "phone", port: "wlan0" }, { device: "ap", port: "wlan0" }, "wifi"),
      not: [[(n) => void (dev(n, "ap").password = "x"), /join its network/]],
      secrets: ["wlan0", "learn123"],
    },
  },
  neighbours: {
    "pc-mask": {
      fix: (n) => void (dev(n, "pc").interfaces[0].prefix = 24),
      also: [
        (n) => {
          Object.assign(dev(n, "server").interfaces[0], { ip: "192.168.1.20", prefix: 25 });
        },
      ],
      not: [[(n) => void (dev(n, "pc").interfaces[0].ip = "192.168.1.140"), /masks still differ/]],
      secrets: ["/24", "255.255.255.0", "24"],
    },
    "pc-address": {
      fix: (n) => void (dev(n, "pc").interfaces[0].ip = "192.168.1.10"),
      also: [(n) => void (dev(n, "server").interfaces[0].ip = "192.168.10.20")],
      not: [[(n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.20"), /no router on this LAN/]],
      secrets: ["192.168.1.10"],
    },
    "server-mask": {
      fix: (n) => void (dev(n, "server").interfaces[0].prefix = 24),
      not: [[(n) => void (dev(n, "server").interfaces[0].gateway = "192.168.1.10"), /no router on this LAN/]],
      secrets: ["/24", "24", "255.255.255.0"],
    },
  },
  "join-and-address": {
    passphrase: {
      fix: (n) => void (dev(n, "phone").password = "learn123"),
      not: [[(n) => void (dev(n, "ap").password = "learn124"), /join its network/]],
      secrets: ["learn123", "learn124"],
    },
    ssid: {
      fix: (n) => void (dev(n, "phone").ssid = "Kitab Wi-Fi"),
      not: [[(n) => void (dev(n, "ap").ssid = "Kitab WiFi"), /join its network/]],
      secrets: ["Kitab Wi-Fi", "Kitab WiFi", "hyphen"],
    },
    static: {
      fix: (n) => void (dev(n, "phone").interfaces[0].mode = "dhcp"),
      not: [[(n) => void Object.assign(dev(n, "phone").interfaces[0], { ip: "192.168.1.50", prefix: 24 }), /Interface not set to DHCP/]],
      secrets: ["DHCP · ask the network", "switch it to DHCP"],
    },
    "dhcp-off": {
      fix: (n) => void (dev(n, "router").dhcp.enabled = true),
      secrets: ["enable DHCP", "turn on"],
    },
    pool: {
      fix: (n) => void Object.assign(dev(n, "router").dhcp, { start: "192.168.1.100", end: "192.168.1.150" }),
      also: [(n) => void Object.assign(dev(n, "router").dhcp, { start: "192.168.1.200", end: "192.168.1.220" })],
      secrets: ["192.168.1.100", "192.168.1.150"],
    },
  },
  "leave-the-lan": {
    "no-gateway": {
      fix: (n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.1"),
      also: [(n) => void dev(n, "pc").routes.push({ network: "192.168.2.0", prefix: 24, via: "192.168.1.1", port: "eth0" })],
      not: [[(n) => void (dev(n, "pc").interfaces[0].ip = "192.168.2.10"), /Addresses identify each network/]],
      secrets: ["192.168.1.1"],
    },
    "wrong-gateway": {
      fix: (n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.1"),
      secrets: ["192.168.1.1"],
    },
    "server-gateway": {
      fix: (n) => void (dev(n, "server").interfaces[0].gateway = "192.168.2.1"),
      also: [(n) => void dev(n, "server").routes.push({ network: "192.168.1.0", prefix: 24, via: "192.168.2.1", port: "eth0" })],
      secrets: ["192.168.2.1"],
    },
    "router-route": {
      fix: (n) => void dev(n, "router").routes.push({ network: "10.0.3.0", prefix: 24, via: "192.168.2.2", port: "wan" }),
      also: [(n) => void dev(n, "router").routes.push({ network: "0.0.0.0", prefix: 0, via: "192.168.2.2", port: "wan" })],
      not: [[(n) => void n.links.push({ id: "x", a: { device: "pc", port: "eth0" }, b: { device: "server", port: "eth0" }, medium: "ethernet" }), /cabling or devices changed/]],
      secrets: ["10.0.3.0/24", "192.168.2.2", "via"],
    },
  },
  "bring-reply-home": {
    "nat-off": {
      fix: (n) => void (dev(n, "router").nat = true),
      not: [[(n) => void dev(n, "isp").routes.push({ network: "192.168.1.0", prefix: 24, via: "203.0.113.2", port: "lan" }), /do not route private addresses/]],
      secrets: ["Enable NAT", "turn NAT on"],
    },
    "nat-swapped": {
      fix: (n) => void Object.assign(dev(n, "router"), { inside: "lan", outside: "wan" }),
      not: [[(n) => void dev(n, "isp").routes.push({ network: "192.168.0.0", prefix: 16, via: "203.0.113.2", port: "lan" }), /do not route private addresses/]],
      secrets: ["inside lan", "outside wan"],
    },
    "no-default": {
      fix: (n) => void dev(n, "router").routes.push({ network: "0.0.0.0", prefix: 0, via: "203.0.113.1", port: "wan" }),
      also: [(n) => void (dev(n, "router").interfaces.find((p) => p.id === "wan")!.gateway = "203.0.113.1")],
      not: [[(n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.2"), /PC's settings are correct/]],
      secrets: ["203.0.113.1", "0.0.0.0/0"],
    },
  },
};

test("every mission has at least three versions that differ in cause or failure, all deterministic", () => {
  for (const m of missions) {
    assert.ok(m.variants.length >= 3, m.id);
    // A version differs from another in its failure, its cause, or which settings are broken; new numbers alone do not count.
    const signatures = m.variants.map((v) => {
      const t = runSequence(v.build(), [v.probe]);
      const broken = m.kind === "fix" ? changed(v.build(), apply(v, cases[m.id][v.id].fix)).join(",") : "";
      return `${t.reason ?? (m.kind === "investigate" ? investigationAnswer(m as InvestigateMission, v) : "ok")} ${v.faults.map((f) => `${f.device}:${f.area}`).join(",")} ${broken}`;
    });
    assert.equal(new Set(signatures).size, signatures.length, `${m.id}: two versions are the same problem`);
    // Mastery needs two different causes, so every fix mission offers at least two.
    if (m.kind === "fix") assert.ok(new Set(m.variants.map((v) => v.faults.map((f) => `${f.device}:${f.area}`).join())).size >= 2, m.id);
    for (const v of m.variants) assert.deepEqual(v.build(), v.build(), `${m.id}/${v.id} builds the same network every time`);
    assert.equal(variantFor(m, 1), m.variants[0]);
    assert.equal(variantFor(m, m.variants.length + 1), m.variants[0], "attempts cycle through every version");
  }
});

test("each version starts broken for its stated cause and is fixed by its intended change", () => {
  for (const m of fixMissions) {
    assert.deepEqual(Object.keys(cases[m.id]).sort(), m.variants.map((v) => v.id).sort(), `${m.id}: every version has a tested fix`);
    for (const v of m.variants) {
      const where = `${m.id}/${v.id}`;
      const start = assessFix(m, v, v.build());
      assert.equal(start.completed, false, `${where} must start broken`);
      assert.ok(start.checks.some((c) => !c.passed), where);
      // The failing run gives evidence that leads to the fault: it names the device or one of its addresses, or the device takes part.
      const t = runSequence(v.build(), [v.probe]);
      const n = v.build();
      assert.ok(
        v.faults.some(
          (f) =>
            t.summary.includes(dev(n, f.device).name) ||
            dev(n, f.device).interfaces.some((p) => p.ip && t.summary.includes(`${p.ip}.`)) ||
            t.events.some((e) => e.actor === f.device || e.hop?.from === f.device || e.hop?.to === f.device),
        ),
        `${where}: nothing in the failing run points to ${v.faults.map((f) => f.device)}`,
      );
      const done = assessFix(m, v, apply(v, cases[m.id][v.id].fix));
      assert.equal(done.completed, true, `${where}: intended fix fails: ${JSON.stringify([done.checks.filter((c) => !c.passed).map((c) => c.message), done.locked, done.shortcuts])}`);
      for (const c of done.checks) assert.ok(c.evidence >= 0 && c.trace.events[c.evidence], `${where}: ${c.id} points to its proof`);
    }
  }
});

test("other valid solutions are accepted; shortcuts and locked changes are explained, not accepted", () => {
  for (const m of fixMissions)
    for (const v of m.variants) {
      const c = cases[m.id][v.id];
      for (const alt of c.also ?? []) assert.equal(assessFix(m, v, apply(v, alt)).completed, true, `${m.id}/${v.id}: a valid alternative was rejected`);
      // A shortcut is tried instead of the fix, on the broken network.
      for (const [bad, why] of c.not ?? []) {
        const n = v.build();
        bad(n);
        const result = assessFix(m, v, n);
        assert.equal(result.completed, false, `${m.id}/${v.id}: a shortcut was accepted`);
        const said = [...result.locked, ...result.shortcuts, ...result.checks.map((x) => x.message)].join(" ");
        assert.match(said, why, `${m.id}/${v.id}`);
      }
    }
});

test("the NAT mission requests the server by IP, so its failures are NAT and routing, never DNS", () => {
  const m = mission("bring-reply-home") as FixMission;
  const expected: Record<string, string> = { "nat-off": "REPLY_NO_PATH", "nat-swapped": "REPLY_NO_PATH", "no-default": "ROUTER_NO_ROUTE" };
  for (const v of m.variants) {
    const n = v.build();
    assert.equal(v.probe.target, `http://${dev(n, "server").interfaces[0].ip}/`, v.id);
    // The completion text says this home's DNS server is on the Internet, so a lookup would need NAT too.
    assert.ok(!dev(n, "pc").interfaces[0].dns!.startsWith("192.168.1."), v.id);
    const t = runSequence(n, [v.probe]);
    assert.equal(t.reason, expected[v.id], v.id);
    assert.ok(!t.events.some((e) => e.title.startsWith("DNS")), `${v.id}: no DNS before the failure`);
    // NAT faults stop the reply after the request reached the server; the missing route stops the request at home.
    assert.equal(t.events.some((e) => e.title === "TCP SYN" && e.actor === "pc"), true, v.id);
    for (const c of m.checks) for (const a of c.actions(n, v)) assert.equal(a.target, v.probe.target, `${v.id}/${c.id}`);
  }
});

test("the NAT mission rejects an ISP route even when the page then loads", () => {
  const m = mission("bring-reply-home") as FixMission;
  const v = m.variants.find((x) => x.id === "nat-off")!;
  const n = v.build();
  dev(n, "isp").routes.push({ network: "192.168.1.0", prefix: 24, via: "203.0.113.2", port: "lan" });
  const result = assessFix(m, v, n);
  assert.equal(result.checks.find((c) => c.id === "page")!.passed, true, "the page loads through the shortcut");
  assert.equal(result.completed, false);
  assert.match(result.shortcuts[0], /RFC 1918/);
});

test("hints and briefs describe symptoms and where to look, never the value to set", () => {
  for (const m of missions)
    for (const v of m.variants) {
      const text = [m.brief, v.symptom, ...m.hints, v.focus].join(" ").toLowerCase();
      for (const secret of cases[m.id]?.[v.id]?.secrets ?? []) assert.ok(!text.includes(secret.toLowerCase()), `${m.id}/${v.id} reveals “${secret}”`);
      // A brief or symptom never names the broken setting's category directly.
      assert.doesNotMatch(`${m.brief} ${v.symptom}`, /mask|prefix|gateway is|passphrase is wrong|NAT is off|disabled|turned off/i, `${m.id}/${v.id}`);
    }
});

test("a diagnosis is judged against the version's actual cause, with feedback that does not give it away", () => {
  for (const m of fixMissions)
    for (const v of m.variants) {
      const n = v.build();
      for (const f of v.faults) assert.equal(diagnose(v, f, n).correct, true);
      const wrongArea = m.areas.find((a) => !v.faults.some((f) => f.area === a))!;
      const near = diagnose(v, { device: v.faults[0].device, area: wrongArea }, n);
      assert.equal(near.correct, false);
      assert.match(near.message, /involved, but that kind of setting is fine/);
      const other = n.devices.find((d) => !v.faults.some((f) => f.device === d.id))!;
      assert.match(diagnose(v, { device: other.id, area: v.faults[0].area }, n).message, /not where the problem starts/);
    }
});

// The steps that show each version's fault in its own broken run, as "actor: title". Nothing else counts:
// not the faulty device's other steps, and not frames merely sent to or from it.
const expectedEvidence: Record<string, string[]> = {
  "no-connection/cable": ["pc: Delivery stopped"],
  "no-connection/port": ["pc: Delivery stopped"],
  "no-connection/switches": ["pc: Delivery stopped"],
  "no-connection/wifi": ["phone: Delivery stopped"],
  "neighbours/pc-mask": ["pc: Delivery stopped"],
  "neighbours/pc-address": ["pc: Delivery stopped"],
  "neighbours/server-mask": ["server: Delivery stopped"],
  "join-and-address/passphrase": ["phone: Delivery stopped"],
  "join-and-address/ssid": ["phone: Delivery stopped"],
  "join-and-address/static": ["phone: Delivery stopped"],
  // The router received the Discover and offered nothing.
  "join-and-address/dhcp-off": ["router: Receive frame", "phone: Delivery stopped"],
  "join-and-address/pool": ["router: Receive frame", "router: Delivery stopped"],
  "leave-the-lan/no-gateway": ["pc: Delivery stopped"],
  // The PC's route decision names the gateway nobody owns.
  "leave-the-lan/wrong-gateway": ["pc: Choose a route", "pc: Delivery stopped"],
  "leave-the-lan/server-gateway": ["server: Delivery stopped"],
  "leave-the-lan/router-route": ["router: Delivery stopped"],
  // The request leaves the home router still from 192.168.1.10: the missing translation, then the failed return.
  "bring-reply-home/nat-off": ["router: Transmit over Ethernet", "isp: Delivery stopped"],
  "bring-reply-home/nat-swapped": ["router: Transmit over Ethernet", "isp: Delivery stopped"],
  "bring-reply-home/no-default": ["router: Delivery stopped"],
  "missing-segment/short": ["pc: Drop TCP data segment", "pc: Retransmit TCP segment", "server: Acknowledge received bytes"],
  "missing-segment/long": ["pc: Drop TCP data segment", "pc: Retransmit TCP segment", "server: Acknowledge received bytes"],
  "missing-segment/internet": ["pc: Drop TCP data segment", "pc: Retransmit TCP segment", "server: Acknowledge received bytes"],
};

test("evidence is only a step that shows this version's fault, in every version", () => {
  const seen = new Set<string>();
  for (const m of missions)
    for (const v of m.variants) {
      const key = `${m.id}/${v.id}`;
      seen.add(key);
      const t = runSequence(v.build(), [v.probe]);
      const shown = t.events.flatMap((e, i) => (evidenceShows(m, v, t, i) ? [`${e.actor}: ${e.title}`] : []));
      assert.deepEqual(shown, expectedEvidence[key], key);
      // Superficially related steps are refused: anything else the faulty device did, or a frame to or from it.
      const devices = v.faults.map((f) => f.device);
      t.events.forEach((e, i) => {
        if (expectedEvidence[key].includes(`${e.actor}: ${e.title}`)) return;
        if (devices.includes(e.actor) || devices.includes(e.hop?.from ?? "") || devices.includes(e.hop?.to ?? ""))
          assert.equal(evidenceShows(m, v, t, i), false, `${key}: step ${i} (${e.actor}: ${e.title}) is only near the fault`);
      });
      if (m.kind === "fix") {
        // A working run shows no problem, even at the same kind of step.
        const fixed = runSequence(apply(v, cases[m.id][v.id].fix), [v.probe]);
        fixed.events.forEach((_, i) => assert.equal(evidenceShows(m, v, fixed, i), false, `${key}: working run step ${i}`));
      }
    }
  assert.deepEqual([...seen].sort(), Object.keys(expectedEvidence).sort());
});

test("the untranslated packet is evidence whatever the learner sent: a ping as well as a page request", () => {
  const m = mission("bring-reply-home");
  const v = m.variants.find((x) => x.id === "nat-off")!;
  const t = runSequence(v.build(), [{ kind: "ping", source: "pc", target: "198.51.100.20", ttl: 64 }]);
  const shown = t.events.flatMap((e, i) => (evidenceShows(m, v, t, i) ? [`${e.actor}: ${e.title}`] : []));
  assert.ok(shown.includes("router: Transmit over Ethernet"), shown.join(" | "));
});

test("a stop caused by a different fault is not evidence for this one", () => {
  // No connection, server unplugged: unplugging the PC as well stops the run at the PC for its own reason.
  const m = mission("no-connection");
  const v = m.variants.find((x) => x.id === "cable")!;
  const n = v.build();
  dev(n, "pc").interfaces[0].enabled = false;
  const t = runSequence(n, [v.probe]);
  assert.equal(t.success, false);
  assert.notEqual(t.reason, runSequence(v.build(), [v.probe]).reason);
  t.events.forEach((_, i) => assert.equal(evidenceShows(m, v, t, i), false, `step ${i}: ${t.events[i].title}`));
});

test("the investigation's answer comes from each version's own run and differs between versions", () => {
  const inv = mission("missing-segment") as InvestigateMission;
  const answers = inv.variants.map((v) => investigationAnswer(inv, v));
  assert.equal(new Set(answers).size, answers.length, `answers ${answers}`);
  for (const [i, v] of inv.variants.entries()) {
    const t = runSequence(v.build(), [v.probe]);
    const resent = t.events.find((e) => e.title === "Retransmit TCP segment")!.layers.find((l) => l.name === "TCP segment")!.fields;
    assert.equal(answers[i], Number(resent.Sequence) + Number(resent["Payload bytes"]), "ACK = first byte + bytes resent");
  }
});

test("the long version's request really spans two segments, and only the lost one is resent", () => {
  const inv = mission("missing-segment") as InvestigateMission;
  const tcp = (e: { layers: { name: string; fields: Record<string, unknown> }[] }) => e.layers.find((l) => l.name === "TCP segment")!.fields;
  const run = (id: string) => {
    const v = inv.variants.find((x) => x.id === id)!;
    const t = runSequence(v.build(), [v.probe]);
    assert.equal(t.success, true, t.summary);
    const sent = t.events.filter((e) => e.title === "Create TCP segment" && e.actor === "pc" && Number(tcp(e)["Payload bytes"]) > 0).map(tcp);
    const resent = t.events.filter((e) => e.title === "Retransmit TCP segment").map(tcp);
    return { v, t, sent, resent, bytes: sent.reduce((n, f) => n + Number(f["Payload bytes"]), 0) };
  };
  const long = run("long"), short = run("short");
  // The engine's segment size is 96 bytes; the long request is bigger, so TCP splits it.
  assert.ok(long.bytes > 96, `request is ${long.bytes} bytes`);
  assert.equal(long.sent.length, 2);
  assert.deepEqual(long.sent.map((f) => Number(f["Payload bytes"])), [96, long.bytes - 96]);
  // The first segment is lost once; exactly its bytes are resent with the same sequence number.
  assert.equal(long.resent.length, 1);
  assert.equal(long.resent[0].Sequence, long.sent[0].Sequence);
  assert.equal(long.resent[0]["Payload bytes"], 96);
  // The second segment follows the resent one, continuing the byte stream.
  assert.equal(Number(long.sent[1].Sequence), Number(long.sent[0].Sequence) + 96);
  // The answer confirms only the resent bytes, not the whole request.
  const first = Number(long.sent[0].Sequence);
  assert.equal(investigationAnswer(inv, long.v), first + 96);
  assert.notEqual(investigationAnswer(inv, long.v), first + long.bytes);
  assert.equal(inv.explanation.options.find((o) => o.correct)!.id, "timer");
  // The short version's request fits in one segment, so the two traces differ in shape, not only in numbers.
  assert.ok(short.bytes <= 96);
  assert.equal(short.sent.length, 1);
  assert.ok(long.t.events.length > short.t.events.length);
  assert.match(long.v.cause, /two segments/);
});

test("predictions are computed from the engine, with distinct options", () => {
  for (const m of missions) {
    if (!m.prediction) continue;
    for (const v of m.variants) {
      const n = v.build();
      const options = m.prediction.options(n);
      assert.equal(new Set(options.map((o) => o.text)).size, options.length, `${m.id}/${v.id}: options repeat`);
      assert.ok(options.some((o) => o.id === m.prediction!.answer(n, v)), `${m.id}/${v.id}: answer is an option`);
    }
  }
  const answers = (id: string) => mission(id).variants.map((v) => mission(id).prediction!.answer(v.build(), v));
  assert.deepEqual(answers("neighbours"), ["nowhere", "nowhere", "local"]);
  assert.deepEqual(answers("leave-the-lan"), ["no", "no", "yes", "no"]);
});

test("locks name the setting and say why; unlocked settings and positions are free", () => {
  const m = mission("join-and-address");
  const v = m.variants[0];
  const before = dev(v.build(), "ap");
  assert.match(lockBroken(m, before, { ...before, password: "other" })!.why, /join its network/);
  assert.equal(lockBroken(m, before, { ...before, x: before.x + 50, name: "Hallway AP" }), undefined);
  const phone = dev(v.build(), "phone");
  assert.equal(lockBroken(m, phone, { ...phone, password: "learn123" }), undefined, "the phone's Wi-Fi settings are the learner's to fix");
});

test("every explanation question has exactly one right answer and every failure reason it relies on exists", () => {
  for (const m of missions) {
    assert.equal(m.explanation.options.filter((o) => o.correct).length, 1, m.id);
    assert.equal(m.hints.length, 2, `${m.id}: two general hints, the third is per version`);
    for (const v of m.variants) assert.ok(v.focus.length > 10 && v.cause.length > 10, `${m.id}/${v.id}`);
  }
  for (const m of fixMissions)
    for (const v of m.variants) {
      const reason = runSequence(v.build(), [v.probe]).reason!;
      assert.ok(failures[reason], `${m.id}/${v.id}: ${reason}`);
    }
});

test("failures keep what was observed apart from the diagnosis and repair advice, for every reason and cause", () => {
  const traces = [
    ...scenarios().map((s) => [s.name, s.trace] as const),
    ...missions.flatMap((m) => m.variants.map((v) => [`${m.id}/${v.id}`, runSequence(v.build(), [v.probe])] as const)),
  ];
  const seen = new Set<string>();
  let coached = 0;
  for (const [name, t] of traces) {
    if (t.success) continue;
    assert.ok(t.failure, name);
    // What every view shows by default is only the observation.
    assert.equal(t.summary, t.failure!.message, name);
    assert.equal(t.events.at(-1)!.explanation, t.failure!.message, name);
    for (let f: Failure | undefined = t.failure; f; f = f.cause) {
      seen.add(f.reason);
      if (f.detail || f.advice) coached++;
      for (const extra of [f.detail, f.advice]) {
        if (!extra) continue;
        for (const e of t.events) assert.ok(!e.explanation.includes(extra), `${name}: "${extra}" leaked into an event`);
      }
      assert.doesNotMatch(f.message, /(^|\. )(Check|Configure|Run |Fix |Assign|Restart|Turn on|Make |Join |Simplify)/, `${name}: advice in "${f.message}"`);
    }
  }
  assert.ok(coached > 10, "the playground still has diagnoses and suggestions to show");
  // Every reason is covered except: editor validation of the learner's own file, the 10,000-event guard,
  // and a misdelivered reply, which has no diagnosis or advice to separate. Keep this list exact.
  const unreached = ["INVALID_NETWORK", "SIMULATION_LIMIT", "REPLY_MISDELIVERED"];
  assert.deepEqual(Object.keys(failures).filter((reason) => !seen.has(reason)), unreached);
});

test("missions show the observation only: no simulator diagnosis or repair advice in check results", () => {
  const wrong = mission("leave-the-lan").variants.find((v) => v.id === "wrong-gateway")!;
  const t = runSequence(wrong.build(), [wrong.probe]);
  assert.equal(t.summary, "ARP received no reply for 192.168.1.254.");
  assert.equal(t.failure!.detail, "No device in this network uses 192.168.1.254, so nobody can answer.");
  assert.match(t.failure!.advice!, /Check Your PC's setting for its default gateway/);
  for (const m of fixMissions)
    for (const v of m.variants) {
      const probe = runSequence(v.build(), [v.probe]).failure;
      for (const c of assessFix(m, v, v.build()).checks)
        for (const extra of [probe?.detail, probe?.advice]) if (extra) assert.ok(!c.message.includes(extra), `${m.id}/${v.id}: ${c.message}`);
    }
});

test("a misconception's “show this step” points to an event that really happens, in every version", () => {
  for (const m of missions)
    for (const v of m.variants) {
      // After a fix (an investigation needs none), every grounded misconception finds its event.
      const network = m.kind === "fix" ? apply(v, cases[m.id][v.id].fix) : v.build();
      for (const o of m.explanation.options.filter((x) => !x.correct)) {
        const see = m.misconceptions[o.misconception!]?.see;
        if (!see) continue;
        const step = misconceptionStep(m, v, network, o.misconception!);
        assert.ok(step, `${m.id}/${v.id}: no “${see.title}”${see.actor ? ` by ${see.actor}` : ""} for ${o.misconception}`);
        const e = step.trace.events[step.index];
        assert.equal(e.title, see.title);
        if (see.actor) assert.equal(e.actor, see.actor);
        // Outside the version's broken first run, the step comes from a run that worked, as the explanation assumes.
        if (see.run !== "start" && m.kind === "fix") assert.ok(step.trace.success, `${m.id}/${v.id}: ${o.misconception} points into a failed run`);
        // Without a matching event there is no link at all, rather than a nearby one.
        assert.equal(misconceptionStep(m, v, network, "no-such-misconception"), null);
      }
    }
});

test("evidence the learner found counts towards mastery; a step assistance showed them first does not", () => {
  const m = mission("no-connection");
  const v = m.variants.find((x) => x.id === "cable")!;
  const t = runSequence(v.build(), [v.probe]);
  const stop = t.events.length - 1;
  const shown = (trace: typeof t, i: number, by: Reveal["by"] = "show-stop"): Reveal => ({ step: stepKey(trace.events[i]), by, at: "2026-11-12T10:00:00Z" });
  // Independent: nothing was shown before the choice.
  assert.deepEqual(evidenceCredit(m, v, t, stop, []), { credit: "independent" });
  // Assisted: "Show where and why" showed the stop, then the learner chose it.
  assert.deepEqual(evidenceCredit(m, v, t, stop, [shown(t, stop)]), { credit: "assisted", by: "show-stop" });
  // Moving away and back, or rerunning the same request, is still the same step: still assisted.
  const rerun = runSequence(v.build(), [v.probe]);
  assert.notEqual(rerun, t);
  assert.deepEqual(evidenceCredit(m, v, rerun, rerun.events.length - 1, [shown(t, stop, "check")]), { credit: "assisted", by: "check" });
  // Assistance that showed a different step does not take away a step the learner found.
  assert.deepEqual(evidenceCredit(m, v, t, stop, [shown(t, 0, "show-me")]), { credit: "independent" });
  // A step that does not show the problem is not evidence, assisted or not.
  assert.deepEqual(evidenceCredit(m, v, t, 0, [shown(t, 0)]), { credit: "invalid" });
  // In the wrong-gateway version, being shown the stop still leaves the route choice (also evidence) to find.
  const l = mission("leave-the-lan");
  const w = l.variants.find((x) => x.id === "wrong-gateway")!;
  const lt = runSequence(w.build(), [w.probe]);
  const route = lt.events.findIndex((e) => e.title === "Choose a route");
  assert.deepEqual(evidenceCredit(l, w, lt, route, [shown(lt, lt.events.length - 1)]), { credit: "independent" });
});

test("the assisted-evidence fingerprint tells similar steps apart and keeps the same step across reruns", () => {
  const reveal = (e: TraceEvent): Reveal => ({ step: stepKey(e), by: "show-me", at: "2026-11-12T10:00:00Z" });
  // Every evidence step in every version has a fingerprint no other event of its run shares,
  // and the same fingerprint when the run is repeated.
  for (const m of missions)
    for (const v of m.variants) {
      const t = runSequence(v.build(), [v.probe]),
        again = runSequence(v.build(), [v.probe]);
      t.events.forEach((e, i) => {
        if (!evidenceShows(m, v, t, i)) return;
        const where = `${m.id}/${v.id} step ${i} (${e.title})`;
        assert.ok(t.events.every((x, j) => j === i || stepKey(x) !== stepKey(e)), where);
        assert.equal(stepKey(again.events[i]), stepKey(e), where);
      });
    }
  // The router's ARP request and the leaking IP packet cross the same link with the same title: different steps.
  const b = mission("bring-reply-home");
  const nat = b.variants.find((x) => x.id === "nat-off")!;
  const nt = runSequence(nat.build(), [nat.probe]);
  const leak = nt.events.findIndex((e, i) => evidenceShows(b, nat, nt, i) && !!e.hop);
  const arp = nt.events.findIndex((e) => e.packet?.startsWith("arp-") && e.title === nt.events[leak].title && e.hop?.from === nt.events[leak].hop!.from && e.hop?.to === nt.events[leak].hop!.to);
  assert.ok(leak >= 0 && arp >= 0);
  assert.deepEqual(evidenceCredit(b, nat, nt, leak, [reveal(nt.events[arp])]), { credit: "independent" });
  assert.deepEqual(evidenceCredit(b, nat, nt, leak, [reveal(nt.events[leak])]), { credit: "assisted", by: "show-me" });
  // Two acknowledgements by the same device differ by their numbers: showing a later one leaves the first to find.
  const s = mission("missing-segment");
  const long = s.variants.find((x) => x.id === "long")!;
  const st = runSequence(long.build(), [long.probe]);
  const acks = st.events.flatMap((e, i) => (e.title === "Acknowledge received bytes" ? [i] : []));
  const first = acks.find((i) => evidenceShows(s, long, st, i))!;
  const later = acks.find((i) => i > first && st.events[i].actor === st.events[first].actor)!;
  assert.ok(later > first);
  assert.deepEqual(evidenceCredit(s, long, st, first, [reveal(st.events[later])]), { credit: "independent" });
  // Credit is judged against the assistance recorded before the choice: what is shown afterwards does not revoke it.
  const log = [reveal(st.events[later])],
    seen = log.length;
  log.push(reveal(st.events[first]));
  assert.deepEqual(evidenceCredit(s, long, st, first, log.slice(0, seen)), { credit: "independent" });
  assert.deepEqual(evidenceCredit(s, long, st, first, log), { credit: "assisted", by: "show-me" });
});
