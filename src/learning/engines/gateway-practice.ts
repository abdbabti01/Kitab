// Engine for the "gateway-or-direct" practice mission: which MAC does your PC put on the frame? Each version is one of
// the lab's starter networks, sometimes with the addresses below changed, and every event, MAC address and decision is
// from a real run of the lab's simulator (through local-delivery's runs). The settings here are the network's
// configuration, the input to the simulation; nothing the simulator decides is written here.
import { z } from "zod";
import type { Network } from "../../practice/network/model.ts";
import { starter } from "../../practice/network/starters.ts";
import type { EngineAdapter, Fact, FrameDraft, Trace } from "../types.ts";
import { defineRun, eventFacts, eventIndex, frameOf, runOf, type LocalDeliveryData, type RunId } from "./local-delivery.ts";

type Setting = { device: string; port: string; ip?: string; prefix?: number; gateway?: string; mode?: "static" };
/** The practice networks: a starter, the ping's destination, and the interface settings that differ from the starter. */
export const VARIANTS = {
  "home-phone": { base: "internet", name: "Your PC and your phone at home", target: "192.168.1.30", settings: [{ device: "phone", port: "wlan0", ip: "192.168.1.30", prefix: 24, gateway: "192.168.1.1", mode: "static" }] },
  "office-server": { base: "routed", name: "Two connected LANs", target: "192.168.2.20", settings: [] },
  "split-25": {
    base: "routed", name: "One /24 split into two /25 subnets", target: "192.168.1.200",
    settings: [
      { device: "pc", port: "eth0", prefix: 25 },
      { device: "router", port: "lan", prefix: 25 },
      { device: "router", port: "wan", ip: "192.168.1.129", prefix: 25 },
      { device: "server", port: "eth0", ip: "192.168.1.200", prefix: 25, gateway: "192.168.1.129" },
    ],
  },
  "home-23": {
    base: "internet", name: "A /23 home network", target: "192.168.0.30",
    settings: [
      { device: "pc", port: "eth0", prefix: 23 },
      { device: "router", port: "lan", prefix: 23 },
      { device: "phone", port: "wlan0", ip: "192.168.0.30", prefix: 23, gateway: "192.168.1.1", mode: "static" },
    ],
  },
  "internet-server": { base: "internet", name: "A server on the Internet", target: "198.51.100.20", settings: [] },
} as const satisfies Record<string, { base: "routed" | "internet"; name: string; target: string; settings: readonly Setting[] }>;
export type VariantId = keyof typeof VARIANTS;

const runId = (variant: VariantId): RunId => `practice-${variant}`;
for (const [id, variant] of Object.entries(VARIANTS) as [VariantId, (typeof VARIANTS)[VariantId]][]) {
  defineRun(`practice-${id}`, {
    base: variant.base,
    name: variant.name,
    build: () => {
      const network: Network = starter(variant.base);
      for (const { device, port, ...values } of variant.settings as readonly Setting[]) Object.assign(network.devices.find((d) => d.id === device)!.interfaces.find((p) => p.id === port)!, values);
      return { network, action: { kind: "ping", source: "pc", target: variant.target, ttl: 64 } };
    },
  });
}

/** The mission repeats the PC's settings in each version's parameters for its question; they must match the network. */
const params = z
  .object({
    variant: z.enum(Object.keys(VARIANTS) as [VariantId, ...VariantId[]]),
    address: z.string(),
    prefix: z.number().int(),
    gateway: z.string(),
    destination: z.string(),
  })
  .strict();
type Params = z.infer<typeof params>;

const pcPort = (network: Network) => network.devices.find((d) => d.id === "pc")!.interfaces.find((p) => p.ip)!;
const ownerOf = (network: Network, ip: string) => network.devices.find((d) => d.interfaces.some((p) => p.ip === ip));
const macOf = (network: Network, ip: string) => ownerOf(network, ip)!.interfaces.find((p) => p.ip === ip)!.mac;

function build(p: Params) {
  const id = runId(p.variant),
    { network, trace } = runOf(id),
    pc = pcPort(network);
  if (pc.ip !== p.address || pc.prefix !== p.prefix || pc.gateway !== p.gateway || VARIANTS[p.variant].target !== p.destination)
    throw new Error(`The ${p.variant} version's parameters don't match its network (${pc.ip}/${pc.prefix} via ${pc.gateway} to ${VARIANTS[p.variant].target}).`);
  const target = ownerOf(network, p.destination)!,
    gateway = ownerOf(network, p.gateway)!;
  const route = eventIndex(id, "pc", "Choose a route"),
    arp = eventIndex(id, "pc", "ARP: discover the next-hop MAC"),
    arpSent = eventIndex(id, "pc", "Transmit over Ethernet"),
    sent = eventIndex(id, "pc", "Transmit over Ethernet", { ipv4: true }),
    saved = eventIndex(id, "pc", "Save ARP mapping"),
    nextHop = String(trace.events[route].facts!["Next hop"]),
    reply = eventIndex(id, ownerOf(network, nextHop)!.id, "ARP reply"),
    arrived = eventIndex(id, target.id, "Deliver IP payload"),
    complete = eventIndex(id, "pc", "Ping complete");
  const frame = frameOf(trace.events[sent])!,
    frameMac = String(frame["Destination MAC"]),
    direct = nextHop === p.destination;
  // The simulator's frame must agree with the network's own addresses: the next hop's MAC, learned by ARP.
  if (frameMac !== macOf(network, nextHop) || frameMac !== String(trace.events[saved].facts!.MAC)) throw new Error(`${p.variant}: the frame's destination MAC ${frameMac} isn't the next hop's.`);

  const frames: FrameDraft<LocalDeliveryData>[] = [];
  const add = (frameId: string, level: string, index: number, facts: Fact[], focus: string, title?: string, view: LocalDeliveryData["view"] = "event") => {
    const event = trace.events[index],
      devices = [...new Set([focus, event.actor, "pc", target.id, gateway.id, ...facts.map((f) => f.entityId!).filter(Boolean)])];
    frames.push({
      id: frameId, title: title ?? event.title, narration: title ?? event.explanation, level,
      actor: network.devices.find((d) => d.id === focus)!.name,
      entities: devices.map((d) => ({ id: d, label: network.devices.find((x) => x.id === d)!.name, kind: "device" })),
      focus: [focus], facts, durationMs: 1100, data: { view, run: id, index },
    });
  };
  // Before the prediction only this frame is shown: the PC's own settings and the destination, never its decision.
  add("task", "decision", route, [
    { id: "pc-address", label: "Your PC", value: `${pc.ip}/${pc.prefix}`, entityId: "pc" },
    { id: "gateway", label: "Default gateway", value: pc.gateway, entityId: gateway.id },
    { id: "destination", label: "Destination", value: p.destination, entityId: target.id },
  ], "pc", "Your PC has a packet to send", "task");
  add("pc-route", "decision", route, eventFacts(id, route), "pc");
  add("arp-request", "link", arpSent, [...eventFacts(id, arp), ...eventFacts(id, arpSent).filter((f) => /mac|port/.test(f.id) && !/arp/.test(f.id))], "pc", "ARP: who has the next hop's address?");
  add("arp-reply", "link", reply, eventFacts(id, reply), trace.events[reply].actor);
  add("arp-saved", "link", saved, eventFacts(id, saved), "pc");
  add("the-frame", "link", sent, eventFacts(id, sent), "pc", "The frame leaves your PC");
  add("arrives", "network", arrived, eventFacts(id, arrived), target.id);
  add("complete", "network", complete, [
    ...eventFacts(id, complete),
    { id: "delivered", label: "Simulated run succeeded", value: trace.success, entityId: "pc" },
    { id: "summary", label: "Simulator summary", value: trace.summary, entityId: "pc" },
  ], "pc");

  return {
    frames,
    outcome: {
      decision: direct ? "direct" : "gateway",
      route: String(trace.events[route].facts!.Route),
      nextHop,
      frameMac,
      ownMac: String(frame["Source MAC"]),
      targetMac: macOf(network, p.destination),
      gatewayMac: macOf(network, p.gateway),
      broadcastMac: String(frameOf(trace.events[arpSent])!["Destination MAC"]),
      targetName: target.name,
      gatewayName: gateway.name,
      delivered: trace.success,
    },
    outcomeLabels: {
      decision: "Direct or gateway",
      route: "Your PC's route",
      nextHop: "Your PC's next hop",
      frameMac: "Destination MAC on your PC's frame",
      ownMac: "Your PC's MAC",
      targetMac: "The destination's MAC",
      gatewayMac: "The default gateway's MAC",
      broadcastMac: "Broadcast MAC",
      targetName: "Destination device",
      gatewayName: "Default gateway device",
      delivered: "Simulated run succeeded",
    },
  };
}

/** Claims that contradict the run, for the tutor. */
function checkClaims(text: string, _facts: Fact[], trace: Trace) {
  const problems: string[] = [];
  const lower = text.toLowerCase();
  const o = trace.outcome;
  if (o.delivered !== true && /\b(arrives?|arrived|is delivered|reaches|reached|succeed(s|ed)?)\b/.test(lower)) problems.push("the simulated run did not succeed");
  for (const match of lower.matchAll(/destination mac(?: address)? (?:is|=|of)\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/g))
    if (match[1] !== String(o.frameMac)) problems.push(`the frame's destination MAC is ${o.frameMac}`);
  if (o.decision === "gateway" && /\b(arps?|asks?) for (the )?(server|destination)'?s? (mac|address)\b/.test(lower)) problems.push(`the PC asks for its next hop's MAC, ${o.nextHop}, not the destination's`);
  if (/\bswitch(es)? (answers?|replies|responds?) (to )?(the )?arp\b/.test(lower)) problems.push("the device that owns the address answers ARP, never the switch");
  return problems;
}

export const gatewayPracticeAdapter: EngineAdapter<Params, LocalDeliveryData> = {
  id: "gateway-practice",
  version: "1.0.0",
  title: "Gateway or direct",
  params,
  build,
  vocabulary: ["ipv4", "ip", "address", "subnet", "prefix", "mask", "gateway", "default", "route", "next", "hop", "direct", "arp", "mac", "frame", "packet", "ethernet", "switch", "router", "broadcast", "destination", "source", "ping", "link"],
  checkClaims,
};
