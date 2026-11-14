import type { Lesson } from "./schema.ts";

// Lesson 1 of the IPv4 redesign. Every value shown comes from the ipv4-subnets engine, which computes it with the
// shared helper (src/net/ipv4.ts); the text explains purpose and cause and never states a value on its own.
export const ipv4Terms: Lesson["glossary"] = [
  {
    id: "ipv4-address", term: "IPv4 address",
    definition: "A 32-bit number that identifies one network interface, written as four decimal numbers from 0 to 255 separated by dots.",
    purpose: "Packets carry a source and a destination address, so every interface that sends or receives needs one.",
    example: "Your PC's Wi-Fi interface might use 10.20.30.77; your phone has its own address.",
  },
  {
    id: "interface", term: "Interface",
    definition: "A device's connection to a network, such as a Wi-Fi adapter or an Ethernet port. Addresses belong to interfaces, not to whole devices.",
    purpose: "A router has one interface, and one address, on each network it connects.",
  },
  {
    id: "octet", term: "Octet",
    definition: "A group of 8 bits. An IPv4 address has four octets; each is written as one decimal number from 0 to 255.",
    purpose: "Reading an address octet by octet is how you convert between its decimal and binary forms.",
  },
  {
    id: "binary", term: "Binary",
    definition: "Writing a number with only 0s and 1s. In an octet the places are worth 128, 64, 32, 16, 8, 4, 2 and 1.",
    purpose: "Subnetting works on bits, so a boundary inside an octet only makes sense in binary.",
    example: "200 = 128 + 64 + 8 = 11001000.",
  },
  {
    id: "prefix", term: "Prefix length",
    definition: "The number after the slash, from /0 to /32: how many leading bits of the address identify the network.",
    purpose: "Every device on a subnet must use the same prefix, or they disagree about which addresses are local.",
  },
  {
    id: "subnet-mask", term: "Subnet mask",
    definition: "The prefix written like an address: 1 bits for the network part, then 0 bits for the host part. A valid mask never has a 1 after a 0.",
    purpose: "Older settings screens ask for the mask instead of the prefix; they mean the same thing.",
    example: "/28 is 255.255.255.240.",
  },
  {
    id: "network-host-bits", term: "Network and host bits",
    definition: "The prefix splits the 32 bits: the first ones (network bits) are shared by the whole subnet, the rest (host bits) differ from device to device.",
  },
  {
    id: "bitwise-and", term: "AND",
    definition: "Comparing two bits: the result is 1 only when both are 1. ANDing an address with its mask keeps the network bits and clears the host bits.",
    purpose: "It gives the first address of the block, which is how a device compares two addresses' networks.",
  },
  {
    id: "network-address", term: "Network address",
    definition: "The first address of a /0–/30 block, with every host bit 0. It names the subnet and isn't given to an interface.",
  },
  {
    id: "broadcast-address", term: "Broadcast address",
    definition: "The last address of a /0–/30 block, with every host bit 1. A packet sent to it is meant for every device on that subnet.",
  },
  {
    id: "block-size", term: "Block size",
    definition: "How many addresses a prefix covers: 2 to the power of the number of host bits. Blocks start at multiples of their size.",
    example: "/28 leaves 4 host bits, so each block has 2⁴ = 16 addresses: .0, .16, .32, .48, .64 …",
  },
  {
    id: "point-to-point", term: "/31 point-to-point link",
    definition: "A two-address block for a link with exactly two ends, such as between two routers. Both addresses are usable: there is no network or broadcast address (RFC 3021).",
  },
  {
    id: "host-route", term: "/32 single address",
    definition: "A one-address block. Routes use it to name one host exactly.",
  },
  {
    id: "default-route", term: "Default route (/0)",
    definition: "0.0.0.0/0 matches every IPv4 address. A routing table uses it when no more specific route matches; it is not a setting for a host's own address.",
  },
  {
    id: "special-purpose", term: "Special-purpose addresses",
    definition: "Ranges set aside by the IETF, such as private (10/8, 172.16/12, 192.168/16), loopback (127/8), link-local (169.254/16) and documentation ranges. An address outside them isn't automatically public or reachable.",
  },
  {
    id: "same-subnet", term: "Same subnet",
    definition: "Two addresses whose network bits match under one device's own prefix. That device sends to them directly; for anything else it uses its default gateway.",
    purpose: "It is the first decision a device makes for every packet it sends.",
  },
  {
    id: "default-gateway", term: "Default gateway",
    definition: "The router on your subnet that your device hands packets to when the destination is on another subnet.",
  },
  {
    id: "arp", term: "ARP",
    definition: "How a device finds the MAC address that belongs to an IPv4 address on its own subnet, so it can build the frame.",
  },
];

export const ipv4Subnets: Lesson = {
  schemaVersion: 1,
  id: "ipv4-subnets",
  version: "1.0.0",
  title: "Understanding IPv4 addresses and subnets",
  question: "Which addresses are on my subnet, and how can I tell?",
  summary: "Read any IPv4 address in decimal and binary, see how the prefix splits it, find the block it belongs to, and predict whether another address is on the same subnet.",
  topic: "Networks",
  review: { status: "reviewed", note: "Every value comes from Kitab's shared IPv4 helper." },
  engine: { id: "ipv4-subnets", version: "1.0.0" },
  scenario: { address: "10.20.30.77", prefix: 28, destination: "10.20.30.90", experiment: "none" },
  scope: [
    "One interface's address and prefix, and one destination. Change all three under Change the example: any valid IPv4 address and any prefix from /0 to /32.",
    "Everything here is arithmetic about addresses. Whether a packet actually arrives depends on cables, ARP, routes and NAT, which the network playground and the next lesson simulate.",
    "Predictions are for practice: nothing is scored or recorded, and showing an answer is fine.",
    "Explore subnets has the same calculations with editable bits, for free exploration.",
  ],
  prerequisites: "None. It helps to have met devices on a LAN in the playground's first starter.",
  levels: [
    { id: "interface", name: "Interface", short: "Who has the address", intro: "An address belongs to one interface: your PC's Wi-Fi adapter, or one port of a router." },
    { id: "bits", name: "Bits", short: "Decimal and binary", intro: "Each of the four numbers is an octet of 8 bits. Subnetting works on those 32 bits." },
    { id: "mask", name: "Mask", short: "Network and host bits", intro: "The prefix says how many leading bits name the network. The mask writes the same split as an address." },
    { id: "block", name: "Block", short: "Network, broadcast, hosts", intro: "Every address sits in a block of 2ⁿ addresses that starts at a multiple of the block size." },
    { id: "special", name: "Special cases", short: "/31, /32, /0 and reserved ranges", intro: "Some prefixes and ranges don't follow the usual rules. Knowing them avoids common mistakes." },
    { id: "decision", name: "Decision", short: "Local or remote", intro: "A device compares network bits, using its own prefix, to choose between sending directly and using its gateway." },
  ],
  glossary: ipv4Terms,
  kinds: {
    interface: { represents: "A network interface and the address configured on it.", matters: "Packets are sent from and to interfaces, so each needs its own address." },
    address: { represents: "An IPv4 address: 32 bits written as four decimal octets.", matters: "Its network bits say which subnet it belongs to." },
    bits: { represents: "The 32 bits of the address, network bits and host bits marked.", matters: "The prefix boundary can fall inside an octet, which only shows in binary." },
    mask: { represents: "The prefix and the subnet mask that writes it.", matters: "ANDing an address with the mask keeps only its network bits." },
    block: { represents: "The block of addresses that shares this address's network bits.", matters: "It gives the network and broadcast addresses and the addresses interfaces can use." },
    range: { represents: "Prefixes and address ranges with special meanings.", matters: "They change how many addresses are usable, or what an address can be used for." },
    decision: { represents: "A device's same-subnet decision, made with its own prefix.", matters: "It decides whether the packet goes straight to the destination or to the gateway." },
  },
  controls: [
    { key: "address", label: "IPv4 address", control: "text", maxLength: 15, help: "Any valid IPv4 address, such as 192.168.1.10. Invalid text is explained and not applied." },
    { key: "prefix", label: "Prefix length", control: "range", min: 0, max: 32, step: 1, presets: [8, 16, 24, 25, 26, 28, 30, 0, 31, 32], unit: "/", help: "Common prefixes, then the special cases /0, /31 and /32. Arrow keys move one bit at a time." },
    { key: "destination", label: "Destination address", control: "text", maxLength: 15, help: "The address your PC wants to reach, for the last chapter." },
  ],
  chapters: [
    { id: "address-interface", title: "Address & interface", goal: "Meet the address and the interface it belongs to.", steps: [
      { id: "meet-address", frame: "interface", actor: "Your PC's Wi-Fi interface", focus: ["pc"], terms: ["ipv4-address", "interface"], what: "Your PC's Wi-Fi interface uses {fact:address} with prefix /{fact:prefix}, written together as {fact:cidr}. In the special-purpose registry it falls in {fact:address-type}.", why: "Every packet carries a source and a destination address. An address belongs to one interface, so a router with two networks has two addresses. {fact:address-note}" },
      { id: "four-octets", frame: "octets", actor: "IPv4 addressing", focus: ["address"], terms: ["octet"], what: "{fact:address} is four numbers: {fact:octet-1}, {fact:octet-2}, {fact:octet-3} and {fact:octet-4}. Each is one octet, a group of 8 bits, so the address has 32 bits.", why: "Writing 32 bits as four decimal numbers keeps addresses readable, but subnetting works on the bits underneath." },
    ] },
    { id: "bits-octets", title: "Bits and octets", goal: "Convert an octet between decimal and binary, then see all 32 bits.", steps: [
      { id: "one-octet", frame: "octet", actor: "Binary place values", focus: ["bits"], terms: ["binary"], what: "Octet {fact:edge-octet} is {fact:edge-octet-value}, which is {fact:edge-octet-binary} in binary. {fact:boundary}", why: "The place values are 128, 64, 32, 16, 8, 4, 2 and 1. Adding the places that hold a 1 gives the decimal value, and that's where a /{fact:prefix} boundary splits this address." },
      { id: "all-bits", frame: "bits", actor: "IPv4 addressing", focus: ["bits"], terms: [], what: "All 32 bits of {fact:address}: {fact:binary}.", why: "Each group of 8 is one octet. Next, the prefix divides these bits into a network part and a host part." },
    ] },
    { id: "prefix-mask", title: "Prefix & mask", goal: "Split the bits into network and host bits, and write the prefix as a mask.", steps: [
      { id: "network-host", frame: "prefix", actor: "Your PC's network settings", focus: ["bits"], terms: ["prefix", "network-host-bits"], what: "With {fact:cidr}, the first {fact:network-bits} bits are network bits and the other {fact:host-bits} are host bits. {fact:boundary}", why: "Every device on the subnet shares the network bits. The host bits are what makes each device's address different." },
      { id: "the-mask", frame: "mask", actor: "Your PC's network settings", focus: ["mask"], terms: ["subnet-mask"], what: "/{fact:prefix} written as a mask is {fact:mask}: {fact:mask-binary}.", why: "The mask has a 1 for every network bit, then 0s. Some settings screens ask for the mask instead of the prefix; they describe the same split." },
    ] },
    { id: "network-broadcast", title: "Network & broadcast", goal: "Predict the block, then work it out: AND, block size, range and count.", steps: [
      { id: "predict-block", frame: "predict-network", actor: "You", focus: ["block"], terms: [], what: "Before reading on, answer the question in the picture for {fact:cidr}. A wrong choice explains the mistake behind it, and you can try again or show the answer.", why: "Predicting first shows what you already know. Nothing is scored or recorded here." },
      { id: "and-mask", frame: "and", actor: "Your PC's operating system", focus: ["mask", "block"], terms: ["bitwise-and"], what: "{fact:and-line}. ANDing keeps every network bit and turns every host bit into 0.", why: "The result is the first address of the block, and the same calculation tells a device whether two addresses share a network." },
      { id: "whole-block", frame: "block", actor: "IPv4 addressing", focus: ["block"], terms: ["block-size", "network-address", "broadcast-address"], what: "{fact:address} is in {fact:block}, which holds {fact:block-size} addresses: {fact:block-summary}.", why: "Blocks start at multiples of their size. From /1 to /30 the first address names the network and the last is the broadcast, so they aren't given to interfaces." },
    ] },
    { id: "special-cases", title: "Special cases", goal: "Know where the usual rules stop: /31, /32, /0 and reserved ranges.", steps: [
      { id: "special-prefixes", frame: "special-blocks", actor: "IPv4 addressing", focus: ["special"], terms: ["point-to-point", "host-route", "default-route"], what: "{fact:p2p-example}. {fact:host-example}. {fact:default-example}.", why: "Subtracting a network and a broadcast address only applies from /1 to /30. A /31 link has two usable ends, a /32 names one host, and /0 is the route that matches everything." },
      { id: "special-ranges", frame: "special-ranges", actor: "IANA special-purpose registry", focus: ["special"], terms: ["special-purpose"], what: "Private ranges are {fact:private-ranges}; documentation ranges are {fact:documentation-ranges}; loopback is {fact:loopback-range} and link-local is {fact:link-local-range}. {fact:address} falls in {fact:address-type}.", why: "{fact:address-note}" },
    ] },
    { id: "local-remote", title: "Local or remote?", goal: "Predict whether a destination is on your subnet, then check it with your own prefix.", steps: [
      { id: "predict-local", frame: "predict-local", actor: "You", focus: ["destination"], terms: ["same-subnet"], what: "Your PC is {fact:cidr} and wants to reach {fact:destination}. Answer the question in the picture before reading on.", why: "This is the first decision your PC makes for every packet. It uses only its own address and prefix." },
      { id: "compare", frame: "compare", actor: "Your PC's operating system", focus: ["verdict"], terms: ["default-gateway", "arp"], what: "Your address ANDs to {fact:own-network} and {fact:destination} ANDs to {fact:destination-network} with {fact:mask}. Your PC decides: {fact:verdict}.", why: "This is arithmetic about addresses, not proof that the packet arrives: cables, ARP, routes and NAT decide that. The next lesson follows the packet through a router." },
    ] },
  ],
  experiments: [
    {
      id: "mismatch", title: "Only your PC changes its prefix", question: "What happens when two devices on one LAN use different prefixes?",
      params: { address: "10.20.30.77", prefix: 24, destination: "10.20.30.90", experiment: "mismatch" },
      startFrame: "mismatch-pc",
      chapters: [{ id: "mask-mismatch", title: "Mask mismatch", goal: "See two devices disagree, then compare with a real split.", steps: [
        { id: "pc-view", frame: "mismatch-pc", actor: "Your PC", focus: ["pc", "verdict"], terms: ["prefix"], what: "Your PC uses {fact:cidr}. For {fact:destination} it decides: {fact:pc-verdict}.", why: "Your PC only uses its own prefix. With this prefix the neighbour's address looks local." },
        { id: "neighbour-view", frame: "mismatch-neighbour", actor: "The neighbour", focus: ["neighbour", "verdict"], terms: ["same-subnet"], what: "The neighbour uses {fact:neighbour}. For {fact:address} it decides: {fact:neighbour-verdict}. The two devices agree: {fact:agree}.", why: "Each device decides with its own prefix, so a mismatch makes them disagree about the same pair of addresses. This is the cause behind the “Neighbours that look remote” mission." },
        { id: "real-split", frame: "mismatch-split", actor: "Network administrator", focus: ["verdict"], terms: [], what: "In a real split, every device on the subnet changes its prefix together. Then both decide: {fact:split-verdict}. They agree: {fact:split-agree}.", why: "A split only works when every device and the router change together, so they all agree which addresses are local." },
      ] }],
      compare: [{ outcome: "localForPc", label: "Your PC treats the destination as local" }, { outcome: "localForDestination", label: "The destination treats your PC as local" }],
    },
    {
      id: "third-octet", title: "Move the boundary into the third octet", question: "What does a block look like when the boundary is inside the third octet?",
      params: { address: "172.20.200.9", prefix: 20, destination: "172.20.207.1", experiment: "third-octet" },
      startFrame: "third-octet",
      chapters: [{ id: "third-octet-boundary", title: "Third-octet boundary", goal: "Work with a boundary that isn't in the last octet.", steps: [
        { id: "third-octet-bits", frame: "third-octet", actor: "Your PC's network settings", focus: ["bits", "mask"], terms: ["binary"], what: "{fact:cidr} has mask {fact:mask}. {fact:boundary}", why: "The same rule works in any octet: keep the network bits, clear the host bits." },
        { id: "third-octet-range", frame: "third-octet-block", actor: "IPv4 addressing", focus: ["block"], terms: ["block-size"], what: "The block is {fact:block}: {fact:block-summary}.", why: "With 12 host bits the block spans several values of the third octet, so an address that looks different there can still be local." },
      ] }],
      compare: [{ outcome: "blockStart", label: "First address of the block" }, { outcome: "usable", label: "Usable addresses" }],
    },
    {
      id: "p2p", title: "A /31 link between two routers", question: "How many addresses does a link with exactly two ends need?",
      params: { address: "203.0.113.6", prefix: 31, destination: "203.0.113.7", experiment: "p2p" },
      startFrame: "p2p-link",
      chapters: [{ id: "p2p-link", title: "Point-to-point", goal: "Use both addresses of a /31.", steps: [
        { id: "p2p-ends", frame: "p2p-link", actor: "Two routers", focus: ["pc", "neighbour"], terms: ["point-to-point"], what: "One router uses {fact:cidr} and the other {fact:neighbour}. The block is {fact:block-summary}.", why: "A link with exactly two ends doesn't need a broadcast address, so RFC 3021 lets both addresses be used." },
        { id: "p2p-same", frame: "p2p-compare", actor: "Each router", focus: ["verdict"], terms: [], what: "Same subnet: {fact:same-subnet}, with {fact:usable} usable addresses.", why: "Each router reaches the other end directly, and the link uses half the addresses a /30 would." },
      ] }],
      compare: [{ outcome: "usable", label: "Usable addresses" }, { outcome: "blockSize", label: "Addresses in the block" }],
    },
  ],
  practice: [
    { missionId: "ipv4-network-address", why: "Find the network address for boundaries in the second, third and fourth octets, with feedback on each common mistake." },
    { missionId: "ipv4-local-or-remote", why: "Decide with a device's own prefix whether it sends directly or through its gateway, including look-alike addresses." },
  ],
  sources: [
    { id: "ipv4-format", text: "RFC 791 §2.3 and §3.2. An IPv4 address is 32 bits; Internet addresses name interfaces, not hosts, so a host with several interfaces has several addresses." },
    { id: "cidr-prefix", text: "RFC 4632 §3.1. A prefix length from 0 to 32 gives the number of leading bits that identify the network; a prefix of n bits gives a block of 2^(32−n) addresses that starts on a multiple of its size." },
    { id: "local-decision", text: "RFC 1122 §3.3.1.1. To choose the next hop, a host compares the destination's network bits, using its own interface's mask, with its own network: if they match it sends directly, otherwise to a gateway." },
    { id: "network-broadcast", text: "RFC 1122 §3.2.1.3 and RFC 919. In a subnet the address with all host bits 0 identifies the network, and all host bits 1 is the directed broadcast; neither is assigned to an interface." },
    { id: "rfc3021", text: "RFC 3021. On a point-to-point link a 31-bit prefix gives two addresses, one for each end, with no network or broadcast address." },
    { id: "default-route", text: "RFC 1812 §5.2.4.3. Routers pick the longest matching prefix; the default route 0.0.0.0/0 matches every destination and is used when nothing more specific does." },
    { id: "special-purpose", text: "RFC 6890 and the IANA IPv4 Special-Purpose Address Registry: private 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16 (RFC 1918); loopback 127.0.0.0/8; link-local 169.254.0.0/16 (RFC 3927); documentation 192.0.2.0/24, 198.51.100.0/24 and 203.0.113.0/24 (RFC 5737)." },
  ],
};
