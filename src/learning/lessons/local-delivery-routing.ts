import type { Lesson } from "./schema.ts";
import { ipv4Terms } from "./ipv4-subnets.ts";

// Lesson 2 of the IPv4 redesign. Every networking value comes from a real run of the lab's simulator, through the
// local-delivery engine; the text explains cause and purpose and never states a value on its own.
const reuse = (...ids: string[]) => ids.map((id) => ipv4Terms.find((term) => term.id === id)!);

export const localDeliveryTerms: Lesson["glossary"] = [
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
  {
    id: "private-address", term: "Private address",
    definition: "An address from the ranges set aside for private networks (RFC 1918), such as 192.168.0.0/16. Many homes reuse the same ones, so routers on the Internet don't route to them.",
    purpose: "It's why a reply from the Internet can't be addressed to your PC directly.",
  },
  {
    id: "nat", term: "NAT (network address translation)",
    definition: "A home router rewrites the private source address and port of outgoing packets to its own public address and a port, saves the pair in its NAT table, and uses that entry to restore the private destination of the reply.",
    purpose: "It lets every device in a home share one public address and still get its own replies.",
  },
  {
    id: "experiment-change", term: "One change at a time",
    definition: "An experiment changes a single setting, runs the same action again and compares the result with the normal run. Putting the setting back and running again confirms the cause.",
  },
];

export const localDeliveryRouting: Lesson = {
  schemaVersion: 1,
  id: "local-delivery-routing",
  version: "1.0.0",
  title: "Local delivery, gateways and routing",
  question: "Who does my PC hand a packet to, and how does a router get it to another subnet?",
  summary: "Follow real simulated pings from your PC: the next-hop decision, ARP for the gateway, the frame and packet at every link, a router's routing decision and a home router's NAT. Then change one setting and see where the run stops.",
  topic: "Networks",
  review: { status: "reviewed", note: "Every networking value comes from a run of Kitab's network simulator." },
  engine: { id: "local-delivery", version: "1.2.0" },
  scenario: {},
  scope: [
    "Every step is an event from a real run of Kitab's network simulator on the lab's own starter networks: “Two connected LANs”, “Your first LAN” and the internet starter.",
    "The first decision is the same-subnet arithmetic from Lesson 1, labelled as a calculation. Everything after it, including ARP replies, MAC addresses, routes, TTL and delivery, is what the simulator did.",
    "The routers between the two LANs forward without NAT, so the IP addresses stay as your PC wrote them. Chapter 5 shows the home router's NAT, a separate step after routing.",
    "Three experiments each change one setting, run the same ping in the simulator again and show where it stops, then put the setting back and run it once more.",
    "Predictions are for practice: nothing is scored or recorded.",
  ],
  prerequisites: "Lesson 1, Understanding IPv4 addresses and subnets: the same-subnet decision.",
  levels: [
    { id: "decision", name: "Decision", short: "Direct or gateway", intro: "Before sending, a device decides with its own address and prefix whether the destination is on its subnet." },
    { id: "link", name: "Link", short: "Frames, MACs and ARP", intro: "On each link, a frame carries the packet between two neighbours, addressed with their MAC addresses." },
    { id: "network", name: "Network", short: "Packets, routers and routes", intro: "The IP packet keeps its source and destination end to end. Routers forward it by looking the destination up in a routing table." },
  ],
  glossary: localDeliveryTerms,
  controls: [],
  experiments: [
    {
      id: "wrong-gateway", title: "A wrong default gateway", question: "What happens when your PC's default gateway is an address no device has?",
      params: { experiment: "wrong-gateway" },
      startFrame: "wrong-gateway-baseline",
      chapters: [{ id: "wrong-gateway-run", title: "Wrong gateway", goal: "Change one setting, run the same ping, find where it stops, then put it back.", steps: [
        { id: "wrong-gateway-normal", frame: "wrong-gateway-baseline", actor: "Your PC", focus: ["pc"], terms: ["experiment-change", "default-gateway"], what: "In the normal run, the setting “{fact:experiment-setting}” on {fact:experiment-device} is {fact:experiment-normal}. The simulated ping: {fact:experiment-summary}", why: "This is what the experiment is compared with: the same network and the same ping as the walkthrough." },
        { id: "wrong-gateway-change", frame: "wrong-gateway-change", actor: "Your PC", focus: ["pc"], terms: [], what: "One change: “{fact:experiment-setting}” on {fact:experiment-device} goes from {fact:experiment-normal} to {fact:experiment-value}. Nothing else changes. Predict what happens, then step on: the simulator runs the same ping again.", why: "Changing a single setting means any difference in the run is caused by that setting." },
        { id: "wrong-gateway-diverge", frame: "wrong-gateway-diverge", actor: "Your PC", focus: ["pc"], terms: ["next-hop"], what: "The two runs part at your PC's first decision: next hop {fact:difference-next-hop-experiment} instead of {fact:difference-next-hop-normal}, by route “{fact:wrong-gateway-route}” out of {fact:wrong-gateway-interface}.", why: "Your PC trusts its setting: for a remote destination it always hands the packet to its default gateway, whatever that address is." },
        { id: "wrong-gateway-stop", frame: "wrong-gateway-stop", level: "link", actor: "Your PC", focus: ["pc"], terms: ["arp"], what: "The run stops at {fact:stopped-at}: {fact:stop-message} The simulator's reason is {fact:stop-reason}.", why: "{fact:stop-detail} Without the next hop's MAC, your PC can't build the frame, so the ping never leaves. {fact:stop-advice}" },
        { id: "wrong-gateway-restore", frame: "wrong-gateway-restore", actor: "Your PC", focus: ["pc"], terms: [], what: "Put back: “{fact:experiment-setting}” is {fact:experiment-value} again. The same ping, run again: {fact:experiment-summary}", why: "Restoring the one setting brings the normal result back, which confirms it was the cause." },
      ] }],
      compare: [{ outcome: "pingSucceeded", label: "The ping succeeded" }, { outcome: "nextHop", label: "Your PC's next hop" }, { outcome: "stopReason", label: "Simulator's stop reason" }, { outcome: "stoppedAt", label: "Where the run stopped" }],
    },
    {
      id: "no-return-gateway", title: "A server with no way back", question: "What happens when the server has no default gateway?",
      params: { experiment: "no-return-gateway" },
      startFrame: "no-return-gateway-baseline",
      chapters: [{ id: "no-return-gateway-run", title: "No way back", goal: "See the request arrive, and the reply fail on its own routing decision.", steps: [
        { id: "no-return-gateway-normal", frame: "no-return-gateway-baseline", actor: "Office server", focus: ["server"], terms: ["experiment-change", "default-gateway"], what: "In the normal run, the setting “{fact:experiment-setting}” on {fact:experiment-device} is {fact:experiment-normal}. The simulated ping: {fact:experiment-summary}", why: "This is what the experiment is compared with: the same network and the same ping as the walkthrough." },
        { id: "no-return-gateway-change", frame: "no-return-gateway-change", actor: "Office server", focus: ["server"], terms: [], what: "One change: “{fact:experiment-setting}” on {fact:experiment-device} goes from {fact:experiment-normal} to {fact:experiment-value}. Your PC and the router stay as they were. Predict what happens, then step on.", why: "Changing a single setting means any difference in the run is caused by that setting." },
        { id: "no-return-gateway-arrives", frame: "no-return-gateway-arrives", actor: "Office server", focus: ["server"], terms: [], what: "The request still arrives: {fact:no-return-gateway-device} receives {fact:no-return-gateway-source-ip} → {fact:no-return-gateway-destination-ip}, TTL {fact:no-return-gateway-ttl}.", why: "Nothing on the way there changed: your PC and the router never use the server's gateway." },
        { id: "no-return-gateway-stop", frame: "no-return-gateway-stop", actor: "Office server", focus: ["server"], terms: ["next-hop"], what: "The run stops at {fact:stopped-at}, reason {fact:stop-reason}: {fact:stop-message}", why: "{fact:stop-detail} The reply is a new packet from the server to your PC, so it needs its own routing decision: the way back is never automatic." },
        { id: "no-return-gateway-restore", frame: "no-return-gateway-restore", actor: "Office server", focus: ["server"], terms: [], what: "Put back: “{fact:experiment-setting}” is {fact:experiment-value} again. The same ping, run again: {fact:experiment-summary}", why: "Restoring the one setting brings the normal result back, which confirms it was the cause." },
      ] }],
      compare: [{ outcome: "requestArrived", label: "The request reached the server" }, { outcome: "pingSucceeded", label: "The ping succeeded" }, { outcome: "stopReason", label: "Simulator's stop reason" }, { outcome: "stoppedAt", label: "Where the run stopped" }],
    },
    {
      id: "nat-off", title: "Turn off NAT", question: "What happens when the home router stops translating addresses?",
      params: { experiment: "nat-off" },
      startFrame: "nat-off-baseline",
      chapters: [{ id: "nat-off-run", title: "NAT off", goal: "See the private address leave home and the reply stop on the Internet.", steps: [
        { id: "nat-off-normal", frame: "nat-off-baseline", actor: "Home router", focus: ["router"], terms: ["experiment-change", "nat"], what: "In the normal run, the setting “{fact:experiment-setting}” on {fact:experiment-device} is {fact:experiment-normal}. The simulated ping: {fact:experiment-summary}", why: "This is what the experiment is compared with: the same network and the same ping as chapter 5." },
        { id: "nat-off-change", frame: "nat-off-change", actor: "Home router", focus: ["router"], terms: [], what: "One change: “{fact:experiment-setting}” on {fact:experiment-device} goes from {fact:experiment-normal} to {fact:experiment-value}. Routing stays the same. Predict what happens, then step on.", why: "Changing a single setting means any difference in the run is caused by that setting." },
        { id: "nat-off-diverge", frame: "nat-off-diverge", actor: "Home router", focus: ["router"], terms: ["nat-vs-routing"], what: "The two runs part at the home router: where the normal run did “{fact:difference-step-normal}”, this run goes straight to “{fact:difference-step-experiment}” for its next hop.", why: "With NAT off, the router still routes, but it no longer rewrites anything: the packet leaves with your PC's private source address." },
        { id: "nat-off-arrives", frame: "nat-off-arrives", actor: "Internet server", focus: ["server"], terms: ["private-address"], what: "The request still reaches {fact:nat-off-device}, from {fact:nat-off-source-ip}, your PC's private address, to {fact:nat-off-destination-ip}.", why: "Routers on the way there look only at the destination, so the request gets through." },
        { id: "nat-off-stop", frame: "nat-off-stop", actor: "ISP router", focus: ["isp"], terms: ["private-address"], what: "The run stops at {fact:stopped-at}, reason {fact:stop-reason}: {fact:stop-message}", why: "{fact:stop-advice} This is the fault the lab mission “Bring the reply home” asks you to find." },
        { id: "nat-off-restore", frame: "nat-off-restore", actor: "Home router", focus: ["router"], terms: [], what: "Put back: “{fact:experiment-setting}” is {fact:experiment-value} again. The same ping, run again: {fact:experiment-summary}", why: "Restoring the one setting brings the normal result back, which confirms it was the cause." },
      ] }],
      compare: [{ outcome: "serverSawSource", label: "Source address the server saw" }, { outcome: "pingSucceeded", label: "The ping succeeded" }, { outcome: "stopReason", label: "Simulator's stop reason" }, { outcome: "stoppedAt", label: "Where the run stopped" }],
    },
  ],
  practice: [
    { missionId: "gateway-or-direct", why: "Predict whose MAC goes on the frame, direct or through the gateway, including subnets that look local but aren’t." },
  ],
  labPractice: [
    { missionId: "leave-the-lan", why: "Fix gateways and routes so a ping can leave its network and come back." },
    { missionId: "bring-reply-home", why: "Websites don’t load: find what stops the reply on its way back through NAT." },
  ],
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
    { id: "leaving-home", title: "Leaving home: NAT", goal: "See the home router translate your PC's private address, the server answer the public one, and the router bring the reply home.", steps: [
      { id: "nat-translate", title: "The home router translates the source", frame: "nat-translate", actor: "Home router", focus: ["router"], terms: ["nat", "private-address"], what: "Answer the question in the picture first. Routing has already chosen “{fact:internet-before-route}”. Then the home router rewrites the source: {fact:internet-after-inside} becomes {fact:internet-after-outside}. Source IP {fact:internet-before-source-ip}, then {fact:internet-after-source-ip}; the destination stays {fact:internet-after-destination-ip}.", why: "Your PC's address is private, so Internet routers couldn't send anything back to it. NAT swaps it for the router's public address and saves the pair. It's a separate step from routing, which only chose where the packet goes." },
      { id: "server-sees", title: "What the server sees", frame: "server-sees", actor: "Internet server", focus: ["server"], terms: [], what: "{fact:internet-device} receives the packet from {fact:internet-source-ip} to {fact:internet-destination-ip}, with TTL {fact:internet-ttl}.", why: "The server only ever sees the public address. It can't tell that a translation happened or which device in the home asked." },
      { id: "server-replies", title: "The server replies to the public address", frame: "server-replies", actor: "Internet server", focus: ["server"], terms: ["next-hop"], what: "The reply goes from {fact:internet-source-ip} to {fact:internet-destination-ip}. The server chooses “{fact:internet-route}”, next hop {fact:internet-next-hop}.", why: "The server answers the address it saw. Internet routers can deliver to it because that public address belongs to the home router." },
      { id: "nat-restore", title: "The home router restores the destination", frame: "nat-restore", actor: "Home router", focus: ["router"], terms: ["nat"], what: "The reply reaches the home router addressed to {fact:internet-before-destination-ip}. The router finds its saved pair, {fact:internet-after-outside} → {fact:internet-after-inside}, and changes the destination to {fact:internet-after-destination-ip}. The source stays {fact:internet-after-source-ip}.", why: "The entry saved on the way out is what lets the reply find your PC. Without it, the router wouldn't know which device in the home asked." },
      { id: "nat-home", title: "The reply comes home", frame: "nat-home", actor: "Your PC", focus: ["pc"], terms: [], what: "{fact:internet-summary} Your PC received the reply from {fact:internet-source-ip}: simulated run succeeded = {fact:internet-delivered}.", why: "Routing chose each next hop and NAT changed the address at the edge of the home network: two different jobs. The lab mission “Bring the reply home” asks you to find a broken NAT yourself." },
    ] },
    { id: "try-in-the-lab", title: "Try it in the lab", goal: "Take what you followed into the network lab: change a setting, run the ping again and fix what stops it.", steps: [
      { id: "try-lab", title: "Try it in the lab", frame: "try-lab", actor: "You", focus: ["pc"], terms: [], what: "Apart from chapter 1’s subnet calculation, every step in this lesson was an event from the lab’s simulator. Open one of these networks, change an address, a gateway or NAT, and run the ping again: the lab shows each event, as here.", why: "Then practise below: “Gateway or direct?” checks the frame’s destination MAC on networks you haven’t seen, and the lab missions ask you to find and fix what stops a ping." },
    ] },
  ],
  sources: [
    { id: "next-hop", text: "RFC 1122 §3.3.1. A host sends a datagram directly when the destination is on a connected network, otherwise to a gateway on its own network; it uses the next hop's link-layer address, found with ARP." },
    { id: "arp", text: "RFC 826. ARP broadcasts a request for the hardware address that belongs to a protocol address on the local network; the owner of that address replies directly." },
    { id: "forwarding", text: "RFC 1812 §5.2–5.3. A router decrements TTL, chooses a route for the destination (the longest matching prefix), and transmits the packet on the next link in a new link-layer frame." },
    { id: "nat", text: "RFC 3022 §2. Network Address Translation rewrites addresses at a boundary between networks; it is a separate function from IP routing." },
  ],
};
