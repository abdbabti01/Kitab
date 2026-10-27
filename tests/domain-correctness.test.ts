import assert from "node:assert/strict";
import test from "node:test";
import {
  BFS_DEQUEUE_BUDGET,
  arrayAddress,
  buildDataStructureSimulation,
  buildGraphSearch,
  graphFixture,
  structureInfo,
  structureKinds,
} from "../src/visual-engine/data-structures/model.ts";
import { buildTcpTimeline, defaultTcpConfig, normalizeTcpConfig, type TcpConfig } from "../src/visual-engine/engines/protocols/tcp-engine.ts";
import { buildRecursionTimeline } from "../src/visual-engine/engines/execution/recursion-engine.ts";

/** Plain BFS oracle, independent of the simulator. */
function reachableFrom(start: number, adjacency: Record<number, number[]>) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) for (const next of adjacency[queue.shift()!] ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  return seen;
}

test("BFS reports every fixture target correctly, including the far target 12", () => {
  const reachable = reachableFrom(1, graphFixture);
  for (const vertex of Object.keys(graphFixture).map(Number)) {
    const simulation = buildDataStructureSimulation({ kind: "graph", operation: "bfs", value: vertex, index: 0 });
    assert.equal(simulation.outcome?.status, reachable.has(vertex) ? "found" : "unreachable", `target ${vertex}`);
  }
  const far = buildDataStructureSimulation({ kind: "graph", operation: "bfs", value: 12, index: 0 });
  assert.match(far.result, /reached/);
  assert.equal(far.frames.at(-1)!.title, "Visit vertex 12");
});

test("BFS distinguishes absent, unreachable and budget-interrupted searches", () => {
  for (const absent of [0, 2, 99, -5]) {
    assert.equal(buildDataStructureSimulation({ kind: "graph", operation: "bfs", value: absent, index: 0 }).outcome?.status, "absent");
  }
  const isolated = buildDataStructureSimulation({ kind: "graph", operation: "bfs", value: 15, index: 0 });
  assert.equal(isolated.outcome?.status, "unreachable");
  assert.equal(isolated.frames.at(-1)!.snapshot.frontierValues.length, 0);

  const interrupted = buildGraphSearch({ kind: "graph", operation: "bfs", value: 12, index: 0 }, graphFixture, 2);
  assert.equal(interrupted.outcome?.status, "interrupted");
  assert.doesNotMatch(interrupted.result, /unreachable/);
  assert.ok(BFS_DEQUEUE_BUDGET > Object.keys(graphFixture).length);
});

test("BFS visits each vertex at most once on cyclic graphs", () => {
  const cycle = { 1: [2, 3], 2: [1, 3], 3: [1, 2, 4], 4: [3, 1], 9: [] } as Record<number, number[]>;
  cycle[1].push(4);
  for (const target of [4, 9, 77]) {
    const simulation = buildGraphSearch({ kind: "graph", operation: "bfs", value: target, index: 0 }, cycle);
    const dequeued = simulation.frames.filter((frame) => frame.action === "DEQUEUE").map((frame) => frame.title);
    assert.equal(new Set(dequeued).size, dequeued.length);
    assert.ok(dequeued.length <= 4);
  }
});

test("array narration, labels and snapshots use the same 4-byte addresses", () => {
  for (const operation of structureInfo.array.operations) {
    for (const value of [6, 99]) for (const index of [0, 2, 5]) {
      const simulation = buildDataStructureSimulation({ kind: "array", operation: operation.id, value, index });
      for (const frame of simulation.frames) {
        frame.snapshot.items.forEach((item, slot) => assert.equal(item.address, arrayAddress(slot)));
        for (const mentioned of `${frame.detail} ${frame.code}`.match(/0x[0-9A-F]+/g) ?? []) {
          assert.ok(frame.snapshot.items.some((item) => item.address === mentioned) || mentioned === "0x1000", `${frame.title}: ${mentioned}`);
        }
      }
    }
  }
  assert.equal(arrayAddress(1), "0x1004");
});

test("array insertion and deletion report computed shift counts", () => {
  for (const [index, shifts] of [[0, 5], [2, 3], [4, 1], [5, 0]] as const) {
    assert.equal(buildDataStructureSimulation({ kind: "array", operation: "insert", value: 7, index }).outcome?.shifts, shifts);
  }
  assert.equal(buildDataStructureSimulation({ kind: "array", operation: "delete", value: 0, index: 1 }).outcome?.shifts, 3);
});

test("nonfinite data-structure inputs are normalized", () => {
  for (const kind of structureKinds) {
    const simulation = buildDataStructureSimulation({ kind, operation: structureInfo[kind].operations[0].id, value: Number.NaN, index: Number.POSITIVE_INFINITY });
    assert.ok(simulation.frames.length >= 2);
  }
});

function tcpConfigs(): TcpConfig[] {
  const configs: TcpConfig[] = [];
  for (const scenario of ["normal", "loss", "reorder"] as const)
    for (const receiveWindowSegments of [1, 2, 3, 6])
      for (const mssBytes of [536, 1200, 1460])
        for (const payloadBytes of [500, 1500, 3500, 8000])
          configs.push({ ...defaultTcpConfig, scenario, receiveWindowSegments, mssBytes, payloadBytes });
  return configs;
}

test("an independent ACK ledger never sees more unacknowledged data than the window", () => {
  for (const config of tcpConfigs()) {
    const timeline = buildTcpTimeline(config);
    let ackAtSender = 1001;
    const ranges = new Map<number, number>();
    let previousPacketId: string | undefined;
    for (const event of timeline.events) {
      const packet = event.snapshot.packet;
      const isNewPacket = packet && packet.id !== previousPacketId;
      previousPacketId = packet?.id;
      if (!packet || !isNewPacket && !(packet.kind === "ack" && packet.location === "client-transport")) continue;
      if (packet.kind === "ack" && packet.location === "client-transport") ackAtSender = Math.max(ackAtSender, packet.ack!);
      if (packet.kind === "data" && packet.location === "client-transport" && !packet.id.endsWith("retransmission")) {
        ranges.set(packet.seq, packet.seq + packet.payloadBytes);
        const unacked = [...ranges.values()].filter((end) => end > ackAtSender).length;
        assert.ok(unacked <= config.receiveWindowSegments, `${JSON.stringify(config)} ${event.id}: ${unacked} unacked`);
        assert.ok(unacked <= event.snapshot.congestionWindowSegments);
      }
    }
    // The independent ledger and the model agree on the end state.
    assert.equal(ackAtSender, 1001 + timeline.config.payloadBytes);
    const last = timeline.events.at(-1)!.snapshot;
    assert.deepEqual(last.senderUnacked, []);
    assert.ok(last.segments.every((segment) => segment.status === "delivered" && segment.acked));
  }
});

test("TCP ranges, cumulative ACKs and recovery hold across the configuration space", () => {
  for (const config of tcpConfigs()) {
    const timeline = buildTcpTimeline(config);
    const expected = timeline.events.map((event) => event.snapshot.receiverNextByte);
    expected.slice(1).forEach((value, index) => assert.ok(value >= expected[index]));
    const ackNumbers = timeline.events.flatMap((event) => {
      const packet = event.snapshot.packet;
      return packet?.kind === "ack" && packet.direction === "server-to-client" && packet.ack ? [packet.ack] : [];
    });
    ackNumbers.slice(1).forEach((value, index) => assert.ok(value >= ackNumbers[index]));
    // Every ACK number lands on a segment boundary.
    const boundaries = new Set([1001, 5001, ...timeline.events[0].snapshot.segments.map((segment) => segment.seqEnd + 1)]);
    ackNumbers.forEach((ack) => assert.ok(boundaries.has(ack), `ACK ${ack} is not a boundary`));
    if (timeline.config.scenario === "loss") {
      const resent = timeline.events.find((event) => event.id === "segment-2-retransmitted")!;
      assert.equal(resent.snapshot.packet!.seq, resent.snapshot.segments[1].seqStart);
      assert.equal(timeline.events.at(-1)!.snapshot.transmissions, timeline.events[0].snapshot.segments.length + 1);
    }
    if (timeline.config.scenario === "reorder") {
      assert.ok(timeline.events.some((event) => event.snapshot.segments.some((segment) => segment.status === "buffered")));
    }
  }
});

test("TCP loss with a window above one produces a duplicate ACK before the timeout", () => {
  const timeline = buildTcpTimeline({ ...defaultTcpConfig, scenario: "loss" });
  const ids = timeline.events.map((event) => event.id);
  const duplicate = ids.findIndex((id) => /duplicate-at-sender$/.test(id));
  assert.ok(duplicate > 0 && duplicate < ids.indexOf("retransmission-timeout"));
  assert.equal(timeline.events[duplicate].snapshot.senderAckedThrough, timeline.events[0].snapshot.segments[1].seqStart);
});

test("nonfinite TCP inputs fall back to safe defaults", () => {
  const normalized = normalizeTcpConfig({ payloadBytes: Number.NaN, mssBytes: Number.NaN, receiveWindowSegments: Number.POSITIVE_INFINITY, latencyMs: Number.NaN, scenario: "normal" });
  assert.equal(normalized.payloadBytes, defaultTcpConfig.payloadBytes);
  assert.equal(normalized.receiveWindowSegments, 6);
  assert.equal(normalized.latencyMs, defaultTcpConfig.latencyMs);
  assert.doesNotThrow(() => buildTcpTimeline(normalized));
});

test("recursion pushes on calls, pops on returns and unwinds in reverse order", () => {
  for (const n of [1, 2, 3, 4, 6]) for (const fn of ["factorial", "sum"] as const) {
    const timeline = buildRecursionTimeline({ fn, n, baseCase: true });
    let depth = 0;
    const pushed: string[] = [];
    const popped: string[] = [];
    for (const event of timeline.events) {
      if (event.kind === "call") { depth += 1; pushed.push(event.stack.at(-1)!.id); }
      if (event.kind === "return") { depth -= 1; popped.push(event.returned!.frameId); }
      if (event.kind !== "complete") assert.equal(event.stack.length, depth, `${fn}(${n}) ${event.title}`);
      // Exactly one frame runs or returns; every frame below it waits.
      event.stack.slice(0, -1).forEach((frame) => assert.equal(frame.status, "waiting"));
    }
    assert.deepEqual(popped, [...pushed].reverse());
    assert.equal(timeline.outcome.maxDepth, n);
    const oracle = fn === "factorial" ? Array.from({ length: n }, (_, i) => i + 1).reduce((a, b) => a * b, 1) : (n * (n + 1)) / 2;
    assert.equal(timeline.outcome.result, oracle);
    assert.equal(timeline.outcome.firstReturn, `${fn}(1)`);
  }
});

test("removing the base case overflows at the stack limit instead of returning", () => {
  const timeline = buildRecursionTimeline({ fn: "factorial", n: 3, baseCase: false, stackLimit: 6 });
  assert.equal(timeline.outcome.status, "overflow");
  assert.equal(timeline.outcome.result, null);
  assert.equal(timeline.outcome.maxDepth, 6);
  assert.ok(!timeline.events.some((event) => event.kind === "return"));
  assert.equal(timeline.events.find((event) => event.kind === "overflow")!.stack.length, 6);
});
