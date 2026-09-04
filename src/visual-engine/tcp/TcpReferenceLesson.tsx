import { useEffect, useMemo, useReducer, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FlaskConical,
  Gauge,
  Network,
  Pause,
  Play,
  RotateCcw,
  Server,
} from "lucide-react";
import {
  createPlaybackState,
  playbackReducer,
} from "../core/simulation.ts";
import {
  buildTcpTimeline,
  createSegments,
  defaultTcpConfig,
  type TcpConfig,
  type TcpLocation,
  type TcpPacket,
  type TcpSegment,
  type TcpTimelineEvent,
} from "../engines/protocols/tcp-engine.ts";
import { tcpLessonSpec } from "../lessons/tcp-spec.ts";
import "./tcp-reference.css";

const layers = [
  {
    id: "application",
    name: "Application",
    detail: "HTTP request bytes",
  },
  {
    id: "transport",
    name: "Transport",
    detail: "TCP ports, order and reliability",
  },
  {
    id: "network",
    name: "Network",
    detail: "IP addresses and routing",
  },
  { id: "link", name: "Link", detail: "One local hop at a time" },
] as const;

type AnswerMap = Record<string, number>;

export default function TcpReferenceLesson() {
  const [config, setConfig] = useState<TcpConfig>(defaultTcpConfig);
  const timeline = useMemo(() => buildTcpTimeline(config), [config]);
  const [player, dispatch] = useReducer(
    playbackReducer,
    timeline.events.length,
    createPlaybackState,
  );
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [showInspector, setShowInspector] = useState(true);
  const event = timeline.events[player.index];
  const checkpoint = event.checkpointId
    ? tcpLessonSpec.checkpoints.find((item) => item.id === event.checkpointId)
    : undefined;
  const chapterIndex = tcpLessonSpec.chapters.findIndex(
    (chapter) => chapter.id === event.chapterId,
  );
  const segmentCount = createSegments(config).length;
  const progress =
    timeline.events.length > 1
      ? Math.round((player.index / (timeline.events.length - 1)) * 100)
      : 100;

  useEffect(() => {
    dispatch({ type: "REBASE", eventCount: timeline.events.length });
    setAnswers({});
  }, [timeline.events.length, config.scenario, config.payloadBytes, config.mssBytes]);

  useEffect(() => {
    if (player.status !== "playing") return;
    if (checkpoint && answers[checkpoint.id] === undefined) {
      dispatch({ type: "PAUSE" });
      return;
    }
    const timeout = window.setTimeout(() => {
      dispatch({ type: "NEXT" });
    }, event.durationMs / player.speed);
    return () => window.clearTimeout(timeout);
  }, [answers, checkpoint, event.durationMs, player.index, player.speed, player.status]);

  function updateConfig(patch: Partial<TcpConfig>) {
    const next = { ...config, ...patch };
    const nextSegmentCount = createSegments(next).length;
    if (next.scenario === "loss" && nextSegmentCount < 2) {
      next.scenario = "normal";
    }
    if (
      next.scenario === "reorder" &&
      (nextSegmentCount < 3 || next.receiveWindowSegments < 2)
    ) {
      next.scenario = "normal";
    }
    setConfig(next);
  }

  function selectChapter(chapterId: string) {
    const index = timeline.events.findIndex(
      (item) => item.chapterId === chapterId,
    );
    if (index >= 0) dispatch({ type: "SEEK", index });
  }

  return (
    <main className="tcp-lesson">
      <header className="tcp-topbar">
        <a href="/" className="tcp-back">
          <ArrowLeft aria-hidden="true" />
          <span>Kitab</span>
        </a>
        <div className="tcp-title">
          <span>{tcpLessonSpec.family} · GUIDED SYSTEM</span>
          <h1>{tcpLessonSpec.title}</h1>
        </div>
        <div className="tcp-verified">
          <Check aria-hidden="true" />
          <span>Model checked</span>
        </div>
      </header>

      <section className="tcp-chapters" aria-label="Lesson chapters">
        {tcpLessonSpec.chapters.map((chapter, index) => (
          <button
            type="button"
            className={index === chapterIndex ? "active" : ""}
            aria-current={index === chapterIndex ? "step" : undefined}
            onClick={() => selectChapter(chapter.id)}
            key={chapter.id}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>
            <b>{chapter.title}</b>
            <i aria-hidden="true">
              <em
                style={{
                  width:
                    index < chapterIndex
                      ? "100%"
                      : index === chapterIndex
                        ? `${progress}%`
                        : "0%",
                }}
              />
            </i>
          </button>
        ))}
      </section>

      <section className="tcp-workbench">
        <div className="tcp-narration" aria-live="polite">
          <div className="tcp-event-number">
            <span>EVENT</span>
            <b>
              {player.index + 1} / {timeline.events.length}
            </b>
          </div>
          <div>
            <span>{event.chapterId.toUpperCase()}</span>
            <h2>{event.title}</h2>
            <p>{event.explanation}</p>
          </div>
          <div className="tcp-technical">
            <CircleHelp aria-hidden="true" />
            <p>{event.technical}</p>
          </div>
        </div>

        <ExperimentBar
          config={config}
          segmentCount={segmentCount}
          update={updateConfig}
        />

        <TcpSystemCanvas event={event} />

        {checkpoint && (
          <Checkpoint
            checkpoint={checkpoint}
            answer={answers[checkpoint.id]}
            choose={(answer) =>
              setAnswers((current) => ({
                ...current,
                [checkpoint.id]: answer,
              }))
            }
          />
        )}

        <section className="tcp-data-strip" aria-label="TCP byte stream">
          <div>
            <span>BYTE STREAM</span>
            <b>
              {event.snapshot.completedBytes.toLocaleString()} of{" "}
              {config.payloadBytes.toLocaleString()} bytes contiguous
            </b>
          </div>
          <div className="tcp-segments">
            {event.snapshot.segments.map((segment) => (
              <SegmentCell segment={segment} key={segment.id} />
            ))}
          </div>
        </section>

        <section className="tcp-control-deck" aria-label="Lesson playback">
          <button
            type="button"
            onClick={() => dispatch({ type: "RESET" })}
            aria-label="Reset lesson"
          >
            <RotateCcw aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "PREVIOUS" })}
            disabled={player.index === 0}
          >
            <ChevronLeft aria-hidden="true" />
            <span>Previous</span>
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => dispatch({ type: "TOGGLE" })}
          >
            {player.status === "playing" ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
            <span>{player.status === "playing" ? "Pause" : "Play"}</span>
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "NEXT" })}
            disabled={player.index === timeline.events.length - 1}
          >
            <span>Next event</span>
            <ChevronRight aria-hidden="true" />
          </button>
          <label>
            <span>Speed</span>
            <select
              value={player.speed}
              onChange={(change) =>
                dispatch({
                  type: "SET_SPEED",
                  speed: Number(change.target.value) as 0.75 | 1 | 1.5 | 2,
                })
              }
            >
              <option value="0.75">0.75×</option>
              <option value="1">1×</option>
              <option value="1.5">1.5×</option>
              <option value="2">2×</option>
            </select>
          </label>
          <label className="tcp-scrubber">
            <span className="sr-only">Lesson position</span>
            <input
              type="range"
              min="0"
              max={timeline.events.length - 1}
              value={player.index}
              onChange={(change) =>
                dispatch({ type: "SEEK", index: Number(change.target.value) })
              }
            />
          </label>
          <button
            type="button"
            className={showInspector ? "selected" : ""}
            aria-pressed={showInspector}
            onClick={() => setShowInspector((value) => !value)}
          >
            <Gauge aria-hidden="true" />
            <span>Inspect</span>
          </button>
        </section>

        {showInspector && <PacketInspector event={event} />}
      </section>
    </main>
  );
}

function ExperimentBar({
  config,
  segmentCount,
  update,
}: {
  config: TcpConfig;
  segmentCount: number;
  update: (patch: Partial<TcpConfig>) => void;
}) {
  const canLose = segmentCount >= 2;
  const canReorder = segmentCount >= 3 && config.receiveWindowSegments >= 2;
  return (
    <section className="tcp-experiment" aria-label="Change the TCP scenario">
      <div className="tcp-experiment-title">
        <FlaskConical aria-hidden="true" />
        <span>
          <b>Change the system</b>
          <small>Every value rebuilds the same deterministic timeline.</small>
        </span>
      </div>
      <div className="tcp-scenarios" aria-label="Network scenario">
        {(["normal", "loss", "reorder"] as const).map((scenario) => (
          <button
            type="button"
            className={config.scenario === scenario ? "active" : ""}
            aria-pressed={config.scenario === scenario}
            disabled={
              (scenario === "loss" && !canLose) ||
              (scenario === "reorder" && !canReorder)
            }
            onClick={() => update({ scenario })}
            key={scenario}
          >
            {scenario === "normal"
              ? "Normal path"
              : scenario === "loss"
                ? "Lose segment 2"
                : "Reorder segments"}
          </button>
        ))}
      </div>
      <label>
        <span>
          Payload <b>{config.payloadBytes.toLocaleString()} B</b>
        </span>
        <input
          type="range"
          min="500"
          max="8000"
          step="500"
          value={config.payloadBytes}
          onChange={(change) =>
            update({ payloadBytes: Number(change.target.value) })
          }
        />
      </label>
      <label>
        <span>MSS</span>
        <select
          value={config.mssBytes}
          onChange={(change) => update({ mssBytes: Number(change.target.value) })}
        >
          <option value="536">536 B</option>
          <option value="1200">1,200 B</option>
          <option value="1460">1,460 B</option>
        </select>
      </label>
      <label>
        <span>
          Receive window <b>{config.receiveWindowSegments} seg</b>
        </span>
        <input
          type="range"
          min="1"
          max="6"
          value={config.receiveWindowSegments}
          onChange={(change) =>
            update({ receiveWindowSegments: Number(change.target.value) })
          }
        />
      </label>
      <label>
        <span>
          Latency <b>{config.latencyMs} ms</b>
        </span>
        <input
          type="range"
          min="5"
          max="300"
          value={config.latencyMs}
          onChange={(change) =>
            update({ latencyMs: Number(change.target.value) })
          }
        />
      </label>
    </section>
  );
}

function TcpSystemCanvas({ event }: { event: TcpTimelineEvent }) {
  const packet = event.snapshot.packet;
  return (
    <section
      className="tcp-system-canvas"
      aria-label={`TCP simulation: ${event.title}`}
    >
      <div className="tcp-canvas-heading">
        <div>
          <Network aria-hidden="true" />
          <span>
            <b>Live system</b>
            <small>One event controls every highlighted state.</small>
          </span>
        </div>
        <div className="tcp-window-facts">
          <span>
            rwnd <b>{event.snapshot.receiveWindowSegments}</b>
          </span>
          <span>
            cwnd <b>{event.snapshot.congestionWindowSegments}</b>
          </span>
          <span>
            send window <b>{event.snapshot.sendWindowSegments}</b>
          </span>
        </div>
      </div>
      <div className="tcp-system-grid">
        <ComputerStack
          side="client"
          title="Computer A"
          subtitle="Browser · 192.168.1.8:52491"
          state={event.snapshot.clientState}
          packet={packet}
        />
        <NetworkPath packet={packet} />
        <ComputerStack
          side="server"
          title="Computer B"
          subtitle="Web server · 203.0.113.10:443"
          state={event.snapshot.serverState}
          packet={packet}
        />
      </div>
    </section>
  );
}

function ComputerStack({
  side,
  title,
  subtitle,
  state,
  packet,
}: {
  side: "client" | "server";
  title: string;
  subtitle: string;
  state: string;
  packet: TcpPacket | null;
}) {
  return (
    <section className={`tcp-computer ${side}`}>
      <header>
        <Server aria-hidden="true" />
        <span>
          <b>{title}</b>
          <small>{subtitle}</small>
        </span>
        <em>{state}</em>
      </header>
      <div className="tcp-layer-stack">
        {layers.map((layer, index) => {
          const location = `${side}-${layer.id}` as TcpLocation;
          const active = packet?.location === location;
          return (
            <div
              className={`tcp-layer ${active ? "active" : ""}`}
              data-layer={layer.id}
              key={layer.id}
            >
              <span>L{4 - index}</span>
              <div>
                <b>{layer.name}</b>
                <small>{layer.detail}</small>
              </div>
              {active && packet && <PacketGlyph packet={packet} compact />}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NetworkPath({ packet }: { packet: TcpPacket | null }) {
  const positions: { id: TcpLocation; title: string; detail: string }[] = [
    { id: "local-network", title: "Gateway", detail: "first hop" },
    { id: "router", title: "Router", detail: "forward IP" },
    { id: "internet", title: "Internet", detail: "many possible hops" },
    {
      id: "destination-network",
      title: "Final router",
      detail: "destination link",
    },
  ];
  return (
    <section className="tcp-network-path">
      <header>
        <span>NETWORK PATH</span>
        <small>Link frames change. The IP destination persists.</small>
      </header>
      <div className="tcp-route">
        {positions.map((position, index) => {
          const active = packet?.location === position.id;
          return (
            <div className="tcp-hop-wrap" key={position.id}>
              <div className={`tcp-hop ${active ? "active" : ""}`}>
                <span>{index + 1}</span>
                <b>{position.title}</b>
                <small>{position.detail}</small>
                {active && packet && <PacketGlyph packet={packet} />}
              </div>
              {index < positions.length - 1 && (
                <ChevronRight className="tcp-route-arrow" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PacketGlyph({
  packet,
  compact = false,
}: {
  packet: TcpPacket;
  compact?: boolean;
}) {
  return (
    <div
      className={`tcp-packet ${packet.lost ? "lost" : ""} ${compact ? "compact" : ""}`}
      aria-label={`${packet.label}, sequence ${packet.seq}${packet.ack === undefined ? "" : `, acknowledgment ${packet.ack}`}`}
    >
      <strong>{packet.label}</strong>
      {!compact && (
        <span>
          {packet.wrappers.map((wrapper) => (
            <i data-wrapper={wrapper} key={wrapper}>
              {wrapper === "application" ? "DATA" : wrapper.toUpperCase()}
            </i>
          ))}
        </span>
      )}
      <small>
        SEQ {packet.seq}
        {packet.ack !== undefined ? ` · ACK ${packet.ack}` : ""}
      </small>
    </div>
  );
}

function SegmentCell({ segment }: { segment: TcpSegment }) {
  return (
    <div className={`tcp-segment ${segment.status}`}>
      <span>
        <b>#{segment.id}</b>
        <em>{segment.status}</em>
      </span>
      <small>
        {segment.seqStart}–{segment.seqEnd}
      </small>
      <i aria-hidden="true" />
    </div>
  );
}

function Checkpoint({
  checkpoint,
  answer,
  choose,
}: {
  checkpoint: (typeof tcpLessonSpec.checkpoints)[number];
  answer: number | undefined;
  choose: (answer: number) => void;
}) {
  return (
    <section className="tcp-checkpoint">
      <div>
        <BookOpen aria-hidden="true" />
        <span>
          <small>PREDICT BEFORE CONTINUING</small>
          <h3>{checkpoint.prompt}</h3>
        </span>
      </div>
      <div className="tcp-choices">
        {checkpoint.choices.map((choice, index) => (
          <button
            type="button"
            className={
              answer === undefined
                ? ""
                : index === checkpoint.correctIndex
                  ? "correct"
                  : answer === index
                    ? "incorrect"
                    : ""
            }
            onClick={() => choose(index)}
            key={choice}
          >
            <span>{String.fromCharCode(65 + index)}</span>
            {choice}
            {answer !== undefined && index === checkpoint.correctIndex && (
              <Check aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      {answer !== undefined && (
        <p className={answer === checkpoint.correctIndex ? "correct" : ""}>
          {answer === checkpoint.correctIndex ? "Correct. " : "Look again. "}
          {checkpoint.explanation}
        </p>
      )}
    </section>
  );
}

function PacketInspector({ event }: { event: TcpTimelineEvent }) {
  const packet = event.snapshot.packet;
  return (
    <section className="tcp-inspector">
      <header>
        <Gauge aria-hidden="true" />
        <div>
          <span>STATE INSPECTOR</span>
          <h3>{packet ? packet.label : "Connection state"}</h3>
        </div>
      </header>
      <dl>
        <div>
          <dt>Client TCP</dt>
          <dd>{event.snapshot.clientState}</dd>
        </div>
        <div>
          <dt>Server TCP</dt>
          <dd>{event.snapshot.serverState}</dd>
        </div>
        <div>
          <dt>Next byte expected</dt>
          <dd>{event.snapshot.receiverNextByte}</dd>
        </div>
        <div>
          <dt>Contiguous bytes</dt>
          <dd>{event.snapshot.completedBytes.toLocaleString()} B</dd>
        </div>
        {packet && (
          <>
            <div>
              <dt>Direction</dt>
              <dd>
                {packet.direction === "client-to-server"
                  ? "Client → Server"
                  : "Server → Client"}
              </dd>
            </div>
            <div>
              <dt>Flags</dt>
              <dd>{packet.flags.length ? packet.flags.join(" + ") : "None"}</dd>
            </div>
            <div>
              <dt>Sequence</dt>
              <dd>{packet.seq}</dd>
            </div>
            <div>
              <dt>Acknowledgment</dt>
              <dd>{packet.ack ?? "Not set"}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="tcp-wrapper-stack">
        <span>VISIBLE WRAPPERS</span>
        <div>
          {packet?.wrappers.length ? (
            packet.wrappers.map((wrapper) => (
              <b data-wrapper={wrapper} key={wrapper}>
                {wrapper === "application" ? "Application data" : wrapper}
              </b>
            ))
          ) : (
            <small>No packet is active in this event.</small>
          )}
        </div>
      </div>
    </section>
  );
}
