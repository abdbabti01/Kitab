// The protocol exchange: one message per packet id the trace records, from the device that created it to the
// devices it reached, with the devices that sent it on in between. Everything is read from the trace: a message
// reaches a device only where a frame carrying it arrived, a reply is shown only where the trace creates one, and
// a message that was never transmitted has no receiver.
import { resends } from "./packets.ts";
import type { Network, TraceEvent } from "./model.ts";

/** How a message ended at a device it reached. */
export type Reach = {
  device: string;
  /** The event that shows it: the delivery, the discard, or the frame's arrival. */
  at: number;
  /** delivered: handed up (IP payload, ARP mapping, DHCP lease); received: taken in by a host or router that
   * does not deliver this kind of message; discarded: not addressed to it; no-further: not delivered or sent on. */
  how: "delivered" | "received" | "discarded" | "no-further";
};
export type Message = {
  id: string;
  label: string;
  /** Header facts a learner reads the exchange by, e.g. "Seq 1000 · Ack 0" or "Who has 192.168.1.1?". */
  detail: string;
  protocol: "ARP" | "DHCP" | "DNS" | "TCP" | "ICMP" | "IP";
  from: string;
  /** The first event of this message, and its first transmission (where selecting it goes). */
  first: number;
  sent?: number;
  /** Every transmission of it, in order, including a lost one. */
  hops: number[];
  /** Devices that sent it on, in order. */
  via: string[];
  reached: Reach[];
  broadcast: boolean;
  /** A switch sent copies out of every port because it did not know the destination MAC. */
  flooded: boolean;
  lost?: { at: number; from: string; to: string };
  /** The message this one retransmits. */
  resends?: string;
  /** It crossed the same link in the same direction more than once (a routing loop). */
  loops: boolean;
  /** The delivery-stopped event recorded for this message. */
  stopped?: number;
};
export type Exchange = {
  messages: Message[];
  /** Devices that sent, received or stopped a message, left to right as on the diagram. */
  participants: string[];
  /** Where the run stopped, when it did. */
  stop?: { at: number; device: string };
};

const delivers = new Set(["Deliver IP payload", "Save ARP mapping", "Apply DHCP lease"]);
const bridges = new Set(["switch", "ap"]);

function describe(e: TraceEvent): Pick<Message, "label" | "detail" | "protocol"> {
  const layer = (name: string) => e.layers.find((l) => l.name === name)?.fields;
  const tcp = layer("TCP segment");
  const inner = e.layers[0]?.name ?? e.title;
  if (tcp) {
    const flags = String(tcp.Flags);
    const name = `TCP ${flags === "SYN, ACK" ? "SYN-ACK" : flags}`;
    const bytes = Number(tcp["Payload bytes"]);
    return {
      protocol: "TCP",
      label: inner === "TCP segment" ? name : `${inner} · ${name}`,
      detail: `Seq ${tcp.Sequence} · Ack ${tcp.Acknowledgement}${bytes ? ` · ${bytes} bytes` : ""}`,
    };
  }
  const arp = layer("ARP request") ?? layer("ARP reply");
  if (arp)
    return {
      protocol: "ARP",
      label: inner,
      detail: arp["Who has"] ? `Who has ${arp["Who has"]}?` : `${arp["Sender IP"]} is at ${arp["Sender MAC"]}`,
    };
  const ip = layer("IPv4 packet");
  const between = ip ? `${ip["Source IP"]} → ${ip["Destination IP"]}` : "";
  if (inner.startsWith("DHCP")) return { protocol: "DHCP", label: inner, detail: between };
  if (inner.startsWith("DNS")) return { protocol: "DNS", label: inner, detail: between };
  if (layer("ICMP message")) return { protocol: "ICMP", label: inner, detail: between };
  return { protocol: "IP", label: inner, detail: between };
}

/** The messages of a run, in the order they were first transmitted (or created, if never transmitted). */
export function exchangeOf(events: TraceEvent[], network: Network): Exchange {
  const kind = (id: string) => network.devices.find((d) => d.id === id)?.kind;
  // Each message's events, in one pass (in order of first appearance), rather than a scan of the run per message.
  const byPacket = new Map<string, number[]>();
  events.forEach((e, i) => {
    if (!e.packet) return;
    const list = byPacket.get(e.packet);
    if (list) list.push(i);
    else byPacket.set(e.packet, [i]);
  });
  const messages = [...byPacket].map(([id, mine]): Message => {
    const first = mine[0];
    const from = events[first].actor;
    const hops = mine.filter((i) => events[i].hop?.from === events[i].actor);
    const drop = hops.find((i) => !events[i].frame);
    const by = (device: string, test: (e: TraceEvent) => boolean) => mine.find((i) => events[i].actor === device && test(events[i]));
    // A device is reached where a frame arrived and it did not send the message on afterwards.
    const reached: Reach[] = [];
    hops.forEach((h) => {
      const { to } = events[h].hop!;
      if (!events[h].frame || hops.some((k) => k > h && events[k].hop!.from === to)) return;
      if (reached.some((r) => r.device === to)) return;
      const delivered = by(to, (e) => delivers.has(e.title));
      const discarded = by(to, (e) => e.title.startsWith("Discard"));
      const arrived = by(to, (e) => e.title === "Receive frame") ?? h;
      reached.push(
        delivered !== undefined
          ? { device: to, at: delivered, how: "delivered" }
          : discarded !== undefined
            ? { device: to, at: discarded, how: "discarded" }
            : bridges.has(kind(to) ?? "") || id.startsWith("ip-")
              ? { device: to, at: mine.filter((i) => events[i].actor === to).at(-1) ?? h, how: "no-further" }
              : { device: to, at: arrived, how: "received" },
      );
    });
    const senders = hops.map((i) => events[i].actor);
    // Broadcast copies leave one device on different links; a loop crosses the same link the same way again.
    const links = hops.map((i) => `${events[i].hop!.from}>${events[i].hop!.to}`);
    const firstFrame = events[hops.find((i) => events[i].frame) ?? -1]?.layers.find((l) => /frame$/.test(l.name));
    const retransmits = mine.map((i) => resends(events, i)).find((r) => r !== undefined);
    const stopped = mine.find((i) => events[i].error);
    return {
      id,
      ...describe(events[mine.find((i) => events[i].layers.length) ?? first]),
      from,
      first,
      sent: hops[0],
      hops,
      via: [...new Set(senders.filter((d) => d !== from))],
      reached,
      broadcast: firstFrame?.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff",
      flooded: mine.some((i) => events[i].title.startsWith("Unknown MAC")),
      lost: drop === undefined ? undefined : { at: drop, from: events[drop].hop!.from, to: events[drop].hop!.to },
      resends: retransmits === undefined ? undefined : events[retransmits].packet,
      loops: links.length !== new Set(links).size,
      stopped,
    };
  });
  messages.sort((a, b) => (a.sent ?? a.first) - (b.sent ?? b.first));
  const last = events.length - 1;
  const stop = events[last]?.error ? { at: last, device: events[last].actor } : undefined;
  const participants: string[] = [];
  const add = (d: string) => void (participants.includes(d) || participants.push(d));
  for (const m of messages) {
    add(m.from);
    m.reached.forEach((r) => add(r.device));
    if (m.lost) add(m.lost.to);
  }
  if (stop) add(stop.device);
  // Left to right as the devices sit on the diagram, so the lifelines read like the canvas.
  const at = (id: string) => network.devices.find((d) => d.id === id) ?? { x: 0, y: 0 };
  participants.sort((a, b) => at(a).x - at(b).x || at(a).y - at(b).y);
  return { messages, participants, stop };
}

/** The message the current event belongs to, if any. */
export const activeMessage = (x: Exchange, events: TraceEvent[], index: number) => x.messages.find((m) => m.id === events[index]?.packet);
