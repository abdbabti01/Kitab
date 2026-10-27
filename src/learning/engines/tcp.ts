import { z } from "zod";
import {
  buildTcpTimeline,
  defaultTcpConfig,
  normalizeTcpConfig,
  type TcpConfig,
  type TcpTimelineEvent,
} from "../../visual-engine/engines/protocols/tcp-engine.ts";
import type { EngineAdapter, Entity, Fact } from "../types.ts";

const params = z
  .object({
    scenario: z.string().optional(),
    payloadBytes: z.unknown().optional(),
    mssBytes: z.unknown().optional(),
    receiveWindowSegments: z.unknown().optional(),
    latencyMs: z.unknown().optional(),
  })
  .strict()
  .transform((input) => {
    const config = normalizeTcpConfig({ ...defaultTcpConfig, ...(input as Partial<TcpConfig>) });
    return { ...config } as Record<string, string | number>;
  });

const locationLabels: Record<string, string> = {
  "client-application": "client application",
  "client-transport": "client TCP",
  "client-network": "client IP layer",
  "client-link": "client link layer",
  "local-network": "gateway",
  router: "router",
  internet: "internet path",
  "destination-network": "final router",
  "server-link": "server link layer",
  "server-network": "server IP layer",
  "server-transport": "server TCP",
  "server-application": "server application",
};

export type TcpFrameData = { event: TcpTimelineEvent };

function factsFor(event: TcpTimelineEvent): Fact[] {
  const s = event.snapshot;
  const facts: Fact[] = [
    { id: "client-state", label: "Client TCP state", value: s.clientState, entityId: "client" },
    { id: "server-state", label: "Server TCP state", value: s.serverState, entityId: "server" },
    { id: "receiver-next-byte", label: "Next byte expected by receiver", value: s.receiverNextByte, entityId: "server" },
    { id: "sender-acked-through", label: "Highest ACK received by sender", value: s.senderAckedThrough, entityId: "client" },
    { id: "sender-unacked", label: "Unacknowledged segments at sender", value: s.senderUnacked.length, entityId: "client" },
    { id: "sender-unacked-ids", label: "Unacknowledged segment ids", value: s.senderUnacked.join(", ") || "none", entityId: "client" },
    { id: "send-window", label: "Send window (segments)", value: s.sendWindowSegments, entityId: "client" },
    { id: "cwnd", label: "Congestion window (segments)", value: s.congestionWindowSegments, entityId: "client" },
    { id: "rwnd", label: "Receive window (segments)", value: s.receiveWindowSegments, entityId: "server" },
    { id: "contiguous-bytes", label: "Contiguous bytes delivered", value: s.completedBytes, entityId: "server" },
    { id: "transmissions", label: "Data transmissions so far", value: s.transmissions, entityId: "client" },
  ];
  if (s.packet) {
    const id = `packet-${s.packet.id}`;
    facts.push(
      { id: "packet-label", label: "Packet", value: s.packet.label, entityId: id },
      { id: "packet-location", label: "Packet location", value: locationLabels[s.packet.location] ?? s.packet.location, entityId: id },
      { id: "packet-seq", label: "Packet sequence number", value: s.packet.seq, entityId: id },
      { id: "packet-flags", label: "Packet flags", value: s.packet.flags.join(" + ") || "none", entityId: id },
    );
    if (s.packet.ack !== undefined) facts.push({ id: "packet-ack", label: "Packet acknowledgment number", value: s.packet.ack, entityId: id });
    if (s.packet.lost) facts.push({ id: "packet-lost", label: "Packet lost", value: true, entityId: id });
  }
  for (const segment of s.segments) {
    facts.push({
      id: `segment-${segment.id}`,
      label: `Segment ${segment.id} (bytes ${segment.seqStart}–${segment.seqEnd})`,
      value: `${segment.status}${segment.acked ? ", acked" : ""}`,
      entityId: `segment-${segment.id}`,
    });
  }
  return facts;
}

function entitiesFor(event: TcpTimelineEvent): Entity[] {
  const s = event.snapshot;
  return [
    { id: "client", label: "Client (Computer A)", kind: "endpoint" },
    { id: "server", label: "Server (Computer B)", kind: "endpoint" },
    ...(s.packet ? [{ id: `packet-${s.packet.id}`, label: s.packet.label, kind: "packet" }] : []),
    ...s.segments.map((segment) => ({ id: `segment-${segment.id}`, label: `Segment ${segment.id}`, kind: "segment" })),
  ];
}

export const tcpAdapter: EngineAdapter<Record<string, string | number>, TcpFrameData> = {
  id: "tcp",
  version: "2.0.0",
  title: "TCP transport",
  params: params as never,
  vocabulary: ["tcp", "ack", "acknowledg", "segment", "sequence", "byte", "window", "sender", "receiver", "packet", "retransmi", "buffer", "loss", "lost", "port", "connection", "handshake", "syn", "router", "layer", "frame", "network", "server", "client", "ip"],
  build(input) {
    const timeline = buildTcpTimeline(input as unknown as TcpConfig);
    const frames = timeline.events.map((event) => {
      const packetId = event.snapshot.packet ? `packet-${event.snapshot.packet.id}` : null;
      const segmentFocus = event.snapshot.packet?.segmentId ? [`segment-${event.snapshot.packet.segmentId}`] : [];
      return {
        id: event.id,
        title: event.title,
        narration: event.explanation,
        technical: event.technical,
        chapter: event.chapterId,
        facts: factsFor(event),
        focus: [...(packetId ? [packetId] : []), ...segmentFocus],
        entities: entitiesFor(event),
        durationMs: event.durationMs,
        invariant: "The sender never has more unacknowledged segments than the send window; ACKs name the next contiguous byte.",
        data: { event },
      };
    });
    const events = timeline.events;
    const segments = events[0].snapshot.segments;
    const duplicate = events.find((event) => event.id.endsWith("-duplicate-created"));
    const atDuplicate = duplicate?.snapshot.segments ?? [];
    const buffered = atDuplicate.filter((segment) => segment.status === "buffered");
    const last = events.at(-1)!.snapshot;
    const outcome = {
      scenario: timeline.config.scenario,
      segmentCount: segments.length,
      transmissions: last.transmissions,
      maxUnacked: Math.max(...events.map((event) => event.snapshot.senderUnacked.length)),
      finalAck: last.senderAckedThrough,
      duplicateAck: duplicate?.snapshot.packet?.ack ?? 0,
      gapStart: segments[1]?.seqStart ?? 0,
      thirdSegmentStart: segments[2]?.seqStart ?? 0,
      afterBuffered: buffered.length ? buffered.at(-1)!.seqEnd + 1 : 0,
      duplicateAckFrame: duplicate?.id ?? "",
      lastFrame: events.at(-1)!.id,
    };
    return {
      frames,
      outcome,
      outcomeLabels: {
        scenario: "Network scenario",
        segmentCount: "Segments in the byte stream",
        transmissions: "Data transmissions including retransmissions",
        maxUnacked: "Most unacknowledged segments at once",
        finalAck: "Final cumulative ACK",
        duplicateAck: "ACK sent while a gap remained",
      },
      diagnostics: timeline.config.scenario !== input.scenario ? [`Scenario "${input.scenario}" needs more segments or a larger window; ran "normal".`] : [],
    };
  },
  checkClaims(text, facts) {
    const problems: string[] = [];
    const ackValues = new Set(facts.filter((fact) => /ack|next-byte|acked/.test(fact.id)).map((fact) => String(fact.value)));
    for (const match of text.matchAll(/\bACK(?:\s+(?:number|of|=))?\s*(\d{3,6})\b/gi)) {
      if (!ackValues.has(match[1])) problems.push(`ACK ${match[1]} does not appear in the trace facts.`);
    }
    if (/\bretransmit\w*\s+(?:all|every|the (?:entire|whole)|everything)/i.test(text) || /\b(?:restart|resend)s?\s+the (?:entire|whole) (?:request|stream)/i.test(text)) {
      problems.push("Claims TCP resends everything; it retransmits only the missing range.");
    }
    if (/\brouters?\b[^.]{0,40}\bretransmit/i.test(text)) problems.push("Claims routers retransmit TCP data; recovery is end-to-end.");
    if (/\b(?:ack|acknowledg\w*)\b[^.]{0,40}\b(?:counts?|number|tally)\b[^.]{0,20}\b(?:packets|segments)\b/i.test(text) || /\bACK\b[^.]{0,30}\bpackets? (?:arrived|received)\b/i.test(text)) {
      problems.push("Claims an ACK counts packets; it names the next expected byte.");
    }
    return problems;
  },
};
