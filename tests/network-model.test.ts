import test from "node:test";
import assert from "node:assert/strict";
import {
  subnet,
  validateNetwork,
  importNetwork,
  connect,
} from "../src/practice/network/topology.ts";
import { starter } from "../src/practice/network/starters.ts";

test("subnet boundaries and invalid input", () => {
  assert.deepEqual(subnet("192.168.1.130", 25), {
    network: "192.168.1.128",
    broadcast: "192.168.1.255",
    mask: "255.255.255.128",
    first: "192.168.1.129",
    last: "192.168.1.254",
    usable: 126,
  });
  assert.throws(() => subnet("999.1.1.1", 24));
  assert.throws(() => subnet("1.1.1.1", 33));
});
test("all starters validate and import roundtrip", () => {
  for (const id of ["empty", "lan", "wifi", "routed", "internet"]) {
    const n = starter(id);
    assert.deepEqual(validateNetwork(n), []);
    assert.deepEqual(importNetwork(JSON.stringify(n)), n);
  }
});
test("reject duplicate IDs and dangling imported links", () => {
  const n = starter("lan");
  n.devices.push(structuredClone(n.devices[0]));
  assert.throws(() => importNetwork(JSON.stringify(n)));
  const m = starter("lan");
  m.links[0].a.device = "missing";
  assert.throws(() => importNetwork(JSON.stringify(m)));
});
test("ports cannot accept two cables or incompatible media", () => {
  const n = starter("lan");
  assert.throws(() =>
    connect(
      n,
      { device: "pc", port: "eth0" },
      { device: "server", port: "eth0" },
      "ethernet",
    ),
  );
});
test("import rejects too many devices and invalid addresses", () => {
  const n = starter("lan");
  n.devices[0].interfaces[0].ip = "999.2.3.4";
  assert.throws(() => importNetwork(JSON.stringify(n)));
  assert.throws(() => importNetwork("x".repeat(1000001)));
});
