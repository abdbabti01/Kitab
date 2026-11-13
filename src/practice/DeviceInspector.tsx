import { useEffect, useState, useId, type ReactNode } from "react";
import { Cable, Info, Trash2, Wifi } from "lucide-react";
import { deviceDescription, subnet } from "./network/topology.ts";
import { effectiveInterface } from "./network/engine.ts";
import { deviceRole } from "./network/roles.ts";
import {
  createDevice,
  type Device,
  type Network,
  type Endpoint,
  type Medium,
  type Session,
  type TraceEvent,
} from "./network/model.ts";
function Field({
  label,
  value,
  onChange,
  hint,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  hint?: string;
  type?: string;
}) {
  const hintId = useId();
  return (
    <label className="network-field">
      <span>{label}</span>
      <input
        aria-label={label}
        aria-describedby={hint ? hintId : undefined}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {hint && <small id={hintId}>{hint}</small>}
    </label>
  );
}
export function DeviceInspector({
  device,
  network,
  session,
  onApply,
  onDelete,
  onConnect,
  onDisconnect,
  events,
  index,
  state,
}: {
  /** The device's tables at this step (interfaces, ARP, routes…), shown between its role and its settings. */
  state?: ReactNode;
  /** The current run, if any: the inspector then explains this device's part in it. */
  events?: TraceEvent[];
  index?: number;
  device: Device;
  network: Network;
  session: Session;
  onApply: (device: Device) => void;
  onDelete: () => void;
  onConnect: (a: Endpoint, b: Endpoint, medium: Medium) => void;
  onDisconnect: (id: string) => void;
}) {
  const [draft, setDraft] = useState(device),
    [portId, setPortId] = useState(device.interfaces[0].id),
    [target, setTarget] = useState("");
  useEffect(() => {
    setDraft(structuredClone(device));
    if (!device.interfaces.some((p) => p.id === portId))
      setPortId(device.interfaces[0].id);
  }, [device]);
  const port =
      draft.interfaces.find((p) => p.id === portId) ?? draft.interfaces[0],
    effective = effectiveInterface(
      device,
      device.interfaces.find((p) => p.id === port.id) ?? port,
      session,
    );
  const update = (key: string, value: unknown) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const patchPort = (key: string, value: unknown) =>
    setDraft((d) => ({
      ...d,
      interfaces: d.interfaces.map((p) =>
        p.id === port.id ? { ...p, [key]: value } : p,
      ),
    }));
  let block;
  try {
    if (port.ip) block = subnet(port.ip, port.prefix);
  } catch {
    /* input may be incomplete */
  }
  const targets = network.devices
    .filter((d) => d.id !== device.id)
    .flatMap((d) =>
      d.interfaces
        .filter((p) => p.medium === port.medium)
        .map((p) => ({
          value: `${d.id}/${p.id}`,
          name: `${d.name} · ${p.id}`,
        })),
    );
  return (
    <div className="device-inspector">
      <div className="inspector-intro">
        <span className="eyebrow">
          {device.kind === "ap" ? "ACCESS POINT" : device.kind.toUpperCase()}
        </span>
        <h2>{device.name}</h2>
        <p>{deviceDescription(device)}</p>
      </div>
      {events?.length ? <DeviceRole device={device} network={network} events={events} index={index ?? 0} /> : null}
      {state}
      <h3 className="state-heading">Settings</h3>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(draft);
        }}
      >
        <Field
          label="Device name"
          value={draft.name}
          onChange={(v) => update("name", v)}
        />
        <Field
          label="Network group label"
          value={draft.group}
          onChange={(v) => update("group", v)}
          hint="A visual label, such as Home LAN. Connections and IP settings determine the actual network."
        />
        <label className="network-field">
          <span>Interface / port</span>
          <select value={port.id} onChange={(e) => setPortId(e.target.value)}>
            {draft.interfaces.map((p) => (
              <option key={p.id}>{p.id}</option>
            ))}
          </select>
          <small>
            An interface is the part of this device that connects to a network.
          </small>
        </label>
        {device.kind === "router" && draft.interfaces.length < 12 && (
          <button
            type="button"
            className="small-button"
            onClick={() => {
              const i = draft.interfaces.length;
              const p = createDevice("pc", `${draft.id}-extra-${i}`)
                .interfaces[0];
              p.id = `eth${i}`;
              update("interfaces", [...draft.interfaces, p]);
              setPortId(p.id);
            }}
          >
            Add routed interface
          </button>
        )}
        <label className="network-check">
          <input
            type="checkbox"
            checked={port.enabled}
            onChange={(e) => patchPort("enabled", e.target.checked)}
          />{" "}
          Interface enabled
        </label>
        {device.kind !== "switch" && device.kind !== "ap" && (
          <>
            <label className="network-field">
              <span>Address assignment</span>
              <select
                value={port.mode}
                onChange={(e) => patchPort("mode", e.target.value)}
              >
                <option value="static">Static · enter my own address</option>
                <option value="dhcp">DHCP · ask the network</option>
              </select>
              <small>
                DHCP automatically supplies an address, mask, gateway and DNS
                server.
              </small>
            </label>
            {port.mode === "static" ? (
              <>
                <Field
                  label="IP address"
                  value={port.ip}
                  onChange={(v) => patchPort("ip", v)}
                  hint="The address of this interface. Other devices use it to send IP packets here. Example: 192.168.1.10."
                />
                <Field
                  label="Prefix length"
                  value={port.prefix}
                  type="number"
                  onChange={(v) => patchPort("prefix", Number(v))}
                  hint="How many address bits identify the subnet. /24 means mask 255.255.255.0."
                />
                {block && (
                  <div className="subnet-explainer">
                    <b>
                      Your subnet · {block.network}/{port.prefix}
                    </b>
                    <p>
                      A subnet is a block of IP addresses. This mask tells your
                      device which destinations count as local.
                    </p>
                    <span>
                      Host addresses {block.first}–{block.last}
                    </span>
                    <span>
                      {block.usable.toLocaleString()} usable addresses · mask{" "}
                      {block.mask}
                    </span>
                  </div>
                )}
                <Field
                  label="Default gateway"
                  value={port.gateway}
                  onChange={(v) => patchPort("gateway", v)}
                  hint="The router to ask when the destination is outside this subnet. It must be reachable on this link."
                />
                <Field
                  label="DNS server"
                  value={port.dns}
                  onChange={(v) => patchPort("dns", v)}
                  hint="The server that turns a name like kitab.test into an IP address."
                />
              </>
            ) : (
              <div className="subnet-explainer">
                <b>
                  {effective.ip
                    ? `Lease · ${effective.ip}`
                    : "Waiting for a DHCP lease"}
                </b>
                <p>
                  Apply settings, then choose “Configure automatically” in the
                  send controls.
                </p>
                {effective.ip && (
                  <span>
                    Gateway {effective.gateway} · DNS {effective.dns}
                  </span>
                )}
              </div>
            )}
          </>
        )}
        {(device.kind === "phone" || device.kind === "ap") && (
          <details open>
            <summary>Wi-Fi association</summary>
            <Field
              label="Wi-Fi name (SSID)"
              value={draft.ssid}
              onChange={(v) => update("ssid", v)}
              hint="The network name advertised by the access point."
            />
            <Field
              label="Wi-Fi passphrase"
              value={draft.password}
              onChange={(v) => update("password", v)}
              hint="Teaching model only. Enter the same value on the phone and access point."
            />
          </details>
        )}
        {device.kind === "router" && (
          <details>
            <summary>Routing & NAT</summary>
            <p className="field-help">
              A route says which next hop to use for an address block. The
              longest matching prefix wins.
            </p>
            {draft.routes.map((r, i) => (
              <div className="route-editor" key={i}>
                {(["network", "prefix", "via", "port"] as const).map((key) => (
                  <Field
                    key={key}
                    label={
                      key === "via"
                        ? "Next-hop IP"
                        : key === "port"
                          ? "Outgoing port"
                          : key === "prefix"
                            ? "Route prefix"
                            : "Destination network"
                    }
                    type={key === "prefix" ? "number" : "text"}
                    value={r[key]}
                    onChange={(v) =>
                      update(
                        "routes",
                        draft.routes.map((item, index) =>
                          index === i
                            ? {
                                ...item,
                                [key]: key === "prefix" ? Number(v) : v,
                              }
                            : item,
                        ),
                      )
                    }
                  />
                ))}
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() =>
                    update(
                      "routes",
                      draft.routes.filter((_, j) => i !== j),
                    )
                  }
                >
                  Remove route
                </button>
              </div>
            ))}
            <button
              type="button"
              className="small-button"
              onClick={() =>
                update("routes", [
                  ...draft.routes,
                  { network: "0.0.0.0", prefix: 0, via: "", port: "wan" },
                ])
              }
            >
              Add static route
            </button>
            <label className="network-check">
              <input
                type="checkbox"
                checked={draft.nat}
                onChange={(e) => update("nat", e.target.checked)}
              />{" "}
              Enable NAT / port translation
            </label>
            <p className="field-help">
              NAT lets internal clients use this router’s outside address. A
              mapping remembers where each reply belongs.
            </p>
            <Field
              label="NAT inside interface"
              value={draft.inside}
              onChange={(v) => update("inside", v)}
            />
            <Field
              label="NAT outside interface"
              value={draft.outside}
              onChange={(v) => update("outside", v)}
            />
          </details>
        )}
        {(device.kind === "router" || device.kind === "server") && (
          <details>
            <summary>DHCP service</summary>
            <label className="network-check">
              <input
                type="checkbox"
                checked={draft.dhcp.enabled}
                onChange={(e) =>
                  update("dhcp", { ...draft.dhcp, enabled: e.target.checked })
                }
              />{" "}
              Enable DHCP server
            </label>
            <p className="field-help">
              Lends unused addresses to clients on this LAN. Watch Discover →
              Offer → Request → ACK.
            </p>
            {(
              [
                "port",
                "start",
                "end",
                "gateway",
                "dns",
                "leaseSeconds",
              ] as const
            ).map((key) => (
              <Field
                key={key}
                label={
                  {
                    port: "DHCP interface",
                    start: "Pool first address",
                    end: "Pool last address",
                    gateway: "Advertised gateway",
                    dns: "Advertised DNS",
                    leaseSeconds: "Lease seconds",
                  }[key]
                }
                value={draft.dhcp[key]}
                type={key === "leaseSeconds" ? "number" : "text"}
                onChange={(v) =>
                  update("dhcp", {
                    ...draft.dhcp,
                    [key]: key === "leaseSeconds" ? Number(v) : v,
                  })
                }
              />
            ))}
          </details>
        )}
        {(device.kind === "server" || device.kind === "router") && (
          <details>
            <summary>DNS records</summary>
            <p className="field-help">
              Each record maps a hostname to an IPv4 address. A device with at
              least one record runs a DNS service on UDP port 53; without records
              it does not answer DNS queries.
            </p>
            {Object.entries(draft.records).map(([name, address], i) => (
              <div className="dns-record" key={i}>
                <Field
                  label={`DNS name ${i + 1}`}
                  value={name}
                  onChange={(v) => {
                    const entries = Object.entries(draft.records);
                    entries[i][0] = v;
                    update("records", Object.fromEntries(entries));
                  }}
                />
                <Field
                  label={`DNS address ${i + 1}`}
                  value={address}
                  onChange={(v) =>
                    update("records", { ...draft.records, [name]: v })
                  }
                />
                <button
                  type="button"
                  className="text-button danger"
                  onClick={() =>
                    update(
                      "records",
                      Object.fromEntries(
                        Object.entries(draft.records).filter(
                          ([k]) => k !== name,
                        ),
                      ),
                    )
                  }
                >
                  Remove record
                </button>
              </div>
            ))}
            <button
              type="button"
              className="small-button"
              onClick={() =>
                update("records", {
                  ...draft.records,
                  [`site${Object.keys(draft.records).length + 1}.test`]:
                    "192.168.1.20",
                })
              }
            >
              Add DNS record
            </button>
          </details>
        )}
        {device.kind === "server" && (
          <details>
            <summary>HTTP service</summary>
            <label className="network-check">
              <input
                type="checkbox"
                checked={draft.web.enabled}
                onChange={(e) =>
                  update("web", { ...draft.web, enabled: e.target.checked })
                }
              />{" "}
              Listen on TCP port 80
            </label>
            <label className="network-field">
              <span>Response body</span>
              <textarea
                maxLength={4096}
                value={draft.web.body}
                onChange={(e) =>
                  update("web", { ...draft.web, body: e.target.value })
                }
              />
              <small>This text becomes the HTTP response payload.</small>
            </label>
          </details>
        )}
        <div className="config-footer">
          <button type="submit" className="button primary">
            Apply settings
          </button>
          <small>Applying resets the simulated session.</small>
        </div>
      </form>
      <details className="connections" open>
        <summary>Connections</summary>
        <p className="field-help">
          Choose the local interface above, then a compatible port on another
          device.
        </p>
        <label className="network-field">
          <span>Connect {port.id} to</span>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose a device and port</option>
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="small-button"
          disabled={!target}
          onClick={() => {
            const [deviceId, portId] = target.split("/");
            onConnect(
              { device: device.id, port: port.id },
              { device: deviceId, port: portId },
              port.medium,
            );
          }}
        >
          {port.medium === "wifi" ? <Wifi size={16} /> : <Cable size={16} />}{" "}
          {port.medium === "wifi"
            ? "Associate with access point"
            : "Connect cable"}
        </button>
        {network.links
          .filter((l) => l.a.device === device.id || l.b.device === device.id)
          .map((l) => (
            <div className="connection-row" key={l.id}>
              <span>
                {l.a.device === device.id ? l.a.port : l.b.port} →{" "}
                {
                  network.devices.find(
                    (d) =>
                      d.id ===
                      (l.a.device === device.id ? l.b.device : l.a.device),
                  )?.name
                }
              </span>
              <button
                aria-label={`Disconnect ${l.id}`}
                className="text-button danger"
                onClick={() => onDisconnect(l.id)}
              >
                Remove
              </button>
            </div>
          ))}
      </details>
      <div className="mac-note">
        <Info size={14} />
        <span>
          MAC · {port.mac}
          <br />A link-layer address used to deliver frames on the local
          network.
        </span>
      </div>
      <button className="text-button danger delete-device" onClick={onDelete}>
        <Trash2 size={14} /> Delete device
      </button>
    </div>
  );
}

/** What this device did in the current run, what it is doing now, and the table entry behind it. */
function DeviceRole({ device, network, events, index }: { device: Device; network: Network; events: TraceEvent[]; index: number }) {
  const role = deviceRole(device, network, events, index);
  return (
    <section className="device-role" aria-label={`${device.name} in this run`}>
      <p>{role.what}</p>
      <h3>Right now</h3>
      <p>{role.now}</p>
      {role.entry && (
        <p className="device-role-entry">
          <b>{role.entry.table}:</b> <code>{role.entry.row}</code>
        </p>
      )}
      <h3>So far in this run</h3>
      {role.did.length ? (
        <ul>
          {role.did.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>Nothing yet. Step forward to see when it takes part.</p>
      )}
      <p className="device-role-not">{role.not}</p>
    </section>
  );
}
