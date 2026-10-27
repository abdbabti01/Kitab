import { assertCompleteTimeline, type SimulationTimeline } from "../../core/simulation.ts";
import { CLIENT_ISN, createSegments, SERVER_ISN, type TcpConnectionState } from "./tcp-engine.ts";

/**
 * One short chat message followed from program A to program B across a small, concrete network.
 *
 * Shares TCP's segmentation rule (createSegments), initial sequence numbers and state names with the
 * windowed-transfer engine (tcp-engine.ts), and adds what that engine does not model: the actual UTF-8
 * bytes, concrete ports/addresses, a topology with longest-prefix forwarding, TTL, per-hop link frames
 * and Ethernet's minimum-size padding.
 *
 * Declared simplifications: every link is Ethernet; neighbours' MAC addresses are already known (ARP
 * cached); no TCP/IP options; fixed readable sequence numbers; handshake packets cross the network as one
 * compressed step; only the data segment can be lost, and recovery is by retransmission timeout.
 */

export type JourneyLevel = "application" | "transport" | "network" | "link";
export type NodeId = "a" | "r1" | "r2" | "b";
export type LinkId = "link-1" | "link-2" | "link-3";
export type JourneyChapter = "message" | "bytes" | "connection" | "sending" | "network" | "receiving" | "recovery" | "complete";

export type JourneyConfig = { message: string; lose: "none" | "data" };

export const defaultJourneyConfig: JourneyConfig = { message: "HELLO", lose: "none" };
export const MESSAGE_MAX_CHARACTERS = 16;
/** Typical Ethernet MSS. The message is always far smaller, so the segmentation rule yields one segment. */
export const JOURNEY_MSS = 1460;
export const RETRANSMISSION_TIMEOUT_MS = 1000;
const TCP_HEADER = 20;
const IP_HEADER = 20;
const ETHERNET_HEADER = 14;
const ETHERNET_TRAILER = 4;
const ETHERNET_MIN_PAYLOAD = 46;
const INITIAL_TTL = 64;

// ---------------------------------------------------------------- topology (documentation address ranges)

export type Route = { prefix: string; via: string | null; link: LinkId };
export type Interface = { link: LinkId; ip: string; mac: string };
export type Host = { id: "a" | "b"; name: string; program: string; port: number; iface: Interface; routes: Route[] };
export type Router = { id: "r1" | "r2"; name: string; interfaces: Interface[]; routes: Route[] };

export const hosts: Record<"a" | "b", Host> = {
  a: {
    id: "a",
    name: "Computer A",
    program: "Chat program A",
    port: 50312,
    iface: { link: "link-1", ip: "192.0.2.20", mac: "02:00:00:00:0a:01" },
    routes: [{ prefix: "192.0.2.0/24", via: null, link: "link-1" }, { prefix: "0.0.0.0/0", via: "192.0.2.1", link: "link-1" }],
  },
  b: {
    id: "b",
    name: "Computer B",
    program: "Chat program B",
    port: 7070,
    iface: { link: "link-3", ip: "198.51.100.25", mac: "02:00:00:00:0b:01" },
    routes: [{ prefix: "198.51.100.0/24", via: null, link: "link-3" }, { prefix: "0.0.0.0/0", via: "198.51.100.1", link: "link-3" }],
  },
};

export const routers: Record<"r1" | "r2", Router> = {
  r1: {
    id: "r1",
    name: "Router R1",
    interfaces: [{ link: "link-1", ip: "192.0.2.1", mac: "02:00:00:00:01:01" }, { link: "link-2", ip: "203.0.113.1", mac: "02:00:00:00:01:02" }],
    routes: [{ prefix: "192.0.2.0/24", via: null, link: "link-1" }, { prefix: "203.0.113.0/24", via: null, link: "link-2" }, { prefix: "198.51.100.0/24", via: "203.0.113.2", link: "link-2" }],
  },
  r2: {
    id: "r2",
    name: "Router R2",
    interfaces: [{ link: "link-2", ip: "203.0.113.2", mac: "02:00:00:00:02:01" }, { link: "link-3", ip: "198.51.100.1", mac: "02:00:00:00:02:02" }],
    routes: [{ prefix: "203.0.113.0/24", via: null, link: "link-2" }, { prefix: "198.51.100.0/24", via: null, link: "link-3" }, { prefix: "192.0.2.0/24", via: "203.0.113.1", link: "link-2" }],
  },
};

export const links: Record<LinkId, { id: LinkId; ends: [NodeId, NodeId] }> = {
  "link-1": { id: "link-1", ends: ["a", "r1"] },
  "link-2": { id: "link-2", ends: ["r1", "r2"] },
  "link-3": { id: "link-3", ends: ["r2", "b"] },
};

const allInterfaces: (Interface & { node: NodeId })[] = [
  { ...hosts.a.iface, node: "a" },
  { ...hosts.b.iface, node: "b" },
  ...routers.r1.interfaces.map((item) => ({ ...item, node: "r1" as const })),
  ...routers.r2.interfaces.map((item) => ({ ...item, node: "r2" as const })),
];

function ipToNumber(ip: string) {
  return ip.split(".").reduce((total, part) => total * 256 + Number(part), 0);
}

function inPrefix(ip: string, prefix: string) {
  const [network, bits] = prefix.split("/");
  const size = 2 ** (32 - Number(bits));
  return Math.floor(ipToNumber(ip) / size) === Math.floor(ipToNumber(network) / size);
}

export type ForwardingDecision = { node: NodeId; destination: string; matched: string; nextHop: string; nextHopNode: NodeId; link: LinkId; outMac: string; nextMac: string };

/** Longest-prefix match on the node's table, then the neighbour on that link that owns the next-hop address. */
export function forward(node: NodeId, destination: string): ForwardingDecision {
  const table = node === "a" || node === "b" ? hosts[node].routes : routers[node].routes;
  const route = table
    .filter((item) => inPrefix(destination, item.prefix))
    .sort((left, right) => Number(right.prefix.split("/")[1]) - Number(left.prefix.split("/")[1]))[0];
  if (!route) throw new Error(`${node} has no route to ${destination}.`);
  const nextHop = route.via ?? destination;
  const neighbour = allInterfaces.find((item) => item.ip === nextHop && item.link === route.link);
  const own = allInterfaces.find((item) => item.node === node && item.link === route.link);
  if (!neighbour || !own) throw new Error(`${node} cannot resolve next hop ${nextHop} on ${route.link}.`);
  return { node, destination, matched: route.prefix, nextHop, nextHopNode: neighbour.node, link: route.link, outMac: own.mac, nextMac: neighbour.mac };
}

// ---------------------------------------------------------------- the message as bytes

export type EncodedCharacter = { index: number; char: string; codePoint: number; byteStart: number; byteCount: number };
export type EncodedByte = { index: number; value: number; charIndex: number; role: "single" | "lead" | "continuation" };
export type Encoding = { text: string; characters: EncodedCharacter[]; bytes: EncodedByte[] };

const encoder = new TextEncoder();
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** Untrusted text → a short, printable, NFC-normalized message; empty input means the default. */
export function normalizeMessage(value: unknown) {
  const text = String(value ?? "")
    .replace(LONE_SURROGATE, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .normalize("NFC")
    .trim();
  const limited = Array.from(text).slice(0, MESSAGE_MAX_CHARACTERS).join("");
  return limited || defaultJourneyConfig.message;
}

/** Actual UTF-8: one to four bytes per character (code point). */
export function encodeMessage(text: string): Encoding {
  const characters: EncodedCharacter[] = [];
  const bytes: EncodedByte[] = [];
  for (const char of text) {
    const encoded = [...encoder.encode(char)];
    characters.push({ index: characters.length, char, codePoint: char.codePointAt(0)!, byteStart: bytes.length, byteCount: encoded.length });
    encoded.forEach((value, position) => bytes.push({ index: bytes.length, value, charIndex: characters.length - 1, role: encoded.length === 1 ? "single" : position === 0 ? "lead" : "continuation" }));
  }
  return { text, characters, bytes };
}

export const bits = (value: number) => value.toString(2).padStart(8, "0");
export const hex = (value: number) => `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
export const codePointLabel = (codePoint: number) => `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

// ---------------------------------------------------------------- state

export type TcpHeader = { srcPort: number; dstPort: number; seq: number; ack: number | null; flags: string[]; headerBytes: number };
export type IpHeader = { src: string; dst: string; ttl: number; protocol: 6; headerBytes: number; totalLength: number };
export type LinkHeader = { link: LinkId; src: string; dst: string; etherType: "0x0800"; padding: number; frameBytes: number; checksum: "ok" | "corrupted" };

/** What is moving. `app` is the payload; each non-null header is one wrapper around it. */
export type Unit = {
  id: string;
  label: string;
  direction: "a-to-b" | "b-to-a";
  at: NodeId | LinkId | "path";
  level: JourneyLevel | null;
  app: number[] | null;
  tcp: TcpHeader | null;
  ip: IpHeader | null;
  link: LinkHeader | null;
  dropped: boolean;
};

export type Endpoint = {
  state: TcpConnectionState;
  /** SND.NXT: next sequence number this side will use. */
  sndNxt: number | null;
  /** SND.UNA: oldest sequence number not yet acknowledged. */
  sndUna: number | null;
  /** RCV.NXT: next sequence number expected from the other side. */
  rcvNxt: number | null;
  unacked: { start: number; end: number } | null;
  timer: "off" | "running" | "expired";
  transmissions: number;
};

export type JourneySnapshot = {
  encoded: boolean;
  a: Endpoint & { written: number };
  b: Endpoint & { buffer: number[]; read: number[]; text: string | null };
  unit: Unit | null;
};

export type JourneyEvent = {
  id: string;
  chapter: JourneyChapter;
  level: JourneyLevel;
  node: NodeId | "path";
  actor: string;
  title: string;
  narration: string;
  technical: string;
  durationMs: number;
  decision: ForwardingDecision | null;
  snapshot: JourneySnapshot;
};

export type JourneyTimeline = SimulationTimeline<JourneyEvent> & {
  config: JourneyConfig;
  encoding: Encoding;
  segments: ReturnType<typeof createSegments>;
};

export function normalizeJourneyConfig(input: Partial<Record<keyof JourneyConfig, unknown>>): JourneyConfig {
  return { message: normalizeMessage(input.message), lose: input.lose === "data" ? "data" : "none" };
}

const segmentBytes = (unit: Unit) => (unit.tcp ? unit.tcp.headerBytes + (unit.app?.length ?? 0) : 0);

function ipHeader(src: string, dst: string, unit: Unit): IpHeader {
  return { src, dst, ttl: INITIAL_TTL, protocol: 6, headerBytes: IP_HEADER, totalLength: IP_HEADER + segmentBytes(unit) };
}

function linkHeader(decision: ForwardingDecision, ip: IpHeader): LinkHeader {
  const padding = Math.max(0, ETHERNET_MIN_PAYLOAD - ip.totalLength);
  return { link: decision.link, src: decision.outMac, dst: decision.nextMac, etherType: "0x0800", padding, frameBytes: ETHERNET_HEADER + ip.totalLength + padding + ETHERNET_TRAILER, checksum: "ok" };
}

export function buildMessageJourney(input: Partial<Record<keyof JourneyConfig, unknown>>): JourneyTimeline {
  const config = normalizeJourneyConfig(input);
  const encoding = encodeMessage(config.message);
  const payload = encoding.bytes.map((item) => item.value);
  // TCP's own segmentation rule, shared with the windowed-transfer engine.
  const segments = createSegments({ payloadBytes: payload.length, mssBytes: JOURNEY_MSS, receiveWindowSegments: 1, latencyMs: 0, scenario: "normal" });
  if (segments.length !== 1) throw new Error("A chat message must fit in one segment.");
  const segment = segments[0];
  const a = hosts.a;
  const b = hosts.b;
  const closed = (): Endpoint => ({ state: "CLOSED", sndNxt: null, sndUna: null, rcvNxt: null, unacked: null, timer: "off", transmissions: 0 });

  let snapshot: JourneySnapshot = {
    encoded: false,
    a: { ...closed(), written: 0 },
    b: { ...closed(), state: "LISTEN", buffer: [], read: [], text: null },
    unit: null,
  };
  const events: JourneyEvent[] = [];

  function emit(event: Omit<JourneyEvent, "snapshot" | "durationMs" | "decision"> & { durationMs?: number; decision?: ForwardingDecision }, update?: (next: JourneySnapshot) => void) {
    const next = structuredClone(snapshot);
    update?.(next);
    snapshot = next;
    events.push({ ...event, durationMs: event.durationMs ?? 1400, decision: event.decision ?? null, snapshot: structuredClone(next) });
  }

  const control = (id: string, label: string, direction: Unit["direction"], tcp: TcpHeader): Unit => {
    const unit: Unit = { id, label, direction, at: direction === "a-to-b" ? "a" : "b", level: "transport", app: null, tcp, ip: null, link: null, dropped: false };
    return unit;
  };

  // ------------------------------------------------------------ the message
  emit({ id: "programs-ready", chapter: "message", level: "application", node: "a", actor: "You, using chat program A", title: "Two programs, one message", narration: `Program A holds the text “${encoding.text}”. Program B is running on another computer, waiting for messages on port ${b.port}.`, technical: `${a.name} ${a.iface.ip} · ${b.name} ${b.iface.ip}` });
  emit({ id: "text-encoded", chapter: "bytes", level: "application", node: "a", actor: "Program A", title: "The text becomes bytes", narration: `Program A encodes the ${encoding.characters.length} character${encoding.characters.length === 1 ? "" : "s"} with UTF-8 and gets ${payload.length} byte${payload.length === 1 ? "" : "s"}.`, technical: `UTF-8: ${payload.map(hex).join(" ")}` }, (next) => {
    next.encoded = true;
  });

  // ------------------------------------------------------------ handshake
  emit({ id: "syn-sent", chapter: "connection", level: "transport", node: "a", actor: "A's TCP", title: "A's TCP asks to connect: SYN", narration: `A's TCP chooses sequence number ${CLIENT_ISN} and sends a SYN from port ${a.port} to port ${b.port}.`, technical: "The SYN carries no message bytes but uses one sequence number." }, (next) => {
    next.a.state = "SYN-SENT";
    next.a.sndUna = CLIENT_ISN;
    next.a.sndNxt = CLIENT_ISN + 1;
    next.unit = control("syn", "SYN", "a-to-b", { srcPort: a.port, dstPort: b.port, seq: CLIENT_ISN, ack: null, flags: ["SYN"], headerBytes: TCP_HEADER });
  });
  emit({ id: "syn-in-transit", chapter: "connection", level: "network", node: "path", actor: "The network", title: "The SYN crosses the network", narration: "Like every TCP segment, the SYN travels inside an IP packet, hop by hop. Chapter 5 follows that trip in detail.", technical: `IP ${a.iface.ip} → ${b.iface.ip}`, durationMs: 1100 }, (next) => {
    const unit = next.unit!;
    unit.ip = ipHeader(a.iface.ip, b.iface.ip, unit);
    unit.at = "path";
    unit.level = null;
  });
  emit({ id: "syn-received", chapter: "connection", level: "transport", node: "b", actor: "B's TCP", title: "B's TCP records A's starting number", narration: `B's TCP accepts the SYN on port ${b.port}. It now expects A's next byte to be numbered ${CLIENT_ISN + 1}.`, technical: "LISTEN → SYN-RECEIVED" }, (next) => {
    next.b.state = "SYN-RECEIVED";
    next.b.rcvNxt = CLIENT_ISN + 1;
    Object.assign(next.unit!, { at: "b", level: "transport", ip: null });
  });
  emit({ id: "syn-ack-sent", chapter: "connection", level: "transport", node: "b", actor: "B's TCP", title: "B answers: SYN-ACK", narration: `ACK ${CLIENT_ISN + 1} confirms A's SYN. SYN with sequence ${SERVER_ISN} starts B's own numbering.`, technical: "Two flags in one segment: SYN and ACK." }, (next) => {
    next.b.sndUna = SERVER_ISN;
    next.b.sndNxt = SERVER_ISN + 1;
    next.unit = control("syn-ack", "SYN-ACK", "b-to-a", { srcPort: b.port, dstPort: a.port, seq: SERVER_ISN, ack: CLIENT_ISN + 1, flags: ["SYN", "ACK"], headerBytes: TCP_HEADER });
  });
  emit({ id: "syn-ack-in-transit", chapter: "connection", level: "network", node: "path", actor: "The network", title: "The SYN-ACK crosses back", narration: "The reply travels in its own IP packet, from B's address to A's.", technical: `IP ${b.iface.ip} → ${a.iface.ip}`, durationMs: 1100 }, (next) => {
    const unit = next.unit!;
    unit.ip = ipHeader(b.iface.ip, a.iface.ip, unit);
    unit.at = "path";
    unit.level = null;
  });
  emit({ id: "syn-ack-received", chapter: "connection", level: "transport", node: "a", actor: "A's TCP", title: "A's connection is open", narration: `A's TCP sees its SYN confirmed and records that B's next byte will be ${SERVER_ISN + 1}.`, technical: "SYN-SENT → ESTABLISHED" }, (next) => {
    next.a.state = "ESTABLISHED";
    next.a.sndUna = CLIENT_ISN + 1;
    next.a.rcvNxt = SERVER_ISN + 1;
    Object.assign(next.unit!, { at: "a", level: "transport", ip: null });
  });
  emit({ id: "ack-sent", chapter: "connection", level: "transport", node: "a", actor: "A's TCP", title: "A confirms: ACK", narration: `A's TCP sends ACK ${SERVER_ISN + 1}, confirming B's SYN.`, technical: "A pure ACK uses no sequence number." }, (next) => {
    next.unit = control("handshake-ack", "ACK", "a-to-b", { srcPort: a.port, dstPort: b.port, seq: CLIENT_ISN + 1, ack: SERVER_ISN + 1, flags: ["ACK"], headerBytes: TCP_HEADER });
  });
  emit({ id: "ack-in-transit", chapter: "connection", level: "network", node: "path", actor: "The network", title: "The ACK crosses the network", narration: "The third handshake segment travels to B.", technical: `IP ${a.iface.ip} → ${b.iface.ip}`, durationMs: 1100 }, (next) => {
    const unit = next.unit!;
    unit.ip = ipHeader(a.iface.ip, b.iface.ip, unit);
    unit.at = "path";
    unit.level = null;
  });
  emit({ id: "connection-established", chapter: "connection", level: "transport", node: "b", actor: "B's TCP", title: "Both sides are connected", narration: "B's TCP receives the ACK. Both endpoints now know each other's starting numbers.", technical: "SYN-RECEIVED → ESTABLISHED" }, (next) => {
    next.b.state = "ESTABLISHED";
    next.b.sndUna = SERVER_ISN + 1;
    next.unit = null;
  });

  // ------------------------------------------------------------ sending
  emit({ id: "program-writes", chapter: "sending", level: "application", node: "a", actor: "Program A", title: "Program A hands its bytes to TCP", narration: `Program A writes ${payload.length} bytes into its connection. From here on, TCP sees only bytes, not letters.`, technical: `write(socket, ${payload.length} bytes)` }, (next) => {
    next.a.written = payload.length;
    next.unit = { id: "data", label: "Message bytes", direction: "a-to-b", at: "a", level: "application", app: payload, tcp: null, ip: null, link: null, dropped: false };
  });
  emit({ id: "segment-built", chapter: "sending", level: "transport", node: "a", actor: "A's TCP", title: "TCP makes one segment", narration: `${payload.length} bytes fit within the ${JOURNEY_MSS}-byte maximum segment size, so TCP makes one segment numbered ${segment.seqStart}–${segment.seqEnd}.`, technical: `TCP header ${TCP_HEADER} B + ${payload.length} B data = ${TCP_HEADER + payload.length} B` }, (next) => {
    next.a.sndNxt = segment.seqEnd + 1;
    next.a.unacked = { start: segment.seqStart, end: segment.seqEnd };
    next.a.timer = "running";
    next.a.transmissions = 1;
    Object.assign(next.unit!, { label: "TCP segment", level: "transport", tcp: { srcPort: a.port, dstPort: b.port, seq: segment.seqStart, ack: SERVER_ISN + 1, flags: ["ACK", "PSH"], headerBytes: TCP_HEADER } });
  });

  /** One full trip from A's IP layer to B's link layer; `retry` compresses each router into one step. */
  function travel(prefix: string, retry: boolean) {
    const firstHop = forward("a", b.iface.ip);
    emit({ id: `${prefix}packet-built`, chapter: retry ? "recovery" : "sending", level: "network", node: "a", actor: "A's IP layer", title: retry ? "IP wraps the copy again" : "IP wraps the segment in a packet", narration: retry ? "The retransmitted segment gets a fresh IP header with the same addresses." : `IP adds the two end addresses, ${a.iface.ip} → ${b.iface.ip}. B is not on A's local network (${firstHop.matched} is the matching route), so the packet goes first to router ${firstHop.nextHop}.`, technical: `IP header ${IP_HEADER} B · TTL ${INITIAL_TTL} · protocol 6 (TCP)`, decision: firstHop }, (next) => {
      const unit = next.unit!;
      Object.assign(unit, { label: "IP packet", level: "network", ip: ipHeader(a.iface.ip, b.iface.ip, unit) });
    });
    emit({ id: `${prefix}frame-built`, chapter: retry ? "recovery" : "sending", level: "link", node: "a", actor: "A's network interface", title: retry ? "A new frame for link 1" : "The link layer wraps the packet in a frame", narration: `The frame is addressed to R1's interface (${firstHop.nextMac}), not to B: the link layer only reaches the next device on this connection.`, technical: "Ethernet header 14 B + trailer 4 B; short payloads are padded to 46 B." }, (next) => {
      const unit = next.unit!;
      Object.assign(unit, { label: "Frame", level: "link", link: linkHeader(firstHop, unit.ip!) });
    });
    emit({ id: `${prefix}on-link-1`, chapter: retry ? "recovery" : "sending", level: "link", node: "path", actor: "Link 1", title: "Signals cross link 1", narration: "The frame travels as bits on the cable between A and R1.", technical: "A ↔ R1", durationMs: 1100 }, (next) => {
      Object.assign(next.unit!, { at: "link-1", level: null });
    });
    for (const [router, link, nextLink] of [["r1", "link-1", "link-2"], ["r2", "link-2", "link-3"]] as const) {
      const decision = forward(router, b.iface.ip);
      const name = routers[router].name;
      if (retry) {
        emit({ id: `${prefix}${router}-forwards`, chapter: "recovery", level: "network", node: router, actor: `${name} · IP forwarding`, title: `${name} forwards the copy`, narration: `${name} repeats the same decision: ${decision.matched} → ${decision.nextHop}, TTL down by one.`, technical: "Routers treat a retransmission like any other packet.", decision }, (next) => {
          const unit = next.unit!;
          Object.assign(unit, { at: router, level: "network", link: null, label: "IP packet" });
          unit.ip!.ttl -= 1;
        });
      } else {
        emit({ id: `${router}-receives`, chapter: "network", level: "link", node: router, actor: `${name} · link layer`, title: `${name} receives the frame`, narration: `The frame's destination address is ${name}'s own interface and its checksum is correct, so the link layer removes the frame and passes the IP packet up.`, technical: `Arrived on ${link}` }, (next) => {
          Object.assign(next.unit!, { at: router, level: "link" });
        });
        emit({ id: `${router}-forwards`, chapter: "network", level: "network", node: router, actor: `${name} · IP forwarding`, title: `${name} chooses the next hop`, narration: `${name} reads only the destination IP, ${decision.destination}. Its best match is ${decision.matched}, so the next hop is ${decision.nextHop}. It lowers TTL by one.`, technical: "The router does not read the TCP sequence number or the message.", decision }, (next) => {
          const unit = next.unit!;
          Object.assign(unit, { level: "network", link: null, label: "IP packet" });
          unit.ip!.ttl -= 1;
        });
      }
      emit({ id: `${prefix}${router}-new-frame`, chapter: retry ? "recovery" : "network", level: "link", node: router, actor: `${name} · link layer`, title: `${name} builds a new frame`, narration: `A new frame for ${nextLink}: from ${decision.outMac} to ${decision.nextMac}. The IP addresses inside stay the same.`, technical: "Link addresses change at every hop; IP addresses do not." }, (next) => {
        const unit = next.unit!;
        Object.assign(unit, { level: "link", label: "Frame", link: linkHeader(decision, unit.ip!) });
      });
      const corrupt = !retry && config.lose === "data" && nextLink === "link-2";
      emit({ id: `${prefix}on-${nextLink}`, chapter: retry ? "recovery" : "network", level: "link", node: "path", actor: nextLink === "link-2" ? "Link 2" : "Link 3", title: corrupt ? "Noise damages the frame on link 2" : `Signals cross ${nextLink.replace("-", " ")}`, narration: corrupt ? "Interference flips some bits while the frame is on the cable." : `The frame travels to ${links[nextLink].ends[1] === "b" ? b.name : routers.r2.name}.`, technical: corrupt ? "Experiment: a single damaged frame." : `${links[nextLink].ends.join(" ↔ ").toUpperCase()}`, durationMs: 1100 }, (next) => {
        Object.assign(next.unit!, { at: nextLink, level: null });
        if (corrupt) next.unit!.link!.checksum = "corrupted";
      });
      if (corrupt) {
        emit({ id: "r2-discards", chapter: "recovery", level: "link", node: "r2", actor: "R2 · link layer", title: "R2 discards the damaged frame", narration: "R2's checksum test fails, so it drops the frame. Nobody tells A: the link layer detects damage but does not resend.", technical: "Frame check sequence mismatch → discard." }, (next) => {
          Object.assign(next.unit!, { at: "r2", level: "link", dropped: true });
        });
        return false;
      }
    }
    return true;
  }

  function receive() {
    emit({ id: "b-link", chapter: "receiving", level: "link", node: "b", actor: "B's network interface", title: "B's link layer accepts the frame", narration: `The frame is addressed to B's interface and its checksum is correct. The link layer removes the frame${snapshot.unit?.link?.padding ? ` and the ${snapshot.unit.link.padding} padding byte${snapshot.unit.link.padding === 1 ? "" : "s"}` : ""}, then passes the IP packet up.`, technical: "EtherType 0x0800 means “this is an IPv4 packet”." }, (next) => {
      Object.assign(next.unit!, { at: "b", level: "link" });
    });
    emit({ id: "b-network", chapter: "receiving", level: "network", node: "b", actor: "B's IP layer", title: "B's IP layer finds its own address", narration: `The destination ${b.iface.ip} is B's address, so IP removes its header and hands the segment to TCP (protocol 6).`, technical: `TTL on arrival: ${snapshot.unit!.ip!.ttl}` }, (next) => {
      Object.assign(next.unit!, { level: "network", link: null, label: "IP packet" });
    });
    emit({ id: "b-transport", chapter: "receiving", level: "transport", node: "b", actor: "B's TCP", title: "B's TCP checks the numbers", narration: `Port ${b.port} identifies the connection. The segment starts at ${segment.seqStart}, exactly the byte B expects, so the ${payload.length} bytes go into the receive buffer in order.`, technical: `RCV.NXT ${segment.seqStart} → ${segment.seqEnd + 1}` }, (next) => {
      Object.assign(next.unit!, { level: "transport", ip: null, label: "TCP segment" });
      next.b.rcvNxt = segment.seqEnd + 1;
      next.b.buffer = [...payload];
    });
    emit({ id: "b-acknowledges", chapter: "receiving", level: "transport", node: "b", actor: "B's TCP", title: `B's TCP sends ACK ${segment.seqEnd + 1}`, narration: `ACK ${segment.seqEnd + 1} names the next byte B expects, which confirms every byte before it.`, technical: "TCP acknowledges receipt; the program may not have read the bytes yet." }, (next) => {
      next.unit = { id: "ack", label: "ACK", direction: "b-to-a", at: "b", level: "transport", app: null, tcp: { srcPort: b.port, dstPort: a.port, seq: SERVER_ISN + 1, ack: segment.seqEnd + 1, flags: ["ACK"], headerBytes: TCP_HEADER }, ip: null, link: null, dropped: false };
    });
    emit({ id: "program-reads", chapter: "receiving", level: "application", node: "b", actor: "Program B", title: `Program B reads “${encoding.text}”`, narration: `Program B reads ${payload.length} bytes from its connection and decodes them with UTF-8.`, technical: `read(socket) → ${payload.map(hex).join(" ")}` }, (next) => {
      next.b.read = [...next.b.buffer];
      next.b.buffer = [];
      next.b.text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(next.b.read));
      if (next.unit) Object.assign(next.unit, { at: "path", level: null, ip: ipHeader(b.iface.ip, a.iface.ip, next.unit) });
    });
    emit({ id: "ack-received", chapter: "receiving", level: "transport", node: "a", actor: "A's TCP", title: "A's TCP learns the bytes arrived", narration: `ACK ${segment.seqEnd + 1} reaches A. Bytes ${segment.seqStart}–${segment.seqEnd} are confirmed, so A stops their timer and forgets its copy.`, technical: `SND.UNA ${segment.seqStart} → ${segment.seqEnd + 1}` }, (next) => {
      next.a.sndUna = segment.seqEnd + 1;
      next.a.unacked = null;
      next.a.timer = "off";
      Object.assign(next.unit!, { at: "a", level: "transport", ip: null });
    });
  }

  if (!travel("", false)) {
    emit({ id: "timer-expires", chapter: "recovery", level: "transport", node: "a", actor: "A's TCP", title: "A's retransmission timer runs out", narration: `No ACK for bytes ${segment.seqStart}–${segment.seqEnd} arrived within ${RETRANSMISSION_TIMEOUT_MS / 1000} s, so A's TCP assumes they were lost.`, technical: "B never saw the segment, so B had nothing to acknowledge." }, (next) => {
      next.a.timer = "expired";
      next.unit = null;
    });
    emit({ id: "retransmit", chapter: "recovery", level: "transport", node: "a", actor: "A's TCP", title: "A's TCP sends the same bytes again", narration: `TCP kept a copy. It resends bytes ${segment.seqStart}–${segment.seqEnd} with the same sequence number, ${segment.seqStart}.`, technical: "Recovery happens at the endpoints, not in the routers." }, (next) => {
      next.a.timer = "running";
      next.a.transmissions += 1;
      next.unit = { id: "data-retry", label: "TCP segment", direction: "a-to-b", at: "a", level: "transport", app: payload, tcp: { srcPort: a.port, dstPort: b.port, seq: segment.seqStart, ack: SERVER_ISN + 1, flags: ["ACK", "PSH"], headerBytes: TCP_HEADER }, ip: null, link: null, dropped: false };
    });
    if (!travel("retry-", true)) throw new Error("The retransmission must arrive.");
  }
  receive();
  emit({ id: "delivered", chapter: "complete", level: "application", node: "b", actor: "Both programs", title: `“${encoding.text}” arrived, in order, exactly once`, narration: "Each level did one job: the programs chose the bytes, TCP numbered and confirmed them, IP chose the route, and each link carried a frame one hop.", technical: `Data transmissions: ${snapshot.a.transmissions}` }, (next) => {
    next.unit = null;
  });

  const last = snapshot;
  if (last.b.text !== encoding.text || last.a.unacked || last.b.rcvNxt !== segment.seqEnd + 1) throw new Error("Message journey ended without exact, acknowledged delivery.");
  const timeline: JourneyTimeline = { config, encoding, segments, events, terminalEventId: "delivered" };
  assertCompleteTimeline(timeline);
  return timeline;
}
