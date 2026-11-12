// What the diagram animates at one step, read from the trace alone: the frame crossing a link, the links a
// bridge's decision sends it on, and where delivery stopped or a frame was discarded. Nothing is drawn that
// the engine did not emit.
import type { Network, TraceEvent } from "./model.ts";

export type PacketKind = "arp" | "dhcp" | "ip";
export type Motion = {
  /** The frame crossing a link at this step, from the sender to the receiver (or lost on the way). */
  packet?: { link: string; from: string; to: string; kind: PacketKind; label: string; broadcast: boolean; lost: boolean };
  /** The frame a device is working on at this step (receiving, learning, routing, wrapping). */
  held?: { device: string; kind: PacketKind; label: string };
  /** A bridge's decision: the one port its MAC table chose, or every copy of a flood. */
  forward?: { kind: "forward" | "flood"; links: string[] };
  /** Where delivery stopped, or where a flooded copy was discarded. */
  halt?: { device: string; kind: "stopped" | "discarded" };
};

const kindOf = (packet: string): PacketKind => (packet.startsWith("arp-") ? "arp" : packet.startsWith("dhcp-") ? "dhcp" : "ip");
// A header field from the layer that carries it: several layers share a kind (ARP and Ethernet are both
// link layer; ICMP and IPv4 are both network layer).
const field = (e: TraceEvent, name: string) => e.layers.find((l) => name in l.fields)?.fields[name];

export function motionAt(events: TraceEvent[], index: number, network: Network): Motion {
  const e = events[index];
  if (!e) return {};
  if (e.error) return { halt: { device: e.actor, kind: "stopped" } };
  if (e.title === "Discard frame for another MAC") return { halt: { device: e.actor, kind: "discarded" } };
  const kind = e.packet ? kindOf(e.packet) : "ip";
  const label = kind === "arp" ? "ARP" : kind === "dhcp" ? "DHCP" : String(field(e, "Protocol") ?? "IP");
  if (e.hop && e.packet) {
    return {
      packet: {
        ...e.hop,
        kind,
        label,
        broadcast: field(e, "Destination MAC") === "ff:ff:ff:ff:ff:ff",
        lost: e.title === "Drop TCP data segment",
      },
    };
  }
  if (e.title === "Forward using MAC table") {
    const port = e.facts?.Port;
    const link = network.links.find((l) => [l.a, l.b].some((p) => p.device === e.actor && p.port === port));
    return link ? { forward: { kind: "forward", links: [link.id] }, held: { device: e.actor, kind, label } } : {};
  }
  if ((e.title === "Forward broadcast on LAN" || e.title.startsWith("Unknown MAC")) && e.packet) {
    // Every copy this bridge sent of this frame since it arrived, until it arrives here again.
    let arrived = -1;
    for (let i = 0; i <= index; i += 1) if (events[i].actor === e.actor && events[i].packet === e.packet && events[i].title === "Learn source MAC") arrived = i;
    const links: string[] = [];
    for (const x of events.slice(arrived + 1)) {
      if (x.actor === e.actor && x.packet === e.packet && x.title === "Learn source MAC") break;
      if (x.packet === e.packet && x.hop?.from === e.actor && !links.includes(x.hop.link)) links.push(x.hop.link);
    }
    return { forward: { kind: "flood", links }, held: { device: e.actor, kind, label } };
  }
  return e.packet && e.layers.length ? { held: { device: e.actor, kind, label } } : {};
}

/**
 * How long playback stays on each event at 1×, read from what the event shows. Presentation only: every event is
 * still played and can be stepped to; nothing is merged or skipped.
 * - hop: a frame crosses a link, the movement the learner is watching for;
 * - stop: delivery stopped, held long enough to read;
 * - bridge: a switch forwards or floods, shown on its links;
 * - notable: the first time a device does this kind of step (its first route choice, its first NAT translation);
 * - routine: the same device repeating a step it has already been seen doing.
 * A stage's first event gets extra time for its new title, and its last enough to read the stage's summary.
 */
export type Beat = "hop" | "stop" | "bridge" | "notable" | "routine";
export const BEAT_MS: Record<Beat, number> = { hop: 1000, stop: 2500, bridge: 450, notable: 550, routine: 120 };
export const STAGE_START_MS = 350;
/** Reading time for a stage's summary: about 10 words a second, within limits. */
export const stageEndMs = (summary: string) => Math.min(2000, Math.max(700, summary.split(/s+/).length * 100));

export function beatsOf(events: TraceEvent[], network: Network): Beat[] {
  const seen = new Set<string>();
  return events.map((e, i) => {
    const m = motionAt(events, i, network);
    const key = JSON.stringify([e.actor, e.title]);
    const first = !seen.has(key);
    seen.add(key);
    if (e.error) return "stop";
    if (m.packet) return "hop";
    if (m.forward || m.halt) return "bridge";
    return first ? "notable" : "routine";
  });
}

/** Milliseconds at 1× for every event, given the run's stages (first and last event of each, and its summary). */
export function durationsOf(events: TraceEvent[], network: Network, stages: { start: number; end: number; summary: string }[]): number[] {
  const out = beatsOf(events, network).map((b) => BEAT_MS[b]);
  for (const s of stages) {
    if (out[s.start] !== undefined) out[s.start] += STAGE_START_MS;
    if (out[s.end] !== undefined) out[s.end] += stageEndMs(s.summary);
  }
  return out;
}
