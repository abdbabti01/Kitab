import {
  assertCompleteTimeline,
  type SimulationTimeline,
} from "../../core/simulation.ts";

export type TcpScenario = "normal" | "loss" | "reorder";
export type TcpConnectionState =
  | "CLOSED"
  | "LISTEN"
  | "SYN-SENT"
  | "SYN-RECEIVED"
  | "ESTABLISHED";

export type TcpLocation =
  | "none"
  | "client-application"
  | "client-transport"
  | "client-network"
  | "client-link"
  | "local-network"
  | "router"
  | "internet"
  | "destination-network"
  | "server-link"
  | "server-network"
  | "server-transport"
  | "server-application";

export type TcpWrapper = "application" | "tcp" | "ip" | "link";
export type TcpSegmentStatus =
  | "waiting"
  | "in-flight"
  | "buffered"
  | "delivered"
  | "lost"
  | "retransmitted";

export type TcpConfig = {
  payloadBytes: number;
  mssBytes: number;
  receiveWindowSegments: number;
  latencyMs: number;
  scenario: TcpScenario;
};

export type TcpSegment = {
  id: number;
  seqStart: number;
  seqEnd: number;
  length: number;
  status: TcpSegmentStatus;
};

export type TcpPacket = {
  id: string;
  label: string;
  kind: "control" | "data" | "ack";
  direction: "client-to-server" | "server-to-client";
  location: TcpLocation;
  flags: string[];
  seq: number;
  ack?: number;
  payloadBytes: number;
  wrappers: TcpWrapper[];
  segmentId?: number;
  lost?: boolean;
};

export type TcpSnapshot = {
  clientState: TcpConnectionState;
  serverState: TcpConnectionState;
  clientNextSeq: number;
  serverNextSeq: number;
  receiverNextByte: number;
  receiveWindowSegments: number;
  congestionWindowSegments: number;
  sendWindowSegments: number;
  packet: TcpPacket | null;
  segments: TcpSegment[];
  completedBytes: number;
};

export type TcpEventKind =
  | "orientation"
  | "encapsulation"
  | "transfer"
  | "state"
  | "recovery"
  | "complete";

export type TcpTimelineEvent = {
  id: string;
  chapterId:
    | "orient"
    | "handshake"
    | "encapsulate"
    | "deliver"
    | "reliability"
    | "finish";
  kind: TcpEventKind;
  title: string;
  explanation: string;
  technical: string;
  durationMs: number;
  checkpointId?: string;
  snapshot: TcpSnapshot;
};

export type TcpTimeline = SimulationTimeline<TcpTimelineEvent> & {
  config: TcpConfig;
};

const CLIENT_ISN = 1000;
const SERVER_ISN = 5000;

export const defaultTcpConfig: TcpConfig = {
  payloadBytes: 3500,
  mssBytes: 1460,
  receiveWindowSegments: 3,
  latencyMs: 45,
  scenario: "normal",
};

export function normalizeTcpConfig(config: TcpConfig): TcpConfig {
  return {
    payloadBytes: Math.round(Math.max(500, Math.min(8000, config.payloadBytes))),
    mssBytes: [536, 1200, 1460].includes(config.mssBytes)
      ? config.mssBytes
      : 1460,
    receiveWindowSegments: Math.round(
      Math.max(1, Math.min(6, config.receiveWindowSegments)),
    ),
    latencyMs: Math.round(Math.max(5, Math.min(300, config.latencyMs))),
    scenario: ["normal", "loss", "reorder"].includes(config.scenario)
      ? config.scenario
      : "normal",
  };
}

export function createSegments(config: TcpConfig): TcpSegment[] {
  const count = Math.ceil(config.payloadBytes / config.mssBytes);
  return Array.from({ length: count }, (_, index) => {
    const length = Math.min(
      config.mssBytes,
      config.payloadBytes - index * config.mssBytes,
    );
    const seqStart = CLIENT_ISN + 1 + index * config.mssBytes;
    return {
      id: index + 1,
      seqStart,
      seqEnd: seqStart + length - 1,
      length,
      status: "waiting" as const,
    };
  });
}

function cloneSnapshot(snapshot: TcpSnapshot): TcpSnapshot {
  return {
    ...snapshot,
    packet: snapshot.packet
      ? {
          ...snapshot.packet,
          flags: [...snapshot.packet.flags],
          wrappers: [...snapshot.packet.wrappers],
        }
      : null,
    segments: snapshot.segments.map((segment) => ({ ...segment })),
  };
}

function packet(
  id: string,
  label: string,
  kind: TcpPacket["kind"],
  direction: TcpPacket["direction"],
  location: TcpLocation,
  flags: string[],
  seq: number,
  ack: number | undefined,
  wrappers: TcpWrapper[],
  payloadBytes = 0,
  segmentId?: number,
): TcpPacket {
  return {
    id,
    label,
    kind,
    direction,
    location,
    flags,
    seq,
    ack,
    wrappers,
    payloadBytes,
    segmentId,
  };
}

function transferDuration(config: TcpConfig) {
  return Math.max(700, Math.min(1800, 650 + config.latencyMs * 4));
}

export function buildTcpTimeline(input: TcpConfig): TcpTimeline {
  const config = normalizeTcpConfig(input);
  const initialSegments = createSegments(config);
  const scenario =
    (initialSegments.length < 2 && config.scenario === "loss") ||
    (initialSegments.length < 3 && config.scenario === "reorder") ||
    (config.scenario === "reorder" && config.receiveWindowSegments < 2)
      ? "normal"
      : config.scenario;
  const effectiveConfig = { ...config, scenario };
  let snapshot: TcpSnapshot = {
    clientState: "CLOSED",
    serverState: "LISTEN",
    clientNextSeq: CLIENT_ISN,
    serverNextSeq: SERVER_ISN,
    receiverNextByte: CLIENT_ISN + 1,
    receiveWindowSegments: config.receiveWindowSegments,
    congestionWindowSegments: 10,
    sendWindowSegments: Math.min(10, config.receiveWindowSegments),
    packet: null,
    segments: initialSegments,
    completedBytes: 0,
  };
  const events: TcpTimelineEvent[] = [];

  function emit(
    event: Omit<TcpTimelineEvent, "snapshot" | "durationMs"> & {
      durationMs?: number;
    },
    update?: (next: TcpSnapshot) => void,
  ) {
    const next = cloneSnapshot(snapshot);
    update?.(next);
    snapshot = next;
    events.push({
      ...event,
      durationMs: event.durationMs ?? 1150,
      snapshot: cloneSnapshot(snapshot),
    });
  }

  emit({
    id: "endpoints-ready",
    chapterId: "orient",
    kind: "orientation",
    title: "Two programs want a reliable conversation",
    explanation:
      "The browser chooses a temporary port. The server is already listening on port 443.",
    technical:
      "The connection will be identified by protocol plus source and destination IP addresses and ports.",
  });

  emit(
    {
      id: "syn-at-transport",
      chapterId: "handshake",
      kind: "state",
      title: "TCP creates the opening SYN",
      explanation:
        "The client asks to open a connection and proposes sequence number 1000.",
      technical:
        "A SYN occupies one position in TCP sequence space even though it carries no application bytes.",
    },
    (next) => {
      next.clientState = "SYN-SENT";
      next.clientNextSeq = CLIENT_ISN + 1;
      next.packet = packet(
        "syn",
        "SYN",
        "control",
        "client-to-server",
        "client-transport",
        ["SYN"],
        CLIENT_ISN,
        undefined,
        ["tcp"],
      );
    },
  );

  emit(
    {
      id: "syn-at-network",
      chapterId: "handshake",
      kind: "encapsulation",
      title: "IP adds end-to-end addresses",
      explanation:
        "The IP layer wraps the TCP segment with the client and server IP addresses.",
      technical:
        "Routers forward using the destination IP address; they do not need to interpret the TCP handshake.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-network";
        next.packet.wrappers = ["tcp", "ip"];
      }
    },
  );

  emit(
    {
      id: "syn-at-link",
      chapterId: "handshake",
      kind: "encapsulation",
      title: "The link layer prepares the first hop",
      explanation:
        "Ethernet or Wi-Fi adds local-link addressing for the trip to the gateway.",
      technical:
        "The link header is replaced at each routed hop, while the IP packet continues toward the endpoint.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-link";
        next.packet.wrappers = ["tcp", "ip", "link"];
      }
    },
  );

  for (const [id, location, title] of [
    ["syn-local-network", "local-network", "The SYN leaves the client"],
    ["syn-router", "router", "A router selects the next hop"],
    ["syn-internet", "internet", "The IP packet crosses the path"],
    [
      "syn-destination-network",
      "destination-network",
      "The final link reaches the server",
    ],
  ] as const) {
    emit(
      {
        id,
        chapterId: "handshake",
        kind: "transfer",
        title,
        explanation:
          location === "router"
            ? "The router removes the incoming link frame, reads the destination IP and creates a frame for the next link."
            : "The SYN continues toward the server without changing its TCP sequence number.",
        technical:
          "Propagation time changes when latency changes; TCP semantics remain deterministic.",
        durationMs: transferDuration(config),
      },
      (next) => {
        if (next.packet) next.packet.location = location;
      },
    );
  }

  emit(
    {
      id: "syn-at-server-link",
      chapterId: "handshake",
      kind: "encapsulation",
      title: "The server accepts the final frame",
      explanation:
        "The server verifies the local frame and passes the contained IP packet upward.",
      technical:
        "Decapsulation removes one layer at a time and dispatches the payload using protocol identifiers.",
    },
    (next) => {
      if (next.packet) next.packet.location = "server-link";
    },
  );

  emit(
    {
      id: "syn-at-server-network",
      chapterId: "handshake",
      kind: "encapsulation",
      title: "IP confirms the destination",
      explanation:
        "The server removes the IP wrapper and gives the TCP segment to its transport layer.",
      technical: "The destination TCP port identifies the listening server socket.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "server-network";
        next.packet.wrappers = ["tcp", "ip"];
      }
    },
  );

  emit(
    {
      id: "syn-accepted",
      chapterId: "handshake",
      kind: "state",
      title: "The server records the client sequence",
      explanation:
        "TCP receives the SYN, creates connection state and now expects position 1001 from the client.",
      technical: "The server moves from LISTEN to SYN-RECEIVED for this connection.",
    },
    (next) => {
      next.serverState = "SYN-RECEIVED";
      if (next.packet) {
        next.packet.location = "server-transport";
        next.packet.wrappers = ["tcp"];
      }
    },
  );

  emit(
    {
      id: "syn-ack-from-server",
      chapterId: "handshake",
      kind: "state",
      title: "The server replies with SYN-ACK",
      explanation:
        "ACK 1001 confirms the client's SYN. Sequence 5000 establishes the server's own sequence space.",
      technical: "The SYN and ACK flags are independent bits in the TCP header.",
    },
    (next) => {
      next.serverNextSeq = SERVER_ISN + 1;
      next.packet = packet(
        "syn-ack",
        "SYN + ACK",
        "control",
        "server-to-client",
        "server-transport",
        ["SYN", "ACK"],
        SERVER_ISN,
        CLIENT_ISN + 1,
        ["tcp"],
      );
    },
  );

  emit(
    {
      id: "syn-ack-crosses-network",
      chapterId: "handshake",
      kind: "transfer",
      title: "SYN-ACK returns through the network",
      explanation:
        "The response is encapsulated and forwarded back to the client.",
      technical:
        "The return route may differ from the forward route; TCP only requires delivery to the correct endpoint.",
      durationMs: transferDuration(config),
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "internet";
        next.packet.wrappers = ["tcp", "ip", "link"];
      }
    },
  );

  emit(
    {
      id: "syn-ack-at-client",
      chapterId: "handshake",
      kind: "state",
      title: "The client accepts the server sequence",
      explanation:
        "The client verifies ACK 1001 and records that the next server sequence expected is 5001.",
      technical: "The client can now enter ESTABLISHED state.",
      checkpointId: "ack-meaning",
    },
    (next) => {
      next.clientState = "ESTABLISHED";
      if (next.packet) {
        next.packet.location = "client-transport";
        next.packet.wrappers = ["tcp"];
      }
    },
  );

  emit(
    {
      id: "final-ack-crosses-network",
      chapterId: "handshake",
      kind: "transfer",
      title: "The client sends the final ACK",
      explanation:
        "ACK 5001 tells the server that its SYN was received. No application bytes are carried yet.",
      technical: "A pure ACK does not consume another sequence number.",
      durationMs: transferDuration(config),
    },
    (next) => {
      next.packet = packet(
        "handshake-ack",
        "ACK",
        "ack",
        "client-to-server",
        "internet",
        ["ACK"],
        CLIENT_ISN + 1,
        SERVER_ISN + 1,
        ["tcp", "ip", "link"],
      );
    },
  );

  emit(
    {
      id: "connection-established",
      chapterId: "handshake",
      kind: "state",
      title: "Both endpoints are established",
      explanation:
        "Each computer now has the sequence information required to detect missing or duplicate bytes.",
      technical: "The server enters ESTABLISHED after receiving the final ACK.",
    },
    (next) => {
      next.serverState = "ESTABLISHED";
      if (next.packet) {
        next.packet.location = "server-transport";
        next.packet.wrappers = ["tcp"];
      }
    },
  );

  const firstSegment = initialSegments[0];
  emit(
    {
      id: "application-creates-bytes",
      chapterId: "encapsulate",
      kind: "encapsulation",
      title: `The browser produces ${config.payloadBytes.toLocaleString()} bytes`,
      explanation:
        "To TCP, the request is an ordered stream of bytes. TCP does not interpret the HTTP meaning.",
      technical: `With an MSS of ${config.mssBytes} bytes, this stream requires ${initialSegments.length} TCP segment${initialSegments.length === 1 ? "" : "s"}.`,
    },
    (next) => {
      next.packet = packet(
        "application-data",
        "HTTP bytes",
        "data",
        "client-to-server",
        "client-application",
        [],
        firstSegment.seqStart,
        SERVER_ISN + 1,
        ["application"],
        firstSegment.length,
        firstSegment.id,
      );
    },
  );

  emit(
    {
      id: "tcp-segments-stream",
      chapterId: "encapsulate",
      kind: "encapsulation",
      title: "TCP numbers the first byte range",
      explanation: `Segment 1 starts at ${firstSegment.seqStart} and carries ${firstSegment.length} bytes.`,
      technical: `Its inclusive byte range is ${firstSegment.seqStart}–${firstSegment.seqEnd}; the next expected byte is ${firstSegment.seqEnd + 1}.`,
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-transport";
        next.packet.flags = ["ACK", "PSH"];
        next.packet.wrappers = ["application", "tcp"];
      }
    },
  );

  emit(
    {
      id: "data-ip-wrapper",
      chapterId: "encapsulate",
      kind: "encapsulation",
      title: "IP adds endpoint addresses",
      explanation:
        "The source and destination IP addresses allow the packet to cross multiple networks.",
      technical:
        "The TCP checksum protects its header and data; the IP header supplies network-layer routing information.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-network";
        next.packet.wrappers = ["application", "tcp", "ip"];
      }
    },
  );

  emit(
    {
      id: "data-link-wrapper",
      chapterId: "encapsulate",
      kind: "encapsulation",
      title: "The link layer creates a frame",
      explanation:
        "The client addresses the frame to the next local hop, usually its gateway.",
      technical:
        "The frame's trailer can detect corruption on that link; it is not an end-to-end TCP acknowledgment.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-link";
        next.packet.wrappers = ["application", "tcp", "ip", "link"];
      }
    },
  );

  emit(
    {
      id: "data-leaves-client",
      chapterId: "deliver",
      kind: "transfer",
      title: "The frame becomes signals on the first link",
      explanation:
        "The physical medium carries bits. The receiving interface reconstructs and checks the frame.",
      technical:
        "Copper, fiber and radio encode bits differently; those signal details sit below this model.",
      durationMs: transferDuration(config),
    },
    (next) => {
      next.segments[0].status = "in-flight";
      if (next.packet) next.packet.location = "local-network";
    },
  );

  emit(
    {
      id: "data-router",
      chapterId: "deliver",
      kind: "transfer",
      title: "A router replaces the link frame",
      explanation:
        "The router examines the destination IP, chooses a next hop and creates a new link frame.",
      technical:
        "The TCP ports and sequence number remain end-to-end values while link-layer addresses change hop by hop.",
      checkpointId: "router-layer",
      durationMs: transferDuration(config),
    },
    (next) => {
      if (next.packet) next.packet.location = "router";
    },
  );

  emit(
    {
      id: "data-crosses-internet",
      chapterId: "deliver",
      kind: "transfer",
      title: "The packet continues across the route",
      explanation:
        "Each router repeats the forwarding decision until the destination network is reached.",
      technical:
        "This model compresses an arbitrary number of intermediate hops into one inspectable stage.",
      durationMs: transferDuration(config),
    },
    (next) => {
      if (next.packet) next.packet.location = "internet";
    },
  );

  emit(
    {
      id: "data-at-server-link",
      chapterId: "deliver",
      kind: "encapsulation",
      title: "The server removes the final link frame",
      explanation:
        "The network interface verifies the frame and passes its IP packet upward.",
      technical: "Only the frame for the final link reaches this interface.",
    },
    (next) => {
      if (next.packet) next.packet.location = "server-link";
    },
  );

  emit(
    {
      id: "data-at-server-network",
      chapterId: "deliver",
      kind: "encapsulation",
      title: "The server removes the IP header",
      explanation:
        "IP confirms that this machine is the destination and dispatches the payload to TCP.",
      technical: "The IP protocol field identifies TCP as the next receiver.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "server-network";
        next.packet.wrappers = ["application", "tcp", "ip"];
      }
    },
  );

  const received = new Set<number>();
  function updateCumulativeDelivery(next: TcpSnapshot, segmentId: number) {
    received.add(segmentId);
    let contiguous = 0;
    while (received.has(contiguous + 1)) contiguous += 1;
    next.segments.forEach((segment) => {
      if (received.has(segment.id)) {
        segment.status = segment.id <= contiguous ? "delivered" : "buffered";
      }
    });
    const lastContiguous = next.segments[contiguous - 1];
    next.receiverNextByte = lastContiguous
      ? lastContiguous.seqEnd + 1
      : CLIENT_ISN + 1;
    next.completedBytes = next.segments
      .filter((segment) => segment.status === "delivered")
      .reduce((total, segment) => total + segment.length, 0);
  }

  emit(
    {
      id: "data-at-server-transport",
      chapterId: "deliver",
      kind: "state",
      title: "TCP accepts the first byte range",
      explanation:
        "The checksum, sequence range and socket identify valid in-order bytes for this connection.",
      technical: `The receiver can now acknowledge ${firstSegment.seqEnd + 1}, the next contiguous byte expected.`,
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "server-transport";
        next.packet.wrappers = ["application", "tcp"];
      }
      updateCumulativeDelivery(next, 1);
    },
  );

  emit(
    {
      id: "data-at-server-application",
      chapterId: "deliver",
      kind: "state",
      title: "TCP gives contiguous bytes to the server",
      explanation:
        "After TCP removes its header, the application receives the original byte stream in order.",
      technical:
        "Application reads are a byte-stream interface and do not have to match network segment boundaries.",
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "server-application";
        next.packet.wrappers = ["application"];
      }
    },
  );

  const remaining = initialSegments.slice(1);

  function sendSegment(segment: TcpSegment) {
    emit(
      {
        id: `segment-${segment.id}-sent`,
        chapterId: "reliability",
        kind: "state",
        title: `TCP sends segment ${segment.id}`,
        explanation: `This segment carries bytes ${segment.seqStart} through ${segment.seqEnd}.`,
        technical: `At most ${snapshot.sendWindowSegments} segment${snapshot.sendWindowSegments === 1 ? "" : "s"} may be outstanding in this round.`,
      },
      (next) => {
        next.segments[segment.id - 1].status = "in-flight";
        next.packet = packet(
          `data-${segment.id}`,
          `DATA ${segment.id}`,
          "data",
          "client-to-server",
          "client-transport",
          ["ACK", "PSH"],
          segment.seqStart,
          SERVER_ISN + 1,
          ["application", "tcp"],
          segment.length,
          segment.id,
        );
      },
    );
    emit(
      {
        id: `segment-${segment.id}-network`,
        chapterId: "reliability",
        kind: "transfer",
        title: `Segment ${segment.id} crosses the network`,
        explanation:
          "The same encapsulation and forwarding process repeats for this part of the byte stream.",
        technical:
          "Sequence numbers describe bytes; network packet boundaries are not the application read boundaries.",
        durationMs: transferDuration(config),
      },
      (next) => {
        if (next.packet) {
          next.packet.location = "internet";
          next.packet.wrappers = ["application", "tcp", "ip", "link"];
        }
      },
    );
    if (scenario === "loss" && segment.id === 2) {
      emit(
        {
          id: "segment-2-lost",
          chapterId: "reliability",
          kind: "recovery",
          title: "Segment 2 is lost before arrival",
          explanation:
            "The receiver cannot acknowledge these missing bytes because they never arrived.",
          technical:
            "IP provides best-effort delivery. TCP detects the gap from acknowledgment behavior and timers.",
        },
        (next) => {
          next.segments[1].status = "lost";
          if (next.packet) next.packet.lost = true;
        },
      );
    }
  }

  function arriveSegment(segment: TcpSegment) {
    emit(
      {
        id: `segment-${segment.id}-arrived`,
        chapterId: "reliability",
        kind: "state",
        title:
          segment.seqStart === snapshot.receiverNextByte
            ? `Segment ${segment.id} fills the next byte range`
            : `Segment ${segment.id} arrives ahead of a gap`,
        explanation:
          segment.seqStart === snapshot.receiverNextByte
            ? "The receiver can extend its contiguous byte stream and advance the acknowledgment."
            : "TCP buffers these later bytes, but its cumulative acknowledgment still points to the first missing byte.",
        technical: `Before this arrival, the receiver expected byte ${snapshot.receiverNextByte}.`,
      },
      (next) => {
        next.packet = packet(
          `data-${segment.id}`,
          `DATA ${segment.id}`,
          "data",
          "client-to-server",
          "server-transport",
          ["ACK", "PSH"],
          segment.seqStart,
          SERVER_ISN + 1,
          ["application", "tcp"],
          segment.length,
          segment.id,
        );
        updateCumulativeDelivery(next, segment.id);
      },
    );
  }

  function recoverMissingSegment() {
    const missing = initialSegments[1];
    emit(
      {
        id: "retransmission-timeout",
        chapterId: "reliability",
        kind: "recovery",
        title: "The retransmission timer expires",
        explanation:
          "This scenario deliberately demonstrates timeout recovery instead of assuming enough duplicate ACKs for fast retransmit.",
        technical:
          "TCP reduces its congestion window because loss can indicate congestion on the path.",
        durationMs: Math.max(1200, transferDuration(config)),
      },
      (next) => {
        next.packet = null;
        next.congestionWindowSegments = 1;
        next.sendWindowSegments = 1;
      },
    );
    emit(
      {
        id: "segment-2-retransmitted",
        chapterId: "reliability",
        kind: "recovery",
        title: "TCP retransmits only the missing range",
        explanation: `The sender tries bytes ${missing.seqStart}–${missing.seqEnd} again instead of restarting the request.`,
        technical: "Retransmitted bytes keep their original sequence numbers.",
      },
      (next) => {
        next.segments[1].status = "retransmitted";
        next.packet = packet(
          "data-2-retransmission",
          "RETRANSMIT 2",
          "data",
          "client-to-server",
          "client-transport",
          ["ACK", "PSH"],
          missing.seqStart,
          SERVER_ISN + 1,
          ["application", "tcp"],
          missing.length,
          2,
        );
      },
    );
    emit(
      {
        id: "segment-2-retransmission-route",
        chapterId: "reliability",
        kind: "transfer",
        title: "The retransmission takes the network path",
        explanation:
          "The replacement segment is encapsulated and routed like any other IP packet.",
        technical:
          "TCP recovery is end-to-end; routers do not retransmit the missing TCP segment.",
        durationMs: transferDuration(config),
      },
      (next) => {
        if (next.packet) {
          next.packet.location = "internet";
          next.packet.wrappers = ["application", "tcp", "ip", "link"];
        }
      },
    );
    emit(
      {
        id: "segment-2-retransmission-arrived",
        chapterId: "reliability",
        kind: "recovery",
        title: "The missing range closes the gap",
        explanation:
          "TCP can now deliver segment 2 and any later contiguous segments that were already buffered.",
        technical:
          "The cumulative acknowledgment can jump across all newly contiguous bytes.",
      },
      (next) => {
        if (next.packet) {
          next.packet.location = "server-transport";
          next.packet.wrappers = ["application", "tcp"];
        }
        updateCumulativeDelivery(next, 2);
      },
    );
  }

  function acknowledgeRound(round: number) {
    emit(
      {
        id: `window-ack-${round}`,
        chapterId: "reliability",
        kind: "state",
        title: `ACK ${snapshot.receiverNextByte} opens the next send round`,
        explanation:
          "Once this cumulative acknowledgment reaches the sender, more bytes may enter the network.",
        technical:
          "The sender never has more unacknowledged segments in flight than the effective send window permits.",
      },
      (next) => {
        next.packet = packet(
          `window-ack-${round}`,
          `ACK ${next.receiverNextByte}`,
          "ack",
          "server-to-client",
          "client-transport",
          ["ACK"],
          SERVER_ISN + 1,
          next.receiverNextByte,
          ["tcp"],
        );
        if (next.congestionWindowSegments < 10) {
          next.congestionWindowSegments += 1;
        }
        next.sendWindowSegments = Math.min(
          next.congestionWindowSegments,
          next.receiveWindowSegments,
        );
      },
    );
  }

  let cursor = 0;
  let round = 1;
  let reordered = false;
  let recoveredLoss = false;
  while (cursor < remaining.length) {
    const windowSize = Math.max(1, snapshot.sendWindowSegments);
    const batch = remaining.slice(cursor, cursor + windowSize);
    batch.forEach(sendSegment);
    const deliverable = batch.filter(
      (segment) => !(scenario === "loss" && segment.id === 2),
    );
    const arrivalOrder =
      scenario === "reorder" && !reordered && deliverable.length >= 2
        ? [deliverable[1], deliverable[0], ...deliverable.slice(2)]
        : deliverable;
    if (scenario === "reorder" && arrivalOrder.length >= 2) reordered = true;
    arrivalOrder.forEach(arriveSegment);
    if (
      scenario === "loss" &&
      !recoveredLoss &&
      batch.some((segment) => segment.id === 2)
    ) {
      recoverMissingSegment();
      recoveredLoss = true;
    }
    cursor += batch.length;
    if (cursor < remaining.length) acknowledgeRound(round);
    round += 1;
  }

  emit(
    {
      id: "cumulative-ack-created",
      chapterId: "reliability",
      kind: "state",
      title: `The receiver acknowledges byte ${snapshot.receiverNextByte}`,
      explanation:
        "The ACK number names the next contiguous client byte the receiver expects.",
      technical:
        "A cumulative ACK confirms all earlier contiguous bytes, not only the most recent segment.",
    },
    (next) => {
      next.packet = packet(
        "data-ack",
        `ACK ${next.receiverNextByte}`,
        "ack",
        "server-to-client",
        "server-transport",
        ["ACK"],
        SERVER_ISN + 1,
        next.receiverNextByte,
        ["tcp"],
      );
    },
  );

  emit(
    {
      id: "cumulative-ack-route",
      chapterId: "reliability",
      kind: "transfer",
      title: "The cumulative ACK returns",
      explanation:
        "The acknowledgment is wrapped in IP and link headers and routed back to the client.",
      technical:
        "ACK traffic is itself carried in IP packets and can also be delayed or lost.",
      durationMs: transferDuration(config),
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "internet";
        next.packet.wrappers = ["tcp", "ip", "link"];
      }
    },
  );

  emit(
    {
      id: "cumulative-ack-client",
      chapterId: "reliability",
      kind: "state",
      title: "The sender can release acknowledged bytes",
      explanation:
        "The client no longer needs to retain acknowledged bytes for retransmission.",
      technical: `The effective send window is the smaller of congestion window (${snapshot.congestionWindowSegments}) and advertised receive window (${snapshot.receiveWindowSegments}).`,
    },
    (next) => {
      if (next.packet) {
        next.packet.location = "client-transport";
        next.packet.wrappers = ["tcp"];
      }
      next.clientNextSeq = CLIENT_ISN + 1 + config.payloadBytes;
      next.sendWindowSegments = Math.min(
        next.congestionWindowSegments,
        next.receiveWindowSegments,
      );
    },
  );

  emit(
    {
      id: "lesson-complete",
      chapterId: "finish",
      kind: "complete",
      title: "One byte stream, several cooperating layers",
      explanation:
        "TCP ordered and acknowledged bytes, IP routed packets, and each link carried a local frame.",
      technical:
        "Reliability is an endpoint property built above IP's best-effort delivery model.",
    },
    (next) => {
      next.packet = null;
      next.completedBytes = config.payloadBytes;
      next.segments.forEach((segment) => {
        segment.status = "delivered";
      });
      next.receiverNextByte = CLIENT_ISN + 1 + config.payloadBytes;
    },
  );

  const timeline: TcpTimeline = {
    config: effectiveConfig,
    events,
    terminalEventId: "lesson-complete",
  };
  assertCompleteTimeline(timeline);
  return timeline;
}
