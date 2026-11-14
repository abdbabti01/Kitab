// Lesson engine for "Local delivery, gateways and routing". Every networking value it shows is read from a real run of
// the lab's deterministic simulator (simulate() in src/practice/network/engine.ts) on the lab's own starter networks:
// ARP replies, MAC addresses, routing decisions, TTL changes and delivery are never written here. The only value this
// file computes itself is the same-subnet arithmetic of chapter 1, with the shared IPv4 helper, labelled as a calculation.
import { z } from "zod";
import { simulate } from "../../practice/network/engine.ts";
import type { Network, Session, Trace as NetTrace, TraceEvent } from "../../practice/network/model.ts";
import { starter } from "../../practice/network/starters.ts";
import { block } from "../../net/ipv4.ts";
import { blockStart, compare, localQuestion, type Question } from "../../net/subnet-practice.ts";
import type { EngineAdapter, Entity, Fact, FrameDraft, Trace } from "../types.ts";

const params = z.object({}).strict();
type Params = z.infer<typeof params>;

/** The simulator runs this lesson shows. Each is one action on one of the lab's starter networks. */
export const RUNS = {
  routed: { starter: "routed", action: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 } },
  lan: { starter: "lan", action: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 } },
  internet: { starter: "internet", action: { kind: "ping", source: "pc", target: "198.51.100.20", ttl: 64 } },
} as const;
export type RunId = keyof typeof RUNS;
export const RUN_NAMES: Record<RunId, string> = { routed: "Two connected LANs", lan: "Your first LAN", internet: "A request across the Internet" };

const emptySession = (): Session => ({ buffers: {}, sockets: {}, time: 0, leases: {}, arp: {}, mac: {}, nat: [], tcp: {}, dns: {} });
const runs = new Map<RunId, { network: Network; trace: NetTrace }>();
/** The network and its simulated trace for a run, computed once. Deterministic, so the scene and the engine agree. */
export function runOf(id: RunId) {
  let run = runs.get(id);
  if (!run) {
    const network = starter(RUNS[id].starter);
    run = { network, trace: simulate(network, emptySession(), { ...RUNS[id].action }) };
    runs.set(id, run);
  }
  return run;
}

/** The index of the nth event a device logs with this title (optionally only events carrying an IPv4 packet). */
export function eventIndex(id: RunId, actor: string, title: string, options: { nth?: number; ipv4?: boolean; port?: string } = {}) {
  const { trace } = runOf(id);
  const matches = trace.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.actor === actor && event.title === title)
    .filter(({ event }) => !options.ipv4 || Boolean(packetOf(event)))
    .filter(({ event }) => !options.port || frameOf(event)?.["Outgoing port"] === options.port);
  const match = matches[(options.nth ?? 1) - 1];
  // A simulator change that drops a step must fail loudly, never let the lesson skip it.
  if (!match) throw new Error(`The ${id} run has no "${title}" event by ${actor}${options.port ? ` on ${options.port}` : ""}.`);
  return match.index;
}

/** The IPv4 header and the Ethernet frame of an event, exactly as the simulator recorded them. */
export function packetOf(event: TraceEvent) {
  return event.layers.find((layer) => layer.kind === "network" && "Source IP" in layer.fields)?.fields;
}
export function frameOf(event: TraceEvent) {
  return event.layers.find((layer) => layer.kind === "link" && "Source MAC" in layer.fields)?.fields;
}

export type View = "settings" | "event" | "compare";
export type LocalDeliveryData = {
  view: View;
  run: RunId;
  index: number;
  /** For "compare": the earlier event whose envelope is shown beside this one. */
  before?: { run: RunId; index: number };
  /** A prediction the scene asks before the step's answer is read; never scored or stored. */
  question?: Question;
};

const kebab = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const deviceEntity = (network: Network, id: string): Entity => {
  const device = network.devices.find((d) => d.id === id)!;
  return { id, label: device.name, kind: "device" };
};

function eventFacts(id: RunId, index: number, prefix = ""): Fact[] {
  // Before/after facts on one step need distinct labels as well as ids.
  // Facts from the other starters name their run, so a step is never compared with a step of a different run.
  const tag = prefix === "before-" ? "Before · " : prefix === "after-" ? "After · " : "",
    run = id === "routed" ? "" : ` (${RUN_NAMES[id]})`;
  return rawFacts(id, index, (id === "routed" ? "" : `${id}-`) + prefix).map((fact) => ({ ...fact, label: tag + fact.label + run }));
}

function rawFacts(id: RunId, index: number, prefix: string): Fact[] {
  const { network, trace } = runOf(id),
    event = trace.events[index],
    packet = packetOf(event),
    frame = frameOf(event),
    device = event.actor,
    facts: Fact[] = [{ id: `${prefix}device`, label: "Device handling it", value: network.devices.find((d) => d.id === device)!.name, entityId: device }];
  if (packet)
    facts.push(
      { id: `${prefix}source-ip`, label: "Source IP", value: String(packet["Source IP"]), entityId: device },
      { id: `${prefix}destination-ip`, label: "Destination IP", value: String(packet["Destination IP"]), entityId: device },
      { id: `${prefix}ttl`, label: "TTL", value: Number(packet.TTL), entityId: device },
    );
  if (frame)
    facts.push(
      { id: `${prefix}source-mac`, label: "Source MAC", value: String(frame["Source MAC"]), entityId: device },
      { id: `${prefix}destination-mac`, label: "Destination MAC", value: String(frame["Destination MAC"]), entityId: device },
      // The port belongs to whoever transmitted: shown only on the transmitting step.
      ...(event.title === "Transmit over Ethernet" && frame["Outgoing port"] ? [{ id: `${prefix}outgoing-port`, label: "Outgoing port", value: String(frame["Outgoing port"]), entityId: device }] : []),
    );
  const arp = event.layers.find((layer) => layer.kind === "link" && "Sender IP" in layer.fields)?.fields;
  if (arp)
    for (const [key, label] of [["Sender IP", "ARP sender IP"], ["Sender MAC", "ARP sender MAC"], ["Who has", "ARP asks: who has"], ["Target IP", "ARP reply to"]] as const)
      if (arp[key] !== undefined) facts.push({ id: `${prefix}${kebab(label)}`, label, value: String(arp[key]), entityId: device });
  for (const [key, value] of Object.entries(event.facts ?? {})) facts.push({ id: `${prefix}${kebab(key)}`, label: key, value, entityId: device });
  return facts;
}

function build(_: Params) {
  const frames: FrameDraft<LocalDeliveryData>[] = [];
  const add = (frameId: string, level: string, data: LocalDeliveryData, facts: Fact[], extraEntities: string[] = [], title?: string) => {
    const { network, trace } = runOf(data.run),
      event = trace.events[data.index],
      devices = [...new Set([event.actor, ...extraEntities, ...facts.map((f) => f.entityId!).filter(Boolean)])];
    frames.push({
      id: frameId, title: title ?? event.title, narration: title ?? event.explanation, level, actor: network.devices.find((d) => d.id === event.actor)!.name,
      entities: devices.map((id) => deviceEntity(network, id)),
      focus: [event.actor], facts, durationMs: 1100, data,
    });
  };
  const routed = runOf("routed"),
    pc = routed.network.devices.find((d) => d.id === "pc")!.interfaces[0],
    server = RUNS.routed.action.target,
    sameSubnet = compare(pc.ip, server, pc.prefix);

  // Chapter 1: the PC's own decision, the arithmetic from Lesson 1 (a calculation, not a simulated event).
  add("same-subnet", "decision", { view: "settings", run: "routed", index: 0, question: localQuestion(pc.ip, server, pc.prefix) }, [
    { id: "pc-address", label: "Your PC", value: `${pc.ip}/${pc.prefix}`, entityId: "pc" },
    { id: "gateway", label: "Default gateway", value: pc.gateway, entityId: "pc" },
    { id: "destination", label: "Destination", value: server, entityId: "server" },
    { id: "own-network", label: "Your address AND mask (calculation)", value: sameSubnet.own, entityId: "pc" },
    { id: "destination-network", label: "Destination AND mask (calculation)", value: sameSubnet.other, entityId: "pc" },
    { id: "same-subnet", label: "Same subnet (calculation)", value: sameSubnet.same, entityId: "pc" },
  ], ["server"], "Your PC decides: direct or gateway?");

  // Chapter 2: ARP for the gateway, then the frame addressed to the router's MAC.
  const route = eventIndex("routed", "pc", "Choose a route"),
    arp = eventIndex("routed", "pc", "ARP: discover the next-hop MAC"),
    reply = eventIndex("routed", "router", "ARP reply"),
    saved = eventIndex("routed", "pc", "Save ARP mapping"),
    wrap = eventIndex("routed", "pc", "Wrap in a link frame"),
    sent = eventIndex("routed", "pc", "Transmit over Ethernet", { ipv4: true });
  const ev = (i: number) => routed.trace.events[i];
  const routerMac = String(ev(saved).facts!.MAC),
    serverMac = String(ev(eventIndex("routed", "router", "Save ARP mapping")).facts!.MAC),
    pcMac = String(frameOf(ev(sent))!["Source MAC"]),
    arpSent = eventIndex("routed", "pc", "Transmit over Ethernet"),
    broadcast = String(frameOf(ev(arpSent))!["Destination MAC"]);
  const macQuestion: Question = {
    prompt: `Your PC sends a ping to ${server} through its gateway ${pc.gateway}. Which destination MAC address goes on the frame it sends?`,
    choices: [
      { label: `${routerMac} (the router's LAN interface)`, correct: true, feedback: "" },
      { label: `${serverMac} (the server)`, correct: false, feedback: `The server is on another subnet, so your PC never asks for its MAC: an Ethernet frame only crosses one link. It goes to the gateway, ${pc.gateway}, whose MAC your PC learns with ARP: ${routerMac}.` },
      { label: `${broadcast} (broadcast)`, correct: false, feedback: `Broadcast is only the ARP request asking "who has ${pc.gateway}?". Once the router answers, the frame carrying the ping goes to the router alone: ${routerMac}.` },
      { label: `${pcMac} (your PC's own)`, correct: false, feedback: `${pcMac} is your PC's own MAC: it goes in the frame's source field. The destination is the next device on this link, the router: ${routerMac}.` },
    ],
    answer: `The PC chose the default gateway ${pc.gateway} as its next hop, asked for its MAC with ARP and got ${routerMac}. The frame goes to the router; the packet inside still says ${server}.`,
  };
  add("pc-route", "decision", { view: "event", run: "routed", index: route, question: macQuestion }, eventFacts("routed", route));
  add("pc-arp", "link", { view: "event", run: "routed", index: arpSent }, [...eventFacts("routed", arp), ...eventFacts("routed", arpSent).filter((f) => /mac|port/.test(f.id) && !/arp/.test(f.id))]);
  add("router-arp-reply", "link", { view: "event", run: "routed", index: reply }, eventFacts("routed", reply));
  add("pc-arp-saved", "link", { view: "event", run: "routed", index: saved }, eventFacts("routed", saved));
  // Shown at the moment the frame leaves your PC, so the diagram and the envelope show the whole frame on the wire.
  add("pc-frame", "link", { view: "event", run: "routed", index: sent }, [...eventFacts("routed", wrap), ...eventFacts("routed", sent).filter((f) => /mac|port/.test(f.id))]);

  // Chapter 3: a switch passes the frame on unchanged; a router builds a new frame, keeps the IPs and lowers TTL.
  const lanSent = eventIndex("lan", "pc", "Transmit over Ethernet", { ipv4: true }),
    lanForward = eventIndex("lan", "switch", "Transmit over Ethernet", { ipv4: true }),
    routerSent = eventIndex("routed", "router", "Transmit over Ethernet", { ipv4: true, port: "wan" });
  add("switch-forwards", "link", { view: "compare", run: "lan", index: lanForward, before: { run: "lan", index: lanSent } }, [
    ...eventFacts("lan", lanSent, "before-"),
    ...eventFacts("lan", lanForward, "after-"),
  ], ["pc"]);
  const changedQuestion: Question = {
    prompt: "The router forwards the ping to the server's LAN. Compared with the frame your PC sent, what has changed?",
    choices: [
      { label: "Both MAC addresses and the TTL; the IP addresses stay the same", correct: true, feedback: "" },
      { label: "The IP addresses, because the router is now sending the packet", correct: false, feedback: "The router forwards your PC's packet; it doesn't send a packet of its own. The source and destination IP stay as your PC wrote them. Changing IP addresses is NAT, and this router doesn't do it." },
      { label: "Nothing: routers pass frames on unchanged, like a switch", correct: false, feedback: "That's what a switch does. A router ends the frame it received and builds a new one for the next link, with new MACs, and lowers the TTL by one." },
      { label: "Only the TTL", correct: false, feedback: "The TTL does drop, but the frame is new too: its MAC addresses belong to the next link, the router's other interface and the server." },
    ],
    answer: "The routed run shows it: the IP addresses are unchanged, both MAC addresses are new, and TTL dropped by one at the router.",
  };
  add("router-forwards", "network", { view: "compare", run: "routed", index: routerSent, before: { run: "routed", index: sent }, question: changedQuestion }, [
    ...eventFacts("routed", sent, "before-"),
    ...eventFacts("routed", routerSent, "after-"),
    { id: "nat", label: "NAT on this router", value: routed.network.devices.find((d) => d.id === "router")!.nat ? "on" : "off", entityId: "router" },
  ], ["pc", "server"]);

  // Chapter 4: inside the router, then delivery and the reply, all from the routed run.
  const received = eventIndex("routed", "router", "Receive frame", { ipv4: true }),
    ttl = eventIndex("routed", "router", "Decrease TTL"),
    routerRoute = eventIndex("routed", "router", "Choose a route"),
    routerArp = eventIndex("routed", "router", "ARP: discover the next-hop MAC"),
    delivered = eventIndex("routed", "server", "Deliver IP payload"),
    back = eventIndex("routed", "router", "Choose a route", { nth: 2 }),
    complete = eventIndex("routed", "pc", "Ping complete");
  const interfaces = routed.network.devices.find((d) => d.id === "router")!.interfaces.filter((p) => p.ip);
  const outgoing = String(ev(routerRoute).facts!.Interface);
  const interfaceQuestion: Question = {
    prompt: `The router has received the packet for ${server}. Out of which interface does it send it?`,
    choices: [
      ...interfaces.map((p) => ({
        label: `${p.id} (${blockStart(block(p.ip, p.prefix))}/${p.prefix})`,
        correct: p.id === outgoing,
        feedback: p.id === outgoing ? "" : `${server} isn't in ${blockStart(block(p.ip, p.prefix))}/${p.prefix}, the network on ${p.id}. The router uses the route whose network contains the destination.`,
      })),
      { label: "Back out the interface it arrived on, toward your PC", correct: false, feedback: "The router doesn't return the packet to its sender: it looks the destination up in its routing table and sends it toward that network." },
    ],
    answer: `The router's connected route for ${server} points to ${outgoing}, so it sends the packet out of ${outgoing} and uses ARP on that side to find the server.`,
  };
  add("router-receives", "network", { view: "event", run: "routed", index: received }, eventFacts("routed", received));
  add("router-ttl", "network", { view: "event", run: "routed", index: ttl }, eventFacts("routed", ttl));
  add("router-route", "network", { view: "event", run: "routed", index: routerRoute, question: interfaceQuestion }, [
    ...eventFacts("routed", routerRoute),
    ...interfaces.map((p) => ({ id: `connected-${p.id}`, label: `Connected route on ${p.id}`, value: `${blockStart(block(p.ip, p.prefix))}/${p.prefix}`, entityId: "router" })),
  ]);
  add("router-arp", "link", { view: "event", run: "routed", index: routerArp }, eventFacts("routed", routerArp));
  add("server-delivers", "network", { view: "event", run: "routed", index: delivered }, eventFacts("routed", delivered));
  add("reply-route", "network", { view: "event", run: "routed", index: back }, eventFacts("routed", back));
  add("ping-complete", "network", { view: "event", run: "routed", index: complete }, [
    ...eventFacts("routed", complete),
    { id: "delivered", label: "Simulated run succeeded", value: routed.trace.success, entityId: "pc" },
    { id: "summary", label: "Simulator summary", value: routed.trace.summary, entityId: "pc" },
  ]);
  // The default route, from a home router: the route that matches when no connected route does.
  const defaultRoute = eventIndex("internet", "router", "Choose a route");
  add("default-route", "network", { view: "event", run: "internet", index: defaultRoute }, eventFacts("internet", defaultRoute));

  return {
    frames,
    outcome: { delivered: routed.trace.success, nextHop: String(ev(route).facts!["Next hop"]), frameDestinationMac: routerMac, routerInterface: outgoing },
    outcomeLabels: { delivered: "Simulated run succeeded", nextHop: "Your PC's next hop", frameDestinationMac: "Destination MAC of your PC's frame", routerInterface: "Router's outgoing interface" },
  };
}

/** Claims that contradict the simulated runs, for the tutor. A clean result means no supported claim is contradicted. */
function checkClaims(text: string, facts: Fact[], trace: Trace) {
  const problems: string[] = [];
  const lower = text.toLowerCase();
  const value = (id: string) => facts.find((fact) => fact.id === id)?.value;
  // Delivery is a simulated result: it may be asserted only when the run succeeded.
  if (trace.outcome.delivered !== true && /\b(arrives?|arrived|is delivered|reaches|reached|succeed(s|ed)?)\b/.test(lower)) problems.push("the simulated run did not succeed");
  for (const match of lower.matchAll(/destination mac(?: address)? (?:is|=|of)\s*([0-9a-f]{2}(?::[0-9a-f]{2}){5})/g)) {
    const shown = [value("destination-mac"), value("after-destination-mac"), value("next-hop-mac"), value("mac")].filter(Boolean).map(String);
    if (shown.length && !shown.includes(match[1])) problems.push(`the destination MAC at this step is ${shown[0]}`);
  }
  if (/\bswitch(es)? (is|are|counts? as) (a )?hops?\b/.test(lower)) problems.push("a switch forwards frames but is not a hop");
  if (value("nat") === "off" && /\b(router|it) (translates|rewrites|changes) (the )?(source |destination )?ip\b/.test(lower)) problems.push("this router routes without NAT: it doesn't change IP addresses");
  return problems;
}

export const localDeliveryAdapter: EngineAdapter<Params, LocalDeliveryData> = {
  id: "local-delivery",
  version: "1.0.0",
  title: "Local delivery, gateways and routing",
  params,
  build,
  vocabulary: [
    "ipv4", "ip", "address", "subnet", "prefix", "mask", "gateway", "default", "route", "routing", "table", "next", "hop", "interface",
    "arp", "mac", "frame", "packet", "ethernet", "switch", "router", "ttl", "forward", "connected", "broadcast", "reply", "ping", "nat",
  ],
  checkClaims,
};
