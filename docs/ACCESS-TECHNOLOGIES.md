# Home connection explorer

Route: `/practice/connections`, linked from Home and Network playground.

Learners choose two independent connections: DSL/cable/fiber into the home and Wi-Fi/copper Ethernet from the laptop to the home equipment. A layout switch puts the modem or ONT inside the same gateway or in a separate box connected by Ethernet. The functions stay distinct in either layout.

The journey covers joining the LAN, initial DHCP, request preparation, the summarized TCP handshake, encapsulation, local transmission, routing/NAT, provider access, server processing and the response. Each step identifies the location, explains why it happens, and shows the result. Manual stepping, phase jumps and a timeline pause playback. Opening the equipment definitions also pauses playback.

## Model and teaching boundaries

- `src/practice/network/access.ts` builds deterministic stages for all 12 combinations. It has no side effects and sends no network traffic.
- `src/practice/AccessExplorer.tsx` renders the controls, topology, active equipment, physical carrier and nested packet inspector.
- `src/practice/access.css` uses Kitab’s paper/green palette and type treatment, with a horizontally scrollable topology on small screens and reduced-motion support.
- Radio, electrical signals and light represent bits; the moving dot is a teaching marker, not a physical packet-shaped object. Waveforms are illustrative and do not encode actual modulation.
- Example addresses use documentation ranges for public hosts. NAT changes the outgoing source IP/port and restores the private destination on the response. HTTP content survives these transformations; the response is a new message.
- The HTTP destination is an IP literal, so no DNS lookup is needed in this example. HTTP is unencrypted to keep the data visible. Request/response snippets are abbreviated, not complete wire captures.
- Initial DHCP is summarized on the home LAN. Existing leases, renewal and static configuration are not animated. Provider provisioning is assumed complete.
- TCP control packets, ARP, intermediate Internet routers and TTL changes are summarized. The full network playground remains the detailed protocol simulator.
- DSL uses a telephone pair and DSL modem/DSLAM; cable uses coax to the home and may use fiber upstream; the fiber example is a PON with ONT/OLT and omitted splitters. These represent common arrangements, not every provider installation. No throughput or latency comparison is implied.

## Verification

The unit tests cover all 12 connection/layout combinations, NAT in both directions, payload preservation, initial configuration ordering, return-path direction and route registration. The Playwright spec checks selector resets, the signal inspector, response ports, playback pause and page overflow across the configured viewports.

Browser review checked DSL/cable/fiber switching, Ethernet versus Wi-Fi, separate equipment, request/response addressing, end-of-journey reset and pause-on-reading. A desktop screenshot is in `previews/access-technologies.png`. Local automated browser execution is unavailable in the current environment because Chromium cannot create its required sockets; the added Playwright spec is typechecked but has not been run here. Mobile rendering still needs a browser run.

## Sources

- [FCC fixed technology codes](https://help.bdc.fcc.gov/hc/en-us/articles/5290793888795-Fixed-Technology-Codes): copper DSL, coaxial/HFC and fiber access technologies.
- [Cisco: What is an access point?](https://www.cisco.com/site/us/en/learn/topics/small-business/what-is-an-access-point.html): access-point and wireless-router roles.
