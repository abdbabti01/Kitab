import { optionOrder, variantFor, type PredictionAnswer, type PredictionResult } from "./assessment.ts";
import type { Mission } from "./mission-schema.ts";
import type { FactValue } from "./types.ts";

/** Learning phase. Deliberately separate from playback (index/speed/status). */
export type Phase = "inspect" | "predict" | "run" | "explain" | "result";

export type Attempt = {
  id: string;
  number: number;
  variantId: string;
  params: Record<string, FactValue>;
  optionOrder: string[];
  prediction: { answer: PredictionAnswer; correct: boolean; misconception?: string; reasoning: string } | null;
  skippedPrediction: boolean;
  runCompleted: boolean;
  explanation: { choiceId: string; correct: boolean; misconception?: string } | null;
  reflection: string;
  mastered: boolean;
};

export type MissionState = { missionId: string; missionVersion: string; phase: Phase; attempt: Attempt };

export type MissionAction =
  | { type: "BEGIN_PREDICTION" }
  | { type: "SUBMIT_PREDICTION"; answer: PredictionAnswer; result: PredictionResult; reasoning: string }
  | { type: "SKIP_PREDICTION" }
  | { type: "RUN_COMPLETED" }
  | { type: "SUBMIT_EXPLANATION"; choiceId: string; correct: boolean; misconception?: string }
  | { type: "SET_REFLECTION"; text: string }
  | { type: "NEW_ATTEMPT"; attempt: Attempt };

export const REASONING_LIMIT = 600;

function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createAttempt(mission: Mission, number: number, custom?: Record<string, FactValue>, id: string = randomId()): Attempt {
  const variant = variantFor(mission, number);
  const optionIds = mission.prediction.kind === "choice" ? mission.prediction.options.map((option) => option.id) : [];
  return {
    id,
    number,
    variantId: custom ? "custom" : variant.id,
    params: custom ?? variant.params,
    optionOrder: optionOrder(`${mission.id}:${id}`, optionIds),
    prediction: null,
    skippedPrediction: false,
    runCompleted: false,
    explanation: null,
    reflection: "",
    mastered: false,
  };
}

export function createMissionState(mission: Mission, attempt = createAttempt(mission, 1)): MissionState {
  return { missionId: mission.id, missionVersion: mission.version, phase: "inspect", attempt };
}

export function missionReducer(state: MissionState, action: MissionAction): MissionState {
  const attempt = state.attempt;
  switch (action.type) {
    case "BEGIN_PREDICTION":
      return state.phase === "inspect" ? { ...state, phase: "predict" } : state;
    case "SUBMIT_PREDICTION":
      if (state.phase !== "predict" && state.phase !== "inspect") return state;
      return {
        ...state,
        phase: "run",
        attempt: {
          ...attempt,
          prediction: { answer: action.answer, correct: action.result.correct, misconception: action.result.misconception, reasoning: action.reasoning.trim().slice(0, REASONING_LIMIT) },
        },
      };
    case "SKIP_PREDICTION":
      if (state.phase !== "predict" && state.phase !== "inspect") return state;
      return { ...state, phase: "run", attempt: { ...attempt, skippedPrediction: true } };
    case "RUN_COMPLETED":
      if (state.phase !== "run") return state;
      return { ...state, phase: "explain", attempt: { ...attempt, runCompleted: true } };
    case "SUBMIT_EXPLANATION": {
      if (state.phase !== "explain" || !action.choiceId) return state;
      const mastered = Boolean(attempt.prediction?.correct && !attempt.skippedPrediction && attempt.runCompleted && action.correct);
      return { ...state, phase: "result", attempt: { ...attempt, explanation: { choiceId: action.choiceId, correct: action.correct, misconception: action.misconception }, mastered } };
    }
    case "SET_REFLECTION":
      return { ...state, attempt: { ...attempt, reflection: action.text.slice(0, REASONING_LIMIT) } };
    case "NEW_ATTEMPT":
      return { ...state, phase: "inspect", attempt: action.attempt };
  }
}

/** Plain-language status. Visiting and watching are never "mastered". */
export function attemptStatus(attempt: Attempt) {
  if (attempt.mastered) return "mastered";
  if (attempt.skippedPrediction) return "watched";
  if (attempt.explanation) return attempt.prediction?.correct ? "explanation-missed" : "prediction-missed";
  if (attempt.prediction) return "predicted";
  return "started";
}
