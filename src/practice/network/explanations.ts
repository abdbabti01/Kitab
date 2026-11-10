import {
  isBridge,
  type Failure,
  type FailureReason,
  type Network,
  type TraceEvent,
} from "./model.ts";

export type StepExplanation = {
  why: string;
  audience: string;
  outcome: string;
  detail: string;
  message: string;
  /** A modeling simplification the learner must not mistake for how real networks behave. */
  note?: { text: string; href: string; label: string };
  /** For a stopped delivery: the explained reason and the chain of failures that caused it. */
  failure?: FailureInfo & { chain: ReturnType<typeof failureChain> };
};
type Lesson = Pick<StepExplanation, "why" | "outcome" | "detail">;
const lesson = (why: string, outcome: string, detail: string): Lesson => ({
  why,
  outcome,
  detail,
});

// Each entry explains one operation, not just the protocol it belongs to.
const lessons: Record<string, Lesson> = {
  "ARP: discover the next-hop MAC": lesson(
    "The sender knows the next hop’s IP address, but a local frame also needs that device’s MAC address. It asks everyone on this LAN who owns that IP.",
    "The device with the requested IP can answer. The sender must wait for that answer before addressing its data frame.",
    "For a remote website, the PC asks for its gateway’s MAC, not the website’s MAC. ARP stays on the local LAN.",
  ),
  "ARP reply": lesson(
    "This device owns the IP address that was asked about, so it returns its MAC address to the requester.",
    "The requester can learn which MAC address to put on the next-hop frame.",
    "Receiving an ARP broadcast does not mean every device answers. Only the owner answers in this model.",
  ),
  "ARP cache hit": lesson(
    "The sender already remembers a MAC address for this next-hop IP. It can reuse that mapping instead of asking the LAN again.",
    "No new ARP broadcast is needed. The simulator still checks that a physical path exists.",
    "An ARP cache is a local table of IP-to-MAC mappings. A saved mapping cannot repair a disconnected cable.",
  ),
  "Save ARP mapping": lesson(
    "The reply supplied the missing MAC address, so the requester saves the IP-to-MAC mapping for later traffic.",
    "The ARP table now contains the mapping shown in this step.",
    "This is a local memory update, not another packet sent on the network.",
  ),
  "DNS query": lesson(
    "The application has a name such as kitab.test, but IP needs a numeric address. The resolver prepares a question for the configured DNS server.",
    "The question is ready to travel to DNS. It does not fetch the web page.",
    "This simulation asks for an A record (an IPv4 address) using UDP port 53. The DNS server may be on another network, so reaching it can require routing and ARP first.",
  ),
  "DNS answer": lesson(
    "The DNS reply has returned to the client with an address for the requested name.",
    "The client saves the answer in its DNS cache and can use the address for its next network operation.",
    "DNS resolves the name. The subsequent HTTP connection is a separate exchange with the web server.",
  ),
  "DNS cache hit": lesson(
    "The client has already looked up this name and remembers the answer.",
    "It reuses the saved IP address without sending a new DNS query.",
    "This simulator keeps the answer for the session. DNS cache expiry is not modeled.",
  ),
  "Choose a route": lesson(
    "IP must decide which interface and next hop can move this packet toward its destination.",
    "The most specific matching route selects the outgoing interface and next-hop IP shown above.",
    "A local destination can be reached directly. A destination on another network needs a router, often the default gateway. The return packet makes its own route choices.",
  ),
  "Decrease TTL": lesson(
    "A router is forwarding the packet, so it reduces its hop budget. This prevents packets from circulating forever.",
    "The IPv4 header now has the displayed TTL. If it reaches zero, the packet is discarded.",
    "TTL means Time To Live. In this model it counts router hops; switches and access points do not reduce it.",
  ),
  "Translate source with NAT": lesson(
    "This router is sending LAN traffic through its outside interface. NAT replaces the internal source address and port with an outside mapping.",
    "The packet’s source fields change, and the NAT table records how a matching reply can find the internal device.",
    "NAT is enabled on this router; it is not a step every router must perform. It changes addresses and ports in the headers, not the application data inside.",
  ),
  "Restore reply destination": lesson(
    "A reply arrived at the router’s outside address. Its NAT table identifies the internal device that started this exchange.",
    "The router restores the internal destination IP and port before routing the reply toward the LAN.",
    "The reply is not for the router’s browser. The router is translating and forwarding it on behalf of the original client.",
  ),
  "Deliver IP payload": lesson(
    "This device owns the packet’s destination IP, so IP hands the contents to the protocol named in the header.",
    "TCP, UDP or ICMP can now process the payload. Receiving an IP packet does not yet mean the browser has read it.",
    "For TCP and UDP, port numbers help select the correct receiving socket. ICMP is processed directly by the network stack.",
  ),
  "Wrap in a link frame": lesson(
    "The packet needs a local envelope for the next link. The interface uses the next-hop MAC address to prepare that frame.",
    "The IPv4 packet will travel inside an Ethernet or Wi-Fi frame to the next hop.",
    "At a router, an incoming link envelope is removed and a new one is made for the next link. The remote IP destination need not be the next-hop device.",
  ),
  "Learn source MAC": lesson(
    "The switch or access point notices which port the sender’s frame arrived on.",
    "Its MAC table now associates the source MAC with that port, helping it forward future replies.",
    "It learns from the source MAC, not the destination IP. Learning a MAC does not assign an IP address.",
  ),
  "Forward broadcast on LAN": lesson(
    "A broadcast is meant to reach the local LAN, so the bridge copies it to other eligible links.",
    "More local devices can receive the same message; the bridge does not create a new application request.",
    "The arrival link is excluded. Routers do not carry these local broadcasts into other networks in this model.",
  ),
  "Forward using MAC table": lesson(
    "This bridge already knows which port leads toward the destination MAC.",
    "It chooses that port instead of copying the frame to every eligible port.",
    "A switch forwards using link-layer addresses. It does not choose a route by the packet’s destination IP.",
  ),
  "Unknown MAC: flood eligible ports": lesson(
    "The bridge does not yet know where the destination MAC is, so it sends copies through other eligible ports.",
    "The intended receiver can accept its copy; other endpoints discard a frame addressed to a different MAC.",
    "Flooding an unknown unicast does not turn it into a broadcast: the destination MAC remains unchanged.",
  ),
  "Discard frame for another MAC": lesson(
    "A flooded copy reached this device, but the destination MAC belongs to someone else.",
    "The interface discards this copy. It does not pass it to IP or send an application response.",
    "Being physically connected to the same switch does not make every message yours.",
  ),
  "Create socket and connect": lesson(
    "The application asks the operating system for a way to communicate with the server.",
    "The app receives a socket reference; the OS keeps the connection’s buffers and TCP state.",
    "A socket is an OS-managed communication object accessed through an API. It is not a protocol or another wrapper added to the packet.",
  ),
  "TCP SYN": lesson(
    "The client asks the server to begin a TCP connection and announces its starting sequence number.",
    "The SYN is prepared for the server’s listening port. The client waits for the server’s response.",
    "SYN is a flag in the TCP header. Here it carries no HTTP data and consumes one sequence number.",
  ),
  "TCP SYN-ACK": lesson(
    "The server acknowledges the client’s SYN and announces its own starting sequence number.",
    "The SYN-ACK is prepared for the client. The client will acknowledge it to complete the handshake.",
    "The server replies to the client’s source port, not another web server on port 80. Each direction has its own sequence numbers.",
  ),
  "TCP connection established": lesson(
    "The handshake has completed, so both endpoints have the connection state needed to exchange bytes.",
    "The TCP state is ESTABLISHED and the application can send the prepared HTTP request.",
    "Preparing HTTP text and transmitting it are different operations. This simulation prepares the request before connecting, then sends it after the handshake.",
  ),
  "Write application bytes": lesson(
    "The application hands its message bytes to the socket so the OS can transmit them.",
    "Those bytes enter the socket’s send buffer. A successful local write is not proof they have arrived at the other PC.",
    "The app handles the meaning of HTTP. TCP and IP handle transport and addressing below it.",
  ),
  "Create TCP segment": lesson(
    "TCP packages part of the byte stream with ports and sequence information so the receiver can identify, order and acknowledge it.",
    "A TCP header wraps the displayed application bytes. They are ready for IP.",
    "This model uses up to 96 payload bytes per segment. One HTTP message may span several segments; segment boundaries are not message boundaries.",
  ),
  "Create IPv4 packet": lesson(
    "TCP identifies the applications, but IP needs host addresses to carry this segment across networks.",
    "An IPv4 header wraps the TCP segment with source, destination, protocol and TTL.",
    "The HTTP bytes remain inside TCP, which remains inside IP. Adding a header does not replace the inner data.",
  ),
  "Drop TCP data segment": lesson(
    "The loss experiment intentionally discards this transmission so you can observe how TCP recovers.",
    "These bytes do not arrive, so the receiver cannot acknowledge them. The sender must wait for its modeled timeout.",
    "IP does not guarantee delivery. TCP tracks acknowledgements to detect that recovery may be needed.",
  ),
  "Retransmit TCP segment": lesson(
    "The sender’s timer expired without an acknowledgement for these bytes, so TCP tries again.",
    "The same bytes are resent with the same sequence numbers, not counted as new application data.",
    "Real TCP has more detailed timing and congestion rules. Duplicate bytes are recognized using sequence numbers.",
  ),
  "Acknowledge received bytes": lesson(
    "The receiver tells the sender how far the byte stream has arrived in order.",
    "The ACK number is the next byte position expected. Its reply can let the sender release acknowledged bytes.",
    "An ACK confirms receipt by TCP; it does not prove the server application has already read or acted on the request.",
  ),
  "Prepare HTTP request": lesson(
    "The browser turns the URL into a message the web server can understand: what resource is requested and which host it belongs to.",
    "The HTTP request text is prepared locally. It has not been transmitted yet.",
    "The OS does not invent the HTTP request. The app prepares it, then uses a socket to send it once TCP is ready.",
  ),
  "Server reads HTTP request": lesson(
    "TCP has reassembled the incoming bytes and made them available to the server’s socket.",
    "The server application reads the HTTP method and path and can decide what response to build.",
    "Routers along the way forwarded packets; the server application interprets the HTTP request.",
  ),
  "Build HTTP response": lesson(
    "The web server has read the request and prepares the content the client asked for.",
    "A status line, headers and body are built locally, ready to travel back through TCP, IP and the links.",
    "Content-Length counts body bytes. The return trip uses the same connection but reverses the sender and receiver roles.",
  ),
  "Read reassembled response": lesson(
    "The response bytes have arrived through TCP and are available to the client application.",
    "The client reads the HTTP response and displays the body as text in this simulation.",
    "The interface received frames, IP received packets, TCP reassembled bytes, and only then did the app read the response.",
  ),
  "HTTP journey complete": lesson(
    "The response has arrived and this example closes the connection because it requested Connection: close.",
    "The FIN/ACK exchange is finished; the client retains a simplified TIME-WAIT state.",
    "Real HTTP connections can be reused. This example closes one connection per request to make the whole journey visible.",
  ),
  "Create ICMP echo request": lesson(
    "Ping asks an IP endpoint to return an echo so you can check connectivity.",
    "An ICMP request is prepared for the target IP. It does not open a TCP connection.",
    "ICMP travels directly inside IP. A successful ping does not prove that a web server is running.",
  ),
  "Create ICMP echo reply": lesson(
    "The destination received the echo request, so it creates an answer addressed back to the sender.",
    "The reply is ready for its own route lookup and return trip.",
    "Reaching the destination is only half the test. The reply must also have a working route back.",
  ),
  "Ping complete": lesson(
    "The echo reply has returned to the requester.",
    "Both the outward and return paths worked for this ICMP exchange.",
    "This checks IP connectivity, not HTTP, DNS correctness or whether a particular TCP port accepts connections.",
  ),
  "Associate with Wi-Fi": lesson(
    "The wireless device needs to join an access point before exchanging frames on this LAN.",
    "The SSID and password match in this model, so the wireless link can carry traffic.",
    "Joining Wi-Fi does not itself assign an IP address. DHCP can provide network settings afterward. Radio physics are not simulated.",
  ),
  "Apply DHCP lease": lesson(
    "The DHCP ACK has reached the client that asked for it. That confirmation is what allows the client to use the offered address.",
    "The client's interface now has the leased IP address, subnet prefix, gateway and DNS server. The Tables tab shows the new lease from this step on.",
    "Until this step the client keeps its previous settings (none on a first request), even while the ACK is travelling. An Offer alone is not permission to use an address.",
  ),
  "Configuration complete": lesson(
    "The client now has permission to use the leased address and has the settings needed to send IP traffic.",
    "The acquired settings remain available for later traffic in this session.",
    "The subnet identifies local addresses. The gateway handles other networks. DNS looks up names. Restarting this simulation clears acquired settings.",
  ),
  "DHCP lease expired": lesson(
    "The permitted time for this leased IP address has ended.",
    "The expired assignment is removed. Run DHCP again to obtain valid settings before sending more traffic.",
    "Real DHCP clients normally try to renew before expiry. This simulation uses the DHCP action for renewal.",
  ),
};

const dhcpLessons: Record<string, Lesson> = {
  Discover: lesson(
    "The client needs network settings and does not know where the DHCP server is. It asks everyone on its local LAN.",
    "A DHCP server on this LAN can choose an available address to offer. Ordinary PCs do not answer.",
    "0.0.0.0 is used because the initial client has no usable IP. 255.255.255.255 means a local broadcast. A router does not carry it to another LAN without a DHCP relay; relays are not modeled here.",
  ),
  Offer: lesson(
    "The DHCP server proposes an available address. It responds because its DHCP service is enabled, not simply because it is a router.",
    "The requesting client can choose the offer. The address is not yet confirmed for use.",
    "A home router often runs DHCP, but a separate server can provide the same service. This simulator chooses one reachable DHCP server.",
  ),
  Request: lesson(
    "The client asks to use the offered address and announces which offer it selected.",
    "The chosen server can confirm the lease. Other DHCP servers can see which offer was selected.",
    "This initial Request is broadcast. Later renewal can use a direct request to the server; this model repeats the initial exchange.",
  ),
  ACK: lesson(
    "The DHCP server confirms that the requesting client may use the address for a limited lease time.",
    "Nothing changes on the client yet. When this ACK reaches it, the client applies the address, subnet prefix, gateway and DNS settings.",
    "A lease is permission to use an address for a period of time. Only the requesting client should apply these settings.",
  ),
};

/** How a failure is explained: what failed, why, the rule, where the rule comes from, and where to look. */
export type FailureInfo = {
  title: string;
  why: string;
  rule: string;
  /** The standard and section that states the rule, checked against its text. */
  source?: string;
  /** Where to investigate. Points at devices and settings; it does not hand over a challenge's answer. */
  check: string;
  /** How real networks differ from this lab here. */
  real?: string;
};
const failure = (
  title: string,
  why: string,
  rule: string,
  source: string | undefined,
  check: string,
  real?: string,
): FailureInfo => ({ title, why, rule, source, check, real });
const noIcmpUnreachable =
  "A real router would also send an ICMP Destination Unreachable message back to the sender (RFC 1812 §5.2.7.1). This lab does not model ICMP errors.";

// One entry per reason. The event's own message names the devices and values involved.
export const failures: Record<FailureReason, FailureInfo> = {
  INPUT_SOURCE: failure(
    "Choose a sending device",
    "Only a PC, phone, router or server can start traffic here. Switches and access points pass frames along; in this lab they never start a conversation.",
    "Traffic starts at a device with an IP address of its own.",
    undefined,
    "Choose a different device in the From menu.",
  ),
  INPUT_URL: failure(
    "Not a web address",
    "The destination could not be read as an http:// URL or an IPv4 address.",
    "An HTTP URL names a host and an optional path, such as http://kitab.test/.",
    "RFC 9110 §4.2.1",
    "Correct the address in the To field.",
  ),
  INPUT_PORT: failure(
    "Only http:// on port 80",
    "This lab models plain HTTP on TCP port 80. https:// would need TLS encryption, which is not modeled, and another port would need a server listening on it.",
    "An http URL without a port uses TCP port 80.",
    "RFC 9110 §4.2.1",
    "Use an http:// address without a port number.",
  ),
  INVALID_NETWORK: failure(
    "A device setting is invalid",
    "The network breaks a rule the simulator checks before sending anything, such as an address that cannot be used by a host.",
    "Each interface needs a valid host address for its subnet.",
    undefined,
    "Correct the device setting named above.",
  ),
  SIMULATION_LIMIT: failure(
    "Too many steps",
    "The simulation stops after 10,000 events so the page stays responsive.",
    "This is a limit of the lab, not of networks.",
    undefined,
    "Use a shorter page body or a simpler network.",
  ),
  WIFI_NOT_JOINED: failure(
    "Not connected to Wi-Fi",
    "The phone has no Wi-Fi link to an access point, so it cannot send any frame.",
    "A wireless device must join an access point before it can exchange data on that network.",
    "IEEE 802.11 (association)",
    "Select the phone and look at its connections.",
  ),
  WIFI_SSID_NOT_FOUND: failure(
    "Wrong Wi-Fi network name",
    "The phone is set to join a network name (SSID) that the access point it is linked to does not offer.",
    "A device joins the network whose name it is configured for.",
    "IEEE 802.11 (SSID)",
    "Compare the network name on the phone with the one on the access point.",
    "A real phone scans and lists every network in range. Here each Wi-Fi link leads to exactly one access point.",
  ),
  WIFI_WRONG_PASSPHRASE: failure(
    "Wrong Wi-Fi passphrase",
    "The network name matches, but the phone's passphrase is not the access point's, so the phone is not allowed to join.",
    "With WPA2 or WPA3 Personal, both sides must hold the same passphrase; otherwise the key handshake fails and no data can be exchanged.",
    "IEEE 802.11 (RSNA 4-way handshake)",
    "Compare the passphrase on the phone with the one on the access point.",
    "This lab compares the two passphrases directly. It does not model the key handshake or encryption.",
  ),
  NO_ADDRESS: failure(
    "No IP address",
    "The sending interface has no IPv4 address, so there is no source address to put in the packet.",
    "Every IPv4 packet a host sends carries one of the host's own addresses as its source.",
    "RFC 1122 §3.2.1.3",
    "Select the sender and look at its IP settings, or at its DHCP lease in the Tables tab.",
  ),
  DUPLICATE_IP: failure(
    "Two devices share one IP address",
    "Two interfaces on the same LAN use the same IPv4 address, so an ARP question for it has two possible owners.",
    "An IPv4 address must identify one interface on its network; ARP maps it to exactly one MAC address.",
    "RFC 826; RFC 5227",
    "Compare the IP addresses of the devices on this LAN.",
    "Real hosts detect conflicts by probing with ARP (RFC 5227) and stop using the address. This lab stops before sending.",
  ),
  ARP_NO_OWNER: failure(
    "Nobody uses the next-hop address",
    "The sender broadcast an ARP request asking who uses the next-hop address. No device in this network uses it, so no reply came back.",
    "ARP only finds the MAC address of a device on the same LAN that owns the requested IP address.",
    "RFC 826",
    "Look at the setting that chose this next hop on the sending device: its default gateway or a static route.",
    `A real sender retries ARP a few times before giving up. ${noIcmpUnreachable}`,
  ),
  ARP_NO_PATH: failure(
    "The next hop cannot be reached on this LAN",
    "A device does use the next-hop address, but the ARP broadcast cannot reach it at the link layer, so it never hears the question.",
    "An ARP broadcast stays on one LAN: it crosses cables, switches and joined Wi-Fi, but not routers.",
    "RFC 826",
    "Follow the cables and Wi-Fi links between the two devices, and check whether a router separates them.",
    `A real sender retries ARP a few times before giving up. ${noIcmpUnreachable}`,
  ),
  SWITCH_STALE_MAC: failure(
    "A switch remembers the wrong port",
    "The switch's MAC table says the destination is behind a port that no longer leads to it, so the frame goes the wrong way.",
    "A switch sends a frame for a known MAC address only out of the port where it learned that address. It floods only unknown addresses.",
    "IEEE 802.1Q (learning process and filtering database)",
    "Restart the simulation to clear the learned tables.",
    "Real switches forget entries after an ageing time (300 seconds by default) and relearn when the device sends again. This lab keeps entries for the session.",
  ),
  NO_GATEWAY: failure(
    "Destination outside the subnet, and no gateway",
    "The destination is outside the sender's subnet, so it is not local. A host sends non-local packets to its default gateway, and none is set.",
    "A host compares the destination with its own address and mask. If the destination is not on a connected network, the packet must go to a gateway.",
    "RFC 1122 §3.3.1.1",
    "Compare the destination with the sender's address and prefix. Should the destination be local, or does the sender need a gateway?",
  ),
  GATEWAY_NOT_LOCAL: failure(
    "Gateway not on the local network",
    "The default gateway address is outside the sender's own subnet, so the sender cannot hand the packet to it directly.",
    "A host sends a non-local packet to a gateway on one of its connected networks.",
    "RFC 1122 §3.3.1",
    "Compare the gateway address with the sender's address and prefix.",
  ),
  ROUTER_NO_ROUTE: failure(
    "The router has no route",
    "No entry in the router's routing table matches the destination: no connected network, static route or default route.",
    "A router forwards a packet using the longest matching prefix in its routing table. With no match it discards the packet.",
    "RFC 1812 §5.2.4.3",
    "Open the router's routing table in the Tables tab.",
    noIcmpUnreachable,
  ),
  NO_ROUTE_PRIVATE: failure(
    "No route to a private address",
    "A router outside the home network received a packet for a private address (such as 192.168.x.x) and has no route to it. Private addresses are reused in many homes, so the Internet cannot route to them.",
    "Private addresses are not routed on the Internet. A home router uses NAT to send traffic from its public address, so replies come back to that address. A static route on the ISP to your private network would hide the problem, not fix it.",
    "RFC 1918 §3",
    "Follow the reply back toward the home network: which address does it need to reach?",
    noIcmpUnreachable,
  ),
  NOT_A_ROUTER: failure(
    "A host was asked to forward",
    "A route sent the packet to a host as if it were a router. The packet is not addressed to that host, and hosts do not forward other devices' packets.",
    "A host must silently discard a datagram that is not addressed to it.",
    "RFC 1122 §3.2.1.3",
    "Find the route whose next hop is this device.",
  ),
  TTL_EXPIRED: failure(
    "Hop limit reached",
    "Each router lowers the TTL by one before forwarding. It reached zero before the packet arrived, so the router discarded it.",
    "A router decreases the TTL of every packet it forwards and must discard a packet whose TTL reaches zero, so packets cannot circulate forever.",
    "RFC 791 §3.2; RFC 1812 §5.3.1",
    "Count the routers on the path and compare that with the starting TTL.",
    "A real router also sends an ICMP Time Exceeded message to the sender (RFC 1812 §5.3.1); traceroute relies on it. This lab does not model ICMP errors.",
  ),
  ROUTING_LOOP: failure(
    "Routing loop",
    "Routers kept passing the packet between them, each one sending it toward the other, until the TTL ran out.",
    "Each router's route for a destination must lead closer to it. TTL stops a looping packet but does not fix the loop.",
    "RFC 1812 §5.3.1",
    "Read the routing tables of the routers in the loop.",
    "A real router also sends an ICMP Time Exceeded message to the sender. This lab does not model ICMP errors.",
  ),
  NAT_NO_MAPPING: failure(
    "No NAT mapping for an incoming packet",
    "A packet arrived at the router's public address, but it does not belong to any connection started from inside, so NAT has no inside device to send it to.",
    "Traditional NAT creates a mapping when an inside device sends out, and admits only packets that match a mapping. New incoming connections need a static mapping (port forwarding).",
    "RFC 3022 §2; RFC 4787 §5",
    "Who started this connection: a device inside the home network, or one outside?",
    "Port forwarding is not modeled in this lab.",
  ),
  DHCP_CLIENT_STATIC: failure(
    "Interface not set to DHCP",
    "DHCP configures an interface that is set to obtain its settings automatically. This interface uses static settings.",
    "A DHCP client asks for its address; a statically configured interface does not.",
    "RFC 2131 §3.1",
    "Select the device and look at its addressing mode.",
  ),
  DHCP_NO_SERVER: failure(
    "No DHCP server on this LAN",
    "A DHCP Discover is a broadcast on the client's own LAN, and no device on that LAN has a DHCP server enabled on the interface it would arrive at.",
    "The client broadcasts DHCPDISCOVER on its local network. Without a relay agent, it does not reach servers on other networks.",
    "RFC 2131 §3.1",
    "Which device should run DHCP on this LAN, and is it enabled on the right interface?",
    "This lab stops before sending the Discover. A real client would broadcast it, retry, and eventually give up. DHCP relays are not modeled.",
  ),
  DHCP_POOL_INVALID: failure(
    "DHCP pool range is invalid",
    "The pool's last address comes before its first, or the range is larger than this lab allows.",
    "A DHCP server lends addresses from a configured range.",
    undefined,
    "Look at the DHCP pool settings on the server.",
  ),
  DHCP_POOL_EMPTY: failure(
    "DHCP pool has no free address",
    "Every address in the pool is outside the server's subnet or already used on this LAN, so there is nothing to offer.",
    "A server offers an unused address from its pool that belongs to the client's subnet.",
    "RFC 2131 §4.3.1",
    "Compare the pool range with the server's subnet and with the addresses already in use.",
    "A real server simply does not answer; the client does not learn why.",
  ),
  DHCP_LEASE_EXPIRED: failure(
    "DHCP lease expired",
    "The sender's address was leased for a limited time, and the lease ended during this transfer, so it may no longer use that address.",
    "When a lease expires without renewal, the client must immediately stop using the address and start DHCP again.",
    "RFC 2131 §4.4.5",
    "Look at the lease time on the DHCP server and the length of the transfer.",
    "A real client tries to renew at half the lease time. This lab renews only when you run DHCP.",
  ),
  DNS_NOT_CONFIGURED: failure(
    "No DNS server set",
    "The destination is a name, so the client must ask a DNS server for its address, but it has no DNS server address.",
    "A host's resolver turns names into addresses by asking the name servers it is configured with.",
    "RFC 1034 §5",
    "Look at the sender's DNS setting, or the DNS server its DHCP lease provides.",
  ),
  DNS_SERVER_ADDRESS: failure(
    "Nobody has the DNS server address",
    "The client sent its DNS question to the DNS server address in its settings, but no device in this network has that address.",
    "A client only asks the DNS server it is configured with. Fix the client's DNS server setting (or the DHCP server's advertised DNS), not the DNS records.",
    "RFC 1034 §5",
    "Compare the client's DNS server setting with the addresses of the devices in this network.",
  ),
  DNS_UNREACHABLE: failure(
    "The DNS server cannot be reached",
    "The DNS server exists, but the query could not be delivered to it. The problem is the path, not DNS.",
    "DNS travels in ordinary IP packets, so it needs the same cables, routes, gateway and ARP as any other traffic.",
    "RFC 1035 §4.2.1",
    "The cause listed under “Caused by” names the device and the step where the path broke.",
  ),
  DNS_NO_SERVICE: failure(
    "That address does not run DNS",
    "The query reached the device at the configured DNS address, but that device does not run a DNS service.",
    "An address only identifies an interface; a service must be running there to answer. DNS queries go to UDP port 53. In this lab a device runs DNS when it has at least one DNS record.",
    "RFC 1035 §4.2.1",
    "Is the client's DNS server setting the address of a DNS server?",
    "A real host usually answers with an ICMP Port Unreachable error, which is not modeled.",
  ),
  DNS_NO_RECORD: failure(
    "The name does not exist",
    "A working DNS server received the question and answered: it has no A record for this name (NXDOMAIN).",
    "Reaching a DNS server is not enough; it must have a record for the exact name. NXDOMAIN is the Name Error response code.",
    "RFC 1035 §4.1.1",
    "Check the spelling of the name, and the records on that DNS server.",
  ),
  DNS_REPLY_UNREACHABLE: failure(
    "The DNS answer could not come back",
    "The DNS server received the question and replied, but the reply could not travel back to the client.",
    "Every reply is a new packet addressed to the original sender. If the sender's address cannot be reached from the server's side, for example a private address without NAT, the reply is lost.",
    "RFC 1122 §3.3.1",
    "The cause listed under “Caused by” names where the reply stopped.",
  ),
  REPLY_NO_PATH: failure(
    "The request arrived, but the reply could not return",
    "The destination received the request and answered. The answer is a new packet addressed back to the sender, and its own routing failed on the way back.",
    "Each direction is routed independently: the destination chooses its own gateway and routes for the reply, so both paths must work.",
    "RFC 1122 §3.3.1",
    "Follow the reply from the destination: its gateway, the routers' routes and any NAT on the way.",
  ),
  REPLY_MISDELIVERED: failure(
    "The reply reached the wrong device",
    "The reply was delivered to another device that uses the sender's address.",
    "An address must identify one interface wherever packets for it are routed.",
    undefined,
    "Look for another device using the sender's address.",
  ),
  HTTP_NO_LISTENER: failure(
    "No web server on port 80",
    "The TCP SYN reached the server, but no application listens on port 80, so a connection cannot be opened.",
    "TCP opens a connection only to a port where an application is listening.",
    "RFC 9293 §3.10.7.1",
    "Select the server and look at its web service setting.",
    "A real host answers a SYN to a closed port with a TCP reset (RST) straight away. This lab stops at the server instead.",
  ),
};
/** The failure and every failure that caused it, outermost first. */
export function failureChain(f: Failure | undefined, network: Network) {
  const chain: { reason: FailureReason; title: string; device: string; message: string }[] = [];
  for (let at = f; at; at = at.cause)
    chain.push({
      reason: at.reason,
      title: failures[at.reason].title,
      device: network.devices.find((d) => d.id === at!.device)?.name ?? at.device,
      message: at.message,
    });
  return chain;
}

// The playground's TCP is stop-and-wait; the send-window mission teaches the real behavior.
const stopAndWait = {
  text: "Simplification: this lab sends one data segment and waits for its ACK before sending the next, so the timeline stays readable. Real TCP keeps several segments in flight at once, up to the receive and congestion windows.",
  href: "/missions/tcp-send-window",
  label: "Practice: how many segments can real TCP have in flight?",
};
const tcpNotes: Record<string, StepExplanation["note"]> = {
  "Create TCP segment": stopAndWait,
  "Acknowledge received bytes": stopAndWait,
  "Retransmit TCP segment": stopAndWait,
};

export function explainStep(
  event: TraceEvent,
  network: Network,
): StepExplanation {
  const deviceName = (id: string) =>
    network.devices.find((d) => d.id === id)?.name ?? id;
  const actor = network.devices.find((d) => d.id === event.actor);
  const name = deviceName(event.actor);
  const ip = event.layers.find((l) => l.kind === "network");
  const transport = event.layers.find((l) => l.kind === "transport");
  const app = event.layers.find((l) => l.kind === "application");
  const frame = event.layers.find(
    (l) => l.name === "Ethernet frame" || l.name === "Wi-Fi frame",
  );
  const isBroadcast =
    frame?.fields["Destination MAC"] === "ff:ff:ff:ff:ff:ff" ||
    ip?.fields["Destination IP"] === "255.255.255.255";
  let audience = event.hop
    ? `${deviceName(event.hop.from)} → ${deviceName(event.hop.to)} on this link. A next hop can differ from the final recipient.`
    : `Inside ${name} · ${event.location}.`;
  if (ip) audience += ` IP destination: ${ip.fields["Destination IP"]}.`;
  const message =
    [
      app?.name ?? event.layers.find((l) => l.name.startsWith("ARP"))?.name,
      app && !app.name.startsWith("DHCP ")
        ? Object.entries(app.fields)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" · ")
        : undefined,
      app?.name.startsWith("DHCP ") && app.payload ? app.payload : undefined,
      transport
        ? `${transport.name}: port ${transport.fields["Source port"]} → ${transport.fields["Destination port"]}`
        : undefined,
      ip
        ? `IP ${ip.fields["Source IP"]} → ${ip.fields["Destination IP"]}`
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ") ||
    "No new packet fields at this step. The description above shows the local operation.";
  if (event.error) {
    const info = event.reason && failures[event.reason];
    return info
      ? {
          why: info.why,
          audience,
          outcome: `Delivery stops here. ${info.check}`,
          detail: `Rule: ${info.rule}${info.real ? ` ${info.real}` : ""}`,
          message,
          failure: { ...info, chain: failureChain(event.failure, network) },
        }
      : {
          why: "A required condition for delivery is missing, so the simulator stops here.",
          audience,
          outcome: event.explanation,
          detail:
            "Inspect the highlighted device and the last successful event. Correct the configuration and send again.",
          message,
        };
  }

  if (app?.name.startsWith("DHCP ") && event.dhcpContext) {
    const { client, server } = event.dhcpContext;
    const phase = String(app.fields.Message);
    const requesting = phase === "Discover" || phase === "Request";
    const origin = requesting ? client : server;
    const intended = requesting ? server : client;
    const phaseLesson = dhcpLessons[phase];
    let explanation =
      phaseLesson ??
      lesson(
        event.explanation,
        "Continue to inspect the next event.",
        "DHCP supplies network configuration.",
      );
    const bridge = actor && isBridge(actor);
    if (event.title === "Receive frame") {
      explanation = bridge
        ? lesson(
            `${name} received a broadcast. Its job is to carry the same message onward on this LAN, not to answer the DHCP question.`,
            "The bridge can forward the broadcast through its other eligible links.",
            "Switches and access points connect devices at the link layer. They do not choose the client’s IP address in this model.",
          )
        : requesting
          ? event.actor === server
            ? lesson(
                `${name} received the local broadcast and runs the DHCP service selected in this simulation. That is why it can answer.`,
                phase === "Discover"
                  ? "Its DHCP server can choose an address to offer."
                  : "Its DHCP server can confirm the requested lease.",
                "The service could run on a router or a separate server. Being a router alone is not enough; DHCP must be enabled.",
              )
            : lesson(
                `${name} received a copy because this is a broadcast to the local LAN. It is not the DHCP server handling this exchange, so it does not answer.`,
                "This device does not assign an address or change its own IP settings.",
                "Every reachable local device may see a broadcast, but only the relevant service processes it. This model chooses one DHCP server even if more than one is enabled.",
              )
          : event.actor === client
            ? lesson(
                `${name} is the client that asked for configuration. The server’s reply is relevant to this client, even though it was broadcast.`,
                phase === "Offer"
                  ? "The client can request the offered address; it must wait for ACK before using it."
                  : "The confirmed settings can now be used by this client.",
                "Real DHCP matches replies to the client and transaction. A broadcast delivery does not give the same address to every PC.",
              )
            : lesson(
                `${name} sees this broadcast too, but the DHCP reply belongs to ${deviceName(client)}. It must not take that client’s address.`,
                "This device ignores the reply for configuration purposes; its own settings do not change.",
                "A broadcast describes how a message is delivered, not who is allowed to act on its contents.",
              );
    } else if (event.title === "Learn source MAC")
      explanation = lessons[event.title];
    else if (event.title === "Forward broadcast on LAN")
      explanation = lesson(
        "This is a broadcast frame, so the bridge copies it to other eligible links on the same LAN.",
        "More local devices can receive the same DHCP message. The bridge is not creating another DHCP request.",
        "The bridge excludes the arrival link. Routers do not forward this local broadcast into another IP network in this model.",
      );
    else if (event.hop)
      explanation = lesson(
        `${deviceName(event.hop.from)} is ${event.hop.from === origin ? "sending" : "forwarding"} this DHCP ${phase} on one link. It is part of a local broadcast, not a private request to every PC.`,
        `${deviceName(event.hop.to)} will receive this copy. Receiving it does not automatically mean answering it.`,
        "The animation shows one link at a time. The broadcast also travels on other eligible links in the same LAN.",
      );
    audience = `${audience} DHCP ${phase}: ${deviceName(origin)} → local LAN; ${requesting ? "server handling it" : "intended client"}: ${deviceName(intended)}.`;
    return {
      ...explanation,
      audience,
      message,
      detail: `${explanation.detail} DHCP uses UDP ports 68 (client) and 67 (server). Server replies are broadcast in this model; real replies can also be unicast.`,
    };
  }

  let explanation = lessons[event.title];
  if (event.title.startsWith("Transmit over"))
    explanation = lesson(
      "The interface sends the prepared frame across this link so the next device can receive it.",
      `The frame is on its way to ${event.hop ? deviceName(event.hop.to) : "the next device"}. It may still need more hops to reach the IP destination.`,
      "Ethernet uses a cable and Wi-Fi uses radio. This simulator shows logical delivery, not electrical signals or radio propagation.",
    );
  if (event.title === "Receive frame")
    explanation =
      actor && isBridge(actor)
        ? lesson(
            "This bridge receives a frame so it can forward it within the LAN.",
            "It processes the link header; it does not deliver the contained HTTP message to a browser.",
            "The destination MAC determines forwarding. IP routing happens at a router, not this bridge.",
          )
        : lesson(
            "This interface received a frame it can accept. The link envelope has done its job for this hop.",
            "It removes the link header and passes the payload to the indicated protocol. IP will determine whether to deliver or forward an IP packet.",
            "A router can receive a frame addressed to its own MAC while the packet inside is addressed to a remote server.",
          );
  // An ARP broadcast reaching an unrelated PC is another common source of confusion.
  const arp = event.layers.find((l) => l.name === "ARP request");
  if (event.title === "Receive frame" && arp && actor && !isBridge(actor)) {
    const target = String(arp.fields["Who has"]);
    const owns = actor.interfaces.some(
      (p) =>
        (event.snapshot.leases[`${actor.id}/${p.id}`]?.ip ?? p.ip) === target,
    );
    explanation = owns
      ? lesson(
          `This device owns ${target}, the IP named in the ARP question. It can answer with its MAC address.`,
          "An ARP reply can give the requester the missing next-hop MAC.",
          "The broadcast reached everyone locally, but this device is the owner being asked for.",
        )
      : lesson(
          `This PC or device sees the ARP broadcast, but the requested IP ${target} is not its address.`,
          "It does not answer this ARP question or change its settings.",
          "Broadcast delivery means everyone can hear the question, not that everyone should respond.",
        );
  }
  return {
    ...(explanation ??
      lesson(
        event.explanation,
        "Inspect the selected snapshot for the state at this step.",
        "The packet inspector shows actual values from this event.",
      )),
    audience:
      audience + (isBroadcast ? " This frame is a local broadcast." : ""),
    message,
    note: tcpNotes[event.title],
  };
}
