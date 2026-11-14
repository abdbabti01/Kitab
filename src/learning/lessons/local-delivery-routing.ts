import type { Lesson } from "./schema.ts";
import { ipv4Terms } from "./ipv4-subnets.ts";

// Lesson 2 of the IPv4 redesign. Every networking value comes from a real run of the lab's simulator, through the
// local-delivery engine; the text explains cause and purpose and never states a value on its own.
const reuse = (...ids: string[]) => ids.map((id) => ipv4Terms.find((term) => term.id === id)!);

const terms: Lesson["glossary"] = [
  ...reuse("same-subnet", "default-gateway", "arp"),
  {
    id: "next-hop", term: "Next hop",
    definition: "The next IP device a packet is handed to: the destination itself when it's on the same subnet, otherwise a router. Switches and access points in between are not hops.",
    purpose: "Choosing the next hop is the first decision a device makes for every packet it sends.",
  },
  {
    id: "mac-address", term: "MAC address",
    definition: "The hardware address of a network interface. Ethernet and Wi-Fi frames are addressed with MAC addresses, and only within one link.",
    purpose: "A frame needs the next hop's MAC to be delivered on the link, which is why devices use ARP.",
  },
  {
    id: "frame-and-packet", term: "Frame and packet",
    definition: "The IP packet carries the source and destination IP for the whole journey. Each link wraps it in a new frame, addressed with the MACs of the two devices on that link.",
    purpose: "It explains why the IP addresses stay the same across a router while the MAC addresses change.",
  },
  {
    id: "ttl", term: "TTL (time to live)",
    definition: "A counter in the IP header. Every router lowers it by one; a router that brings it to 0 discards the packet instead of forwarding it.",
    purpose: "It stops a packet from looping between routers forever.",
  },
  {
    id: "switch-not-hop", term: "Switch",
    definition: "A device that forwards frames inside one network using its MAC address table. It doesn't change the frame's addresses or the TTL, so it is not a hop.",
  },
  {
    id: "routing-table", term: "Routing table",
    definition: "A router's list of networks it can reach and where to send packets for each: out of an interface, and to which next hop.",
    purpose: "A router forwards each packet by looking its destination up here.",
  },
  {
    id: "connected-route", term: "Connected route",
    definition: "A route a router has because one of its own interfaces is on that network. Packets for that network are sent straight to the destination on that link.",
  },
  {
    id: "default-route", term: "Default route",
    definition: "0.0.0.0/0, which matches every destination. A router uses it when no more specific route matches; when several match, the longest prefix wins.",
  },
  {
    id: "nat-vs-routing", term: "Routing is not NAT",
    definition: "Routing chooses where a packet goes next and keeps its IP addresses. NAT, which many home routers also do, rewrites addresses. Most routers on a network route without NAT.",
  },
];

export const localDeliveryRouting: Lesson = {
  schemaVersion: 1,
  id: "local-delivery-routing",
  version: "1.0.0",
  title: "Local delivery, gateways and routing",
  question: "Who does my PC hand a packet to, and how does a router get it to another subnet?",
  summary: "Follow a real simulated ping from your PC through a router to another subnet: the next-hop decision, ARP for the gateway, the frame and packet at every link, and the router's routing decision.",
  topic: "Networks",
  review: { status: "reviewed", note: "Every networking value comes from a run of Kitab's network simulator." },
  engine: { id: "local-delivery", version: "1.0.0" },
  scenario: {},
  scope: [
    "Every step is an event from a real run of Kitab's network simulator on the lab's own starter networks: “Two connected LANs”, “Your first LAN” and the internet starter.",
    "The first decision is the same-subnet arithmetic from Lesson 1, labelled as a calculation. Everything after it, including ARP replies, MAC addresses, routes, TTL and delivery, is what the simulator did.",
    "The routers here forward without NAT, so the IP addresses stay as your PC wrote them. NAT and three experiments that break a setting come in the next part of this lesson.",
    "Predictions are for practice: nothing is scored or recorded.",
  ],
  prerequisites: "Lesson 1, Understanding IPv4 addresses and subnets: the same-subnet decision.",
  levels: [
    { id: "decision", name: "Decision", short: "Direct or gateway", intro: "Before sending, a device decides with its own address and prefix whether the destination is on its subnet." },
    { id: "link", name: "Link", short: "Frames, MACs and ARP", intro: "On each link, a frame carries the packet between two neighbours, addressed with their MAC addresses." },
    { id: "network", name: "Network", short: "Packets, routers and routes", intro: "The IP packet keeps its source and destination end to end. Routers forward it by looking the destination up in a routing table." },
  ],
  glossary: terms,
  controls: [],
  experiments: [],
  practice: [],
  kinds: {
    device: { represents: "A device in the simulated network, shown at the step where it handles the packet.", matters: "Each device makes one decision: send, forward by MAC, or route by IP." },
  },
  chapters: [
    { id: "same-subnet", title: "Same subnet?", goal: "Your PC decides, with its own prefix, whether to deliver directly or use its gateway.", steps: [
      { id: "decide", title: "Your PC decides: direct or gateway?", frame: "same-subnet", actor: "Your PC", focus: ["pc"], terms: ["same-subnet", "default-gateway"], what: "Your PC is {fact:pc-address} and wants to ping {fact:destination}. Answer the question in the picture first. With its own mask, its address gives {fact:own-network} and the destination gives {fact:destination-network}. Same subnet: {fact:same-subnet}.", why: "This is Lesson 1's arithmetic, a calculation before anything is sent. A different network means the packet goes to the default gateway, {fact:gateway}, which must itself be on your PC's subnet." },
    ] },
    { id: "arp-or-gateway", title: "ARP or gateway", goal: "See your PC choose the gateway as its next hop and use ARP to find the gateway's MAC, not the server's.", steps: [
      { id: "choose-route", title: "Your PC chooses its next hop", frame: "pc-route", actor: "Your PC", focus: ["pc"], terms: ["next-hop"], what: "The simulator shows your PC's decision for {fact:destination-ip}: route “{fact:route}”, interface {fact:interface}, next hop {fact:next-hop}. Answer the question in the picture before going on.", why: "The packet's destination stays {fact:destination-ip}, but on this link it can only be handed to a neighbour: the next hop." },
      { id: "arp-request", title: "ARP: who has the gateway's address?", frame: "pc-arp", actor: "Your PC", focus: ["pc"], terms: ["arp", "mac-address"], what: "Your PC asks “who has {fact:arp-asks-who-has}?” in a frame to {fact:destination-mac}, the broadcast address, so every device on the link hears it.", why: "Your PC knows its next hop's IP, not its MAC. It asks for the gateway's address, never the server's: the server isn't on this link." },
      { id: "arp-reply", title: "The router answers", frame: "router-arp-reply", actor: "Router", focus: ["router"], terms: [], what: "The router answers: {fact:arp-sender-ip} is at {fact:arp-sender-mac}, sent back to {fact:arp-reply-to}.", why: "Only the device that owns the address answers. On this LAN that's the router's LAN interface." },
      { id: "arp-saved", title: "Your PC remembers the router's MAC", frame: "pc-arp-saved", actor: "Your PC", focus: ["pc"], terms: [], what: "Your PC saves the mapping {fact:ip} → {fact:mac} in its ARP cache.", why: "With the next hop's MAC known, your PC can build the frame. Later packets to the gateway reuse this entry instead of asking again." },
      { id: "the-frame", title: "The frame and the packet inside", frame: "pc-frame", actor: "Your PC", focus: ["pc"], terms: ["frame-and-packet"], what: "The frame goes from {fact:source-mac} to {fact:destination-mac}, the router. Inside, the packet still says {fact:source-ip} → {fact:destination-ip}, TTL {fact:ttl}.", why: "Two addresses, two jobs: the MACs address this one link, the IPs address the whole journey. Your PC sends it out of {fact:outgoing-port}." },
    ] },
    { id: "two-addresses", title: "Two addresses, two jobs", goal: "Compare what a switch and a router do to a frame.", steps: [
      { id: "switch-forwards", title: "A switch passes the frame on unchanged", frame: "switch-forwards", actor: "Switch", focus: ["switch"], terms: ["switch-not-hop"], what: "On “Your first LAN”: MACs {fact:lan-before-source-mac} → {fact:lan-before-destination-mac} as your PC sends it, {fact:lan-after-source-mac} → {fact:lan-after-destination-mac} as the switch passes it on. TTL {fact:lan-before-ttl}, then {fact:lan-after-ttl}.", why: "A switch forwards frames inside one network by MAC address and changes nothing, so it isn't a hop. The server here is on your PC's own subnet." },
      { id: "router-forwards", title: "A router builds a new frame", frame: "router-forwards", actor: "Router", focus: ["router"], terms: ["ttl", "nat-vs-routing"], what: "On “Two connected LANs”: IPs {fact:before-source-ip} → {fact:before-destination-ip}, then {fact:after-source-ip} → {fact:after-destination-ip}. MACs {fact:before-source-mac} → {fact:before-destination-mac}, then {fact:after-source-mac} → {fact:after-destination-mac}. TTL {fact:before-ttl}, then {fact:after-ttl}.", why: "A router ends the frame it received and builds a new one for the next link, and lowers the TTL. It keeps the IP addresses: routing isn't NAT, and NAT is {fact:nat} on this router." },
    ] },
    { id: "router-between-subnets", title: "A router between subnets", goal: "Follow the router's decision: receive, lower TTL, look up the route, ARP on the other side, deliver, and the reply.", steps: [
      { id: "router-receives", title: "The router receives the frame", frame: "router-receives", actor: "Router", focus: ["router"], terms: [], what: "The router receives the frame addressed to its MAC, {fact:destination-mac}. The packet inside is {fact:source-ip} → {fact:destination-ip}, TTL {fact:ttl}.", why: "The frame was for the router, but the packet isn't: its destination is another network, so the router has to forward it." },
      { id: "router-ttl", title: "The router lowers the TTL", frame: "router-ttl", actor: "Router", focus: ["router"], terms: ["ttl"], what: "The router lowers the TTL to {fact:ttl}.", why: "Every router lowers TTL by one before forwarding, so a packet caught in a loop eventually stops." },
      { id: "router-route", title: "The router chooses a route", frame: "router-route", actor: "Router", focus: ["router"], terms: ["routing-table", "connected-route"], what: "Answer the question in the picture first. The router's connected routes are {fact:connected-lan} and {fact:connected-wan}. For {fact:destination-ip} it chooses “{fact:route}”: out of {fact:interface}, next hop {fact:next-hop}.", why: "The destination is on a network the router is directly connected to, so the next hop is the destination itself." },
      { id: "router-arp", title: "ARP on the router's other side", frame: "router-arp", actor: "Router", focus: ["router"], terms: ["arp"], what: "On its other side the router asks “who has {fact:arp-asks-who-has}?” from its own interface {fact:arp-sender-ip} ({fact:arp-sender-mac}).", why: "ARP only works within one link, so each router finds the next MAC on the link it's sending out of." },
      { id: "delivered", title: "The server receives the packet", frame: "server-delivers", actor: "Office server", focus: ["server"], terms: [], what: "{fact:device} receives the packet {fact:source-ip} → {fact:destination-ip}, with TTL {fact:ttl}, and hands it to its own software.", why: "The source IP is still your PC's: the server can tell who to reply to." },
      { id: "reply-route", title: "The reply's own route", frame: "reply-route", actor: "Router", focus: ["router"], terms: [], what: "The reply, {fact:source-ip} → {fact:destination-ip}, reaches the router, which chooses “{fact:route}” out of {fact:interface}.", why: "The way back is its own routing decision. Here the router is connected to both networks, so both directions work." },
      { id: "complete", title: "The simulated ping completes", frame: "ping-complete", actor: "Your PC", focus: ["pc"], terms: [], what: "{fact:summary}", why: "This is the simulator's result for this run: simulated run succeeded = {fact:delivered}. Every step above came from that run." },
      { id: "default-route", title: "When no connected route matches", frame: "default-route", actor: "Home router", focus: ["router"], terms: ["default-route"], what: "On the internet starter, the home router has no connected route for {fact:internet-destination-ip}, so it uses “{fact:internet-route}”: out of {fact:internet-interface} to next hop {fact:internet-next-hop}.", why: "A default route catches every destination no other route matches. When several routes match, the one with the longest prefix wins." },
    ] },
  ],
  sources: [
    { id: "next-hop", text: "RFC 1122 §3.3.1. A host sends a datagram directly when the destination is on a connected network, otherwise to a gateway on its own network; it uses the next hop's link-layer address, found with ARP." },
    { id: "arp", text: "RFC 826. ARP broadcasts a request for the hardware address that belongs to a protocol address on the local network; the owner of that address replies directly." },
    { id: "forwarding", text: "RFC 1812 §5.2–5.3. A router decrements TTL, chooses a route for the destination (the longest matching prefix), and transmits the packet on the next link in a new link-layer frame." },
    { id: "nat", text: "RFC 3022 §2. Network Address Translation rewrites addresses at a boundary between networks; it is a separate function from IP routing." },
  ],
};
