// Behaviour baseline recorded before Phase 2 (explanations and journey UX).
// Phase 2 may add metadata to events but must not change what the network does:
// event order, acting device, hops, headers, state snapshots, outcomes and challenge verdicts.
// Regenerate deliberately with BASELINE_WRITE=1 and justify every difference in the commit.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { scenarios } from "./support/network-scenarios.ts";
import { challenges, assessChallenge } from "../src/practice/network/challenges.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { connect } from "../src/practice/network/topology.ts";
import type { Network, Trace } from "../src/practice/network/model.ts";

const file = new URL("./fixtures/network-baseline.json", import.meta.url);
const hash = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 10);
/** One line per event: what happened, where, on which link, and a digest of its headers and state snapshot. */
const project = (t: Trace) => ({
  success: t.success,
  events: t.events.map((e) =>
    [e.title, e.actor, e.location, e.hop ? `${e.hop.from}>${e.hop.to}@${e.hop.link}` : "", e.error ? "error" : "", hash([e.layers, e.snapshot, e.dhcpContext ?? null])].join(" | "),
  ),
});

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const variants: Record<string, Record<string, (n: Network) => void>> = {
  cable: { fix: (n) => void Object.assign(n, connect(n, { device: "switch", port: "p2" }, { device: "server", port: "eth0" }, "ethernet")) },
  subnet: { fix: (n) => void (dev(n, "pc").interfaces[0].prefix = 24), "move pc only": (n) => void (dev(n, "pc").interfaces[0].ip = "192.168.1.140") },
  wifi: { fix: (n) => void (dev(n, "phone").password = "learn123"), "blank ap password": (n) => void (dev(n, "ap").password = "") },
  route: { fix: (n) => void (dev(n, "pc").interfaces[0].gateway = "192.168.1.1") },
  nat: {
    fix: (n) => void (dev(n, "router").nat = true),
    "isp route": (n) => void dev(n, "isp").routes.push({ network: "192.168.1.0", prefix: 24, via: "203.0.113.2", port: "lan" }),
  },
  loss: { fix: () => undefined },
};
function verdicts() {
  const out: Record<string, string> = {};
  for (const c of challenges()) {
    out[`${c.id}: start`] = assessChallenge(c, c.action, simulate(c.network, newSession(), c.action), c.network).status;
    for (const [name, change] of Object.entries(variants[c.id] ?? {})) {
      const fresh = challenges().find((x) => x.id === c.id)!;
      change(fresh.network);
      const action = c.id === "loss" ? { ...fresh.action, dropOnce: true } : fresh.action;
      out[`${c.id}: ${name}`] = assessChallenge(fresh, action, simulate(fresh.network, newSession(), action), fresh.network).status;
    }
  }
  return out;
}

const current = () => ({
  scenarios: Object.fromEntries(scenarios().map((s) => [s.name, project(s.trace)])),
  challenges: verdicts(),
});

test("networking behaviour matches the recorded baseline", () => {
  const now = current();
  if (process.env.BASELINE_WRITE) writeFileSync(file, `${JSON.stringify(now, null, 1)}\n`);
  const recorded = JSON.parse(readFileSync(file, "utf8")) as ReturnType<typeof current>;
  assert.deepEqual(Object.keys(now.scenarios), Object.keys(recorded.scenarios));
  for (const [name, run] of Object.entries(recorded.scenarios)) {
    const actual = now.scenarios[name];
    assert.equal(actual.success, run.success, name);
    const at = run.events.findIndex((line, i) => actual.events[i] !== line);
    assert.equal(actual.events.length, run.events.length, `${name}: event count`);
    assert.equal(at, -1, `${name}: first difference at event ${at}\n  was: ${run.events[at]}\n  now: ${actual.events[at]}`);
  }
  assert.deepEqual(now.challenges, recorded.challenges);
});

test("the same input always produces the same trace", () => {
  const [a, b] = [scenarios(), scenarios()];
  for (const [i, s] of a.entries()) assert.deepEqual(project(s.trace), project(b[i].trace), s.name);
});
