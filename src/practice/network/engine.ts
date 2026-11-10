import { receiveBytes } from "./transport.ts";
import {
  isBridge,
  keyOf,
  type Network,
  type Device,
  type NetworkInterface,
  type Endpoint,
  type Layer,
  type Session,
  type Action,
  type Trace,
  type TraceEvent,
  type FailureReason,
  type Failure,
} from "./model.ts";
import {
  ipNumber,
  sameSubnet,
  subnet,
  portOf,
  validateNetwork,
  dotted,
} from "./topology.ts";

type IpMessage = {
  src: string;
  dst: string;
  protocol: "TCP" | "UDP" | "ICMP";
  sport: number;
  dport: number;
  ttl: number;
  data: string;
  flags?: string;
  seq?: number;
  ack?: number;
  label: string;
};
type Hop = {
  from: Endpoint;
  to: Endpoint;
  link: string;
  medium: "wifi" | "ethernet";
};
export const newSession = (): Session => ({
  buffers: {},
  sockets: {},
  time: 0,
  leases: {},
  arp: {},
  mac: {},
  nat: [],
  tcp: {},
  dns: {},
});
export function effectiveInterface(
  d: Device,
  p: NetworkInterface,
  s: Session,
): NetworkInterface {
  if (p.mode === "static") return p;
  const l = s.leases[keyOf(d.id, p.id)];
  return {
    ...p,
    ip: l?.ip ?? "",
    prefix: l?.prefix ?? p.prefix,
    gateway: l?.gateway ?? "",
    dns: l?.dns ?? "",
  };
}
const bytes = (s: string) => new TextEncoder().encode(s).length;
/** The engine's diagnosis and a repair suggestion, kept apart from what was observed (see Failure). */
type Coaching = { detail?: string; advice?: string };
class SimulationFailure extends Error {
  reason: FailureReason;
  device: string;
  detail?: string;
  advice?: string;
  constructor(message: string, reason: FailureReason, device: string, cause?: unknown, more: Coaching = {}) {
    super(message, { cause });
    this.reason = reason;
    this.device = device;
    // A failure that wraps another one inherits its diagnosis and suggestion unless it has its own.
    const inner = cause instanceof SimulationFailure ? cause : undefined;
    this.detail = more.detail ?? inner?.detail;
    this.advice = more.advice ?? inner?.advice;
  }
}
const failureOf = (e: SimulationFailure): Failure => ({
  reason: e.reason,
  device: e.device,
  message: e.message,
  ...(e.detail ? { detail: e.detail } : {}),
  ...(e.advice ? { advice: e.advice } : {}),
  cause: e.cause instanceof SimulationFailure ? failureOf(e.cause) : undefined,
});
// Failures of the path itself. A reply that hits one of these could not get back to the sender.
const pathReasons = new Set<FailureReason>([
  "DUPLICATE_IP", "ARP_NO_OWNER", "ARP_NO_PATH", "SWITCH_STALE_MAC", "NO_GATEWAY", "GATEWAY_NOT_LOCAL",
  "ROUTER_NO_ROUTE", "NO_ROUTE_PRIVATE", "NOT_A_ROUTER", "TTL_EXPIRED", "ROUTING_LOOP", "NAT_NO_MAPPING",
]);
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
// RFC 1918 private ranges.
export const isPrivate = (ip: string) =>
  sameSubnet(ip, "10.0.0.0", 8) ||
  sameSubnet(ip, "172.16.0.0", 12) ||
  sameSubnet(ip, "192.168.0.0", 16);

/** Deterministic teaching model. Every visible change is an immutable event snapshot. */
export function simulate(
  network: Network,
  initial: Session,
  action: Action,
): Trace {
  const n = structuredClone(network),
    s = structuredClone(initial),
    events: TraceEvent[] = [];
  let actor = action.source,
    location = "Application",
    current: Layer[] = [];
  let dhcpContext: TraceEvent["dhcpContext"];
  // Message identity for the events being emitted (see TraceEvent.packet and .frame).
  let packet = "",
    frame = 0,
    messages = 0,
    frames = 0;
  // The frame each bridge received last: its forwarding decision is about that frame.
  const arrived: Record<string, number> = {};
  const dev = (id: string) => {
    const d = n.devices.find((d) => d.id === id);
    if (!d) throw new Error("Choose a device in this network.");
    return d;
  };
  const emit = (
    title: string,
    explanation: string,
    layers: Layer[] = current,
    hop?: TraceEvent["hop"],
    error = false,
  ) => {
    if (events.length >= 9999)
      throw new SimulationFailure(
        "Simulation reached its 10,000-event limit.",
        "SIMULATION_LIMIT",
        actor,
        undefined,
        { advice: "Simplify the network." },
      );
    s.time += 10;
    for (const [leaseKey, lease] of Object.entries(s.leases))
      if (lease.expires <= s.time) {
        delete s.leases[leaseKey];
        events.push({
          id: events.length,
          time: s.time,
          actor: lease.device,
          location: "OS · DHCP client",
          title: "DHCP lease expired",
          explanation: `${lease.ip} is no longer assigned to this device.`,
          layers: [],
          snapshot: structuredClone(s),
        });
        if (lease.device === action.source) {
          actor = lease.device;
          location = "OS · DHCP client";
          throw new SimulationFailure(
            `DHCP lease expired for ${lease.ip} during this transfer.`,
            "DHCP_LEASE_EXPIRED",
            lease.device,
            undefined,
            { advice: "Configure automatically again to obtain a lease." },
          );
        }
      }
    events.push({
      id: events.length,
      time: s.time,
      actor,
      location,
      title,
      explanation,
      layers: structuredClone(layers),
      snapshot: structuredClone(s),
      hop,
      error,
      packet: packet || undefined,
      frame: frame || undefined,
      dhcpContext: layers.some((layer) => layer.name.startsWith("DHCP "))
        ? dhcpContext && { ...dhcpContext }
        : undefined,
    });
  };
  /** Records the values behind the decision the last event made, for explanations. */
  const facts = (values: Record<string, string | number>) => {
    events[events.length - 1].facts = values;
  };
  const at = (d: Device, where: string) => {
    actor = d.id;
    location = where;
  };
  function fail(message: string, reason: FailureReason, cause?: unknown, more?: Coaching): never {
    throw new SimulationFailure(message, reason, actor, cause, more);
  }
  const iface = (d: Device, id: string) =>
    effectiveInterface(
      d,
      d.interfaces.find((p) => p.id === id)!,
      s,
    );
  const active = (d: Device) =>
    d.interfaces.map((p) => iface(d, p.id)).filter((p) => p.enabled);
  function wifiAllowed(h: Hop) {
    if (h.medium !== "wifi") return true;
    const a = dev(h.from.device),
      b = dev(h.to.device),
      ap = a.kind === "ap" ? a : b,
      phone = a.kind === "phone" ? a : b;
    return ap.ssid === phone.ssid && ap.password === phone.password;
  }
  function adjacent(e: Endpoint): Hop[] {
    return n.links.flatMap((l) => {
      const other =
        l.a.device === e.device && l.a.port === e.port
          ? l.b
          : l.b.device === e.device && l.b.port === e.port
            ? l.a
            : null;
      if (!other) return [];
      const a = portOf(n, e),
        b = portOf(n, other);
      const h: Hop = { from: e, to: other, link: l.id, medium: l.medium };
      return a.port.enabled && b.port.enabled && wifiAllowed(h) ? [h] : [];
    });
  }
  // A router ends a broadcast domain. Only switches and access points join ports.
  function reach(start: Endpoint): { end: Endpoint; path: Hop[] }[] {
    const queue = [{ end: start, path: [] as Hop[] }],
      seen = new Set<string>(),
      result: { end: Endpoint; path: Hop[] }[] = [];
    while (queue.length) {
      const item = queue.shift()!,
        key = keyOf(item.end.device, item.end.port);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
      const d = dev(item.end.device);
      const ports =
        item.path.length && isBridge(d)
          ? d.interfaces
              .filter((p) => p.enabled)
              .map((p) => ({ device: d.id, port: p.id }))
          : [item.end];
      for (const p of ports)
        for (const h of adjacent(p))
          if (!item.path.some((old) => old.link === h.link))
            queue.push({ end: h.to, path: [...item.path, h] });
    }
    return result;
  }
  function frameLayers(
    h: Hop,
    sourceMac: string,
    destinationMac: string,
    upper: Layer[],
    protocol = "IPv4",
  ): Layer[] {
    return [
      ...upper,
      {
        name: h.medium === "wifi" ? "Wi-Fi frame" : "Ethernet frame",
        kind: "link",
        fields: {
          "Source MAC": sourceMac,
          "Destination MAC": destinationMac,
          Carries: protocol,
          Medium:
            h.medium === "wifi" ? "Wi-Fi radio (modeled)" : "Ethernet cable",
          "Outgoing port": h.from.port,
          ...(h.medium === "wifi"
            ? {
                "Access point":
                  dev(h.from.device).kind === "ap"
                    ? h.from.device
                    : h.to.device,
              }
            : {}),
        },
      },
    ];
  }
  function deliverPath(
    path: Hop[],
    sourceMac: string,
    destinationMac: string,
    upper: Layer[],
    protocol = "IPv4",
    floodCopy = false,
    onReceive?: (device: Device) => void,
  ) {
    const outerFrame = frame;
    for (const [hopIndex, h] of path.entries()) {
      const from = dev(h.from.device),
        to = dev(h.to.device);
      at(from, isBridge(from) ? "Bridge / link layer" : "Network interface");
      if (isBridge(from)) {
        const learned = s.mac[`${from.id}/${destinationMac}`];
        if (learned && learned !== h.from.port)
          fail(
            `${from.name}'s MAC table sends ${destinationMac} to ${learned}, which does not reach this destination.`,
            "SWITCH_STALE_MAC",
            undefined,
            { advice: "Restart the simulation to clear a stale mapping." },
          );
        if (!learned && destinationMac !== "ff:ff:ff:ff:ff:ff" && !floodCopy) {
          const arrival = path[hopIndex - 1]?.to.port;
          const seen = new Set(path.map((h) => h.link)),
            incoming = frame;
          for (const p of from.interfaces.filter(
            (p) => p.enabled && p.id !== arrival && p.id !== h.from.port,
          )) {
            for (const branch of reach({ device: from.id, port: p.id }))
              for (const extra of branch.path)
                if (!seen.has(extra.link)) {
                  seen.add(extra.link);
                  deliverPath(
                    [extra],
                    sourceMac,
                    destinationMac,
                    upper,
                    protocol,
                    true,
                  );
                }
          }
          frame = incoming;
          at(from, "Bridge / link layer");
        }
        frame = arrived[from.id] ?? frame;
        emit(
          destinationMac === "ff:ff:ff:ff:ff:ff"
            ? "Forward broadcast on LAN"
            : learned
              ? "Forward using MAC table"
              : "Unknown MAC: flood eligible ports",
          learned
            ? `${from.name} learned ${destinationMac} on ${learned}.`
            : `${from.name} forwards this frame through its active ports except the arrival port. Other devices discard frames not addressed to them.`,
          upper,
        );
        facts({ MAC: destinationMac, ...(learned ? { Port: learned } : {}) });
      }
      const layers = frameLayers(h, sourceMac, destinationMac, upper, protocol);
      frame = ++frames;
      emit(
        h.medium === "wifi" ? "Transmit over Wi-Fi" : "Transmit over Ethernet",
        `${from.name} ${h.from.port} sends a frame to ${to.name} ${h.to.port}. The frame carries ${protocol}.`,
        layers,
        { from: from.id, to: to.id, link: h.link },
      );
      at(to, isBridge(to) ? "Bridge / link layer" : "Network interface");
      if (isBridge(to)) {
        s.mac[`${to.id}/${sourceMac}`] = h.to.port;
        arrived[to.id] = frame;
        emit(
          "Learn source MAC",
          `${to.name} records that ${sourceMac} is reachable through ${h.to.port}.`,
          layers,
        );
        facts({ MAC: sourceMac, Port: h.to.port });
      }
      if (
        !isBridge(to) &&
        destinationMac !== "ff:ff:ff:ff:ff:ff" &&
        iface(to, h.to.port).mac !== destinationMac
      ) {
        emit(
          "Discard frame for another MAC",
          `${to.name} received a flooded copy addressed to ${destinationMac}. Its interface discards it without handing it to IP.`,
          layers,
        );
        continue;
      }
      emit(
        "Receive frame",
        `${to.name} receives the ${h.medium === "wifi" ? "wireless" : "wired"} frame. ${isBridge(to) ? "It forwards at the link layer; it does not route IP." : "The network interface removes the link header and passes the payload upward."}`,
        layers,
      );
      if (!isBridge(to)) onReceive?.(to);
    }
    frame = outerFrame;
  }
  function broadcast(
    start: Endpoint,
    upper: Layer[],
    protocol: string,
    onReceive?: (device: Device) => void,
  ) {
    const source = portOf(n, start),
      seen = new Set<string>();
    for (const target of reach(start))
      for (const h of target.path)
        if (!seen.has(h.link)) {
          seen.add(h.link);
          deliverPath(
            [h],
            source.port.mac,
            "ff:ff:ff:ff:ff:ff",
            upper,
            protocol,
            false,
            onReceive,
          );
        }
  }
  /** One ARP exchange: its request and reply are their own messages, not part of the IP packet. */
  function arp(d: Device, p: NetworkInterface, nextHop: string, upper: Layer[]) {
    const outer = packet;
    try {
      return resolve(d, p, nextHop, upper);
    } finally {
      packet = outer;
    }
  }
  function resolve(
    d: Device,
    p: NetworkInterface,
    nextHop: string,
    upper: Layer[],
  ): { path: Hop[]; end: Endpoint; mac: string } {
    at(d, "OS · ARP");
    const reachable = reach({ device: d.id, port: p.id });
    const owners = reachable.filter(
      (r) =>
        r.path.length &&
        !isBridge(dev(r.end.device)) &&
        iface(dev(r.end.device), r.end.port).ip === nextHop,
    );
    if (owners.length > 1)
      fail(
        `Duplicate IP ${nextHop} on this LAN.`,
        "DUPLICATE_IP",
        undefined,
        { advice: "Assign a unique address to each interface." },
      );
    const cacheKey = `${d.id}/${p.id}/${nextHop}`,
      cached = s.arp[cacheKey];
    if (!cached) {
      packet = `arp-${++messages}`;
      const request: Layer[] = [
        {
          name: "ARP request",
          kind: "link",
          fields: {
            "Sender IP": p.ip,
            "Sender MAC": p.mac,
            "Who has": nextHop,
          },
        },
      ];
      emit(
        "ARP: discover the next-hop MAC",
        `${d.name} knows the IP ${nextHop}, but Ethernet/Wi-Fi needs a MAC address. It broadcasts “Who has ${nextHop}?” on this LAN.`,
        request,
      );
      broadcast({ device: d.id, port: p.id }, request, "ARP");
    } else
      emit(
        "ARP cache hit",
        `${nextHop} → ${cached}. A cache entry does not create a physical connection.`,
        upper,
      );
    if (cached) facts({ IP: nextHop, MAC: cached });
    const owner = owners[0];
    if (!owner) {
      // The device that asked is the one left without an answer.
      at(d, "OS · ARP");
      const elsewhere = n.devices.find(
        (x) => !isBridge(x) && x.id !== d.id && active(x).some((q) => q.ip === nextHop),
      );
      const role =
        nextHop === p.gateway
          ? `its default gateway ${nextHop}`
          : d.routes.some((r) => r.via === nextHop)
            ? `the next hop ${nextHop} in its static route`
            : nextHop;
      // An address configured on an interface that is turned off still belongs to that device.
      const switchedOff = n.devices.find(
        (x) => !isBridge(x) && x.id !== d.id && x.interfaces.some((q) => !q.enabled && iface(x, q.id).ip === nextHop),
      );
      if (!elsewhere && switchedOff)
        fail(
          `ARP received no reply for ${nextHop}.`,
          "ARP_NO_PATH",
          undefined,
          { detail: `${switchedOff.name} has ${nextHop}, but on an interface that is turned off: a disabled interface neither sends nor receives frames.`, advice: `Turn on ${switchedOff.name}'s interface.` },
        );
      if (elsewhere)
        fail(
          `ARP received no reply for ${nextHop}.`,
          "ARP_NO_PATH",
          undefined,
          {
            detail: `${elsewhere.name} uses ${nextHop}, but no link-layer path connects it to ${d.name} ${p.id}.`,
            advice: `Check for a missing or disabled cable or Wi-Fi link, or whether ${elsewhere.name} is on another LAN behind a router.`,
          },
        );
      fail(
        `ARP received no reply for ${nextHop}.`,
        "ARP_NO_OWNER",
        undefined,
        { detail: `No device in this network uses ${nextHop}, so nobody can answer.`, advice: `Check ${d.name}'s setting for ${role}.` },
      );
    }
    const remote = dev(owner.end.device),
      rp = iface(remote, owner.end.port);
    if (!cached) {
      s.arp[`${remote.id}/${rp.id}/${p.ip}`] = p.mac;
      at(remote, "OS · ARP");
      const reply: Layer[] = [
        {
          name: "ARP reply",
          kind: "link",
          fields: {
            "Sender IP": rp.ip,
            "Sender MAC": rp.mac,
            "Target IP": p.ip,
          },
        },
      ];
      packet = `${packet}-reply`;
      emit("ARP reply", `${remote.name} answers with ${rp.mac}.`, reply);
      deliverPath(
        [...owner.path]
          .reverse()
          .map((h) => ({ ...h, from: h.to, to: h.from })),
        rp.mac,
        p.mac,
        reply,
        "ARP",
      );
      s.arp[cacheKey] = rp.mac;
      at(d, "OS · ARP");
      emit(
        "Save ARP mapping",
        `${d.name} remembers ${nextHop} → ${rp.mac}.`,
        reply,
      );
      facts({ IP: nextHop, MAC: rp.mac });
    }
    return { ...owner, mac: rp.mac };
  }
  function layers(m: IpMessage): Layer[] {
    const out: Layer[] = [];
    if (m.data)
      out.push({
        name: m.label,
        kind: "application",
        fields: { "UTF-8 bytes": bytes(m.data) },
        payload: m.data,
      });
    if (m.protocol === "TCP")
      out.push({
        name: "TCP segment",
        kind: "transport",
        fields: {
          "Source port": m.sport,
          "Destination port": m.dport,
          Flags: m.flags ?? "ACK",
          Sequence: m.seq ?? 0,
          Acknowledgement: m.ack ?? 0,
          "Payload bytes": bytes(m.data),
        },
      });
    if (m.protocol === "UDP")
      out.push({
        name: "UDP datagram",
        kind: "transport",
        fields: {
          "Source port": m.sport,
          "Destination port": m.dport,
          Length: 8 + bytes(m.data),
        },
      });
    if (m.protocol === "ICMP")
      out.push({
        name: "ICMP message",
        kind: "network",
        fields: { Type: m.label, Identifier: m.sport || m.dport },
      });
    out.push({
      name: "IPv4 packet",
      kind: "network",
      fields: {
        "Source IP": m.src,
        "Destination IP": m.dst,
        TTL: m.ttl,
        Protocol: m.protocol,
        Checksum: "Omitted in this teaching model",
      },
    });
    return out;
  }
  function route(d: Device, dst: string) {
    const candidates: {
      p: NetworkInterface;
      next: string;
      prefix: number;
      label: string;
    }[] = [];
    for (const p of active(d))
      if (p.ip && sameSubnet(p.ip, dst, p.prefix))
        candidates.push({
          p,
          next: dst,
          prefix: p.prefix,
          label: `Connected ${subnet(p.ip, p.prefix).network}/${p.prefix}`,
        });
    for (const r of d.routes)
      if (sameSubnet(r.network, dst, r.prefix)) {
        const p = active(d).find((p) => p.id === r.port && p.ip);
        if (p && sameSubnet(p.ip, r.via, p.prefix))
          candidates.push({
            p,
            next: r.via,
            prefix: r.prefix,
            label: `Static ${r.network}/${r.prefix}`,
          });
      }
    for (const p of active(d))
      if (p.ip && p.gateway && sameSubnet(p.ip, p.gateway, p.prefix))
        candidates.push({
          p,
          next: p.gateway,
          prefix: 0,
          label: "Default gateway",
        });
    candidates.sort((a, b) => b.prefix - a.prefix);
    // A router with no private interface is outside every private network: it cannot route back into one.
    if (
      !candidates.length &&
      d.kind === "router" &&
      isPrivate(dst) &&
      !active(d).some((p) => p.ip && isPrivate(p.ip))
    )
      fail(
        `${d.name} has no route to ${dst}. ${dst} is a private address (RFC 1918), and Internet routers do not route to private home networks.`,
        "NO_ROUTE_PRIVATE",
        undefined,
        { advice: "Replies reach a home network through its public address when the home router uses NAT." },
      );
    if (!candidates.length) {
      if (d.kind === "router")
        fail(
          `${d.name} has no route to ${dst}. None of its connected networks, static routes or default route matches ${dst}.`,
          "ROUTER_NO_ROUTE",
        );
      const own = active(d).filter((p) => p.ip),
        blocks = own
          .map((p) => {
            const b = subnet(p.ip, p.prefix);
            return `${b.network}/${p.prefix} (${b.first}–${b.last})`;
          })
          .join(", "),
        stray = own.find((p) => p.gateway);
      if (stray)
        fail(
          `${d.name} has no route to ${dst}, which is outside its subnet ${blocks}.`,
          "GATEWAY_NOT_LOCAL",
          undefined,
          { detail: `Its default gateway ${stray.gateway} is outside that subnet too, so ${d.name} cannot reach the gateway directly. A gateway must be on the local network.` },
        );
      fail(
        `${d.name} has no route to ${dst}, which is outside its subnet ${blocks}.`,
        "NO_GATEWAY",
        undefined,
        { detail: `No default gateway is set, so ${d.name} has nowhere to send it.` },
      );
    }
    return candidates[0];
  }
  /** Sends one IP packet. Every event until it is delivered (or dropped) carries the packet's id. */
  function send(start: Device, message: IpMessage, lose = false) {
    const outer = packet;
    packet = `ip-${++messages}`;
    try {
      return forward(start, message, lose);
    } finally {
      packet = outer;
    }
  }
  function forward(
    start: Device,
    message: IpMessage,
    lose = false,
  ): { device: Device; message: IpMessage } | null {
    let d = start,
      m = { ...message },
      ingress = "";
    const forwarded = new Set<string>();
    let looped = false;
    for (let count = 0; count < 256; count++) {
      at(d, "OS · IPv4");
      if (d.kind === "router" && d.nat && ingress === d.outside) {
        const map = s.nat.find(
          (e) =>
            e.router === d.id &&
            e.protocol === m.protocol &&
            e.external === m.dst &&
            e.externalPort === m.dport &&
            e.remote === m.src &&
            e.remotePort === m.sport,
        );
        if (map) {
          m = { ...m, dst: map.internal, dport: map.internalPort };
          emit(
            "Restore reply destination",
            `NAT maps ${map.external}:${map.externalPort} back to ${map.internal}:${map.internalPort}.`,
            layers(m),
          );
          facts({ Outside: `${map.external}:${map.externalPort}`, Inside: `${map.internal}:${map.internalPort}` });
        } else if (
          m.protocol !== "ICMP" &&
          active(d).some((p) => p.id === d.outside && p.ip === m.dst)
        )
          fail(
            `${d.name} received a packet for its public address ${m.dst}:${m.dport} from ${m.src}:${m.sport}, but its NAT table has no mapping for it. NAT only lets in replies to connections that started inside; this lab has no port forwarding, so the packet is dropped.`,
            "NAT_NO_MAPPING",
          );
      }
      if (active(d).some((p) => p.ip === m.dst)) {
        emit(
          "Deliver IP payload",
          `${d.name} owns ${m.dst}. IPv4 passes the payload to ${m.protocol}.`,
          layers(m),
        );
        return { device: d, message: m };
      }
      if (ingress && d.kind !== "router")
        fail(
          `${d.name} received a packet for ${m.dst}, which is not its address. It is an endpoint, not a router, so it discards the packet.`,
          "NOT_A_ROUTER",
          undefined,
          { advice: "Check the route that sent it here." },
        );
      if (ingress) {
        // The same router forwarding the same destination twice means routers are passing it in a circle.
        const key = `${d.id}>${m.dst}`;
        if (forwarded.has(key)) looped = true;
        forwarded.add(key);
        m.ttl--;
        emit(
          "Decrease TTL",
          `${d.name} is forwarding this packet. TTL is now ${m.ttl}. Switches and access points do not decrease TTL.`,
          layers(m),
        );
        if (m.ttl <= 0) {
          if (looped)
            fail(
              `TTL expired at ${d.name}. The packet had already passed through ${d.name} on its way to ${m.dst}: the routers are sending it around in a loop. The packet is discarded.`,
              "ROUTING_LOOP",
              undefined,
              { advice: `Fix the routes so they lead toward ${m.dst}.` },
            );
          fail(
            `TTL expired at ${d.name}. The packet is discarded.`,
            "TTL_EXPIRED",
            undefined,
            { advice: "Check for a routing loop or increase the starting TTL." },
          );
        }
      }
      const r = route(d, m.dst);
      emit(
        "Choose a route",
        `${r.label} is the longest matching prefix. Use ${r.p.id} and next hop ${r.next}. Destination IP remains ${m.dst}.`,
        layers(m),
      );
      facts({ Destination: m.dst, Route: r.label, Interface: r.p.id, "Next hop": r.next });
      if (
        d.kind === "router" &&
        d.nat &&
        r.p.id === d.outside &&
        ingress === d.inside
      ) {
        let map = s.nat.find(
          (e) =>
            e.router === d.id &&
            e.protocol === m.protocol &&
            e.internal === m.src &&
            e.internalPort === m.sport &&
            e.remote === m.dst &&
            e.remotePort === m.dport,
        );
        if (!map) {
          map = {
            router: d.id,
            protocol: m.protocol,
            internal: m.src,
            internalPort: m.sport,
            external: r.p.ip,
            externalPort: 62000 + s.nat.length,
            remote: m.dst,
            remotePort: m.dport,
          };
          s.nat.push(map);
        }
        m = { ...m, src: map.external, sport: map.externalPort };
        emit(
          "Translate source with NAT",
          `${map.internal}:${map.internalPort} → ${map.external}:${map.externalPort}. The mapping lets a response find the internal device.`,
          layers(m),
        );
        facts({ Inside: `${map.internal}:${map.internalPort}`, Outside: `${map.external}:${map.externalPort}` });
      }
      const found = arp(d, r.p, r.next, layers(m));
      at(d, "Network interface");
      emit(
        "Wrap in a link frame",
        `IPv4 supplies the packet. The ${r.p.medium === "wifi" ? "wireless" : "Ethernet"} interface addresses the next hop using ${found.mac}.`,
        layers(m),
      );
      facts({ "Next hop": r.next, "Next-hop MAC": found.mac, Destination: m.dst });
      if (lose) {
        const h = found.path[0];
        emit(
          "Drop TCP data segment",
          "The one-loss experiment discards this frame. The receiver cannot acknowledge these bytes.",
          layers(m),
          h
            ? { from: h.from.device, to: h.to.device, link: h.link }
            : undefined,
        );
        return null;
      }
      deliverPath(found.path, r.p.mac, found.mac, layers(m));
      d = dev(found.end.device);
      ingress = found.end.port;
    }
    // Unreachable: the TTL (at most 255) expires first.
    throw new Error("Routing exceeded the simulation hop limit.");
  }
  /** Sends a packet; a path failure on the way back from the destination is a reply problem. */
  function back(from: Device, m: IpMessage, lose = false) {
    if (from.id === action.source) return send(from, m, lose);
    try {
      return send(from, m, lose);
    } catch (error) {
      if (error instanceof SimulationFailure && pathReasons.has(error.reason))
        fail(
          `${from.name} received the request, but its reply could not get back to ${dev(action.source).name}. ${error.message}`,
          "REPLY_NO_PATH",
          error,
        );
      throw error;
    }
  }
  function sourceConfig(d: Device) {
    const p = active(d).find((p) => p.ip);
    if (!p)
      fail(
        active(d).some((q) => q.mode === "dhcp")
          ? `${d.name} has no usable IP address. It is set to get one from DHCP, but it has no current lease.`
          : `${d.name} has no usable IP address.`,
        "NO_ADDRESS",
        undefined,
        {
          advice: active(d).some((q) => q.mode === "dhcp")
            ? "Run DHCP (Configure automatically) to obtain one."
            : "Configure a static address or run DHCP to obtain a lease.",
        },
      );
    return p!;
  }
  function ensureWifi(d: Device) {
    if (d.kind !== "phone") return;
    at(d, "Network interface · Wi-Fi");
    const link = n.links.find(
      (l) =>
        l.medium === "wifi" && (l.a.device === d.id || l.b.device === d.id),
    );
    if (!link)
      fail(
        `${d.name} has no Wi-Fi link to an access point.`,
        "WIFI_NOT_JOINED",
        undefined,
        { advice: "Join a Wi-Fi access point before sending data." },
      );
    const ap = dev(link.a.device === d.id ? link.b.device : link.a.device);
    if (ap.ssid !== d.ssid)
      fail(
        `Wi-Fi association failed. ${d.name} found no network named “${d.ssid}”.`,
        "WIFI_SSID_NOT_FOUND",
        undefined,
        { detail: `${ap.name} offers “${ap.ssid}”.`, advice: `Make the network name on ${d.name} match the one ${ap.name} offers.` },
      );
    if (ap.password !== d.password)
      fail(
        `Wi-Fi association failed. ${d.name} found “${ap.ssid}”, but ${ap.name} rejected its passphrase, so it cannot join.`,
        "WIFI_WRONG_PASSPHRASE",
        undefined,
        { detail: `${d.name}'s passphrase does not match the one set on ${ap.name}.` },
      );
    emit(
      "Associate with Wi-Fi",
      `${d.name} joins “${ap.ssid}”. This models association and a passphrase check, not radio encryption.`,
      [],
    );
    facts({ SSID: ap.ssid, "Access point": ap.name });
  }
  try {
    const validation = validateNetwork(n);
    if (validation.length) fail(validation.join(" "), "INVALID_NETWORK");
    if (!n.devices.some((d) => d.id === action.source))
      fail("Choose a device in this network.", "INPUT_SOURCE");
    for (const [key, lease] of Object.entries(s.leases))
      if (lease.expires <= s.time) {
        delete s.leases[key];
        actor = lease.device;
        emit(
          "DHCP lease expired",
          "This address is no longer assigned to this device.",
          [],
        );
      }
    const client = dev(action.source);
    if (isBridge(client))
      fail("Select a PC, phone, router or server as the source.", "INPUT_SOURCE");
    ensureWifi(client);
    if (action.kind === "dhcp") {
      const port = active(client).find((p) => p.mode === "dhcp");
      if (!port)
        fail(
          `${client.name} has no interface set to DHCP, so it does not request an address.`,
          "DHCP_CLIENT_STATIC",
          undefined,
          { advice: "Set the client interface to DHCP before requesting an address." },
        );
      const cp = port!;
      const start = { device: client.id, port: cp.id },
        reachable = reach(start);
      const serverEntry = reachable.find((e) => {
        const d = dev(e.end.device);
        return d.dhcp.enabled && d.dhcp.port === e.end.port;
      });
      // With no server, the Discover is still broadcast; the run then shows who heard it.
      const server = serverEntry && dev(serverEntry.end.device),
        sp = serverEntry && iface(server!, serverEntry.end.port);
      dhcpContext = { client: client.id, server: server?.id ?? "" };
      const dhcpLayers = (name: string, data: string): Layer[] => [
        {
          name: `DHCP ${name}`,
          kind: "application",
          fields: { Message: name },
          payload: data,
        },
        {
          name: "UDP datagram",
          kind: "transport",
          fields: {
            "Source port": name === "Discover" || name === "Request" ? 68 : 67,
            "Destination port":
              name === "Discover" || name === "Request" ? 67 : 68,
          },
        },
        {
          name: "IPv4 packet",
          kind: "network",
          fields: {
            "Source IP":
              name === "Discover" || name === "Request" ? "0.0.0.0" : sp!.ip,
            "Destination IP": "255.255.255.255",
            Protocol: "UDP",
            TTL: 64,
          },
        },
      ];
      at(client, "OS · DHCP client");
      packet = `dhcp-${++messages}`;
      emit(
        "DHCP Discover",
        "The client broadcasts to find a server that can lend it an address.",
        dhcpLayers("Discover", "Looking for a DHCP server"),
      );
      broadcast(
        start,
        dhcpLayers("Discover", "Looking for a DHCP server"),
        "IPv4",
      );
      if (!server || !sp) {
        const heard = [
          ...new Set(
            reachable
              .map((e) => dev(e.end.device))
              .filter((d) => d.id !== client.id && !isBridge(d))
              .map((d) => d.name),
          ),
        ];
        at(client, "OS · DHCP client");
        fail(
          `No DHCP server is reachable on this LAN. ${client.name} broadcast a DHCP Discover${heard.length ? `; it reached ${heard.join(", ")}, but none of them runs a DHCP server on that network` : ", but it reached no other device"}, so nothing offered an address.`,
          "DHCP_NO_SERVER",
        );
      }
      const startIp = ipNumber(server.dhcp.start),
        endIp = ipNumber(server.dhcp.end);
      if (endIp < startIp || endIp - startIp > 4096)
        fail(
          "DHCP pool must contain at most 4097 addresses in ascending order.",
          "DHCP_POOL_INVALID",
        );
      const existing = s.leases[keyOf(client.id, cp.id)];
      let offered =
        existing &&
        existing.server === server.id &&
        ipNumber(existing.ip) >= startIp &&
        ipNumber(existing.ip) <= endIp &&
        sameSubnet(existing.ip, sp.ip, sp.prefix)
          ? existing.ip
          : "";
      for (let v = startIp; !offered && v <= endIp; v++) {
        const candidate = dotted(v);
        if (!sp.ip || !sameSubnet(candidate, sp.ip, sp.prefix)) continue;
        const block = subnet(sp.ip, sp.prefix);
        if (candidate === block.network || candidate === block.broadcast)
          continue;
        const occupied = reachable.some(
          (e) => iface(dev(e.end.device), e.end.port).ip === candidate,
        );
        if (!occupied) {
          offered = candidate;
          break;
        }
      }
      if (!offered)
        fail(
          `The DHCP pool has no available host address in the server interface subnet. ${server.name}'s pool ${server.dhcp.start}–${server.dhcp.end} has no address that is inside ${subnet(sp.ip, sp.prefix).network}/${sp.prefix} and not already used on this LAN.`,
          "DHCP_POOL_EMPTY",
        );
      at(server, "DHCP server");
      packet = `dhcp-${++messages}`;
      emit(
        "DHCP Offer",
        `${server.name} offers ${offered}/${sp.prefix}.`,
        dhcpLayers("Offer", offered),
      );
      broadcast(serverEntry.end, dhcpLayers("Offer", offered), "IPv4");
      at(client, "OS · DHCP client");
      packet = `dhcp-${++messages}`;
      emit(
        "DHCP Request",
        `${client.name} asks to use ${offered}.`,
        dhcpLayers("Request", offered),
      );
      broadcast(start, dhcpLayers("Request", offered), "IPv4");
      const settings = `${offered}, mask ${subnet(offered, sp.prefix).mask}, gateway ${server.dhcp.gateway}, DNS ${server.dhcp.dns}`;
      at(server, "DHCP server");
      packet = `dhcp-${++messages}`;
      emit(
        "DHCP ACK",
        `${server.name} confirms the lease: ${settings}. The client applies it when the ACK arrives.`,
        dhcpLayers("ACK", offered),
      );
      // The client applies the lease when the ACK reaches it, not when the server sends it.
      let applied = false;
      broadcast(serverEntry.end, dhcpLayers("ACK", offered), "IPv4", (d) => {
        if (d.id !== client.id) return;
        applied = true;
        s.leases[keyOf(client.id, cp.id)] = {
          device: client.id,
          port: cp.id,
          ip: offered,
          prefix: sp.prefix,
          gateway: server.dhcp.gateway,
          dns: server.dhcp.dns,
          expires: s.time + server.dhcp.leaseSeconds * 1000,
          server: server.id,
        };
        at(client, "OS · DHCP client");
        emit(
          "Apply DHCP lease",
          `${client.name} received the ACK and now uses ${settings}.`,
          [],
        );
      });
      // Unreachable: the ACK crosses the same links the Discover just reached the server on.
      if (!applied) throw new Error(`The DHCP ACK did not reach ${client.name}.`);
      packet = "";
      at(client, "OS · network settings");
      emit(
        "Configuration complete",
        "The lease is active for subsequent traffic in this session. Restarting the simulation releases acquired configuration.",
        [],
      );
      return {
        events,
        session: s,
        success: true,
        summary: `${client.name} received ${offered}. Ready to send.`,
      };
    }
    const cp = sourceConfig(client);
    let destination = action.target,
      host = destination,
      path = "/";
    if (action.kind === "http") {
      let url: URL;
      try {
        url = new URL(
          destination.includes("://") ? destination : `http://${destination}`,
        );
      } catch {
        fail("Enter a valid HTTP URL or IPv4 address.", "INPUT_URL");
      }
      if (url!.protocol !== "http:" || (url!.port && url!.port !== "80"))
        fail(
          "This lesson models HTTP on port 80. Use an http:// address.",
          "INPUT_PORT",
        );
      host = url!.hostname;
      path = url!.pathname + url!.search;
      destination = host;
      at(client, "Browser / application");
      emit(
        "Prepare HTTP request",
        `The application parses ${host}${path} and prepares HTTP text. Request construction can happen before TCP connects.`,
        [
          {
            name: "HTTP request",
            kind: "application",
            fields: { Method: "GET", Host: host },
            payload: `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
          },
        ],
      );
    }
    try {
      ipNumber(destination);
    } catch {
      const cached = s.dns[`${client.id}/${destination}`];
      if (cached) {
        at(client, "OS · DNS resolver");
        emit("DNS cache hit", `${destination} → ${cached}`, []);
        facts({ Name: destination, Address: cached });
        destination = cached;
      } else {
        if (!cp.dns)
          fail(
            "No DNS server is configured.",
            "DNS_NOT_CONFIGURED",
            undefined,
            { advice: "Enter its IP address or use an IP-literal URL." },
          );
        at(client, "OS · DNS resolver");
        emit(
          "DNS query",
          `Ask ${cp.dns} for the IPv4 address of ${destination}. Typical lookups use UDP port 53.`,
          [],
        );
        facts({ Name: destination, Server: cp.dns });
        const query: IpMessage = {
          src: route(client, cp.dns).p.ip,
          dst: cp.dns,
          protocol: "UDP",
          sport: 53000,
          dport: 53,
          ttl: 64,
          data: `A ${destination}`,
          label: "DNS query",
        };
        // Four different problems look alike from the client; each gets its own reason.
        const owner = n.devices.find((d) =>
          active(d).some((p) => p.ip === cp.dns),
        );
        let received: { device: Device; message: IpMessage };
        try {
          received = send(client, query)!;
        } catch (error) {
          if (!owner)
            fail(
              `No device in this network has the address ${cp.dns}, so nothing can answer the DNS query.`,
              "DNS_SERVER_ADDRESS",
              error,
              { detail: `${client.name}'s DNS server setting is probably wrong: it should be the address of a DNS server.` },
            );
          fail(
            `The DNS query could not reach ${owner.name} at ${cp.dns}. ${errorText(error)}`,
            "DNS_UNREACHABLE",
            error,
          );
        }
        const server = received.device;
        // ponytail: a device runs DNS when it has records; add an explicit service switch if learners need an empty DNS server.
        if (!Object.keys(server.records).length) {
          at(server, "OS · UDP");
          fail(
            `${server.name} (${cp.dns}) received the DNS query, but it does not run a DNS service: nothing listens on UDP port 53.`,
            "DNS_NO_SERVICE",
            undefined,
            { advice: `Check ${client.name}'s DNS server setting; it should be the address of a DNS server.` },
          );
        }
        const answer = server.records[destination];
        at(server, "DNS server");
        let response: ReturnType<typeof send>;
        try {
          response = send(server, {
            ...received.message,
            src: received.message.dst,
            dst: received.message.src,
            sport: 53,
            dport: received.message.sport,
            ttl: 64,
            data: answer
              ? `${destination} A ${answer}`
              : `${destination}: no such name (NXDOMAIN)`,
            label: answer ? "DNS answer" : "DNS error",
          });
        } catch (error) {
          fail(
            `${server.name} answered the DNS query, but the reply could not get back to ${client.name}. ${errorText(error)}`,
            "DNS_REPLY_UNREACHABLE",
            error,
          );
        }
        if (response?.device.id !== client.id)
          fail(
            `The DNS reply reached ${response?.device.name ?? "another device"} instead of ${client.name}.`,
            "REPLY_MISDELIVERED",
          );
        if (!answer) {
          at(client, "OS · DNS resolver");
          fail(
            `${server.name} answered that “${destination}” does not exist (NXDOMAIN). The DNS server is reachable and working.`,
            "DNS_NO_RECORD",
            undefined,
            { advice: `Check the name, or add an A record for it on ${server.name}.` },
          );
        }
        s.dns[`${client.id}/${destination}`] = answer;
        at(client, "OS · DNS resolver");
        emit("DNS answer", `${destination} → ${answer}`, []);
        facts({ Name: destination, Address: answer });
        destination = answer;
      }
    }
    const initialRoute = route(client, destination);
    const src = initialRoute.p.ip;
    // Check conflicts in the source broadcast domain before traffic leaves the host.
    if (
      reach({ device: client.id, port: initialRoute.p.id }).some(
        (e) =>
          e.path.length &&
          !isBridge(dev(e.end.device)) &&
          iface(dev(e.end.device), e.end.port).ip === src,
      )
    )
      fail(
        `Duplicate IP ${src} on the source LAN.`,
        "DUPLICATE_IP",
        undefined,
        { advice: "Assign a unique address to each interface." },
      );
    if (action.kind === "ping") {
      at(client, "Ping application");
      emit(
        "Create ICMP echo request",
        "Ping asks an IP endpoint to echo a message. ICMP sits directly inside IP; it has no TCP segment.",
        [],
      );
      facts({ Destination: destination });
      const request: IpMessage = {
        src,
        dst: destination,
        protocol: "ICMP",
        sport: 7,
        dport: 0,
        ttl: action.ttl ?? 64,
        data: "Kitab ping",
        label: "Echo request",
      };
      const received = send(client, request)!;
      at(received.device, "OS · ICMP");
      emit(
        "Create ICMP echo reply",
        "The destination builds a reply and performs its own route lookup.",
        layers(received.message),
      );
      const result = back(received.device, {
        ...received.message,
        src: received.message.dst,
        dst: received.message.src,
        sport: 0,
        dport: received.message.sport,
        ttl: 64,
        label: "Echo reply",
      });
      if (result?.device.id !== client.id)
        fail(
          `The echo reply reached ${result?.device.name ?? "another device"} instead of ${client.name}.`,
          "REPLY_MISDELIVERED",
        );
      at(client, "Ping application");
      emit(
        "Ping complete",
        "The echo reply arrived. Forward and return paths both work.",
        layers(result.message),
      );
      return {
        events,
        session: s,
        success: true,
        summary: "Ping succeeded. The reply arrived.",
      };
    }
    const connection = `${client.id}:51514 → ${destination}:80`;
    s.sockets[connection] = {
      owner: client.id,
      local: `${src}:51514`,
      remote: `${destination}:80`,
      sendBytes: 0,
      receivedBytes: 0,
    };
    s.tcp[connection] = "SYN-SENT";
    at(client, "Application → socket API");
    emit(
      "Create socket and connect",
      "The app receives a socket reference. The OS owns its buffers and TCP connection state. The socket is an interface to networking, not another protocol.",
      [],
    );
    facts({ Remote: `${destination}:80` });
    let clientSeq = 1000,
      serverSeq = 7000;
    const base: IpMessage = {
      src,
      dst: destination,
      protocol: "TCP",
      sport: 51514,
      dport: 80,
      ttl: action.ttl ?? 64,
      data: "",
      label: "HTTP",
      seq: clientSeq,
      ack: 0,
      flags: "SYN",
    };
    at(client, "OS · TCP");
    emit(
      "TCP SYN",
      "TCP requests a connection. SYN consumes one sequence number.",
      layers(base),
    );
    const syn = send(client, base)!;
    if (!syn.device.web.enabled)
      fail(
        `${syn.device.name} has no HTTP service listening on port 80.`,
        "HTTP_NO_LISTENER",
      );
    const server = syn.device;
    const reverse: IpMessage = {
      ...syn.message,
      src: syn.message.dst,
      dst: syn.message.src,
      sport: 80,
      dport: syn.message.sport,
      ttl: 64,
      seq: serverSeq,
      ack: ++clientSeq,
      flags: "SYN, ACK",
    };
    s.sockets[`${server.id}:80`] = {
      owner: server.id,
      local: `${syn.message.dst}:80`,
      remote: `${syn.message.src}:${syn.message.sport}`,
      sendBytes: 0,
      receivedBytes: 0,
    };
    s.buffers[`${server.id}:80`] = {
      next: clientSeq,
      delivered: "",
      pending: {},
      duplicates: 0,
    };
    s.buffers[connection] = {
      next: serverSeq + 1,
      delivered: "",
      pending: {},
      duplicates: 0,
    };
    s.tcp[`${server.id}:80`] = "SYN-RECEIVED";
    at(server, "OS · TCP");
    emit(
      "TCP SYN-ACK",
      "The server acknowledges the client SYN and sends its own SYN.",
      layers(reverse),
    );
    back(server, reverse);
    serverSeq++;
    send(client, { ...base, seq: clientSeq, ack: serverSeq, flags: "ACK" });
    s.tcp[connection] = "ESTABLISHED";
    s.tcp[`${server.id}:80`] = "ESTABLISHED";
    at(client, "OS · TCP");
    emit(
      "TCP connection established",
      "Both endpoints agree on the initial sequence numbers. HTTP bytes can now travel.",
      [],
    );
    const request = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
      body = server.web.body;
    const response = `HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${bytes(body)}\r\nConnection: close\r\n\r\n${body}`;
    let dropped = false;
    // Fixed 96-byte MSS. Split at Unicode code points to keep readable payload cards.
    function chunks(text: string) {
      const parts: string[] = [];
      let part = "";
      for (const c of text) {
        if (bytes(part + c) > 96) {
          parts.push(part);
          part = "";
        }
        part += c;
      }
      if (part) parts.push(part);
      return parts;
    }
    function transfer(
      sender: Device,
      template: IpMessage,
      text: string,
      responseDirection: boolean,
    ) {
      let reconstructed = "";
      for (const data of chunks(text)) {
        const seq = responseDirection ? serverSeq : clientSeq,
          ack = responseDirection ? clientSeq : serverSeq;
        const m = {
          ...template,
          flags: "PSH, ACK",
          seq,
          ack,
          data,
          label: responseDirection ? "HTTP response" : "HTTP request",
        };
        const senderSocket = responseDirection ? `${server.id}:80` : connection;
        const receiverSocket = responseDirection
          ? connection
          : `${server.id}:80`;
        s.sockets[senderSocket].sendBytes = bytes(data);
        at(sender, "Application → socket send buffer");
        emit(
          "Write application bytes",
          `The application writes ${bytes(data)} UTF-8 bytes into the socket send buffer.`,
          [
            {
              name: m.label,
              kind: "application",
              fields: { "UTF-8 bytes": bytes(data) },
              payload: data,
            },
          ],
        );
        at(sender, "OS · TCP");
        emit(
          "Create TCP segment",
          `TCP adds ports, flags, sequence ${seq} and acknowledgement ${ack}. The modeled maximum payload is 96 bytes.`,
          layers(m).filter((l) => l.kind !== "network"),
        );
        at(sender, "OS · IPv4");
        emit(
          "Create IPv4 packet",
          `IP wraps the segment with source ${m.src}, destination ${m.dst}, protocol TCP and TTL ${m.ttl}.`,
          layers(m),
        );
        let received = back(sender, m, !!action.dropOnce && !dropped);
        if (!received) {
          dropped = true;
          s.time += 1000;
          at(sender, "OS · TCP timer");
          emit(
            "Retransmit TCP segment",
            `No ACK arrived before the modeled timeout. Resend the same bytes beginning at sequence ${seq}.`,
            layers(m),
          );
          received = back(sender, m);
        }
        // Unreachable: only the one-loss experiment drops a segment, and only once.
        if (!received) throw new Error("TCP retransmission failed.");
        s.buffers[receiverSocket] = receiveBytes(
          s.buffers[receiverSocket],
          seq,
          data,
        );
        reconstructed = s.buffers[receiverSocket].delivered;
        s.sockets[receiverSocket].receivedBytes = bytes(reconstructed);
        if (responseDirection) serverSeq += bytes(data);
        else clientSeq += bytes(data);
        const reply: IpMessage = {
          ...received!.message,
          src: received!.message.dst,
          dst: received!.message.src,
          sport: received!.message.dport,
          dport: received!.message.sport,
          seq: responseDirection ? clientSeq : serverSeq,
          ack: s.buffers[receiverSocket].next,
          flags: "ACK",
          data: "",
          ttl: 64,
        };
        at(received!.device, "OS · TCP receive buffer");
        emit(
          "Acknowledge received bytes",
          `Received ${bytes(data)} bytes. ACK ${reply.ack} means “send me the byte at this position next.”`,
          layers(reply),
        );
        back(received!.device, reply);
        s.sockets[senderSocket].sendBytes = 0;
      }
      return reconstructed;
    }
    transfer(
      client,
      { ...base, seq: clientSeq, ack: serverSeq },
      request,
      false,
    );
    at(server, "Server application");
    emit(
      "Server reads HTTP request",
      "TCP hands the reassembled request to the listening server socket. The server application reads the HTTP method and path.",
      [
        {
          name: "HTTP request",
          kind: "application",
          fields: { Bytes: bytes(request) },
          payload: request,
        },
      ],
    );
    at(server, "Server application");
    emit(
      "Build HTTP response",
      "The server prepares status, headers and content. Content-Length counts body bytes, not characters.",
      [
        {
          name: "HTTP response",
          kind: "application",
          fields: { "Body bytes": bytes(body) },
          payload: response,
        },
      ],
    );
    transfer(server, reverse, response, true);
    at(client, "Browser / application");
    emit(
      "Read reassembled response",
      "TCP delivers the byte stream through the socket. The application reads the HTTP response and displays its body as text.",
      [
        {
          name: "HTTP response",
          kind: "application",
          fields: { Status: 200 },
          payload: body,
        },
      ],
    );
    s.tcp[connection] = "FIN-WAIT-1";
    send(client, {
      ...base,
      seq: clientSeq,
      ack: serverSeq,
      flags: "FIN, ACK",
    });
    clientSeq++;
    back(server, { ...reverse, seq: serverSeq, ack: clientSeq, flags: "ACK" });
    back(server, {
      ...reverse,
      seq: serverSeq,
      ack: clientSeq,
      flags: "FIN, ACK",
    });
    serverSeq++;
    send(client, { ...base, seq: clientSeq, ack: serverSeq, flags: "ACK" });
    s.tcp[connection] = "TIME-WAIT (timer simplified)";
    s.tcp[`${server.id}:80`] = "CLOSED";
    at(client, "Browser / application");
    emit(
      "HTTP journey complete",
      "The response arrived and the connection exchanged FIN/ACK. The client retains TIME-WAIT state; timer cleanup is simplified.",
      [
        {
          name: "HTTP response",
          kind: "application",
          fields: { Status: 200 },
          payload: body,
        },
      ],
    );
    return {
      events,
      session: s,
      success: true,
      summary: "HTTP 200 OK. Your request and response completed the journey.",
    };
  } catch (error) {
    const message = errorText(error);
    const failure =
      error instanceof SimulationFailure ? failureOf(error) : undefined;
    // The stop is shown where the deepest cause was detected.
    let root = failure;
    while (root?.cause) root = root.cause;
    if (root) actor = root.device;
    if (events.length >= 9999) events.pop();
    emit("Delivery stopped", message, current, undefined, true);
    const last = events[events.length - 1];
    if (failure) Object.assign(last, { reason: failure.reason, failure });
    return { events, session: s, success: false, summary: message, reason: failure?.reason, failure };
  }
}
