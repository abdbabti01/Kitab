export type PlaybackStatus = "idle" | "playing" | "paused" | "complete";

export type PlaybackState = {
  index: number;
  status: PlaybackStatus;
  speed: 0.75 | 1 | 1.5 | 2;
  eventCount: number;
};

export type PlaybackAction =
  | { type: "NEXT" }
  | { type: "PREVIOUS" }
  | { type: "SEEK"; index: number }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE" }
  | { type: "RESET" }
  | { type: "SET_SPEED"; speed: PlaybackState["speed"] }
  | { type: "REBASE"; eventCount: number };

function clampIndex(index: number, eventCount: number) {
  return Math.max(0, Math.min(Math.max(0, eventCount - 1), index));
}

export function createPlaybackState(eventCount: number): PlaybackState {
  return { index: 0, status: "idle", speed: 1, eventCount };
}

export function playbackReducer(
  state: PlaybackState,
  action: PlaybackAction,
): PlaybackState {
  switch (action.type) {
    case "NEXT": {
      const index = clampIndex(state.index + 1, state.eventCount);
      return {
        ...state,
        index,
        status: index === state.eventCount - 1 ? "complete" : state.status,
      };
    }
    case "PREVIOUS":
      return {
        ...state,
        index: clampIndex(state.index - 1, state.eventCount),
        status: "paused",
      };
    case "SEEK": {
      const index = clampIndex(action.index, state.eventCount);
      return {
        ...state,
        index,
        status: index === state.eventCount - 1 ? "complete" : "paused",
      };
    }
    case "PLAY":
      return state.index === state.eventCount - 1
        ? { ...state, index: 0, status: "playing" }
        : { ...state, status: "playing" };
    case "PAUSE":
      return { ...state, status: "paused" };
    case "TOGGLE":
      return playbackReducer(state, {
        type: state.status === "playing" ? "PAUSE" : "PLAY",
      });
    case "RESET":
      return { ...state, index: 0, status: "idle" };
    case "SET_SPEED":
      return { ...state, speed: action.speed };
    case "REBASE":
      return {
        ...state,
        eventCount: action.eventCount,
        index: clampIndex(state.index, action.eventCount),
        status: "idle",
      };
  }
}

export type SimulationTimeline<TEvent> = {
  events: TEvent[];
  terminalEventId: string;
};

export function assertCompleteTimeline<TEvent extends { id: string }>(
  timeline: SimulationTimeline<TEvent>,
) {
  if (timeline.events.length < 2) {
    throw new Error("A lesson timeline requires at least two events.");
  }
  const ids = new Set(timeline.events.map((event) => event.id));
  if (ids.size !== timeline.events.length) {
    throw new Error("Simulation event ids must be unique.");
  }
  if (timeline.events.at(-1)?.id !== timeline.terminalEventId) {
    throw new Error("The terminal event must be the final timeline event.");
  }
}

