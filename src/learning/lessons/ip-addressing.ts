import type { Lesson } from "./schema.ts";
import { ipTerms } from "./ip-terms.ts";

export const ipAddressing: Omit<Lesson, "experiments" | "practice"> = {
  schemaVersion: 1,
  id: "ip-addressing",
  version: "1.0.0",
  title: "IP Addresses & Subnets",
  question: "How does your PC know where to send a packet?",
  summary: "Start on your home Wi-Fi. Read an IPv4 address, split a subnet, choose a next hop, and watch your router translate a web request with NAT.",
  topic: "Networks",
  review: { status: "reviewed", note: "The subnet math, next hop and example NAT mappings come from the lesson model." },
  engine: { id: "ip-addressing", version: "1.0.0" },
  scenario: { prefix: 24, target: "printer" },
  nextLessonId: "hello-tcp",
  scope: [
    "A home LAN with a PC, phone, router, and a printer. Change the prefix or destination under Change the example.",
    "The PC has a connected route and a default route. In the split network the router can reach the printer's other subnet.",
    "NAT follows a separate web example using illustrative public addresses. It models address and port translation for two TCP connections.",
  ],
  prerequisites: "None. Start with the devices on your home Wi-Fi.",
  levels: [
    { id: "local", name: "Local network", short: "Devices and interfaces", intro: "A LAN is the local network shared by nearby wired and wireless interfaces. A router has an interface on each network it connects." },
    { id: "addressing", name: "Addressing", short: "IPv4, subnet masks and ranges", intro: "A prefix says how many leading bits identify a subnet. Applying the mask keeps those bits and clears the rest." },
    { id: "forwarding", name: "Forwarding", short: "Routes and next hops", intro: "The OS picks the most specific route that matches the packet destination. The next hop is the device it hands the packet to on this link." },
    { id: "translation", name: "Translation", short: "Private IPs and NAT", intro: "A home router can rewrite the source IP and port when a connection goes out. It uses the saved mapping to translate the destination of a returning packet." },
  ],
  glossary: ipTerms,
  kinds: {
    interface: { represents: "An interface attached to the example network.", matters: "Its IP settings determine how it can be reached and which destinations are local." },
    mask: { represents: "The prefix and corresponding subnet mask.", matters: "Applying it exposes the leading bits used to compare networks." },
    subnet: { represents: "The range and boundaries of each IPv4 subnet.", matters: "More prefix bits make each block smaller." },
    route: { represents: "A route to a destination and the immediate next hop.", matters: "The packet keeps its destination IP when it is handed to a gateway." },
    translation: { represents: "The router's packet rewrite and saved NAT mapping.", matters: "One outside IP can serve multiple connections with distinct translated ports." },
  },
  controls: [
    { key: "prefix", label: "PC subnet prefix", control: "choice", options: [{ value: 24, label: "/24 · one subnet" }, { value: 25, label: "/25 · split subnets" }], help: "The PC stays at the same IP. Change the prefix to move the subnet boundary." },
    { key: "target", label: "Destination", control: "choice", options: [{ value: "phone", label: "Phone · 192.168.1.25" }, { value: "printer", label: "Printer · 192.168.1.130" }, { value: "web", label: "Web · 198.51.100.20" }], help: "Compare a nearby phone, a printer near the subnet boundary, and an internet destination." },
  ],
  chapters: [
    { id: "home-lan", title: "LAN & subnet", goal: "See what is connected and which addresses count as local.", steps: [
      { id: "meet-lan", frame: "lan", what: "Your PC ({fact:client-ip}) and phone ({fact:phone-ip}) join the home LAN. The router's LAN interface is {fact:gateway-ip}.", why: "Devices on the home network can exchange frames with each other, such as when the PC sends a document to a local printer.", terms: ["lan"], focus: [] },
      { id: "interfaces", frame: "interfaces", what: "The router has a LAN interface at {fact:gateway-ip} and a WAN interface at {fact:router-wan} in this example. Your PC's IP is on its own Wi-Fi interface.", why: "Each interface connects to a network. At home, DHCP usually supplies your PC's address, subnet mask, and default gateway when it joins.", terms: ["ip-address", "interface", "wan", "dhcp"], focus: [] },
      { id: "meet-subnet", frame: "subnet", what: "The PC is in {fact:connected-subnet}. The diagram shows its address block and whether {fact:destination-ip} is in it.", why: "The LAN is the network the devices connect to. The subnet describes an IP address block used on that network. Change the example to see how /25 moves the printer outside the PC’s subnet.", terms: ["subnet"], focus: [] },
    ] },
    { id: "read-address", title: "Read an address", goal: "Read the address and its prefix in both decimal and bits.", steps: [
      { id: "four-octets", frame: "address", what: "{fact:client-ip}/{fact:prefix} is the PC's IPv4 address and prefix. The four numbers encode four groups of eight bits. The slash tells you how many bits identify the subnet.", why: "An address labels an interface. The prefix gives that address its network boundary, so the PC can work out which addresses share its subnet.", terms: ["prefix", "octet"], focus: [] },
      { id: "apply-mask", frame: "mask", what: "The mask is {fact:mask}. The PC applies it to its address and to {fact:destination-ip}. The results are {fact:client-network} and {fact:destination-network}.", why: "AND keeps a bit where the mask is 1 and clears it where the mask is 0. Matching results put the destination in the PC's connected subnet. A masked remote address here is only a comparison, since the PC may not know the remote network's actual prefix.", terms: ["mask"], focus: [] },
    ] },
    { id: "split", title: "Split a subnet", goal: "See how one more prefix bit cuts a block into two halves.", steps: [
      { id: "split-range", frame: "ranges", what: "Split {fact:parent-subnet} into {fact:lower-subnet} and {fact:upper-subnet}. Each half has {fact:half-size} addresses and {fact:usable} usable host addresses in this example.", why: "The new prefix bit can be 0 or 1, creating two equally sized blocks. In each /25 here, the first address identifies the network and the last is its broadcast address. Hosts use the addresses between them.", terms: ["subnetting", "broadcast"], focus: [] },
    ] },
    { id: "route", title: "Choose a route", goal: "Follow the PC's decision to deliver directly or use a gateway.", steps: [
      { id: "choose-hop", frame: "routes", what: "For {fact:destination-name} at {fact:destination-ip}, the PC chooses: {fact:route-type}. The next hop is {fact:next-hop}.", why: "The connected route wins when it matches because its prefix is longer than the default route. Try the printer with /24 and /25 under Change the example. The printer keeps its IP, and the PC's next hop changes.", terms: ["default", "hop", "router", "route-table"], focus: [] },
      { id: "local-delivery", frame: "link", what: "The IP packet is addressed to {fact:destination-ip}. The local frame carries it to next hop {fact:next-hop}, using the MAC address {fact:next-hop-mac} in this example.", why: "The IP destination tells devices where the packet is ultimately headed. The frame's destination MAC gets it across this local link. The PC can use ARP to find that MAC address if it does not have it cached.", terms: ["arp", "mac", "packet", "frame"], focus: [] },
    ] },
    { id: "nat", title: "Follow NAT", goal: "Watch the router rewrite a web packet and find the right device for the reply.", steps: [
      { id: "translate-out", frame: "nat-out", what: "For this separate web example, the router changes the outgoing packet from {fact:packet-before} to {fact:packet-after}.", why: "Private IPv4 addresses can be reused inside different homes. In this example, the PC and phone share an outside address. The router saves a distinct outside port for each connection so replies can be matched.", terms: ["nat", "private", "public", "mapping"], focus: [] },
      { id: "translate-in", frame: "nat-in", what: "The reply arrives as {fact:packet-before}. The router finds the PC's entry and sends it back to the LAN as {fact:packet-after}.", why: "The returning destination IP and port identify a mapping on this router. The router restores the PC's private destination IP and port before delivering the reply. The server's endpoint stays the same on both sides of this translation.", terms: ["mapping"], focus: [] },
      { id: "continue", frame: "handoff", what: "In Packet Journey, the client calls {fact:trace-method} for {fact:trace-destination} and picks {fact:trace-next-hop} before wrapping the request segment in IPv4.", why: "The recorded walkthrough uses a different sample network and demonstrates forwarding. Now you can read its destination IP and next hop separately. The NAT example belongs to the home-router lesson you just completed.", focus: [], terms: [] },
    ] },
  ],
  sources: [
    { id: "ipv4-host-routing", text: "RFC 1122 §3.3.1.1. The local or remote decision compares the addresses after applying the local interface's mask. For a remote destination, the packet goes to a gateway on a connected network." },
    { id: "cidr-blocks", text: "RFC 4632 §3. A CIDR prefix indicates the number of leading bits in the network. A /24 has 256 addresses, and a /25 has 128. When forwarding, the longest matching prefix wins." },
    { id: "traditional-nat", text: "RFC 3022 §2–3. Network Address Port Translation maps an internal IP address and transport port to an outside address and port. Return packets are translated in the reverse direction." },
  ],
};
