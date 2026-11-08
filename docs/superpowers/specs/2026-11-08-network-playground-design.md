# Kitab Network Playground

Design for review · 8 November 2026

## Intent and agreed direction

Add a visual networking practice zone to Kitab. A beginner builds a network, understands each setting, and follows data from an application through the operating system and network to its destination and back. The user explicitly chose both free building and guided challenges. They want draggable devices, LAN/WAN/Internet construction, visible configuration, packet encapsulation, Wi-Fi/Ethernet travel, close-ups inside devices, and a polished, easy-to-manipulate experience.

Simple explanations are a primary requirement. Each concept must answer “What is it?”, “Why do we use it?”, and “What does that mean in this network?” Technical values must come from the current simulation.

## Approaches

1. Sandbox alone offers maximum freedom but leaves beginners without a starting point.
2. Guided exercises alone offer a clear progression but limit experimentation.
3. **Selected with the user: one shared sandbox with starter networks and guided challenges.** Challenges add goals and hints to the same editable canvas. Opening a challenge in free-build mode preserves the network.

Implementation recommendation: extend Kitab's React/TypeScript application with a local deterministic simulation engine and a dedicated practice route. This is a builder recommendation, not a technology requirement stated by the user. Native browser rendering, shared design tokens, and existing test tools fit the project. No real traffic or paid service is required.

## Scope of the first complete release

The first release delivers a complete round trip across multiple editable networks, plus guided exercises using the same engine. It includes:

- PC, phone, switch, router, access point, web server, and an expandable simulated ISP/Internet starter group.
- Ethernet connections and explicit Wi-Fi association. A home-network template combines a router, access point, and switch visibly rather than conflating their jobs.
- Per-interface IPv4 addresses and masks, default gateway, DNS settings, static routes, DHCP address assignment, NAT/PAT, ARP and switch forwarding tables.
- Ping and HTTP/1.1 over TCP. DNS A-record lookup over UDP for hostname requests.
- Visible TCP handshake, request segmentation, acknowledgements, response reassembly, and connection close. A bounded single-loss experiment demonstrates timeout/retransmission and duplicate suppression.
- Editable topologies, starter networks, guided challenges, persistent local saves, JSON export/import, undo/redo, zoom and pan, accessible alternatives to dragging, and playback with historical state inspection.

This is an educational simulator. Protocol panels distinguish modeled fields from omitted implementation details. IPv6, VLANs, dynamic routing protocols, TLS/HTTP2/HTTP3, real Cisco firmware/CLI, RF propagation, Wi-Fi contention, TCP congestion-control algorithms, IP fragmentation, and production packet-capture compatibility are outside this release. Their absence must not be presented as simulated functionality. Ethernet and Wi-Fi animations represent link delivery, not measured physical signals.

## Workspace and visual direction

Use Kitab's warm paper, forest green, serif headings and restrained accent colors. A network canvas is the main workspace, with elegant device illustrations and readable labels. The visual hierarchy favors the current action and its explanation.

- **Header:** network name, starter selector, save status, reset, export/import, help.
- **Left tray:** devices and connection tools. Drag to place, or select a device type then click/tap the canvas. Keyboard users can add at the viewport center and move through position controls.
- **Center:** pannable, zoomable canvas with port-aware links, interface labels on demand, Wi-Fi dashed paths, editable LAN/WAN grouping labels, and clearly highlighted active hops. LAN grouping annotations never determine connectivity.
- **Right inspector:** selected device configuration, live tables, or selected packet layers. Basic fields appear first, with advanced settings collapsed. Plain definitions stay one click away.
- **Bottom:** source, destination, action, play/pause, previous/next event, speed, event timeline, and an explanation of the current action.
- **Challenge drawer:** goal, current progress, graduated hints, and an option to continue freely. It does not obscure packet travel.

Layer colors stay consistent: application amber, transport violet, IP blue, link teal. Colors always have text/icon equivalents. Nested cards show encapsulation with actual header fields. Smooth motion connects layers and hops without replacing explicit event descriptions. Reduced-motion mode uses clear state changes.

Selecting “Inside device” opens a focused view of application → socket API → OS transport/IP → network interface. Routers show ingress interface → IP/routing/NAT → egress interface. Switches show frame arrival and forwarding-table decisions. An optional “Follow packet” camera moves between devices, with easy return to the overview and manual camera override.

Desktop supports canvas and inspector side by side. On narrow screens, the inspector becomes a sheet and controls remain reachable. Touch uses explicit move/connect modes to avoid accidental edits. All essential actions are possible without precise dragging.

## Build and configuration behavior

Devices have stable IDs and named interfaces/ports. Each Ethernet port accepts one cable. Switches expose multiple ports. Routers expose at least LAN and WAN interfaces and permit additional routed interfaces within bounds. PCs and servers use Ethernet, phones use Wi-Fi, and access points bridge wireless associations to Ethernet. Invalid connection types explain why they cannot be made.

Wi-Fi joining uses an SSID and a simulated passphrase check. Association produces a visible event before IP configuration. Spatial distance on the canvas does not imply radio range. Password comparison is a teaching simplification, not an implementation of wireless authentication.

DHCP mode starts an interface without a usable address. “Configure automatically” runs Discover, Offer, Request and ACK visibly and installs a lease with address, prefix, gateway and DNS. Static mode lets the learner enter these fields directly. DHCP is limited to the local broadcast domain, with no relay in this release. DHCP pools, DNS records, server content and router NAT settings are editable.

Subnet helpers show the calculated address block and whether the chosen next hop is local. The engine validates IPv4 octets, contiguous masks, usable addresses and duplicate addresses within a broadcast domain. Basic host LANs support /1–/30. Routes support /0–/32. /31 and /32 interface use is explicitly rejected with a short explanation of this release's scope.

Routes include connected networks, editable static routes and a default route. Longest-prefix matching determines the next hop. The topology must supply physical connectivity and a reachable next hop, even if an address mathematically belongs to the same subnet. LAN, subnet, WAN and Internet explanations remain distinct.

The Internet starter is a finite, inspectable ISP topology using documentation address ranges. It contains routed links, DNS and a web server. An Internet cloud may collapse this group visually, but expanding it reveals the simulated routers and links. Dropping a cloud does not magically provide reachability.

## Simulation architecture and event order

Keep topology/configuration, transient runtime state, simulation events, and presentation independent. Existing lessons use scripted engines; the playground must derive behavior from configuration instead of adapting a hardcoded trace into an arbitrary topology.

Suggested modules are `src/practice/network/` for pure types, validation, routing, protocol transitions and scenarios, and `src/practice/` for workspace components. Exact filenames and rendering-library choice belong to the implementer.

A seeded event queue and simulated clock produce reproducible runs. Each event records actor, location inside the actor, protocol, packet/frame identity, simulated timestamp, explanation, changed fields and runtime changes. Replay reconstructs tables and states at the selected event. A stable tie-breaker orders simultaneous events. Visual animation duration is independent of simulated elapsed time.

The initial engine permits one user-initiated application transaction at a time. Its supporting DHCP/DNS/ARP and transport exchanges can create multiple queued messages. Topology or configuration edits stop playback and invalidate the current trace with an explicit notice. Historical traces are immutable and separate from the edited workspace.

Typical HTTP journey:

1. Associate Wi-Fi if required and explicitly run DHCP for unconfigured clients.
2. User enters a URL. The application parses host/path and prepares request data. It does not require a completed TCP connection to construct the request text.
3. Resolve the hostname through a configured DNS server if necessary. Show UDP/IP/frame wrapping and replies. An IP-literal URL skips DNS.
4. The application requests a socket from the simulated OS. Show the app's socket reference and the OS-owned connection state as related views of one endpoint.
5. TCP starts connection establishment. Every outgoing packet invokes IP route selection, next-hop ARP if necessary, link encapsulation and delivery. Show SYN, SYN-ACK and ACK with sequence/acknowledgement values.
6. Application sends the prepared HTTP request. TCP divides bytes by the modeled MSS, numbers the bytes, and supplies segments to IP. IPv4 adds source/destination, protocol and TTL. Ethernet or Wi-Fi carries the next-hop frame.
7. Switches learn source MAC/port entries and forward/flood frames. Access points bridge link media. Routers remove the incoming frame, perform route lookup, decrement TTL when forwarding, apply configured NAT where appropriate, and create a new outgoing frame. Layer fields clearly distinguish end-to-end identity from hop-local changes.
8. The server removes headers in order, reassembles TCP data, acknowledges bytes and hands a complete HTTP request to the server application.
9. The server creates an HTTP response. Its own route table and network state determine the return journey. NAT reverse mapping restores the internal destination when applicable.
10. The client reassembles the response and shows the returned content. A modeled close exchanges FIN/ACK events. The initial request uses an explicit connection-close policy.

Ping uses ICMP directly over IP, with no TCP segment. ARP uses link-layer frames, with no IP packet. DNS/DHCP use UDP datagrams, not TCP segments. The UI must never invent missing layers for a consistent-looking diagram.

TCP is a labeled simplified reliable byte-stream model with handshake states, sequence numbers, acknowledgements, configurable small payloads, in-order delivery, duplicate suppression and one loss/retransmission scenario. A fixed MSS and MTU avoid fragmentation. Checksums may be shown as omitted rather than fabricating computed wire bytes. Byte counts use UTF-8. Simulated method names describe the implementation and are not claimed to be browser or OS source code.

NAT is explicit outbound source NAT/PAT on designated inside/outside interfaces with a connection mapping used for replies. Unsolicited inbound traffic has no mapping and fails visibly. Ping uses a modeled ICMP identifier mapping. A router does not automatically NAT every forwarded packet.

## Tables, packet inspection and failures

Inspect interface state, DHCP leases, ARP cache, switch MAC table, routing table, NAT mappings and TCP connection state at the selected event. Table changes highlight the row and explain its purpose. Packet inspection displays application bytes/text, transport fields, IP fields, and current frame fields, with before/after values at a router or bridge.

Failures include unplugged cable, inactive interface, wrong Wi-Fi credentials, exhausted DHCP pool, unresolved name, wrong mask/gateway, duplicate IP, failed ARP, absent forward/return route, TTL expiration, closed server port and missing NAT mapping. Errors identify the actor, failed decision and observed configuration, then offer a contextual hint. They must arise from engine state rather than a guessed list of warnings. Layer-2 loops are rejected with an explanation that spanning tree is not modeled. Routing loops terminate through TTL. Resource limits halt with a clear message.

## Starter networks and guided challenges

Starter networks: two PCs and a switch; Wi-Fi home LAN; two routed LANs; home LAN through an ISP to a web server; empty canvas.

Initial guided challenges:

1. Connect two PCs and deliver a ping.
2. Fix a subnet mismatch and explain local delivery.
3. Join Wi-Fi and obtain an address through DHCP.
4. Connect two LANs using gateways and routes.
5. Reach a website using DNS and NAT, inspect the reply mapping.
6. Drop a TCP data segment and observe reliable delivery.

Each challenge supplies a clear goal, context, starter topology, deterministic success conditions and hints. Success is based on simulation outcomes and required configuration/trace evidence, not on merely pressing Play. Learners can reset a challenge or keep its network as a sandbox. Completion persists separately from lesson progress.

## Persistence and integration

Add `/practice/network` as a lazy-loaded route and a prominent entry in the existing Practice section. Preserve current mission routes and the original full-page Packet Journey. Link concepts to existing IP-addressing and HTTP lessons. Reuse shared UI tokens and header instead of creating another visual identity.

Versioned local storage persists named network designs, positions and configurations, and guided progress. Configuration and traffic actions share an explicit simulation session. “Configure automatically” installs an active lease and client settings that survive subsequent Ping/HTTP actions in that session. These actions also retain current ARP/MAC/DNS/NAT state, with an indicator explaining that cached state may skip earlier exchanges. Each action records its initial state so rewind is exact. “Restart simulation” clears transient tables and DHCP-acquired settings, preserves static settings and topology, and visibly returns DHCP clients to unconfigured. Reload/import opens a fresh session and does not restore leases. Configuration edits invalidate the current trace and reset the session; position-only edits preserve it. A client lacking a lease is prompted to run DHCP before traffic. Simulated lease expiry is enforced by the session clock, with expiry clearing acquired settings and a visible event; renewal is an explicit DHCP action in this release. Import/export includes validated topology/configuration, never executable content. Bound initial workspaces to 40 devices, 80 links and 10,000 events; report reached limits clearly. Implementer may tune these bounds after profiling and document the change. Imported labels and payloads render as text, including the simulated response preview.

Undo/redo covers user topology/configuration edits, not protocol events. Deleting a device removes attached links in the same undoable edit. Save failures are visible and do not discard in-memory work.

## Acceptance and verification

- Build, move, wire, configure, save, reload and import/export a custom network.
- Complete all six challenges using the same engine as free building.
- Trace a complete HTTP exchange from Wi-Fi client through an access point, router/NAT and ISP to a server and back.
- Inspect actual per-event headers and table changes; source/destination addresses, ports, MACs and TTL remain internally consistent.
- Verify DNS/DHCP, local and routed delivery, return-route failure, ARP boundaries, switch flooding/learning, NAT reverse mapping, TCP reassembly/retransmission and TTL failure with focused engine tests.
- Verify rewind restores historical tables and playback never consumes an edited topology silently.
- Browser-test critical editing/playback/challenge/save flows and inspect desktop and touch layouts. Check keyboard alternatives, visible focus, reduced motion and readable contrast.
- Run existing unit/type/build checks and relevant navigation/lesson regressions. Confirm standalone Packet Journey bytes remain intact.

## Delivery and builder decisions

Build in coherent stages: core topology and packet engine; editing/configuration workspace; detailed playback and device close-ups; challenges/persistence/accessibility; integrated verification and review. These stages are implementation sequencing, not separate approval gates or a reduction of the agreed outcome.

Implementer owns exact component boundaries, canvas technology, icon geometry, animation timing, supported-browser details, performance optimizations and test fixtures. Choose existing dependencies where practical. A draft PR is the reviewable delivery under the repository's established workflow; merging and production deployment follow the user's release instruction.
