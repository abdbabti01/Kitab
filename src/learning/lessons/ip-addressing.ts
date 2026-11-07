import type { Lesson } from "./schema.ts";

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
  glossary: [
    { id: "lan", term: "LAN", definition: "Local area network. In this example it is your home network, which can include Ethernet and Wi-Fi." },
    { id: "wan", term: "WAN", definition: "Wide area network. Here it means the router's outside connection toward the internet provider." },
    { id: "interface", term: "Network interface", definition: "A connection point to a network, such as a PC's Wi-Fi adapter or the router's LAN side." },
    { id: "dhcp", term: "DHCP", definition: "A common way for a device to receive its IPv4 address, subnet mask, default gateway and DNS settings automatically." },
    { id: "octet", term: "Octet", definition: "Eight bits. An IPv4 address has four octets, each written as a number from 0 to 255." },
    { id: "prefix", term: "Prefix length", definition: "How many bits from the left identify the subnet. CIDR notation writes this after a slash, such as /24." },
    { id: "mask", term: "Subnet mask", definition: "A 32-bit pattern with ones in the prefix and zeros after it. Bitwise AND keeps an address bit under a one and clears it under a zero." },
    { id: "subnet", term: "Subnet", definition: "A range of IP addresses that share a prefix. The address range and prefix length together identify it." },
    { id: "subnetting", term: "Subnetting", definition: "Dividing one IP address block into smaller blocks by using a longer prefix." },
    { id: "broadcast", term: "Broadcast address", definition: "The last address in the ordinary subnets shown here. It addresses all hosts on that subnet." },
    { id: "default", term: "Default gateway", definition: "The router used when the host has no more specific matching route. The IPv4 default route is written 0.0.0.0/0." },
    { id: "hop", term: "Next hop", definition: "The immediate recipient on the local link. It can be the destination device itself or a router." },
    { id: "mac", term: "MAC address", definition: "A link-layer address used to deliver a frame to a device on the local network." },
    { id: "arp", term: "ARP", definition: "The mechanism an IPv4 device on this LAN uses to find the MAC address for a local next-hop IP when it needs it." },
    { id: "private", term: "Private IPv4 address", definition: "An address used inside a private network. Common home addresses start with 192.168, and different homes can reuse them." },
    { id: "nat", term: "NAT", definition: "Network Address Translation. This home router example translates an IPv4 address and a TCP port, also called NAPT." },
    { id: "mapping", term: "NAT mapping", definition: "A saved association between a private IP and port and an outside IP and port. The router uses it to translate replies." },
  ],
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
    { id: "home-lan", title: "Your LAN", goal: "See what is connected and which interfaces have IP addresses.", steps: [
      { id: "meet-lan", frame: "lan", what: "Your PC ({fact:client-ip}) and phone ({fact:phone-ip}) join the home LAN. The router's LAN interface is {fact:gateway-ip}.", why: "The LAN is the local place devices can exchange frames. A subnet describes a range of IP addresses. A LAN can carry more than one subnet. In this example, we start with a single subnet on the home LAN.", terms: ["lan", "interface"], focus: [] },
      { id: "interfaces", frame: "interfaces", what: "The router has a LAN interface at {fact:gateway-ip} and a WAN interface at {fact:router-wan} in this example. Your PC's IP is on its own Wi-Fi interface.", why: "Each interface connects to a network. At home, DHCP usually supplies your PC's address, subnet mask, and default gateway when it joins.", terms: ["wan", "dhcp"], focus: [] },
    ] },
    { id: "read-address", title: "Read an address", goal: "Read the address and its prefix in both decimal and bits.", steps: [
      { id: "four-octets", frame: "address", what: "{fact:client-ip}/{fact:prefix} is the PC's IPv4 address and prefix. The four numbers encode four groups of eight bits. The slash tells you how many bits identify the subnet.", why: "An address labels an interface. The prefix gives that address its network boundary, so the PC can work out which addresses share its subnet.", terms: ["octet", "prefix"], focus: [] },
      { id: "apply-mask", frame: "mask", what: "The mask is {fact:mask}. The PC applies it to its address and to {fact:destination-ip}. The results are {fact:client-network} and {fact:destination-network}.", why: "AND keeps a bit where the mask is 1 and clears it where the mask is 0. Matching results put the destination in the PC's connected subnet. A masked remote address here is only a comparison, since the PC may not know the remote network's actual prefix.", terms: ["mask", "subnet"], focus: [] },
    ] },
    { id: "split", title: "Split a subnet", goal: "See how one more prefix bit cuts a block into two halves.", steps: [
      { id: "split-range", frame: "ranges", what: "Split {fact:parent-subnet} into {fact:lower-subnet} and {fact:upper-subnet}. Each half has {fact:half-size} addresses and {fact:usable} usable host addresses in this example.", why: "The new prefix bit can be 0 or 1, creating two equally sized blocks. In each /25 here, the first address identifies the network and the last is its broadcast address. Hosts use the addresses between them.", terms: ["subnetting", "broadcast"], focus: [] },
    ] },
    { id: "route", title: "Choose a route", goal: "Follow the PC's decision to deliver directly or use a gateway.", steps: [
      { id: "choose-hop", frame: "routes", what: "For {fact:destination-name} at {fact:destination-ip}, the PC chooses: {fact:route-type}. The next hop is {fact:next-hop}.", why: "The connected route wins when it matches because its prefix is longer than the default route. Try the printer with /24 and /25 under Change the example. The printer keeps its IP, and the PC's next hop changes.", terms: ["hop", "default"], focus: [] },
      { id: "local-delivery", frame: "link", what: "The IP packet is addressed to {fact:destination-ip}. The local frame carries it to next hop {fact:next-hop}, using the MAC address {fact:next-hop-mac} in this example.", why: "The IP destination tells devices where the packet is ultimately headed. The frame's destination MAC gets it across this local link. The PC can use ARP to find that MAC address if it does not have it cached.", terms: ["mac", "arp"], focus: [] },
    ] },
    { id: "nat", title: "Follow NAT", goal: "Watch the router rewrite a web packet and find the right device for the reply.", steps: [
      { id: "translate-out", frame: "nat-out", what: "For this separate web example, the router changes the outgoing packet from {fact:packet-before} to {fact:packet-after}.", why: "Private IPv4 addresses can be reused inside different homes. In this example, the PC and phone share an outside address. The router saves a distinct outside port for each connection so replies can be matched.", terms: ["private", "nat", "mapping"], focus: [] },
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
