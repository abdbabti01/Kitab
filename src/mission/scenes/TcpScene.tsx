import { ChevronRight, Server } from "lucide-react";
import type { TcpLocation, TcpPacket } from "../../visual-engine/engines/protocols/tcp-engine.ts";
import type { TcpFrameData } from "../../learning/engines/tcp.ts";
import { entity, SceneSection, type SceneProps } from "./common.tsx";

const layers = [
  { id: "application", name: "Application", detail: "HTTP bytes" },
  { id: "transport", name: "Transport", detail: "TCP ports, order, ACKs" },
  { id: "network", name: "Network", detail: "IP addresses, routing" },
  { id: "link", name: "Link", detail: "One local hop" },
] as const;

const hops: { id: TcpLocation; title: string; detail: string }[] = [
  { id: "local-network", title: "Gateway", detail: "first hop" },
  { id: "router", title: "Router", detail: "forwards by IP" },
  { id: "internet", title: "Internet", detail: "many hops" },
  { id: "destination-network", title: "Final router", detail: "last link" },
];

type Props = SceneProps<TcpFrameData>;

function PacketGlyph({ packet, props }: { packet: TcpPacket; props: Props }) {
  const id = `packet-${packet.id}`;
  return (
    <button {...entity(id, props, `${packet.label}, sequence ${packet.seq}${packet.ack === undefined ? "" : `, acknowledgment ${packet.ack}`}${packet.lost ? ", lost" : ""}`, `tcp-packet kind-${packet.kind} ${packet.lost ? "is-lost" : ""}`, id)}>
      <strong>{packet.label}</strong>
      <span className="tcp-wrappers" aria-hidden="true">
        {packet.wrappers.map((wrapper) => <i data-wrapper={wrapper} key={wrapper}>{wrapper === "application" ? "DATA" : wrapper.toUpperCase()}</i>)}
      </span>
      <small>SEQ {packet.seq}{packet.ack !== undefined ? ` · ACK ${packet.ack}` : ""}</small>
    </button>
  );
}

function Endpoint({ side, props }: { side: "client" | "server"; props: Props }) {
  const s = props.frame.data.event.snapshot;
  const packet = s.packet;
  const state = side === "client" ? s.clientState : s.serverState;
  const ordered = layers;
  return (
    <div className={`tcp-endpoint ${side}`}>
      <button {...entity(side, props, `${side === "client" ? "Client" : "Server"} TCP state ${state}`, "tcp-endpoint-head")}>
        <Server aria-hidden="true" />
        <span>
          <b>{side === "client" ? "Computer A · client" : "Computer B · server"}</b>
          <small>{side === "client" ? "192.168.1.8:52491" : "203.0.113.10:443"}</small>
        </span>
        <em>{state}</em>
      </button>
      <ol className="tcp-layers">
        {ordered.map((layer, index) => {
          const location = `${side}-${layer.id}` as TcpLocation;
          return (
            <li className={`tcp-layer ${packet?.location === location ? "is-active" : ""}`} key={layer.id}>
              <span className="tcp-layer-num">L{4 - index}</span>
              <span className="tcp-layer-name"><b>{layer.name}</b><small>{layer.detail}</small></span>
              <span className="tcp-slot">{packet?.location === location && <PacketGlyph packet={packet} props={props} />}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Scene(props: Props) {
  const s = props.frame.data.event.snapshot;
  const packet = s.packet;
  return (
    <div className="tcp-scene">
      <dl className="scene-chips" aria-label="Window state">
        <div><dt>Receive window</dt><dd>{s.receiveWindowSegments}</dd></div>
        <div><dt>Congestion window</dt><dd>{s.congestionWindowSegments}</dd></div>
        <div><dt>Send window</dt><dd>{s.sendWindowSegments}</dd></div>
        <div className={s.senderUnacked.length >= s.sendWindowSegments ? "is-full" : ""}><dt>Unacked at sender</dt><dd>{s.senderUnacked.length}</dd></div>
      </dl>
      <div className="tcp-grid">
        <Endpoint side="client" props={props} />
        <SceneSection label="Network path" className="tcp-path">
          <ol className="tcp-hops">
            {hops.map((hop, index) => (
              <li className={`tcp-hop ${packet?.location === hop.id ? "is-active" : ""}`} key={hop.id}>
                <span className="tcp-hop-name"><b>{hop.title}</b><small>{hop.detail}</small></span>
                <span className="tcp-slot">{packet?.location === hop.id && <PacketGlyph packet={packet} props={props} />}</span>
                {index < hops.length - 1 && <ChevronRight className="tcp-hop-arrow" aria-hidden="true" />}
              </li>
            ))}
          </ol>
        </SceneSection>
        <Endpoint side="server" props={props} />
      </div>
      <SceneSection label="Byte stream" className="tcp-stream">
        <p className="scene-caption">
          Receiver expects byte <b>{s.receiverNextByte}</b> · sender's highest ACK <b>{s.senderAckedThrough}</b> · {s.completedBytes.toLocaleString()} bytes delivered in order
        </p>
        <ol className="tcp-segments">
          {s.segments.map((segment) => {
            const id = `segment-${segment.id}`;
            const unacked = s.senderUnacked.includes(segment.id);
            return (
              <li key={id}>
                <button {...entity(id, props, `Segment ${segment.id}, bytes ${segment.seqStart} to ${segment.seqEnd}, receiver ${segment.status}${segment.acked ? ", acknowledged" : unacked ? ", unacknowledged at sender" : ""}`, `tcp-segment status-${segment.status} ${segment.acked ? "is-acked" : ""} ${unacked ? "is-unacked" : ""}`)}>
                  <span><b>#{segment.id}</b><em>{segment.status}</em></span>
                  <small>{segment.seqStart}–{segment.seqEnd}</small>
                  <i aria-hidden="true">{segment.acked ? "ACKED" : unacked ? "UNACKED" : ""}</i>
                </button>
              </li>
            );
          })}
        </ol>
      </SceneSection>
    </div>
  );
}

export const tcpScene = { Scene };
