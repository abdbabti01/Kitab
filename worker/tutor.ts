import "../src/learning/engines/index.ts";
import { findMission } from "../src/learning/missions/catalog.ts";
import { buildTutorContext, buildTutorMessages, fallbackTutor, tutorJsonSchema, tutorRequestSchema, TutorRequestError, validateTutorOutput, type TutorContext } from "../src/learning/tutor.ts";
import { EngineError } from "../src/learning/registry.ts";
import { runModel } from "./ai.ts";
import { limit, modelFor, type Env, type WorkerContext } from "./env.ts";
import { failure, json, readJson, requester } from "./http.ts";
import { recordTokens, reserve } from "./quota.ts";

const TUTOR_TIMEOUT_MS = 8_000;

function audit(env: Env, ctx: WorkerContext, context: TutorContext, source: "ai" | "fallback", reason: string | null, extra: { model?: string; latencyMs?: number; inputTokens?: number | null; outputTokens?: number | null } = {}) {
  if (!env.DB) return;
  // Audit only: no learner text is stored. A failed write never changes the answer.
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO tutor_requests (mission_id, mission_version, engine_version, scenario_key, frame_index, intent, source, reason, model, latency_ms, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(context.mission.id, context.mission.version, context.trace.engine.version, context.trace.scenarioKey.slice(0, 600), context.frameIndex, context.request.intent, source, reason, extra.model ?? null, extra.latencyMs ?? null, extra.inputTokens ?? null, extra.outputTokens ?? null)
      .run()
      .catch((error) => console.error("Tutor audit write failed.", error)),
  );
}

export async function handleTutor(request: Request, env: Env, ctx: WorkerContext) {
  const parsed = tutorRequestSchema.safeParse(await readJson(request, 8_192));
  if (!parsed.success) return failure(400, "INVALID_TUTOR_REQUEST", "The tutor request is malformed.");
  const mission = findMission(parsed.data.missionId);
  if (!mission) return failure(404, "UNKNOWN_MISSION", "That mission does not exist.");
  let context: TutorContext;
  try {
    context = buildTutorContext(mission, parsed.data);
  } catch (error) {
    if (error instanceof TutorRequestError) return failure(409, "MISSION_VERSION_CHANGED", error.message);
    if (error instanceof EngineError) return failure(400, "INVALID_PARAMETERS", "Those mission parameters are not valid.");
    throw error;
  }

  const fallback = (reason: string, extra = {}) => {
    audit(env, ctx, context, "fallback", reason, extra);
    return json({ response: fallbackTutor(context), source: "fallback", reason });
  };

  if (!env.AI) return fallback("AI_UNAVAILABLE");
  if (!env.DB) return fallback("QUOTA_UNAVAILABLE"); // fail closed: no quota, no inference

  const who = await requester(request);
  try {
    const reservation = await reserve(env.DB, [
      { scope: "tutor-ip", subject: who.ip, limit: limit(env.DAILY_TUTOR_PER_IP, 120) },
      { scope: "tutor-session", subject: who.session, limit: limit(env.DAILY_TUTOR_PER_SESSION, 80) },
      { scope: "tutor-global", subject: "global", limit: limit(env.DAILY_TUTOR_GLOBAL, 5_000) },
    ], limit(env.DAILY_TOKEN_BUDGET, 2_000_000));
    if (!reservation.ok) return fallback("QUOTA_EXHAUSTED");
  } catch (error) {
    console.error("Tutor quota reservation failed.", error);
    return fallback("QUOTA_UNAVAILABLE");
  }

  const model = modelFor(env);
  try {
    const result = await runModel(env.AI, model, { messages: buildTutorMessages(context), response_format: { type: "json_schema", json_schema: tutorJsonSchema }, max_tokens: 400, temperature: 0.2 }, limit(env.AI_TIMEOUT_MS, TUTOR_TIMEOUT_MS));
    const extra = { model, latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens };
    ctx.waitUntil(recordTokens(env.DB, "tutor-global", (result.inputTokens ?? 0) + (result.outputTokens ?? 0)).catch(() => undefined));
    const checked = validateTutorOutput(result.value, context);
    if (!checked.ok) {
      console.warn("Tutor output rejected.", checked.problems);
      return fallback("INVALID_OUTPUT", extra);
    }
    audit(env, ctx, context, "ai", null, extra);
    return json({ response: checked.response, source: "ai" });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "AI_FAILED";
    console.error("Tutor inference failed.", error);
    return fallback(code, { model });
  }
}
