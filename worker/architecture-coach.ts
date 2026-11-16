import { buildCoachContext, buildCoachMessages, COACH_MAX_BODY, CoachError, coachRequestSchema, fallbackCoach, validateCoachOutput, type CoachContext } from "../src/architecture/coach.ts";
import { tutorJsonSchema } from "../src/learning/tutor.ts";
import { AiError, runBudgeted } from "./ai.ts";
import { limit, modelFor, neuronBudget, type Env, type WorkerContext } from "./env.ts";
import { failure, json, readJson, requester } from "./http.ts";
import { reserve } from "./quota.ts";

const COACH_TIMEOUT_MS = 12_000;

function audit(env: Env, ctx: WorkerContext, context: CoachContext, source: "ai" | "fallback", reason: string | null, extra: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null } = {}) {
  if (!env.DB) return;
  // The tutor's audit table, namespaced by "architecture:". No learner text or design is stored.
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO tutor_requests (mission_id, mission_version, engine_version, scenario_key, frame_index, intent, source, reason, model, latency_ms, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(`architecture:${context.challenge.id}`, context.challenge.version, "architecture-sim/1", `${context.design.nodes.length}-nodes`, 0, "architecture-coach", source, reason, extra.model ?? null, extra.latencyMs ?? null, extra.inputTokens ?? null, extra.outputTokens ?? null)
      .run()
      .catch((error) => console.error("Architecture coach audit write failed.", error)),
  );
}

/** POST /api/architecture-coach: an optional AI answer about a challenge design, or the reviewed hint. */
export async function handleArchitectureCoach(request: Request, env: Env, ctx: WorkerContext) {
  const parsed = coachRequestSchema.safeParse(await readJson(request, COACH_MAX_BODY));
  if (!parsed.success) return failure(400, "INVALID_COACH_REQUEST", "The question is malformed.");
  let context: CoachContext;
  try {
    context = buildCoachContext(parsed.data);
  } catch (error) {
    if (error instanceof CoachError) return failure(error.code === "UNKNOWN_CHALLENGE" ? 404 : error.code === "INVALID_DESIGN" ? 400 : 409, error.code, error.message);
    throw error;
  }

  const fallback = (reason: string, extra = {}) => {
    audit(env, ctx, context, "fallback", reason, extra);
    return json({ response: fallbackCoach(context), source: "fallback", reason });
  };

  if (!env.AI) return fallback("AI_UNAVAILABLE");
  if (!env.DB) return fallback("QUOTA_UNAVAILABLE"); // fail closed: no quota, no inference

  const who = await requester(request);
  try {
    // The tutor's scopes: one learner's tutor allowance covers missions, lessons and the coach. No new budget.
    const reservation = await reserve(env.DB, [
      { scope: "tutor-ip", subject: who.ip, limit: limit(env.DAILY_TUTOR_PER_IP, 120) },
      { scope: "tutor-session", subject: who.session, limit: limit(env.DAILY_TUTOR_PER_SESSION, 80) },
      { scope: "tutor-global", subject: "global", limit: limit(env.DAILY_TUTOR_GLOBAL, 5_000) },
    ]);
    if (!reservation.ok) return fallback("QUOTA_EXHAUSTED");
  } catch (error) {
    console.error("Architecture coach quota reservation failed.", error);
    return fallback("QUOTA_UNAVAILABLE");
  }

  const model = modelFor(env);
  try {
    // One call, no retry, on the shared daily Neuron allowance.
    const result = await runBudgeted(env.DB, neuronBudget(env), env.AI, model, { messages: buildCoachMessages(context), response_format: { type: "json_schema", json_schema: tutorJsonSchema }, max_tokens: 400, temperature: 0.2 }, limit(env.AI_TIMEOUT_MS, COACH_TIMEOUT_MS));
    const extra = { model, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    const checked = validateCoachOutput(result.value, context);
    if (!checked.ok) {
      console.warn("Architecture coach output rejected.", checked.problems);
      return fallback("INVALID_OUTPUT", extra);
    }
    audit(env, ctx, context, "ai", null, extra);
    return json({ response: checked.response, source: "ai" });
  } catch (error) {
    const code = error instanceof AiError ? error.code : "AI_FAILED";
    if (code === "AI_BUDGET_EXHAUSTED") return fallback("QUOTA_EXHAUSTED");
    console.error("Architecture coach inference failed.", error);
    return fallback(code, { model, inputTokens: error instanceof AiError ? error.usage?.inputTokens : null, outputTokens: error instanceof AiError ? error.usage?.outputTokens : null });
  }
}
