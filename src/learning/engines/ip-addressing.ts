import { z } from "zod";
import type { EngineAdapter, Entity, Fact, FrameDraft } from "../types.ts";

const params = z.object({ prefix: z.union([z.literal(24), z.literal(25)]), target: z.enum(["phone", "printer", "web"]) }).strict();
const client = "192.168.1.10";
const gateway = "192.168.1.1";
const targets = {
  phone: { label: "Phone", address: "192.168.1.25", mac: "02:00:00:00:00:25" },
  printer: { label: "Printer", address: "192.168.1.130", mac: "02:00:00:00:00:82" },
  web: { label: "Web server", address: "198.51.100.20", mac: null },
} as const;

function addressNumber(address: string) {
  return address.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);
}

function dotted(value: number) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function maskFor(prefix: number) {
  return (0xffffffff << (32 - prefix)) >>> 0;
}

function networkOf(address: string, mask: number) {
  return dotted((addressNumber(address) & mask) >>> 0);
}

function subnetBlock(address: string, prefix: number) {
  const first = addressNumber(networkOf(address, maskFor(prefix)));
  const total = 2 ** (32 - prefix);
  const last = first + total - 1;
  return {
    cidr: `${dotted(first)}/${prefix}`, network: dotted(first), broadcast: dotted(last),
    firstHost: dotted(first + 1), lastHost: dotted(last - 1), total, usable: total - 2,
  };
}

const original = subnetBlock(client, 24);
const split = [subnetBlock(client, 25), subnetBlock(targets.printer.address, 25)];
const natPublic = "203.0.113.8";
const natEntries = [
  { device: "PC", inside: `${client}:51514`, outside: `${natPublic}:62001` },
  { device: "Phone", inside: `${targets.phone.address}:51514`, outside: `${natPublic}:62002` },
];
const serverEndpoint = `${targets.web.address}:80`;

function example({ prefix, target }: z.infer<typeof params>) {
  const mask = maskFor(prefix);
  const destination = targets[target];
  const connectedSubnet = subnetBlock(client, prefix);
  const clientNetwork = connectedSubnet.network;
  const destinationNetwork = networkOf(destination.address, mask);
  const direct = clientNetwork === destinationNetwork;
  const nextHop = direct ? destination.address : gateway;
  const nextHopMac = (direct && destination.mac) || "02:00:00:00:00:01";
  return { prefix, client, gateway, phone: targets.phone.address, destination, mask: dotted(mask), connectedSubnet, clientNetwork, destinationNetwork, direct, nextHop, nextHopMac, original, split, natEntries, natPublic };
}

type View = "lan" | "interfaces" | "subnet" | "address" | "mask" | "ranges" | "routes" | "link" | "nat-out" | "nat-in" | "handoff";
export type IpAddressingData = ReturnType<typeof example> & {
  view: View;
  packet?: { before: [string, string]; after: [string, string] };
};

const entities: Record<string, Entity> = {
  client: { id: "client", label: "PC", kind: "interface" },
  phone: { id: "phone", label: "Phone", kind: "interface" },
  gateway: { id: "gateway", label: "Home router", kind: "interface" },
  mask: { id: "mask", label: "Subnet mask", kind: "mask" },
  subnet: { id: "subnet", label: "PC's subnet", kind: "subnet" },
  ranges: { id: "ranges", label: "Subnet ranges", kind: "subnet" },
  route: { id: "route", label: "Chosen route", kind: "route" },
  nat: { id: "nat", label: "NAT translation", kind: "translation" },
};

export const ipAddressingAdapter: EngineAdapter<z.infer<typeof params>, IpAddressingData> = {
  id: "ip-addressing", version: "1.0.0", title: "IP Addresses & Subnets",
  params,
  vocabulary: ["lan", "wan", "network", "interface", "ipv4", "ip", "address", "subnet", "prefix", "mask", "bit", "octet", "binary", "cidr", "broadcast", "host", "router", "route", "gateway", "arp", "mac", "dhcp", "frame", "packet", "nat", "port", "private", "public", "source", "destination", "next hop"],
  build(values) {
    const data = example(values);
    const { destination, direct, nextHop, prefix, mask, clientNetwork, destinationNetwork } = data;
    const frames: FrameDraft<IpAddressingData>[] = [];
    function add(view: View, title: string, level: string, actor: string, objects: string[], facts: Fact[], packet?: IpAddressingData["packet"]) {
      frames.push({
        id: view, title, narration: title, level, actor, entities: objects.map((id) => entities[id]),
        focus: objects.slice(0, 1), facts, durationMs: 950, data: { ...data, view, packet },
      });
    }
    const clientFact = { id: "client-ip", label: "PC interface", value: client, entityId: "client" };
    const phoneFact = { id: "phone-ip", label: "Phone interface", value: targets.phone.address, entityId: "phone" };
    const gatewayFact = { id: "gateway-ip", label: "Router LAN IP", value: gateway, entityId: "gateway" };
    const destinationFact = { id: "destination-ip", label: "Destination IP", value: destination.address, entityId: "route" };
    const maskFacts = [
      { id: "prefix", label: "Prefix length", value: prefix, entityId: "mask" },
      { id: "mask", label: "Subnet mask", value: mask, entityId: "mask" },
    ];
    const networkFacts = [
      { id: "client-network", label: "PC network", value: clientNetwork, entityId: "mask" },
      { id: "destination-network", label: "Destination masked with PC's mask", value: destinationNetwork, entityId: "mask" },
    ];
    const routeFacts = [
      destinationFact,
      { id: "destination-name", label: "Destination", value: destination.label, entityId: "route" },
      { id: "next-hop", label: "Next hop", value: nextHop, entityId: "route" },
      { id: "route-type", label: "Delivery", value: direct ? "Direct on the LAN" : "Via the default gateway", entityId: "route" },
    ];

    add("lan", "Meet your local network", "local", "PC, phone and home router", ["client", "phone", "gateway"], [clientFact, phoneFact, gatewayFact]);
    add("interfaces", "An address belongs to an interface", "local", "Home router", ["gateway", "client", "phone"], [
      gatewayFact, clientFact, phoneFact, { id: "router-wan", label: "Router WAN IP", value: natPublic, entityId: "gateway" },
    ]);
    add("subnet", "Which addresses count as local?", "addressing", "PC network settings", ["subnet"], [
      { id: "connected-subnet", label: "PC's subnet", value: data.connectedSubnet.cidr, entityId: "subnet" },
      { id: "block-first", label: "Start of address block", value: data.connectedSubnet.network, entityId: "subnet" },
      { id: "block-last", label: "End of address block", value: data.connectedSubnet.broadcast, entityId: "subnet" },
      { id: "destination-ip", label: "Destination IP", value: destination.address, entityId: "subnet" },
      { id: "in-subnet", label: "Destination in this subnet", value: direct, entityId: "subnet" },
    ]);
    add("address", "Four numbers, 32 bits", "addressing", "PC network settings", ["client", "mask"], [clientFact, ...maskFacts]);
    add("mask", "Apply the subnet mask", "addressing", "PC operating system", ["mask", "client", "route"], [clientFact, destinationFact, ...maskFacts, ...networkFacts]);
    add("ranges", "Split one subnet into two", "addressing", "Network administrator", ["ranges"], [
      { id: "parent-subnet", label: "Original subnet", value: original.cidr, entityId: "ranges" },
      { id: "lower-subnet", label: "Lower half", value: split[0].cidr, entityId: "ranges" },
      { id: "upper-subnet", label: "Upper half", value: split[1].cidr, entityId: "ranges" },
      { id: "half-size", label: "Addresses per half", value: split[0].total, entityId: "ranges" },
      { id: "usable", label: "Usable host addresses per half", value: split[0].usable, entityId: "ranges" },
    ]);
    add("routes", "Pick the next hop", "forwarding", "PC routing table", ["route", "mask", "gateway"], [
      ...routeFacts, ...maskFacts, ...networkFacts, gatewayFact,
      { id: "connected-route", label: "Connected route", value: `${clientNetwork}/${prefix}`, entityId: "route" },
    ]);
    add("link", "Send to the next hop on the LAN", "forwarding", "PC network interface", ["route"], [
      ...routeFacts, { id: "next-hop-mac", label: "Frame destination MAC", value: data.nextHopMac, entityId: "route" },
    ]);
    const [pc, phone] = natEntries;
    for (const outbound of [true, false]) {
      const packet: NonNullable<IpAddressingData["packet"]> = outbound
        ? { before: [pc.inside, serverEndpoint], after: [pc.outside, serverEndpoint] }
        : { before: [serverEndpoint, pc.outside], after: [serverEndpoint, pc.inside] };
      add(outbound ? "nat-out" : "nat-in", outbound ? "Rewrite the outgoing source" : "Restore the reply destination", "translation",
        "Home router NAT table", ["nat"], [
          { id: "packet-before", label: "Before translation", value: packet.before.join(" → "), entityId: "nat" },
          { id: "packet-after", label: "After translation", value: packet.after.join(" → "), entityId: "nat" },
          { id: "pc-mapping", label: "PC NAT entry", value: `${pc.inside} ↔ ${pc.outside}`, entityId: "nat" },
          { id: "phone-mapping", label: "Phone NAT entry", value: `${phone.inside} ↔ ${phone.outside}`, entityId: "nat" },
        ], packet);
    }
    add("handoff", "Find this decision in Packet Journey", "forwarding", "Simulated IPv4 routing code", ["route"], [
      { id: "trace-destination", label: "Packet Journey destination", value: targets.web.address, entityId: "route" },
      { id: "trace-next-hop", label: "Client next hop in Packet Journey", value: "192.0.2.1", entityId: "route" },
      { id: "trace-method", label: "C# method", value: "Ipv4.LookupRoute()", entityId: "route" },
    ]);
    return {
      frames,
      outcome: { mask, clientNetwork, destinationNetwork, destination: destination.address, nextHop, direct },
      outcomeLabels: { mask: "Subnet mask", clientNetwork: "PC network", destinationNetwork: "Destination masked with PC's mask", destination: "Destination", nextHop: "Next hop", direct: "Direct delivery" },
    };
  },
};
