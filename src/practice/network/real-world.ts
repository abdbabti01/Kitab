// Where each device's settings live in a real network, and who sets them, for the Network Playground's inspector.
// Keyed by DeviceKind (a test keeps it complete). Snippets are representative of one technology; others differ.
import type { DeviceKind } from "./model.ts";
import type { Example } from "../../architecture/real-world.ts";

export type RealDevice = { where: { setting: string; place: string }[]; who: string; example?: Example };

const osIp = { setting: "IP address, prefix length, gateway, DNS server", place: "The operating system's network settings (Windows: Settings › Network & internet; macOS: System Settings › Network; Linux: NetworkManager or netplan). Normally filled in automatically by DHCP; typed in by hand mostly for servers and routers." };

export const realDevices: Record<DeviceKind, RealDevice> = {
  pc: {
    where: [osIp],
    who: "The person using the computer, or an IT administrator for work computers.",
    example: { label: "Representative: a fixed address on Ubuntu Linux (netplan)", code: "network:\n  version: 2\n  ethernets:\n    eth0:\n      addresses: [192.168.1.20/24]\n      routes:\n        - to: default\n          via: 192.168.1.1\n      nameservers:\n        addresses: [192.168.1.1]" },
  },
  phone: {
    where: [{ setting: "Wi-Fi name and passphrase", place: "The phone's Settings › Wi-Fi, when joining a network." }, osIp],
    who: "The phone's owner; on work phones, often a device-management profile.",
  },
  switch: {
    where: [{ setting: "Nothing to set", place: "A simple (unmanaged) switch learns which device is on which port by itself. Managed switches add VLANs and per-port settings through a web page or command line, which Kitab doesn't model." }],
    who: "Nobody for an unmanaged switch; the network administrator for a managed one.",
  },
  router: {
    where: [
      { setting: "Interface addresses, static routes, NAT", place: "The router's own configuration: a web admin page on home routers, a command line on enterprise routers, route tables in a cloud network." },
      { setting: "DHCP and DNS services", place: "Often built into home routers; in larger networks, separate servers (for example ISC Kea for DHCP, BIND or Unbound for DNS)." },
    ],
    who: "Whoever runs the network: the household, a network administrator, or the internet provider for its own routers.",
    example: { label: "Representative: Cisco IOS, a LAN interface with NAT and a default route", code: "interface GigabitEthernet0/0\n ip address 192.168.1.1 255.255.255.0\n ip nat inside\ninterface GigabitEthernet0/1\n ip nat outside\nip route 0.0.0.0 0.0.0.0 203.0.113.1" },
  },
  ap: {
    where: [{ setting: "Wi-Fi name (SSID) and passphrase", place: "The access point's admin page. At home the access point is usually built into the router; offices manage many access points from one controller." }],
    who: "The household or the network administrator.",
  },
  server: {
    where: [
      { ...osIp, place: "The server's operating system network settings, usually a fixed address so others can find it." },
      { setting: "HTTP service on port 80", place: "The web server software's configuration (nginx, Apache httpd, or the application itself), plus the operating system's firewall allowing the port." },
      { setting: "DHCP and DNS services", place: "The DHCP or DNS server software's configuration files." },
    ],
    who: "The server's administrators or the team that runs the service.",
    example: { label: "Representative: nginx answering on port 80", code: "server {\n  listen 80;\n  location / { return 200 \"Hello from the server\"; }\n}" },
  },
};
