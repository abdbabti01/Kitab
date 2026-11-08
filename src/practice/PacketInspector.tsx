import { ArrowDown, Layers, Info } from "lucide-react";
import { effectiveInterface } from "./network/engine.ts";
import { subnet } from "./network/topology.ts";
import type { TraceEvent, Session, Network } from "./network/model.ts";
export function PacketInspector({ event }: { event?: TraceEvent }) {
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
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {l.payload && <pre>{l.payload}</pre>}
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
