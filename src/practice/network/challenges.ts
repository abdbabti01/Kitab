import { starter } from "./starters.ts";
import { sameSubnet } from "./topology.ts";
import type { Network, Action, Trace } from "./model.ts";
type Run = { action: Action; trace: Trace; network: Network };
export type Challenge = {
  id: string;
  title: string;
  purpose: string;
  goal: string;
  hints: string[];
  network: Network;
  action: Action;
  /** Shown on success: the networking rule the learner's run demonstrated. */
  proved: string;
  /** Checks the outcome and evidence of a successful run. Returns why it does not count yet, or null. */
  check: (run: Run) => string | null;
};
export type ChallengeVerdict = {
  status: "passed" | "incomplete" | "failed";
  message: string;
};
const deviceOf = (n: Network, id: string) => n.devices.find((d) => d.id === id);
const nameOf = (n: Network, id: string) => deviceOf(n, id)?.name ?? id;
/** The device whose application answered: the ping target or the web server. */
const responder = (t: Trace) =>
  t.events.find(
    (e) =>
      e.title === "Create ICMP echo reply" ||
      e.title === "Server reads HTTP request",
  )?.actor;
const has = (t: Trace, title: string, actor?: string) =>
  t.events.some((e) => e.title === title && (!actor || e.actor === actor));
function answeredBy(run: Run, id: string) {
  const who = responder(run.trace);
  return who === id
    ? null
    : `${nameOf(run.network, who ?? "")} answered, but this challenge needs a reply from ${nameOf(run.network, id)}.`;
}
export function challenges(): Challenge[] {
  const cable = starter("lan");
  cable.links.pop();
  const mask = starter("lan");
  mask.devices[0].interfaces[0].prefix = 25;
  mask.devices.find((d) => d.id === "server")!.interfaces[0].ip =
    "192.168.1.130";
  const wifi = starter("wifi");
  wifi.devices.find((d) => d.id === "phone")!.password = "";
  const { ssid, password } = deviceOf(wifi, "ap")!; // the network the phone must join
  const routed = starter("routed");
  routed.devices[0].interfaces[0].gateway = "";
  const internet = starter("internet");
  internet.devices.find((d) => d.id === "router")!.nat = false;
  return [
    {
      id: "cable",
      title: "01 · Make a connection",
      purpose:
        "A cable makes a physical path. IP addresses alone cannot connect devices.",
      goal: "Connect the local server to the switch, then ping 192.168.1.20 from Your PC.",
      hints: [
        "Select the switch and open Connections.",
        "Choose a free Ethernet port and the server eth0 port.",
      ],
      network: cable,
      action: { kind: "ping", source: "pc", target: "192.168.1.20" },
      proved:
        "With a cable in place, ARP found the server's MAC address and the echo request and reply crossed the switch. An IP address only matters once a physical path exists.",
      check: (run) => answeredBy(run, "server"),
    },
    {
      id: "subnet",
      title: "02 · Find your neighbors",
      purpose:
        "A subnet is an address block. Your PC uses its mask to decide whether an address is local. Every device on one LAN must use the same subnet; a single device with a different mask is a mask mismatch.",
      goal: "Make 192.168.1.130 local to Your PC, then ping it.",
      hints: [
        "The PC is using /25, which ends at 192.168.1.127. The server uses /24.",
        "Set the PC prefix to /24 so it matches the rest of the LAN. Its local block then reaches 192.168.1.255.",
      ],
      network: mask,
      action: { kind: "ping", source: "pc", target: "192.168.1.130" },
      proved:
        "Your PC and the server now agree on one subnet, so the PC treats 192.168.1.130 as local and asks for its MAC address directly. A mask mismatch on one device made a neighbour look remote. (A LAN deliberately split into /25 subnets is different: every device changes, and a router connects the halves, as in the IP lesson.)",
      check: (run) => {
        const other = answeredBy(run, "server");
        if (other) return other;
        const pc = deviceOf(run.network, "pc")!.interfaces[0],
          server = deviceOf(run.network, "server")!.interfaces[0];
        return pc.prefix === server.prefix &&
          sameSubnet(pc.ip, server.ip, pc.prefix)
          ? null
          : `The ping worked, but the masks still disagree: Your PC uses /${pc.prefix} and the server uses /${server.prefix}. This only works by luck for this one address; with mismatched masks, some neighbours on the same LAN still look remote. Give both devices the same subnet.`;
      },
    },
    {
      id: "wifi",
      title: "03 · Join and get an address",
      purpose:
        "Wi-Fi provides a link. DHCP supplies the IP settings needed to use that link.",
      goal: "Join the home Wi-Fi and request a DHCP lease for Your phone.",
      hints: [
        "The access point has the SSID and passphrase. Copy them into the phone settings.",
        "The starter password is learn123. Keep DHCP selected and run Configure automatically.",
      ],
      network: wifi,
      action: { kind: "dhcp", source: "phone", target: "" },
      proved:
        "The phone joined the access point with the right passphrase, then DHCP gave it an address, mask, gateway and DNS server. Joining Wi-Fi made the link; DHCP made it usable for IP.",
      check: ({ network, trace }) => {
        const ap = deviceOf(network, "ap")!;
        if (ap.ssid !== ssid || ap.password !== password)
          return "The phone got an address, but you changed the access point's Wi-Fi settings instead. The goal is to join the existing network: enter its SSID and passphrase on the phone.";
        return trace.session.leases["phone/wlan0"]?.server === "router"
          ? null
          : "The phone did not receive its lease from the home router's DHCP service.";
      },
    },
    {
      id: "route",
      title: "04 · Leave your LAN",
      purpose:
        "A gateway is the router your device asks to reach another network.",
      goal: "Set the PC gateway and ping the office server at 192.168.2.20.",
      hints: [
        "Your PC is in 192.168.1.0/24. The server is in another subnet.",
        "The router’s LAN address is 192.168.1.1. Use that as the PC gateway.",
      ],
      network: routed,
      action: { kind: "ping", source: "pc", target: "192.168.2.20" },
      proved:
        "192.168.2.20 is outside Your PC's subnet, so the PC handed the packet to the router as its next hop. The router forwarded it, lowered the TTL, and the reply came back the same way.",
      check: (run) =>
        answeredBy(run, "server") ??
        (has(run.trace, "Decrease TTL", "router")
          ? null
          : "The reply did not pass through the router."),
    },
    {
      id: "nat",
      title: "05 · Bring the reply home",
      purpose:
        "NAT replaces an internal address with the router’s external address and remembers how to deliver replies.",
      goal: "Enable NAT on the home router and load http://kitab.test/ from Your PC.",
      hints: [
        "Select Home router and open Routing & NAT.",
        "Enable NAT from lan to wan. Watch the reverse mapping when the response returns.",
      ],
      network: internet,
      action: { kind: "http", source: "pc", target: "http://kitab.test/" },
      proved:
        "The home router replaced your private source address with its public address and saved a mapping. Replies came back to the public address, and the router used the mapping to deliver them to Your PC.",
      check: (run) => {
        const other = answeredBy(run, "server");
        if (other) return other;
        if (
          has(run.trace, "Translate source with NAT", "router") &&
          has(run.trace, "Restore reply destination", "router")
        )
          return null;
        const ispRoute = deviceOf(run.network, "isp")?.routes.some((r) =>
          sameSubnet(r.network, "192.168.1.10", r.prefix),
        );
        return ispRoute
          ? "The page loaded, but only because you gave the ISP router a route to your private network. Real ISPs do not route private addresses (RFC 1918), so this would not work on the Internet. Remove that route and turn on NAT on the home router."
          : "The page loaded, but the home router did not translate it with NAT. Turn on NAT so replies come back to the router's public address.";
      },
    },
    {
      id: "loss",
      title: "06 · A packet goes missing",
      purpose:
        "TCP acknowledges bytes. When an acknowledgement does not arrive, it can resend the missing bytes.",
      goal: "Send an HTTP request with the one-loss experiment and inspect the retransmission.",
      hints: [
        "Enable “Drop one data segment” in the send controls.",
        "Run HTTP and find “Retransmit TCP segment” in the timeline.",
      ],
      network: starter("lan"),
      action: {
        kind: "http",
        source: "pc",
        target: "http://192.168.1.20/",
        dropOnce: false,
      },
      proved:
        "One data segment was lost, so no ACK arrived for it. After the timeout TCP resent the same bytes with the same sequence number, and the receiver delivered the request only once.",
      check: (run) =>
        answeredBy(run, "server") ??
        (has(run.trace, "Drop TCP data segment") &&
        has(run.trace, "Retransmit TCP segment")
          ? null
          : "The page loaded, but no segment was lost, so TCP had nothing to recover. Turn on “Drop one data segment” and send again."),
    },
  ];
}
export function assessChallenge(
  c: Challenge,
  action: Action,
  trace: Trace,
  network: Network,
): ChallengeVerdict {
  if (action.kind !== c.action.kind || action.source !== c.action.source)
    return {
      status: "incomplete",
      message: `This challenge needs ${c.action.kind === "dhcp" ? "a DHCP request" : c.action.kind === "ping" ? "a ping" : "an HTTP request"} from ${nameOf(network, c.action.source)}.`,
    };
  if (!trace.success)
    return {
      status: "failed",
      message: `Not yet: ${trace.summary} Step to the red event in the timeline to see why.`,
    };
  const missing = c.check({ action, trace, network });
  return missing
    ? { status: "incomplete", message: missing }
    : { status: "passed", message: c.proved };
}
