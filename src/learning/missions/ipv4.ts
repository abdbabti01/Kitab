// Practice missions for "Understanding IPv4 addresses and subnets". Every answer and every wrong choice is a value the
// ipv4-practice engine computes with the shared IPv4 helper; each wrong choice is a specific, common mistake.
import type { Lesson } from "../lessons/schema.ts";
import { ipv4Terms } from "../lessons/ipv4-subnets.ts";

const reviewed = { status: "reviewed" as const, note: "Every value comes from Kitab's shared IPv4 helper." };
const terms = (...ids: string[]) => ids.map((id) => ipv4Terms.find((term) => term.id === id)!);

/** The ideas from Lesson 1 a learner needs before predicting, shown above each mission's question. */
export const ipv4KeyIdeas: Record<string, Lesson["glossary"]> = {
  "ipv4-network-address": terms("prefix", "subnet-mask", "bitwise-and", "network-address", "broadcast-address"),
  "ipv4-local-or-remote": terms("prefix", "bitwise-and", "same-subnet", "default-gateway"),
};

const sources = [
  { id: "cidr-prefix", text: "RFC 4632 §3.1. A prefix length gives the number of leading bits that identify the network; a prefix of n bits gives a block of 2^(32−n) addresses that starts on a multiple of its size." },
  { id: "network-broadcast", text: "RFC 1122 §3.2.1.3 and RFC 919. In a subnet the address with all host bits 0 identifies the network, and all host bits 1 is the directed broadcast." },
  { id: "local-decision", text: "RFC 1122 §3.3.1.1. A host compares the destination's network bits, using its own interface's mask, with its own network: if they match it sends directly, otherwise to a gateway." },
];

export const ipv4Missions: unknown[] = [
  {
    schemaVersion: 1,
    id: "ipv4-network-address",
    version: "1.0.0",
    title: "Find the network address",
    concept: "ipv4-subnets",
    topic: "Networks",
    objective: "Find the network address of an IPv4 address and prefix, including when the prefix boundary falls inside an octet.",
    summary: "Work out the first address of an IPv4 block from an address and its prefix, for boundaries in the second, third and fourth octets.",
    review: reviewed,
    engine: { id: "ipv4-practice", version: "1.0.0" },
    scenario: { task: "network", destination: "10.0.0.1" },
    variants: [
      { id: "slash-28", label: "10.20.30.77/28", params: { address: "10.20.30.77", prefix: 28 } },
      { id: "slash-20", label: "172.20.200.9/20", params: { address: "172.20.200.9", prefix: 20 } },
      { id: "slash-26", label: "192.168.5.130/26", params: { address: "192.168.5.130", prefix: 26 } },
      { id: "slash-12", label: "10.77.141.20/12", params: { address: "10.77.141.20", prefix: 12 } },
      { id: "slash-29", label: "192.168.10.45/29", params: { address: "192.168.10.45", prefix: 29 } },
      { id: "slash-22", label: "172.16.37.200/22", params: { address: "172.16.37.200", prefix: 22 } },
      { id: "slash-27", label: "10.1.2.99/27", params: { address: "10.1.2.99", prefix: 27 } },
      { id: "slash-30", label: "192.168.100.250/30", params: { address: "192.168.100.250", prefix: 30 } },
    ],
    prediction: {
      kind: "choice",
      prompt: "An interface uses {param.address}/{param.prefix}. What is the network address of its subnet?",
      options: [
        { id: "network", text: "{value}", value: { fact: "outcome.network" } },
        { id: "broadcast", text: "{value}", value: { fact: "outcome.broadcast" }, misconception: "host-bits-to-one" },
        { id: "octet-cut", text: "{value}", value: { fact: "outcome.octetCut" }, misconception: "whole-octets" },
        { id: "unchanged", text: "{value}", value: { fact: "outcome.unchanged" }, misconception: "keeps-host-bits" },
      ],
      answer: { fact: "outcome.network" },
      evidenceFrame: "and",
    },
    explanation: {
      prompt: "Which calculation gives that network address?",
      options: [
        { id: "and-mask", text: "AND it with the mask {outcome.mask}: keep the network bits, set every host bit to 0.", correct: true },
        { id: "zero-octet", text: "Set the last octet to 0, because the network part of an address always ends at a whole octet.", correct: false, misconception: "whole-octets" },
        { id: "ones", text: "Set every host bit to 1, which gives the address that names the whole subnet.", correct: false, misconception: "host-bits-to-one" },
      ],
    },
    hints: [
      { text: "Find the octet where /{param.prefix} ends, and write that octet of {param.address} in binary.", beforePrediction: true, target: "mask" },
      { text: "Keep the first {param.prefix} bits and turn every bit after them into 0.", beforePrediction: true, target: "mask" },
      { text: "The calculation is {outcome.andLine}.", beforePrediction: false, target: "block" },
    ],
    misconceptions: {
      "host-bits-to-one": { label: "Host bits set to 1", message: "Setting every host bit to 1 gives the broadcast address, {outcome.broadcast}, the last address of the block. The network address clears them all: {outcome.network}.", target: "block" },
      "whole-octets": { label: "Network part ends at an octet", message: "That treats the network part as whole octets. /{param.prefix} ends inside an octet, so keep only the network bits there too: {outcome.andLine}.", target: "mask" },
      "keeps-host-bits": { label: "Host bits kept", message: "The address itself still has its host bits. The network address is the first address of the {outcome.blockSize}-address block: {outcome.network}.", target: "block" },
    },
    masteryVariants: 2,
    sources: sources.slice(0, 2),
  },
  {
    schemaVersion: 1,
    id: "ipv4-local-or-remote",
    version: "1.0.0",
    title: "Same subnet or not?",
    concept: "ipv4-subnets",
    topic: "Networks",
    objective: "Decide, with only its own address and prefix, whether a device sends a packet directly or through its gateway.",
    summary: "Predict whether a destination is on a device's subnet, including cases where similar-looking addresses are on different subnets and different-looking ones aren't.",
    review: reviewed,
    engine: { id: "ipv4-practice", version: "1.0.0" },
    scenario: { task: "local" },
    variants: [
      { id: "slash-28-remote", label: "10.20.30.77/28 → 10.20.30.90", params: { address: "10.20.30.77", prefix: 28, destination: "10.20.30.90" } },
      { id: "slash-23-local", label: "192.168.1.10/23 → 192.168.0.200", params: { address: "192.168.1.10", prefix: 23, destination: "192.168.0.200" } },
      { id: "slash-20-local", label: "172.20.200.9/20 → 172.20.207.1", params: { address: "172.20.200.9", prefix: 20, destination: "172.20.207.1" } },
      { id: "slash-25-remote", label: "192.168.5.130/25 → 192.168.5.20", params: { address: "192.168.5.130", prefix: 25, destination: "192.168.5.20" } },
      { id: "slash-30-remote", label: "10.1.2.5/30 → 10.1.2.9", params: { address: "10.1.2.5", prefix: 30, destination: "10.1.2.9" } },
      { id: "slash-22-local", label: "172.16.37.200/22 → 172.16.38.10", params: { address: "172.16.37.200", prefix: 22, destination: "172.16.38.10" } },
    ],
    prediction: {
      kind: "choice",
      prompt: "A device uses {param.address}/{param.prefix} and sends a packet to {param.destination}. What does it do?",
      options: [
        { id: "direct", text: "Same subnet: it delivers directly, using ARP for the destination's MAC address", value: { literal: "direct" }, misconception: "looks-local" },
        { id: "gateway", text: "Different subnet: it hands the packet to its default gateway", value: { literal: "gateway" }, misconception: "looks-remote" },
        { id: "octets", text: "It compares the first three octets: direct only if they match", value: { literal: "octets" }, misconception: "whole-octets" },
        { id: "their-mask", text: "It depends on the prefix the destination uses", value: { literal: "their-mask" }, misconception: "destination-mask" },
      ],
      answer: { fact: "outcome.decision" },
      evidenceFrame: "compare",
    },
    explanation: {
      prompt: "What decides it?",
      options: [
        { id: "own-mask", text: "Both addresses ANDed with this device's own mask, {outcome.mask}.", correct: true },
        { id: "first-octets", text: "Whether the first three octets of the two addresses are the same.", correct: false, misconception: "whole-octets" },
        { id: "reply", text: "Whether a ping sent to the destination address gets a reply back.", correct: false, misconception: "reachability" },
      ],
    },
    hints: [
      { text: "Use only this device's prefix, /{param.prefix}. Where does it end, and which bits of {param.destination} does it cover?", beforePrediction: true, target: "verdict" },
      { text: "AND each address with the mask for /{param.prefix} and compare the results.", beforePrediction: true, target: "verdict" },
      { text: "{param.address} gives {outcome.ownNetwork}; {param.destination} gives {outcome.destinationNetwork}.", beforePrediction: false, target: "verdict" },
    ],
    misconceptions: {
      "looks-local": { label: "Similar addresses look local", message: "Similar-looking addresses can be on different subnets. With /{param.prefix}, {param.address} masks to {outcome.ownNetwork} but {param.destination} masks to {outcome.destinationNetwork}, so the packet goes to the gateway.", target: "verdict" },
      "looks-remote": { label: "Different octets look remote", message: "Different-looking octets don't decide it. With /{param.prefix}, both addresses mask to {outcome.ownNetwork}, so the device delivers directly.", target: "verdict" },
      "whole-octets": { label: "Compares whole octets", message: "A prefix doesn't have to end at an octet. Only the first {param.prefix} bits count: {outcome.ownNetwork} and {outcome.destinationNetwork}.", target: "verdict" },
      "destination-mask": { label: "Uses the destination's prefix", message: "A device decides with its own address and prefix only. It doesn't know the destination's settings, and doesn't need them for this choice.", target: "verdict" },
      reachability: { label: "Decides by testing delivery", message: "This decision is arithmetic the device makes before sending anything. Whether a reply comes back depends on cables, ARP and routes, which the network playground simulates.", target: "verdict" },
    },
    masteryVariants: 2,
    sources: sources.slice(2),
  },
];
