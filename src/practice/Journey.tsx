// Follow the Journey on the diagram: a card beside the active device, compact controls under the
// canvas, and the full list of steps. All of it reads one position: the current event index.
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { StepExplanation } from "./StepExplanation.tsx";
import { narrate } from "./network/narration.ts";
import { stageAt, type Stage } from "./network/stages.ts";
import { neighbours, place, type JourneyMode, type Point } from "./journey-nav.ts";
export { MODE_KEY, type JourneyMode, type Point } from "./journey-nav.ts";
import type { Network, Trace } from "./network/model.ts";

export function JourneyControls({
  trace,
  stages,
  index,
  mode,
  playing,
  speed,
  network,
  onStep,
  onPlay,
  onMode,
  onSpeed,
  onShowStop,
}: {
  trace: Trace | null;
  stages: Stage[];
  index: number;
  mode: JourneyMode;
  playing: boolean;
  speed: number;
  network: Network;
  onStep: (i: number) => void;
  onPlay: () => void;
  onMode: (m: JourneyMode) => void;
  onSpeed: (s: number) => void;
  onShowStop: () => void;
}) {
  const last = (trace?.events.length ?? 1) - 1;
  const k = stageAt(stages, index);
  const { prev, next } = neighbours(mode, stages, index, last);
  const unit = mode === "summary" ? "stage" : "event";
  const stoppedBy = trace && !trace.success ? network.devices.find((d) => d.id === trace.events[last].actor)?.name : "";
  return (
    <div className="journey-controls" aria-label="Journey controls" role="group">
      <div className="journey-buttons">
        <button aria-label="First event" disabled={!trace || index === 0} onClick={() => onStep(0)}>
          <SkipBack size={15} />
        </button>
        <button aria-label={`Previous ${unit}`} disabled={!trace || index === 0} onClick={() => onStep(prev)}>
          <ChevronLeft size={18} />
        </button>
        <button className="play-button" aria-label={playing ? "Pause playback" : "Play journey"} disabled={!trace} onClick={onPlay}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button aria-label={`Next ${unit}`} disabled={!trace || index >= last} onClick={() => onStep(next)}>
          <ChevronRight size={18} />
        </button>
        <button aria-label="Last event" disabled={!trace || index >= last} onClick={() => onStep(last)}>
          <SkipForward size={15} />
        </button>
      </div>
      <div className="journey-position">
        {trace ? (
          <>
            <b>{mode === "summary" ? stages[k]?.title : trace.events[index].title}</b>
            <small>
              {mode === "summary"
                ? `Stage ${k + 1} of ${stages.length} · event ${index + 1} of ${last + 1}`
                : `Event ${index + 1} of ${last + 1} · stage ${k + 1} of ${stages.length}`}
            </small>
          </>
        ) : (
          <>
            <b>Follow the journey</b>
            <small>Send something to watch it travel.</small>
          </>
        )}
      </div>
      <div className="journey-mode" role="radiogroup" aria-label="Timeline view">
        {(["summary", "events"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "active" : ""} onClick={() => onMode(m)}>
            {m === "summary" ? "Summary" : "Every event"}
          </button>
        ))}
      </div>
      <select aria-label="Playback speed" value={speed} onChange={(e) => onSpeed(Number(e.target.value))}>
        {[0.5, 1, 2, 4, 8].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <input
        className="timeline-slider"
        type="range"
        aria-label="Journey timeline"
        min={0}
        max={Math.max(1, last)}
        value={index}
        disabled={!trace}
        onChange={(e) => onStep(Number(e.target.value))}
      />
      {trace && (
        <div className={`run-status ${trace.success ? "success" : "failure"}`} role="status">
          {trace.success ? <Check size={14} /> : <span aria-hidden="true">!</span>}
          {trace.success ? (
            <span>{trace.summary}</span>
          ) : (
            <span>
              <b>Delivery stopped{stoppedBy ? ` at ${stoppedBy}` : ""}.</b>{" "}
              {index !== last && (
                <button className="text-button stop-link" onClick={onShowStop}>
                  Show where and why
                </button>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function JourneyCard({
  trace,
  stages,
  index,
  mode,
  network,
  playing,
  positions,
  open,
  onOpen,
  onStep,
  onInspect,
  onReadDetails,
}: {
  trace: Trace;
  stages: Stage[];
  index: number;
  mode: JourneyMode;
  network: Network;
  playing: boolean;
  positions: Record<string, Point>;
  open: boolean;
  onOpen: (open: boolean) => void;
  onStep: (i: number) => void;
  onInspect: () => void;
  onReadDetails: () => void;
}) {
  const card = useRef<HTMLElement>(null);
  const [spot, setSpot] = useState<Point | null>(null);
  const [details, setDetails] = useState(false);
  const event = trace.events[index];
  const k = stageAt(stages, index);
  const stage = stages[k];
  const n = narrate(trace.events, index, network);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  // During playback the card stays with the stage instead of jumping with every event.
  const anchorId = playing || mode === "summary" ? trace.events[stage.end].actor : event.actor;
  const complete = index === stage.end;
  const avoidIds = [...new Set([...stage.devices, ...stage.hops.flatMap((h) => [h.from, h.to])])];
  useLayoutEffect(() => {
    const el = card.current,
      area = el?.parentElement?.querySelector(".network-canvas");
    const origin = area?.getBoundingClientRect();
    // The canvas's own buttons must stay reachable.
    const controls = [...(area?.querySelectorAll(".canvas-zoom, .internet-toggle") ?? [])].map((c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left - origin!.left, y: r.top - origin!.top, w: r.width, h: r.height };
    });
    const anchor = positions[anchorId];
    if (!el || !area || !anchor) return setSpot(null);
    const next = place(
      anchor,
      { w: el.offsetWidth, h: el.offsetHeight },
      { w: area.clientWidth, h: area.clientHeight },
      avoidIds.filter((id) => id !== anchorId).flatMap((id) => (positions[id] ? [positions[id]] : [])),
      controls,
    );
    setSpot((old) => (old && Math.abs(old.x - next.x) < 2 && Math.abs(old.y - next.y) < 2 ? old : next));
  });
  const [room, setRoom] = useState(0);
  useLayoutEffect(() => {
    const height = card.current?.parentElement?.querySelector(".network-canvas")?.clientHeight ?? 0;
    if (height !== room) setRoom(height);
  });
  // The card never grows past the canvas onto the controls; it scrolls inside instead.
  const style = spot
    ? ({ "--card-x": `${spot.x}px`, "--card-y": `${spot.y}px`, "--card-max": `${room - 16}px` } as CSSProperties)
    : undefined;
  if (!open)
    return (
      <button className="journey-reopen" style={style} onClick={() => onOpen(true)} aria-label="Show the explanation">
        <Maximize2 size={14} /> Explain this step
      </button>
    );
  const title = mode === "summary" ? stage.title : event.title;
  // A stage's summary is only shown once all of its events have happened.
  const text = event.error ? event.explanation : mode === "summary" && complete ? stage.summary : n.summary;
  return (
    <section
      ref={card}
      className={`journey-card ${event.error ? "is-error" : ""} ${spot ? "is-placed" : ""} ${details ? "has-details" : ""}`}
      style={style}
      aria-label="Explanation of the current step"
    >
      <header>
        <span className="eyebrow">
          {name(event.actor)} · {event.location}
        </span>
        <button className="icon-button" aria-label="Hide the explanation" onClick={() => onOpen(false)}>
          <Minimize2 size={14} />
        </button>
      </header>
      <h3>{n.failure?.title ?? title}</h3>
      {mode === "summary" && !complete && (
        <p className="journey-progress">
          In progress: event {index - stage.start + 1} of {stage.end - stage.start + 1} in this stage.
        </p>
      )}
      <p className="journey-summary">{text}</p>
      {!details && n.cause && !event.error && (
        <p className="journey-why">
          <b>Why:</b> {n.cause.text}
        </p>
      )}
      {details && (
        <div className="journey-details">
          <StepExplanation events={trace.events} index={index} network={network} onReadDetails={onReadDetails} onGoto={onStep} embedded />
        </div>
      )}
      <footer>
        <button
          className="text-button"
          aria-expanded={details}
          onClick={() => {
            setDetails((d) => !d);
            onReadDetails();
          }}
        >
          {details ? "Less detail" : event.error ? "Why it stopped" : "Why and how"}
        </button>
        {event.layers.length > 0 && (
          <button className="text-button" onClick={onInspect}>
            <Layers size={13} /> Inspect packet
          </button>
        )}
      </footer>
    </section>
  );
}

/** Every stage, and inside it every event: the complete technical timeline. */
export function StepsList({
  trace,
  stages,
  index,
  mode,
  network,
  onStep,
}: {
  trace: Trace;
  stages: Stage[];
  index: number;
  mode: JourneyMode;
  network: Network;
  onStep: (i: number) => void;
}) {
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const current = stageAt(stages, index);
  const event = (i: number) => (
    <li key={i}>
      <button aria-current={i === index ? "step" : undefined} onClick={() => onStep(i)}>
        <span>{i + 1}</span>
        <b>{trace.events[i].title}</b>
        <small>{name(trace.events[i].actor)}</small>
      </button>
    </li>
  );
  return (
    <div className="steps-list">
      <div className="inspector-intro">
        <span className="eyebrow">THE WHOLE JOURNEY</span>
        <h2>{mode === "summary" ? `${stages.length} stages` : `${trace.events.length} events`}</h2>
        <p>Select a step to show it on the diagram. Every recorded event is here.</p>
      </div>
      {mode === "summary" ? (
        <ol className="stage-list">
          {stages.map((s, k) => (
            <li key={s.start} className={s.error ? "is-error" : ""}>
              <details open={k === current}>
                <summary>
                  <span>{k + 1}</span>
                  <b>{s.title}</b>
                  <small>{s.end - s.start + 1} {s.end === s.start ? "event" : "events"}</small>
                </summary>
                <button className="text-button" onClick={() => onStep(s.end)}>
                  Show this stage
                </button>
                <ol className="event-list">{Array.from({ length: s.end - s.start + 1 }, (_, j) => event(s.start + j))}</ol>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="event-list">{trace.events.map((_, i) => event(i))}</ol>
      )}
    </div>
  );
}
