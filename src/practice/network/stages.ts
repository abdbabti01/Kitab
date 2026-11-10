// The summary timeline: consecutive events grouped into stages a learner can name, such as
// "ARP: Your PC finds 192.168.1.1" or "DNS query · Your PC → DNS server". Stages are computed
// from the trace and never reorder it: every event belongs to exactly one stage.
import { failures } from "./explanations.ts";
import { narrate } from "./narration.ts";
import type { Network, TraceEvent } from "./model.ts";

export type Stage = {
  /** First and last event index, inclusive. */
  start: number;
  end: number;
  title: string;
  /** What the stage did, true once its last event has happened. */
  summary: string;
  /** Devices that acted in this stage, in order of first appearance. */
  devices: string[];
  /** Links crossed, in order, with direction. */
  hops: { from: string; to: string; link: string }[];
  error?: boolean;
};

// Steps that begin something new even without a new packet.
const begins = new Set([
  "Associate with Wi-Fi",
  "Prepare HTTP request",
  "DNS query",
  "DNS cache hit",
  "DNS answer",
  "Create ICMP echo request",
  "Create ICMP echo reply",
  "Ping complete",
  "Create socket and connect",
  "TCP SYN",
  "TCP SYN-ACK",
  "TCP connection established",
  "Write application bytes",
  "Retransmit TCP segment",
  "Acknowledge received bytes",
  "Server reads HTTP request",
  "Read reassembled response",
  "HTTP journey complete",
  "DHCP lease expired",
]);
// Steps that create the packet sent right after them: the stage includes that packet's trip.
const creates = new Set([
  "DNS query",
  "Create ICMP echo request",
  "Create ICMP echo reply",
  "TCP SYN",
  "TCP SYN-ACK",
  "Write application bytes",
  "Retransmit TCP segment",
  "Acknowledge received bytes",
]);
// The message an exchange stage is about; ARP's reply stays with its request.
const exchange = (e: TraceEvent) => e.packet?.replace(/-reply$/, "");
const flagsOf = (e: TraceEvent) => String(e.layers.find((l) => l.name === "TCP segment")?.fields.Flags ?? "");

/** Splits a trace into stages. */
export function stagesOf(events: TraceEvent[], network: Network): Stage[] {
  const bounds: [number, number][] = [];
  let start = 0,
    current = exchange(events[0]),
    // The FIN/ACK segments that close a connection read best as one stage.
    closing = false;
  for (let i = 1; i < events.length; i++) {
    const e = events[i],
      id = exchange(e);
    // A packet created by the step that began this stage stays with it (e.g. "DNS query" and its trip).
    const adopts = !current && id && creates.has(events[start].title) && !events.slice(start, i).some((x) => x.packet);
    const split =
      e.error || begins.has(e.title) || e.title.startsWith("DHCP ") || (id && id !== current && !adopts && !closing);
    if (split) {
      bounds.push([start, i - 1]);
      start = i;
      current = id;
      closing = !!id && flagsOf(e).includes("FIN");
    } else if (id) current = id;
  }
  bounds.push([start, events.length - 1]);
  return bounds.map(([s, end]) => describe(events, s, end, network));
}

/** The stage that contains an event. */
export const stageAt = (stages: Stage[], index: number) =>
  Math.max(0, stages.findIndex((s) => index >= s.start && index <= s.end));

function describe(events: TraceEvent[], start: number, end: number, network: Network): Stage {
  const list = events.slice(start, end + 1);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const devices = [...new Set(list.map((e) => e.actor))];
  const hops = list.flatMap((e) => (e.hop ? [e.hop] : []));
  const first = list[0],
    last = list[list.length - 1];
  const has = (title: string) => list.filter((e) => e.title === title);
  const base = { start, end, devices, hops };
  if (first.error) {
    const info = first.reason && failures[first.reason];
    return { ...base, error: true, title: `Stopped at ${name(first.actor)}${info ? `: ${info.title}` : ""}`, summary: first.explanation };
  }
  const message = first.layers.find((l) => l.name.startsWith("DHCP "));
  if (message) {
    const phase = String(message.fields.Message);
    const reached = [...new Set(list.filter((e) => e.title === "Receive frame" && !["switch", "ap"].includes(kind(e.actor))).map((e) => name(e.actor)))];
    const applied = has("Apply DHCP lease")[0];
    return {
      ...base,
      title: `DHCP ${phase} · ${name(first.actor)}`,
      summary: `${name(first.actor)} broadcast a DHCP ${phase}. It reached ${list_(reached)}.${applied ? ` ${name(applied.actor)} applied the lease.` : ""}`,
    };
  }
  const arpRequest = has("ARP: discover the next-hop MAC")[0];
  if (arpRequest) {
    const asked = arpRequest.layers[0]?.fields["Who has"];
    const reply = has("ARP reply")[0],
      saved = has("Save ARP mapping")[0];
    return {
      ...base,
      title: `ARP · ${name(arpRequest.actor)} looks for ${asked}`,
      summary: reply
        ? `${name(arpRequest.actor)} broadcast “Who has ${asked}?”. ${name(reply.actor)} answered with its MAC ${reply.layers[0]?.fields["Sender MAC"]}${saved ? `, and ${name(saved.actor)} saved it` : ""}.`
        : `${name(arpRequest.actor)} broadcast “Who has ${asked}?” on its LAN.`,
    };
  }
  const segments = [...new Set(list.map((e) => e.packet).filter((p) => p?.startsWith("ip-")))];
  if (segments.length > 1 && list.some((e) => flagsOf(e).includes("FIN"))) {
    const legs = segments.map((p) => {
      const trip = list.filter((e) => e.packet === p && e.hop);
      return { from: name(trip[0]?.hop!.from ?? ""), to: name(trip.at(-1)?.hop!.to ?? ""), flags: flagsOf(trip[0] ?? list[0]) };
    });
    return {
      ...base,
      title: `Close the connection · ${legs[0].from} ↔ ${legs[0].to}`,
      summary: `The connection closes in ${legs.length} segments: ${legs.map((l) => `${l.from} → ${l.to} ${l.flags}`).join("; ")}. Each FIN says “I have finished sending”, and each is acknowledged.`,
    };
  }
  const label = packetLabel(list);
  const made = creates.has(first.title) ? made_(first, name) : "";
  const route = has("Choose a route")[0];
  if (!hops.length && route)
    return {
      ...base,
      title: `${titles[first.title] ?? label} · ${name(route.actor)}`,
      summary: `${made}${name(route.actor)} chose next hop ${route.facts?.["Next hop"]} for the ${label} (${route.facts?.Route}).`,
    };
  if (hops.length) {
    const from = name(hops[0].from),
      to = name(hops[hops.length - 1].to);
    const routers = [...new Set(has("Decrease TTL").map((e) => name(e.actor)))];
    const nat = has("Translate source with NAT")[0] ?? has("Restore reply destination")[0];
    const delivered = has("Deliver IP payload")[0];
    const dropped = has("Drop TCP data segment")[0];
    if (dropped)
      return {
        ...base,
        title: `${label[0].toUpperCase()}${label.slice(1)} · lost after leaving ${from}`,
        summary: `${made}The ${label} was lost on its first link, between ${from} and ${name(dropped.hop?.to ?? "")}, so it never arrived.`,
      };
    const parts = [
      hops.length ? `crossed ${hops.length} link${hops.length > 1 ? "s" : ""} from ${from} to ${to}` : `was routed at ${from}`,
      routers.length ? `it was forwarded by ${list_(routers)}` : "",
      nat ? `${name(nat.actor)} ${nat.title.startsWith("Translate") ? `translated its source to ${nat.facts?.Outside}` : `restored its destination to ${nat.facts?.Inside}`}` : "",
      dropped ? "it was lost on its first link" : delivered ? `it was delivered to ${name(delivered.actor)}` : "",
    ].filter(Boolean);
    return {
      ...base,
      title: `${label[0].toUpperCase()}${label.slice(1)} · ${from} → ${to}`,
      summary: `${made}The ${label} ${parts.join("; ")}.`,
    };
  }
  return { ...base, title: title(first, name), summary: narrate(events, end, network).summary };

  function kind(id: string) {
    return network.devices.find((d) => d.id === id)?.kind ?? "";
  }
}

const titles: Record<string, string> = {
  "Associate with Wi-Fi": "Join Wi-Fi",
  "Prepare HTTP request": "Prepare the HTTP request",
  "DNS query": "Look up the name",
  "DNS cache hit": "Name already known",
  "DNS answer": "Name resolved",
  "Create ICMP echo request": "Send a ping",
  "Create ICMP echo reply": "Answer the ping",
  "Ping complete": "Ping complete",
  "Create socket and connect": "Open a socket",
  "TCP SYN": "TCP handshake: SYN",
  "TCP SYN-ACK": "TCP handshake: SYN-ACK",
  "TCP connection established": "Connection established",
  "Write application bytes": "Send data",
  "Retransmit TCP segment": "Retransmit lost data",
  "Acknowledge received bytes": "Acknowledge data",
  "Server reads HTTP request": "Server reads the request and builds a response",
  "Read reassembled response": "Browser reads the response",
  "HTTP journey complete": "Page delivered",
  "DHCP lease expired": "Lease expired",
};
const title = (e: TraceEvent, name: (id: string) => string) => `${titles[e.title] ?? e.title}${["Associate with Wi-Fi", "Prepare HTTP request", "Create socket and connect"].includes(e.title) ? ` · ${name(e.actor)}` : ""}`;

/** How the stage's own packet came to be, in one sentence. */
function made_(e: TraceEvent, name: (id: string) => string) {
  const who = name(e.actor);
  const tcp = e.layers.find((l) => l.name === "TCP segment")?.fields;
  return (
    {
      "DNS query": `${who} asked its DNS server ${e.facts?.Server} for ${e.facts?.Name}. `,
      "Create ICMP echo request": `${who} created a ping to ${e.facts?.Destination}. `,
      "Create ICMP echo reply": `${who} answered the ping. `,
      "TCP SYN": `${who} started the TCP handshake (SYN, sequence ${tcp?.Sequence}). `,
      "TCP SYN-ACK": `${who} accepted the connection (SYN-ACK). `,
      "Write application bytes": `${who} wrapped ${e.layers[0]?.fields["UTF-8 bytes"]} bytes of data in TCP and IP. `,
      "Retransmit TCP segment": `No ACK came back, so ${who} resent the same bytes. `,
      "Acknowledge received bytes": `${who} acknowledged the data (ACK ${tcp?.Acknowledgement}). `,
    } as Record<string, string>
  )[e.title] ?? "";
}

/** What the stage's IP packet carries, in a learner's words. */
function packetLabel(list: TraceEvent[]) {
  const layers = list.find((e) => e.packet?.startsWith("ip-") && e.layers.some((l) => l.name === "IPv4 packet"))?.layers ?? [];
  const app = layers.find((l) => l.kind === "application")?.name;
  const tcp = layers.find((l) => l.name === "TCP segment");
  const icmp = layers.find((l) => l.name === "ICMP message");
  if (icmp) return String(icmp.fields.Type).toLowerCase();
  if (tcp && app) return app;
  if (tcp)
    return (
      ({ SYN: "TCP handshake: SYN", "SYN, ACK": "TCP handshake: SYN-ACK", ACK: "TCP acknowledgement" } as Record<string, string>)[
        String(tcp.fields.Flags)
      ] ?? `TCP ${tcp.fields.Flags}`
    );
  return app ?? "packet";
}
const list_ = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "nobody") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
