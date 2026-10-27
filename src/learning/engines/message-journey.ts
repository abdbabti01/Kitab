import { z } from "zod";
import {
  bits,
  buildMessageJourney,
  codePointLabel,
  hex,
  hosts,
  links,
  normalizeJourneyConfig,
  routers,
  type Encoding,
  type JourneyEvent,
  type JourneyTimeline,
  type NodeId,
  type Unit,
} from "../../visual-engine/engines/protocols/message-journey.ts";
import type { EngineAdapter, Entity, Fact, Trace } from "../types.ts";
import { normalizeNumberWords } from "../claims.ts";

const params = z
  .object({ message: z.unknown().optional(), lose: z.unknown().optional() })
  .strict()
  .transform((input) => {
    const config = normalizeJourneyConfig(input);
    return { message: config.message, lose: config.lose } as Record<string, string>;
  });

export type MessageJourneyData = { event: JourneyEvent; encoding: Encoding };

const nodeName: Record<NodeId, string> = { a: "Computer A", r1: routers.r1.name, r2: routers.r2.name, b: "Computer B" };
const owner = (mac: string) => (Object.entries({ a: [hosts.a.iface.mac], b: [hosts.b.iface.mac], r1: routers.r1.interfaces.map((item) => item.mac), r2: routers.r2.interfaces.map((item) => item.mac) }).find(([, macs]) => macs.includes(mac))?.[0] ?? "a") as NodeId;
const side = (port: number) => (port === hosts.a.port ? "A" : "B");

/** Kind of the moving unit: named by its outermost wrapper. */
export function unitKind(unit: Unit) {
  return unit.link ? "frame" : unit.ip ? "packet" : unit.tcp ? "segment" : "message-bytes";
}

function placeLabel(unit: Unit) {
  if (unit.at === "path") return "crossing the network";
  if (unit.at.startsWith("link-")) return `on ${unit.at.replace("-", " ")} (${links[unit.at as keyof typeof links].ends.map((end) => end.toUpperCase()).join(" ↔ ")})`;
  return `${nodeName[unit.at as NodeId]}, ${unit.level} level`;
}

function unitFacts(unit: Unit): Fact[] {
  const id = `unit-${unit.id}`;
  const facts: Fact[] = [
    { id: "unit-kind", label: "What is moving", value: unit.label, entityId: id },
    { id: "unit-location", label: "Where it is", value: placeLabel(unit), entityId: id },
  ];
  if (unit.app) facts.push({ id: "unit-data", label: "Message bytes carried", value: unit.app.length, entityId: id });
  if (unit.link) facts.push({ id: "unit-size", label: "Total size on the wire", value: `${unit.link.frameBytes} bytes`, entityId: id });
  else if (unit.ip) facts.push({ id: "unit-size", label: "Total size", value: `${unit.ip.totalLength} bytes`, entityId: id });
  else if (unit.tcp) facts.push({ id: "unit-size", label: "Total size", value: `${unit.tcp.headerBytes + (unit.app?.length ?? 0)} bytes`, entityId: id });
  if (unit.dropped) facts.push({ id: "unit-dropped", label: "Discarded", value: true, entityId: id });
  if (unit.tcp) {
    const t = unit.tcp;
    facts.push(
      { id: "tcp-src-port", label: "Source port", value: t.srcPort, entityId: "hdr-tcp" },
      { id: "tcp-dst-port", label: "Destination port", value: t.dstPort, entityId: "hdr-tcp" },
      { id: "tcp-seq", label: "Sequence number", value: t.seq, entityId: "hdr-tcp" },
      { id: "tcp-ack", label: "Acknowledgment number", value: t.ack ?? "not used", entityId: "hdr-tcp" },
      { id: "tcp-flags", label: "Flags", value: t.flags.join(" + "), entityId: "hdr-tcp" },
      { id: "tcp-header-bytes", label: "TCP header size", value: `${t.headerBytes} bytes`, entityId: "hdr-tcp" },
    );
  }
  if (unit.ip) {
    const i = unit.ip;
    facts.push(
      { id: "ip-src", label: "Source IP address", value: i.src, entityId: "hdr-ip" },
      { id: "ip-dst", label: "Destination IP address", value: i.dst, entityId: "hdr-ip" },
      { id: "ip-ttl", label: "Time to live (TTL)", value: i.ttl, entityId: "hdr-ip" },
      { id: "ip-protocol", label: "Protocol", value: "6 (TCP)", entityId: "hdr-ip" },
      { id: "ip-length", label: "Packet length", value: `${i.totalLength} bytes`, entityId: "hdr-ip" },
    );
  }
  if (unit.link) {
    const l = unit.link;
    facts.push(
      { id: "link-src", label: "Source link address (MAC)", value: l.src, entityId: "hdr-link" },
      { id: "link-dst", label: "Destination link address (MAC)", value: l.dst, entityId: "hdr-link" },
      { id: "link-type", label: "Carries", value: `${l.etherType} (IPv4)`, entityId: "hdr-link" },
      { id: "link-padding", label: "Padding bytes", value: l.padding, entityId: "hdr-link" },
      { id: "link-checksum", label: "Frame checksum", value: l.checksum === "ok" ? "matches" : "fails (damaged)", entityId: "hdr-link" },
      { id: "link-which", label: "For link", value: l.link.replace("-", " "), entityId: "hdr-link" },
    );
  }
  return facts;
}

function factsFor(event: JourneyEvent, encoding: Encoding, firstSeq: number): Fact[] {
  const s = event.snapshot;
  const facts: Fact[] = [
    { id: "message-text", label: "Message text", value: encoding.text, entityId: "program-a" },
    { id: "message-characters", label: "Characters", value: encoding.characters.length, entityId: "program-a" },
  ];
  if (s.encoded) {
    facts.push(
      { id: "message-bytes", label: "UTF-8 bytes", value: encoding.bytes.length, entityId: "program-a" },
      { id: "message-byte-values", label: "Byte values", value: encoding.bytes.map((item) => item.value).join(" "), entityId: "program-a" },
    );
  }
  facts.push({ id: "program-a-written", label: "Bytes handed to TCP", value: s.a.written, entityId: "program-a" });
  for (const char of encoding.characters) {
    const entityId = `char-${char.index}`;
    facts.push(
      { id: entityId, label: "Character", value: char.char, entityId },
      { id: `${entityId}-code`, label: "Unicode code point", value: codePointLabel(char.codePoint), entityId },
    );
    if (s.encoded) {
      const values = encoding.bytes.slice(char.byteStart, char.byteStart + char.byteCount).map((item) => item.value);
      facts.push(
        { id: `${entityId}-byte-count`, label: "UTF-8 bytes for it", value: char.byteCount, entityId },
        { id: `${entityId}-bytes`, label: "Byte values", value: values.join(" "), entityId },
      );
    }
  }
  if (s.encoded) {
    for (const item of encoding.bytes) {
      const entityId = `byte-${item.index}`;
      const char = encoding.characters[item.charIndex];
      facts.push(
        { id: entityId, label: "Value (decimal)", value: item.value, entityId },
        { id: `${entityId}-hex`, label: "Hexadecimal", value: hex(item.value), entityId },
        { id: `${entityId}-bits`, label: "Eight bits", value: bits(item.value), entityId },
        { id: `${entityId}-char`, label: "Encodes", value: char.byteCount === 1 ? `“${char.char}”` : `“${char.char}” (byte ${item.index - char.byteStart + 1} of ${char.byteCount})`, entityId },
      );
      if (s.a.transmissions > 0) facts.push({ id: `${entityId}-seq`, label: "TCP sequence number", value: firstSeq + item.index, entityId });
    }
  }
  for (const [key, endpoint] of [["a", s.a], ["b", s.b]] as const) {
    const entityId = `endpoint-${key}`;
    const host = hosts[key];
    facts.push(
      { id: `${key}-state`, label: "TCP connection state", value: endpoint.state, entityId },
      { id: `${key}-port`, label: "Port", value: host.port, entityId },
      { id: `${key}-ip`, label: "IP address", value: host.iface.ip, entityId },
      { id: `${key}-mac`, label: "Link address (MAC)", value: host.iface.mac, entityId },
      { id: `${key}-snd-nxt`, label: "Next sequence number to send", value: endpoint.sndNxt ?? "not chosen yet", entityId },
      { id: `${key}-rcv-nxt`, label: "Next byte expected from the other side", value: endpoint.rcvNxt ?? "unknown yet", entityId },
    );
  }
  facts.push(
    { id: "a-unacked", label: "Sent but not yet acknowledged", value: s.a.unacked ? `bytes ${s.a.unacked.start}–${s.a.unacked.end}` : "none", entityId: "endpoint-a" },
    { id: "a-timer", label: "Retransmission timer", value: s.a.timer, entityId: "endpoint-a" },
    { id: "a-transmissions", label: "Times the data was sent", value: s.a.transmissions, entityId: "endpoint-a" },
    { id: "b-buffer", label: "Bytes waiting for program B", value: s.b.buffer.length, entityId: "endpoint-b" },
    { id: "program-b-read", label: "Text program B has read", value: s.b.text ?? "nothing yet", entityId: "program-b" },
  );
  for (const router of Object.values(routers)) {
    facts.push(
      { id: `${router.id}-interfaces`, label: "Interfaces", value: router.interfaces.map((item) => `${item.link.replace("-", " ")}: ${item.ip} / ${item.mac}`).join(" · "), entityId: router.id },
      { id: `${router.id}-routes`, label: "Forwarding table", value: router.routes.map((route) => `${route.prefix} → ${route.via ?? "deliver directly"} (${route.link.replace("-", " ")})`).join(" · "), entityId: router.id },
    );
  }
  for (const link of Object.values(links)) facts.push({ id: `${link.id}-ends`, label: "Connects", value: link.ends.map((end) => nodeName[end]).join(" ↔ "), entityId: link.id });
  if (event.decision) {
    const d = event.decision;
    const entityId = d.node === "a" || d.node === "b" ? `endpoint-${d.node}` : d.node;
    facts.push(
      { id: "decision-destination", label: "Destination looked up", value: d.destination, entityId },
      { id: "decision-matched", label: "Best matching route", value: d.matched, entityId },
      { id: "decision-next-hop", label: "Next hop", value: `${d.nextHop} (${nodeName[d.nextHopNode]})`, entityId },
      { id: "decision-link", label: "Out through", value: d.link.replace("-", " "), entityId },
    );
  }
  if (s.unit) facts.push(...unitFacts(s.unit));
  return facts;
}

function entitiesFor(event: JourneyEvent, encoding: Encoding): Entity[] {
  const s = event.snapshot;
  const entities: Entity[] = [
    { id: "program-a", label: "Chat program A", kind: "program", origin: "Running on Computer A; you typed the message here." },
    { id: "program-b", label: "Chat program B", kind: "program", origin: `Running on Computer B; it opened port ${hosts.b.port} to receive messages.` },
    ...encoding.characters.map((char) => ({ id: `char-${char.index}`, label: `Character “${char.char}”`, kind: "character", origin: "Typed into program A." })),
    { id: "endpoint-a", label: "A's TCP", kind: "endpoint", origin: "Part of Computer A's operating system, serving program A." },
    { id: "endpoint-b", label: "B's TCP", kind: "endpoint", origin: "Part of Computer B's operating system, serving program B." },
    ...Object.values(routers).map((router) => ({ id: router.id, label: router.name, kind: "router", origin: `Part of this example's network; its forwarding table (${router.routes.length} routes) was set up by the network's operator.` })),
    ...Object.values(links).map((link) => ({ id: link.id, label: `Link ${link.id.at(-1)}`, kind: "link", origin: `A cable between ${link.ends.map((end) => nodeName[end]).join(" and ")}.` })),
  ];
  if (s.encoded) {
    entities.push(...encoding.bytes.map((item) => {
      const char = encoding.characters[item.charIndex];
      return { id: `byte-${item.index}`, label: `Byte ${item.index + 1} (${item.value})`, kind: "byte", origin: char.byteCount === 1 ? `UTF-8 encoding of “${char.char}”.` : `Byte ${item.index - char.byteStart + 1} of the ${char.byteCount}-byte UTF-8 encoding of “${char.char}”.` };
    }));
  }
  const unit = s.unit;
  if (unit) {
    const from = unit.direction === "a-to-b" ? "A" : "B";
    const kind = unitKind(unit);
    const origin = {
      frame: `Framed by ${nodeName[owner(unit.link?.src ?? "")]}'s link layer for ${unit.link?.link.replace("-", " ")}.`,
      packet: `IP header added by ${from}'s IP layer.`,
      segment: `Built by ${from}'s TCP${unit.app ? " from program A's bytes" : ""}.`,
      "message-bytes": "Program A's encoded message, handed to TCP.",
    }[kind];
    entities.push({ id: `unit-${unit.id}`, label: unit.label, kind, origin });
    if (unit.tcp) entities.push({ id: "hdr-tcp", label: "TCP header", kind: "tcp-header", origin: `Added by ${side(unit.tcp.srcPort)}'s TCP.` });
    if (unit.ip) entities.push({ id: "hdr-ip", label: "IP header", kind: "ip-header", origin: `Added by ${unit.ip.src === hosts.a.iface.ip ? "A" : "B"}'s IP layer; routers only lower its TTL.` });
    if (unit.link) entities.push({ id: "hdr-link", label: "Link header", kind: "link-header", origin: `Added by ${nodeName[owner(unit.link.src)]}'s link layer; replaced at every hop.` });
  }
  return entities;
}

function focusFor(event: JourneyEvent) {
  const s = event.snapshot;
  if (s.unit) return [`unit-${s.unit.id}`];
  if (event.node === "a" || event.node === "b") return [`endpoint-${event.node}`];
  return [];
}

const ACK_CLAIM = /\bACK(?:\s+(?:number|of|=|is))?\s*(\d{2,6})\b/gi;
/** "TTL 61", "TTL is now 61", "TTL = 61", "TTL drops to 61"; not "lowers the TTL by one". */
const TTL_CLAIM = /\bTTL\b(?:\s*(?:=|:|\bis\b|\bwas\b|\bof\b|\bnow\b|\bbecomes\b|\bdrops to\b|\bfalls to\b|\bto\b|\bat\b))*\s*(\d{1,3})\b/gi;

/**
 * Supported claim shapes only: ACK numbers, TTL values, per-letter packets, router retransmission, routers reading TCP.
 * ACK and TTL values are checked against the facts of the current (and previous) step, not the whole run:
 * "TTL is now 64" is wrong at R1 even though 64 appears earlier in the trip.
 */
function journeyClaims(text: string, facts: Fact[], trace: Trace<MessageJourneyData>): string[] {
  const problems: string[] = [];
  const plain = normalizeNumberWords(text);
  const values = (id: RegExp) => new Set(facts.filter((fact) => id.test(fact.id)).map((fact) => String(fact.value)));
  const acks = values(/^tcp-ack$|-rcv-nxt$/);
  const ttls = values(/^ip-ttl$/);
  for (const match of plain.matchAll(ACK_CLAIM)) if (!acks.has(match[1])) problems.push(`ACK ${match[1]} is not an acknowledgment at this step.`);
  for (const match of plain.matchAll(TTL_CLAIM)) if (!ttls.has(match[1])) problems.push(`TTL ${match[1]} is not the TTL at this step.`);
  if (/\b(?:each|every)\s+(?:letter|character)\b[^.]{0,40}\b(?:own|separate|its own)\s+(?:packet|segment|frame)/i.test(text) || /\b(?:\d+|one)\s+(?:packets|segments)\s*,?\s+one\s+(?:per|for each)\s+(?:letter|character)/i.test(plain)) {
    problems.push(`Claims each letter travels separately; the engine made ${trace.outcome.segments} segment.`);
  }
  if (/\brouters?\b[^.]{0,40}\b(?:retransmit|resend)/i.test(text)) problems.push("Claims routers resend data; only A's TCP retransmits.");
  if (/\brouters?\b[^.]{0,30}\b(?:reads?|checks?|changes?|uses?|looks? at)\b[^.]{0,30}\b(?:sequence number|port|TCP header|the message|HELLO)/i.test(text) && !/\b(?:not|never|n't|without)\b/i.test(text)) {
    problems.push("Claims a router reads TCP or the message; routers use the destination IP address.");
  }
  return problems;
}

export const messageJourneyAdapter: EngineAdapter<Record<string, string>, MessageJourneyData> = {
  id: "message-journey",
  version: "1.0.0",
  title: "A message across a network",
  params: params as never,
  vocabulary: ["byte", "bit", "utf-8", "encod", "character", "letter", "tcp", "segment", "sequence", "ack", "acknowledg", "port", "connection", "handshake", "syn", "ip", "address", "packet", "router", "forward", "hop", "ttl", "link", "frame", "mac", "checksum", "program", "message", "network", "layer", "level", "header", "timer", "retransmi"],
  checkClaims: (text, facts, trace) => journeyClaims(text, facts, trace as Trace<MessageJourneyData>),
  build(input) {
    const timeline: JourneyTimeline = buildMessageJourney(input);
    const { encoding } = timeline;
    const frames = timeline.events.map((event) => ({
      id: event.id,
      title: event.title,
      narration: event.narration,
      technical: event.technical,
      chapter: event.chapter,
      level: event.level,
      actor: event.actor,
      facts: factsFor(event, encoding, timeline.segments[0].seqStart),
      focus: focusFor(event),
      entities: entitiesFor(event, encoding),
      durationMs: event.durationMs,
      invariant: "Endpoints run TCP; routers forward by destination IP; each link carries one frame one hop.",
      data: { event, encoding },
    }));
    const last = timeline.events.at(-1)!.snapshot;
    const arrival = timeline.events.find((event) => event.id === "b-link")!.snapshot.unit!;
    const firstFrame = timeline.events.find((event) => event.id === "frame-built")!.snapshot.unit!;
    return {
      frames,
      outcome: {
        message: encoding.text,
        characters: encoding.characters.length,
        bytes: encoding.bytes.length,
        segments: timeline.segments.length,
        firstSeq: timeline.segments[0].seqStart,
        finalAck: last.a.sndUna ?? 0,
        transmissions: last.a.transmissions,
        delivered: last.b.text ?? "",
        ttlAtArrival: arrival.ip!.ttl,
        frameBytes: firstFrame.link!.frameBytes,
        padding: firstFrame.link!.padding,
        routers: Object.keys(routers).length,
        lost: timeline.config.lose === "data",
        lastFrame: timeline.terminalEventId,
      },
      outcomeLabels: {
        message: "Message",
        bytes: "UTF-8 bytes",
        segments: "TCP segments",
        finalAck: "Final acknowledgment",
        transmissions: "Times the data was sent",
        delivered: "Text program B read",
        ttlAtArrival: "TTL when the packet reached B",
        frameBytes: "First frame size",
      },
    };
  },
};
