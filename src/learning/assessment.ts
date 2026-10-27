import { buildTrace } from "./registry.ts";
import type { Mission, ValueRef } from "./mission-schema.ts";
import type { FactValue, Trace } from "./types.ts";

export class MissionContentError extends Error {}

export function resolveRef(ref: ValueRef | { fact: string }, trace: Trace): FactValue {
  if ("literal" in ref) return ref.literal;
  const [scope, key] = ref.fact.split(".");
  const source = scope === "outcome" ? trace.outcome : scope === "param" ? trace.params : undefined;
  if (!source || !(key in source)) throw new MissionContentError(`Unknown fact reference ${ref.fact}`);
  return source[key];
}

/** Replaces {outcome.x}, {param.x} and {value} placeholders with engine values. */
export function fillTemplate(template: string, trace: Trace, value?: FactValue) {
  return template.replace(/\{([a-zA-Z.]+)\}/g, (_, token: string) => {
    if (token === "value") {
      if (value === undefined) throw new MissionContentError(`{value} used without a value in "${template}"`);
      return String(value);
    }
    return String(resolveRef({ fact: token }, trace));
  });
}

export function variantFor(mission: Mission, attemptNumber: number) {
  return mission.variants[(Math.max(1, attemptNumber) - 1) % mission.variants.length];
}

export function traceFor(mission: Mission, params: Record<string, FactValue>) {
  return buildTrace(mission.engine.id, { ...mission.scenario, ...params });
}

/** Deterministic per-attempt order: stable across renders and refreshes, different between attempts. */
export function optionOrder(seed: string, ids: string[]) {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  const random = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = [...ids];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

export type ResolvedOption = { id: string; text: string; value: FactValue; misconception?: string };

export function resolvePredictionOptions(mission: Mission, trace: Trace): ResolvedOption[] {
  if (mission.prediction.kind !== "choice") return [];
  return mission.prediction.options.map((option) => {
    const value = resolveRef(option.value, trace);
    return { id: option.id, text: fillTemplate(option.text, trace, value), value, misconception: option.misconception };
  });
}

export type PredictionAnswer = { optionId: string } | { number: number };

export type PredictionResult = { correct: boolean; expected: FactValue; misconception?: string };

export function assessPrediction(mission: Mission, trace: Trace, answer: PredictionAnswer): PredictionResult {
  const expected = resolveRef(mission.prediction.answer, trace);
  if (mission.prediction.kind === "numeric") {
    if (!("number" in answer) || !Number.isFinite(answer.number)) return { correct: false, expected };
    return { correct: answer.number === Number(expected), expected };
  }
  if (!("optionId" in answer)) return { correct: false, expected };
  const option = resolvePredictionOptions(mission, trace).find((item) => item.id === answer.optionId);
  if (!option) return { correct: false, expected };
  return { correct: option.value === expected, expected, misconception: option.value === expected ? undefined : option.misconception };
}

export function assessExplanation(mission: Mission, choiceId: string) {
  const option = mission.explanation.options.find((item) => item.id === choiceId);
  return { correct: Boolean(option?.correct), misconception: option?.correct ? undefined : option?.misconception };
}

export function evidenceFrameIndex(mission: Mission, trace: Trace) {
  const id = fillTemplate(mission.prediction.evidenceFrame, trace);
  const index = trace.frames.findIndex((frame) => frame.id === id);
  return index < 0 ? trace.frames.length - 1 : index;
}

/**
 * Content check used by tests and the dev build: every variant must build,
 * every template must resolve, and exactly one option must match the computed answer.
 */
export function validateMissionContent(mission: Mission) {
  const problems: string[] = [];
  // Text shown before the prediction may use parameters, never computed outcomes.
  for (const [label, template] of [
    ["objective", mission.objective],
    ["prompt", mission.prediction.prompt],
    ...mission.hints.filter((hint) => hint.beforePrediction).map((hint) => ["hint", hint.text] as const),
    ...(mission.prediction.kind === "choice" ? mission.prediction.options.map((option) => ["option", option.text] as const) : []),
  ] as const) {
    if (template.includes("{outcome.")) problems.push(`${mission.id}: ${label} reveals an outcome before prediction: "${template}"`);
  }
  for (const variant of mission.variants) {
    const where = `${mission.id}/${variant.id}`;
    try {
      const trace = traceFor(mission, variant.params);
      if (trace.engine.version !== mission.engine.version) problems.push(`${where}: engine ${trace.engine.id}@${trace.engine.version} but mission expects ${mission.engine.version}`);
      if (trace.diagnostics.length) problems.push(`${where}: ${trace.diagnostics.join(" ")}`);
      const expected = resolveRef(mission.prediction.answer, trace);
      fillTemplate(mission.prediction.prompt, trace);
      fillTemplate(mission.objective, trace);
      if (mission.prediction.kind === "choice") {
        const options = resolvePredictionOptions(mission, trace);
        const matches = options.filter((option) => option.value === expected);
        if (matches.length !== 1) problems.push(`${where}: ${matches.length} options match answer ${expected}`);
        if (new Set(options.map((option) => String(option.value))).size !== options.length) problems.push(`${where}: duplicate option values`);
      }
      const evidenceId = fillTemplate(mission.prediction.evidenceFrame, trace);
      if (!trace.frames.some((frame) => frame.id === evidenceId)) problems.push(`${where}: evidence frame ${evidenceId} missing`);
      mission.explanation.options.forEach((option) => fillTemplate(option.text, trace));
      const entities = new Set(trace.frames.flatMap((frame) => frame.entities.map((entity) => entity.id)));
      for (const target of [...mission.hints.map((hint) => hint.target), ...Object.values(mission.misconceptions).map((item) => item.target)]) {
        if (target && !entities.has(fillTemplate(target, trace))) problems.push(`${where}: target ${target} is not an entity`);
      }
      mission.hints.forEach((hint) => fillTemplate(hint.text, trace));
      Object.values(mission.misconceptions).forEach((item) => fillTemplate(item.message, trace));
    } catch (error) {
      problems.push(`${where}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
