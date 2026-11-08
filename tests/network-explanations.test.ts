import test from "node:test";
import assert from "node:assert/strict";
import { explainStep } from "../src/practice/network/explanations.ts";
import { newSession, simulate } from "../src/practice/network/engine.ts";
import { starter } from "../src/practice/network/starters.ts";
import type { TraceEvent } from "../src/practice/network/model.ts";

const dhcpRun = () => {
  const network = starter("internet");
  const trace = simulate(network, newSession(), {
    kind: "dhcp",
    source: "phone",
    target: "",
  });
  assert.ok(trace.success, trace.summary);
  const receive = (actor: string, phase: string) => {
    const event = trace.events.find(
      (e) =>
        e.actor === actor &&
        e.title === "Receive frame" &&
        e.layers.some((l) => l.name === `DHCP ${phase}`),
    );
    assert.ok(event, `${actor} receives ${phase}`);
    return event;
  };
  return { network, trace, receive };
};

test("DHCP explains why the other PC hears broadcasts but does not answer or take the address", () => {
  const { network, receive } = dhcpRun();
  const discover = explainStep(receive("pc", "Discover"), network);
  assert.match(discover.why, /broadcast/);
  assert.match(discover.why, /does not answer/);
  const offer = explainStep(receive("pc", "Offer"), network);
  assert.match(offer.why, /must not take/);
  assert.match(offer.outcome, /own settings do not change/);
  assert.match(offer.message, /UDP datagram: port 67 → 68/);
});

test("DHCP distinguishes the server, requesting client and forwarding switch", () => {
  const { network, receive, trace } = dhcpRun();
  const serverId = trace.events.find((e) => e.title === "DHCP Offer")!.actor;
  assert.match(
    explainStep(receive(serverId, "Discover"), network).why,
    /runs the DHCP service/,
  );
  assert.match(
    explainStep(receive("phone", "Offer"), network).outcome,
    /wait for ACK/,
  );
  const bridgeEvent = trace.events.find(
    (e) =>
      e.title === "Receive frame" &&
      e.layers.some((l) => l.name === "DHCP Discover") &&
      network.devices.find((d) => d.id === e.actor)?.kind === "switch",
  )!;
  assert.match(explainStep(bridgeEvent, network).why, /not to answer/);
  const offer = trace.events.find((e) => e.title === "DHCP Offer")!;
  assert.match(
    explainStep(offer, network).why,
    /not simply because it is a router/,
  );
  assert.deepEqual(offer.layers[0].fields, { Message: "Offer" }); // Context is not a fabricated header.
});

test("DHCP client identity uses IDs even when two devices have the same display name", () => {
  const { network, receive } = dhcpRun();
  network.devices.find((d) => d.id === "pc")!.name = network.devices.find(
    (d) => d.id === "phone",
  )!.name;
  assert.match(explainStep(receive("pc", "ACK"), network).why, /must not take/);
  assert.match(
    explainStep(receive("phone", "ACK"), network).why,
    /client that asked/,
  );
});

test("errors take priority over a previous DHCP packet and explanation reads do not mutate replay", () => {
  const { network, receive } = dhcpRun();
  const event = receive("phone", "ACK");
  const before = structuredClone(event);
  const error: TraceEvent = {
    ...event,
    error: true,
    title: "Delivery stopped",
    explanation: "Lease expired.",
  };
  assert.match(explainStep(error, network).why, /stops here/);
  assert.equal(explainStep(error, network).outcome, "Lease expired.");
  explainStep(event, network);
  assert.deepEqual(event, before);
});

test("HTTP steps explain the particular operation instead of repeating a protocol definition", () => {
  const network = starter("internet");
  const trace = simulate(network, newSession(), {
    kind: "http",
    source: "pc",
    target: "http://kitab.test/",
    dropOnce: true,
  });
  assert.ok(trace.success, trace.summary);
  const explanation = (title: string) =>
    explainStep(
      trace.events.find((e) => e.title === title)!,
      network,
    );
  assert.match(
    explanation("Prepare HTTP request").outcome,
    /not been transmitted/,
  );
  assert.match(
    explanation("Server reads HTTP request").outcome,
    /method and path/,
  );
  assert.match(explanation("Retransmit TCP segment").outcome, /same sequence/);
  assert.match(
    explanation("Restore reply destination").outcome,
    /internal destination/,
  );
  assert.match(
    explanation("Read reassembled response").outcome,
    /displays the body/,
  );
  assert.match(explanation("DNS answer").outcome, /DNS cache/);
  assert.match(explanation("Deliver IP payload").why, /destination IP/);
});

test("broadcast forwarding is labeled separately from unknown unicast", () => {
  const { network, trace } = dhcpRun();
  const forward = trace.events.find(
    (e) => e.title === "Forward broadcast on LAN",
  );
  assert.ok(forward);
  assert.match(explainStep(forward, network).why, /broadcast frame/);
  assert.ok(
    !trace.events.some((e) => e.title === "Unknown MAC: flood eligible ports"),
  );
});

test("a separate DHCP server is explained by service role, not router hardware", () => {
  const network = starter("internet");
  const provider = network.devices.find((d) => d.dhcp.enabled)!;
  provider.kind = "server";
  provider.name = "Office DHCP server";
  const trace = simulate(network, newSession(), {
    kind: "dhcp",
    source: "phone",
    target: "",
  });
  assert.ok(trace.success, trace.summary);
  const event = trace.events.find(
    (e) =>
      e.actor === provider.id &&
      e.title === "Receive frame" &&
      e.layers.some((l) => l.name === "DHCP Discover"),
  )!;
  const explanation = explainStep(event, network);
  assert.match(explanation.why, /Office DHCP server.*runs the DHCP service/);
  assert.match(explanation.detail, /router or a separate server/);
});
