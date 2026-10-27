import "../src/learning/engines/index.ts";
import { tutorJsonSchema } from "../src/learning/tutor.ts";
import { EngineError } from "../src/learning/registry.ts";
import { LessonContentError } from "../src/learning/lessons/runtime.ts";
import { buildLessonTutorContext, buildLessonTutorMessages, fallbackLessonTutor, LessonTutorError, lessonTutorRequestSchema, validateLessonTutorOutput, type LessonTutorContext } from "../src/learning/lessons/tutor.ts";
import { AiError, runBudgeted } from "./ai.ts";
import { limit, modelFor, neuronBudget, type Env, type WorkerContext } from "./env.ts";
import { failure, json, readJson, requester } from "./http.ts";
import { reserve } from "./quota.ts";

const TUTOR_TIMEOUT_MS = 12_000;

function audit(env: Env, ctx: WorkerContext, context: LessonTutorContext, source: "ai" | "fallback", reason: string | null, extra: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null } = {}) {
  if (!env.DB) return;
  // Same audit table as the mission tutor, namespaced by "lesson:". No learner text is stored.
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO tutor_requests (mission_id, mission_version, engine_version, scenario_key, frame_index, intent, source, reason, model, latency_ms, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(`lesson:${context.lesson.id}`, context.lesson.version, context.track.trace.engine.version, `${context.track.id}:${context.step.id}:${context.track.trace.scenarioKey}`.slice(0, 600), context.step.frameIndex, "lesson-follow-up", source, reason, extra.model ?? null, extra.latencyMs ?? null, extra.inputTokens ?? null, extra.outputTokens ?? null)
      .run()
      .catch((error) => console.error("Lesson tutor audit write failed.", error)),
  );
}

/** POST /api/lesson-tutor: an optional AI answer to a learner's follow-up question, or the reviewed step text. */
export async function handleLessonTutor(request: Request, env: Env, ctx: WorkerContext) {
  const parsed = lessonTutorRequestSchema.safeParse(await readJson(request, 8_192));
  if (!parsed.success) return failure(400, "INVALID_TUTOR_REQUEST", "The question is malformed.");
  let context: LessonTutorContext;
  try {
    context = buildLessonTutorContext(parsed.data);
  } catch (error) {
    if (error instanceof LessonTutorError) return failure(error.code === "UNKNOWN_LESSON" ? 404 : 409, error.code, error.message);
    if (error instanceof EngineError || error instanceof LessonContentError) return failure(400, "INVALID_PARAMETERS", "Those lesson settings are not valid.");
    throw error;
  }

  const fallback = (reason: string, extra = {}) => {
    audit(env, ctx, context, "fallback", reason, extra);
    return json({ response: fallbackLessonTutor(context), source: "fallback", reason });
  };

  if (!env.AI) return fallback("AI_UNAVAILABLE");
  if (!env.DB) return fallback("QUOTA_UNAVAILABLE"); // fail closed: no quota, no inference

  const who = await requester(request);
  try {
    // The mission tutor's scopes: one learner's tutor allowance covers both surfaces.
    const reservation = await reserve(env.DB, [
      { scope: "tutor-ip", subject: who.ip, limit: limit(env.DAILY_TUTOR_PER_IP, 120) },
      { scope: "tutor-session", subject: who.session, limit: limit(env.DAILY_TUTOR_PER_SESSION, 80) },
      { scope: "tutor-global", subject: "global", limit: limit(env.DAILY_TUTOR_GLOBAL, 5_000) },
    ]);
    if (!reservation.ok) return fallback("QUOTA_EXHAUSTED");
  } catch (error) {
    console.error("Lesson tutor quota reservation failed.", error);
    return fallback("QUOTA_UNAVAILABLE");
  }

  const model = modelFor(env);
  try {
    // One call, no retry; every call draws on the shared daily token allowance.
    const result = await runBudgeted(env.DB, neuronBudget(env), env.AI, model, { messages: buildLessonTutorMessages(context), response_format: { type: "json_schema", json_schema: tutorJsonSchema }, max_tokens: 400, temperature: 0.2 }, limit(env.AI_TIMEOUT_MS, TUTOR_TIMEOUT_MS));
    const extra = { model, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    const checked = validateLessonTutorOutput(result.value, context);
    if (!checked.ok) {
      console.warn("Lesson tutor output rejected.", checked.problems);
      return fallback("INVALID_OUTPUT", extra);
    }
    audit(env, ctx, context, "ai", null, extra);
    return json({ response: checked.response, source: "ai" });
  } catch (error) {
    const code = error instanceof AiError ? error.code : "AI_FAILED";
    if (code === "AI_BUDGET_EXHAUSTED") return fallback("QUOTA_EXHAUSTED");
    console.error("Lesson tutor inference failed.", error);
    return fallback(code, { model, inputTokens: error instanceof AiError ? error.usage?.inputTokens : null, outputTokens: error instanceof AiError ? error.usage?.outputTokens : null });
  }
}
