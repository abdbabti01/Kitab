import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaybackState,
  playbackReducer,
} from "../src/visual-engine/core/simulation.ts";
import {
  buildTcpTimeline,
  createSegments,
  defaultTcpConfig,
  normalizeTcpConfig,
  type TcpConfig,
} from "../src/visual-engine/engines/protocols/tcp-engine.ts";

function config(patch: Partial<TcpConfig>): TcpConfig {
  return { ...defaultTcpConfig, ...patch };
}

test("every TCP event has a unique id and a known chapter", () => {
  const timeline = buildTcpTimeline(defaultTcpConfig);
  const chapters = new Set(["orient", "handshake", "encapsulate", "deliver", "reliability", "finish"]);
  assert.equal(new Set(timeline.events.map((event) => event.id)).size, timeline.events.length);
  timeline.events.forEach((event) => assert.ok(chapters.has(event.chapterId), event.id));
});

test("normal, loss and reorder timelines always reach the terminal event", () => {
  for (const scenario of ["normal", "loss", "reorder"] as const) {
    const timeline = buildTcpTimeline(config({ scenario }));
    assert.equal(timeline.events.at(-1)?.id, "lesson-complete");
    assert.equal(
      timeline.events.at(-1)?.snapshot.completedBytes,
      timeline.config.payloadBytes,
    );
    assert.ok(
      timeline.events
        .at(-1)
        ?.snapshot.segments.every((segment) => segment.status === "delivered"),
    );
  }
});

test("segment ranges are contiguous and contain exactly the payload", () => {
  for (const mssBytes of [536, 1200, 1460]) {
    const input = config({ payloadBytes: 8000, mssBytes });
    const segments = createSegments(input);
    assert.equal(
      segments.reduce((total, segment) => total + segment.length, 0),
      input.payloadBytes,
    );
    segments.slice(1).forEach((segment, index) => {
      assert.equal(segment.seqStart, segments[index].seqEnd + 1);
    });
  }
});

test("the cumulative acknowledgment never moves backward", () => {
  for (const scenario of ["normal", "loss", "reorder"] as const) {
    const acknowledgments = buildTcpTimeline(config({ scenario })).events.map(
      (event) => event.snapshot.receiverNextByte,
    );
    acknowledgments.slice(1).forEach((ack, index) => {
      assert.ok(ack >= acknowledgments[index]);
    });
  }
});

test("each send round respects the effective window", () => {
  for (const receiveWindowSegments of [1, 2, 3, 6]) {
    for (const scenario of ["normal", "loss", "reorder"] as const) {
      const timeline = buildTcpTimeline(
        config({
          payloadBytes: 8000,
          mssBytes: 1200,
          receiveWindowSegments,
          scenario,
        }),
      );
      timeline.events
        .filter((event) => /^segment-\d+-sent$/.test(event.id))
        .forEach((event) => {
        const outstanding = event.snapshot.segments.filter(
          (segment) => segment.status === "in-flight",
        ).length;
        assert.ok(
          outstanding <= event.snapshot.sendWindowSegments,
          `${scenario}: ${event.id} has ${outstanding} outstanding with a window of ${event.snapshot.sendWindowSegments}`,
        );
        });
    }
  }
});

test("loss uses timeout recovery and retransmits the original byte range", () => {
  const timeline = buildTcpTimeline(config({ scenario: "loss" }));
  const lost = timeline.events.find((event) => event.id === "segment-2-lost");
  const resent = timeline.events.find(
    (event) => event.id === "segment-2-retransmitted",
  );
  assert.equal(lost?.snapshot.segments[1].status, "lost");
  assert.equal(resent?.snapshot.segments[1].status, "retransmitted");
  assert.equal(resent?.snapshot.packet?.seq, lost?.snapshot.segments[1].seqStart);
  assert.ok(timeline.events.some((event) => event.id === "retransmission-timeout"));
});

test("reordering buffers bytes until the gap is filled", () => {
  const timeline = buildTcpTimeline(config({ scenario: "reorder" }));
  const buffered = timeline.events.find((event) =>
    event.snapshot.segments.some((segment) => segment.status === "buffered"),
  );
  assert.ok(buffered);
  assert.equal(timeline.events.at(-1)?.snapshot.receiverNextByte, 4501);
});

test("playback cannot stop before the last event", () => {
  const eventCount = buildTcpTimeline(defaultTcpConfig).events.length;
  let state = playbackReducer(createPlaybackState(eventCount), { type: "PLAY" });
  for (let index = 1; index < eventCount; index += 1) {
    state = playbackReducer(state, { type: "NEXT" });
  }
  assert.equal(state.index, eventCount - 1);
  assert.equal(state.status, "complete");
  state = playbackReducer(state, { type: "NEXT" });
  assert.equal(state.index, eventCount - 1);
});

test("unsafe scenario values and controls are normalized", () => {
  assert.deepEqual(
    normalizeTcpConfig({
      payloadBytes: 99999,
      mssBytes: 7,
      receiveWindowSegments: 99,
      latencyMs: -4,
      scenario: "unexpected" as TcpConfig["scenario"],
    }),
    {
      payloadBytes: 8000,
      mssBytes: 1460,
      receiveWindowSegments: 6,
      latencyMs: 5,
      scenario: "normal",
    },
  );
});

test("the TCP timeline describes plain HTTP on port 80 and discloses that NAT is left out", () => {
  for (const scenario of ["normal", "loss", "reorder"] as const) {
    const timeline = buildTcpTimeline(config({ scenario }));
    const text = JSON.stringify(timeline.events.map((e) => [e.title, e.explanation, e.technical]));
    assert.doesNotMatch(text, /443|HTTPS|TLS/, scenario);
    const ready = timeline.events.find((e) => e.id === "endpoints-ready")!;
    assert.match(ready.explanation, /port 80 for plain HTTP/);
    assert.match(ready.technical ?? "", /leaves out NAT/);
  }
});

test("the TCP key ideas use the engine's own numbers and describe its simplifications truthfully", async () => {
  const { keyIdeas } = await import("../src/learning/missions/tcp-terms.ts");
  const { pathPosition } = await import("../src/learning/networking-path.ts");
  // Every TCP prediction mission in the path explains its ideas before the learner predicts.
  for (const id of ["tcp-lost-segment", "tcp-send-window", "tcp-lab", "missing-segment"]) {
    assert.ok(pathPosition(id), id);
    assert.ok(keyIdeas[id]?.length >= 4, id);
  }
  const text = Object.values(keyIdeas).flat().map((t) => `${t.definition} ${t.purpose} ${t.example}`).join(" ");
  // 3,500 B at an MSS of 1,460 B: 1,460 + 1,460 + 580, segment 2 from byte 2461 to 3920.
  const segments = createSegments(config({ payloadBytes: 3500, mssBytes: 1460 }));
  assert.deepEqual(segments.map((s) => s.length), [1460, 1460, 580]);
  assert.deepEqual([segments[0].seqStart, segments[0].seqEnd, segments[1].seqStart, segments[1].seqEnd], [1001, 2460, 2461, 3920]);
  assert.match(text, /1001–2460/);
  assert.match(text, /2461–3920/);
  // One repeated ACK per batch, then the timer: never fast retransmit, whatever the window.
  for (const receiveWindowSegments of [3, 6]) {
    const ids = buildTcpTimeline(normalizeTcpConfig({ scenario: "loss", payloadBytes: 3500, mssBytes: 536, receiveWindowSegments })).events.map((e) => e.id);
    assert.equal(ids.filter((id) => /^ack-.*-duplicate-created$/.test(id)).length, 1);
    assert.ok(ids.indexOf("retransmission-timeout") < ids.indexOf("segment-2-retransmitted"));
  }
  assert.match(text, /Kitab shows one for each batch/);
  assert.match(text, /Kitab's model always waits for the timer/);
  // The congestion window starts at 10 segments and drops to 1 after a timeout.
  const timeline = buildTcpTimeline(normalizeTcpConfig({ scenario: "loss" }));
  assert.equal(timeline.events[0].snapshot.congestionWindowSegments, 10);
  assert.equal(timeline.events.find((e) => e.id === "retransmission-timeout")!.snapshot.congestionWindowSegments, 1);
  assert.match(text, /starts at 10 segments and drops to 1 after a timeout/);
});
