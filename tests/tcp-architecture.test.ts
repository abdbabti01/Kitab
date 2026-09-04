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
import { tcpLessonSpec } from "../src/visual-engine/lessons/tcp-spec.ts";

function config(patch: Partial<TcpConfig>): TcpConfig {
  return { ...defaultTcpConfig, ...patch };
}

test("the verified lesson references real chapters and events", () => {
  const timeline = buildTcpTimeline(defaultTcpConfig);
  const eventIds = new Set(timeline.events.map((event) => event.id));
  const chapterIds = new Set(tcpLessonSpec.chapters.map((chapter) => chapter.id));
  assert.equal(new Set(eventIds).size, timeline.events.length);
  timeline.events.forEach((event) => assert.ok(chapterIds.has(event.chapterId)));
  tcpLessonSpec.checkpoints.forEach((checkpoint) =>
    assert.ok(eventIds.has(checkpoint.eventId)),
  );
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
