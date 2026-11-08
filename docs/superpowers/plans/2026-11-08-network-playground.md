# Network Playground Implementation Plan

> Execute using superpowers:executing-plans, with a fresh whole-branch review.

**Goal:** An editable network laboratory with guided challenges and inspectable packet journeys.
**Architecture:** Pure topology and protocol simulation returns immutable event snapshots. React renders the canvas, inspector and replay from those snapshots. Local versioned storage persists designs separately from transient sessions.
**Tech Stack:** Existing React, TypeScript, SVG, Zod, Node test runner and Playwright.
**Spec:** docs/superpowers/specs/2026-11-08-network-playground-design.md

## Global constraints
Preserve standalone Packet Journey. Keep existing lesson and mission routes. Simulate IPv4, TCP HTTP/1.1, UDP DNS/DHCP, ICMP and ARP with explicit educational limits. Maximum 40 devices, 80 links, 10000 events. No external traffic or paid dependencies.

## Review focus
- Imported dangling references and oversized payloads must be rejected before changing a workspace.
- Return routes must be computed independently of forward routes.
- Moving devices must not reset DHCP leases or packet state.
- Cached ARP must not hide physical disconnects.
- Unicode payload lengths and retransmitted bytes must match TCP acknowledgements.

## Task 1: Topology, addressing and starters
Files: src/practice/network/model.ts, topology.ts, starters.ts; tests/network-model.test.ts.
Interfaces: Network, Device, Interface, Link, Session, Packet, TraceEvent; createDevice(kind,id,x,y), starter(id), validateNetwork(network), subnet(ip,prefix), importNetwork(text).
- [x] Write tests for subnet boundaries, invalid masks/addresses, port compatibility, duplicate IDs, cycles, import bounds and starter connectivity. Run Node tests and observe missing implementation.
- [x] Implement typed model, immutable editing helpers, validated imports and five editable starters.
- [x] Run tests, then commit.

## Task 2: Stateful protocol engine
Files: src/practice/network/engine.ts; tests/network-engine.test.ts.
Interfaces: simulate(network, session, action) => {events, session, success, summary}, newSession(network); action kinds dhcp, ping, http; events include snapshot, layers, actor and optional hop.
- [x] Test DHCP continuity, switched local ping, routed ping, DNS/HTTP/NAT response, absence of TCP in ping, broken gateway/return route, TTL, ARP boundaries, TCP loss and UTF-8 ACK counts. Observe failures first.
- [x] Implement deterministic protocol processing and snapshot events, link forwarding/learning, ARP, longest-prefix routing, NAT, leases, DNS, TCP and complete round trips.
- [x] Verify test suite and commit.

## Task 3: Workspace and replay
Files: src/practice/{NetworkPlayground,NetworkCanvas,DeviceInspector,PacketInspector}.tsx, practice.css, network/storage.ts, network/challenges.ts; app routes/App/SiteHeader/Home; e2e/network-playground.spec.ts.
Interfaces: consume model and simulate outputs without deriving protocol facts in rendering.
- [x] Add browser assertions for practice routing, send/rewind, configuration errors, drag/add/connect, saved state, challenge completion and narrow-screen layout. Observe missing route failure.
- [x] Implement editor, port connection tools, Wi-Fi association, contextual definitions, tables, device internals, nested packet cards, timeline, undo/redo, save/import/export, guided scenarios and responsive access.
- [x] Run focused manual desktop browser checks and inspect screenshots; fix observed issues and commit. Mobile screenshot and automated browser coverage remain pending: local Chromium launch is restricted.

## Task 4: Integrated review and delivery
- [x] Run full build and unit tests; confirm standalone public files unchanged. Browser regressions authored but local Playwright execution blocked; manual browser checks recorded separately.
- [x] Request fresh review of implementation against approved spec; fix important findings with regression tests.
- [x] Record evidence and any educational limitations in docs, create a draft PR from tested tree, report actual status.
