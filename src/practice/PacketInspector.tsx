import { ArrowDown, Layers, Info } from "lucide-react";
import { effectiveInterface } from "./network/engine.ts";
import { subnet } from "./network/topology.ts";
import { changesAt, glossary, packetNumber, resends, shown, trip } from "./network/packets.ts";
import type { TraceEvent, Session, Network } from "./network/model.ts";

const kindOf = (packet: string) =>
  packet.startsWith("arp-") ? (packet.endsWith("-reply") ? "ARP reply" : "ARP request") : packet.startsWith("dhcp-") ? "DHCP message" : "IP packet";

/** The current event's message: its layers, what changed at this hop, and its whole trip. */
export function PacketInspector({
  events,
  index,
  network,
  onStep,
}: {
  events: TraceEvent[];
  index: number;
  network: Network;
  onStep: (index: number) => void;
}) {
  const event = events[index];
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const hops = event ? trip(events, event.packet) : [];
  const here = hops.filter((h) => h.index <= index).at(-1);
  const changes = event?.hop ? changesAt(events, index, network) : [];
  const resent = event?.hop ? resends(events, index) : undefined;
  return (
    <div className="packet-inspector">
      <div className="inspector-intro">
        <span className="eyebrow">LOOK INSIDE</span>
        <h2>One message. Many layers.</h2>
        <p>
          Each layer adds the information needed for its job. Open a layer to
          inspect the actual values at this step.
        </p>
      </div>
      {event?.packet && (
        <section className="packet-identity" aria-label="This message">
          <b>
            {kindOf(event.packet)} {packetNumber(events, event.packet)}
          </b>
          <span>
            {hops.length
              ? here
                ? `On link ${hops.indexOf(here) + 1} of ${hops.length}: ${name(here.from)} → ${name(here.to)}`
                : `Not sent yet · will cross ${hops.length} link${hops.length > 1 ? "s" : ""}`
              : "Never left its sender"}
          </span>
          {resent !== undefined && (
            <span className="packet-relation">
              Retransmission: the same bytes as the segment lost at{" "}
              <button className="text-button" onClick={() => onStep(resent)}>
                step {resent + 1}
              </button>
              , in a new packet.
            </span>
          )}
        </section>
      )}
      {event?.hop && (
        <section className="packet-changes" aria-label="Changed since the previous link">
          <h3>Changed since the previous link</h3>
          {changes.length ? (
            <ul>
              {changes.map((c) => (
                <li key={c.field}>
                  <b>{c.field}</b> <code>{shown(c.field, c.before)}</code> → <code>{shown(c.field, c.after)}</code>
                  <small>{c.why}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {hops[0]?.index === index
                ? "This is the first link: the message has just left its sender."
                : "Nothing: switches and access points pass frames on without rewriting them."}
            </p>
          )}
        </section>
      )}
      {!event?.layers.length ? (
        <div className="inspector-empty">
          <Layers size={32} />
          <h3>
            {event ? "No packet at this step" : "Follow your first packet"}
          </h3>
          <p>
            {event
              ? "This action changes configuration or application state. Advance to a send event to see its headers."
              : "Send a request, then step through the timeline. Its data and headers will appear here."}
          </p>
        </div>
      ) : (
        <div className="packet-stack" key={event.id}>
          {[...event.layers].reverse().map((l, i) => (
            <div key={`${l.name}-${i}`}>
              <details className={`packet-layer layer-${l.kind}`} open>
                <summary>
                  <span className="layer-number">
                    {event.layers.length - i}
                  </span>
                  <b>{l.name}</b>
                  <span className="layer-type">{l.kind}</span>
                </summary>
                <div className="layer-content">
                  <p>
                    {
                      {
                        application:
                          "The meaning of the message: what the app asks or answers.",
                        transport:
                          "Delivery between applications, identified by ports.",
                        network:
                          "Addresses and routing information for delivery between networks.",
                        link: "Delivery over the current local link, to the next hop.",
                      }[l.kind]
                    }
                  </p>
                  <dl>
                    {Object.entries(l.fields).map(([key, value]) => (
                      <div key={key} className={changes.some((c) => c.field === key) ? "is-changed" : ""}>
                        <dt>{key}</dt>
                        <dd>{shown(key, value)}</dd>
                      </div>
                    ))}
                  </dl>
                  {l.payload && <pre>{l.payload}</pre>}
                  <details className="field-glossary">
                    <summary>What these fields mean</summary>
                    <dl>
                      {Object.keys(l.fields).map((key) => (
                        <div key={key}>
                          <dt>{key}</dt>
                          <dd>
                            {glossary[key]?.meaning}
                            {glossary[key]?.source && <cite> {glossary[key].source}</cite>}
                            {glossary[key]?.simplified && <em> In this lab: {glossary[key].simplified}</em>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </div>
              </details>
              {i < event.layers.length - 1 && (
                <div className="contains-label">
                  <ArrowDown size={12} /> carries inside
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {hops.length > 0 && (
        <section className="packet-trip" aria-label="Follow this packet">
          <h3>Follow this {event?.packet ? kindOf(event.packet) : "message"}</h3>
          <p>One row per link it crossed. Select a row to show that moment on the diagram.</p>
          <ol>
            {hops.map((h, k) => (
              <li key={h.frame}>
                <button aria-current={h === here ? "step" : undefined} onClick={() => onStep(h.index)}>
                  <span>{k + 1}</span>
                  <b>
                    {name(h.from)} → {name(h.to)}
                  </b>
                  <small>
                    MAC {h.fields["Source MAC"]} → {h.fields["Destination MAC"]}
                  </small>
                  {"Source IP" in h.fields && (
                    <small>
                      IP {h.fields["Source IP"]}
                      {"Source port" in h.fields ? `:${h.fields["Source port"]}` : ""} → {h.fields["Destination IP"]}
                      {"Destination port" in h.fields ? `:${h.fields["Destination port"]}` : ""}
                      {"TTL" in h.fields ? ` · TTL ${h.fields.TTL}` : ""}
                    </small>
                  )}
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <div className="model-note">
        <Info size={15} />
        <p>
          Educational IPv4 model. Checksums, encryption and radio physics are
          omitted. Values shown belong to this simulated event.
        </p>
      </div>
    </div>
  );
}
export function StateTables({
  session,
  network,
  actor,
}: {
  session: Session;
  network: Network;
  actor: string;
}) {
  const device = network.devices.find((d) => d.id === actor);
  const tables: [string, string, string[][]][] = [
    [
      "ARP cache",
      "IP → MAC mappings on each interface.",
      Object.entries(session.arp)
        .filter(([k]) => k.startsWith(`${actor}/`))
        .map(([k, v]) => [k.split("/").slice(1).join(" · "), v]),
    ],
    [
      "MAC forwarding table",
      "A switch learns which port can reach a source MAC.",
      Object.entries(session.mac)
        .filter(([k]) => k.startsWith(`${actor}/`))
        .map(([k, v]) => [k.slice(actor.length + 1), v]),
    ],
    [
      "Routing table",
      "Most specific matching address block determines the outgoing interface.",
      device
        ? [
            ...device.interfaces
              .map((p) => effectiveInterface(device, p, session))
              .filter((p) => p.ip)
              .map((p) => [
                `${subnet(p.ip, p.prefix).network}/${p.prefix}`,
                `connected · ${p.id}`,
              ]),
            ...device.routes.map((r) => [
              `${r.network}/${r.prefix}`,
              `${r.via} · ${r.port}`,
            ]),
            ...device.interfaces
              .map((p) => effectiveInterface(device, p, session))
              .filter((p) => p.gateway)
              .map((p) => ["default", p.gateway]),
          ]
        : [],
    ],
    [
      "DHCP leases",
      "Addresses temporarily assigned by a DHCP server.",
      Object.values(session.leases)
        .filter((l) => l.device === actor || l.server === actor)
        .map((l) => [`${l.device} · ${l.port}`, `${l.ip}/${l.prefix}`]),
    ],
    [
      "NAT mappings",
      "Internal endpoint ↔ external endpoint. Replies use the reverse mapping.",
      session.nat
        .filter((e) => e.router === actor)
        .map((e) => [
          `${e.internal}:${e.internalPort}`,
          `${e.external}:${e.externalPort}`,
        ]),
    ],
    [
      "Socket endpoints",
      "The app holds a reference; the OS owns the endpoint and its byte buffers.",
      Object.entries(session.sockets)
        .filter(([, v]) => v.owner === actor)
        .map(([k, v]) => [
          k,
          `send buffer ${v.sendBytes} B · received ${v.receivedBytes} B`,
        ]),
    ],
    [
      "TCP connections",
      "Connection state is owned by the operating system.",
      Object.entries(session.tcp).filter(([k]) => k.startsWith(`${actor}:`)),
    ],
    [
      "DNS cache",
      "Previously resolved names can skip a new DNS query.",
      Object.entries(session.dns)
        .filter(([k]) => k.startsWith(`${actor}/`))
        .map(([k, v]) => [k.slice(actor.length + 1), v]),
    ],
  ];
  return (
    <div className="state-tables">
      <div className="inspector-intro">
        <span className="eyebrow">STATE AT THIS EVENT</span>
        <h2>{device?.name ?? "Select a device"}</h2>
        <p>Rewind to see these tables before they changed.</p>
      </div>
      {tables.map(([title, purpose, rows]) => (
        <details key={title} open={rows.length > 0}>
          <summary>
            {title}
            <span className="count">{rows.length}</span>
          </summary>
          <p className="field-help">{purpose}</p>
          {rows.length ? (
            <table>
              <tbody>
                {rows.map(([key, value], i) => (
                  <tr key={i}>
                    <th>{key}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-table">No entries at this step.</p>
          )}
        </details>
      ))}
    </div>
  );
}
export function DeviceCloseup({
  event,
  network,
}: {
  event?: TraceEvent;
  network: Network;
}) {
  const d = network.devices.find((d) => d.id === event?.actor);
  if (!d || !event) return null;
  const steps =
    d.kind === "switch" || d.kind === "ap"
      ? ["Network interface", "Bridge / link layer"]
      : d.kind === "router"
        ? ["Network interface", "OS · ARP", "OS · IPv4", "DHCP server"]
        : [
            "Browser / application",
            "Application → socket API",
            "OS · TCP",
            "OS · IPv4",
            "OS · ARP",
            "Network interface",
          ];
  const active = steps.findIndex(
    (label) =>
      event.location === label ||
      event.location.startsWith(label) ||
      (label === "Application → socket API" &&
        event.location.includes("socket")) ||
      (label === "Browser / application" &&
        /application|settings|DHCP client|DNS resolver/i.test(event.location)),
  );
  return (
    <section className="device-closeup" aria-label="Inside the active device">
      <div>
        <span className="eyebrow">INSIDE {d.name.toUpperCase()}</span>
        <h3>{event.location}</h3>
        <p>{event.explanation}</p>
      </div>
      <div className="inside-stack">
        {steps.map((label, i) => (
          <div className={active === i ? "active" : ""} key={label}>
            <span>{i + 1}</span>
            {label}
            {active === i && <b>working now</b>}
          </div>
        ))}
      </div>
    </section>
  );
}
