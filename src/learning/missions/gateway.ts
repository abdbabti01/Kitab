// Practice mission for "Local delivery, gateways and routing": which MAC goes on the frame? Every answer and every wrong
// choice is a MAC address from a real simulator run (the gateway-practice engine); each wrong choice is a common mistake.
import type { Lesson } from "../lessons/schema.ts";
import { ipv4Terms } from "../lessons/ipv4-subnets.ts";
import { localDeliveryTerms } from "../lessons/local-delivery-routing.ts";

const term = (id: string) => [...localDeliveryTerms, ...ipv4Terms].find((item) => item.id === id)!;

/** The ideas from Lessons 1 and 2 a learner needs before predicting, shown above the mission's question. */
export const gatewayKeyIdeas: Record<string, Lesson["glossary"]> = {
  "gateway-or-direct": ["same-subnet", "default-gateway", "next-hop", "arp", "mac-address"].map(term),
};

export const gatewayMissions: unknown[] = [
  {
    schemaVersion: 1,
    id: "gateway-or-direct",
    version: "1.0.0",
    title: "Gateway or direct?",
    concept: "local-delivery-routing",
    topic: "Networks",
    objective: "Decide whether your PC delivers a packet directly or through its gateway, and predict the destination MAC address on the frame it sends.",
    summary: "Predict whose MAC address your PC puts on the frame, then watch the simulator's ARP and forwarding. Includes subnets that look local but aren't, and the reverse.",
    review: { status: "reviewed", note: "Every MAC address, ARP step and decision comes from a run of Kitab's network simulator." },
    engine: { id: "gateway-practice", version: "1.0.0" },
    scenario: {},
    variants: [
      { id: "home-phone", label: "192.168.1.10/24 → 192.168.1.30", params: { variant: "home-phone", address: "192.168.1.10", prefix: 24, gateway: "192.168.1.1", destination: "192.168.1.30" } },
      { id: "office-server", label: "192.168.1.10/24 → 192.168.2.20", params: { variant: "office-server", address: "192.168.1.10", prefix: 24, gateway: "192.168.1.1", destination: "192.168.2.20" } },
      { id: "home-23", label: "192.168.1.10/23 → 192.168.0.30", params: { variant: "home-23", address: "192.168.1.10", prefix: 23, gateway: "192.168.1.1", destination: "192.168.0.30" } },
      { id: "split-25", label: "192.168.1.10/25 → 192.168.1.200", params: { variant: "split-25", address: "192.168.1.10", prefix: 25, gateway: "192.168.1.1", destination: "192.168.1.200" } },
      { id: "internet-server", label: "192.168.1.10/24 → 198.51.100.20", params: { variant: "internet-server", address: "192.168.1.10", prefix: 24, gateway: "192.168.1.1", destination: "198.51.100.20" } },
    ],
    prediction: {
      kind: "choice",
      prompt: "Your PC ({param.address}/{param.prefix}, default gateway {param.gateway}) pings {param.destination}. Which destination MAC address goes on the frame it sends?",
      options: [
        { id: "destination", text: "{value}: the destination's MAC", value: { fact: "outcome.targetMac" }, misconception: "final-destination" },
        { id: "gateway", text: "{value}: the default gateway's MAC", value: { fact: "outcome.gatewayMac" }, misconception: "always-gateway" },
        { id: "broadcast", text: "{value}: broadcast, so every device receives it", value: { fact: "outcome.broadcastMac" }, misconception: "broadcast-frame" },
        { id: "own", text: "{value}: your PC's own MAC", value: { fact: "outcome.ownMac" }, misconception: "own-mac" },
      ],
      answer: { fact: "outcome.frameMac" },
      evidenceFrame: "the-frame",
    },
    explanation: {
      prompt: "How did your PC get the MAC address it put on the frame?",
      options: [
        { id: "next-hop", text: "It asked ARP for its next hop on this link: the destination if it is on the same subnet, otherwise the gateway.", correct: true },
        { id: "final", text: "It asked ARP for the final destination's MAC, and the routers on the way passed the answer back to it.", correct: false, misconception: "arp-across-routers" },
        { id: "switch", text: "The switch between them looked the destination up in its MAC address table and answered the ARP request on its behalf.", correct: false, misconception: "switch-answers" },
        { id: "always", text: "It always uses the default gateway's MAC, because every packet leaves your PC through the gateway.", correct: false, misconception: "gateway-rule" },
      ],
    },
    hints: [
      { text: "Is {param.destination} on your PC's subnet? AND both addresses with the mask for /{param.prefix} and compare.", beforePrediction: true, target: "pc" },
      { text: "A frame only crosses one link: it goes to the destination itself if it's on the same subnet, otherwise to the default gateway, {param.gateway}.", beforePrediction: true, target: "pc" },
      { text: "Your PC's route was “{outcome.route}”, next hop {outcome.nextHop}, so it asked ARP for that address and got {outcome.frameMac}.", beforePrediction: false, target: "pc" },
    ],
    misconceptions: {
      "final-destination": { label: "The frame goes to the final destination", message: "{param.destination} isn't on your PC's subnet, so it isn't on this link and your PC never learns its MAC. The frame goes to the next hop, the default gateway {param.gateway}: {outcome.frameMac}.", target: "pc" },
      "always-gateway": { label: "Everything goes through the gateway", message: "{param.destination} is on your PC's own /{param.prefix} subnet, so your PC delivers directly: it asks ARP for {param.destination} and the frame goes to {outcome.frameMac}. The gateway is only for other subnets.", target: "pc" },
      "broadcast-frame": { label: "The frame is broadcast", message: "Broadcast is only the ARP request asking who has {outcome.nextHop}. Once that device answers, the frame carrying the packet goes to it alone: {outcome.frameMac}.", target: "pc" },
      "own-mac": { label: "Uses its own MAC", message: "{outcome.ownMac} is your PC's own MAC, the frame's source. The destination MAC is the next hop's: {outcome.frameMac}.", target: "pc" },
      "gateway-rule": { label: "Every packet goes to the gateway", message: "Only packets for other subnets go to the gateway; a destination on your own subnet gets a frame addressed to it directly. Here your PC's next hop was {outcome.nextHop}, so the frame went to {outcome.frameMac}.", target: "pc" },
      "arp-across-routers": { label: "ARP crosses routers", message: "ARP only works on one link, and routers don't pass replies between subnets. Your PC asked for its next hop, {outcome.nextHop}, and the device that owns that address answered.", target: "pc" },
      "switch-answers": { label: "The switch answers ARP", message: "A switch forwards the ARP broadcast but never answers it. The device that owns {outcome.nextHop} answered with its own MAC, {outcome.frameMac}.", target: "pc" },
    },
    masteryVariants: 2,
    sources: [
      { id: "next-hop", text: "RFC 1122 §3.3.1. A host sends a datagram directly when the destination is on a connected network, otherwise to a gateway on its own network; it uses the next hop's link-layer address, found with ARP." },
      { id: "arp", text: "RFC 826. ARP broadcasts a request for the hardware address that belongs to a protocol address on the local network; the owner of that address replies directly." },
    ],
  },
];
