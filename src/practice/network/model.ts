import type { ReceiveBuffer } from "./transport.ts";
export type DeviceKind = "pc" | "phone" | "switch" | "router" | "ap" | "server";
export type Medium = "ethernet" | "wifi";
export type Endpoint = { device: string; port: string };
export type NetworkInterface = {
  id: string;
  medium: Medium;
  mac: string;
  ip: string;
  prefix: number;
  gateway: string;
  dns: string;
  mode: "static" | "dhcp";
  enabled: boolean;
};
export type StaticRoute = {
  network: string;
  prefix: number;
  via: string;
  port: string;
};
export type Device = {
  id: string;
  name: string;
  kind: DeviceKind;
  x: number;
  y: number;
  group: string;
  interfaces: NetworkInterface[];
  routes: StaticRoute[];
  ssid: string;
  password: string;
  nat: boolean;
  inside: string;
  outside: string;
  dhcp: {
    enabled: boolean;
    port: string;
    start: string;
    end: string;
    gateway: string;
    dns: string;
    leaseSeconds: number;
  };
  records: Record<string, string>;
  web: { enabled: boolean; body: string };
};
export type Link = { id: string; a: Endpoint; b: Endpoint; medium: Medium };
export type Network = {
  version: 1;
  name: string;
  devices: Device[];
  links: Link[];
};
export type Lease = {
  device: string;
  port: string;
  ip: string;
  prefix: number;
  gateway: string;
  dns: string;
  expires: number;
  server: string;
};
export type NatEntry = {
  router: string;
  protocol: string;
  internal: string;
  internalPort: number;
  external: string;
  externalPort: number;
  remote: string;
  remotePort: number;
};
export type SocketState = {
  owner: string;
  local: string;
  remote: string;
  sendBytes: number;
  receivedBytes: number;
};
export type Session = {
  buffers: Record<string, ReceiveBuffer>;
  sockets: Record<string, SocketState>;
  time: number;
  leases: Record<string, Lease>;
  arp: Record<string, string>;
  mac: Record<string, string>;
  nat: NatEntry[];
  tcp: Record<string, string>;
  dns: Record<string, string>;
};
export type Layer = {
  name: string;
  kind: "application" | "transport" | "network" | "link";
  fields: Record<string, string | number>;
  payload?: string;
};
export type TraceEvent = {
  id: number;
  time: number;
  actor: string;
  location: string;
  title: string;
  explanation: string;
  layers: Layer[];
  snapshot: Session;
  hop?: { from: string; to: string; link: string };
  error?: boolean;
  // Teaching context, not fields transmitted inside a packet. Device IDs stay unambiguous.
  dhcpContext?: { client: string; server: string };
};
export type Action = {
  kind: "dhcp" | "ping" | "http";
  source: string;
  target: string;
  payload?: string;
  ttl?: number;
  dropOnce?: boolean;
};
export type Trace = {
  events: TraceEvent[];
  session: Session;
  success: boolean;
  summary: string;
};
export const keyOf = (device: string, port: string) => `${device}/${port}`;
export function createDevice(
  kind: DeviceKind,
  id: string,
  x = 200,
  y = 220,
): Device {
  const hash = Array.from(id).reduce(
    (n, c) => (n * 31 + c.charCodeAt(0)) >>> 0,
    7,
  );
  const ports =
    kind === "switch"
      ? ["p1", "p2", "p3", "p4", "p5", "p6"]
      : kind === "router"
        ? ["lan", "wan"]
        : kind === "ap"
          ? ["eth0", "wlan0"]
          : kind === "phone"
            ? ["wlan0"]
            : ["eth0"];
  return {
    id,
    name:
      kind === "ap"
        ? "Access point"
        : kind === "pc"
          ? "PC"
          : kind[0].toUpperCase() + kind.slice(1),
    kind,
    x,
    y,
    group: "",
    interfaces: ports.map((port, i) => ({
      id: port,
      medium: port === "wlan0" ? "wifi" : "ethernet",
      mac: `02:${[(hash >>> 24) & 255, (hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255, i].map((n) => n.toString(16).padStart(2, "0")).join(":")}`,
      ip: "",
      prefix: 24,
      gateway: "",
      dns: "",
      mode: "static",
      enabled: true,
    })),
    routes: [],
    ssid: "Kitab Wi-Fi",
    password: "learn123",
    nat: false,
    inside: "lan",
    outside: "wan",
    dhcp: {
      enabled: false,
      port: ports[0],
      start: "192.168.1.100",
      end: "192.168.1.150",
      gateway: "192.168.1.1",
      dns: "198.51.100.53",
      leaseSeconds: 3600,
    },
    records: {},
    web: {
      enabled: kind === "server",
      body: "Hello from your network!\nYou built the path that brought this page here.",
    },
  };
}
export const isBridge = (device: Device) =>
  device.kind === "switch" || device.kind === "ap";
