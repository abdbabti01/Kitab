import assert from "node:assert/strict";
import test from "node:test";
import "../src/learning/engines/index.ts";
import { buildTrace } from "../src/learning/registry.ts";
import { messageJourneyAdapter, type MessageJourneyData } from "../src/learning/engines/message-journey.ts";
import { buildTcpTimeline, createSegments, defaultTcpConfig } from "../src/visual-engine/engines/protocols/tcp-engine.ts";
import { bits, buildMessageJourney, encodeMessage, hosts, normalizeMessage, routers } from "../src/visual-engine/engines/protocols/message-journey.ts";

const event = (timeline: ReturnType<typeof buildMessageJourney>, id: string) => timeline.events.find((item) => item.id === id)!;

test("HELLO is five UTF-8 bytes with the real values and bits", () => {
  const encoding = encodeMessage("HELLO");
  assert.deepEqual(encoding.bytes.map((item) => item.value), [72, 69, 76, 76, 79]);
  assert.equal(bits(72), "01001000");
  assert.equal(bits(79), "01001111");
  assert.ok(encoding.characters.every((char) => char.byteCount === 1));
});

test("multi-byte characters use their actual UTF-8 bytes and decode back exactly", () => {
  const text = "héllo 👋";
  const encoding = encodeMessage(text);
  assert.deepEqual(encoding.bytes.map((item) => item.value), [...new TextEncoder().encode(text)]);
  assert.deepEqual(encoding.characters.map((char) => char.byteCount), [1, 2, 1, 1, 1, 1, 4]);
  assert.deepEqual(encoding.bytes.slice(1, 3).map((item) => item.role), ["lead", "continuation"]);
  const timeline = buildMessageJourney({ message: text });
  assert.equal(timeline.events.at(-1)!.snapshot.b.text, text);
  assert.equal(event(timeline, "segment-built").snapshot.a.unacked!.end, 1000 + encoding.bytes.length);
});

test("messages are normalized: control characters and lone surrogates removed, length capped, empty means HELLO", () => {
  assert.equal(normalizeMessage("hi\u0007\n"), "hi");
  assert.equal(normalizeMessage("a\uD800b"), "ab");
  assert.equal(normalizeMessage(""), "HELLO");
  assert.equal(normalizeMessage(undefined), "HELLO");
  assert.equal(Array.from(normalizeMessage("😀".repeat(30))).length, 16);
  assert.equal(normalizeMessage("é"), "é");
});

test("segmentation follows TCP's own rule and the handshake numbers match the windowed TCP engine", () => {
  const timeline = buildMessageJourney({});
  assert.deepEqual(timeline.segments, createSegments({ ...defaultTcpConfig, payloadBytes: 5, mssBytes: 1460 }));
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.segments[0].seqStart, 1001);
  assert.equal(timeline.segments[0].seqEnd, 1005);
  const tcp = buildTcpTimeline(defaultTcpConfig).events;
  const tcpSyn = tcp.find((item) => item.id === "syn-at-transport")!.snapshot.packet!;
  const tcpSynAck = tcp.find((item) => item.id === "syn-ack-from-server")!.snapshot.packet!;
  const tcpAck = tcp.find((item) => item.id === "final-ack-crosses-network")!.snapshot.packet!;
  assert.equal(event(timeline, "syn-sent").snapshot.unit!.tcp!.seq, tcpSyn.seq);
  assert.equal(event(timeline, "syn-ack-sent").snapshot.unit!.tcp!.seq, tcpSynAck.seq);
  assert.equal(event(timeline, "syn-ack-sent").snapshot.unit!.tcp!.ack, tcpSynAck.ack);
  assert.equal(event(timeline, "ack-sent").snapshot.unit!.tcp!.ack, tcpAck.ack);
  // A pure ACK names the next byte; with 5 bytes that is 1006.
  assert.equal(event(timeline, "b-acknowledges").snapshot.unit!.tcp!.ack, 1006);
});

test("routers forward by IP only: TTL drops per router, link addresses change per hop, TCP and IP addresses do not", () => {
  const timeline = buildMessageJourney({});
  const data = timeline.events.map((item) => item.snapshot.unit).filter((unit) => unit?.id === "data" && unit.tcp);
  for (const unit of data) {
    assert.deepEqual({ seq: unit!.tcp!.seq, src: unit!.tcp!.srcPort, dst: unit!.tcp!.dstPort }, { seq: 1001, src: hosts.a.port, dst: hosts.b.port });
    if (unit!.ip) assert.deepEqual([unit!.ip.src, unit!.ip.dst], [hosts.a.iface.ip, hosts.b.iface.ip]);
  }
  assert.equal(event(timeline, "packet-built").snapshot.unit!.ip!.ttl, 64);
  assert.equal(event(timeline, "r1-forwards").snapshot.unit!.ip!.ttl, 63);
  assert.equal(event(timeline, "b-network").snapshot.unit!.ip!.ttl, 62);
  assert.equal(event(timeline, "frame-built").snapshot.unit!.link!.dst, routers.r1.interfaces[0].mac);
  assert.equal(event(timeline, "r1-new-frame").snapshot.unit!.link!.dst, routers.r2.interfaces[0].mac);
  assert.equal(event(timeline, "r2-new-frame").snapshot.unit!.link!.dst, hosts.b.iface.mac);
  assert.equal(event(timeline, "r1-forwards").decision!.matched, "198.51.100.0/24");
  assert.equal(event(timeline, "r2-forwards").decision!.nextHop, hosts.b.iface.ip);
  // Routers have no TCP state: endpoint TCP state never changes while the packet is inside the network.
  for (const id of ["r1-receives", "r1-forwards", "r1-new-frame", "r2-receives", "r2-forwards", "r2-new-frame"]) {
    assert.equal(event(timeline, id).snapshot.b.rcvNxt, 1001, id);
  }
});

test("Ethernet padding and sizes are computed from the real lengths", () => {
  const hello = event(buildMessageJourney({}), "frame-built").snapshot.unit!;
  assert.deepEqual([hello.ip!.totalLength, hello.link!.padding, hello.link!.frameBytes], [45, 1, 64]);
  const long = event(buildMessageJourney({ message: "x".repeat(16) }), "frame-built").snapshot.unit!;
  assert.deepEqual([long.ip!.totalLength, long.link!.padding, long.link!.frameBytes], [56, 0, 74]);
});

test("losing the data segment: the link discards it, A's timer resends the same bytes, B receives them once", () => {
  const normal = buildMessageJourney({});
  const lost = buildMessageJourney({ lose: "data" });
  assert.ok(event(lost, "r2-discards").snapshot.unit!.dropped);
  assert.equal(event(lost, "timer-expires").snapshot.a.timer, "expired");
  assert.equal(event(lost, "retransmit").snapshot.unit!.tcp!.seq, 1001);
  assert.equal(lost.events.at(-1)!.snapshot.a.transmissions, 2);
  assert.equal(normal.events.at(-1)!.snapshot.a.transmissions, 1);
  assert.equal(lost.events.filter((item) => item.id === "b-transport").length, 1);
  assert.equal(lost.events.at(-1)!.snapshot.b.text, "HELLO");
  assert.equal(lost.events.at(-1)!.snapshot.a.sndUna, normal.events.at(-1)!.snapshot.a.sndUna);
  // The frames before the loss are identical, so the experiment can start from there.
  const split = lost.events.findIndex((item) => item.id === "on-link-2");
  assert.deepEqual(lost.events.slice(0, split).map((item) => item.id), normal.events.slice(0, split).map((item) => item.id));
});

test("adapter facts agree with the snapshot, and claim checks catch supported contradictions", () => {
  const trace = buildTrace<MessageJourneyData>("message-journey", { message: "HELLO" });
  for (const frame of trace.frames) {
    const s = frame.data.event.snapshot;
    const fact = (id: string) => frame.facts.find((item) => item.id === id)?.value;
    assert.equal(fact("a-state"), s.a.state);
    assert.equal(fact("b-state"), s.b.state);
    if (s.unit?.ip) assert.equal(fact("ip-ttl"), s.unit.ip.ttl);
    if (s.unit?.tcp) assert.equal(fact("tcp-seq"), s.unit.tcp.seq);
    if (s.encoded) assert.equal(fact("byte-0-bits"), "01001000");
  }
  assert.equal(trace.outcome.finalAck, 1006);
  assert.equal(trace.outcome.bytes, 5);
  // Claims are checked against one step's facts: here, the frame where B sends its final ACK.
  const ackFrame = trace.frames.find((frame) => frame.facts.some((item) => item.id === "tcp-ack" && item.value === 1006))!;
  const check = (text: string) => messageJourneyAdapter.checkClaims!(text, ackFrame.facts, trace as never);
  assert.deepEqual(check("B sends ACK 1006 because it has every byte before it."), []);
  assert.equal(check("B sends ACK 1007.").length, 1);
  assert.equal(check("The TTL is now 61 at B.").length, 1);
  assert.equal(check("B sends ACK 1001.").length, 1, "1001 was the SYN-ACK's ACK, not this step's");
  assert.equal(check("Each letter is sent in its own packet.").length, 1);
  assert.equal(check("The router retransmits the lost frame.").length, 1);
  assert.equal(check("The router reads the sequence number to decide.").length, 1);
  assert.deepEqual(check("The router does not read the sequence number."), []);
});
