// Follow the Journey on the diagram: a card beside the active device, compact controls under the
// canvas, and the full list of steps. All of it reads one position: the current event index.
import { useState } from "react";
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
import { failureText } from "./network/explanations.ts";
import { narrate } from "./network/narration.ts";
import { stageAt, type Stage } from "./network/stages.ts";
import { actionAt, type Beat } from "./network/motion.ts";
import { neighbours, type JourneyMode } from "./journey-nav.ts";
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
  outcomeHidden = false,
  outcomeShown = true,
}: {
  /** The result is kept back until playback reaches it (or the learner goes to the end). */
  outcomeShown?: boolean;
  /** Later events are hidden (Predict as you go): the outcome is not given away. */
  outcomeHidden?: boolean;
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
  const unit = mode !== "events" ? "stage" : "event";
  const stoppedBy = trace && !trace.success ? network.devices.find((d) => d.id === trace.events[last].actor)?.name : "";
  // What playback is doing. At the end of a run whose outcome is hidden it waits for the prediction.
  const state = !trace ? null : outcomeHidden && index >= last ? "waiting" : playing ? "playing" : index < last ? "paused" : trace.success ? "complete" : "stopped";
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
            <b>{mode !== "events" ? stages[k]?.title : trace.events[index].title}</b>
            <small>
              {state && (
                <span className={`playback-state is-${state}`}>
                  {{ playing: "Playing", paused: "Paused", complete: "Complete", stopped: "Delivery stopped", waiting: "Waiting for your prediction" }[state]}
                </span>
              )}{" "}
              {/* With the rest of the run hidden, its length is too: only the visible step is counted. */}
              {outcomeHidden
                ? `Step ${index + 1}${index < last ? " · the rest appears after your prediction" : ""}`
                : mode !== "events"
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
        {(["summary", "events", "exchange"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "active" : ""} onClick={() => onMode(m)}>
            {m === "summary" ? "Summary" : m === "events" ? "Every event" : "Exchange"}
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
        aria-valuetext={trace ? (outcomeHidden ? `Step ${index + 1}, later steps hidden` : `Event ${index + 1} of ${last + 1}`) : undefined}
        onChange={(e) => onStep(Math.min(last, Number(e.target.value)))}
      />
      {trace && outcomeHidden && (
        <div className="run-status" role="status">
          <span>The rest of this run appears once you answer the prediction or choose Show me.</span>
        </div>
      )}
      {trace && !outcomeHidden && outcomeShown && (
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
  open,
  onOpen,
  onStep,
  onInspect,
  onAbout,
  onReadDetails,
  advice = true,
  beats = [],
  hiddenAfter = false,
}: {
  /** What each event shows (motion.ts): while playing a stage, routine repeats are not narrated one by one. */
  beats?: Beat[];
  /** The rest of the run is hidden until a prediction is made: "next" must not give it away. */
  hiddenAfter?: boolean;
  trace: Trace;
  stages: Stage[];
  index: number;
  mode: JourneyMode;
  network: Network;
  playing: boolean;
  open: boolean;
  onOpen: (open: boolean) => void;
  onStep: (i: number) => void;
  onInspect: () => void;
  onAbout: (device: string) => void;
  onReadDetails: () => void;
  /** False in missions: the simulator's diagnosis and repair advice are left for the learner to work out. */
  advice?: boolean;
}) {
  const [details, setDetails] = useState(false);
  const k = stageAt(stages, index);
  const stage = stages[k];
  // Playing a stage, the card stays on the latest event of it that did something new; routine repeats pass by
  // in a fraction of a second and would only flicker. Stepping, or in Every event, it shows each event.
  let shown = index;
  if (playing && mode !== "events") while (shown > stage.start && beats[shown] === "routine") shown -= 1;
  const event = trace.events[shown];
  const n = narrate(trace.events, shown, network);
  const name = (id: string) => network.devices.find((d) => d.id === id)?.name ?? id;
  const complete = index === stage.end;
  if (!open)
    return (
      <button className="journey-reopen" onClick={() => onOpen(true)} aria-label="Show the explanation">
        <Maximize2 size={14} /> Explain this step
      </button>
    );
  const title = mode !== "events" ? stage.title : event.title;
  // A stage's summary is only shown once all of its events have happened.
  const text = event.error
    ? failureText(event, advice)
    : mode !== "events" && complete
      ? stage.summary
      : n.summary;
  // The link or address this step involves, as recorded: the link a frame crosses, or the decision's result.
  const action = actionAt(event, network);
  const where = event.hop
    ? `On the link ${name(event.hop.from)} → ${name(event.hop.to)}${action.detail ? ` · ${action.detail}` : ""}`
    : action.detail;
  // What comes next, without giving away a hidden part of the run or the run's result before it is reached.
  const after = trace.events[index + 1];
  const next = hiddenAfter && !after
    ? "Waiting for your prediction."
    : after && !after.error && index + 1 < trace.events.length - 1
      ? `${name(after.actor)} · ${after.title}`
      : "";
  return (
    <section className={`journey-card ${event.error ? "is-error" : ""} ${details ? "has-details" : ""}`} aria-label="Explanation of the current step">
      <header>
        <span className="eyebrow">
          {mode !== "events" ? "Now at " : ""}
          {name(event.actor)} · {event.location}
        </span>
        <button className="icon-button" aria-label="Hide the explanation" onClick={() => onOpen(false)}>
          <Minimize2 size={14} />
        </button>
      </header>
      <h2>{n.failure?.title ?? title}</h2>
      {mode !== "events" && !complete && (
        <p className="journey-progress">
          In progress: event {index - stage.start + 1} of {stage.end - stage.start + 1} in this stage.
        </p>
      )}
      <p className="journey-summary">{text}</p>
      {where && <p className="journey-where">{where}</p>}
      {!details && n.cause && !event.error && (
        <p className="journey-why">
          <b>Why:</b> {n.cause.text}
        </p>
      )}
      {details && (
        <div className="journey-details">
          <StepExplanation events={trace.events} index={index} network={network} onReadDetails={onReadDetails} onGoto={onStep} embedded advice={advice} />
        </div>
      )}
      {next && (
        <p className="journey-next">
          <b>Next:</b> {next}
        </p>
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
        <button className="text-button journey-about" onClick={() => onAbout(event.actor)}>
          About {name(event.actor)}
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
        <h2>{mode !== "events" ? `${stages.length} stages` : `${trace.events.length} events`}</h2>
        <p>Select a step to show it on the diagram. Every recorded event is here.</p>
      </div>
      {mode !== "events" ? (
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
