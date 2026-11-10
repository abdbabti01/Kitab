import { z } from "zod";
import { findMission } from "../src/learning/missions/catalog.ts";
import type { D1Database, Env } from "./env.ts";
import { failure, json, readJson, requester, requireJson } from "./http.ts";
import { admit } from "./quota.ts";

const frameId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);

const feedbackSchema = z
  .object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("mission"), missionId: z.string().max(64), missionVersion: z.string().max(20), engineVersion: z.string().max(20), scenarioKey: z.string().max(600), frameId }).strict(),
      z.object({ kind: z.literal("draft"), versionId: z.number().int().positive(), frameId }).strict(),
    ]),
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).default(""),
  })
  .strict();

/** The mission, mission version and engine version the client names are the ones this Worker serves. */
function isCurrent(target: { missionId: string; missionVersion: string; engineVersion: string; scenarioKey: string }) {
  const mission = findMission(target.missionId);
  return Boolean(mission && mission.version === target.missionVersion && mission.engine.version === target.engineVersion && target.scenarioKey.startsWith(`${mission.engine.id}@${target.engineVersion}:`));
}

/**
 * Daily (UTC) write caps for the public endpoints, in their own usage_counters scopes: they never draw on AI
 * quotas. Keyed on the client network (IPv4 address or IPv6 /64), plus a global ceiling that bounds D1 writes
 * however many addresses an abuser holds. x-kitab-session is client-chosen, so it gates nothing here.
 * A network cap fits a ~30-learner classroom behind one NAT.
 */
// ponytail: constants, move to wrangler vars if they need tuning without a deploy.
export const DAILY_LIMITS = {
  feedback: { network: 50, global: 500 },
  events: { network: 2_000, global: 10_000 },
};

const LIMITED_MESSAGE = {
  feedback: "Feedback limit reached for today on this network. Please try again tomorrow.",
  events: "Learning event limit reached for today.",
};

/** Null when admitted; otherwise a 429 that holds until the UTC day resets. A rejection writes nothing to D1. */
async function rateLimit(db: D1Database, kind: keyof typeof DAILY_LIMITS, network: string) {
  const limits = DAILY_LIMITS[kind];
  const result = await admit(db, [
    { scope: `${kind}-network`, subject: network, limit: limits.network },
    { scope: `${kind}-global`, subject: "global", limit: limits.global },
  ]);
  if (result.ok) return null;
  // Measured without a D1 write: this log line and the 429s in Workers analytics.
  console.warn(JSON.stringify({ message: "rate-limited", endpoint: kind, scope: result.exhausted }));
  const now = new Date();
  const retryAfter = Math.ceil((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) - now.getTime()) / 1000);
  return json({ error: LIMITED_MESSAGE[kind], code: "RATE_LIMITED" }, 429, { "retry-after": String(retryAfter) });
}

export async function handleFeedback(request: Request, env: Env) {
  requireJson(request);
  const parsed = feedbackSchema.safeParse(await readJson(request, 4_096));
  if (!parsed.success) return failure(400, "INVALID_FEEDBACK", "Feedback needs a rating from 1 to 5 and a valid target.");
  if (!env.DB) return failure(503, "DB_UNAVAILABLE", "Feedback storage is not connected.");
  const { target, rating, comment } = parsed.data;
  if (target.kind === "mission" && !isCurrent(target)) return failure(409, "UNKNOWN_TARGET", "That mission version is no longer available.");
  try {
    const limited = await rateLimit(env.DB, "feedback", (await requester(request)).network);
    if (limited) return limited;
    if (target.kind === "mission") {
      const row = await env.DB.prepare("INSERT INTO mission_feedback (mission_id, mission_version, engine_version, scenario_key, frame_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id")
        .bind(target.missionId, target.missionVersion, target.engineVersion, target.scenarioKey, target.frameId, rating, comment.trim() || null)
        .first<{ id: number }>();
      return json({ ok: true, id: row!.id }, 201);
    }
    const version = await env.DB.prepare("SELECT id FROM lesson_versions WHERE id = ?").bind(target.versionId).first<{ id: number }>();
    if (!version) return failure(404, "UNKNOWN_VERSION", "That draft version does not exist.");
    const row = await env.DB.prepare("INSERT INTO lesson_feedback (lesson_version_id, event_id, rating, comment) VALUES (?, ?, ?, ?) RETURNING id")
      .bind(target.versionId, target.frameId, rating, comment.trim() || null)
      .first<{ id: number }>();
    return json({ ok: true, id: row!.id }, 201);
  } catch (error) {
    console.error("Feedback save failed.", error);
    return failure(503, "D1_SAVE_FAILED", "Feedback could not be saved. Please try again.");
  }
}

const eventSchema = z
  .object({
    type: z.enum(["prediction-submitted", "mission-mastered", "attempt-finished"]),
    missionId: z.string().max(64),
    missionVersion: z.string().max(20),
    engineVersion: z.string().max(20),
    scenarioKey: z.string().max(600),
    correct: z.boolean().optional(),
  })
  .strict();

/** Meaningful learning events only; the client never sends per-frame events. Over the daily cap they are dropped with a 429. */
export async function handleEvent(request: Request, env: Env) {
  requireJson(request);
  const parsed = eventSchema.safeParse(await readJson(request, 2_048));
  if (!parsed.success || !isCurrent(parsed.data)) return failure(400, "INVALID_EVENT", "Unknown learning event.");
  if (!env.DB) return json({ ok: false, stored: false }, 202);
  const event = parsed.data;
  try {
    const who = await requester(request);
    const limited = await rateLimit(env.DB, "events", who.network);
    if (limited) return limited;
    await env.DB.prepare("INSERT INTO learning_events (session_hash, event_type, mission_id, mission_version, engine_version, scenario_key, correct) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(who.session, event.type, event.missionId, event.missionVersion, event.engineVersion, event.scenarioKey, event.correct === undefined ? null : Number(event.correct))
      .run();
    return json({ ok: true, stored: true }, 201);
  } catch (error) {
    console.error("Learning event save failed.", error);
    return json({ ok: false, stored: false }, 202);
  }
}
