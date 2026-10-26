/**
 * Kitab guide contract. Topic-independent: domain text arrives in events from
 * mission content or engine facts; the guide only chooses a mood, a message
 * and an optional entity to point at.
 */
export type GuideMood = "idle" | "welcoming" | "thinking" | "explaining" | "pointing" | "encouraging" | "celebrating" | "unavailable";

export type GuideEvent =
  | { type: "mission-opened"; objective: string; returning: boolean }
  | { type: "object-selected"; entityId: string; label: string; summary: string }
  | { type: "prediction-started" }
  | { type: "prediction-submitted" }
  | { type: "run-started" }
  | { type: "run-paused" }
  | { type: "run-completed"; correct: boolean | null }
  | { type: "hint-requested"; text: string; target?: string }
  | { type: "misconception-identified"; label: string; message: string; target?: string }
  | { type: "explanation-assessed"; correct: boolean; message?: string }
  | { type: "mastered" }
  | { type: "retry-started"; variantLabel: string }
  | { type: "tutor-pending" }
  | { type: "tutor-response"; text: string; target?: string; source: "ai" | "fallback" }
  | { type: "tutor-failed"; fallbackText: string; target?: string }
  | { type: "toggle-collapsed" };

export type GuideState = {
  mood: GuideMood;
  message: string;
  detail?: string;
  /** Entity id to highlight. Validated against the current frame by the shell. */
  target?: string;
  source?: "ai" | "fallback" | "content";
  collapsed: boolean;
  /** Increments only when the message changes, so live regions announce once. */
  seq: number;
};

export const initialGuide: GuideState = { mood: "idle", message: "", collapsed: false, seq: 0 };

function say(state: GuideState, mood: GuideMood, message: string, extra: Partial<GuideState> = {}): GuideState {
  const next = { ...state, mood, message, detail: extra.detail, target: extra.target, source: extra.source ?? "content" };
  return next.message === state.message && next.mood === state.mood && next.target === state.target ? state : { ...next, seq: state.seq + 1 };
}

export function guideReducer(state: GuideState, event: GuideEvent): GuideState {
  switch (event.type) {
    case "mission-opened":
      return say(state, "welcoming", event.returning ? "Welcome back. Your last attempt is restored." : "Hi, I'm Kitab. Inspect the scene first, then commit to a prediction.", { detail: event.objective });
    case "object-selected":
      return say(state, "pointing", `That's ${event.label}.`, { detail: event.summary, target: event.entityId });
    case "prediction-started":
      return say(state, "thinking", "Take your time. Pick the answer you'd defend, and say why if you like.");
    case "prediction-submitted":
      return say(state, "thinking", "Locked in. Run it and watch the highlighted state change.");
    case "run-started":
      return state.mood === "idle" ? state : say(state, "idle", "Watching with you. Pause anytime to inspect.");
    case "run-paused":
      return say(state, "idle", "Paused. Select anything in the scene to inspect it.");
    case "run-completed":
      if (event.correct === null) return say(state, "explaining", "That's the full run. Now pick the evidence that explains it.");
      return event.correct
        ? say(state, "encouraging", "Your prediction matched the run. Can you name the evidence?")
        : say(state, "pointing", "The run didn't match your prediction. Let's look at the evidence together.");
    case "hint-requested":
      return say(state, "explaining", event.text, { target: event.target });
    case "misconception-identified":
      return say(state, "pointing", event.message, { detail: event.label, target: event.target });
    case "explanation-assessed":
      return event.correct ? say(state, "encouraging", "That's the right evidence.") : say(state, "encouraging", event.message ?? "Not quite. Compare that choice with the highlighted facts.");
    case "mastered":
      return say(state, "celebrating", "You predicted it and explained why. That's real understanding.");
    case "retry-started":
      return say(state, "encouraging", `New scenario: ${event.variantLabel}. The numbers changed, so reason from the mechanism.`);
    case "tutor-pending":
      return say(state, "thinking", "Let me check the trace…");
    case "tutor-response":
      return say(state, "explaining", event.text, { target: event.target, source: event.source });
    case "tutor-failed":
      return say(state, "unavailable", "I couldn't reach my tutor service, so here's the reviewed explanation.", { detail: event.fallbackText, target: event.target, source: "fallback" });
    case "toggle-collapsed":
      return { ...state, collapsed: !state.collapsed };
  }
}
