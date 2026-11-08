import test from "node:test";
import assert from "node:assert/strict";
import {
  challenges,
  challengePassed,
} from "../src/practice/network/challenges.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { connect } from "../src/practice/network/topology.ts";
test("all six challenges are solvable and five broken starts really fail", () => {
  for (const c of challenges()) {
    let n = c.network;
    if (c.id !== "loss")
      assert.equal(simulate(n, newSession(), c.action).success, false, c.id);
    if (c.id === "cable")
      n = connect(
        n,
        { device: "switch", port: "p2" },
        { device: "server", port: "eth0" },
        "ethernet",
      );
    if (c.id === "subnet") n.devices[0].interfaces[0].prefix = 24;
    if (c.id === "wifi")
      n.devices.find((d) => d.id === "phone")!.password = "learn123";
    if (c.id === "route") n.devices[0].interfaces[0].gateway = "192.168.1.1";
    if (c.id === "nat") n.devices.find((d) => d.id === "router")!.nat = true;
    const t = simulate(n, newSession(), c.action);
    assert.equal(
      challengePassed(c, c.action, t, n),
      true,
      `${c.id}: ${t.summary}`,
    );
    assert.equal(
      challengePassed(c, { ...c.action, source: "wrong" }, t, n),
      false,
    );
  }
});
