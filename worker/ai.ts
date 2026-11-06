import type { AiBinding, D1Database } from "./env.ts";
import { estimateNeurons, neuronsFor, reserveNeurons } from "./quota.ts";

export type AiUsage = { inputTokens: number | null; outputTokens: number | null };

export class AiError extends Error {
  readonly code: "AI_TIMEOUT" | "AI_FAILED" | "AI_EMPTY" | "AI_INVALID_JSON" | "AI_BUDGET_EXHAUSTED";
  /** Usage the model reported before the failure, when it reported any. */
  readonly usage: AiUsage | null;
  constructor(code: AiError["code"], message: string, usage: AiUsage | null = null) {
    super(message);
    this.code = code;
    this.usage = usage;
  }
}

export type AiResult = { value: unknown; inputTokens: number | null; outputTokens: number | null; latencyMs: number };

function usageOf(raw: unknown): AiUsage {
  const usage = (raw as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } } | null)?.usage;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  return { inputTokens: n(usage?.prompt_tokens), outputTokens: n(usage?.completion_tokens) };
}

/** One inference call with a hard timeout. Never retried here; callers bound retries. */
export async function runModel(ai: AiBinding, model: string, input: Record<string, unknown>, timeoutMs: number): Promise<AiResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError("AI_TIMEOUT", `Workers AI did not answer within ${timeoutMs} ms.`)), timeoutMs);
  });
  let raw: unknown;
  try {
    raw = await Promise.race([ai.run(model, input), timeout]);
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_FAILED", error instanceof Error ? error.message : "Workers AI failed.");
  } finally {
    clearTimeout(timer);
  }
  const usage = usageOf(raw);
  try {
    return { value: parseModelJson(raw), ...usage, latencyMs: Date.now() - started };
  } catch (error) {
    // The call happened and may have been billed: keep its reported usage on the error.
    throw new AiError(error instanceof AiError ? error.code : "AI_INVALID_JSON", error instanceof Error ? error.message : "Invalid output.", usage);
  }
}

/**
 * Every inference goes through here: reserve an upper-bound Neuron estimate from the shared daily allowance,
 * call the model, then settle to the Neurons of the reported prompt + completion tokens. Unreported usage keeps
 * the reservation. An unpriced model or a zero budget is never called.
 */
export async function runBudgeted(db: D1Database, budget: number, ai: AiBinding, model: string, input: Record<string, unknown>, timeoutMs: number): Promise<AiResult> {
  const estimate = estimateNeurons(model, input);
  if (estimate === null) throw new AiError("AI_BUDGET_EXHAUSTED", `No Neuron rate is known for ${model}, so it is not called.`);
  const reservation = await reserveNeurons(db, estimate, budget);
  if (!reservation.ok) throw new AiError("AI_BUDGET_EXHAUSTED", "The daily AI allowance is used up.");
  const settle = (usage: AiUsage | null) =>
    reservation.settle(usage && usage.inputTokens !== null && usage.outputTokens !== null ? neuronsFor(model, usage.inputTokens, usage.outputTokens) : null).catch((error) => console.error("Neuron reconciliation failed.", error));
  try {
    const result = await runModel(ai, model, input, timeoutMs);
    await settle(result);
    return result;
  } catch (error) {
    await settle(error instanceof AiError ? error.usage : null);
    throw error;
  }
}

/** Accepts `{response: object|string}` or a bare object/string; extracts one JSON object. */
export function parseModelJson(data: unknown): unknown {
  const value = (data as { response?: unknown } | null)?.response ?? data;
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) throw new AiError("AI_EMPTY", "Workers AI returned no content.");
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new AiError("AI_INVALID_JSON", "Workers AI returned invalid JSON.");
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new AiError("AI_INVALID_JSON", "Workers AI returned invalid JSON.");
  }
}
