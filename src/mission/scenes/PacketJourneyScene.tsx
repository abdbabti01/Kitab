import { Monitor, Router, Server } from "lucide-react";
import sources from "../../content/packet-journey/sources.json" with { type: "json" };
import type { PacketJourneyData } from "../../learning/engines/packet-journey.ts";
import { entity, type SceneProps } from "./common.tsx";
import "./packet-journey.css";

const devices = [
  { id: "client", side: "Client", title: "Client PC", Icon: Monitor },
  { id: "router", side: "Router", title: "Router", Icon: Router },
  { id: "server", side: "Server", title: "Server PC", Icon: Server },
] as const;
const osLayers = ["Socket API", "OS socket tables", "OS TCP", "OS IPv4"];

function Scene(props: SceneProps<PacketJourneyData>) {
  const { event, location, payload, showTcp, showIp } = props.frame.data;
  const { wire } = event;
  const device = devices.find(({ side }) => side === event.side)!;
  const layers = event.side === "Router"
    ? ["Routing table", "IPv4 forwarding"]
    : [event.side === "Client" ? "Browser" : "HTTP server app", ...osLayers];
  const payloadBytes = props.frame.facts.find(({ id }) => id === "payload-length")?.value ?? 0;
  const segmentBytes = props.frame.facts.find(({ id }) => id === "tcp-length")?.value;
  const source = sources[event.source as keyof typeof sources];
  const firstLine = Math.max(0, event.line - 3);
  const data = (
    <div className="packet-wrap-data">
      <button {...entity("http-bytes", props, payload ? "HTTP payload" : "Empty payload", "packet-header")}><b>{payload ? "HTTP bytes" : "Empty payload"} · {payloadBytes} B</b></button>
      {payload && <pre>{payload.replaceAll("\r", "\\r").replaceAll("\n", "\\n\n")}</pre>}
    </div>
  );
  const segment = showTcp ? (
    <div className="packet-wrap-tcp">
      <button {...entity("tcp-header", props, "TCP header", "packet-header")}><b>TCP segment · {segmentBytes} B</b><span>{wire.sourcePort} → {wire.destinationPort} · {wire.flags} · seq {wire.sequence}</span></button>
      {data}
    </div>
  ) : data;


  return (
    <div className="packet-journey">
      <nav className="packet-devices" aria-label="Devices in the network">
        {devices.map(({ id, title, Icon, side }) => (
          <button key={id} {...entity(id, props, title, "packet-device")} data-active={side === event.side}>
            <Icon aria-hidden="true" size={19} /> <span>{title}</span>
          </button>
        ))}
      </nav>

      <section className="packet-closeup" aria-label="Active device close-up">
        <div className="packet-place">
          <device.Icon aria-hidden="true" size={26} />
          <div><h3>{device.title}</h3><b data-testid="packet-location">{location}</b></div>
        </div>
        <ol className="packet-levels" aria-label="Parts of the active device">
          {layers.map((part) => <li key={part} aria-current={part === location ? "true" : undefined}>{part}</li>)}
        </ol>
        {event.side === "Router" && <p className="packet-hop">Next hop <code>{wire.nextHop}</code> · TTL <code>{wire.ttl}</code></p>}
      </section>

      {(payload || showTcp) && <section className="packet-shape" aria-label="Packet encapsulation" data-ip={showIp} data-tcp={showTcp}>
        <h3>Packet layers</h3>
        {showIp ? <div className="packet-wrap-ip">
          <button {...entity("ip-header", props, "IPv4 header", "packet-header")}><b>IPv4 packet · {wire.packetLength} B</b><span>{wire.sourceIp} → {wire.destinationIp} · TTL {wire.ttl}</span></button>
          {segment}
        </div> : segment}
      </section>}

      {event.title === "Display the response body" && <p className="packet-result">{event.raw}</p>}

      <details className="packet-source">
        <summary>C# source · {event.source}:{event.line}</summary>
        <p>{event.method}</p>
        <pre aria-label="C# source lines"><code>{source.slice(firstLine, event.line + 2).map((line, i) => (
          <span className={firstLine + i + 1 === event.line ? "packet-source-current" : undefined} key={firstLine + i}><small>{firstLine + i + 1}</small>{line}{"\n"}</span>
        ))}</code></pre>
        <p><code>{event.raw}</code></p>
      </details>
    </div>
  );
}

export const packetJourneyScene = { Scene };
