// Networking practice missions. Each mission is a realistic problem with several versions that
// break the network in genuinely different ways. Everything here is data and pure functions over the
// deterministic engine; assessment lives in mission-assess.ts.
import { starter } from "./starters.ts";
import { newSession, simulate } from "./engine.ts";
import { createDevice, type Action, type Device, type Network, type TraceEvent } from "./model.ts";

/** Kinds of setting a learner can name when diagnosing. */
export type Area = "link" | "port" | "wifi" | "mode" | "address" | "mask" | "gateway" | "routes" | "dhcp" | "nat" | "dns";
export const areaLabels: Record<Area, string> = {
  link: "A cable or connection",
  port: "An interface turned off",
  wifi: "Wi-Fi network name or passphrase",
  mode: "How the address is obtained (static or DHCP)",
  address: "An IP address",
  mask: "A subnet mask (prefix length)",
  gateway: "A default gateway",
  routes: "A routing table entry",
  dhcp: "The DHCP service",
  nat: "NAT settings",
  dns: "A DNS server setting",
};

/** Device settings a mission may keep fixed; each lock says why. */
export type Aspect = "addresses" | "gateways" | "dns" | "ports" | "mode" | "wifi" | "routes" | "nat" | "dhcp" | "services";
export const aspectLabels: Record<Aspect, string> = {
  addresses: "IP addresses and masks",
  gateways: "default gateways",
  dns: "DNS server settings",
  ports: "interfaces being on or off",
  mode: "static or DHCP addressing",
  wifi: "Wi-Fi name and passphrase",
  routes: "routing tables",
  nat: "NAT settings",
  dhcp: "DHCP service settings",
  services: "DNS records and web service",
};
export type Lock = { aspect: Aspect; devices?: string[]; why: string };

export type Variant = {
  id: string;
  /** What the learner notices. Symptoms only: never the faulty setting. */
  symptom: string;
  build: () => Network;
  /** The first thing to try, filled into the send form. */
  probe: Action;
  /** Correct diagnoses: the device and kind of setting at fault. */
  faults: { device: string; area: Area }[];
  /** Hint level 3: where to look, without the value to set. */
  focus: string;
  /** Shown once the mission is completed: what was actually wrong. */
  cause: string;
};

export type Check = {
  id: string;
  label: string;
  /** Run in order on a fresh session (e.g. DHCP, then ping); targets may depend on the learner's network. */
  actions: (network: Network, variant: Variant) => Action[];
  /** Anything beyond success that the run must show; returns why it does not count, or null. */
  expect?: (events: TraceEvent[], network: Network) => string | null;
  /** The event that proves the check passed. */
  proof?: (events: TraceEvent[]) => number;
};

export type Choice = { id: string; text: string };
export type Prediction = {
  /** When it is asked: before the first probe, after the first failed probe, or before checking the fix. */
  when: "before-probe" | "after-failure" | "before-check";
  prompt: string;
  options: (network: Network) => Choice[];
  /** The correct option for this variant, computed from its starting network and the engine. */
  answer: (network: Network, variant: Variant) => string;
  /** Why, shown after answering. */
  explain: string;
};

export type Question = {
  prompt: string;
  /** The correct number, computed from the run. */
  answer: (events: TraceEvent[]) => number;
  explain: string;
};

type Base = {
  id: string;
  version: string;
  level: number;
  title: string;
  /** The situation, without naming the cause. */
  brief: string;
  objectives: string[];
  variants: Variant[];
  kinds: Action["kind"][];
  locks: Lock[];
  /** Why cables and devices are fixed, or undefined if the learner may change them. */
  topologyLocked?: string;
  prediction?: Prediction;
  /** Hint levels 1 and 2; level 3 is the variant's focus. */
  hints: [string, string];
  explanation: { prompt: string; options: (Choice & { correct: boolean; misconception?: string })[] };
  /** Shown on completion: the rule the learner demonstrated. */
  proved: string;
};
export type FixMission = Base & {
  kind: "fix";
  areas: Area[];
  checks: Check[];
  /** Fixes that hide the problem instead of solving it. */
  shortcuts?: { detect: (network: Network) => boolean; message: string }[];
};
/** A mission about reading evidence: nothing is broken, the learner explains what the trace shows. */
export type InvestigateMission = Base & {
  kind: "investigate";
  question: Question;
  /** Events that show the evidence asked for. */
  evidence: (events: TraceEvent[]) => number[];
};
export type NetworkMission = FixMission | InvestigateMission;

const dev = (n: Network, id: string) => n.devices.find((d) => d.id === id)!;
const ipOf = (n: Network, id: string) => dev(n, id).interfaces.find((p) => p.ip)?.ip ?? "";
const link = (n: Network, a: string, ap: string, b: string, bp: string, medium: "ethernet" | "wifi" = "ethernet") =>
  n.links.push({ id: `l${n.links.length}-${a}-${b}`, a: { device: a, port: ap }, b: { device: b, port: bp }, medium });
const add = (n: Network, d: Device, name: string, group: string) => {
  Object.assign(d, { name, group });
  n.devices.push(d);
  return d;
};
const hasTitle = (events: { title: string; actor: string }[], title: string, actor?: string) =>
  events.findIndex((e) => e.title === title && (!actor || e.actor === actor));
const answeredBy = (events: { title: string; actor: string }[], id: string, name: string) =>
  hasTitle(events, "Create ICMP echo reply", id) >= 0 || hasTitle(events, "Server reads HTTP request", id) >= 0
    ? null
    : `The reply did not come from ${name}.`;
const isPrivateRoute = (network: string, prefix: number) => {
  const [a, b] = network.split(".").map(Number);
  return prefix <= 24 && (a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168));
};

// Variants are built from the playground's starter networks, then broken in one specific way.
// The web server's address in the internet starter. "Bring the reply home" requests it directly, so no DNS lookup
// runs before the web traffic and the first thing to fail is the reply that NAT should bring home.
const webByIp = "http://198.51.100.20/";
const lanWithServer = () => {
  const n = starter("lan");
  n.name = "Office LAN";
  dev(n, "server").name = "File server";
  return n;
};

export const missions: NetworkMission[] = [
  {
    kind: "fix",
    id: "no-connection",
    version: "1.0.0",
    level: 1,
    title: "No connection",
    brief: "Someone in the office can't reach the file server, though both machines are switched on and their addresses look right.",
    objectives: [
      "Use ARP and the journey to tell a missing path from a wrong address.",
      "Repair the physical or wireless link without changing any address.",
    ],
    kinds: ["ping", "http"],
    locks: [
      { aspect: "addresses", why: "The addresses are correct. This mission is about the path between devices." },
      { aspect: "gateways", why: "Both devices are on the same LAN; no gateway is involved." },
      { aspect: "wifi", devices: ["ap"], why: "Other people use this access point; join its network instead of changing it." },
      { aspect: "routes", why: "No routing is involved on one LAN." },
    ],
    prediction: undefined,
    hints: [
      "Ping the file server, then open the step where the delivery stopped. Which question did the sender ask, and who heard it?",
      "ARP asks “who has this address?” across one LAN. The question only reaches devices with a working link: a cable, an interface that is on, or a joined Wi-Fi network.",
    ],
    variants: [
      {
        id: "cable",
        symptom: "Your PC can't reach the file server at 192.168.1.20.",
        build: () => {
          const n = lanWithServer();
          n.links = n.links.filter((l) => l.b.device !== "server");
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        faults: [{ device: "server", area: "link" }],
        focus: "Look at the file server's connections.",
        cause: "The file server had no cable to the switch, so the PC's ARP question never reached it.",
      },
      {
        id: "port",
        symptom: "Your PC can't reach the file server at 192.168.1.20. Its cable is plugged in.",
        build: () => {
          const n = lanWithServer();
          dev(n, "server").interfaces[0].enabled = false;
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        faults: [{ device: "server", area: "port" }],
        focus: "Look at the file server's interface settings.",
        cause: "The file server's interface was turned off. A disabled interface neither sends nor receives frames, even with a cable attached.",
      },
      {
        id: "switches",
        symptom: "After the desks were moved, Your PC can't reach the file server at 192.168.1.20.",
        build: () => {
          const n = lanWithServer();
          dev(n, "switch").name = "Desk switch";
          const room = add(n, createDevice("switch", "room-switch", 440, 430), "Server-room switch", "Home LAN");
          const server = dev(n, "server");
          Object.assign(server, { x: 710, y: 430 });
          n.links = n.links.filter((l) => l.b.device !== "server");
          link(n, room.id, "p2", "server", "eth0");
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        faults: [
          { device: "switch", area: "link" },
          { device: "room-switch", area: "link" },
        ],
        focus: "Follow the cables from the PC to the file server, switch by switch.",
        cause: "The two switches were not connected to each other, so they formed two separate LANs.",
      },
      {
        id: "wifi",
        symptom: "Your phone can't reach the file server at 192.168.1.20, though the PC on the same network can.",
        build: () => {
          const n = starter("wifi");
          n.name = "Office Wi-Fi";
          const phone = dev(n, "phone");
          Object.assign(phone.interfaces[0], { mode: "static", ip: "192.168.1.30", prefix: 24, gateway: "192.168.1.1" });
          n.links = n.links.filter((l) => l.medium !== "wifi");
          const server = add(n, createDevice("server", "server", 580, 480), "File server", "Home · 192.168.1.0/24");
          Object.assign(server.interfaces[0], { ip: "192.168.1.20", prefix: 24, gateway: "192.168.1.1" });
          link(n, "switch", "p4", "server", "eth0");
          return n;
        },
        probe: { kind: "ping", source: "phone", target: "192.168.1.20", ttl: 64 },
        faults: [{ device: "phone", area: "wifi" }, { device: "phone", area: "link" }],
        focus: "Look at the phone's connections.",
        cause: "The phone had not joined the Wi-Fi network, so it had no link at all.",
      },
    ],
    areas: ["link", "port", "wifi", "address"],
    checks: [
      {
        id: "reach",
        label: "The client pings the file server and the file server replies",
        actions: (_n, v) => [v.probe],
        expect: (events, n) => answeredBy(events, "server", dev(n, "server").name),
        proof: (events) => hasTitle(events, "Create ICMP echo reply", "server"),
      },
    ],
    explanation: {
      prompt: "Why did nothing reach the file server, even though both addresses were correct?",
      options: [
        { id: "path", text: "An address only says where a device is. Frames still need a working link: ARP's broadcast reached only the devices connected to the sender.", correct: true },
        { id: "arp-router", text: "ARP needs a router to answer, and there was no router.", correct: false, misconception: "arp-needs-router" },
        { id: "address-path", text: "Devices with addresses in the same subnet can always reach each other.", correct: false, misconception: "address-is-path" },
        { id: "server-off", text: "The file server ignores pings from devices it has not seen before.", correct: false, misconception: "server-filters" },
      ],
    },
    proved:
      "Your ping crossed a working path: ARP found the server's MAC address, and the request and reply crossed every link between them. Addresses only matter once a link exists.",
  },
  {
    kind: "fix",
    id: "neighbours",
    version: "1.0.0",
    level: 2,
    title: "Neighbours that look remote",
    brief: "Two machines on the same office switch can't talk to each other. Nothing has been unplugged.",
    objectives: [
      "Predict whether a device delivers directly or needs a gateway, from its address and mask.",
      "Make both devices agree on one subnet, without adding equipment.",
    ],
    kinds: ["ping"],
    topologyLocked: "These devices share one switch and are meant to be one LAN; fix it without rewiring or adding a router.",
    locks: [
      { aspect: "gateways", why: "There is no router on this LAN, so a gateway cannot help." },
      { aspect: "routes", why: "There is no router on this LAN, so routes cannot help." },
    ],
    prediction: {
      when: "before-probe",
      prompt: "Before sending anything: when Your PC pings the file server, what will it do first?",
      options: () => [
        { id: "local", text: "Ask on the LAN for the server's MAC address: the server is local" },
        { id: "gateway", text: "Send the packet to its default gateway: the server is remote" },
        { id: "nowhere", text: "Nothing: the server looks remote and there is no gateway to send to" },
      ],
      // Read the PC's actual decision from the engine.
      answer: (n, v) => {
        const events = simulate(n, newSession(), v.probe).events;
        const route = events.find((e) => e.title === "Choose a route" && e.actor === "pc");
        if (!route) return "nowhere";
        return route.facts?.["Next hop"] === route.facts?.Destination ? "local" : "gateway";
      },
      explain: "A device applies its own mask to its own address and to the destination. If the network parts match, it delivers on the LAN; otherwise it needs a gateway.",
    },
    hints: [
      "Ping the server from Your PC, then look at the PC's route decision and where the delivery stopped.",
      "Each device decides with its own address and mask. Two devices on one LAN must agree on the subnet, or one of them treats the other as remote.",
    ],
    variants: [
      {
        id: "pc-mask",
        symptom: "Your PC can't reach the file server at 192.168.1.130.",
        build: () => {
          const n = lanWithServer();
          dev(n, "pc").interfaces[0].prefix = 25;
          dev(n, "server").interfaces[0].ip = "192.168.1.130";
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.130", ttl: 64 },
        faults: [{ device: "pc", area: "mask" }],
        focus: "Compare the subnet each device thinks it is in: open Your PC's IP settings.",
        cause: "Your PC used a /25 mask, so its subnet ended at 192.168.1.127 and the server at .130 looked remote.",
      },
      {
        id: "pc-address",
        symptom: "Your PC can't reach the file server at 192.168.1.20.",
        build: () => {
          const n = lanWithServer();
          dev(n, "pc").interfaces[0].ip = "192.168.10.10";
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        faults: [{ device: "pc", area: "address" }],
        focus: "Compare Your PC's subnet with the file server's: open Your PC's IP settings.",
        cause: "Your PC's address had a typo, 192.168.10.10, which put it in a different subnet from the server.",
      },
      {
        id: "server-mask",
        symptom: "Your PC can't get a reply from the file server at 192.168.1.20.",
        build: () => {
          const n = lanWithServer();
          dev(n, "server").interfaces[0].prefix = 28;
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        faults: [{ device: "server", area: "mask" }],
        focus: "The request may not be the problem. Look at the file server's IP settings and how it decides where to send its reply.",
        cause: "The server used a /28 mask (192.168.1.16–31), so to the server Your PC looked remote and its reply had nowhere to go.",
      },
    ],
    areas: ["address", "mask", "gateway", "link"],
    checks: [
      {
        id: "pc-to-server",
        label: "Your PC pings the file server and gets its reply",
        actions: (n) => [{ kind: "ping", source: "pc", target: ipOf(n, "server"), ttl: 64 }],
        expect: (events, n) => answeredBy(events, "server", dev(n, "server").name),
        proof: (events) => hasTitle(events, "Create ICMP echo reply", "server"),
      },
      {
        id: "same-subnet",
        label: "Both devices use the same subnet and mask",
        actions: (n) => [{ kind: "ping", source: "server", target: ipOf(n, "pc"), ttl: 64 }],
        expect: (_events, n) => {
          const a = dev(n, "pc").interfaces[0],
            b = dev(n, "server").interfaces[0];
          return a.prefix === b.prefix ? null : `The ping works, but the masks still differ (/${a.prefix} and /${b.prefix}). Devices on one LAN must agree on the subnet, or other neighbours will look remote.`;
        },
        proof: (events) => hasTitle(events, "Create ICMP echo reply", "pc"),
      },
    ],
    explanation: {
      prompt: "Why could two devices on the same switch not reach each other?",
      options: [
        { id: "masks", text: "Each device used its own address and mask to decide whether the other was local; one of them concluded the other was remote and had no gateway to use.", correct: true },
        { id: "switch-ip", text: "The switch blocks traffic between different IP addresses.", correct: false, misconception: "switch-routes" },
        { id: "symmetric", text: "If one device can reach the other, the reply always works too.", correct: false, misconception: "symmetric-path" },
        { id: "mask-security", text: "The mask is a password that both devices must share before talking.", correct: false, misconception: "mask-is-secret" },
      ],
    },
    proved:
      "Both devices now agree on one subnet, so each treats the other as local and finds it with ARP. A mask mismatch on either side makes a neighbour look remote, for the request or for the reply.",
  },
  {
    kind: "fix",
    id: "join-and-address",
    version: "1.0.0",
    level: 3,
    title: "Join and get an address",
    brief: "A new phone can't get onto the home network: it has no IP address and can't reach anything.",
    objectives: [
      "Tell joining Wi-Fi apart from getting an address with DHCP.",
      "Find which device should answer the phone's DHCP request, and make the exchange complete.",
    ],
    kinds: ["dhcp", "ping"],
    topologyLocked: "The home network's wiring is fine; fix the configuration.",
    locks: [
      { aspect: "wifi", devices: ["ap"], why: "The access point serves the whole home; join its network rather than changing it." },
      { aspect: "addresses", devices: ["pc", "router"], why: "The PC and router addresses are correct and used by other devices." },
      { aspect: "routes", why: "No routing is involved inside one home LAN." },
      { aspect: "nat", why: "NAT is not involved inside one home LAN." },
    ],
    prediction: {
      when: "before-probe",
      prompt: "Once the phone has a working Wi-Fi link, which device should answer its request for an address?",
      options: () => [
        { id: "router", text: "The home router" },
        { id: "ap", text: "The Wi-Fi access point" },
        { id: "switch", text: "The home switch" },
        { id: "nobody", text: "Nobody on this network" },
      ],
      answer: () => "router",
      explain: "The device that runs a DHCP service answers, whatever box it is. Here that is the home router; the access point only bridges frames between radio and cable.",
    },
    hints: [
      "Send a DHCP request from the phone and open the step where it stopped: was it Wi-Fi or DHCP that failed?",
      "Joining Wi-Fi gives a link; DHCP gives an address. The phone needs both: matching Wi-Fi settings, an interface set to obtain its address automatically, and a DHCP server with a free address.",
    ],
    variants: [
      {
        id: "passphrase",
        symptom: "Your phone can't get an address on the home Wi-Fi.",
        build: () => {
          const n = starter("wifi");
          dev(n, "phone").password = "learn124";
          return n;
        },
        probe: { kind: "dhcp", source: "phone", target: "", ttl: 64 },
        faults: [{ device: "phone", area: "wifi" }],
        focus: "Compare the phone's Wi-Fi settings with the access point's.",
        cause: "The phone's Wi-Fi passphrase did not match the access point's, so it could not join.",
      },
      {
        id: "ssid",
        symptom: "Your phone can't get an address on the home Wi-Fi.",
        build: () => {
          const n = starter("wifi");
          dev(n, "phone").ssid = "Kitab WiFi";
          return n;
        },
        probe: { kind: "dhcp", source: "phone", target: "", ttl: 64 },
        faults: [{ device: "phone", area: "wifi" }],
        focus: "Compare the phone's Wi-Fi settings with the access point's.",
        cause: "The phone was looking for a network with a slightly different name, so it never joined.",
      },
      {
        id: "static",
        symptom: "Your phone joins the home Wi-Fi but never gets an address.",
        build: () => {
          const n = starter("wifi");
          dev(n, "phone").interfaces[0].mode = "static";
          return n;
        },
        probe: { kind: "dhcp", source: "phone", target: "", ttl: 64 },
        faults: [{ device: "phone", area: "mode" }],
        focus: "Look at how the phone's interface obtains its address.",
        cause: "The phone's interface was set to static addressing, so it never asked DHCP.",
      },
      {
        id: "dhcp-off",
        symptom: "Your phone joins the home Wi-Fi but never gets an address. Nothing else changed, except a router settings update last night.",
        build: () => {
          const n = starter("wifi");
          dev(n, "router").dhcp.enabled = false;
          return n;
        },
        probe: { kind: "dhcp", source: "phone", target: "", ttl: 64 },
        faults: [{ device: "router", area: "dhcp" }],
        focus: "Find the device that should answer DHCP and look at its DHCP service.",
        cause: "The router's DHCP service had been switched off, so nothing answered the phone's Discover.",
      },
      {
        id: "pool",
        symptom: "Your phone joins the home Wi-Fi but never gets an address.",
        build: () => {
          const n = starter("wifi");
          Object.assign(dev(n, "router").dhcp, { start: "192.168.2.100", end: "192.168.2.150" });
          return n;
        },
        probe: { kind: "dhcp", source: "phone", target: "", ttl: 64 },
        faults: [{ device: "router", area: "dhcp" }],
        focus: "Find the device that should answer DHCP and compare its address pool with its own subnet.",
        cause: "The router's DHCP pool was in 192.168.2.x, outside its LAN subnet, so it had no address it could lend.",
      },
    ],
    areas: ["wifi", "mode", "dhcp", "address"],
    checks: [
      {
        id: "lease",
        label: "The phone gets an address from the home router",
        actions: () => [{ kind: "dhcp", source: "phone", target: "", ttl: 64 }],
        expect: (events) => {
          const ack = events.find((e) => e.title === "DHCP ACK");
          return ack?.actor === "router" ? null : "The phone's lease must come from the home router, the network's DHCP server.";
        },
        proof: (events) => hasTitle(events, "Apply DHCP lease", "phone"),
      },
      {
        id: "use",
        label: "With that address, the phone reaches Your PC",
        actions: () => [
          { kind: "dhcp", source: "phone", target: "", ttl: 64 },
          { kind: "ping", source: "phone", target: "192.168.1.10", ttl: 64 },
        ],
        expect: (events, n) => answeredBy(events, "pc", dev(n, "pc").name),
        proof: (events) => hasTitle(events, "Create ICMP echo reply", "pc"),
      },
    ],
    explanation: {
      prompt: "What did the phone need, and in what order?",
      options: [
        { id: "both", text: "A Wi-Fi link first (matching network name and passphrase), then a DHCP exchange with a server that has a free address in the LAN's subnet.", correct: true },
        { id: "ap-dhcp", text: "Joining Wi-Fi gives the phone its IP address from the access point.", correct: false, misconception: "ap-assigns-addresses" },
        { id: "any-router", text: "Any router answers DHCP automatically because it is a router.", correct: false, misconception: "router-always-dhcp" },
        { id: "static-faster", text: "A static address set on the phone is collected by DHCP and confirmed.", correct: false, misconception: "dhcp-confirms-static" },
      ],
    },
    proved:
      "The phone joined the Wi-Fi network, then completed Discover, Offer, Request and ACK with the router's DHCP service and used the lease to reach the PC. A link and an address are separate steps.",
  },
  {
    kind: "fix",
    id: "leave-the-lan",
    version: "1.0.0",
    level: 4,
    title: "Leave your LAN",
    brief: "From the office LAN, a server on another network can't be reached. Devices on the same LAN work fine.",
    objectives: [
      "Decide whether a request reached the destination, and whether the reply could return.",
      "Fix how devices and routers find their way between networks.",
    ],
    kinds: ["ping"],
    topologyLocked: "The cabling is correct; this mission is about how traffic finds its way, not where the cables go.",
    locks: [
      { aspect: "addresses", why: "Addresses identify each network. The fix is in how devices find their way between networks." },
      { aspect: "nat", why: "NAT is not part of this network." },
      { aspect: "dhcp", why: "Addresses here are static." },
    ],
    prediction: {
      when: "after-failure",
      prompt: "Your ping failed. Did the echo request reach the server?",
      options: () => [
        { id: "yes", text: "Yes: the request arrived, and the reply did not make it back" },
        { id: "no", text: "No: the request never reached the server" },
      ],
      // Whether the server received the request in this variant's failing run.
      answer: (n, v) =>
        simulate(n, newSession(), v.probe).events.some((e) => e.title === "Create ICMP echo reply" && e.actor === "server") ? "yes" : "no",
      explain: "The journey answers this: look for the server receiving the request. A failed ping only tells you that the reply did not arrive back.",
    },
    hints: [
      "Ping the server, then follow the journey. Did the request reach the server? Which device stopped it, and on which leg?",
      "A device sends traffic for other networks to its gateway; each router needs a route toward the destination; and the reply must find its own way back.",
    ],
    variants: [
      {
        id: "no-gateway",
        symptom: "Your PC can't reach the office server at 192.168.2.20.",
        build: () => {
          const n = starter("routed");
          dev(n, "pc").interfaces[0].gateway = "";
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 },
        faults: [{ device: "pc", area: "gateway" }, { device: "pc", area: "routes" }],
        focus: "Look at how Your PC reaches other networks.",
        cause: "Your PC had no default gateway, so it had nowhere to send traffic for another network.",
      },
      {
        id: "wrong-gateway",
        symptom: "Your PC can't reach the office server at 192.168.2.20.",
        build: () => {
          const n = starter("routed");
          dev(n, "pc").interfaces[0].gateway = "192.168.1.254";
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 },
        faults: [{ device: "pc", area: "gateway" }],
        focus: "Look at how Your PC reaches other networks, and who owns that address.",
        cause: "Your PC's gateway pointed to an address no device uses, so ARP for it went unanswered.",
      },
      {
        id: "server-gateway",
        symptom: "Your PC gets no reply from the office server at 192.168.2.20.",
        build: () => {
          const n = starter("routed");
          dev(n, "server").interfaces[0].gateway = "";
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 },
        faults: [{ device: "server", area: "gateway" }, { device: "server", area: "routes" }],
        focus: "Look at how the office server sends replies to other networks.",
        cause: "The office server had no gateway. The request arrived, but its reply to another network had nowhere to go.",
      },
      {
        id: "router-route",
        symptom: "Your PC can't reach the lab server at 10.0.3.20, two routers away.",
        build: () => {
          const n = starter("routed");
          n.name = "Office and lab";
          const lanB = add(n, createDevice("switch", "lanb", 610, 240), "LAN B switch", "LAN B");
          const r2 = add(n, createDevice("router", "r2", 610, 420), "Lab router", "LAN B");
          Object.assign(r2.interfaces[0], { ip: "192.168.2.2", prefix: 24 });
          Object.assign(r2.interfaces[1], { ip: "10.0.3.1", prefix: 24 });
          r2.routes.push({ network: "0.0.0.0", prefix: 0, via: "192.168.2.1", port: "lan" });
          const server = dev(n, "server");
          Object.assign(server, { name: "Lab server", group: "Lab", x: 860, y: 420 });
          Object.assign(server.interfaces[0], { ip: "10.0.3.20", prefix: 24, gateway: "10.0.3.1" });
          n.links = [];
          link(n, "pc", "eth0", "router", "lan");
          link(n, "router", "wan", "lanb", "p1");
          link(n, "lanb", "p2", "r2", "lan");
          link(n, "r2", "wan", "server", "eth0");
          return n;
        },
        probe: { kind: "ping", source: "pc", target: "10.0.3.20", ttl: 64 },
        faults: [{ device: "router", area: "routes" }],
        focus: "Find the router that dropped the packet and read its routing table.",
        cause: "The office router had no route to the lab network 10.0.3.0/24, which is reached through the lab router.",
      },
    ],
    areas: ["gateway", "routes", "address", "link"],
    checks: [
      {
        id: "routed",
        label: "Your PC pings the server through the router and gets its reply",
        actions: (n) => [{ kind: "ping", source: "pc", target: ipOf(n, "server"), ttl: 64 }],
        expect: (events, n) =>
          answeredBy(events, "server", dev(n, "server").name) ??
          (hasTitle(events, "Decrease TTL", "router") >= 0 ? null : "The reply did not pass through the router."),
        proof: (events) => hasTitle(events, "Create ICMP echo reply", "server"),
      },
    ],
    explanation: {
      prompt: "What has to be true for a ping to another network to succeed?",
      options: [
        { id: "both-ways", text: "Each device needs a way to reach the other network (a gateway or route), every router on the way needs a matching route, and the reply makes its own trip back.", correct: true },
        { id: "router-knows", text: "A router automatically knows every network in the building.", correct: false, misconception: "router-knows-all" },
        { id: "reverse", text: "The reply retraces the request's path automatically, so only the sender's settings matter.", correct: false, misconception: "reply-retraces" },
        { id: "same-subnet", text: "Both devices must be in the same subnet for routing to work.", correct: false, misconception: "routing-needs-same-subnet" },
      ],
    },
    proved:
      "The request left your LAN through its gateway, every router on the way had a route, and the reply found its own way back. Routing works one hop and one direction at a time.",
  },
  {
    kind: "fix",
    id: "bring-reply-home",
    version: "1.0.0",
    level: 5,
    title: "Bring the reply home",
    brief: "At home, your PC can't load a web server by its IP address, 198.51.100.20, so no DNS lookup is involved. The provider says their network is working.",
    objectives: [
      "Explain why replies can't be routed to a private address on the Internet.",
      "Make the home router translate outgoing traffic and route it to the provider, without changing the provider's network.",
    ],
    kinds: ["http", "ping"],
    topologyLocked: "The wiring to the provider is fine; fix the home router.",
    locks: [
      { aspect: "addresses", why: "These are the addresses your provider and the home LAN use; the fix is elsewhere." },
      { aspect: "gateways", devices: ["pc"], why: "The PC's settings are correct." },
      { aspect: "dns", devices: ["pc"], why: "The PC's settings are correct." },
      { aspect: "services", why: "The servers are on the Internet and working." },
      { aspect: "dhcp", why: "Addresses at home are not the problem." },
    ],
    prediction: {
      when: "before-check",
      prompt: "When your page request finally reaches the web server, which source address will it carry?",
      options: (n) => [
        { id: "private", text: ipOf(n, "pc") },
        { id: "public", text: dev(n, "router").interfaces.find((p) => p.id === "wan")!.ip },
        { id: "isp", text: dev(n, "isp").interfaces[0].ip },
        { id: "server", text: ipOf(n, "server") },
      ],
      answer: () => "public",
      explain: "NAT replaces the private source address with the home router's public address, so the server replies to the router, which maps the reply back to your PC.",
    },
    hints: [
      "Load http://198.51.100.20/ and open the step where it stopped. Did a request get out? Did a reply come back?",
      "Private addresses such as 192.168.x.x are not routed on the Internet (RFC 1918). A home router needs a route toward the provider, and NAT to send traffic from its public address.",
    ],
    variants: [
      {
        id: "nat-off",
        symptom: "Your PC can't load http://198.51.100.20/.",
        build: () => {
          const n = starter("internet");
          dev(n, "router").nat = false;
          return n;
        },
        probe: { kind: "http", source: "pc", target: webByIp, ttl: 64 },
        faults: [{ device: "router", area: "nat" }],
        focus: "Look at the home router's Routing & NAT settings.",
        cause: "NAT was off, so packets left with a private source address and the replies could not be routed back.",
      },
      {
        id: "nat-swapped",
        symptom: "Your PC can't load http://198.51.100.20/. NAT is switched on.",
        build: () => {
          const n = starter("internet");
          Object.assign(dev(n, "router"), { inside: "wan", outside: "lan" });
          return n;
        },
        probe: { kind: "http", source: "pc", target: webByIp, ttl: 64 },
        faults: [{ device: "router", area: "nat" }],
        focus: "Look at the home router's Routing & NAT settings: which side is inside?",
        cause: "NAT's inside and outside interfaces were swapped, so outgoing traffic was never translated.",
      },
      {
        id: "no-default",
        symptom: "Your PC can't load http://198.51.100.20/. Devices at home can still reach each other.",
        build: () => {
          const n = starter("internet");
          dev(n, "router").routes = [];
          return n;
        },
        probe: { kind: "http", source: "pc", target: webByIp, ttl: 64 },
        faults: [{ device: "router", area: "routes" }, { device: "router", area: "gateway" }],
        focus: "Find the router that dropped the request and read its routing table.",
        cause: "The home router had no default route, so it did not know where to send traffic for the Internet.",
      },
    ],
    areas: ["nat", "routes", "gateway", "dns", "address"],
    checks: [
      {
        id: "page",
        label: `Your PC loads ${webByIp}`,
        actions: () => [{ kind: "http", source: "pc", target: webByIp, ttl: 64 }],
        expect: (events, n) => answeredBy(events, "server", dev(n, "server").name),
        proof: (events) => hasTitle(events, "Server reads HTTP request", "server"),
      },
      {
        id: "nat",
        label: "The home router translates the request and restores the reply (NAT)",
        actions: () => [{ kind: "http", source: "pc", target: webByIp, ttl: 64 }],
        expect: (events) =>
          hasTitle(events, "Translate source with NAT", "router") >= 0 && hasTitle(events, "Restore reply destination", "router") >= 0
            ? null
            : "The page did not go through NAT on the home router.",
        proof: (events) => hasTitle(events, "Translate source with NAT", "router"),
      },
    ],
    shortcuts: [
      {
        detect: (n) => dev(n, "isp").routes.some((r) => isPrivateRoute(r.network, r.prefix)),
        message: "The ISP router now has a route to a private network. Real providers do not route private addresses (RFC 1918), and you do not control their routers. Remove that route and fix the home router instead.",
      },
    ],
    explanation: {
      prompt: "Why did the page need NAT on the home router?",
      options: [
        { id: "nat", text: "Private addresses are not routed on the Internet, so replies can only come back to the router's public address; NAT records each mapping and restores the private destination.", correct: true },
        { id: "nat-security", text: "NAT encrypts the request so the provider can carry it.", correct: false, misconception: "nat-encrypts" },
        { id: "nat-dns", text: "NAT is what turns kitab.test into an address.", correct: false, misconception: "nat-is-dns" },
        { id: "isp-route", text: "Without NAT, the provider just needs a route to each home's private network.", correct: false, misconception: "isp-routes-private" },
      ],
    },
    proved:
      "Your page left home from the router's public address and came back to it, and the router's NAT table delivered each reply to your PC. Private addresses stay private. You used the server's IP address to test NAT on its own. Starting from a name such as kitab.test adds a separate DNS exchange first; this home's DNS server is on the Internet, so that query needs NAT too. A DNS server inside the home would not.",
  },
  {
    kind: "investigate",
    id: "missing-segment",
    version: "1.0.0",
    level: 6,
    title: "A segment goes missing",
    brief: "A page loads, but slowly: one TCP segment was lost on the way. Find out how TCP recovered it, from the evidence alone.",
    objectives: [
      "Find the retransmission in the journey and identify which bytes were resent.",
      "Work out the acknowledgement that confirms them, from sequence numbers and sizes.",
    ],
    kinds: ["http"],
    topologyLocked: "Nothing needs fixing here; this mission is about reading the evidence.",
    locks: [],
    prediction: {
      when: "before-probe",
      prompt: "One data segment from Your PC will be lost. What will TCP send when its timer runs out?",
      options: () => [
        { id: "same", text: "The same bytes again, with the same sequence number" },
        { id: "next", text: "The next bytes, skipping the lost ones" },
        { id: "all", text: "The whole request again from the start of the connection" },
        { id: "router", text: "Nothing: the router that lost it resends it" },
      ],
      answer: () => "same",
      explain: "TCP resends exactly the unacknowledged bytes with their original sequence numbers. Routers do not keep copies of packets.",
    },
    hints: [
      "Send the request, open the Steps tab and find the retransmission. The Packet tab shows its sequence number and size.",
      "An acknowledgement number is the next byte the receiver expects: the first byte of the segment plus the number of bytes it carried.",
    ],
    variants: [
      {
        id: "short",
        symptom: "Your PC loads a page from the local server, and one segment is lost.",
        build: lanWithServer,
        probe: { kind: "http", source: "pc", target: "http://192.168.1.20/", ttl: 64, dropOnce: true },
        faults: [],
        focus: "In Every event, find “Retransmit TCP segment”, then the first “Acknowledge received bytes” after it.",
        cause: "The first data segment of the request was lost and resent after the timeout.",
      },
      {
        id: "long",
        symptom: "Your PC loads a report from the local server, and one segment of the long request is lost.",
        build: lanWithServer,
        // The request must exceed the engine's 96-byte segment size, so it is sent as two segments.
        probe: { kind: "http", source: "pc", target: "http://192.168.1.20/reports/2026/q3-summary.txt?format=full&sections=sales,costs,forecast", ttl: 64, dropOnce: true },
        faults: [],
        focus: "The request is longer than one 96-byte segment, so TCP sends it in two. Find the retransmission and read how many bytes it carries.",
        cause: "The first of the request's two segments was lost; TCP resent exactly those 96 bytes, then sent the rest of the request.",
      },
      {
        id: "internet",
        symptom: "Your PC loads a page from kitab.test on the Internet, and one segment is lost.",
        build: () => starter("internet"),
        probe: { kind: "http", source: "pc", target: "http://kitab.test/news", ttl: 64, dropOnce: true },
        faults: [],
        focus: "NAT changes ports, not sequence numbers. Find the retransmission and the ACK that confirms it.",
        cause: "The first data segment was lost on its way out of the home; TCP resent it end to end, unchanged by NAT.",
      },
    ],
    question: {
      prompt: "Which acknowledgement number confirms the resent bytes?",
      answer: (events) => {
        const at = events.findIndex((e) => e.title === "Retransmit TCP segment");
        const ack = events.slice(at).find((e) => e.title === "Acknowledge received bytes");
        return Number(ack?.layers.find((l) => l.name === "TCP segment")?.fields.Acknowledgement ?? -1);
      },
      explain: "The resent segment starts at its sequence number and carries a number of bytes; the receiver then expects the byte right after them, and says so in its ACK.",
    },
    evidence: (events) => {
      const at = events.findIndex((e) => e.title === "Retransmit TCP segment");
      if (at < 0) return [];
      const packet = events.slice(at + 1).find((e) => e.packet?.startsWith("ip-"))?.packet;
      return events.flatMap((e, i) => (i === at || (packet && e.packet === packet) ? [i] : []));
    },
    explanation: {
      prompt: "How did the connection recover the lost bytes?",
      options: [
        { id: "timer", text: "No acknowledgement arrived before the sender's timer ran out, so TCP resent the same bytes with the same sequence number; the receiver's ACK then moved past them.", correct: true },
        { id: "router", text: "The router noticed the loss and resent its copy of the packet.", correct: false, misconception: "router-recovery" },
        { id: "restart", text: "TCP restarted the connection with a new handshake.", correct: false, misconception: "tcp-restarts" },
        { id: "count", text: "The ACK number counts how many segments have arrived.", correct: false, misconception: "ack-counts-packets" },
      ],
    },
    proved:
      "You found the retransmission and the acknowledgement that confirmed it: TCP resends exactly the missing bytes, and an ACK names the next byte the receiver expects.",
  },
];

export const findNetworkMission = (id: string) => missions.find((m) => m.id === id);
/** The variant for an attempt number: attempts cycle through every version. */
export const variantFor = (mission: NetworkMission, attempt: number) =>
  mission.variants[(Math.max(1, attempt) - 1) % mission.variants.length];
