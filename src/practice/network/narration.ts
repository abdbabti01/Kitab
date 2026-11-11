// What each event means, built only from the trace: the event's own headers, its decision facts,
// its snapshot and earlier events. Three levels: a one-line summary, the cause and state behind it,
// and the protocol rule with its source.
import { effectiveInterface } from "./engine.ts";
import { explainStep, failures, type StepExplanation } from "./explanations.ts";
import { isBridge, type Network, type TraceEvent } from "./model.ts";

export type Narration = StepExplanation & {
  /** Level 1: what happened and why, in one or two sentences with the real values. */
  summary: string;
  /** Level 2: the earlier event that led to this one. */
  cause?: { index: number; text: string };
  /** Level 3: the rule the device followed, and where it is specified. */
  rule?: { text: string; source: string };
  /** Level 3: where this lab simplifies real behaviour. */
  real?: string;
};

type Ctx = {
  e: TraceEvent;
  name: string;
  bridge: boolean;
  dn: (id: string) => string;
  /** The device that uses an address at this step, by name. */
  who: (ip: unknown) => string;
  /** " (Device name)", or a note that no device uses the address. */
  owner: (ip: unknown) => string;
  f: Record<string, string | number>;
  field: (layer: string, key: string) => string | number | undefined;
};

const rules: Record<string, [string, string]> = {
  "Associate with Wi-Fi": ["A wireless device must join (associate with) an access point before it can exchange data frames on that network.", "IEEE 802.11"],
  "DHCP Discover": ["A client without an address broadcasts DHCPDISCOVER on its local network to find a server.", "RFC 2131 §3.1"],
  "DHCP Offer": ["A server answers a DHCPDISCOVER with a DHCPOFFER of an unused address from its pool.", "RFC 2131 §3.1"],
  "DHCP Request": ["The client broadcasts DHCPREQUEST naming the offer it accepts, so other servers know theirs was declined.", "RFC 2131 §3.1"],
  "DHCP ACK": ["The chosen server commits the lease and confirms it with DHCPACK.", "RFC 2131 §3.1"],
  "Apply DHCP lease": ["A client uses the address only after the DHCPACK arrives.", "RFC 2131 §3.1"],
  "DHCP lease expired": ["When a lease expires without renewal, the client must stop using the address.", "RFC 2131 §4.4.5"],
  "Prepare HTTP request": ["An HTTP/1.1 request starts with a request line (method, target, version) and must carry a Host header.", "RFC 9112 §3, §3.2"],
  "DNS query": ["A resolver asks its configured name server; ordinary queries use UDP port 53.", "RFC 1035 §4.2.1"],
  "DNS answer": ["An A record gives the IPv4 address for a name.", "RFC 1035 §3.4.1"],
  "DNS cache hit": ["A resolver may reuse a cached record until its time to live runs out.", "RFC 1034 §3.6"],
  "Choose a route": ["A host sends directly to a destination in a connected subnet and otherwise to a gateway; a router picks the longest matching prefix.", "RFC 1122 §3.3.1.1; RFC 1812 §5.2.4.3"],
  "ARP: discover the next-hop MAC": ["To find the MAC address for an IP address on the local network, a host broadcasts an ARP request; only the owner replies.", "RFC 826"],
  "ARP cache hit": ["A host keeps learned IP-to-MAC mappings and reuses them instead of asking again.", "RFC 826"],
  "ARP reply": ["The owner of the requested address answers the asker directly with its MAC address, and also records the asker's mapping.", "RFC 826 (packet reception)"],
  "Save ARP mapping": ["The asker stores the IP-to-MAC mapping from the reply in its ARP table.", "RFC 826 (packet reception)"],
  "Wrap in a link frame": ["A frame is addressed to the next hop's MAC address; the IP destination stays the final host.", "RFC 1122 §3.3.1"],
  "Transmit over Ethernet": ["A frame crosses one LAN: switches pass it on unchanged, and a router builds a new frame for the next link.", "IEEE 802.3; IEEE 802.1Q"],
  "Transmit over Wi-Fi": ["A frame crosses one LAN: the access point bridges it between radio and cable, and a router builds a new frame for the next link.", "IEEE 802.11; IEEE 802.1Q"],
  "Learn source MAC": ["A switch learns each frame's source MAC address and the port it arrived on.", "IEEE 802.1Q (learning process)"],
  "Forward broadcast on LAN": ["A switch sends a broadcast frame out of every port except the one it arrived on.", "IEEE 802.1Q (forwarding process)"],
  "Forward using MAC table": ["A switch sends a frame for a learned MAC address only out of the port where it learned it.", "IEEE 802.1Q (filtering database)"],
  "Unknown MAC: flood eligible ports": ["A switch floods a frame for an unknown MAC address out of every port except the arrival port.", "IEEE 802.1Q (forwarding process)"],
  "Receive frame": ["An interface accepts a frame addressed to its own MAC address or to the broadcast address.", "IEEE 802.3 (address recognition)"],
  "Discard frame for another MAC": ["An interface ignores a frame addressed to another MAC address.", "IEEE 802.3 (address recognition)"],
  "Deliver IP payload": ["A host accepts a packet addressed to one of its own addresses and hands it to the protocol named in the header.", "RFC 791 §3.1; RFC 1122 §3.2.1.3"],
  "Decrease TTL": ["A router lowers the TTL of every packet it forwards and discards a packet whose TTL reaches zero.", "RFC 1812 §5.3.1"],
  "Translate source with NAT": ["NAPT replaces a private source address and port with the router's public address and a port, and keeps the mapping for replies.", "RFC 3022 §2.2"],
  "Restore reply destination": ["NAPT uses the saved mapping to rewrite a reply's destination back to the private address and port.", "RFC 3022 §2.2"],
  "Create ICMP echo request": ["Ping sends an ICMP Echo message (type 8); the destination must answer with an Echo Reply (type 0).", "RFC 792"],
  "Create ICMP echo reply": ["The destination returns the echo data in an Echo Reply (type 0) addressed to the sender.", "RFC 792"],
  "Ping complete": ["An Echo Reply arriving shows both the forward and the return path work.", "RFC 792"],
  "Create socket and connect": ["An application opens a TCP connection through the operating system's socket interface; TCP keeps the connection state.", "RFC 9293 §3.9.1.1"],
  "TCP SYN": ["TCP opens a connection with a three-way handshake. The first segment carries SYN and the client's initial sequence number.", "RFC 9293 §3.5"],
  "TCP SYN-ACK": ["The server answers with SYN and ACK: its own initial sequence number, and the client's number plus one.", "RFC 9293 §3.5"],
  "TCP connection established": ["After the client acknowledges the SYN-ACK, both ends are ESTABLISHED and data can flow.", "RFC 9293 §3.5"],
  "Write application bytes": ["The application hands bytes to TCP; TCP decides how to cut them into segments.", "RFC 9293 §3.9.1.2"],
  "Create TCP segment": ["Each data segment carries the sequence number of its first byte and an acknowledgement of the bytes received so far.", "RFC 9293 §3.4"],
  "Create IPv4 packet": ["IP adds a header with source and destination addresses, the protocol inside, and a TTL.", "RFC 791 §3.1"],
  "Drop TCP data segment": ["IP does not guarantee delivery; TCP notices a loss when no acknowledgement arrives.", "RFC 9293 §3.8.1"],
  "Retransmit TCP segment": ["TCP resends data that has not been acknowledged when its retransmission timer expires.", "RFC 9293 §3.8.1"],
  "Acknowledge received bytes": ["An ACK number is the next byte the receiver expects; it confirms every byte before it.", "RFC 9293 §3.4"],
  "Server reads HTTP request": ["The server reads the request line and headers to decide what to send back.", "RFC 9112 §3"],
  "Build HTTP response": ["A response has a status line (200 OK means success), headers, and a body whose length Content-Length gives in bytes.", "RFC 9110 §15.3.1, §8.6"],
  "Read reassembled response": ["TCP delivers the bytes in order; the browser reads the complete response from the socket.", "RFC 9293 §3.8"],
  "HTTP journey complete": ["Each side closes its direction with FIN, and the other acknowledges it.", "RFC 9293 §3.6"],
};

const real: Record<string, string> = {
  "Associate with Wi-Fi": "Scanning, radio and encryption are not modeled; the lab only checks the network name and passphrase.",
  "DHCP Offer": "Real servers often send the Offer by unicast unless the client sets the broadcast flag (RFC 2131 §4.1). This lab broadcasts every server reply.",
  "DHCP ACK": "Real servers often send the ACK by unicast unless the client sets the broadcast flag (RFC 2131 §4.1). This lab broadcasts every server reply.",
  "Apply DHCP lease": "A real client should first check with ARP that nobody else uses the address (RFC 2131 §3.1). This lab skips that check.",
  "DHCP lease expired": "A real client tries to renew at half the lease time; this lab renews only when you run DHCP.",
  "DNS cache hit": "This lab keeps answers for the whole session; a real cache drops them when the record's TTL runs out.",
  "Save ARP mapping": "Real ARP entries expire after a while; this lab keeps them for the session.",
  "Learn source MAC": "Real switches forget entries after an ageing time (300 seconds by default); this lab keeps them for the session.",
  "Create IPv4 packet": "The header checksum, identification and fragmentation fields are not modeled.",
  "Create TCP segment": "This lab sends one segment and waits for its ACK (stop-and-wait). Sequence numbers start at fixed values instead of random ones, and window sizes and checksums are omitted.",
  "Retransmit TCP segment": "The timeout is a fixed modeled delay. Real TCP measures round-trip times to set it (RFC 6298).",
  "HTTP journey complete": "TIME-WAIT's timer is simplified, and real browsers often keep connections open for reuse.",
  "Decrease TTL": "If the TTL reached zero, a real router would also send ICMP Time Exceeded to the sender; this lab does not model ICMP errors.",
};

/** A valid lease the device already holds at this event: the lab re-checks Wi-Fi on every run, but the device keeps its address. */
export const heldLease = (e: TraceEvent) =>
  Object.values(e.snapshot.leases).find((l) => l.device === e.actor && l.expires > e.snapshot.time);

function summarize(c: Ctx): string {
  const { e, name, f, field, who, owner, dn } = c;
  const frame = e.layers.find((l) => l.kind === "link" && l.name.endsWith("frame"));
  const dstMac = frame?.fields["Destination MAC"];
  const dhcp = e.layers.find((l) => l.name.startsWith("DHCP "));
  const tcp = (k: string) => field("TCP segment", k);
  const ip = (k: string) => field("IPv4 packet", k);
  switch (e.title) {
    case "Associate with Wi-Fi": {
      const lease = heldLease(e);
      return lease
        ? `${name} is still on the Wi-Fi network “${f.SSID}” at ${f["Access point"]}; the lab checks the network name and passphrase again at the start of each run. ${name} keeps ${lease.ip} from its DHCP lease.`
        : `${name} joins the Wi-Fi network “${f.SSID}” at ${f["Access point"]}. It now has a wireless link, but no IP settings from it.`;
    }
    case "DHCP Discover":
      return `${name} has no IP address yet, so it broadcasts a DHCP Discover to its whole LAN, asking any DHCP server to answer.`;
    case "DHCP Offer":
      return `${name}'s DHCP server offers ${dhcp?.payload} to ${dn(e.dhcpContext?.client ?? "")}. The client may not use it yet.`;
    case "DHCP Request":
      return `${name} asks to use ${dhcp?.payload}, the address it was offered.`;
    case "DHCP ACK":
      return `${name} confirms the lease of ${dhcp?.payload} to ${dn(e.dhcpContext?.client ?? "")}.`;
    case "Apply DHCP lease": {
      const lease = Object.values(e.snapshot.leases).find((l) => l.device === e.actor);
      return lease
        ? `${name} received the ACK, so it now uses ${lease.ip}/${lease.prefix}, gateway ${lease.gateway} and DNS server ${lease.dns}.`
        : e.explanation;
    }
    case "Configuration complete":
      return `${name} is configured and can send IP traffic.`;
    case "DHCP lease expired":
      return `${name}'s DHCP lease has ended, so it must stop using that address.`;
    case "Prepare HTTP request": {
      const req = e.layers.find((l) => l.name === "HTTP request");
      return `The browser on ${name} prepares ${String(req?.payload ?? "").split("\r\n")[0]} for ${req?.fields.Host}. Nothing has been sent yet.`;
    }
    case "DNS query":
      return `${f.Name} is a name, not an address, so ${name} asks its DNS server ${f.Server}${owner(f.Server)} for its IPv4 address.`;
    case "DNS answer":
      return `The DNS answer arrived: ${f.Name} is ${f.Address}. ${name} saves it in its DNS cache.`;
    case "DNS cache hit":
      return `${name} already looked up ${f.Name} (${f.Address}), so it skips DNS this time.`;
    case "Choose a route":
      return f["Next hop"] === f.Destination
        ? `${name} checks its routing table: ${f.Destination} is on a connected network (${f.Route}), so it delivers the packet directly through ${f.Interface}.`
        : `${name} checks its routing table: ${f.Destination} is not on a connected network, so the best match, ${f.Route}, sends it through ${f.Interface} to next hop ${f["Next hop"]}${owner(f["Next hop"])}.`;
    case "ARP: discover the next-hop MAC": {
      const asked = field("ARP request", "Who has");
      return `${name} knows the next hop is ${asked}, but not its MAC address, so it broadcasts “Who has ${asked}?” to its LAN.`;
    }
    case "ARP cache hit":
      return `${name} already knows ${f.IP} is at ${f.MAC}, so it does not need ARP.`;
    case "ARP reply":
      return `${name} owns ${field("ARP reply", "Sender IP")}, so it answers ${who(field("ARP reply", "Target IP")) || field("ARP reply", "Target IP")} directly: “${field("ARP reply", "Sender IP")} is at ${field("ARP reply", "Sender MAC")}.”`;
    case "Save ARP mapping":
      return `${name} saves ${f.IP} → ${f.MAC} in its ARP cache.`;
    case "Wrap in a link frame":
      return f["Next hop"] === f.Destination
        ? `${name} puts the packet in a frame addressed to the MAC address of ${who(f.Destination)}, ${f["Next-hop MAC"]}.`
        : `${name} puts the packet in a frame addressed to the MAC address of ${who(f["Next hop"])}, ${f["Next-hop MAC"]}. The frame goes to the next hop; the packet inside is still addressed to ${f.Destination}.`;
    case "Transmit over Ethernet":
    case "Transmit over Wi-Fi":
      return `${dn(e.hop!.from)} sends the frame to ${dn(e.hop!.to)} over ${e.title.endsWith("Wi-Fi") ? "Wi-Fi" : "an Ethernet cable"}${dstMac === "ff:ff:ff:ff:ff:ff" ? ". It is a broadcast: every device on this LAN gets a copy." : "."}`;
    case "Learn source MAC":
      return `${name} notes that ${f.MAC} is reachable through its port ${f.Port}.`;
    case "Forward broadcast on LAN":
      return `${name} copies the broadcast out of its other ports.`;
    case "Forward using MAC table":
      return `${name} has learned that ${f.MAC} is behind port ${f.Port}, so it forwards the frame only there.`;
    case "Unknown MAC: flood eligible ports":
      return `${name} has not learned where ${f.MAC} is yet, so it sends a copy out of every other port.`;
    case "Receive frame": {
      if (c.bridge) return `${name} receives the frame and will pass it on within the LAN.`;
      const asked = field("ARP request", "Who has");
      if (asked !== undefined)
        return who(asked) === name
          ? `${name} hears the ARP broadcast and uses ${asked} itself, so it will answer.`
          : `${name} hears the ARP broadcast, but it does not use ${asked}, so it ignores the question.`;
      if (dhcp && e.dhcpContext) {
        const phase = String(dhcp.fields.Message), { client, server } = e.dhcpContext;
        const toServer = phase === "Discover" || phase === "Request";
        if (toServer && e.actor === server) return `${name} receives the DHCP ${phase} and runs the DHCP server, so it will answer.`;
        if (!toServer && e.actor === client) return `${name} receives the DHCP ${phase}: the reply to its own request.`;
        return `${name} hears the DHCP ${phase} broadcast, but it is not ${toServer ? "a DHCP server" : `${dn(client)}, the client that asked`}, so it ignores it.`;
      }
      const carried = frame?.fields.Carries;
      return `${name} accepts the frame because it is addressed ${dstMac === "ff:ff:ff:ff:ff:ff" ? "to everyone on the LAN (broadcast)" : `to its MAC ${dstMac}`}, and passes the ${carried} inside up to its network stack.`;
    }
    case "Discard frame for another MAC":
      return `${name} received a flooded copy addressed to ${dstMac}, which is not its MAC, so it drops it.`;
    case "Deliver IP payload":
      return `${name} owns ${ip("Destination IP")}, so IP hands the contents to ${ip("Protocol")}.`;
    case "Decrease TTL":
      return `${name} is forwarding the packet to another network, so it lowers the TTL from ${Number(ip("TTL")) + 1} to ${ip("TTL")}.`;
    case "Translate source with NAT":
      return `The packet is leaving the home network, so ${name} replaces the private source ${f.Inside} with its public ${f.Outside} and remembers the mapping.`;
    case "Restore reply destination":
      return `A reply arrived for ${f.Outside}. ${name}'s NAT table says that belongs to ${f.Inside}, so it rewrites the destination.`;
    case "Create ICMP echo request":
      return `${name} creates a ping (ICMP Echo Request) for ${f.Destination}.`;
    case "Create ICMP echo reply":
      return `${name} received the ping, so it answers with an Echo Reply to ${ip("Source IP")}.`;
    case "Ping complete":
      return `The Echo Reply reached ${name}: the path works in both directions.`;
    case "Create socket and connect":
      return `The browser asks ${name}'s operating system for a TCP connection to ${f.Remote}.`;
    case "TCP SYN":
      return `${name} starts the TCP handshake with ${ip("Destination IP")}:${tcp("Destination port")}: a SYN with sequence number ${tcp("Sequence")}.`;
    case "TCP SYN-ACK":
      return `${name} accepts the connection: SYN-ACK with its own sequence number ${tcp("Sequence")} and acknowledgement ${tcp("Acknowledgement")} (the client's number plus one).`;
    case "TCP connection established":
      return `The client acknowledged the SYN-ACK, so the handshake is complete and the connection is open.`;
    case "Write application bytes":
      return `${name}'s application writes ${e.layers[0]?.fields["UTF-8 bytes"]} bytes into its socket.`;
    case "Create TCP segment":
      return `TCP puts ${tcp("Payload bytes")} bytes in a segment: port ${tcp("Source port")} → ${tcp("Destination port")}, sequence ${tcp("Sequence")}, acknowledgement ${tcp("Acknowledgement")}.`;
    case "Create IPv4 packet":
      return `IP wraps the segment in a packet from ${ip("Source IP")} to ${ip("Destination IP")} with TTL ${ip("TTL")}.`;
    case "Drop TCP data segment":
      return `The loss experiment drops this segment (sequence ${tcp("Sequence")}) on its first link. ${name} does not know yet.`;
    case "Retransmit TCP segment":
      return `No ACK arrived for sequence ${tcp("Sequence")} before the timeout, so ${name} sends the same bytes again.`;
    case "Acknowledge received bytes":
      return `${name} has every byte before ${tcp("Acknowledgement")}, so it replies ACK ${tcp("Acknowledgement")}: the next byte it expects.`;
    case "Server reads HTTP request":
      return `${name}'s web server reads the request: ${String(e.layers[0]?.payload ?? "").split("\r\n")[0]}.`;
    case "Build HTTP response":
      return `${name} answers 200 OK with a ${e.layers[0]?.fields["Body bytes"]}-byte body.`;
    case "Read reassembled response":
      return `The browser on ${name} reads the whole response from its socket: 200 OK.`;
    case "HTTP journey complete":
      return `The page arrived, and both sides closed the connection with FIN and ACK.`;
    default:
      return e.explanation;
  }
}

/** The earlier event that caused this one, when it is not simply the event before. */
function causeOf(events: TraceEvent[], i: number, dn: (id: string) => string): Narration["cause"] {
  const e = events[i];
  const back = (pick: (x: TraceEvent) => boolean) => {
    for (let j = i - 1; j >= 0; j--) if (pick(events[j])) return j;
    return -1;
  };
  const make = (j: number, text: string) => (j >= 0 ? { index: j, text } : undefined);
  const route = () => back((x) => x.title === "Choose a route" && x.actor === e.actor);
  switch (e.title) {
    case "ARP: discover the next-hop MAC": {
      const j = route();
      return make(j, `Its route lookup chose next hop ${events[j]?.facts?.["Next hop"]}, and its ARP cache had no MAC address for it.`);
    }
    case "ARP cache hit": {
      const j = route();
      return make(j, `Its route lookup chose next hop ${events[j]?.facts?.["Next hop"]}, which it had resolved earlier.`);
    }
    case "ARP reply": {
      const j = back((x) => x.title === "ARP: discover the next-hop MAC");
      return make(j, `${dn(events[j]?.actor ?? "")} broadcast “Who has ${events[j]?.layers[0]?.fields["Who has"]}?”, and this device owns that address.`);
    }
    case "Save ARP mapping":
      return make(back((x) => x.title === "ARP reply"), "The ARP reply delivered the missing MAC address.");
    case "Wrap in a link frame": {
      const j = back((x) => (x.title === "Save ARP mapping" || x.title === "ARP cache hit") && x.actor === e.actor);
      return make(j, `ARP supplied the next hop's MAC address ${events[j]?.facts?.MAC}.`);
    }
    case "Translate source with NAT":
      return make(route(), "The route sends the packet out of the router's outside interface, where NAT is enabled.");
    case "Restore reply destination": {
      const j = back((x) => x.title === "Translate source with NAT" && x.actor === e.actor && x.facts?.Outside === e.facts?.Outside);
      return make(j, `This mapping was created when the request left: ${events[j]?.facts?.Inside} → ${events[j]?.facts?.Outside}.`);
    }
    case "DHCP Offer":
      return make(back((x) => x.title === "DHCP Discover"), "It answers the client's broadcast Discover.");
    case "DHCP Request":
      return make(back((x) => x.title === "DHCP Offer"), "The client received the Offer.");
    case "DHCP ACK":
      return make(back((x) => x.title === "DHCP Request"), "The client asked for the offered address.");
    case "Apply DHCP lease":
      return make(back((x) => x.title === "DHCP ACK"), "The server's ACK has now reached the client.");
    case "DNS answer":
      return make(back((x) => x.title === "DNS query"), "It answers the query the client sent.");
    case "DNS query":
      return make(back((x) => x.title === "Prepare HTTP request" || x.title === "Create ICMP echo request"), "The destination was given as a name.");
    case "TCP SYN-ACK":
      return make(back((x) => x.title === "TCP SYN"), "The client's SYN reached the server.");
    case "TCP connection established":
      return make(back((x) => x.title === "TCP SYN-ACK"), "The server's SYN-ACK reached the client, which acknowledged it.");
    case "Retransmit TCP segment":
      return make(back((x) => x.title === "Drop TCP data segment"), "This segment was lost, so no ACK came back for it.");
    case "Acknowledge received bytes": {
      const seq = e.layers.find((l) => l.name === "TCP segment")?.fields.Acknowledgement;
      const j = back((x) => x.title === "Create TCP segment" || x.title === "Retransmit TCP segment");
      return make(j, `The data segment arrived; the ACK ${seq} confirms its bytes.`);
    }
    case "Create ICMP echo reply":
      return make(back((x) => x.title === "Create ICMP echo request"), "The echo request reached its destination.");
    case "Delivery stopped": {
      const j = i - 1;
      return make(j, `The last step that worked: ${events[j]?.title} at ${dn(events[j]?.actor ?? "")}.`);
    }
  }
  return undefined;
}

export function narrate(events: TraceEvent[], index: number, network: Network): Narration {
  const e = events[index];
  const base = explainStep(e, network);
  const dn = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const actor = network.devices.find((d) => d.id === e.actor);
  const who = (address: unknown) => {
    for (const d of network.devices)
      if (d.interfaces.some((p) => effectiveInterface(d, p, e.snapshot).ip === address)) return d.name;
    return "";
  };
  const ctx: Ctx = {
    e,
    name: dn(e.actor),
    bridge: !!actor && isBridge(actor),
    dn,
    who,
    owner: (address) => (who(address) ? ` (${who(address)})` : ", an address no device in this network uses"),
    f: e.facts ?? {},
    field: (layer, key) => e.layers.find((l) => l.name === layer)?.fields[key],
  };
  if (e.error) {
    const info = e.reason && failures[e.reason];
    return {
      ...base,
      summary: info ? `${info.title}. ${e.explanation}` : e.explanation,
      cause: causeOf(events, index, dn),
      rule: info?.source ? { text: info.rule, source: info.source } : undefined,
      real: info?.real,
    };
  }
  const rule = rules[e.title];
  return {
    ...base,
    summary: summarize(ctx),
    cause: causeOf(events, index, dn),
    rule: rule && { text: rule[0], source: rule[1] },
    real: real[e.title],
  };
}
