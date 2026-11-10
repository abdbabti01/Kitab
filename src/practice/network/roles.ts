// A device's role in the current run, read from its own events and the snapshot at the current
// step. Generic definitions only say what a kind of device is; this says what this one did.
import { effectiveInterface } from "./engine.ts";
import { narrate } from "./narration.ts";
import type { Device, Network, TraceEvent } from "./model.ts";

export type Role = {
  /** What kind of device this is and which services it runs here. */
  what: string;
  /** What it did so far in this run, counted from its events. */
  did: string[];
  /** What it is doing at the current step, if anything. */
  now: string;
  /** The table entry or setting that mattered for its latest decision. */
  entry?: { table: string; row: string };
  /** A common misconception about this kind of device. */
  not: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function deviceRole(device: Device, network: Network, events: TraceEvent[], index: number): Role {
  const mine = events.slice(0, index + 1).filter((e) => e.actor === device.id);
  const count = (title: string) => mine.filter((e) => e.title === title).length;
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const snapshot = events[index]?.snapshot;
  const services = [
    device.dhcp.enabled && "a DHCP server",
    device.nat && "NAT",
    Object.keys(device.records).length && "a DNS server",
    device.web.enabled && "a web server on port 80",
  ].filter(Boolean) as string[];
  const what = {
    switch: "A switch joins devices into one LAN. It forwards frames by MAC address and learns which port leads to each device.",
    ap: "An access point joins Wi-Fi devices to the wired LAN. It bridges frames between radio and cable.",
    router: "A router connects separate IP networks. It chooses a next hop for each packet from its routing table.",
    pc: "A computer: an endpoint that starts and answers conversations.",
    phone: "A phone: a Wi-Fi endpoint that starts and answers conversations.",
    server: "A server: an endpoint that offers services to others.",
  }[device.kind];
  const did: string[] = [];
  const learned = new Set(mine.filter((e) => e.title === "Learn source MAC").map((e) => e.facts?.MAC));
  if (learned.size) did.push(`Learned where ${plural(learned.size, "MAC address", "MAC addresses")} ${learned.size === 1 ? "is" : "are"}.`);
  if (count("Forward broadcast on LAN")) did.push(`Copied ${plural(count("Forward broadcast on LAN"), "broadcast")} to its other ports.`);
  if (count("Forward using MAC table")) did.push(`Forwarded ${plural(count("Forward using MAC table"), "frame")} to the one port its MAC table named.`);
  if (count("Unknown MAC: flood eligible ports")) did.push(`Flooded ${plural(count("Unknown MAC: flood eligible ports"), "frame")} for a MAC address it had not learned yet.`);
  if (count("Associate with Wi-Fi")) did.push(`Joined the Wi-Fi network “${mine.find((e) => e.title === "Associate with Wi-Fi")!.facts?.SSID}”.`);
  if (count("DHCP Discover")) did.push("Asked for network settings with DHCP.");
  if (count("DHCP Offer")) did.push(`Offered ${plural(count("DHCP Offer"), "address", "addresses")} from its DHCP pool.`);
  if (count("Apply DHCP lease")) did.push("Applied the settings its DHCP lease gave it.");
  const asked = mine.filter((e) => e.title === "ARP: discover the next-hop MAC").map((e) => e.layers[0]?.fields["Who has"]);
  if (asked.length) did.push(`Used ARP to find the MAC address of ${[...new Set(asked)].join(", ")}.`);
  if (count("ARP reply")) did.push(`Answered ${plural(count("ARP reply"), "ARP question")} about its own address.`);
  const routes = new Set(mine.filter((e) => e.title === "Choose a route").map((e) => `${e.facts?.Route} → ${e.facts?.["Next hop"]}`));
  if (routes.size) did.push(`Chose next hops from its routing table ${plural(count("Choose a route"), "time")}: ${[...routes].join("; ")}.`);
  if (count("Decrease TTL")) did.push(`Forwarded ${plural(count("Decrease TTL"), "packet")} between networks, lowering the TTL each time.`);
  if (count("Translate source with NAT")) did.push(`Translated ${plural(count("Translate source with NAT"), "outgoing packet")} to its public address (NAT).`);
  if (count("Restore reply destination")) did.push(`Restored the private destination of ${plural(count("Restore reply destination"), "reply", "replies")} from its NAT table.`);
  // A DNS reply this device created: the first event of a packet that carries a DNS answer or error.
  const origin = new Map<string, string>();
  for (const e of events) if (e.packet && !origin.has(e.packet)) origin.set(e.packet, e.actor);
  const answered = mine.filter(
    (e) => e.title === "Choose a route" && origin.get(e.packet ?? "") === device.id && e.layers.some((l) => l.name === "DNS answer" || l.name === "DNS error"),
  ).length;
  if (answered) did.push(`Answered ${plural(answered, "DNS query", "DNS queries")}.`);
  if (count("DNS query")) did.push("Asked its DNS server for a name's address.");
  if (count("DNS answer") || count("DNS cache hit")) did.push("Learned a name's address from DNS.");
  if (count("TCP SYN")) did.push("Opened a TCP connection.");
  if (count("TCP SYN-ACK")) did.push("Accepted a TCP connection.");
  if (count("Create TCP segment")) did.push(`Sent ${plural(count("Create TCP segment"), "TCP data segment")}.`);
  if (count("Retransmit TCP segment")) did.push(`Resent ${plural(count("Retransmit TCP segment"), "lost segment")}.`);
  if (count("Acknowledge received bytes")) did.push(`Acknowledged ${plural(count("Acknowledge received bytes"), "data segment")}.`);
  if (count("Deliver IP payload")) did.push(`Received ${plural(count("Deliver IP payload"), "packet")} addressed to itself.`);
  if (count("Discard frame for another MAC")) did.push(`Ignored ${plural(count("Discard frame for another MAC"), "flooded frame")} meant for another MAC address.`);
  if (count("Server reads HTTP request")) did.push("Served an HTTP request.");
  const event = events[index];
  const now = !event
    ? ""
    : event.actor === device.id
      ? narrate(events, index, network).summary
      : event.hop?.from === device.id
        ? `Sending a frame to ${name(event.hop.to)}.`
        : event.hop?.to === device.id
          ? `About to receive a frame from ${name(event.hop.from)}.`
          : "Not involved in this step.";
  // The table row behind its latest decision, as it stands at this step.
  let entry: Role["entry"];
  const tables = /^(Choose a route|ARP cache hit|Save ARP mapping|Learn source MAC|Forward using MAC table|Translate source with NAT|Restore reply destination|DNS answer|DNS cache hit|Associate with Wi-Fi)$/;
  const latest = [...mine].reverse().find((e) => tables.test(e.title));
  const f = latest?.facts ?? {};
  if (latest?.title === "Choose a route") entry = { table: "Routing table", row: `${f.Route} → next hop ${f["Next hop"]} via ${f.Interface}` };
  else if (latest && /ARP/.test(latest.title)) entry = { table: "ARP cache", row: `${f.IP} → ${f.MAC}` };
  else if (latest && /MAC/.test(latest.title) && f.Port) entry = { table: "MAC table", row: `${f.MAC} → port ${f.Port}` };
  else if (latest && /NAT|Restore/.test(latest.title)) entry = { table: "NAT table", row: `${f.Inside} ↔ ${f.Outside}` };
  else if (latest && /DNS/.test(latest.title) && f.Address) entry = { table: "DNS cache", row: `${f.Name} → ${f.Address}` };
  else if (latest?.title === "Associate with Wi-Fi") entry = { table: "Wi-Fi", row: `Joined “${f.SSID}” at ${f["Access point"]}` };
  const lease = snapshot && Object.values(snapshot.leases).find((l) => l.device === device.id);
  if (!entry && lease) entry = { table: "DHCP lease", row: `${lease.ip}/${lease.prefix} from ${name(lease.server)}, gateway ${lease.gateway}` };
  const address = device.interfaces.map((p) => (snapshot ? effectiveInterface(device, p, snapshot) : p)).find((p) => p.ip);
  const not = {
    switch: "It does not read IP addresses or route between networks; to it, every frame is just a MAC address and a port.",
    ap: "It does not hand out IP addresses (DHCP does that) and does not route; it bridges frames.",
    router: "It does not pass local broadcasts such as ARP or DHCP Discover on to its other networks.",
    pc: "It does not forward other devices' packets; a packet not addressed to it is discarded.",
    phone: "Joining Wi-Fi gives it a link, not an IP address; that comes from DHCP or static settings.",
    server: "It does not forward other devices' packets; a packet not addressed to it is discarded.",
  }[device.kind];
  return {
    what: `${what}${services.length ? ` Here it also runs ${services.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : ""}${address ? ` Its address is ${address.ip}/${address.prefix}.` : ""}`,
    did,
    now,
    entry,
    not,
  };
}
