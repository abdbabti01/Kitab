import {
  createDevice,
  type Network,
  type Device,
  type Medium,
  type Action,
} from "./model.ts";
/** What a starter shows first: each step's action is loaded into the send form with its note, in order. */
export type StarterStep = { action: Action; note: string };
export const starterOptions: { id: string; name: string; detail: string; steps?: StarterStep[] }[] = [
  {
    id: "internet",
    name: "A request across the Internet",
    detail: "Wi-Fi → home LAN → ISP → website",
    steps: [
      {
        action: { kind: "dhcp", source: "phone", target: "" },
        note: "Step 1 of 2: your phone is not on the network yet and has no IP address. Press “Configure automatically” to join the Wi-Fi network and get an address from the home router's DHCP service. A real phone does both by itself when you choose the network.",
      },
      {
        action: { kind: "http", source: "phone", target: "http://kitab.test/", ttl: 64 },
        note: "Step 2 of 2: your phone now has an IP address, a gateway and a DNS server from DHCP. Press “Send request” to load http://kitab.test/: DNS finds the server's address (this DNS server answers from its own records; a real resolver may first ask other DNS servers), then TCP and HTTP carry the page through your home router and the provider's router.",
      },
    ],
  },
  {
    id: "lan",
    name: "Your first LAN",
    detail: "Two computers and a switch",
    steps: [
      {
        action: { kind: "ping", source: "pc", target: "192.168.1.20", ttl: 64 },
        note: "Press “Send request” to ping the local server at 192.168.1.20. It is on your PC's own network, so your PC first uses ARP to learn the server's MAC address; the switch then delivers each frame to the right port.",
      },
    ],
  },
  {
    id: "wifi",
    name: "A wireless home",
    detail: "Join Wi-Fi and ask DHCP for an address",
    steps: [
      {
        action: { kind: "dhcp", source: "phone", target: "" },
        note: "Press “Configure automatically”: your phone joins the Wi-Fi network at the access point, then asks the home router's DHCP service for an IP address. A real phone does both by itself when you choose the network.",
      },
    ],
  },
  {
    id: "routed",
    name: "Two connected LANs",
    detail: "Discover gateways and routing",
    steps: [
      {
        action: { kind: "ping", source: "pc", target: "192.168.2.20", ttl: 64 },
        note: "Press “Send request” to ping the office server at 192.168.2.20. It is outside your PC's subnet, so your PC sends the packet to its default gateway, the router, which forwards it to the other LAN.",
      },
    ],
  },
  {
    id: "empty",
    name: "An empty canvas",
    detail: "Build your own network from scratch",
  },
];
export function starter(id: string): Network {
  const n: Network = {
    version: 1,
    name: starterOptions.find((s) => s.id === id)?.name ?? "My network",
    devices: [],
    links: [],
  };
  const add = (
    kind: Device["kind"],
    id: string,
    name: string,
    x: number,
    y: number,
    group: string,
  ) => {
    const d = createDevice(kind, id, x, y);
    d.name = name;
    d.group = group;
    n.devices.push(d);
    return d;
  };
  const ip = (d: Device, port: string, ip: string, prefix = 24, gateway = "") =>
    Object.assign(
      d.interfaces.find((p) => p.id === port)!,
      { ip, prefix, gateway },
    );
  const link = (
    a: Device,
    ap: string,
    b: Device,
    bp: string,
    medium: Medium = "ethernet",
  ) =>
    n.links.push({
      id: `l${n.links.length}`,
      a: { device: a.id, port: ap },
      b: { device: b.id, port: bp },
      medium,
    });
  if (id === "empty") return n;
  if (id === "lan") {
    const pc = add("pc", "pc", "Your PC", 170, 250, "Home LAN"),
      sw = add("switch", "switch", "Switch", 440, 250, "Home LAN"),
      s = add("server", "server", "Local server", 710, 250, "Home LAN");
    ip(pc, "eth0", "192.168.1.10");
    ip(s, "eth0", "192.168.1.20");
    link(pc, "eth0", sw, "p1");
    link(sw, "p2", s, "eth0");
    return n;
  }
  if (id === "routed") {
    const pc = add("pc", "pc", "Your PC", 160, 240, "LAN A"),
      r = add("router", "router", "Router", 450, 240, "Gateway"),
      s = add("server", "server", "Office server", 760, 240, "LAN B");
    ip(pc, "eth0", "192.168.1.10", 24, "192.168.1.1");
    ip(r, "lan", "192.168.1.1");
    ip(r, "wan", "192.168.2.1");
    ip(s, "eth0", "192.168.2.20", 24, "192.168.2.1");
    link(pc, "eth0", r, "lan");
    link(r, "wan", s, "eth0");
    return n;
  }
  const phone = add(
    "phone",
    "phone",
    "Your phone",
    120,
    200,
    "Home · 192.168.1.0/24",
  );
  phone.interfaces[0].mode = "dhcp";
  const ap = add(
    "ap",
    "ap",
    "Wi-Fi access point",
    340,
    200,
    "Home · 192.168.1.0/24",
  );
  const sw = add(
    "switch",
    "switch",
    "Home switch",
    340,
    400,
    "Home · 192.168.1.0/24",
  );
  const pc = add("pc", "pc", "Your PC", 120, 400, "Home · 192.168.1.0/24");
  ip(pc, "eth0", "192.168.1.10", 24, "192.168.1.1");
  pc.interfaces[0].dns = "198.51.100.53";
  const router = add(
    "router",
    "router",
    "Home router",
    580,
    300,
    "Home · 192.168.1.0/24",
  );
  ip(router, "lan", "192.168.1.1");
  router.dhcp.enabled = true;
  link(phone, "wlan0", ap, "wlan0", "wifi");
  link(ap, "eth0", sw, "p1");
  link(pc, "eth0", sw, "p2");
  link(sw, "p3", router, "lan");
  if (id === "wifi") {
    // This home has no Internet link, so the router answers DNS for the LAN, as it tells DHCP clients. Like many home
    // routers it knows names for devices at home; home.arpa is the domain reserved for home networks (RFC 8375).
    pc.interfaces[0].dns = "192.168.1.1";
    router.dhcp.dns = "192.168.1.1";
    router.records = { "pc.home.arpa": "192.168.1.10" };
    return n;
  }
  const isp = add("router", "isp", "ISP router", 830, 300, "ISP · routed WAN");
  ip(router, "wan", "203.0.113.2", 30);
  ip(isp, "lan", "203.0.113.1", 30);
  ip(isp, "wan", "198.51.100.1");
  router.routes.push({
    network: "0.0.0.0",
    prefix: 0,
    via: "203.0.113.1",
    port: "wan",
  });
  router.nat = true;
  link(router, "wan", isp, "lan");
  const remote = add(
    "switch",
    "remote",
    "Datacenter switch",
    1070,
    300,
    "Internet services",
  );
  link(isp, "wan", remote, "p1");
  const server = add(
    "server",
    "server",
    "kitab.test",
    1300,
    190,
    "Internet services",
  );
  ip(server, "eth0", "198.51.100.20", 24, "198.51.100.1");
  link(remote, "p2", server, "eth0");
  const dns = add(
    "server",
    "dns",
    "DNS server",
    1300,
    410,
    "Internet services",
  );
  ip(dns, "eth0", "198.51.100.53", 24, "198.51.100.1");
  dns.records = { "kitab.test": "198.51.100.20" };
  dns.web.enabled = false;
  link(remote, "p3", dns, "eth0");
  return n;
}
