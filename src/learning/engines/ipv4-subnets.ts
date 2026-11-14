// Lesson engine for "Understanding IPv4 addresses and subnets". Every value comes from the shared helper
// (src/net/ipv4.ts) through src/net/subnet-practice.ts; this file only decides which values each frame shows.
import { z } from "zod";
import { block, classify, formatAddress, isAddress, maskOf, parseAddress, sameSubnet, toBinary } from "../../net/ipv4.ts";
import { blockStart, blockSummary, boundary, describeRange, kindNote } from "../../net/subnet-practice.ts";
import type { EngineAdapter, Entity, Fact, FrameDraft, Trace } from "../types.ts";

const address = z.string().max(64).refine(isAddress, "Not an IPv4 address");
const params = z
  .object({
    address: address.default("10.20.30.77"),
    prefix: z.number().int().min(0).max(32).default(28),
    destination: address.default("10.20.30.90"),
    /** An experiment's extra frames, appended after the journey. */
    experiment: z.enum(["none", "mismatch", "third-octet", "p2p"]).default("none"),
  })
  .strict();
type Params = z.infer<typeof params>;

/** In the "only your PC changes its prefix" experiment, the neighbour keeps this prefix. */
const NEIGHBOUR_PREFIX = 28;
/** Fixed, computed examples for the special-cases chapter. */
const SPECIAL = { pointToPoint: ["203.0.113.6", 31], host: ["198.51.100.20", 32], all: ["0.0.0.0", 0] } as const;
const RANGE_SAMPLES = ["10.0.0.1", "172.16.0.1", "192.168.0.1", "127.0.0.1", "169.254.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1"];

export type View =
  | "interface" | "octets" | "octet" | "bits" | "prefix" | "mask" | "predict-network" | "and" | "block"
  | "special-blocks" | "special-ranges" | "predict-local" | "compare"
  | "mismatch-pc" | "mismatch-neighbour" | "mismatch-split" | "third-octet" | "third-octet-block" | "p2p-link" | "p2p-compare";
export type Ipv4SubnetsData = Params & { view: View; neighbourPrefix: number };

const entities: Record<string, Entity> = {
  pc: { id: "pc", label: "Your PC's interface", kind: "interface" },
  address: { id: "address", label: "IPv4 address", kind: "address" },
  bits: { id: "bits", label: "The 32 address bits", kind: "bits" },
  mask: { id: "mask", label: "Subnet mask", kind: "mask" },
  block: { id: "block", label: "Address block", kind: "block" },
  special: { id: "special", label: "Special cases", kind: "range" },
  destination: { id: "destination", label: "Destination address", kind: "address" },
  verdict: { id: "verdict", label: "Same-subnet decision", kind: "decision" },
  neighbour: { id: "neighbour", label: "Neighbour's interface", kind: "interface" },
};
const verdictText = (same: boolean) => (same ? "same subnet: deliver directly, using ARP to find the destination's MAC address" : "different subnet: hand the packet to the default gateway, using ARP to find the gateway's MAC address");
const rangeLabel = (ip: string) => {
  const c = classify(ip);
  return c.cidr ? `${c.cidr} (${c.source})` : "none of the special-purpose ranges";
};

function build(p: Params) {
  const b = block(p.address, p.prefix),
    mask = formatAddress(maskOf(p.prefix)),
    own = blockStart(b),
    other = blockStart(block(p.destination, p.prefix)),
    same = sameSubnet(p.address, p.destination, p.prefix),
    octets = p.address.split("."),
    edge = Math.min(3, Math.floor(p.prefix / 8)),
    range = describeRange(p.address),
    neighbourPrefix = p.experiment === "mismatch" ? NEIGHBOUR_PREFIX : p.prefix,
    neighbourSame = sameSubnet(p.destination, p.address, neighbourPrefix);
  const frames: FrameDraft<Ipv4SubnetsData>[] = [];
  const add = (view: View, title: string, level: string, actor: string, objects: string[], facts: Fact[]) =>
    frames.push({ id: view, title, narration: title, level, actor, entities: objects.map((id) => entities[id]), focus: objects.slice(0, 1), facts, durationMs: 900, data: { ...p, view, neighbourPrefix } });

  const f = {
    address: { id: "address", label: "IPv4 address", value: p.address, entityId: "address" },
    prefix: { id: "prefix", label: "Prefix length", value: p.prefix, entityId: "mask" },
    cidr: { id: "cidr", label: "Address with prefix", value: `${p.address}/${p.prefix}`, entityId: "address" },
    mask: { id: "mask", label: "Subnet mask", value: mask, entityId: "mask" },
    destination: { id: "destination", label: "Destination address", value: p.destination, entityId: "destination" },
  };
  const summary = { id: "block-summary", label: "This block", value: blockSummary(b), entityId: "block" };

  add("interface", "An address belongs to an interface", "interface", "Your PC's Wi-Fi interface", ["pc", "address"], [
    f.address, f.prefix, f.cidr,
    { id: "address-type", label: "Special-purpose range", value: rangeLabel(p.address), entityId: "address" },
    { id: "address-note", label: "What that means", value: range.note, entityId: "address" },
  ]);
  add("octets", "Four numbers, one address", "interface", "IPv4 addressing", ["address"], [
    f.address,
    ...octets.map((value, i) => ({ id: `octet-${i + 1}`, label: `Octet ${i + 1}`, value: Number(value), entityId: "address" })),
  ]);
  add("octet", "One octet in binary", "bits", "Binary place values", ["bits"], [
    f.address, f.prefix,
    { id: "edge-octet", label: "Octet the boundary falls in", value: edge + 1, entityId: "bits" },
    { id: "edge-octet-value", label: "That octet in decimal", value: Number(octets[edge]), entityId: "bits" },
    { id: "edge-octet-binary", label: "That octet in binary", value: Number(octets[edge]).toString(2).padStart(8, "0"), entityId: "bits" },
    { id: "boundary", label: "Where the boundary falls", value: boundary(p.address, p.prefix), entityId: "bits" },
  ]);
  add("bits", "All 32 bits", "bits", "IPv4 addressing", ["bits"], [
    f.address, { id: "binary", label: "Address in binary", value: toBinary(parseAddress(p.address)), entityId: "bits" },
  ]);
  add("prefix", "Network bits and host bits", "mask", "Your PC's network settings", ["bits", "mask"], [
    f.cidr, f.prefix,
    { id: "network-bits", label: "Network bits", value: p.prefix, entityId: "bits" },
    { id: "host-bits", label: "Host bits", value: 32 - p.prefix, entityId: "bits" },
    { id: "boundary", label: "Where the boundary falls", value: boundary(p.address, p.prefix), entityId: "bits" },
  ]);
  add("mask", "The prefix as a mask", "mask", "Your PC's network settings", ["mask"], [
    f.prefix, f.mask, { id: "mask-binary", label: "Mask in binary", value: toBinary(maskOf(p.prefix)), entityId: "mask" },
  ]);
  // The prediction frame shows the question's inputs only; the scene reveals the answer after the learner answers.
  add("predict-network", b.kind === "normal" && p.prefix > 0 ? "Predict the network address" : "Predict the block", "block", "You", ["block"], [f.cidr, f.mask]);
  add("and", "Keep the network bits", "block", "Your PC's operating system", ["mask", "block"], [
    f.address, f.mask,
    { id: "block-start", label: "Address AND mask", value: own, entityId: "block" },
    { id: "and-line", label: "Calculation", value: `${p.address} AND ${mask} = ${own}`, entityId: "block" },
  ]);
  add("block", "The whole block", "block", "IPv4 addressing", ["block"], [
    f.address,
    { id: "block", label: "Address block", value: b.cidr, entityId: "block" },
    { id: "block-size", label: "Addresses in the block", value: b.size, entityId: "block" },
    { id: "usable", label: "Usable by interfaces", value: b.usable, entityId: "block" },
    summary,
    ...(kindNote(b) ? [{ id: "kind-note", label: "Why this block is different", value: kindNote(b)!, entityId: "block" }] : []),
  ]);
  const ex = (key: keyof typeof SPECIAL) => block(SPECIAL[key][0], SPECIAL[key][1]);
  add("special-blocks", "/31, /32 and /0", "special", "IPv4 addressing", ["special"], [
    { id: "p2p-example", label: "A /31 link", value: `${ex("pointToPoint").cidr}: ${blockSummary(ex("pointToPoint"))}`, entityId: "special" },
    { id: "host-example", label: "A /32 route", value: `${ex("host").cidr}: ${blockSummary(ex("host"))}`, entityId: "special" },
    { id: "default-example", label: "The /0 route", value: `${ex("all").cidr}: ${blockSummary(ex("all"))}`, entityId: "special" },
  ]);
  add("special-ranges", "Special-purpose addresses", "special", "IANA special-purpose registry", ["special", "address"], [
    f.address,
    { id: "address-type", label: "Your address's range", value: rangeLabel(p.address), entityId: "address" },
    { id: "address-note", label: "What that means", value: range.note, entityId: "address" },
    { id: "private-ranges", label: "Private ranges (RFC 1918)", value: RANGE_SAMPLES.slice(0, 3).map((ip) => classify(ip).cidr).join(", "), entityId: "special" },
    { id: "documentation-ranges", label: "Documentation ranges (RFC 5737)", value: RANGE_SAMPLES.slice(5).map((ip) => classify(ip).cidr).join(", "), entityId: "special" },
    { id: "loopback-range", label: "Loopback", value: classify("127.0.0.1").cidr!, entityId: "special" },
    { id: "link-local-range", label: "Link-local (RFC 3927)", value: classify("169.254.0.1").cidr!, entityId: "special" },
  ]);
  add("predict-local", "Predict: same subnet or not?", "decision", "You", ["destination"], [f.cidr, f.destination]);
  add("compare", "Same subnet or not", "decision", "Your PC's operating system", ["verdict", "destination"], [
    f.cidr, f.destination, f.mask,
    { id: "own-network", label: "Your address AND mask", value: own, entityId: "verdict" },
    { id: "destination-network", label: "Destination AND mask", value: other, entityId: "verdict" },
    { id: "same-subnet", label: "Same subnet", value: same, entityId: "verdict" },
    { id: "verdict", label: "What your PC does", value: verdictText(same), entityId: "verdict" },
  ]);

  if (p.experiment === "mismatch") {
    const split = sameSubnet(p.address, p.destination, NEIGHBOUR_PREFIX);
    add("mismatch-pc", "Your PC's view, with /" + p.prefix, "decision", "Your PC", ["pc", "verdict"], [
      f.cidr, f.destination,
      { id: "pc-verdict", label: "Your PC decides", value: verdictText(same), entityId: "verdict" },
    ]);
    add("mismatch-neighbour", "The neighbour's view, with /" + NEIGHBOUR_PREFIX, "decision", "The neighbour", ["neighbour", "verdict"], [
      { id: "neighbour", label: "Neighbour address", value: `${p.destination}/${NEIGHBOUR_PREFIX}`, entityId: "neighbour" },
      f.address,
      { id: "neighbour-verdict", label: "The neighbour decides", value: verdictText(neighbourSame), entityId: "verdict" },
      { id: "agree", label: "The two devices agree", value: same === neighbourSame, entityId: "verdict" },
    ]);
    add("mismatch-split", "A real split: everyone on /" + NEIGHBOUR_PREFIX, "decision", "Network administrator", ["verdict"], [
      { id: "split-verdict", label: `Both devices with /${NEIGHBOUR_PREFIX} decide`, value: verdictText(split), entityId: "verdict" },
      { id: "split-agree", label: "The two devices agree", value: true, entityId: "verdict" },
    ]);
  }
  if (p.experiment === "third-octet") {
    add("third-octet", "A boundary in the third octet", "mask", "Your PC's network settings", ["bits", "mask"], [
      f.cidr, f.mask, { id: "boundary", label: "Where the boundary falls", value: boundary(p.address, p.prefix), entityId: "bits" },
    ]);
    add("third-octet-block", "A block that spans many third-octet values", "block", "IPv4 addressing", ["block"], [
      { id: "block", label: "Address block", value: b.cidr, entityId: "block" }, summary,
      { id: "usable", label: "Usable by interfaces", value: b.usable, entityId: "block" },
    ]);
  }
  if (p.experiment === "p2p") {
    add("p2p-link", "Two routers, one /31 link", "special", "Two routers", ["pc", "neighbour"], [
      f.cidr, { id: "neighbour", label: "Other end", value: `${p.destination}/${p.prefix}`, entityId: "neighbour" }, summary,
    ]);
    add("p2p-compare", "Both ends are on the link", "decision", "Each router", ["verdict"], [
      { id: "same-subnet", label: "Same subnet", value: same, entityId: "verdict" },
      { id: "usable", label: "Usable by interfaces", value: b.usable, entityId: "block" },
    ]);
  }
  return {
    frames,
    outcome: { blockStart: own, usable: b.usable, blockSize: b.size, sameSubnet: same, localForPc: same, localForDestination: neighbourSame },
    outcomeLabels: {
      blockStart: "First address of the block", usable: "Usable addresses", blockSize: "Addresses in the block", sameSubnet: "Same subnet",
      localForPc: "Your PC treats the destination as local", localForDestination: "The destination treats your PC as local",
    },
  };
}

/** Claims that contradict this example, for the tutor. A clean result means no supported claim is contradicted. */
function checkClaims(text: string, facts: Fact[], trace: Trace) {
  const problems: string[] = [];
  const { address: ip, prefix } = trace.params as Params;
  const b = block(String(ip), Number(prefix));
  const lower = text.toLowerCase();
  for (const match of lower.matchAll(/network address (?:is|of [^,.]* is|=)\s*(\d+\.\d+\.\d+\.\d+)/g)) {
    if (b.network === null) problems.push(`/${prefix} has no network address`);
    else if (match[1] !== b.network) problems.push(`the network address is ${b.network}, not ${match[1]}`);
  }
  for (const match of lower.matchAll(/broadcast(?: address)? (?:is|=)\s*(\d+\.\d+\.\d+\.\d+)/g)) {
    if (b.broadcast === null) problems.push(`/${prefix} has no broadcast address`);
    else if (match[1] !== b.broadcast) problems.push(`the broadcast address is ${b.broadcast}, not ${match[1]}`);
  }
  if (b.kind !== "normal" && /\b(its|the) (network|broadcast) address\b/.test(lower) && !/no (network|broadcast)/.test(lower)) problems.push(`/${prefix} has no network or broadcast address`);
  const same = facts.find((fact) => fact.id === "same-subnet")?.value;
  if (same === true && /\b(different|another) subnet\b/.test(lower) && !/\bnot (on )?(a )?different subnet\b/.test(lower)) problems.push("the addresses are on the same subnet");
  if (same === false && /\b(same|one) subnet\b/.test(lower) && !/\bnot (on )?(the )?same subnet\b/.test(lower)) problems.push("the addresses are on different subnets");
  // Subnet arithmetic is not a network simulation: it decides direct or gateway, never whether a packet arrives.
  if (/\b(will|would|does|is guaranteed to) (arrive|be delivered|reach|get through)\b|\bis reachable\b|\bcan reach\b/.test(lower))
    problems.push("subnet arithmetic alone does not show that a packet arrives; only the network simulator models delivery");
  return problems;
}

export const ipv4SubnetsAdapter: EngineAdapter<Params, Ipv4SubnetsData> = {
  id: "ipv4-subnets",
  version: "1.0.0",
  title: "Understanding IPv4 addresses and subnets",
  params,
  build,
  vocabulary: [
    "ipv4", "ip", "address", "interface", "octet", "bit", "binary", "decimal", "prefix", "mask", "subnet", "network", "host", "block",
    "broadcast", "usable", "cidr", "and", "boundary", "point-to-point", "route", "default", "gateway", "arp", "mac", "private", "loopback",
    "link-local", "documentation", "local", "remote", "direct", "packet", "frame",
  ],
  checkClaims,
  checkParam(key, value) {
    if (key !== "address" && key !== "destination") return null;
    try {
      parseAddress(String(value).trim());
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};
