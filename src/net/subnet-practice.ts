// Questions, feedback and explanations for the subnet explorer. Every number comes from the shared IPv4 helper;
// nothing here does its own address arithmetic beyond picking which helper result to show.
import { block, checkPrefix, classify, formatAddress, isAddress, maskOf, parseAddress, sameSubnet, type AddressRange, type Block } from "./ipv4.ts";

export const PRESETS = [8, 16, 24, 25, 26, 28, 30];
export const SPECIAL = [0, 31, 32];
export const DEFAULTS = { address: "192.168.1.10", prefix: 24, destination: "192.168.1.20" };

/** The first address of a block, for every kind, including /31 and /32 which have no network address. */
export const blockStart = (b: Block) => b.cidr.split("/")[0];

export interface Choice {
  label: string;
  correct: boolean;
  /** Shown after this choice: why it is right, or the specific mistake it reflects. */
  feedback: string;
}
export interface Question {
  prompt: string;
  choices: Choice[];
  /** The full answer, shown when the learner gets it right or asks to see it. */
  answer: string;
}

const count = (n: number) => n.toLocaleString("en");

// Same address and prefix, same order: the order never hints at the answer and never changes on a re-render.
function shuffle<T>(items: T[], key: number) {
  const rank = (i: number) => Math.imul((key ^ (i * 0x9e3779b9)) >>> 0, 0x85ebca6b) >>> 0;
  return items.map((item, i) => ({ item, r: rank(i) })).sort((a, b) => a.r - b.r).map((x) => x.item);
}

export function question(address: string, prefix: number): Question {
  const b = block(address, prefix),
    value = parseAddress(address),
    key = (value ^ Math.imul(prefix + 1, 0x27d4eb2d)) >>> 0;

  if (prefix === 0)
    return {
      prompt: `Which addresses are in ${b.cidr}?`,
      choices: shuffle(
        [
          { label: "Every IPv4 address", correct: true, feedback: "" },
          { label: "Only 0.0.0.0", correct: false, feedback: "0.0.0.0 is where the block starts, but /0 fixes no network bits, so the block covers all 2³² addresses." },
          { label: "No addresses", correct: false, feedback: "A prefix of 0 does not mean empty: it fixes 0 bits, so no address is left out." },
        ],
        key,
      ),
      answer: kindNote(b)!,
    };

  if (b.kind !== "normal") {
    const host = b.kind === "host";
    return {
      prompt: `How many addresses in ${b.cidr} can an interface use?`,
      choices: shuffle(
        [
          { label: String(b.usable), correct: true, feedback: "" },
          { label: "0", correct: false, feedback: `Subtracting a network and a broadcast address only applies from /0 to /30. ${host ? "A /32 is one address, and it is usable." : "On a /31 point-to-point link both addresses are usable (RFC 3021)."}` },
          host
            ? { label: "2", correct: false, feedback: "A /32 block holds exactly one address: 2⁰ = 1." }
            : { label: "1", correct: false, feedback: "A /31 block holds 2¹ = 2 addresses, and both are usable." },
        ],
        key,
      ),
      answer: kindNote(b)!,
    };
  }

  // What is the network address? Each wrong choice is a real helper result that a specific mistake produces.
  const start = parseAddress(blockStart(b)),
    choices: (Choice & { value: number })[] = [{ value: start, label: b.network!, correct: true, feedback: "" }];
  const add = (v: number, feedback: string) => {
    if (v >= 0 && v < 2 ** 32 && !choices.some((c) => c.value === v)) choices.push({ value: v, label: formatAddress(v), correct: false, feedback });
  };
  add(parseAddress(b.broadcast!), `That is the broadcast address, the last address of the block, with every host bit set to 1. The network address has every host bit set to 0.`);
  const whole = Math.floor(prefix / 8) * 8;
  if (prefix % 8 && whole > 0)
    add(parseAddress(blockStart(block(address, whole))), `That cuts the address at a whole octet, as /${whole} would. With /${prefix} the boundary is ${prefix % 8} bit${prefix % 8 === 1 ? "" : "s"} into octet ${whole / 8 + 1}.`);
  add(value, "That keeps the host bits. The network address clears every host bit, so it is the first address of the block.");
  add(start + b.size, `That is the start of the next block. /${prefix} blocks hold ${count(b.size)} addresses each, and ${address} is in the block that starts at ${b.network}.`);
  add(start - b.size, `That is the start of the previous block. /${prefix} blocks hold ${count(b.size)} addresses each, and ${address} is in the block that starts at ${b.network}.`);
  return {
    prompt: `What is the network address of ${address}/${prefix}?`,
    choices: shuffle(choices.slice(0, 4).map(({ label, correct, feedback }) => ({ label, correct, feedback })), key),
    answer: `Clearing the ${32 - prefix} host bits of ${address} gives ${b.network}, the first address of its ${count(b.size)}-address block ${b.cidr}.`,
  };
}

/** The extra explanation /0, /31 and /32 need, because the usual "first is network, last is broadcast" rule doesn't apply. */
export function kindNote(b: Block): string | null {
  if (b.prefix === 0)
    return "/0 is every IPv4 address. No interface is configured with it: routing tables use 0.0.0.0/0 as the default route, the route that matches when nothing more specific does.";
  if (b.kind === "point-to-point")
    return "/31 is a point-to-point link (RFC 3021): both addresses belong to the two ends of the link, so there is no network or broadcast address to set aside.";
  if (b.kind === "host") return "/32 is a single address. Routes use it to name one host exactly; an interface with /32 has no neighbours on its own subnet.";
  return null;
}

/** Where the network part ends, worked through the octet it ends in. */
export function boundary(address: string, prefix: number): string {
  checkPrefix(prefix);
  if (prefix === 0) return "All 32 bits are host bits: the block is every IPv4 address.";
  if (prefix === 32) return "All 32 bits are network bits: the block is this one address.";
  if (prefix % 8 === 0) return `The boundary falls between octets ${prefix / 8} and ${prefix / 8 + 1}, so each octet is wholly network or wholly host.`;
  const index = Math.floor(prefix / 8),
    octet = Number(address.split(".")[index]),
    parts = [128, 64, 32, 16, 8, 4, 2, 1].filter((v) => Math.floor(octet / v) % 2 === 1);
  return `The boundary is inside octet ${index + 1}: ${octet} = ${parts.length ? parts.join(" + ") : "0"} = ${octet.toString(2).padStart(8, "0")} in binary. Its first ${prefix % 8 === 1 ? "bit belongs" : `${prefix % 8} bits belong`} to the network.`;
}

export interface Explanation {
  what: string;
  why: string;
  source: string;
}
export function explain(b: Block, address: string): Explanation {
  const note = kindNote(b);
  if (note)
    return {
      what: note,
      why: "The “first is network, last is broadcast” rule covers /1 to /30. Knowing the exceptions stops you subtracting two addresses that were never set aside.",
      source: b.prefix === 0 ? "RFC 1812 §5.2.4.3: the default route" : b.kind === "point-to-point" ? "RFC 3021: 31-bit prefixes on point-to-point links" : "RFC 4632 §3.1: a /32 names a single host",
    };
  return {
    what: `The prefix /${b.prefix} keeps the first ${b.prefix} bits of ${address}. Clearing the other ${32 - b.prefix} gives the network address; setting them all to 1 gives the broadcast address.`,
    why: "Every device on one subnet must agree where the network part ends. That boundary decides whether a destination is delivered directly or through the gateway.",
    source: "RFC 4632 §3.1",
  };
}

export const rangeNotes: Record<AddressRange, string> = {
  unspecified: "Unspecified: it means “no address yet”, as in the source of a DHCP Discover.",
  "this-network": "“This network” (RFC 791): only used as a source address while a device starts up, never as a destination.",
  private: "Private (RFC 1918): used inside homes and organisations. Routers on the public Internet do not forward it.",
  shared: "Shared address space (RFC 6598): used between a provider's carrier-grade NAT and its customers.",
  loopback: "Loopback: the device itself. Packets to it never leave the device.",
  "link-local": "Link-local (RFC 3927): what a device gives itself when DHCP fails. It only works on the device's own link.",
  protocol: "IETF protocol assignments (RFC 6890): reserved for specific protocols.",
  documentation: "Documentation (RFC 5737): reserved for examples like this one, and never used on real networks.",
  benchmarking: "Benchmarking (RFC 2544): reserved for testing network equipment.",
  multicast: "Multicast (RFC 5771): addresses a group of receivers, not one interface.",
  reserved: "Reserved (RFC 1112): set aside for future use, not for ordinary addressing.",
  "limited-broadcast": "Limited broadcast: every device on this link. Routers never forward it.",
  other: "Not in a special-purpose range. That alone doesn't make it a public, reachable address: it may be unassigned or blocked.",
};
export const describeRange = (address: string) => {
  const c = classify(address);
  return { ...c, note: rangeNotes[c.range] };
};

/** One line describing a block, worded for its kind: /0, /31 and /32 never get a network or broadcast address. */
export function blockSummary(b: Block): string {
  if (b.prefix === 0) return "every IPv4 address: used as the default route, not as a host setting";
  if (b.kind === "point-to-point") return `a point-to-point link: both ${b.firstUsable} and ${b.lastUsable} are usable, with no network or broadcast address`;
  if (b.kind === "host") return `the single address ${b.firstUsable}, usable on its own, with no network or broadcast address`;
  return `network ${b.network}, broadcast ${b.broadcast}, and ${count(b.usable)} usable addresses from ${b.firstUsable} to ${b.lastUsable}`;
}

/**
 * "Is the destination on my subnet?", from the device's own address and prefix. Each wrong choice is a common mistake:
 * comparing whole octets, trusting matching leading numbers, or expecting to use the destination's mask.
 */
export function localQuestion(address: string, destination: string, prefix: number): Question {
  const same = sameSubnet(address, destination, prefix),
    own = block(address, prefix),
    other = block(destination, prefix),
    key = (parseAddress(address) ^ parseAddress(destination) ^ Math.imul(prefix + 7, 0x2c1b3c6d)) >>> 0;
  const choices: Choice[] = [
    same
      ? { label: `Same subnet: both addresses are in ${own.cidr}`, correct: true, feedback: "" }
      : { label: `Different subnet: ${destination} is in ${other.cidr}, not ${own.cidr}`, correct: true, feedback: "" },
  ];
  const add = (choice: Choice) => {
    if (!choices.some((c) => c.label === choice.label)) choices.push(choice);
  };
  const whole = prefix % 8 ? Math.floor(prefix / 8) * 8 : null;
  if (whole !== null && sameSubnet(address, destination, whole) !== same)
    add({
      label: same ? `Different subnet: their first ${whole / 8} octet${whole === 8 ? "" : "s"} differ` : `Same subnet: their first ${whole / 8} octet${whole === 8 ? "" : "s"} match`,
      correct: false,
      feedback: `That compares whole octets, as /${whole} would. With /${prefix} the boundary is ${prefix % 8} bit${prefix % 8 === 1 ? "" : "s"} into octet ${whole / 8 + 1}, so compare the network bits there too.`,
    });
  add(
    same
      ? { label: "Different subnet: the two addresses are not the same", correct: false, feedback: `Addresses on one subnet are always different; what they share is the network part. With /${prefix} both share ${own.cidr}.` }
      : { label: "Same subnet: the addresses start with the same numbers", correct: false, feedback: `Matching leading numbers is not enough: only the first ${prefix} bits decide. They differ there, so the masked results differ.` },
  );
  add({ label: "It depends on the destination's own prefix", correct: false, feedback: "A device decides with its own address and prefix only. It does not know the destination's settings, and doesn't need them for this choice." });
  return {
    prompt: `Is ${destination} on the same subnet as ${address}/${prefix}?`,
    choices: shuffle(choices, key),
    answer: same
      ? `Both addresses AND the /${prefix} mask to ${blockStart(own)}, so they are on the same subnet: the device delivers directly and uses ARP to find the destination's MAC address.`
      : `${address} masks to ${blockStart(own)} but ${destination} masks to ${blockStart(other)}, so they are on different subnets: the device hands the packet to its default gateway.`,
  };
}

/** Same subnet or not, from the first device's prefix only. Arithmetic, not a reachability check. */
export function compare(address: string, destination: string, prefix: number) {
  return {
    same: sameSubnet(address, destination, prefix),
    mask: formatAddress(maskOf(prefix)),
    own: blockStart(block(address, prefix)),
    other: blockStart(block(destination, prefix)),
  };
}

/** A generated example: an RFC 1918 address and a preset prefix, from a seeded sequence so it can be replayed. */
export function example(seed: number) {
  let s = seed >>> 0;
  const next = (n: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.floor((s / 2 ** 32) * n);
  };
  const octets = [
    () => [10, next(256), next(256), next(256)],
    () => [172, 16 + next(16), next(256), next(256)],
    () => [192, 168, next(256), next(256)],
  ][next(3)]();
  return { address: octets.join("."), prefix: PRESETS[next(PRESETS.length)], seed: s };
}

/** Link to the explorer with an example loaded, for lessons and missions to deep-link to. */
export function explorerPath(state: { address: string; prefix: number; destination?: string }) {
  const q = new URLSearchParams({ ip: state.address, prefix: String(state.prefix) });
  if (state.destination) q.set("to", state.destination);
  return `/practice/subnets?${q}`;
}

/** Reads a deep link. Anything malformed falls back to the default, so a bad link never breaks the page. */
export function readExplorerQuery(search: string) {
  const q = new URLSearchParams(search),
    ip = q.get("ip") ?? "",
    to = q.get("to") ?? "",
    p = q.get("prefix") ?? "";
  const prefix = /^(\d|[12]\d|3[0-2])$/.test(p) ? Number(p) : DEFAULTS.prefix;
  return {
    address: isAddress(ip) ? ip : DEFAULTS.address,
    prefix,
    destination: isAddress(to) ? to : DEFAULTS.destination,
  };
}
