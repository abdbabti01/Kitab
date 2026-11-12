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

export type LayerChange =
  | { kind: "added" | "removed"; layer: string; layerKind: Layer["kind"] }
  /** The link layer this message leaves on is not the one it arrived in. */
  | { kind: "replaced"; from: string; to: string; fields: Change[] }
  /** It leaves in the same frame it arrived in. */
  | { kind: "kept"; layer: string }
  | { kind: "field"; layer: string; field: string; before: string | number; after: string | number };
export type LayerStep = {
  /** The step compared with, or none when the trace records nothing earlier to compare. */
  basis?: number;
  /** The message first appears here; how its layers were built is not recorded step by step. */
  origin: boolean;
  /** The device that made the changes. */
  by: string;
  changes: LayerChange[];
};

// Bridge decisions are recorded without the frame (the engine passes only what is inside it), so they are
// never compared with: a switch does not unwrap frames.
const bridgeDecision = (e: TraceEvent) => e.title === "Forward broadcast on LAN" || e.title === "Forward using MAC table" || e.title.startsWith("Unknown MAC");
const names = (e: TraceEvent) => e.layers.map((l) => l.name);
const isPrefix = (a: string[], b: string[]) => a.length <= b.length && a.every((n, i) => n === b[i]);
const linkOf = (e: TraceEvent) => e.layers.find((l) => /frame$/.test(l.name));

/**
 * How the layers of this step's message differ from the same message's previous step at the same device (or
 * the link that brought it there), from the trace alone. Before a message has its id, a step counts as the
 * same message only when it directly follows a step by the same device whose layers it extends. Nothing is
 * inferred where the trace does not record it: such steps have no basis and no changes.
 */
export function layerStep(events: TraceEvent[], index: number): LayerStep {
  const e = events[index];
  const none = { origin: false, by: e?.actor ?? "", changes: [] };
  if (!e || !e.layers.length || bridgeDecision(e)) return none;
  const here = (x: TraceEvent) => x.actor === e.actor || x.hop?.to === e.actor;
  let basis = -1;
  if (e.packet)
    for (let i = index - 1; i >= 0; i -= 1) {
      const x = events[i];
      if (x.packet === e.packet && here(x) && x.layers.length && !bridgeDecision(x)) {
        basis = i;
        break;
      }
    }
  const before = events[index - 1];
  if (basis < 0 && before && before.actor === e.actor && !before.packet && before.layers.length && isPrefix(names(before), names(e))) basis = index - 1;
  if (basis < 0) return { ...none, origin: !!e.packet && !events.slice(0, index).some((x) => x.packet === e.packet) };
  const b = events[basis];
  const changes: LayerChange[] = [];
  for (const l of b.layers) if (!names(e).includes(l.name)) changes.push({ kind: "removed", layer: l.name, layerKind: l.kind });
  for (const l of e.layers) if (!names(b).includes(l.name)) changes.push({ kind: "added", layer: l.name, layerKind: l.kind });
  for (const l of e.layers) {
    const old = b.layers.find((x) => x.name === l.name);
    if (old && l.kind !== "link")
      for (const [field, after] of Object.entries(l.fields))
        if (!context.has(field) && field in old.fields && old.fields[field] !== after) changes.push({ kind: "field", layer: l.name, field, before: old.fields[field], after });
  }
  // Leaving on a link: compare its frame with the frame the message arrived in at this device.
  const out = linkOf(e);
  if (e.hop?.from === e.actor && out) {
    let arrived: TraceEvent | undefined;
    for (let i = index - 1; i >= 0 && !arrived; i -= 1) if (events[i].packet === e.packet && events[i].hop?.to === e.actor) arrived = events[i];
    const inFrame = arrived && linkOf(arrived);
    if (inFrame) {
      const fields = Object.keys(out.fields)
        .filter((k) => !context.has(k) && k in inFrame.fields && inFrame.fields[k] !== out.fields[k])
        .map((field) => ({ field, before: inFrame.fields[field], after: out.fields[field], why: "" }));
      const rest = changes.filter((c) => !((c.kind === "added" || c.kind === "removed") && c.layerKind === "link"));
      changes.length = 0;
      changes.push(...rest, inFrame.name === out.name && !fields.length ? { kind: "kept", layer: out.name } : { kind: "replaced", from: inFrame.name, to: out.name, fields });
    }
  }
  return { basis, origin: false, by: e.actor, changes };
}

/** A layer's short name on the diagram's packet: Eth, Wi-Fi, ARP, IP, ICMP, UDP, TCP, DNS, HTTP, DHCP, Echo. */
export function layerTag(name: string) {
  const word = name.split(" ")[0];
  return word === "Ethernet" ? "Eth" : word === "IPv4" ? "IP" : word;
}
const fieldTag: Record<string, string> = { "Source IP": "src", "Destination IP": "dst", "Source port": "src port", "Destination port": "dst port", Identifier: "id" };
export type Capsule = {
  /** The message's layers, outermost first, as on the wire; `mark` says what this step did to the layer. */
  segments: { tag: string; name: string; kind: Layer["kind"]; mark?: "added" | "replaced" | "changed" }[];
  /** Layers this step removed (the frame a device took off to read what is inside). */
  gone: { tag: string; name: string; kind: Layer["kind"] }[];
  /** The changes in a few words, for the label above the packet: "− Eth", "TTL 64→63", "src 192.168.1.10:53000→…". */
  notes: string[];
};
/**
 * What the diagram draws as this step's message, read from layerStep(): no layer appears that the event does not
 * carry, and nothing is marked as changed that the trace does not record changing.
 */
export function capsuleAt(events: TraceEvent[], index: number): Capsule {
  const e = events[index];
  const step = layerStep(events, index);
  const mark = (name: string): Capsule["segments"][number]["mark"] =>
    step.changes.some((c) => c.kind === "added" && c.layer === name)
      ? "added"
      : step.changes.some((c) => c.kind === "replaced" && c.to === name)
        ? "replaced"
        : step.changes.some((c) => c.kind === "field" && c.layer === name)
          ? "changed"
          : undefined;
  const segments = [...(e?.layers ?? [])].reverse().map((l) => ({ tag: layerTag(l.name), name: l.name, kind: l.kind, mark: mark(l.name) }));
  const gone = step.changes.flatMap((c) => (c.kind === "removed" ? [{ tag: layerTag(c.layer), name: c.layer, kind: c.layerKind }] : []));
  const notes: string[] = [];
  for (const c of step.changes) {
    if (c.kind === "removed") notes.push(`− ${layerTag(c.layer)}`);
    if (c.kind === "added") notes.push(`+ ${layerTag(c.layer)}`);
    if (c.kind === "replaced") notes.push(`new ${layerTag(c.to)}`);
  }
  // Field changes; an address and its port changed together (NAT) read as one: "src 192.168.1.10:53000→203.0.113.2:62000".
  const fields = step.changes.filter((c): c is Extract<LayerChange, { kind: "field" }> => c.kind === "field");
  const used = new Set<Extract<LayerChange, { kind: "field" }>>();
  for (const side of ["Source", "Destination"]) {
    const ip = fields.find((f) => f.field === `${side} IP`),
      port = fields.find((f) => f.field === `${side} port`);
    if (ip && port) {
      notes.push(`${fieldTag[ip.field]} ${ip.before}:${port.before}→${ip.after}:${port.after}`);
      used.add(ip).add(port);
    }
  }
  for (const f of fields) if (!used.has(f)) notes.push(`${fieldTag[f.field] ?? f.field} ${f.before}→${f.after}`);
  return { segments, gone, notes };
}
