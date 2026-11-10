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
/** Deterministic cause of a stopped simulation, for explanations and challenge feedback. */
export type FailureReason =
  // What the learner typed, not the network: shown next to the form.
  | "INPUT_SOURCE" // the source is missing or is a switch / access point
  | "INPUT_URL" // not a valid URL or IPv4 address
  | "INPUT_PORT" // not http:// on port 80
  | "INVALID_NETWORK" // the network file breaks a model rule (e.g. an invalid address)
  | "SIMULATION_LIMIT" // the 10,000-event safety limit
  // Wi-Fi
  | "WIFI_NOT_JOINED" // the phone has no Wi-Fi link to an access point
  | "WIFI_SSID_NOT_FOUND" // the phone looks for a different network name
  | "WIFI_WRONG_PASSPHRASE" // the network name matches, the passphrase does not
  // Addressing, ARP and switching
  | "NO_ADDRESS" // the source has no usable IP address
  | "DUPLICATE_IP" // two interfaces on one LAN use the same address
  | "ARP_NO_OWNER" // no device uses the next-hop address
  | "ARP_NO_PATH" // a device uses it, but no link-layer path reaches it
  | "SWITCH_STALE_MAC" // a switch's MAC table points to a port that no longer leads there
  // Routing
  | "NO_GATEWAY" // a host's destination is outside its subnets and it has no gateway
  | "GATEWAY_NOT_LOCAL" // a host's gateway is outside its own subnet
  | "ROUTER_NO_ROUTE" // a router has no matching route
  | "NO_ROUTE_PRIVATE" // a router outside a private network has no route to a private address
  | "NOT_A_ROUTER" // a host received a packet for another address
  | "TTL_EXPIRED" // the hop limit reached zero
  | "ROUTING_LOOP" // the hop limit reached zero because routers sent the packet in a loop
  // NAT
  | "NAT_NO_MAPPING" // a packet arrived at the public address with no matching mapping
  // DHCP
  | "DHCP_CLIENT_STATIC" // the client's interface is not set to DHCP
  | "DHCP_NO_SERVER" // no DHCP server on the client's LAN
  | "DHCP_POOL_INVALID" // the pool range is empty or too large
  | "DHCP_POOL_EMPTY" // every pool address is in use or outside the subnet
  | "DHCP_LEASE_EXPIRED" // the source's lease ended during the transfer
  // DNS
  | "DNS_NOT_CONFIGURED" // the client has no DNS server address
  | "DNS_SERVER_ADDRESS" // no device has the configured DNS server address
  | "DNS_UNREACHABLE" // the DNS server exists but the query could not reach it
  | "DNS_NO_SERVICE" // the query arrived at a device that does not run DNS
  | "DNS_NO_RECORD" // a DNS server answered that the name does not exist
  | "DNS_REPLY_UNREACHABLE" // the DNS server answered but the reply could not return
  // Replies, TCP and HTTP
  | "REPLY_NO_PATH" // the request arrived; the reply could not get back
  | "REPLY_MISDELIVERED" // a reply reached a different device than the one that asked
  | "HTTP_NO_LISTENER"; // nothing listens on TCP port 80
/** A failure, the device where it was detected, and the failure that caused it, if any. */
export type Failure = {
  reason: FailureReason;
  device: string;
  message: string;
  cause?: Failure;
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
  reason?: FailureReason;
  failure?: Failure;
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
  reason?: FailureReason;
  failure?: Failure;
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
