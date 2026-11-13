// The stacked layout for narrow screens: readable spacing for any valid network, and no cable behind a device it
// does not reach. The action label reads only what the trace recorded.
import test from "node:test";
import assert from "node:assert/strict";
import { COLUMN, ROW, stackedLayout } from "../src/practice/network/layout.ts";
import { actionAt } from "../src/practice/network/motion.ts";
import { createDevice, type DeviceKind, type Network } from "../src/practice/network/model.ts";
import { starter, starterOptions } from "../src/practice/network/starters.ts";
import { missions } from "../src/practice/network/missions.ts";
import { scenarios } from "./support/network-scenarios.ts";

/** A network of `n` devices joined at random (deterministic), with some left unconnected. */
function random(n: number, seed: number): Network {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  const kinds: DeviceKind[] = ["pc", "phone", "switch", "router", "ap", "server"];
  const devices = Array.from({ length: n }, (_, i) => createDevice(kinds[i % kinds.length], `d${i}`, Math.round(rnd() * 2000), Math.round(rnd() * 1200)));
  const links: Network["links"] = [];
  for (let i = 1; i < n; i++) if (rnd() < 0.85) links.push({ id: `l${i}`, a: { device: `d${i}`, port: "p" }, b: { device: `d${Math.floor(rnd() * i)}`, port: "p" }, medium: "ethernet" });
  // A few extra links make cycles.
  for (let k = 0; k < n / 5; k++) links.push({ id: `c${k}`, a: { device: `d${Math.floor(rnd() * n)}`, port: "p" }, b: { device: `d${Math.floor(rnd() * n)}`, port: "p" }, medium: "ethernet" });
  return { version: 1, name: `random ${n}`, devices, links: links.filter((l) => l.a.device !== l.b.device) };
}

const networks = (): [string, Network][] => [
  ...starterOptions.map((s) => [s.id, starter(s.id)] as [string, Network]),
  ...missions.flatMap((m) => m.variants.map((v) => [`${m.id}/${v.id}`, v.build()] as [string, Network])),
  ...scenarios().map((s) => [s.name, s.network] as [string, Network]),
  ...[1, 2, 5, 12, 25, 40].flatMap((n) => [7, 99].map((seed) => [`random ${n}/${seed}`, random(n, seed)] as [string, Network])),
];

test("every device has a place of its own, at least a column apart from its neighbours in a row", () => {
  for (const [name, n] of networks()) {
    const { pos, rows, width, height } = stackedLayout(n);
    assert.equal(Object.keys(pos).length, n.devices.length, name);
    assert.equal(rows.flat().length, n.devices.length, `${name}: each device in exactly one row`);
    const all = Object.values(pos);
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const [a, b] = [all[i], all[j]];
        assert.ok(Math.abs(a.y - b.y) >= ROW || Math.abs(a.x - b.x) >= COLUMN - 0.01, `${name}: two devices too close`);
      }
    for (const p of all) assert.ok(p.x >= 100 && p.x <= width - 100 && p.y >= 100 && p.y <= height - 150, `${name}: device outside the layout`);
  }
});

test("a link joins neighbouring rows or two devices of one row, so no cable passes behind another row", () => {
  for (const [name, n] of networks()) {
    const { pos } = stackedLayout(n);
    for (const l of n.links) {
      const [a, b] = [pos[l.a.device], pos[l.b.device]];
      if (!a || !b) continue;
      assert.ok(Math.abs(a.y - b.y) <= ROW + 0.01, `${name}: ${l.a.device}–${l.b.device} skips a row`);
    }
  }
});

test("the layout depends on the network only: the same network always gets the same rows", () => {
  const n = starter("internet");
  assert.deepEqual(stackedLayout(n).rows, stackedLayout(structuredClone(n)).rows);
  // It starts from the leftmost device and follows the links.
  assert.deepEqual(stackedLayout(n).rows[0], ["phone"]);
});

test("the action label shows only what the event recorded, and the chosen link only where its interface is recorded", () => {
  for (const s of scenarios())
    s.trace.events.forEach((e) => {
      const a = actionAt(e, s.network);
      assert.equal(a.title, e.title);
      assert.equal(a.device, e.actor);
      if (!e.facts || !Object.keys(e.facts).length) assert.equal(a.detail, undefined, `${s.name}: ${e.title} has no facts`);
      if (a.link) {
        const link = s.network.links.find((l) => l.id === a.link)!;
        assert.ok([link.a, link.b].some((p) => p.device === e.actor && p.port === e.facts?.Interface), `${s.name}: ${e.title}`);
      } else assert.ok(e.facts?.Interface === undefined || !s.network.links.some((l) => [l.a, l.b].some((p) => p.device === e.actor && p.port === e.facts!.Interface)));
      // Every address and port in the label is one the event recorded.
      const values = Object.values(e.facts ?? {}).map(String);
      for (const token of a.detail?.match(/\d+\.\d+\.\d+\.\d+(:\d+)?|[0-9a-f]{2}(:[0-9a-f]{2}){5}/g) ?? [])
        assert.ok(values.some((v) => v === token), `${s.name}: ${e.title} shows ${token}, which it did not record`);
    });
  const internet = scenarios().find((s) => s.trace.events.some((e) => e.title === "Choose a route" && e.facts?.["Next hop"]))!;
  const route = internet.trace.events.find((e) => e.title === "Choose a route" && e.facts?.["Next hop"])!;
  assert.match(actionAt(route, internet.network).detail!, new RegExp(`^Next hop ${String(route.facts!["Next hop"]).replace(/\./g, "\\.")}`));
});
