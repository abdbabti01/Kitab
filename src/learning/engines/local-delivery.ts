// Lesson engine for "Local delivery, gateways and routing". Every networking value it shows is read from a real run of
// the lab's deterministic simulator (simulate() in src/practice/network/engine.ts) on the lab's own starter networks:
// ARP replies, MAC addresses, routing decisions, TTL changes and delivery are never written here. The only value this
// file computes itself is the same-subnet arithmetic of chapter 1, with the shared IPv4 helper, labelled as a calculation.
import { z } from "zod";
import { simulate } from "../../practice/network/engine.ts";
import { divergence, experimentsFor, type FaultKind } from "../../practice/network/experiments.ts";
import type { Action, Network, Session, Trace as NetTrace, TraceEvent } from "../../practice/network/model.ts";
import { starter } from "../../practice/network/starters.ts";
import { block } from "../../net/ipv4.ts";
import { blockStart, compare, localQuestion, type Question } from "../../net/subnet-practice.ts";
import type { EngineAdapter, Entity, Fact, FactValue, FrameDraft, Trace } from "../types.ts";

/** The simulator runs this lesson shows. Each is one action on one of the lab's starter networks. */
export const RUNS = {
  routed: { starter: "routed", action: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 } },
  lan: { starter: "lan", action: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 } },
  internet: { starter: "internet", action: { kind: "ping", source: "pc", target: "198.51.100.20", ttl: 64 } },
} as const;
type BaseRunId = keyof typeof RUNS;

/**
 * The experiments: one setting of a base run's network changed, and the same action simulated again. Two are the lab's
 * own Break and compare changes (experimentsFor, by kind); the server's missing gateway is changed here, the same way.
 */
export const EXPERIMENTS = {
  "wrong-gateway": { base: "routed", name: "A wrong default gateway", lab: "wrong-gateway" },
  "no-return-gateway": { base: "routed", name: "A server with no gateway", lab: null },
  "nat-off": { base: "internet", name: "NAT turned off", lab: "nat" },
} as const satisfies Record<string, { base: BaseRunId; name: string; lab: FaultKind | null }>;
export type ExperimentId = keyof typeof EXPERIMENTS;
/** A base run, an experiment's run, the run after the experiment's setting is put back, or a practice network's run. */
export type RunId = BaseRunId | ExperimentId | `${ExperimentId}-restored` | `practice-${string}`;

/** Runs another engine defines on its own network (the gateway-or-direct practice), simulated here like every other run. */
type DefinedRun = { base: BaseRunId; name: string; build: () => { network: Network; action: Action } };
const defined = new Map<string, DefinedRun>();
export function defineRun(id: `practice-${string}`, run: DefinedRun) {
  defined.set(id, run);
}

const BASE_NAMES: Record<BaseRunId, string> = { routed: "Two connected LANs", lan: "Your first LAN", internet: "A request across the Internet" };
const experimentOf = (id: RunId) => (id.replace(/-restored$/, "") in EXPERIMENTS ? (id.replace(/-restored$/, "") as ExperimentId) : null);
/** The base run a run starts from: itself, the run its experiment changes, or the starter a practice network varies. */
export const baseOf = (id: RunId): BaseRunId => defined.get(id)?.base ?? (experimentOf(id) ? EXPERIMENTS[experimentOf(id)!].base : (id as BaseRunId));
export const runName = (id: RunId) => {
  const x = experimentOf(id);
  if (defined.has(id)) return defined.get(id)!.name;
  return !x ? BASE_NAMES[id as BaseRunId] : id.endsWith("-restored") ? `${EXPERIMENTS[x].name}, setting restored` : EXPERIMENTS[x].name;
};

const params = z.object({ experiment: z.enum(["none", ...(Object.keys(EXPERIMENTS) as ExperimentId[])]).default("none") }).strict();
type Params = z.infer<typeof params>;

/** The one setting an experiment changes, as the learner reads it. */
export type Change = { device: string; deviceName: string; setting: string; normal: string; changed: string; label: string };

const emptySession = (): Session => ({ buffers: {}, sockets: {}, time: 0, leases: {}, arp: {}, mac: {}, nat: [], tcp: {}, dns: {} });
type Run = { network: Network; trace: NetTrace; change?: Change };
const runs = new Map<RunId, Run>();

/** The experiment's network: the base network with one setting changed. */
function changed(x: ExperimentId): { network: Network; change: Change } {
  const base = runOf(EXPERIMENTS[x].base),
    action = RUNS[EXPERIMENTS[x].base].action;
  const kind = EXPERIMENTS[x].lab;
  if (kind) {
    const found = experimentsFor(base.network, { ...action }).experiments.find((e) => e.fault.kind === kind);
    if (!found) throw new Error(`The lab offers no ${kind} change for the ${EXPERIMENTS[x].base} run.`);
    const f = found.fault;
    return { network: found.network, change: { device: f.device, deviceName: base.network.devices.find((d) => d.id === f.device)!.name, setting: f.setting, normal: f.before, changed: f.after, label: f.label } };
  }
  // The server the ping goes to loses its default gateway: the request can still arrive, the reply has no way back.
  const network = structuredClone(base.network),
    server = network.devices.find((d) => d.interfaces.some((p) => p.ip === action.target))!,
    port = server.interfaces.find((p) => p.ip === action.target)!,
    normal = port.gateway;
  port.gateway = "";
  return { network, change: { device: server.id, deviceName: server.name, setting: "Default gateway", normal, changed: "none", label: `Remove ${server.name}'s default gateway` } };
}

/** The network and its simulated trace for a run, computed once. Deterministic, so the scene and the engine agree. */
export function runOf(id: RunId): Run {
  let run = runs.get(id);
  if (!run && defined.has(id)) {
    const { network, action } = defined.get(id)!.build();
    run = { network, trace: simulate(network, emptySession(), action) };
    runs.set(id, run);
  }
  if (!run) {
    if (id.startsWith("practice-")) throw new Error(`No practice run ${id} is defined.`);
    const x = experimentOf(id),
      action = { ...RUNS[baseOf(id)].action };
    if (!x) {
      const network = starter(RUNS[id as BaseRunId].starter);
      run = { network, trace: simulate(network, emptySession(), action) };
    } else if (!id.endsWith("-restored")) {
      const { network, change } = changed(x);
      run = { network, change, trace: simulate(network, emptySession(), action) };
    } else {
      // Put the one changed setting back (the device as it was in the base network), then run the same action again.
      const broken = runOf(x),
        original = runOf(baseOf(id)).network.devices.find((d) => d.id === broken.change!.device)!,
        network = { ...structuredClone(broken.network), devices: broken.network.devices.map((d) => structuredClone(d.id === original.id ? original : d)) };
      run = { network, change: broken.change, trace: simulate(network, emptySession(), action) };
    }
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

/** The last index matching, or -1 (the browser targets predate Array.prototype.findLastIndex). */
function lastIndex<T>(items: readonly T[], match: (item: T, index: number) => boolean) {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i], i)) return i;
  return -1;
}

/** The IPv4 header and the Ethernet frame of an event, exactly as the simulator recorded them. */
export function packetOf(event: TraceEvent) {
  return event.layers.find((layer) => layer.kind === "network" && "Source IP" in layer.fields)?.fields;
}
export function frameOf(event: TraceEvent) {
  return event.layers.find((layer) => layer.kind === "link" && "Source MAC" in layer.fields)?.fields;
}

export type View = "settings" | "event" | "compare" | "change" | "stop" | "task" | "lab";
export type LocalDeliveryData = {
  view: View;
  run: RunId;
  index: number;
  /** For "compare": the earlier event whose envelope is shown beside this one. */
  before?: { run: RunId; index: number };
  /** A prediction the scene asks before the step's answer is read; never scored or stored. */
  question?: Question;
  /** For "change": the experiment's setting, and whether this run has it normal, changed or put back. */
  change?: Change & { phase: "normal" | "changed" | "restored" };
  /** Where this experiment's run first differs from the normal run, from divergence(): one row per difference. */
  differences?: { what: string; normal: string; experiment: string }[];
  /** A lab mission that practises this step. */
  mission?: { id: string; title: string };
};

const kebab = (key: string) => key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const deviceEntity = (network: Network, id: string): Entity => {
  const device = network.devices.find((d) => d.id === id)!;
  return { id, label: device.name, kind: "device" };
};

export function eventFacts(id: RunId, index: number, prefix = ""): Fact[] {
  // Before/after facts on one step need distinct labels as well as ids.
  // Facts from the other starters name their run, so a step is never compared with a step of a different run. A
  // practice run is the only run its mission shows, so its labels stay short.
  const tag = prefix === "before-" ? "Before · " : prefix === "after-" ? "After · " : "",
    run = id === "routed" || id.startsWith("practice-") ? "" : ` (${runName(id)})`;
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

function build(p: Params) {
  const frames: FrameDraft<LocalDeliveryData>[] = [];
  /** A frame for one event of a run. It points at the device handling the event, unless `focus` names another. */
  const add = (frameId: string, level: string, data: LocalDeliveryData, facts: Fact[], extraEntities: string[] = [], title?: string, focus?: string) => {
    const { network, trace } = runOf(data.run),
      event = trace.events[data.index],
      actor = focus ?? event.actor,
      devices = [...new Set([actor, event.actor, ...extraEntities, ...facts.map((f) => f.entityId!).filter(Boolean)])];
    frames.push({
      id: frameId, title: title ?? event.title, narration: title ?? event.explanation, level, actor: network.devices.find((d) => d.id === actor)!.name,
      entities: devices.map((id) => deviceEntity(network, id)),
      focus: [actor], facts, durationMs: 1100, data,
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

  // Chapter 5: leaving home, in the same internet run. Routing has chosen the default route; NAT is a separate step after it.
  const internet = runOf("internet"),
    target = RUNS.internet.action.target,
    serverId = serverOf("internet"),
    translate = eventIndex("internet", "router", "Translate source with NAT"),
    arrived = eventIndex("internet", serverId, "Deliver IP payload"),
    replyRoute = eventIndex("internet", serverId, "Choose a route"),
    restore = eventIndex("internet", "router", "Restore reply destination"),
    home = eventIndex("internet", "pc", "Ping complete"),
    nat = internet.trace.events[translate].facts!,
    publicIp = String(nat.Outside).split(":")[0],
    // The reply as it reaches the home router, just before the router restores its destination.
    replyIn = lastIndex(internet.trace.events, (e, i) => i < restore && e.actor === "router" && e.title === "Receive frame" && packetOf(e)?.["Destination IP"] === publicIp);
  if (replyIn < 0) throw new Error("The internet run has no reply arriving at the home router before it restores the destination.");
  const mission = { id: "bring-reply-home", title: "Bring the reply home" };
  const natQuestion: Question = {
    prompt: `Your PC (${pc.ip}) pings ${target} on the Internet. Which source address does the server see on the packet?`,
    choices: [
      { label: `${publicIp} (the home router's public address)`, correct: true, feedback: "" },
      { label: `${pc.ip} (your PC's own address)`, correct: false, feedback: `${pc.ip} is a private address: it only means something inside your home network. The home router rewrites it to its public address, ${publicIp}, before the packet leaves.` },
      { label: `${pc.gateway} (the router's address on your LAN)`, correct: false, feedback: `${pc.gateway} is the router's address inside your home, which Internet devices can't reach either. NAT uses the router's public address, ${publicIp}.` },
    ],
    answer: `The home router translated ${String(nat.Inside)} to ${String(nat.Outside)}, so the server sees ${publicIp} as the source.`,
  };
  add("nat-translate", "network", { view: "compare", run: "internet", index: translate, before: { run: "internet", index: defaultRoute }, question: natQuestion, mission }, [
    ...eventFacts("internet", defaultRoute, "before-"),
    ...eventFacts("internet", translate, "after-"),
  ], [serverId]);
  add("server-sees", "network", { view: "event", run: "internet", index: arrived }, eventFacts("internet", arrived));
  add("server-replies", "network", { view: "event", run: "internet", index: replyRoute }, eventFacts("internet", replyRoute));
  add("nat-restore", "network", { view: "compare", run: "internet", index: restore, before: { run: "internet", index: replyIn } }, [
    ...eventFacts("internet", replyIn, "before-"),
    ...eventFacts("internet", restore, "after-"),
  ], ["pc"]);
  add("nat-home", "network", { view: "event", run: "internet", index: home, mission }, [
    ...eventFacts("internet", home),
    { id: "internet-delivered", label: `Simulated run succeeded (${runName("internet")})`, value: internet.trace.success, entityId: "pc" },
    { id: "internet-summary", label: `Simulator summary (${runName("internet")})`, value: internet.trace.summary, entityId: "pc" },
  ]);

  // Chapter 6: into the lab. No new event: the internet run as it ends, with links to the networks this lesson ran.
  add("try-lab", "network", { view: "lab", run: "internet", index: home }, [], [], "Try it in the lab", "pc");

  const journey = {
    ...outcomeOf("routed"),
    delivered: routed.trace.success && internet.trace.success,
    nextHop: String(ev(route).facts!["Next hop"]),
    frameDestinationMac: routerMac,
    routerInterface: outgoing,
    serverSawSource: String(packetOf(internet.trace.events[arrived])!["Source IP"]),
  };
  if (p.experiment === "none") return { frames, outcome: journey, outcomeLabels: OUTCOME_LABELS };
  return { frames: [...frames, ...experimentFrames(p.experiment)], outcome: { ...journey, ...experimentOutcome(p.experiment) }, outcomeLabels: OUTCOME_LABELS };
}

const OUTCOME_LABELS = {
  delivered: "Simulated run succeeded",
  nextHop: "Your PC's next hop",
  frameDestinationMac: "Destination MAC of your PC's frame",
  routerInterface: "Router's outgoing interface",
  pingSucceeded: "The ping succeeded",
  requestArrived: "The request reached the server",
  stopReason: "Simulator's stop reason",
  stoppedAt: "Where the run stopped",
  serverSawSource: "Source address the Internet server saw",
};

/** The device that owns the ping's target address. */
const serverOf = (id: RunId) => runOf(id).network.devices.find((d) => d.interfaces.some((p) => p.ip === RUNS[baseOf(id)].action.target))!.id;

/** What a run's trace shows, for the normal-vs-experiment comparison. */
function outcomeOf(id: RunId) {
  const { network, trace } = runOf(id),
    server = serverOf(id);
  return {
    pingSucceeded: trace.success,
    requestArrived: trace.events.some((e) => e.actor === server && e.title === "Deliver IP payload"),
    stopReason: trace.reason ?? "none",
    stoppedAt: trace.failure ? network.devices.find((d) => d.id === trace.failure!.device)!.name : "nowhere: the reply arrived",
  };
}

function experimentOutcome(x: ExperimentId): Record<string, FactValue> {
  const { trace } = runOf(x),
    route = trace.events.find((e) => e.actor === "pc" && e.title === "Choose a route"),
    seen = trace.events.find((e) => e.actor === serverOf(x) && e.title === "Deliver IP payload");
  return {
    ...outcomeOf(x),
    // Delivery may be asserted (by the tutor too) only when this experiment's own run succeeded.
    delivered: trace.success,
    ...(route ? { nextHop: String(route.facts!["Next hop"]) } : {}),
    ...(EXPERIMENTS[x].base === "internet" && seen ? { serverSawSource: String(packetOf(seen)!["Source IP"]) } : {}),
  };
}

/**
 * An experiment's steps, each from a real run: the normal run's setting and result, the one change, where the run
 * first differs from the normal one (divergence()), the request arriving if it does, the event where the run stops,
 * then the setting put back and the same action run again.
 */
function experimentFrames(x: ExperimentId): FrameDraft<LocalDeliveryData>[] {
  const frames: FrameDraft<LocalDeliveryData>[] = [];
  const base = EXPERIMENTS[x].base,
    normal = runOf(base),
    broken = runOf(x),
    restored = runOf(`${x}-restored`),
    change = broken.change!,
    events = broken.trace.events,
    last = (run: Run) => run.trace.events.length - 1;
  const add = (frameId: string, level: string, data: LocalDeliveryData, facts: Fact[], title: string, focus: string) => {
    const { network } = runOf(data.run),
      event = runOf(data.run).trace.events[data.index],
      devices = [...new Set([focus, event.actor, ...facts.map((f) => f.entityId!).filter(Boolean)])];
    frames.push({ id: frameId, title, narration: title, level, actor: network.devices.find((d) => d.id === focus)!.name, entities: devices.map((id) => deviceEntity(network, id)), focus: [focus], facts, durationMs: 1100, data });
  };
  // The changed run's result isn't shown on the change itself: the learner predicts it, then steps through the run.
  const settingFacts = (run: Run, value: string, result = true): Fact[] => [
    { id: "experiment-device", label: "Device changed", value: change.deviceName, entityId: change.device },
    { id: "experiment-setting", label: "Setting", value: change.setting, entityId: change.device },
    { id: "experiment-normal", label: "Normal value", value: change.normal, entityId: change.device },
    { id: "experiment-value", label: "Value in this run", value, entityId: change.device },
    ...(result
      ? [
          { id: "experiment-succeeded", label: "Simulated run succeeded", value: run.trace.success, entityId: change.device },
          { id: "experiment-summary", label: "Simulator summary", value: run.trace.summary, entityId: change.device },
        ]
      : []),
  ];

  add(`${x}-baseline`, "decision", { view: "change", run: base, index: last(normal), change: { ...change, phase: "normal" } }, settingFacts(normal, change.normal), "The normal run", change.device);
  add(`${x}-change`, "decision", { view: "change", run: x, index: 0, change: { ...change, phase: "changed" } }, settingFacts(broken, change.changed, false), "One change", change.device);

  const stop = lastIndex(events, (e) => e.title === "Delivery stopped");
  if (stop < 0 || broken.trace.success) throw new Error(`The ${x} experiment's run does not stop.`);
  const d = divergence(normal.trace, broken.trace);
  if (d?.broken !== undefined && d.broken < stop) {
    add(`${x}-diverge`, "decision", {
      view: "event", run: x, index: d.broken,
      differences: d.differences.map((item) => ({ what: item.what, normal: item.working, experiment: item.broken })),
    }, [
      ...eventFacts(x, d.broken),
      ...d.differences.flatMap((item) => [
        { id: `difference-${kebab(item.what)}-normal`, label: `${item.what} in the normal run`, value: item.working, entityId: d.device },
        { id: `difference-${kebab(item.what)}-experiment`, label: `${item.what} in this run`, value: item.broken, entityId: d.device },
      ]),
    ], "Where the runs part", d.device);
  }
  const server = serverOf(x),
    reached = events.findIndex((e) => e.actor === server && e.title === "Deliver IP payload");
  if (reached >= 0 && reached < stop) add(`${x}-arrives`, "network", { view: "event", run: x, index: reached }, eventFacts(x, reached), "The request still arrives", server);

  const failure = broken.trace.failure!,
    stopFacts: Fact[] = [
      { id: "stop-reason", label: "Stop reason", value: failure.reason, entityId: failure.device },
      { id: "stopped-at", label: "Where it stopped", value: broken.network.devices.find((dv) => dv.id === failure.device)!.name, entityId: failure.device },
      { id: "stop-message", label: "What the simulator observed", value: failure.message, entityId: failure.device },
      ...(failure.detail ? [{ id: "stop-detail", label: "Why", value: failure.detail, entityId: failure.device }] : []),
      ...(failure.cause && !failure.message.includes(failure.cause.message) ? [{ id: "stop-cause", label: "Underlying cause", value: failure.cause.message, entityId: failure.cause.device }] : []),
      ...(failure.cause?.detail && failure.cause.detail !== failure.detail ? [{ id: "stop-cause-detail", label: "Why (cause)", value: failure.cause.detail, entityId: failure.cause.device }] : []),
      ...((failure.advice ?? failure.cause?.advice) ? [{ id: "stop-advice", label: "What to check", value: (failure.advice ?? failure.cause?.advice)!, entityId: failure.device }] : []),
    ];
  add(`${x}-stop`, "network", { view: "stop", run: x, index: stop, ...(EXPERIMENTS[x].lab === "nat" ? { mission: { id: "bring-reply-home", title: "Bring the reply home" } } : {}) }, [...eventFacts(x, stop), ...stopFacts], "The run stops", failure.device);
  add(`${x}-restore`, "decision", { view: "change", run: `${x}-restored`, index: last(restored), change: { ...change, phase: "restored" } }, settingFacts(restored, change.normal), "Put it back and run again", change.device);
  return frames;
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
  // Where the step shows a NAT translation, the server sees and answers the public address, never the private one.
  const inside = facts.find((fact) => /(^|-)inside$/.test(fact.id))?.value,
    outside = facts.find((fact) => /(^|-)outside$/.test(fact.id))?.value;
  if (inside && outside && trace.outcome.serverSawSource !== String(inside).split(":")[0]) {
    const privateIp = String(inside).split(":")[0].replace(/\./g, "\\.");
    if (new RegExp(`\\bserver (sees|saw|receives|received|gets|replies to|answers)\\b[^.]*\\b${privateIp}\\b`).test(lower)) problems.push(`the server sees the translated address ${String(outside).split(":")[0]}`);
  }
  return problems;
}

export const localDeliveryAdapter: EngineAdapter<Params, LocalDeliveryData> = {
  id: "local-delivery",
  version: "1.2.0",
  title: "Local delivery, gateways and routing",
  params,
  build,
  vocabulary: [
    "ipv4", "ip", "address", "subnet", "prefix", "mask", "gateway", "default", "route", "routing", "table", "next", "hop", "interface",
    "arp", "mac", "frame", "packet", "ethernet", "switch", "router", "ttl", "forward", "connected", "broadcast", "reply", "ping", "nat",
    "translation", "translate", "public", "private", "port", "mapping", "restore", "experiment", "server",
  ],
  checkClaims,
};
