import {
  isBridge,
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
    "NAT is enabled on this router; it is not a step every router must perform. It does not change the HTTP content.",
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

// Why each deterministic failure happens and which rule caused it. The event's own message names the devices.
const failureLessons: Record<FailureReason, Lesson> = {
  DNS_SERVER_ADDRESS: lesson(
    "The client sent its DNS question to the DNS server address in its settings, but no device in this network has that address.",
    "Nothing can answer, so the name is never turned into an IP address and the request cannot start.",
    "Rule: a client only asks the DNS server it is configured with. Fix the client's DNS server setting (or the DHCP server's advertised DNS), not the DNS records.",
  ),
  DNS_UNREACHABLE: lesson(
    "The DNS server exists, but the query could not be delivered to it. The problem is the path, not DNS.",
    "The lookup stops before any DNS server sees the question.",
    "Rule: DNS travels in ordinary IP packets, so it needs the same cables, routes, gateway and ARP as any other traffic. Fix the connectivity problem named above.",
  ),
  DNS_NO_SERVICE: lesson(
    "The query reached the device at the configured DNS address, but that device does not run a DNS service.",
    "No program is listening on UDP port 53, so the question goes unanswered. Adding records to the wrong device would not fix the client's setting.",
    "Rule: an address only identifies an interface; a service must be running there to answer. In this lab a device runs DNS when it has at least one DNS record. Real hosts usually send an ICMP “port unreachable” error, which is not modeled.",
  ),
  DNS_NO_RECORD: lesson(
    "A working DNS server received the question and answered: it has no A record for this name.",
    "The client now knows the name does not exist (NXDOMAIN), so it cannot find an IP address to connect to.",
    "Rule: reaching a DNS server is not enough; it must have a record for the exact name. Check the spelling or add the A record on that DNS server.",
  ),
  DNS_REPLY_UNREACHABLE: lesson(
    "The DNS server received the question and replied, but the reply could not travel back to the client.",
    "The client never receives the answer. Both directions must work, and the reply makes its own routing decisions.",
    "Rule: every reply is a new packet addressed to the original sender. If the sender's address cannot be reached from the server's side, for example a private address without NAT, the reply is lost.",
  ),
  NO_ROUTE_PRIVATE: lesson(
    "A router outside the home network received a packet for a private address (such as 192.168.x.x) and has no route to it.",
    "The router discards the packet. Private addresses are reused in many homes, so the Internet cannot route to them.",
    "Rule (RFC 1918): private addresses are not routed on the Internet. A home router uses NAT to send traffic from its public address, so replies come back to that address. Adding a static route on the ISP to your private network would hide the problem, not fix it.",
  ),
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
    const failure = event.reason && failureLessons[event.reason];
    return failure
      ? { ...failure, audience, outcome: `${event.explanation} ${failure.outcome}`, message }
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
  };
}
