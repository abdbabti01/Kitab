import { useEffect, useReducer } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import { createPlaybackState, playbackReducer, type PlaybackState } from "../visual-engine/core/simulation.ts";
import type { Trace } from "../learning/types.ts";

type Keyed = PlaybackState & { key: string };
type Action = Parameters<typeof playbackReducer>[1] | { type: "LOAD"; key: string; eventCount: number };

function reducer(state: Keyed, action: Action): Keyed {
  if (action.type === "LOAD") return { ...createPlaybackState(action.eventCount), speed: state.speed, key: action.key };
  return { ...playbackReducer(state, action), key: state.key };
}

/**
 * Playback position belongs to one trace. When the scenario changes, the
 * index from the previous trace is ignored in the same render (before any
 * effect runs), which removes the stale-index crash class entirely.
 */
export function usePlayback(trace: Trace, enabled: boolean) {
  const [raw, dispatch] = useReducer(reducer, undefined, () => ({ ...createPlaybackState(trace.frames.length), key: trace.scenarioKey }));
  const current = raw.key === trace.scenarioKey;
  const state: Keyed = current ? raw : { ...createPlaybackState(trace.frames.length), speed: raw.speed, key: trace.scenarioKey };

  useEffect(() => {
    if (!current) dispatch({ type: "LOAD", key: trace.scenarioKey, eventCount: trace.frames.length });
  }, [current, trace.scenarioKey, trace.frames.length]);

  const index = Math.max(0, Math.min(trace.frames.length - 1, state.index));
  const frame = trace.frames[index];

  useEffect(() => {
    if (!enabled || !current || state.status !== "playing") return;
    if (index >= trace.frames.length - 1) {
      dispatch({ type: "PAUSE" });
      return;
    }
    const timer = window.setTimeout(() => dispatch({ type: "NEXT" }), frame.durationMs / state.speed);
    return () => window.clearTimeout(timer);
  }, [enabled, current, state.status, state.speed, index, frame.durationMs, trace.frames.length]);

  return { index, status: enabled ? state.status : "idle", speed: state.speed, dispatch, frameCount: trace.frames.length };
}

export type PlaybackApi = ReturnType<typeof usePlayback>;

export function PlaybackBar({ playback, trace, enabled, disabledReason }: { playback: PlaybackApi; trace: Trace; enabled: boolean; disabledReason: string }) {
  const { index, status, speed, dispatch, frameCount } = playback;
  const last = index >= frameCount - 1;
  const frame = trace.frames[index];
  return (
    <div className="playback" role="group" aria-label="Playback">
      {!enabled && <p className="playback-note">{disabledReason}</p>}
      <div className="playback-row">
        <button type="button" className="icon-button" onClick={() => dispatch({ type: "SEEK", index: 0 })} disabled={!enabled || index === 0} aria-label="Restart run">
          <RotateCcw aria-hidden="true" />
        </button>
        <button type="button" className="icon-button" onClick={() => dispatch({ type: "PREVIOUS" })} disabled={!enabled || index === 0} aria-label="Previous step">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="play-button" onClick={() => dispatch({ type: "TOGGLE" })} disabled={!enabled} aria-label={status === "playing" ? "Pause" : last ? "Replay" : "Play"}>
          {status === "playing" ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          <span>{status === "playing" ? "Pause" : last ? "Replay" : "Play"}</span>
        </button>
        <button type="button" className="icon-button" onClick={() => dispatch({ type: "NEXT" })} disabled={!enabled || last} aria-label="Next step">
          <ChevronRight aria-hidden="true" />
        </button>
        <label className="scrubber">
          <span className="sr-only">Step</span>
          <input
            type="range"
            min={0}
            max={frameCount - 1}
            value={index}
            disabled={!enabled}
            aria-valuetext={`Step ${index + 1} of ${frameCount}: ${frame.title}`}
            onChange={(event) => dispatch({ type: "SEEK", index: Number(event.target.value) })}
          />
        </label>
        <span className="step-count" aria-hidden="true">{index + 1}/{frameCount}</span>
        <label className="speed">
          <span className="sr-only">Speed</span>
          <select value={speed} disabled={!enabled} onChange={(event) => dispatch({ type: "SET_SPEED", speed: Number(event.target.value) as PlaybackState["speed"] })}>
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
      </div>
    </div>
  );
}
