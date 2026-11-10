// Following one message through the network, from the trace alone. Only fields the engine actually
// puts in its headers are shown; nothing is computed that the simulation does not model.
import type { Layer, Network, TraceEvent } from "./model.ts";

export type Hop = {
  /** The event where this frame was transmitted. */
  index: number;
  frame: number;
  from: string;
  to: string;
  fields: Record<string, string | number>;
};
export type Change = { field: string; before: string | number; after: string | number; why: string };

/** Every header field of an event, keyed by name ("Source IP", "TTL", …). */
export function headerFields(layers: Layer[]) {
  const out: Record<string, string | number> = {};
  for (const l of layers)
    for (const [k, v] of Object.entries(l.fields))
      if (!(k in out) && !context.has(k)) out[k] = v;
  return out;
}
// Lab context shown with a frame; not bits in any header.
const context = new Set(["Medium", "Outgoing port", "Access point", "Checksum"]);

/** The links a message crossed, in order: one row per transmitted frame. */
export function trip(events: TraceEvent[], packet: string | undefined): Hop[] {
  if (!packet) return [];
  return events.flatMap((e, index) =>
    e.packet === packet && e.hop && e.frame
      ? [{ index, frame: e.frame, from: e.hop.from, to: e.hop.to, fields: headerFields(e.layers) }]
      : [],
  );
}

/** What a device rewrote in the message between the previous hop and this one, and why. */
export function changesAt(events: TraceEvent[], index: number, network: Network): Change[] {
  const e = events[index];
  const hops = trip(events, e.packet);
  const at = hops.findIndex((h) => h.index === index);
  if (at < 1) return [];
  const before = hops[at - 1],
    now = hops[at];
  const between = events.slice(before.index + 1, index + 1).filter((x) => x.packet === e.packet);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const did = (title: string) => between.find((x) => x.title === title);
  const why = (field: string) => {
    if (field.endsWith("MAC")) {
      const sender = name(now.from);
      return did("Wrap in a link frame")
        ? `${sender} received the packet and built a new frame for the next link. Link-layer addresses only cover one link.`
        : `${sender} changed the frame.`;
    }
    if (field === "TTL") return `${name(did("Decrease TTL")?.actor ?? now.from)} forwarded the packet as a router and lowered the TTL by one.`;
    if (did("Translate source with NAT") && /^Source (IP|port)$/.test(field))
      return `${name(did("Translate source with NAT")!.actor)} translated the private source to its public address and port (NAT).`;
    if (did("Restore reply destination") && /^Destination (IP|port)$/.test(field))
      return `${name(did("Restore reply destination")!.actor)} used its NAT mapping to restore the private destination.`;
    return "Changed in transit.";
  };
  return Object.keys(now.fields)
    .filter((k) => k in before.fields && before.fields[k] !== now.fields[k])
    .map((field) => ({ field, before: before.fields[field], after: now.fields[field], why: why(field) }));
}

/** For a TCP segment: the earlier segment it resends (same direction, same sequence number), if any. */
export function resends(events: TraceEvent[], index: number) {
  const e = events[index];
  const tcp = (x: TraceEvent) => x.layers.find((l) => l.name === "TCP segment")?.fields;
  const mine = tcp(e);
  if (!mine || !e.packet || !Number(mine["Payload bytes"])) return undefined;
  const first = events.findIndex(
    (x) =>
      x.packet &&
      x.packet !== e.packet &&
      x.title === "Drop TCP data segment" &&
      tcp(x)?.Sequence === mine.Sequence &&
      tcp(x)?.["Source port"] === mine["Source port"],
  );
  return first >= 0 && first < index ? first : undefined;
}

/** Packets in order of creation, numbered from 1, so learners can say "packet 7". */
export function packetNumber(events: TraceEvent[], packet: string | undefined) {
  if (!packet) return 0;
  const seen: string[] = [];
  for (const e of events) if (e.packet && !seen.includes(e.packet)) seen.push(e.packet);
  return seen.indexOf(packet) + 1;
}

type Gloss = { meaning: string; source?: string; simplified?: string };
// What each field means. Every field name the engine emits has an entry (tested).
export const glossary: Record<string, Gloss> = {
  "Source MAC": { meaning: "The link-layer address of the interface that sent this frame on this link.", source: "IEEE 802.3" },
  "Destination MAC": { meaning: "The link-layer address of the next device on this link, or ff:ff:ff:ff:ff:ff for everyone on the LAN.", source: "IEEE 802.3" },
  Carries: { meaning: "The EtherType: which protocol is inside the frame. 0x0800 means IPv4 and 0x0806 means ARP.", source: "IEEE EtherType registry; RFC 826" },
  Medium: { meaning: "Lab context: the kind of link. It is not a header field." },
  "Outgoing port": { meaning: "Lab context: the interface the frame leaves from. It is not a header field." },
  "Access point": { meaning: "Lab context: the access point this Wi-Fi frame passes through.", simplified: "Real Wi-Fi frames carry up to four addresses, including the access point's; the lab shows two." },
  "Sender IP": { meaning: "The IPv4 address of the device asking (or answering).", source: "RFC 826" },
  "Sender MAC": { meaning: "The MAC address of the device asking (or answering).", source: "RFC 826" },
  "Who has": { meaning: "The IPv4 address whose MAC address the sender wants: the ARP target protocol address.", source: "RFC 826" },
  "Target IP": { meaning: "The address of the device the ARP reply is for.", source: "RFC 826" },
  "Source IP": { meaning: "The IPv4 address of the original sender. NAT can rewrite it at the edge of a private network.", source: "RFC 791 §3.1" },
  "Destination IP": { meaning: "The IPv4 address of the final destination. It stays the same at every hop, except where NAT rewrites it.", source: "RFC 791 §3.1" },
  TTL: { meaning: "Time to live: how many more routers may forward this packet. Each router lowers it by one.", source: "RFC 791 §3.1; RFC 1812 §5.3.1" },
  Protocol: { meaning: "Which protocol is inside the IPv4 packet: TCP (6), UDP (17) or ICMP (1).", source: "RFC 791 §3.1; numbers from the IANA registry (RFC 790)" },
  Checksum: { meaning: "The header checksum.", simplified: "Not computed in this lab." },
  "Source port": { meaning: "The sending application's port. It lets the reply reach the right socket.", source: "RFC 9293 §3.1; RFC 768" },
  "Destination port": { meaning: "The receiving application's port: 80 for HTTP, 53 for DNS, 67 and 68 for DHCP.", source: "RFC 9293 §3.1; RFC 768" },
  Flags: { meaning: "TCP control bits: SYN opens a connection, ACK acknowledges, PSH asks for prompt delivery, FIN closes.", source: "RFC 9293 §3.1" },
  Sequence: { meaning: "The position of this segment's first byte in the sender's byte stream.", source: "RFC 9293 §3.4", simplified: "Starts at a fixed value (1000 or 7000) instead of a random one." },
  Acknowledgement: { meaning: "The next byte the sender of this segment expects to receive.", source: "RFC 9293 §3.4" },
  "Payload bytes": { meaning: "How many bytes of application data this segment carries.", source: "RFC 9293 §3.4", simplified: "The window field and TCP checksum are not modeled." },
  Length: { meaning: "The UDP length: 8 header bytes plus the data.", source: "RFC 768" },
  Type: { meaning: "The ICMP message type: Echo request is type 8, Echo reply is type 0.", source: "RFC 792" },
  Identifier: { meaning: "Matches an echo reply to its request.", source: "RFC 792" },
  "UTF-8 bytes": { meaning: "The size of the application data in bytes, as UTF-8 encodes it." },
  Message: { meaning: "The DHCP message type: Discover, Offer, Request or ACK.", source: "RFC 2131 §3.1" },
  Method: { meaning: "The HTTP method: GET asks for a resource.", source: "RFC 9110 §9.3.1" },
  Host: { meaning: "The HTTP Host header: which site the request is for.", source: "RFC 9112 §3.2" },
  Bytes: { meaning: "The size of the reassembled HTTP request in bytes." },
  "Body bytes": { meaning: "The size of the response body in bytes, as the Content-Length header gives it.", source: "RFC 9110 §8.6" },
  Status: { meaning: "The HTTP status code: 200 means OK.", source: "RFC 9110 §15.3.1" },
};

/** A field's value as it would be read in a header, e.g. EtherType 0x0806 or ICMP type 8. */
export function shown(field: string, value: string | number) {
  if (field === "Carries") return value === "ARP" ? "ARP (0x0806)" : value === "IPv4" ? "IPv4 (0x0800)" : String(value);
  if (field === "Type") return value === "Echo request" ? "8 (Echo request)" : value === "Echo reply" ? "0 (Echo reply)" : String(value);
  if (field === "Protocol") return ({ TCP: "TCP (6)", UDP: "UDP (17)", ICMP: "ICMP (1)" } as Record<string, string>)[String(value)] ?? String(value);
  return String(value);
}
