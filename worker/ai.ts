import type { AiBinding } from "./env.ts";

export class AiError extends Error {
  readonly code: "AI_TIMEOUT" | "AI_FAILED" | "AI_EMPTY" | "AI_INVALID_JSON";
  constructor(code: AiError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export type AiResult = { value: unknown; inputTokens: number | null; outputTokens: number | null; latencyMs: number };

/** One inference call with a hard timeout. Never retried here; callers bound retries. */
export async function runModel(ai: AiBinding, model: string, input: Record<string, unknown>, timeoutMs: number): Promise<AiResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiError("AI_TIMEOUT", `Workers AI did not answer within ${timeoutMs} ms.`)), timeoutMs);
  });
  try {
    const raw = await Promise.race([ai.run(model, input), timeout]);
    const usage = (raw as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    return { value: parseModelJson(raw), inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null, latencyMs: Date.now() - started };
  } catch (error) {
    if (error instanceof AiError) throw error;
    throw new AiError("AI_FAILED", error instanceof Error ? error.message : "Workers AI failed.");
  } finally {
    clearTimeout(timer);
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
