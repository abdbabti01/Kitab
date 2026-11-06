import { z } from "zod";
import capture from "../../content/packet-journey/trace.json" with { type: "json" };
import { normalizeNumberWords } from "../claims.ts";
import type { EngineAdapter, Entity, Fact, FrameDraft } from "../types.ts";

export const packetChapters = [
  { id: "server-setup", title: "Server setup", goal: "Find out where a server listens and how an incoming connection reaches its app.", terms: ["socket", "port"] },
  { id: "handshake", title: "TCP handshake", goal: "Watch the client and server agree on starting sequence numbers before sending HTTP bytes.", terms: ["syn", "ack"] },
  { id: "http-request", title: "HTTP request", goal: "Follow the request as TCP splits it, IPv4 wraps it and the server unwraps it.", terms: ["segment", "packet", "ttl"] },
  { id: "http-response", title: "HTTP response", goal: "Follow the reply through the same network in the other direction.", terms: ["sequence", "payload"] },
  { id: "display", title: "Display the reply", goal: "See how the browser reads the reassembled bytes and displays the body.", terms: ["http", "buffer"] },
];

const device = z.enum(["Client", "Router", "Server"]);
const wireSchema = z.object({
  flags: z.string().optional(), payload: z.string().optional(), payloadLength: z.number().optional(),
  from: device.optional(), to: device.optional(), sourcePort: z.number().optional(),
  destinationPort: z.number().optional(), sequence: z.number().optional(), ack: z.number().optional(),
  packetLength: z.number().optional(), ttl: z.number().optional(), nextHop: z.string().optional(),
  sourceIp: z.string().optional(), destinationIp: z.string().optional(), unwrapped: z.boolean().optional(),
});
const eventSchema = z.object({
  phase: z.number().int().min(0).max(packetChapters.length - 1),
  side: device, actor: z.string(), layer: z.enum(["HTTP", "Socket", "Kernel", "TCP", "IPv4"]),
  title: z.string(), what: z.string(), why: z.string(), raw: z.string(),
  method: z.string(), source: z.string(), line: z.number().int().positive(),
  state: z.object({ Client: z.string(), Server: z.string() }), wire: wireSchema,
});
const recording = z.object({
  messages: z.object({ Client: z.string(), Server: z.string() }),
  events: z.array(eventSchema).min(2),
}).parse(capture);
type RecordedEvent = z.infer<typeof eventSchema>;

export type PacketJourneyData = {
  event: RecordedEvent;
  location: string;
  payload: string;
  showTcp: boolean;
  showIp: boolean;
};

const layers = { HTTP: "application", Socket: "socket", Kernel: "socket", TCP: "transport", IPv4: "network" };
const encoder = new TextEncoder();
const byteCount = (message: string) => encoder.encode(message).length;

function applicationBytes(event: RecordedEvent) {
  switch (event.title) {
    case "Build the HTTP request": return recording.messages.Client;
    case "Build the HTTP response":
    case "Read the HTTP response":
    case "Display the response body": return recording.messages.Server;
    case "Hand app bytes to TCP": return event.side === "Server" ? recording.messages.Server : recording.messages.Client;
    case "Read the HTTP request":
    case "Ask for buffered bytes":
    case "Copy bytes into the app": return event.side === "Server" ? recording.messages.Client : recording.messages.Server;
    default: return "";
  }
}

function locationFor(event: RecordedEvent) {
  if (event.side === "Router") return event.title === "Look up the next hop" ? "Routing table" : "IPv4 forwarding";
  if (event.layer === "HTTP") return event.side === "Client" ? "Browser" : "HTTP server app";
  if (event.layer === "Kernel" || event.method === "SimulatedNetwork.StartListening()") return "OS socket tables";
  if (event.layer === "Socket") return "Socket API";
  return event.layer === "TCP" ? "OS TCP" : "OS IPv4";
}

function frameFor(event: RecordedEvent, index: number): FrameDraft<PacketJourneyData> {
  const wire = event.wire;
  const location = locationFor(event);
  const payload = wire.flags ? wire.payload ?? "" : applicationBytes(event);
  const showTcp = Boolean(wire.flags) && event.title !== "Buffer the received bytes";
  const showIp = showTcp && wire.packetLength !== undefined && !wire.unwrapped;
  const deviceId = event.side.toLowerCase();
  const entities: Entity[] = [
    { id: "client", label: "Client PC", kind: "device", origin: "Runs the browser and the client network stack." },
    { id: "router", label: "Router", kind: "device", origin: "Forwards IPv4 packets between the client and server." },
    { id: "server", label: "Server PC", kind: "device", origin: "Runs the HTTP server and the server network stack." },
  ];
  const facts: Fact[] = [
    { id: "location", label: "Active part", value: location, entityId: deviceId },
    { id: "client-state", label: "Client TCP state", value: event.state.Client, entityId: "client" },
    { id: "server-state", label: "Server TCP state", value: event.state.Server, entityId: "server" },
    { id: "reason", label: "Why this happens", value: event.why },
  ];
  function add(id: string, label: string, value: Fact["value"] | undefined, entityId: string) {
    if (value !== undefined) facts.push({ id, label, value, entityId });
  }
  if (payload || showTcp) {
    entities.push({ id: "http-bytes", label: payload ? "HTTP bytes" : "Empty payload", kind: "payload" });
    add("payload-length", "HTTP bytes", byteCount(payload), "http-bytes");
    if (payload) add("payload-text", "Text", payload, "http-bytes");
  }
  if (showTcp) {
    entities.push({ id: "tcp-header", label: "TCP header", kind: "tcp-header" });
    add("tcp-ports", "Source → destination port", wire.sourcePort + " → " + wire.destinationPort, "tcp-header");
    add("tcp-flags", "TCP flags", wire.flags, "tcp-header");
    add("tcp-seq", "TCP sequence number", wire.sequence, "tcp-header");
    if (wire.flags?.includes("ACK")) add("tcp-ack", "TCP acknowledgment number", wire.ack, "tcp-header");
    add("tcp-length", "TCP segment bytes", 20 + byteCount(payload), "tcp-header");
  }
  if (showIp) {
    entities.push({ id: "ip-header", label: "IPv4 header", kind: "ip-header" });
    add("ip-source", "Source IP", wire.sourceIp, "ip-header");
    add("ip-destination", "Destination IP", wire.destinationIp, "ip-header");
    add("ip-ttl", "Time to live (TTL)", wire.ttl, "ip-header");
    add("ip-length", "IPv4 packet bytes", wire.packetLength, "ip-header");
  }
  add("next-hop", "Next hop", wire.nextHop, deviceId);
  const focus = event.title === "Wrap the segment in IPv4" ? "ip-header"
    : event.title === "Create a TCP segment" || event.title === "Hand the segment to TCP" ? "tcp-header"
    : payload && !showTcp ? "http-bytes"
    : deviceId;
  return {
    id: "event-" + String(index + 1).padStart(3, "0"),
    title: event.title, narration: event.what, chapter: packetChapters[event.phase].id,
    level: layers[event.layer], actor: event.actor, facts, entities, focus: [focus], durationMs: 900,
    data: { event, location, payload, showTcp, showIp },
  };
}

export const packetJourneyAdapter: EngineAdapter<Record<string, never>, PacketJourneyData> = {
  id: "packet-journey", version: "1.0.0", title: "Packet Journey",
  params: z.object({}).strict(),
  vocabulary: ["http", "tcp", "ip", "socket", "browser", "server", "client", "router", "header", "packet", "segment", "syn", "ack", "ttl", "hop", "sequence", "port", "byte", "buffer", "handshake", "connection", "forward", "request", "response"],
  build() {
    const [headers, body] = recording.messages.Server.split("\r\n\r\n");
    return {
      frames: recording.events.map(frameFor),
      outcome: {
        status: headers.split("\r\n")[0], body,
        requestBytes: byteCount(recording.messages.Client), responseBytes: byteCount(recording.messages.Server),
      },
      outcomeLabels: { status: "HTTP status", body: "Response body", requestBytes: "Request bytes", responseBytes: "Response bytes" },
    };
  },
  checkClaims(text, facts) {
    const normalized = normalizeNumberWords(text);
    const problems: string[] = [];
    for (const [id, name, pattern] of [
      ["ip-ttl", "TTL", /\bTTL\b(?:\s*(?:=|:|is|now|drops to|falls to))*\s*(\d{1,3})\b/gi],
      ["tcp-ack", "ACK", /\bACK(?:\s+(?:number|of|=|is))?\s*(\d{2,6})\b/gi],
    ] as const) {
      for (const [, value] of normalized.matchAll(pattern)) {
        if (!facts.some((fact) => fact.id === id && String(fact.value) === value))
          problems.push(`${name} ${value} does not match this step.`);
      }
    }
    if (/\brouters?\b[^.]{0,40}\b(?:retransmits?|resends?)\b/i.test(normalized))
      problems.push("Retransmission is an endpoint TCP responsibility.");
    return problems;
  },
};
