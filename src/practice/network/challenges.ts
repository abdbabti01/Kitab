import { starter } from "./starters.ts";
import type { Network, Action, Trace } from "./model.ts";
export type Challenge = {
  id: string;
  title: string;
  purpose: string;
  goal: string;
  hints: string[];
  network: Network;
  action: Action;
};
export function challenges(): Challenge[] {
  const cable = starter("lan");
  cable.links.pop();
  const mask = starter("lan");
  mask.devices[0].interfaces[0].prefix = 25;
  mask.devices.find((d) => d.id === "server")!.interfaces[0].ip =
    "192.168.1.130";
  const wifi = starter("wifi");
  wifi.devices.find((d) => d.id === "phone")!.password = "";
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
    },
    {
      id: "subnet",
      title: "02 · Find your neighbors",
      purpose:
        "A subnet is an address block. Your PC uses its mask to decide whether an address is local.",
      goal: "Make 192.168.1.130 local to Your PC, then ping it.",
      hints: [
        "The PC is using /25, which ends at 192.168.1.127.",
        "Set the PC prefix to /24. Its local block then reaches 192.168.1.255.",
      ],
      network: mask,
      action: { kind: "ping", source: "pc", target: "192.168.1.130" },
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
        dropOnce: true,
      },
    },
  ];
}
export function challengePassed(
  c: Challenge,
  a: Action,
  t: Trace,
  n: Network,
): boolean {
  if (
    !t.success ||
    a.kind !== c.action.kind ||
    a.source !== c.action.source ||
    a.target !== c.action.target
  )
    return false;
  if (c.id === "nat")
    return (
      n.devices.some((d) => d.id === "router" && d.nat) &&
      t.events.some((e) => e.title === "Restore reply destination")
    );
  if (c.id === "loss")
    return (
      !!a.dropOnce && t.events.some((e) => e.title === "Retransmit TCP segment")
    );
  return true;
}
