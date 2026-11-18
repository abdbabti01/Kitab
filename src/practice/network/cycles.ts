// Guided experiments for the Network Playground: each runs a starter network through the real engine
// (simulate) and reads every answer from the recorded events: the route a device chose, the MAC address a frame
// was sent to, the ARP and DHCP messages in order, and where delivery stopped. Pure: no React.
import { compareChoices, direction, type Choice, type Cycle, type Evidence, type Trial } from "../../learning/cycle.ts";
import { newSession, simulate } from "./engine.ts";
import { starter } from "./starters.ts";
import type { Action, Network, Trace, TraceEvent } from "./model.ts";

/** A starter network, one optional change, the traffic to send, and whether to continue the first run's session. */
export type NetSetup = { starter: string; change?: keyof typeof changes; action: Action; again?: boolean };
export type NetRun = { network: Network; trace: Trace };

const iface = (n: Network, device: string) => n.devices.find((d) => d.id === device)!.interfaces[0];
const changes = {
  "no-gateway": (n: Network) => void (iface(n, "pc").gateway = ""),
  "dhcp-off": (n: Network) => void (n.devices.find((d) => d.kind === "router")!.dhcp!.enabled = false),
};

/** The network a setup describes: a fresh copy of the starter with its change. */
export function networkFor(setup: NetSetup): Network {
  const n = structuredClone(starter(setup.starter));
  if (setup.change) changes[setup.change](n);
  return n;
}
/** The real engine. `again` continues the first run's session (ARP caches, leases), as sending twice would. */
function runSetup(setup: NetSetup, base: NetRun | null): NetRun {
  const network = networkFor(setup);
  const session = setup.again && base ? structuredClone(base.trace.session) : newSession();
  return { network, trace: simulate(network, session, setup.action) };
}

// ---- Reading the trace ----
const field = (e: TraceEvent | undefined, layer: string, name: string) => e?.layers.find((l) => l.name === layer)?.fields[name];
const deviceName = (r: NetRun, id: string) => r.network.devices.find((d) => d.id === id)?.name ?? id;
const macOwner = (r: NetRun, mac: unknown) => r.network.devices.find((d) => d.interfaces.some((i) => i.mac === mac));
const events = (r: NetRun) => r.trace.events;
/** The first frame the source puts on the wire carrying the IP packet (not ARP). */
const firstDataFrame = (r: NetRun, source: string) => {
  const i = events(r).findIndex((e) => e.actor === source && e.title.startsWith("Transmit") && e.packet?.startsWith("ip-"));
  return i >= 0 ? { at: i, e: events(r)[i] } : null;
};
const routeOf = (r: NetRun, source: string) => {
  const i = events(r).findIndex((e) => e.actor === source && e.title === "Choose a route");
  return i >= 0 ? { at: i, facts: events(r)[i].facts ?? {} } : null;
};
const arpRequests = (r: NetRun, source: string) => events(r).filter((e) => e.actor === source && e.title.startsWith("ARP: discover")).length;
const arpHits = (r: NetRun, source: string) => events(r).filter((e) => e.actor === source && e.title === "ARP cache hit").length;
/** The source's first transmission: what it had to send before anything else. */
const firstSent = (r: NetRun, source: string) => {
  const i = events(r).findIndex((e) => e.actor === source && e.title.startsWith("Transmit"));
  return i >= 0 ? { at: i, e: events(r)[i] } : null;
};
/** Protocol messages in the order they were created, e.g. "Discover → Offer → Request → ACK". */
const dhcpOrder = (r: NetRun) =>
  events(r)
    .filter((e) => /^DHCP (Discover|Offer|Request|ACK|NAK)$/.test(e.title))
    .map((e) => e.title.replace("DHCP ", ""))
    .join(" → ");
const stop = (r: NetRun) => (r.trace.success ? null : { at: events(r).length - 1, e: events(r).at(-1)! });

/** What the run recorded, the result first; `at` is the event that shows it. */
function netEvidence(r: NetRun): Evidence[] {
  const source = r.trace.events[0]?.actor ?? "";
  const out: Evidence[] = [{ label: "Result", value: r.trace.summary, at: events(r).length - 1 }];
  const failure = stop(r);
  if (failure?.e.failure) out.push({ label: `Stopped at ${deviceName(r, failure.e.actor)}`, value: failure.e.failure.message, at: failure.at });
  const route = routeOf(r, source);
  if (route) out.push({ label: `${deviceName(r, source)}'s route`, value: `${route.facts.Route}, next hop ${route.facts["Next hop"]}`, at: route.at });
  const frame = firstDataFrame(r, source);
  if (frame) {
    const mac = field(frame.e, "Ethernet frame", "Destination MAC") ?? field(frame.e, "Wi-Fi frame", "Destination MAC");
    out.push({ label: "First frame carrying the packet: destination MAC", value: `${mac} (${macOwner(r, mac)?.name ?? "no device"})`, at: frame.at });
    out.push({ label: "The same packet's IP destination", value: String(field(frame.e, "IPv4 packet", "Destination IP")), at: frame.at });
  }
  const dhcp = dhcpOrder(r);
  if (dhcp) out.push({ label: "DHCP messages, in order", value: dhcp });
  if (r.trace.events.some((e) => e.title.startsWith("ARP"))) out.push({ label: `ARP requests from ${deviceName(r, source)}`, value: String(arpRequests(r, source)) }, { label: `ARP cache hits at ${deviceName(r, source)}`, value: String(arpHits(r, source)) });
  const sent = firstSent(r, source);
  if (sent) out.push({ label: `${deviceName(r, source)}'s first transmission`, value: `${sent.e.layers[0]?.name ?? sent.e.title} to ${field(sent.e, "Ethernet frame", "Destination MAC") ?? field(sent.e, "Wi-Fi frame", "Destination MAC") ?? "?"}`, at: sent.at });
  out.push({ label: "Events recorded", value: String(events(r).length) });
  return out;
}

const ping = (target: string): Action => ({ kind: "ping", source: "pc", target, ttl: 64 });
/** The setup in words, from the network alone. */
function startOf(setup: NetSetup): Evidence[] {
  const n = networkFor(setup);
  const source = n.devices.find((d) => d.id === setup.action.source)!;
  const port = source.interfaces[0];
  return [
    { label: "Network", value: n.name },
    { label: source.name, value: port.mode === "dhcp" || !port.ip ? "no IP address yet (set to get one by DHCP)" : `${port.ip}/${port.prefix}, gateway ${port.gateway || "none"}` },
    { label: "Traffic", value: setup.action.kind === "dhcp" ? `${source.name} asks for an address (DHCP)` : `${source.name} pings ${setup.action.target}${setup.again ? ", right after the first ping" : ""}` },
    ...n.devices.filter((d) => d.id !== source.id && d.kind !== "switch" && d.kind !== "ap").map((d) => ({ label: d.name, value: d.interfaces.filter((i) => i.ip).map((i) => `${i.ip}/${i.prefix}`).join(", ") || (d.dhcp?.enabled ? "DHCP service on" : "") })).filter((x) => x.value),
  ];
}

const gatewayReasons: Choice[] = [
  { id: "off-subnet", text: "The server is outside the PC's subnet, so the PC sends the packet to its default gateway: the frame is addressed to the next hop, while the IP destination stays the server." },
  { id: "direct", text: "The destination is in the PC's own subnet, so the frame goes straight to it." },
  { id: "no-route", text: "The PC has no route for the destination, so it sends nothing at all." },
  { id: "same-address", text: "A frame's destination MAC always belongs to the device in the packet's IP destination.", miss: "A frame only crosses one link. Its MAC addresses change at every router; the IP destination stays the final one." },
];
const gatewayReason = (r: NetRun) => {
  const route = routeOf(r, "pc");
  if (!route) return "no-route";
  return route.facts["Next hop"] === route.facts.Destination ? "direct" : "off-subnet";
};
const frameTarget = (r: NetRun) => {
  const frame = firstDataFrame(r, "pc");
  if (!frame) return "nothing";
  const mac = field(frame.e, "Ethernet frame", "Destination MAC");
  if (mac === "ff:ff:ff:ff:ff:ff") return "broadcast";
  return macOwner(r, mac)?.kind === "router" ? "router" : "server";
};
const frameChoices: Choice[] = [
  { id: "router", text: "The router's MAC address: its default gateway" },
  { id: "server", text: "The office server's MAC address", miss: "The PC can only send a frame to a device on its own link. The server is on another network, behind the router." },
  { id: "broadcast", text: "The broadcast address ff:ff:ff:ff:ff:ff, so every device hears it", miss: "Broadcast is for ARP and DHCP. Once the PC knows the next hop's MAC address, it addresses the frame to it alone." },
];

const gateway: Cycle<NetSetup, NetRun> = {
  id: "net-gateway-frame",
  version: 1,
  subject: "networking",
  unit: "routing",
  title: "Where does the first frame go?",
  concept: "IP addresses name the final destination; MAC addresses name the next device on this link.",
  scenario: "Your PC (192.168.1.10/24) pings the office server at 192.168.2.20, on another subnet. A router joins the two LANs and is the PC's default gateway, 192.168.1.1.",
  question: "When a destination is outside the local subnet, which device receives the frame first, and what stays the same?",
  watch: "The PC's route decision, which MAC address it asks for with ARP, and the frame's destination MAC next to the packet's destination IP.",
  terms: ["ip", "gateway"],
  limits: "One router, static addresses and instant links. Real hosts also keep ARP entries for a limited time, and real networks may have several routers and VLANs.",
  hint: "Compare the destination with the PC's own subnet first. Then remember a frame only travels across one link.",
  start: startOf,
  base: {
    id: "base",
    label: "Ping a server on another subnet",
    setup: { starter: "routed", action: ping("192.168.2.20") },
    question: "Which MAC address is the destination of the first frame that carries the ping?",
    choices: frameChoices,
    outcome: frameTarget,
    reasons: gatewayReasons,
    reason: gatewayReason,
    explain: (r) => {
      const route = routeOf(r, "pc")!;
      const frame = firstDataFrame(r, "pc")!;
      const mac = field(frame.e, "Ethernet frame", "Destination MAC");
      return `192.168.2.20 is outside 192.168.1.0/24, so the PC chose “${route.facts.Route}” with next hop ${route.facts["Next hop"]}. It asked with ARP who has ${route.facts["Next hop"]}, got the router's MAC ${mac}, and sent the ping in a frame addressed to ${mac}, while the IP packet inside still says ${field(frame.e, "IPv4 packet", "Destination IP")}. The router then made its own decision and sent a new frame to the server.`;
    },
  },
  variations: [
    {
      id: "no-gateway",
      label: "Remove the PC's default gateway",
      change: "Your PC's default gateway is cleared. Everything else is the same.",
      setup: { starter: "routed", change: "no-gateway", action: ping("192.168.2.20") },
      question: "What will happen to the ping this time?",
      choices: [
        { id: "delivered", text: "It still reaches the server: the router forwards it anyway", miss: "The router never sees it: without a gateway the PC has nowhere to send a packet for another subnet." },
        { id: "stops-at-pc", text: "The PC can't send it: it has no route to the server" },
        { id: "stops-at-router", text: "The PC sends it, and the router drops it" },
      ],
      outcome: (r) => (r.trace.success ? "delivered" : stop(r)!.e.actor === "pc" ? "stops-at-pc" : "stops-at-router"),
      reasons: gatewayReasons,
      reason: gatewayReason,
      explain: (r) => `The PC looked up 192.168.2.20, found it outside its subnet and had no gateway to send it to, so it stopped before sending a single frame: “${stop(r)?.e.failure?.message ?? r.trace.summary}” A default gateway is the only way out of a subnet for a host with no other routes.`,
    },
    {
      id: "ping-gateway",
      label: "Ping the router itself",
      change: "Your PC pings 192.168.1.1, the router's own address, instead of the server.",
      setup: { starter: "routed", action: ping("192.168.1.1") },
      question: "Which MAC address is the destination of the first frame that carries the ping?",
      choices: frameChoices,
      outcome: frameTarget,
      reasons: gatewayReasons,
      reason: gatewayReason,
      explain: (r) => {
        const route = routeOf(r, "pc")!;
        return `192.168.1.1 is inside the PC's own subnet, so the PC chose “${route.facts.Route}” and sent the frame straight to the router's MAC. Same MAC address as before, for a different reason: this time the router is the destination itself, not a next hop on the way.`;
      },
    },
  ],
  run: runSetup,
  evidence: netEvidence,
  readings: [
    { label: "Events recorded", read: (r) => events(r).length, format: String },
    { label: "Frames sent by the PC", read: (r) => events(r).filter((e) => e.actor === "pc" && e.title.startsWith("Transmit")).length, format: String },
  ],
};

const arpReasons: Choice[] = [
  { id: "unknown-mac", text: "The PC knew the server's IP address but not its MAC address, and a frame needs one: it asked the whole LAN with an ARP broadcast." },
  { id: "cached", text: "The PC already had the server's MAC address saved from the earlier exchange, so it sent the ping straight away." },
  { id: "no-owner", text: "No device answered the ARP request, so the PC never learned a MAC address to send the ping to." },
  { id: "switch-asks", text: "The switch needs to learn the address first, so it asks.", miss: "A switch forwards frames by MAC address but never asks for one: the sender resolves the next hop's MAC itself." },
];
const arpReason = (r: NetRun) => (arpHits(r, "pc") > 0 && arpRequests(r, "pc") === 0 ? "cached" : r.trace.reason === "ARP_NO_OWNER" ? "no-owner" : "unknown-mac");
const firstKind = (r: NetRun) => {
  const sent = firstSent(r, "pc");
  if (!sent) return "nothing";
  return sent.e.packet?.startsWith("arp") ? "arp" : sent.e.packet?.startsWith("ip") ? "ping" : "other";
};
const arp: Cycle<NetSetup, NetRun> = {
  id: "net-arp-first",
  version: 1,
  subject: "networking",
  unit: "lan",
  title: "What does your PC send first?",
  concept: "To send a frame on a LAN, a device needs the receiver's MAC address, not just its IP address.",
  scenario: "Your PC (192.168.1.10) and a server (192.168.1.20) are on the same LAN, joined by a switch. The PC has never talked to the server.",
  question: "What has to happen before the ping itself can leave the PC, and does it happen every time?",
  watch: "The PC's first transmission, who receives it, and the ARP cache entry it saves.",
  terms: ["ip"],
  limits: "ARP entries never expire here. Real operating systems forget them after minutes, and may also use ARP replies they overhear.",
  hint: "A frame needs a destination MAC address. Does the PC know the server's MAC before anything has been exchanged?",
  start: startOf,
  base: {
    id: "base",
    label: "First ping to a neighbour",
    setup: { starter: "lan", action: ping("192.168.1.20") },
    question: "What will the PC transmit first?",
    choices: [
      { id: "arp", text: "An ARP request, broadcast to every device: who has 192.168.1.20?" },
      { id: "ping", text: "The ping itself, addressed to the server", miss: "Addressed with what? The PC knows the server's IP address, but a frame needs its MAC address, which the PC hasn't learned yet." },
      { id: "other", text: "A DNS query to find the server", miss: "The ping already names an IP address, so there is no name to look up." },
    ],
    outcome: firstKind,
    reasons: arpReasons,
    reason: arpReason,
    explain: (r) =>
      `The PC's first frame was an ARP request to ff:ff:ff:ff:ff:ff asking who has 192.168.1.20. The switch flooded it to every port, the server answered with its MAC address, and the PC saved the mapping, then sent the ping in a frame addressed to that MAC. ARP requests from the PC: ${arpRequests(r, "pc")}.`,
  },
  variations: [
    {
      id: "again",
      label: "Send the same ping again",
      change: "Right after the first ping, the PC pings 192.168.1.20 again. Nothing has been restarted.",
      setup: { starter: "lan", action: ping("192.168.1.20"), again: true },
      question: "Compared with the first ping, how many ARP requests will the PC send?",
      choices: compareChoices("Fewer", "The same number", "More", { same: "Every ping needs a destination MAC, but not a new question: the PC saved the answer in its ARP cache." }),
      outcome: (r, b) => direction(arpRequests(b!, "pc"), arpRequests(r, "pc"), 0),
      reasons: arpReasons,
      reason: arpReason,
      explain: (r, b) => `The first ping needed ${arpRequests(b!, "pc")} ARP request; this one needed ${arpRequests(r, "pc")}: the PC found 192.168.1.20 in its ARP cache (${arpHits(r, "pc")} cache hit) and sent the ping at once, in ${events(r).length} events instead of ${events(b!).length}.`,
    },
    {
      id: "missing",
      label: "Ping an address no device has",
      change: "The PC pings 192.168.1.99. It's in the same subnet, but no device uses it.",
      setup: { starter: "lan", action: ping("192.168.1.99") },
      question: "What will the PC transmit first?",
      choices: [
        { id: "arp", text: "An ARP request, broadcast to every device: who has 192.168.1.99?" },
        { id: "ping", text: "The ping itself", miss: "Without a MAC address there is nothing to address the frame to: ARP comes first, whatever the answer." },
        { id: "nothing", text: "Nothing: the PC knows the address is unused", miss: "The PC can't know which addresses are in use until it asks." },
      ],
      outcome: firstKind,
      reasons: arpReasons,
      reason: arpReason,
      explain: (r) => `The PC broadcast an ARP request for 192.168.1.99 as before, but no device owns that address, so no reply came: “${stop(r)?.e.failure?.message ?? r.trace.summary}” The ping never left the PC.`,
    },
  ],
  run: runSetup,
  evidence: netEvidence,
  readings: [
    { label: "ARP requests from the PC", read: (r) => arpRequests(r, "pc"), format: String },
    { label: "ARP cache hits at the PC", read: (r) => arpHits(r, "pc"), format: String },
    { label: "Events recorded", read: (r) => events(r).length, format: String },
  ],
};

const dhcpReasons: Choice[] = [
  { id: "handshake", text: "With no address and no idea who the server is, the phone broadcasts Discover; the server offers an address, the phone requests that offer, and the server confirms it." },
  { id: "no-server", text: "No DHCP server answered the Discover, so the phone never got an offer." },
  { id: "access-point", text: "The access point hands out the address.", miss: "The access point only bridges Wi-Fi to the wired LAN; the DHCP service here runs on the home router." },
];
const dhcpTrial = (r: NetRun) => dhcpOrder(r);
const dhcp: Cycle<NetSetup, NetRun> = {
  id: "net-dhcp-order",
  version: 1,
  subject: "networking",
  unit: "lan",
  title: "How does a phone get an address?",
  concept: "DHCP lends a joining device an IP address, a gateway and a DNS server.",
  scenario: "Your phone joins the home Wi-Fi. It has no IP address yet, and the home router runs a DHCP service with addresses 192.168.1.100 to 192.168.1.150.",
  question: "Which messages does the exchange need, and in what order?",
  watch: "Each DHCP message, who sends it, and whether it is broadcast.",
  terms: ["dns", "ip"],
  limits: "One DHCP server answers. A real network may have several, a real client also checks the address isn't in use, and leases are renewed before they expire.",
  hint: "The phone starts with no address and doesn't know where the server is. What must it do first, and what must the server do before the phone can use an address?",
  start: startOf,
  base: {
    id: "base",
    label: "Join Wi-Fi and ask for an address",
    setup: { starter: "wifi", action: { kind: "dhcp", source: "phone", target: "" } },
    question: "In what order do the DHCP messages travel?",
    choices: [
      { id: "Discover → Offer → Request → ACK", text: "Discover → Offer → Request → ACK" },
      { id: "Request → ACK", text: "Request → ACK", miss: "Request what, from whom? The phone first has to find a server that will offer it an address." },
      { id: "Discover → ACK", text: "Discover → ACK", miss: "The server offers first and the phone accepts by requesting that offer; only then does the server confirm it." },
      { id: "Offer → Request → ACK", text: "Offer → Request → ACK", miss: "A server doesn't offer until a client asks: the phone's Discover starts the exchange." },
    ],
    outcome: dhcpTrial,
    reasons: dhcpReasons,
    reason: (r) => (r.trace.success ? "handshake" : "no-server"),
    explain: (r) => `The trace shows ${dhcpOrder(r)}. The phone broadcast Discover from 0.0.0.0 because it had no address; the router's DHCP service offered one; the phone requested that offer, and the router's ACK confirmed the lease: “${r.trace.summary}”`,
  },
  variations: [
    {
      id: "dhcp-off",
      label: "Turn off the router's DHCP service",
      change: "The home router's DHCP service is turned off. The phone joins the same Wi-Fi.",
      setup: { starter: "wifi", change: "dhcp-off", action: { kind: "dhcp", source: "phone", target: "" } },
      question: "What will the phone end up with?",
      choices: [
        { id: "address", text: "An address anyway, from the access point", miss: "Nothing else here runs a DHCP service: the access point only bridges Wi-Fi to the LAN." },
        { id: "none", text: "No address: its Discover gets no answer" },
        { id: "random", text: "An address it picks for itself in 192.168.1.0/24", miss: "In this model the phone waits for an offer. (Real devices may fall back to a 169.254.x.x link-local address, which still can't reach the router's network.)" },
      ],
      outcome: (r) => (r.trace.success ? "address" : "none"),
      reasons: dhcpReasons,
      reason: (r) => (r.trace.success ? "handshake" : "no-server"),
      explain: (r) => `The phone broadcast Discover as before, and that was the only DHCP message (${dhcpOrder(r)}): nothing on the LAN runs DHCP now. “${r.trace.summary}” Without an address the phone can't send anything beyond the Wi-Fi link.`,
    },
  ] as Trial<NetSetup, NetRun>[],
  run: runSetup,
  evidence: netEvidence,
  readings: [
    { label: "DHCP messages", read: (r) => events(r).filter((e) => /^DHCP /.test(e.title)).length, format: String },
    { label: "Events recorded", read: (r) => events(r).length, format: String },
  ],
};

export const netCycles = [arp, dhcp, gateway];
export const findNetCycle = (id: string | null) => netCycles.find((c) => c.id === id);
