import { z } from "zod";
import {
  isBridge,
  type Network,
  type Endpoint,
  type Medium,
  type Device,
} from "./model.ts";
export function ipNumber(ip: string): number {
  if (
    !/^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$/.test(ip) ||
    ip.split(".").some((n) => Number(n) > 255)
  )
    throw new Error(
      `“${ip}” is not an IPv4 address. Use four numbers from 0 to 255.`,
    );
  return ip.split(".").reduce((n, v) => n * 256 + Number(v), 0) >>> 0;
}
export const dotted = (n: number) =>
  [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");
export function mask(prefix: number) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32)
    throw new Error("Prefix must be from 0 to 32.");
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
}
export const sameSubnet = (a: string, b: string, p: number) =>
  (ipNumber(a) & mask(p)) === (ipNumber(b) & mask(p));
export function subnet(ip: string, prefix: number) {
  const m = mask(prefix),
    n = (ipNumber(ip) & m) >>> 0,
    b = (n | ~m) >>> 0;
  return {
    network: dotted(n),
    broadcast: dotted(b),
    mask: dotted(m),
    first: dotted(n + 1),
    last: dotted(b - 1),
    usable: Math.max(0, 2 ** (32 - prefix) - 2),
  };
}
const text = z.string().max(200),
  address = z
    .string()
    .max(15)
    .refine((v) => {
      try {
        return !v || ipNumber(v) >= 0;
      } catch {
        return false;
      }
    }, "Invalid IPv4 address");
const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const endpoint = z.object({ device: identifier, port: identifier }).strict();
const schema = z
  .object({
    version: z.literal(1),
    name: text,
    devices: z
      .array(
        z
          .object({
            id: identifier,
            name: text.min(1),
            kind: z.enum(["pc", "phone", "switch", "router", "ap", "server"]),
            x: z.number().finite().min(0).max(3000),
            y: z.number().finite().min(0).max(2000),
            group: text,
            interfaces: z
              .array(
                z
                  .object({
                    id: identifier,
                    medium: z.enum(["ethernet", "wifi"]),
                    mac: z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i),
                    ip: address,
                    prefix: z.number().int().min(1).max(30),
                    gateway: address,
                    dns: address,
                    mode: z.enum(["static", "dhcp"]),
                    enabled: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(12),
            routes: z
              .array(
                z
                  .object({
                    network: address.refine(Boolean),
                    prefix: z.number().int().min(0).max(32),
                    via: address.refine(Boolean),
                    port: text,
                  })
                  .strict(),
              )
              .max(40),
            ssid: text,
            password: text,
            nat: z.boolean(),
            inside: text,
            outside: text,
            dhcp: z
              .object({
                enabled: z.boolean(),
                port: text,
                start: address,
                end: address,
                gateway: address,
                dns: address,
                leaseSeconds: z.number().int().min(30).max(86400),
              })
              .strict(),
            records: z
              .record(z.string().min(1).max(253), address.refine(Boolean))
              .refine((o) => Object.keys(o).length <= 50),
            web: z
              .object({ enabled: z.boolean(), body: z.string().max(4096) })
              .strict(),
          })
          .strict(),
      )
      .max(40),
    links: z
      .array(
        z
          .object({
            id: identifier,
            a: endpoint,
            b: endpoint,
            medium: z.enum(["ethernet", "wifi"]),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();
export function portOf(n: Network, e: Endpoint) {
  const d = n.devices.find((d) => d.id === e.device);
  const p = d?.interfaces.find((p) => p.id === e.port);
  if (!d || !p)
    throw new Error("A connection refers to a missing device or port.");
  return { device: d, port: p };
}
export function validateNetwork(n: Network): string[] {
  const parsed = schema.safeParse(n);
  if (!parsed.success)
    return parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .slice(0, 8);
  const errors: string[] = [];
  const ids = new Set<string>(),
    used = new Set<string>(),
    parents = new Map<string, string>();
  const root = (id: string): string =>
    parents.has(id) ? root(parents.get(id)!) : id;
  for (const d of n.devices) {
    if (ids.has(d.id)) errors.push("Device IDs must be unique.");
    ids.add(d.id);
    if (new Set(d.interfaces.map((p) => p.id)).size !== d.interfaces.length)
      errors.push(`${d.name} has duplicate port names.`);
    for (const p of d.interfaces)
      if (p.ip && !isBridge(d)) {
        const s = subnet(p.ip, p.prefix);
        if (p.ip === s.network || p.ip === s.broadcast)
          errors.push(
            `${d.name}: use a host address between ${s.first} and ${s.last}.`,
          );
      }
    if (
      d.nat &&
      (!d.interfaces.some((p) => p.id === d.inside) ||
        !d.interfaces.some((p) => p.id === d.outside) ||
        d.inside === d.outside)
    )
      errors.push(
        `${d.name}: NAT needs distinct existing inside and outside interfaces.`,
      );
    if (d.dhcp.enabled && !d.interfaces.some((p) => p.id === d.dhcp.port))
      errors.push(`${d.name}: choose an existing DHCP interface.`);
    if (d.routes.some((r) => !d.interfaces.some((p) => p.id === r.port)))
      errors.push(`${d.name}: a route refers to a missing interface.`);
  }
  const linkIds = new Set<string>();
  for (const l of n.links)
    try {
      if (linkIds.has(l.id)) errors.push("Link IDs must be unique.");
      linkIds.add(l.id);
      const a = portOf(n, l.a),
        b = portOf(n, l.b);
      if (l.a.device === l.b.device)
        errors.push("Connect two different devices.");
      if (a.port.medium !== l.medium || b.port.medium !== l.medium)
        errors.push("The connection medium must match both ports.");
      if (
        l.medium === "wifi" &&
        !(
          (a.device.kind === "ap" && b.device.kind === "phone") ||
          (b.device.kind === "ap" && a.device.kind === "phone")
        )
      )
        errors.push("Associate a phone with an access point.");
      for (const e of [a, b]) {
        const k = `${e.device.id}/${e.port.id}`;
        if (used.has(k) && !(l.medium === "wifi" && e.device.kind === "ap"))
          errors.push(
            `${e.device.name} ${e.port.id} already has a connection.`,
          );
        used.add(k);
      }
      // Only bridges propagate a broadcast between ports. Routing loops are handled by TTL.
      if (isBridge(a.device) && isBridge(b.device)) {
        const ar = root(a.device.id),
          br = root(b.device.id);
        if (ar === br)
          errors.push(
            "This creates a bridge loop. Spanning tree is not modeled.",
          );
        else parents.set(ar, br);
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  return [...new Set(errors)];
}
export function importNetwork(text: string): Network {
  if (text.length > 1000000) throw new Error("Network file is too large.");
  const n = schema.parse(JSON.parse(text));
  const errors = validateNetwork(n);
  if (errors.length) throw new Error(errors.join(" "));
  return n;
}
export function connect(
  n: Network,
  a: Endpoint,
  b: Endpoint,
  medium: Medium,
): Network {
  const next = structuredClone(n);
  next.links.push({
    id: `link-${Date.now()}-${next.links.length}`,
    a,
    b,
    medium,
  });
  const errors = validateNetwork(next);
  if (errors.length) throw new Error(errors.join(" "));
  return next;
}
export function deviceDescription(d: Device) {
  return {
    pc: "Runs applications. Its operating system handles sockets, TCP and IP.",
    phone: "A wireless client. It joins an access point before using IP.",
    switch:
      "Connects devices in a LAN and forwards frames using MAC addresses.",
    router:
      "Connects IP networks. It chooses where to forward a packet using its routing table.",
    ap: "An access point bridges Wi-Fi devices to the wired LAN.",
    server: "Runs services that answer requests, such as a website or DNS.",
  }[d.kind];
}
