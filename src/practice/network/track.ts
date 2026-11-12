// The track under the diagram: one lane per device and one arrow per recorded link crossing, read from the trace.
// A message that crossed several devices is drawn as several arrows, one per link, never as one arrow from its sender
// to its destination. Long runs are shown a window at a time, a stage at a time, so nothing is grouped away.
import { exchangeOf } from "./exchange.ts";
import type { PacketKind } from "./motion.ts";
import type { Network, TraceEvent } from "./model.ts";

export type TrackArrow = {
  /** The event that put the frame on the link. */
  index: number;
  from: string;
  to: string;
  kind: PacketKind;
  /** Addressed to every device on the link (a broadcast, or a copy of one a switch floods). */
  broadcast: boolean;
  /** Lost on this link. */
  lost: boolean;
  /** Sent on by a device that received it, not by the device that created it. */
  forwarded: boolean;
  /** The message resends one that was lost. */
  retransmit: boolean;
  message: string;
};
export type TrackMark = { index: number; device: string; how: "delivered" | "discarded" | "stopped" };
export type Track = { lanes: string[]; arrows: TrackArrow[]; marks: TrackMark[] };

const kindOf = (packet: string): PacketKind => (packet.startsWith("arp-") ? "arp" : packet.startsWith("dhcp-") ? "dhcp" : "ip");

export function trackOf(events: TraceEvent[], network: Network): Track {
  const x = exchangeOf(events, network);
  const message = new Map(x.messages.map((m) => [m.id, m]));
  const arrows: TrackArrow[] = [];
  events.forEach((e, index) => {
    if (!e.hop || !e.packet) return;
    const m = message.get(e.packet);
    const frame = e.layers.find((l) => /frame$/.test(l.name));
    arrows.push({
      index,
      from: e.hop.from,
      to: e.hop.to,
      kind: kindOf(e.packet),
      broadcast: frame?.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff",
      lost: e.title === "Drop TCP data segment",
      forwarded: !!m && m.from !== e.hop.from,
      retransmit: !!m?.resends,
      message: e.packet,
    });
  });
  const marks: TrackMark[] = x.messages.flatMap((m) =>
    m.reached.flatMap((r) => (r.how === "delivered" || r.how === "discarded" ? [{ index: r.at, device: r.device, how: r.how }] : [])),
  );
  if (x.stop) marks.push({ index: x.stop.at, device: x.stop.device, how: "stopped" });
  // Lanes in the order the run reaches the devices, so a path reads top to bottom and adjacent hops sit side by side.
  const lanes: string[] = [];
  for (const e of events) for (const d of e.hop ? [e.hop.from, e.hop.to] : [e.actor]) if (!lanes.includes(d)) lanes.push(d);
  return { lanes, arrows, marks: marks.sort((a, b) => a.index - b.index) };
}

/**
 * The events shown in the lanes, at most `capacity` of them: the whole run when it fits, otherwise the current stage
 * (filled out with its neighbours), or the page of a long stage that holds the current event. The window changes
 * only when the current event leaves it, so the lanes do not slide along with playback.
 */
export function windowOf(stages: { start: number; end: number }[], index: number, last: number, capacity: number): [number, number] {
  const cap = Math.max(1, Math.floor(capacity));
  if (last + 1 <= cap) return [0, last];
  const s = stages.find((x) => index >= x.start && index <= x.end) ?? { start: index, end: index };
  if (s.end - s.start + 1 <= cap) {
    let a = s.start;
    const b = Math.min(last, a + cap - 1);
    if (b - a + 1 < cap) a = Math.max(0, b - cap + 1);
    return [a, b];
  }
  const a = s.start + Math.floor((index - s.start) / cap) * cap;
  return [a, Math.min(s.end, a + cap - 1)];
}
