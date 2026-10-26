import { traceFor } from "./assessment.ts";
import type { Mission } from "./mission-schema.ts";
import { EngineError } from "./registry.ts";
import type { FactValue } from "./types.ts";

/**
 * AI-proposed scenario parameters are accepted only if every key is a
 * learner-editable control of this mission, every value is one the control
 * offers (choice, respecting onlyWhen) or lies on its range/step, and the
 * engine builds a complete trace without downgrading the scenario.
 * Correctness of the mechanism itself still comes from the engine.
 */
export function validateComposedParams(mission: Mission, raw: unknown): { ok: true; params: Record<string, FactValue>; scenarioKey: string } | { ok: false; problems: string[] } {
  const problems: string[] = [];
  if (!mission.learnerParams.length) return { ok: false, problems: ["This mission has no configurable scenario."] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, problems: ["Parameters must be an object."] };
  const input = raw as Record<string, unknown>;
  const allowed = new Map(mission.learnerParams.map((param) => [param.key, param]));
  for (const key of Object.keys(input)) if (!allowed.has(key)) problems.push(`Unknown parameter ${key}.`);
  const params: Record<string, FactValue> = { ...mission.scenario };
  for (const param of mission.learnerParams) {
    if (!(param.key in input)) continue;
    const value = input[param.key];
    if (param.control === "range") {
      const number = typeof value === "number" ? value : Number.NaN;
      const aligned = Number.isFinite(number) && Math.abs((number - param.min) / param.step - Math.round((number - param.min) / param.step)) < 1e-9;
      if (!Number.isFinite(number) || number < param.min || number > param.max || !aligned) problems.push(`${param.label} must be ${param.min}–${param.max} in steps of ${param.step}.`);
      else params[param.key] = number;
    } else params[param.key] = value as FactValue;
  }
  for (const param of mission.learnerParams) {
    if (param.control !== "choice" || !(param.key in input)) continue;
    const option = param.options.find((item) => item.value === input[param.key]);
    if (!option) problems.push(`${param.label} must be one of ${param.options.map((item) => String(item.value)).join(", ")}.`);
    else if (option.onlyWhen && !option.onlyWhen.values.includes(params[option.onlyWhen.key])) problems.push(`${param.label} “${option.label}” is not available for this ${option.onlyWhen.key}.`);
  }
  if (problems.length) return { ok: false, problems };
  try {
    const trace = traceFor(mission, params);
    // Preconditions: the engine must run the scenario as asked, not a fallback of it.
    if (trace.diagnostics.length) return { ok: false, problems: trace.diagnostics };
    for (const [key, value] of Object.entries(params)) if (key in trace.params && trace.params[key] !== value) return { ok: false, problems: [`The engine normalized ${key} from ${value} to ${trace.params[key]}.`] };
    if (trace.frames.at(-1)!.id !== trace.outcome.lastFrame) return { ok: false, problems: ["The trace did not reach its terminal frame."] };
    return { ok: true, params, scenarioKey: trace.scenarioKey };
  } catch (error) {
    return { ok: false, problems: [error instanceof EngineError || error instanceof Error ? error.message : "The engine rejected the scenario."] };
  }
}

/** JSON schema for the model, derived from the mission's own controls. */
export function composeJsonSchema(mission: Mission) {
  const properties = Object.fromEntries(
    mission.learnerParams.map((param) => [
      param.key,
      param.control === "choice" ? { enum: [...new Set(param.options.map((option) => option.value))] } : { type: "number", minimum: param.min, maximum: param.max },
    ]),
  );
  return { type: "object", additionalProperties: false, properties: { params: { type: "object", additionalProperties: false, properties } }, required: ["params"] };
}
