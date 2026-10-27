import { resolvePredictionOptions } from "../learning/assessment.ts";
import type { Attempt } from "../learning/mission-controller.ts";
import type { Mission } from "../learning/mission-schema.ts";
import type { Trace } from "../learning/types.ts";

/** The learner's answer and the engine's answer, as text. Shared by the phase panel and the scene header. */
export function predictionSummary(mission: Mission, trace: Trace, attempt: Attempt) {
  const options = resolvePredictionOptions(mission, trace);
  const unit = mission.prediction.kind === "numeric" && mission.prediction.unit ? ` ${mission.prediction.unit}` : "";
  const answer = attempt.prediction?.answer;
  const predicted = !answer ? null : "optionId" in answer ? options.find((option) => option.id === answer.optionId)?.text ?? null : `${answer.number}${unit}`;
  const expected = trace.outcome[mission.prediction.answer.fact.split(".")[1]];
  const computed = mission.prediction.kind === "choice" ? options.find((option) => option.value === expected)?.text ?? String(expected) : `${expected}${unit}`;
  return { predicted, computed, correct: attempt.prediction?.correct ?? null };
}
