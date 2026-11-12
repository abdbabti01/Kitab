export const technologies = {
  dsl: {
    name: "DSL",
    wire: "Copper telephone pair",
    signal: "Electrical signals",
    terminal: "DSL modem",
    provider: "DSLAM",
    description:
      "Internet data is encoded into electrical signals suited to copper telephone wiring. DSL does not mean dialing a telephone call.",
    receive:
      "A DSLAM (digital subscriber line access multiplexer) receives many homes’ DSL lines. It decodes the signals from your telephone pair and forwards the recovered data into the provider network.",
  },
  cable: {
    name: "Cable",
    wire: "Coaxial cable",
    signal: "Electrical signals",
    terminal: "Cable modem",
    provider: "Cable access network",
    description:
      "Internet data travels over coaxial cable, the kind also used for cable TV. The network may use fiber farther upstream.",
    receive:
      "The cable access network recovers the upstream data. Provider equipment called a CMTS (cable modem termination system), or a newer CCAP, coordinates the cable modems sharing the network. Intermediate nodes are collapsed here.",
  },
  fiber: {
    name: "Fiber",
    wire: "Glass optical fiber",
    signal: "Light signals",
    terminal: "ONT",
    provider: "OLT / fiber network",
    description:
      "Internet data is encoded into light sent through glass fiber. An ONT (optical network terminal) terminates the fiber connection at home.",
    receive:
      "The provider’s OLT (optical line terminal) receives and decodes the light. It connects the homes’ fiber links to the provider network. This example represents a passive optical network; splitters are omitted.",
  },
} as const;
export type AccessTechnology = keyof typeof technologies;
export type LocalTechnology = "wifi" | "ethernet";
export type Stage = {
  id: string;
  title: string;
  where: string;
  why: string;
  result: string;
  focus: number;
  hop?: [number, number];
  direction: "setup" | "out" | "back";
  carrier: string;
  envelope: string;
  payload?: string;
  src?: string;
  dst?: string;
  sourcePort?: number;
  destPort?: number;
};
const client = "192.168.1.100",
  publicIp = "203.0.113.10",
  server = "198.51.100.20";

// A deterministic, deliberately bounded physical-media walkthrough, not a PHY emulator.
// Packet fields follow each boundary. A reply is a new packet, not the request reversed.
export function accessJourney(
  technology: AccessTechnology,
  local: LocalTechnology,
  combined: boolean,
): Stage[] {
  const t = technologies[technology];
  const wifi = local === "wifi";
  const localCarrier = wifi
    ? "Radio waves through air"
    : "Electrical signals in twisted-pair Ethernet";
  const localFrame = wifi ? "Wi-Fi frame" : "Ethernet frame";
  const interconnect = combined
    ? "Internal electronic connection"
    : "Electrical signals in an Ethernet cable";
  const stages: Stage[] = [];
  const add = (
    id: string,
    title: string,
    where: string,
    why: string,
    result: string,
    focus: number,
    carrier: string,
    envelope: string,
    extra: Partial<Stage> = {},
  ) =>
    stages.push({
      id,
      title,
      where,
      why,
      result,
      focus,
      carrier,
      envelope,
      direction: "setup",
      ...extra,
    });
  add(
    "discover",
    wifi ? "Your laptop hears the Wi-Fi network" : "The Ethernet link comes up",
    wifi
      ? "Access point → laptop Wi-Fi chip"
      : "Laptop Ethernet port ↔ built-in switch",
    wifi
      ? "The access point regularly sends radio announcements. Your laptop detects the network name before you connect."
      : "With a cable plugged in, both Ethernet interfaces establish a usable physical link. The access point is not used.",
    wifi
      ? "The network is visible, but the laptop has not joined yet. Hearing an announcement does not assign an IP address."
      : "A physical connection is available. No IP address has been assigned by this step.",
    0,
    localCarrier,
    wifi ? "Wi-Fi management messages" : "Ethernet link signaling",
  );
  if (wifi)
    add(
      "join",
      "Connect to Wi-Fi",
      "Laptop ↔ access point",
      "Your laptop sends radio messages back to join. For a secured home network, the devices establish security using the Wi-Fi credentials.",
      "Both sides can transmit and receive normal protected Wi-Fi traffic. Joining Wi-Fi is different from obtaining an IP address.",
      1,
      localCarrier,
      "Wi-Fi association and security messages",
      { hop: [0, 1] },
    );
  add(
    "dhcp",
    "Get an address automatically",
    "Laptop ↔ DHCP service in home box",
    "The client broadcasts DHCP Discover on the local LAN. The DHCP service offers settings; the client requests them and the server confirms with ACK.",
    `The laptop can use ${client}/24, gateway 192.168.1.1 and DNS 192.168.1.1 in this example. DHCP stays on the home LAN.`,
    1,
    localCarrier,
    `${localFrame} · IPv4 · UDP · DHCP`,
    { hop: [1, 0] },
  );
  add(
    "request",
    "The browser prepares a request",
    "Laptop · browser",
    "You open http://198.51.100.20/hello. An IP address is used directly so this journey can focus on physical connections without a DNS lookup.",
    "The browser prepares HTTP text. It has not yet sent that text over a wire or radio.",
    0,
    "Bytes in application memory",
    "HTTP data",
    { direction: "out", payload: "GET /hello HTTP/1.1" },
  );
  add(
    "tcp",
    "The OS opens a TCP connection",
    "Laptop · socket and TCP",
    "The app asks the OS to connect a socket. SYN, SYN-ACK and ACK cross the same path to establish TCP before HTTP bytes are sent. As the SYN leaves home, the router's NAT records the mapping this connection will use.",
    "The handshake is summarized here. Open the full packet lab to inspect its individual packets, ARP and routing decisions.",
    0,
    "Connection state in OS memory",
    "TCP handshake · summarized",
    { direction: "out" },
  );
  add(
    "wrap",
    "Wrap the HTTP bytes",
    "Laptop · TCP, IP and network interface",
    "TCP adds ports and sequence information. IPv4 adds host addresses. The interface adds a local frame for the next hop.",
    "The data is nested: HTTP inside TCP inside IPv4 inside a local frame. The physical signal will encode these bits.",
    0,
    "Digital data in device memory",
    localFrame,
    {
      direction: "out",
      payload: "GET /hello HTTP/1.1",
      src: client,
      dst: server,
      sourcePort: 51514,
      destPort: 80,
    },
  );
  const out = {
    direction: "out" as const,
    payload: "GET /hello HTTP/1.1",
    src: client,
    dst: server,
    sourcePort: 51514,
    destPort: 80,
  };
  add(
    "local-out",
    wifi ? "Send the frame over radio" : "Send the frame along the cable",
    wifi
      ? "Laptop antenna → access point antenna"
      : "Laptop port → home switch port",
    wifi
      ? "The Wi-Fi chip encodes the frame into a radio transmission. The access point receives it, checks it and decrypts its protected contents."
      : "The Ethernet interfaces encode and decode electrical signals on the copper cable. The switch receives the frame.",
    "The home equipment recovers the data. No tiny packet-shaped object moves through the air or cable; signals represent its bits.",
    1,
    localCarrier,
    localFrame,
    { ...out, hop: [0, 1] },
  );
  add(
    "route",
    "The router chooses the outside connection",
    "Home box · routing and NAT",
    "The destination is outside the home subnet. Routing chooses the WAN interface. NAT changes the source IP and port, using the mapping it recorded when this connection's SYN went out.",
    `Source becomes ${publicIp}:62000. The HTTP text is unchanged. The mapping will bring the reply back to ${client}:51514.`,
    1,
    "Digital data in router memory",
    "New outgoing link frame",
    { ...out, src: publicIp, sourcePort: 62000 },
  );
  const external = { ...out, src: publicIp, sourcePort: 62000 };
  add(
    "handoff",
    `Pass the data to the ${t.terminal}`,
    combined
      ? `Inside the combined home gateway · router → ${t.terminal}`
      : `Home router WAN port → separate ${t.terminal}`,
    combined
      ? "These are separate functions inside one physical box. Internal electronics carry data between them; there is no Wi-Fi link inside the box."
      : "An Ethernet cable connects the router’s WAN port to the modem or ONT. They are separate devices with separate jobs.",
    "Routing chose where to send the packet. The access equipment handles how it is carried over the provider connection.",
    2,
    interconnect,
    combined ? "Internal data handoff" : "Ethernet frame",
    { ...external, hop: [1, 2] },
  );
  add(
    "access-out",
    `Encode data for ${t.name}`,
    `Home ${t.terminal} → provider`,
    t.description,
    t.receive,
    2,
    `${t.signal} · ${t.wire}`,
    `${t.name} access-link encoding`,
    { ...external, hop: [2, 3] },
  );
  add(
    "provider",
    "The provider recovers and forwards the data",
    t.provider,
    t.receive,
    "Access-link framing is removed or translated. IP packets continue through the provider and other networks. Their many links are condensed here.",
    3,
    "Recovered data → onward network links",
    "Provider link framing",
    { ...external },
  );
  add(
    "internet",
    "Across the Internet to the website",
    "Provider networks → web server",
    "Routers forward toward the destination IP. Each link carries data in its own framing and physical signals; the entire Internet is not one DSL, coaxial or fiber line.",
    "The destination network delivers the packet to the server. Intermediate hops and TTL changes are summarized.",
    4,
    "Multiple network links · summarized",
    "Destination link frame",
    { ...external, hop: [3, 4] },
  );
  add(
    "server",
    "The server reads the request",
    "Web server · OS and application",
    "The local frame and IP header are processed. TCP delivers the reassembled bytes through a socket. The server application reads the HTTP request.",
    "The server builds an HTTP response. Its reply has a new IP header and travels back toward the public address it saw.",
    4,
    "Bytes in server memory",
    "HTTP request → response",
    { ...external },
  );
  const reply = {
    direction: "back" as const,
    payload: "HTTP/1.1 200 OK · Hello!",
    src: server,
    dst: publicIp,
    sourcePort: 80,
    destPort: 62000,
  };
  add(
    "reply",
    "The response returns toward your provider",
    "Web server → provider access network",
    "The server sends response bytes through TCP and IP. The return route is selected independently; it need not use the exact same routers.",
    "The provider’s access equipment prepares the data for your home connection.",
    3,
    "Multiple network links · summarized",
    "Provider link framing",
    { ...reply, hop: [4, 3] },
  );
  add(
    "access-back",
    `Return over ${t.wire.toLowerCase()}`,
    `Provider → home ${t.terminal}`,
    `The provider encodes the response using ${t.signal.toLowerCase()}. Your ${t.terminal} receives and decodes them.`,
    "The data is recovered at home. The physical conversion does not itself decide which private device should receive the reply.",
    2,
    `${t.signal} · ${t.wire}`,
    `${t.name} access-link encoding`,
    { ...reply, hop: [3, 2] },
  );
  add(
    "handoff-back",
    "Hand the reply to the router",
    combined
      ? "Inside the combined gateway"
      : `${t.terminal} → router WAN port`,
    combined
      ? "Internal electronics carry the recovered data to the routing function."
      : "The modem or ONT passes the recovered data through the Ethernet connection to the router.",
    "The router can inspect the destination and its existing NAT mapping.",
    1,
    interconnect,
    combined ? "Internal data handoff" : "Ethernet frame",
    { ...reply, hop: [2, 1] },
  );
  add(
    "nat-back",
    "Find the laptop using the NAT mapping",
    "Home box · routing and NAT",
    "The reply targets the public IP and mapped port. The router uses the saved mapping to restore the laptop’s private destination.",
    `Destination becomes ${client}:51514. A new local frame is prepared for the laptop.`,
    1,
    "Digital data in router memory",
    localFrame,
    { ...reply, dst: client, destPort: 51514 },
  );
  add(
    "local-back",
    wifi ? "Send the response over Wi-Fi" : "Send the response over Ethernet",
    wifi ? "Access point → laptop" : "Built-in switch → laptop",
    wifi
      ? "The access point encodes the frame into a new radio transmission. The laptop’s Wi-Fi chip receives, checks and decodes it."
      : "The switch forwards the frame to the laptop’s cable. Its Ethernet interface recovers the bits from the electrical signal.",
    "The laptop’s OS receives the packet and TCP reassembles the response bytes.",
    0,
    localCarrier,
    localFrame,
    { ...reply, dst: client, destPort: 51514, hop: [1, 0] },
  );
  add(
    "done",
    "The browser displays the response",
    "Laptop · browser",
    "The browser reads the response from its socket after the OS has processed IP and TCP.",
    "Hello! The information crossed different physical media, but each receiver recovered the digital data it needed.",
    0,
    "Bytes in application memory",
    "HTTP response",
    { direction: "back", payload: "HTTP/1.1 200 OK · Hello!" },
  );
  return stages;
}

export type BoxRole = { name: string; what: string; does: string[]; not: string; standard?: string };
const terminalWork: Record<AccessTechnology, { what: string; line: string; standard: string }> = {
  dsl: {
    what: "A DSL modem turns the router's data into electrical signals on the copper telephone pair, and turns signals from the line back into data. It works with the DSLAM at the other end of the line, in the provider's exchange or street cabinet.",
    line: "Each home has its own copper pair to the DSLAM. The longer the pair, the weaker the signal, so distance limits the speed.",
    standard: "ITU-T G.992 (ADSL) and G.993 (VDSL2)",
  },
  cable: {
    what: "A cable modem carries data as radio-frequency signals on the coaxial cable network. Homes on the same cable segment share it; the provider's CMTS (or CCAP) decides when each modem may send upstream.",
    line: "The cable segment is shared by the homes connected to it, so busy neighbours share its capacity.",
    standard: "DOCSIS (CableLabs)",
  },
  fiber: {
    what: "An ONT (optical network terminal) converts between light on the fiber and electrical Ethernet signals. In a passive optical network, splitters share one provider fiber among many homes: the OLT sends to all of them, each ONT keeps only its own data, and the OLT tells each ONT when it may send.",
    line: "A passive splitter shares the fiber between homes without power or routing; the OLT schedules who sends when.",
    standard: "ITU-T G.984 (GPON) and G.9807 (XGS-PON)",
  },
};

/** What each box in the connection diagram does, for this technology and home-box layout. */
export function boxRoles(technology: AccessTechnology, combined: boolean): BoxRole[] {
  const t = technologies[technology], work = terminalWork[technology];
  return [
    {
      name: "Your laptop",
      what: "Your device runs the browser and its own TCP/IP software. Its Wi-Fi or Ethernet interface sends every frame to the home router's LAN side.",
      does: ["Gets its private address, gateway and DNS server from the home router's DHCP service.", "Builds the HTTP request, TCP segments and IP packets."],
      not: `It never talks to the ${t.terminal} directly; all of its traffic goes through the home router.`,
    },
    {
      name: "Home router",
      what: combined
        ? `One box with several jobs: a Wi-Fi access point, an Ethernet switch, the router, a DHCP server, NAT, and here also the ${t.terminal}. They are separate functions even when they share a box.`
        : `One box with several jobs: a Wi-Fi access point, an Ethernet switch, the router, a DHCP server and NAT. Its WAN port connects by an Ethernet cable to the separate ${t.terminal}.`,
      does: [
        "Routes packets between your home network and the provider's network.",
        "Gives home devices private addresses (DHCP) and shares one public address among them (NAT).",
        "Joins Wi-Fi and wired devices into one home LAN (access point and switch).",
      ],
      not: `It does not turn data into the ${t.wire.toLowerCase()} signal; that is the ${t.terminal}'s job${combined ? ", even inside the same box" : ""}.`,
    },
    {
      name: t.terminal,
      what: work.what,
      does: [
        work.line,
        `It is the provider's end of the access line in your home; the provider often supplies and manages it.`,
        combined
          ? "Here it is built into the home gateway and receives the router's data internally."
          : "Here it is a separate box: the router's WAN port sends it Ethernet frames over a cable.",
      ],
      not: "It does not route, hand out addresses or translate them with NAT; it changes how the bits travel on the access line. The router does those other jobs.",
      standard: work.standard,
    },
    {
      name: "Your provider",
      what: `The provider's access equipment (${t.provider}) receives the lines from many homes and passes their data into the provider's IP network, whose routers forward it toward the Internet.`,
      does: ["Gives your home router its public address.", "Routes traffic between your home and the rest of the Internet."],
      not: "It never sees your laptop's private address: the home router's NAT replaced it with the public address.",
    },
    {
      name: "Web server",
      what: "The server runs the web service that answers the request.",
      does: ["Receives the request from your home router's public address.", "Sends its reply to that public address; the home router's NAT passes it to your laptop."],
      not: "It does not know your laptop's private address or which box carried the signal.",
    },
  ];
}
